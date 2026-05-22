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
// 5: cumulative-body pipeline. Every feature emits the running cumulative
//    shape (its prism fused / cut into the body) so the frontend renders
//    only the latest. Face IDs in cumulative results come from the
//    kernel's centroid-sort tessellator (different namespace than the
//    pre-cumulative extrude tessellator).
// 6: RevolveFeature lands. Kernel gains buildRevolve. Backend dispatches
//    on feature.type so revolves flow through the same cumulative pipeline
//    (additive — fused into the running body).
const NAMING_VERSION = 6;  // matches NAMING_SCHEMA_VERSION in cad-kernel/src/main.rs

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

  // Running cumulative body across the feature stream. Starts as null;
  // first additive feature seeds it; each subsequent feature mutates it
  // via buildBoolean (fuse for Extrude, cut for CutExtrude). Each
  // feature's emit IS the cumulative shape after that feature, so the
  // frontend renders only the LATEST cumulative result.
  let cumulativeBrep = null;  // base64 string or null
  let cumulativeParamHash = '';

  for (const feature of featureTree.features) {
    if (feature.type === 'origin') continue;
    if (feature.visible === false) continue;
    if (feature.type !== 'extrude' && feature.type !== 'cutExtrude' && feature.type !== 'revolve') {
      errors.push(`feature ${feature.id}: unsupported type '${feature.type}'`);
      continue;
    }

    let result;
    try {
      // Stage 1: build the per-feature shape (a prism for Extrude / Cut,
      // a body of revolution for Revolve). Both return the same
      // { prismBrep, featureParamHash, merged, topology } shape so
      // Stage 2 doesn't care which dispatch ran.
      const prism = feature.type === 'revolve'
        ? await _regenerateRevolve(feature, sketchDoc, model, client, dbClient)
        : await _regenerateExtrude(feature, sketchDoc, model, client, dbClient, vertexMap, faceMap);
      // Stage 2: compose into the cumulative body.
      const composed = await _composeIntoCumulative({
        feature,
        prism,
        cumulativeBrep,
        cumulativeParamHash,
        model,
        client,
        dbClient,
      });
      cumulativeBrep = composed.cumulativeBrep;
      cumulativeParamHash = composed.cumulativeParamHash;
      result = {
        featureId: feature.id,
        faces: composed.faces,
        topology: composed.topology,
        cached: prism.cached && composed.cached,
      };
      // Index THIS feature's emitted vertices + faces so downstream Up
      // to Vertex / Up to Surface picks resolve to the same id the
      // viewer rendered.
      for (const v of composed.topology.vertices || []) vertexMap.set(v.id, v.position);
      for (const f of composed.faces || []) {
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
  const regionBreps = [];          // base64 BRep payloads per region
  const regionParamHashes = [];    // for the cumulative feature-level hash
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
    const upstreamHash = '';  // per-region prism has no upstream dependency

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
    regionParamHashes.push(paramHash);

    if (cached) {
      cached.lastAccessedAt = new Date();
      await cached.save();
      mergedFaces.push(...(cached.tessellatedFaces.faces || []));
      _mergeTopology(mergedTopology, cached.tessellatedFaces.topology, scope);
      // Cached brepBytes is a Buffer (Postgres BYTEA round-trip) — re-encode
      // to base64 for the boolean RPC.
      regionBreps.push(Buffer.isBuffer(cached.brepBytes)
        ? cached.brepBytes.toString('base64')
        : Buffer.from(cached.brepBytes || '').toString('base64'));
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
    regionBreps.push(rpc.brepBytes || '');
  }

  // Multi-region features need a single BRep at the feature level so the
  // cumulative compose has something to fuse / cut against. For N > 1
  // we sequentially fuse the region BReps into one via buildBoolean.
  let prismBrep = regionBreps[0] || '';
  for (let i = 1; i < regionBreps.length; i++) {
    const fused = await client.call('buildBoolean', {
      featureId: `${feature.id}#fuse${i}`,
      op: 'fuse',
      aBrep: prismBrep,
      bBrep: regionBreps[i],
    });
    prismBrep = fused.brepBytes;
  }
  const featureParamHash = _hashParams({ regions: regionParamHashes });

  return {
    merged: mergedFaces,
    topology: mergedTopology,
    cached: allCached,
    prismBrep,
    featureParamHash,
  };
}

/** Build a body of revolution from a sketched profile + sketched axis
 * line. Returns the same shape as `_regenerateExtrude` so the outer
 * composer is indifferent to which one produced the prism. Caching
 * mirrors the extrude path — keyed by `${feature.id}#revolve` plus the
 * resolved (axis, angle) params.
 *
 * Limitations of the MVP:
 * - The axis must be a sketched line entity in the SAME sketch (id
 *   match required). Future: reference an external edge / datum axis.
 * - Multi-region revolves are supported (fused per region via
 *   buildBoolean), same pattern as multi-region extrudes.
 * - End conditions (Up to Surface, etc.) are not applicable to revolves
 *   — only the angle field controls sweep extent.
 */
async function _regenerateRevolve(feature, sketchDoc, model, client, dbClient) {
  const sketch = sketchDoc.sketches[feature.sketchId];
  if (!sketch) throw new Error(`sketch ${feature.sketchId} not found in sketchDoc`);

  const { regions, errors: regionErrors } = extractRegions(sketch.state || { entities: [], constraints: [] });
  if (regions.length === 0) {
    throw new Error(regionErrors[0] || 'no closed loops in sketch');
  }
  const regionIndices = Array.isArray(feature.regionIndices)
    ? feature.regionIndices
    : Array.isArray(feature.loopIndices)
      ? feature.loopIndices
      : [0];

  // Resolve the axis: find the sketched line by id, look up its two
  // endpoints, project to 3D via the sketch plane, derive origin +
  // direction. The endpoints are referenced by id (entity 'point'), so
  // the lookup goes through the sketch state's entity array.
  const axis = _resolveSketchAxis(sketch, feature.axisLineId);

  // Direction can be flipped by the user's "Reverse" toggle — invert
  // axis_dir; equivalent to negating the angle for symmetric profiles.
  const axisDir = feature.flipped
    ? [-axis.dir[0], -axis.dir[1], -axis.dir[2]]
    : axis.dir;
  const angleDeg = Math.abs(Number(feature.angle) || 360);

  const mergedFaces = [];
  const mergedTopology = { vertices: [], edges: [] };
  const regionBreps = [];
  const regionParamHashes = [];
  let allCached = true;

  for (const ri of regionIndices) {
    if (ri < 0 || ri >= regions.length) {
      throw new Error(`region index ${ri} out of range (have ${regions.length})`);
    }
    const region = regions[ri];
    const paramHash = _hashParams({
      profile: region.outer,
      holes: region.holes,
      plane: sketch.plane,
      axisOrigin: axis.origin,
      axisDir,
      angleDeg,
      regionIndex: ri,
      revolve: true,
    });
    const upstreamHash = '';

    const cached = await dbClient.DesignBRepCache.findOne({
      where: {
        cadModelID: model.id,
        featureID: `${feature.id}#revolve${ri}`,
        paramHash,
        upstreamHash,
        namingVersion: NAMING_VERSION,
      },
    });
    const scope = `${feature.id}#revolve${ri}`;
    regionParamHashes.push(paramHash);

    if (cached) {
      cached.lastAccessedAt = new Date();
      await cached.save();
      mergedFaces.push(...(cached.tessellatedFaces.faces || []));
      _mergeTopology(mergedTopology, cached.tessellatedFaces.topology, scope);
      regionBreps.push(Buffer.isBuffer(cached.brepBytes)
        ? cached.brepBytes.toString('base64')
        : Buffer.from(cached.brepBytes || '').toString('base64'));
      continue;
    }

    allCached = false;
    const rpc = await client.call('buildRevolve', {
      featureId: scope,
      profile: region.outer,
      holes: region.holes,
      plane: sketch.plane,
      axisOrigin: axis.origin,
      axisDir,
      angleDeg,
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
    regionBreps.push(rpc.brepBytes || '');
  }

  let prismBrep = regionBreps[0] || '';
  for (let i = 1; i < regionBreps.length; i++) {
    const fused = await client.call('buildBoolean', {
      featureId: `${feature.id}#revolveFuse${i}`,
      op: 'fuse',
      aBrep: prismBrep,
      bBrep: regionBreps[i],
    });
    prismBrep = fused.brepBytes;
  }
  const featureParamHash = _hashParams({ revolve: true, regions: regionParamHashes });

  return {
    merged: mergedFaces,
    topology: mergedTopology,
    cached: allCached,
    prismBrep,
    featureParamHash,
  };
}

/** Look up a sketched line by id and project its 2D endpoints to 3D
 * world space, returning the line's origin (start endpoint) + a
 * normalized direction vector. Used by revolve to convert a sketched
 * axis into the world-space form the kernel RPC wants. */
function _resolveSketchAxis(sketch, axisLineId) {
  const state = sketch.state || { entities: [] };
  const line = state.entities.find(e => e.id === axisLineId && e.kind === 'line');
  if (!line) {
    throw new Error(`Revolve: axis line '${axisLineId}' not found in sketch.`);
  }
  const findPt = (id) => state.entities.find(e => e.id === id && e.kind === 'point');
  const a = findPt(line.startId);
  const b = findPt(line.endId);
  if (!a || !b) {
    throw new Error(`Revolve: axis line '${axisLineId}' is missing endpoint(s).`);
  }
  const project = (p) => [
    sketch.plane.origin[0] + p.x * sketch.plane.xAxis[0] + p.y * sketch.plane.yAxis[0],
    sketch.plane.origin[1] + p.x * sketch.plane.xAxis[1] + p.y * sketch.plane.yAxis[1],
    sketch.plane.origin[2] + p.x * sketch.plane.xAxis[2] + p.y * sketch.plane.yAxis[2],
  ];
  const aw = project(a);
  const bw = project(b);
  const dx = bw[0] - aw[0], dy = bw[1] - aw[1], dz = bw[2] - aw[2];
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-9) {
    throw new Error('Revolve: axis line has zero length.');
  }
  return { origin: aw, dir: [dx / len, dy / len, dz / len] };
}

/** Compose this feature's prism into the running cumulative body.
 *
 * - First additive feature: cumulative := prism. No boolean call needed.
 *   The frontend renders this feature's emit as-is.
 * - Subsequent additive Extrude: cumulative := fuse(cumulative, prism).
 * - CutExtrude: cumulative := cut(cumulative, prism). Errors if no
 *   cumulative exists (nothing to cut FROM).
 *
 * The cumulative cache row is keyed by featureID `${id}#cumulative` and
 * carries upstreamHash = previous feature's cumulative paramHash. That
 * gives cascade invalidation: edit feature N → its paramHash changes →
 * features N+1, N+2, ... see a changed upstreamHash and recompute.
 *
 * @returns {Promise<{
 *   cumulativeBrep: string,
 *   cumulativeParamHash: string,
 *   faces: Array,
 *   topology: object,
 *   cached: boolean,
 * }>}
 */
async function _composeIntoCumulative({
  feature, prism, cumulativeBrep, cumulativeParamHash, model, client, dbClient,
}) {
  const isCut = feature.type === 'cutExtrude';
  if (!cumulativeBrep) {
    if (isCut) {
      throw new Error(
        'Cut Extrude requires existing geometry to cut from. ' +
        'Add an additive Extrude before this feature.'
      );
    }
    // Seed cumulative with this prism. No boolean call.
    return {
      cumulativeBrep: prism.prismBrep,
      cumulativeParamHash: prism.featureParamHash,
      faces: prism.merged,
      topology: prism.topology,
      cached: prism.cached,
    };
  }

  const op = isCut ? 'cut' : 'fuse';
  const paramHash = _hashParams({
    op,
    featureParamHash: prism.featureParamHash,
  });
  const cacheKey = `${feature.id}#cumulative`;

  const cached = await dbClient.DesignBRepCache.findOne({
    where: {
      cadModelID: model.id,
      featureID: cacheKey,
      paramHash,
      upstreamHash: cumulativeParamHash,
      namingVersion: NAMING_VERSION,
    },
  });
  if (cached) {
    cached.lastAccessedAt = new Date();
    await cached.save();
    return {
      cumulativeBrep: Buffer.isBuffer(cached.brepBytes)
        ? cached.brepBytes.toString('base64')
        : Buffer.from(cached.brepBytes || '').toString('base64'),
      cumulativeParamHash: paramHash,
      faces: cached.tessellatedFaces.faces || [],
      topology: cached.tessellatedFaces.topology || { vertices: [], edges: [] },
      cached: true,
    };
  }

  const rpc = await client.call('buildBoolean', {
    featureId: `${feature.id}#cumulative`,
    op,
    aBrep: cumulativeBrep,
    bBrep: prism.prismBrep,
  });

  await dbClient.DesignBRepCache.upsert({
    cadModelID: model.id,
    featureID: cacheKey,
    paramHash,
    upstreamHash: cumulativeParamHash,
    brepBytes: Buffer.from(rpc.brepBytes || '', 'base64'),
    tessellatedFaces: { faces: rpc.faces, topology: rpc.topology },
    namingVersion: NAMING_VERSION,
    lastAccessedAt: new Date(),
  });

  return {
    cumulativeBrep: rpc.brepBytes,
    cumulativeParamHash: paramHash,
    faces: rpc.faces || [],
    topology: rpc.topology || { vertices: [], edges: [] },
    cached: false,
  };
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
