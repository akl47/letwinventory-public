'use strict';

// Orchestrates a full feature-tree regeneration for a CAD model.
//
// Walks the model's `featureTree`, and for each visible feature:
//   1. extracts the closed loop(s) from the saved `sketchDoc`
//   2. computes a cache key triple (featureId, paramHash, upstreamHash)
//   3. on cache hit, returns the cached tessellated faces immediately
//   4. on cache miss, calls the Rust kernel via `cadKernelClient`,
//      writes the result back to the cache, and returns it
//
// `featureTree` JSONB stays authoritative; `DesignBRepCache` is *derived*
// and can be dropped + rebuilt at any time. See
// `docs/cad-architecture-pivot-plan.md` for the broader design.
//
// Phase 1 v1 limits (extension points called out as TODOs):
//   - Only extrude features. Cut/revolve/sweep/loft land in Phase 2.
//   - upstreamHash is always '' because no current feature kind consumes
//     upstream BRep yet. Cuts/fillets will populate this when they land.
//   - No streaming — returns the full geometry payload in the response.
//     The cadStreamService skeleton is in place for the Phase 1.5
//     incremental-edit path.

const crypto = require('crypto');
const { getDefaultClient } = require('./cadKernelClient');
const { extractRegions } = require('./cadProfile');

// Bump whenever the kernel's BRep/mesh output changes shape — old
// DesignBRepCache rows with a lower namingVersion no longer match, so
// every feature re-runs through the kernel.
// 2: arcs switched from chord approximation to true OCCT arc edges.
// 3: profiles became regions (outer loop + N inner holes); donut/annular
//    extrudes via CompoundFace = Face.subtract(hole).
// 4: ExtrudeFeature gained endCondition. Most existing features default
//    to { kind: 'blind' } and produce byte-identical output; Mid Plane
//    and Through All resolve into a shifted-origin / sentinel-distance
//    Blind call in the backend without a kernel change.
const NAMING_VERSION = 4;  // matches NAMING_SCHEMA_VERSION in cad-kernel/src/main.rs

// Sentinel distance for Through All. Picked to comfortably exceed any
// reasonable model dimension without overflowing OCCT's tolerance
// budget. When subtractive booleans land, Through All will be trimmed
// against the body instead of relying on this constant.
const THROUGH_ALL_DISTANCE = 10000;

/**
 * @param {object} model    a DesignCADModel Sequelize instance (with featureTree+sketchDoc)
 * @param {object} options  { kernelClient?, db?, onFeatureResult? }
 *   onFeatureResult(result): optional callback invoked synchronously as each
 *   feature completes (cache hit OR kernel response). Used by the streaming
 *   controller to broadcast per-feature WebSocket events so the editor can
 *   render incrementally instead of waiting for the full HTTP response.
 *   Errors thrown from the callback are caught + logged so a bad
 *   broadcaster can't fail the regen.
 * @returns {Promise<{
 *   features: Array<{ featureId, faces, topology, error?, cached: boolean }>,
 *   errors: string[],
 * }>}
 */
async function regenerateModel(model, { kernelClient, db, onFeatureResult } = {}) {
  const client = kernelClient || getDefaultClient();
  const dbClient = db || global.db;
  const featureTree = model.featureTree || { features: [] };
  const sketchDoc = model.sketchDoc || { sketches: {} };
  const emit = _safeCallback(onFeatureResult);

  const results = [];
  const errors = [];
  // Running vertex map populated as we process features in order. Used
  // by Up to Vertex to resolve a picked vertex id (which lives in an
  // upstream feature's emitted topology) back to a 3D position. Sketch
  // points are seeded up front (they don't require a kernel call) so
  // they're available to ANY extrude — including one whose Up to Vertex
  // targets a sketch in the same regen.
  /** @type {Map<string, [number, number, number]>} */
  const vertexMap = new Map();
  _seedSketchVertices(vertexMap, sketchDoc);
  // Per-face centroid + normal map, populated as features complete.
  // Used by Up to Surface to compute the perpendicular distance from
  // the sketch plane to a picked face.
  /** @type {Map<string, { centroid: [number, number, number], normal: [number, number, number] }>} */
  const faceMap = new Map();

  for (const feature of featureTree.features) {
    if (feature.type === 'origin') continue;
    if (feature.visible === false) continue;
    if (feature.type !== 'extrude') {
      errors.push(`feature ${feature.id}: unsupported type '${feature.type}'`);
      continue;
    }

    let result;
    try {
      const out = await _regenerateExtrude(feature, sketchDoc, model, client, dbClient, vertexMap, faceMap);
      result = {
        featureId: feature.id,
        faces: out.merged,
        topology: out.topology,
        cached: out.cached,
      };
      // Index this feature's vertices + faces for any downstream
      // Up-to-Vertex / Up-to-Surface consumer.
      for (const v of out.topology.vertices || []) vertexMap.set(v.id, v.position);
      for (const f of out.merged || []) {
        const plane = _faceRepresentativePlane(f);
        if (plane) faceMap.set(f.faceId, plane);
      }
    } catch (err) {
      result = {
        featureId: feature.id,
        faces: [],
        topology: { vertices: [], edges: [] },
        error: err.message,
        cached: false,
      };
      errors.push(`feature ${feature.id}: ${err.message}`);
    }
    results.push(result);
    emit(result);
  }

  return { features: results, errors };
}

function _safeCallback(fn) {
  if (typeof fn !== 'function') return () => {};
  return (arg) => {
    try { fn(arg); }
    catch (e) { console.error('[cadRegenService] onFeatureResult callback threw:', e); }
  };
}

async function _regenerateExtrude(feature, sketchDoc, model, client, dbClient, vertexMap, faceMap) {
  const sketch = sketchDoc.sketches[feature.sketchId];
  if (!sketch) throw new Error(`sketch ${feature.sketchId} not found in sketchDoc`);

  const { regions, errors: regionErrors } = extractRegions(sketch.state || { entities: [], constraints: [] });
  if (regions.length === 0) {
    throw new Error(regionErrors[0] || 'no closed loops in sketch');
  }
  // Accept regionIndices going forward; fall back to legacy loopIndices for
  // docs persisted before the rename. For non-nested sketches the indices
  // are identical, so this is a pure compatibility shim.
  const regionIndices = Array.isArray(feature.regionIndices)
    ? feature.regionIndices
    : Array.isArray(feature.loopIndices)
      ? feature.loopIndices
      : [0];

  // One kernel call per selected region. Each region carries its own
  // paramHash so independent region edits don't invalidate each other;
  // the hash includes the holes payload so adding/removing a hole
  // re-triggers the kernel even when the outer loop hash matches.
  const mergedFaces = [];
  const mergedTopology = { vertices: [], edges: [] };
  let allCached = true;

  const endCondition = feature.endCondition || { kind: 'blind' };

  for (const ri of regionIndices) {
    if (ri < 0 || ri >= regions.length) {
      throw new Error(`region index ${ri} out of range (have ${regions.length})`);
    }
    const region = regions[ri];
    // Resolve end condition → concrete (plane, distance, flipped) kernel
    // inputs. Mid Plane / Through All translate at this layer so the
    // kernel keeps a single-distance API.
    const dispatch = _resolveEndConditionDispatch(endCondition, sketch.plane, feature, vertexMap, faceMap);
    const paramHash = _hashParams({
      profile: region.outer,
      holes: region.holes,
      plane: dispatch.plane,
      distance: dispatch.distance,
      flipped: dispatch.flipped,
      endKind: endCondition.kind,
      regionIndex: ri,
    });
    const upstreamHash = '';  // Phase 1 — no upstream BRep dependency yet

    const cached = await dbClient.DesignBRepCache.findOne({
      where: {
        cadModelID: model.id,
        featureID: `${feature.id}#${ri}`,
        paramHash,
        upstreamHash,
        namingVersion: NAMING_VERSION,
      },
    });

    const scope = `${feature.id}#${ri}`;

    if (cached) {
      cached.lastAccessedAt = new Date();
      await cached.save();
      mergedFaces.push(...(cached.tessellatedFaces.faces || []));
      _mergeTopology(mergedTopology, cached.tessellatedFaces.topology, scope);
      continue;
    }

    allCached = false;
    const rpc = await client.call('buildExtrude', {
      featureId: scope,
      profile: region.outer,
      holes: region.holes,
      plane: dispatch.plane,
      distance: dispatch.distance,
      flipped: dispatch.flipped,
    });

    await dbClient.DesignBRepCache.upsert({
      cadModelID: model.id,
      featureID: scope,
      paramHash,
      upstreamHash,
      brepBytes: Buffer.from(rpc.brepBytes || '', 'base64'),
      tessellatedFaces: { faces: rpc.faces, topology: rpc.topology },
      namingVersion: NAMING_VERSION,
      lastAccessedAt: new Date(),
    });
    mergedFaces.push(...(rpc.faces || []));
    _mergeTopology(mergedTopology, rpc.topology, scope);
  }

  return { merged: mergedFaces, topology: mergedTopology, cached: allCached };
}

/** Reduce a tessellated face mesh to a representative plane: average
 * vertex position as centroid + the first vertex's normal as the
 * surface normal. Valid for FLAT faces (which OCCT's tessellation
 * produces with consistent per-vertex normals); curved faces produce a
 * misleading plane and the Up to Surface resolver explicitly rejects
 * non-perpendicular targets so we never extrude against one.
 *
 * Accepts both typed arrays (live RPC response) and plain Arrays
 * (JSONB round-trip from the cache).
 *
 * @param {{positions: ArrayLike<number>, normals: ArrayLike<number>}} face
 * @returns {{centroid: [number, number, number], normal: [number, number, number]} | null}
 */
function _faceRepresentativePlane(face) {
  const pos = face.positions;
  const nor = face.normals;
  if (!pos || !nor || pos.length < 3 || nor.length < 3) return null;
  const vCount = pos.length / 3;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < vCount; i++) {
    cx += pos[i * 3 + 0];
    cy += pos[i * 3 + 1];
    cz += pos[i * 3 + 2];
  }
  return {
    centroid: [cx / vCount, cy / vCount, cz / vCount],
    normal:   [nor[0], nor[1], nor[2]],
  };
}

/** Pre-seed the regen-wide vertex map with sketch points. Each visible
 * sketch contributes one entry per Point entity, projected to world
 * coords through the sketch plane. Ids match the frontend's
 * `sketch:<sketchId>/<pointId>` namespace so what the viewer emits at
 * pick-time round-trips back here untouched.
 *
 * @param {Map<string, [number, number, number]>} vertexMap
 * @param {{sketches: Object<string, any>}} sketchDoc
 */
function _seedSketchVertices(vertexMap, sketchDoc) {
  if (!sketchDoc || !sketchDoc.sketches) return;
  for (const [sid, sketch] of Object.entries(sketchDoc.sketches)) {
    if (sketch.visible === false) continue;
    const plane = sketch.plane;
    const state = sketch.state || { entities: [] };
    for (const e of state.entities) {
      if (e.kind !== 'point') continue;
      vertexMap.set(`sketch:${sid}/${e.id}`, [
        plane.origin[0] + e.x * plane.xAxis[0] + e.y * plane.yAxis[0],
        plane.origin[1] + e.x * plane.xAxis[1] + e.y * plane.yAxis[1],
        plane.origin[2] + e.x * plane.xAxis[2] + e.y * plane.yAxis[2],
      ]);
    }
  }
}

/**
 * Translate a sketch plane + end condition into the (plane, distance,
 * flipped) triple the kernel expects. The kernel's buildExtrude RPC
 * doesn't know about Mid Plane / Through All / Up to *; we resolve them
 * here so the kernel stays focused on "extrude a profile from this plane
 * by this much".
 *
 * - blind: pass through (uses feature.distance / feature.flipped).
 * - midPlane: shift plane.origin by -normal · distance/2 so the resulting
 *   extrude is centred on the original sketch plane. Distance becomes
 *   the FULL thickness. Flipped is ignored (Mid Plane is symmetric).
 * - throughAll: large sentinel distance. Once subtractive booleans land
 *   we'll intersect this against the host body.
 * - upToVertex / upToSurface / upToBody: not yet implemented at the
 *   backend layer. Throws so an in-flight feature fails loudly rather
 *   than silently producing the wrong geometry.
 *
 * @param {{kind: string, [k: string]: any}} endCondition
 * @param {{origin: number[], xAxis: number[], yAxis: number[], normal: number[]}} plane
 * @param {{distance: number, flipped?: boolean}} feature
 * @returns {{plane: object, distance: number, flipped: boolean}}
 */
function _resolveEndConditionDispatch(endCondition, plane, feature, vertexMap, faceMap) {
  const baseFlipped = !!feature.flipped;
  switch (endCondition.kind) {
    case 'blind':
      return { plane, distance: feature.distance, flipped: baseFlipped };
    case 'midPlane': {
      const total = feature.distance;
      const half = total / 2;
      const shiftedPlane = {
        ...plane,
        origin: [
          plane.origin[0] - plane.normal[0] * half,
          plane.origin[1] - plane.normal[1] * half,
          plane.origin[2] - plane.normal[2] * half,
        ],
      };
      return { plane: shiftedPlane, distance: total, flipped: false };
    }
    case 'throughAll':
      return { plane, distance: THROUGH_ALL_DISTANCE, flipped: baseFlipped };
    case 'upToVertex': {
      const pos = vertexMap && vertexMap.get(endCondition.vertexId);
      if (!pos) {
        throw new Error(
          `Up to Vertex: vertex '${endCondition.vertexId}' not found in any upstream feature's ` +
          `topology. Re-pick the target vertex.`
        );
      }
      // Signed distance from sketch plane to vertex along plane.normal.
      // Positive = vertex on the +normal side; negative = -normal side.
      const dx = pos[0] - plane.origin[0];
      const dy = pos[1] - plane.origin[1];
      const dz = pos[2] - plane.origin[2];
      const signed = dx * plane.normal[0] + dy * plane.normal[1] + dz * plane.normal[2];
      if (Math.abs(signed) < 1e-6) {
        throw new Error('Up to Vertex: vertex lies on the sketch plane — nothing to extrude.');
      }
      // Kernel takes |distance| + flipped sign. Sign here is the
      // OBSERVED direction; the user's feature.flipped is ignored for
      // this kind because the vertex itself determines which way to
      // grow. (SolidWorks behaves the same — Reverse is disabled in the
      // PropertyManager when Up to Vertex is chosen, but we leave the
      // toggle visible for symmetry and just ignore it here.)
      return { plane, distance: Math.abs(signed), flipped: signed < 0 };
    }
    case 'upToSurface': {
      const target = faceMap && faceMap.get(endCondition.faceId);
      if (!target) {
        throw new Error(
          `Up to Surface: face '${endCondition.faceId}' not found in any upstream feature. ` +
          `Re-pick the target face.`
        );
      }
      // Require the target face's normal to be parallel to the extrude
      // direction. Oblique / curved targets need BRepFeat_MakeDPrism
      // (kernel work, future pass). |cos angle| ≈ 1 means parallel.
      const n = plane.normal;
      const fn = target.normal;
      const dot = n[0] * fn[0] + n[1] * fn[1] + n[2] * fn[2];
      if (Math.abs(Math.abs(dot) - 1) > 1e-3) {
        throw new Error(
          'Up to Surface: target face must be perpendicular to the extrude direction ' +
          '(i.e. its normal parallel to the sketch normal). Oblique / curved targets ' +
          'are not yet supported.'
        );
      }
      // Signed distance from sketch plane to face centroid along sketch normal.
      const dx = target.centroid[0] - plane.origin[0];
      const dy = target.centroid[1] - plane.origin[1];
      const dz = target.centroid[2] - plane.origin[2];
      const signed = dx * n[0] + dy * n[1] + dz * n[2];
      if (Math.abs(signed) < 1e-6) {
        throw new Error('Up to Surface: target face is coplanar with the sketch — nothing to extrude.');
      }
      return { plane, distance: Math.abs(signed), flipped: signed < 0 };
    }
    case 'upToBody':
      throw new Error(`extrude end condition '${endCondition.kind}' is not implemented yet`);
    default:
      throw new Error(`unknown extrude end condition: ${JSON.stringify(endCondition)}`);
  }
}

// Concat per-call topology into the feature-wide topology with namespaced
// IDs so vertex/edge IDs don't collide across loops or features.
function _mergeTopology(acc, topo, scope) {
  if (!topo) return;
  for (const v of topo.vertices || []) {
    acc.vertices.push({ id: `${scope}/${v.id}`, position: v.position });
  }
  for (const e of topo.edges || []) {
    acc.edges.push({
      id: `${scope}/${e.id}`,
      isStraight: !!e.isStraight,
      endpoints: e.endpoints,
    });
  }
}

/**
 * Stable hash over an arbitrary JSON-serializable object. SHA-256 truncated
 * to 32 hex chars — enough collision resistance for cache keying, short
 * enough to read in logs.
 */
function _hashParams(obj) {
  const json = _canonicalJson(obj);
  return crypto.createHash('sha256').update(json).digest('hex').slice(0, 32);
}

function _canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(_canonicalJson).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + _canonicalJson(value[k])).join(',') + '}';
}

module.exports = {
  regenerateModel,
  NAMING_VERSION,
};
