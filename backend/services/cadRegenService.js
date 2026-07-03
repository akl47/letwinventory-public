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
// Cache keying: prism-stage entries use (featureId, paramHash,
// upstreamHash='') while compose/blend/shell/pattern stages key
// upstreamHash = the upstream body's paramHash, so an upstream edit
// cascades invalidation down the body chain. Results stream per-feature
// over the WebSocket (cadStreamService) as they resolve.

const crypto = require('crypto');
// Imported as a namespace (not destructured) so tests can swap the kernel via
// `jest.spyOn(cadKernelClient, 'getDefaultClient')` — a destructured binding
// captures the original function and the spy would never take effect.
const cadKernelClient = require('./cadKernelClient');
const { extractRegions, extractMergedRegions } = require('./cadProfile');
const { applyEquationsToModel, resolveEquations } = require('./cadEquations');
const { applyProjectionToSketchDoc } = require('./cadProjection');

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
// 7: multi-body. ExtrudeFeature.merge controls whether the new prism
//    fuses into the most-recent body (default) or creates a new one.
//    Regen tracks an array of bodies; per-feature emit carries bodyId.
// 9: SweepFeature + CutSweepFeature land. Kernel gains buildSweep. Backend
//    dispatches on feature.type so sweeps flow through the same cumulative
//    pipeline (additive fuses, subtractive cuts).
// 10: kernel sweep moved from BRepOffsetAPI_MakePipe (strict, C1-only) to
//    MakePipeShell (forgiving, handles sharp corners) — different topology
//    output. Bumped so any sweep cache rows from the crash-era rebuild
//    fresh under the new kernel path.
// 11: MakeRevol constructors wrapped in Result via cxx so OCCT exceptions
//    no longer abort the kernel. Match kernel main.rs bump.
// 12: boolean ops now decompose results into independent solids
//    (TopAbs_SOLID walk). Per-solid breakdown stored in
//    tessellatedFaces.solids so subsequent regens can track multi-body
//    state SolidWorks-style. Cache schema change — bump invalidates v11.
// 13: invalidates any v12 cache rows that were written during the brief
//    window when the backend had been bumped to v12 but the solids
//    storage in _composeIntoBody hadn't shipped yet (nodemon reloaded
//    mid-edit). Cache values without `solids` make body tracking
//    misbehave — bumping forces a fresh kernel pass with full data.
// 14: per-body topology IDs are now scoped by body.id to prevent the
//    viewer's edge-Map collision that leaked stale Line objects into
//    the scene (visible as edges that wouldn't go away when their
//    body was hidden). Cache rows themselves are still valid; bumping
//    just ensures any in-flight regen re-derives the now-scoped IDs.
// 16: shell op's MakeThickSolid shim now runs BRepCheck_Analyzer on
//    the result and rejects malformed-but-IsDone-true shapes. Pre-bump
//    cache rows could store the malformed geometry as a "successful"
//    output; bumping forces every shell to re-dispatch through the
//    kernel so the validity check actually runs.
// 17: v16 rows still cached the malformed shell output because the
//    kernel was producing it as a "success" before the validity check
//    landed AND the subtraction pipeline's Stage-2 fall-through path
//    didn't exist yet. Bumping again so the next shell re-dispatches.
// 18: Stage 2 of the shell was producing a near-original-shape
//    result (16 faces ≈ original face count) — looks "unshelled" in
//    the viewer. Added diagnostics inside try_offset_solid_inward to
//    catch when the inner-offset returns an open-shell instead of a
//    closed solid. Cache invalidated so next attempt re-dispatches.
// 19: shell's Stage 2 punch-through prism was extruding along the
//    picked face's OUTWARD normal (away from the body), so the prism
//    sat outside the body and never connected the cavity to the
//    surface — result was a closed cavity inside an unbroken body
//    surface. Flipped to extrude INWARD (negate the normal) so the
//    prism actually punches through to open the picked face.
// 20: prism cross-section was still wrong (matched OUTER picked
//    face = whole-body cross-section), so subtract removed the wall
//    material around the cavity too. Visible as "shell shifted down
//    by thickness" — the body's bottom thickness-mm was missing
//    entirely instead of being a wall around an opening. Now matches
//    the picked face to the inner cavity's corresponding face by
//    normal alignment + centroid distance, and extrudes from THAT
//    face so the prism has the cavity's smaller cross-section.
// 21: shell Stage 0 (simple offset) now runs UnifySameDomain on its
//    result — MakeSimpleOffset left spurious seam/imprint edges (faces
//    came back split with extra boundary edges, e.g. 8–10 edges on a
//    plate face). Pre-bump cache rows hold the un-cleaned geometry;
//    bumping forces every shell to re-dispatch through the kernel.
// 22: shell Stage 0 now rejects self-intersecting results (the degenerate
//    thin-wall case — wall > ~half a thin region's local thickness —
//    produced coincident flickering faces). Falls through to the
//    subtraction pipeline that leaves thin regions solid. Bump
//    invalidates the cached degenerate geometry.
// 23: shell Stage 2 rewired to the conforming-punch pipeline with
//    wall-slab cavity construction (fully boolean; sharp corners by
//    construction; thin regions stay solid; no rolled-corner cylinder
//    faces, no punch-prism imprint edges, no MakeOffsetShape on the
//    primary path).
// 30: kernel rewritten from Rust (opencascade-rs / OCCT 7.6) to native C++
//    on OCCT 8.0. BReps are now binary BinTools, NOT byte-compatible with
//    the old text-BRep cache rows — feeding a v29 row to the C++ kernel's
//    BinTools reader fails. Bump invalidates every prior cache row so the
//    cumulative pipeline regenerates cleanly through the new kernel.
// 31: C++ kernel tessellation fix — the port had reproduced opencascade-rs's
//    off-by-one normal loop (dropped the last node's normal, padded with
//    (0,0,0)). Under OCCT 8.0's node ordering that zero-normal vertex landed
//    on visible triangles (dark/off-color artifact) AND flipped every planar
//    face's isFlat to false (faces no longer pickable as sketch hosts). Bump
//    invalidates the cpp-1 cache rows that hold the bad tessellation.
// 32: tessellation normals made orientation-aware (negated on REVERSED faces)
//    so they point outward — matches the frontend's documented contract and
//    the orientation-aware surface.normal. Fixes sketches placed on a reversed
//    face facing into the body. Invalidates cpp-2 cache rows (inward normals).
// 33: topology edges deduped by identity — TopExp_Explorer visits each shared
//    edge once per owning face, so every manifold edge was emitted twice; the
//    duplicate had no face referencing it (boundaryEdgeIds resolve by key to the
//    first id) and showed as a spurious pickable edge. Invalidates cpp-3 rows.
// 34: (superseded) boolean fuzzy + SimplifyResult attempt — didn't merge the
//    opposite-axis coaxial cylinder fragments; reverted.
// 35: (superseded) canonicalize-cylinder-surfaces attempt — broke edge sharing,
//    reverted.
// 36: back to plain UnifySameDomain. Invalidates the broken v35 canonicalized
//    cache rows.
// 37: kernel drops the co-domain seam edge between two co-cylindrical faces.
// 38: kernel MERGES coaxial cylinder faces (edge-preserving rebase + unify).
// 39: volume-preservation guard on that rebase — it inverted some solids
//    (part 586: negative volume → faces on the wrong side/missing). Now the
//    canonicalized shape is kept only when it preserves the signed volume, else
//    the un-canonicalized shape is used. Kernel cpp-10 deployed+verified first.
const NAMING_VERSION = 45;  // matches NAMING_SCHEMA_VERSION in cad-kernel-cpp/src/main.cpp — bump together with kernel

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
/** Mirror of the frontend `formatEquationNumber` (cad-editor.component.ts) so
 * equation values render identically in `#{var}` text on both sides. */
function formatEquationNumber(n) {
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(3).replace(/\.?0+$/, '');
}

/** Build the `#{var}` resolver for a model's sketch text. Variables mirror the
 * frontend `textVariables` computed: part identity fields + resolved equation
 * globals. Unknown names are left verbatim. */
function buildTextResolver(model) {
  const vars = {};
  const part = model && model.part;
  if (part) {
    vars.partName = part.name || '';
    vars.partNumber = part.sku || part.manufacturerPN || part.name || '';
    // The revision being worked on: caller may attach the draft display rev
    // (`__partRevision`) — the rev a draft will release as — which leads the
    // part row's revision until release. Falls back to the part row's revision.
    vars.partRevision = (model.__partRevision != null && model.__partRevision !== '')
      ? String(model.__partRevision)
      : (part.revision || '');
    vars.manufacturerPN = part.manufacturerPN || '';
  }
  try {
    const { values } = resolveEquations(model.equations || { entries: {} });
    for (const [k, v] of Object.entries(values || {})) {
      if (k.includes('.')) continue;  // globals only — match the frontend filter
      vars[k] = Number.isFinite(v) ? formatEquationNumber(v) : '';
    }
  } catch {
    // Equation resolution errors already surface via applyEquationsToModel.
  }
  return (raw) => String(raw == null ? '' : raw).replace(/#\{([^}]+)\}/g, (full, name) => {
    const val = vars[String(name).trim()];
    return val === undefined ? full : val;
  });
}

// REQ 770/773/775 — resolve every cross-part on-edge constraint's source edge into
// THIS part's local frame. Prefers the injected resolver (live, assembly-driven —
// P2); otherwise falls back to the ref's cached snapshot (standalone regen). The
// snapshot stores the source edge as a polyline already in this part's frame.
// Returns Map<constraintId, { polyline, isStraight?, endpoints? }>.
function _buildExternalEdges(sketchDoc, externalRefResolver) {
  const out = new Map();
  for (const sketch of Object.values((sketchDoc && sketchDoc.sketches) || {})) {
    const constraints = (sketch && sketch.state && sketch.state.constraints) || [];
    for (const c of constraints) {
      if (c.type !== 'on-edge' || !c.externalRef || c.externalRef.scope !== 'cross-part') continue;
      let geo = null;
      if (typeof externalRefResolver === 'function') {
        try { geo = externalRefResolver(c.externalRef); } catch (e) { geo = null; }
      }
      if (!geo) {
        const cp = c.externalRef.cachedProjection;
        const e = cp && Array.isArray(cp.edges) && cp.edges[0];
        if (e && Array.isArray(e.polyline) && e.polyline.length >= 2) {
          geo = { polyline: e.polyline, isStraight: e.isStraight, endpoints: e.endpoints };
        }
      }
      if (geo) out.set(c.id, geo);
    }
  }
  return out;
}

async function regenerateModel(model, { kernelClient, db, onFeatureResult, rollbackBeforeIndex, includeBodyBreps, externalRefResolver, configurationId } = {}) {
  const client = kernelClient || cadKernelClient.getDefaultClient();
  const dbClient = db || global.db;
  // Naming-schema guard: DesignBRepCache rows are keyed by this module's
  // NAMING_VERSION constant, but the geometry actually comes from whatever
  // kernel binary is running. If a stale kernel (older NAMING_SCHEMA_VERSION)
  // serves a regen after a backend bump, its old-schema output gets cached
  // under the NEW version and poisons the cache for as long as the rows stay
  // warm (hits bump lastAccessedAt, defeating TTL eviction). Fail fast with an
  // actionable error instead. Tolerant by design: mocked clients (tests) and
  // down kernels skip the check — a down kernel fails on its first real call
  // anyway, and mocks don't report a numeric namingSchemaVersion.
  if (client) {
    try {
      const pong = await client.call('ping', {}, { timeoutMs: 4000 });
      const kernelNaming = pong && pong.namingSchemaVersion;
      if (typeof kernelNaming === 'number' && kernelNaming !== NAMING_VERSION) {
        throw new Error(`CAD kernel naming schema v${kernelNaming} does not match backend v${NAMING_VERSION} — restart/rebuild the cad-kernel container before regenerating (mismatched output would poison the BRep cache).`);
      }
    } catch (err) {
      if (/naming schema/.test(err.message)) throw err;
      // ping unavailable — proceed; real kernel calls surface their own errors.
    }
  }
  // Resolve any equations BEFORE we hash params / dispatch features.
  // Returns a new featureTree + sketchDoc with every drivable numeric
  // parameter overwritten with the resolved value, plus an array of
  // equation errors that we fold into the regen response. Hashing is
  // unchanged (it sees the resolved numbers) so cache invalidation is
  // automatic per-feature. Configuration overrides (variable values +
  // suppression) apply inside the same call — `configurationId` selects
  // one explicitly (assembly per-instance); default = the doc's active.
  const { featureTree, sketchDoc, equationErrors } = applyEquationsToModel(model, { configurationId });
  // Resolver for `#{var}` placeholders in sketch text (part number / revision
  // / equation globals). Mirrors the frontend `textVariables` computed so the
  // committed glyph geometry matches the editor preview. Stashed on the model
  // so the per-feature dispatchers can pass it to extractRegions. Per-regen,
  // not module-level, so concurrent regens of different models stay isolated.
  model.__textResolver = buildTextResolver(model);
  // Cross-part in-context references (REQ 770/773/775). Resolve each cross-part
  // on-edge constraint's source edge into THIS part's frame, ONCE per regen
  // (it depends on the resolver/snapshot, not on this part's own bodies):
  //   - `externalRefResolver` present (live, assembly-driven — P2): use it.
  //   - absent (standalone): fall back to the ref's cached snapshot.
  // The result feeds applyProjectionToSketchDoc as `externalEdges`.
  const externalEdges = _buildExternalEdges(sketchDoc, externalRefResolver);
  const emit = _safeCallback(onFeatureResult);
  // SolidWorks-style rollback bar. When set, features at index >=
  // rollbackBeforeIndex are skipped entirely — no kernel calls, no
  // cache lookups, no streaming emits. The frontend passes the bar
  // position so the kernel doesn't burn time computing features the
  // user has rolled back over.
  const rollbackCutoff = (typeof rollbackBeforeIndex === 'number' && rollbackBeforeIndex >= 0)
    ? rollbackBeforeIndex
    : null;

  const results = [];
  const errors = [];
  let danglingSketchIds = [];
  let sketchHostFaces = {};
  // Seed errors with any equation resolution failures so the user sees
  // cycles / parse errors in the regen response toast as well as in
  // the equations panel.
  if (Array.isArray(equationErrors) && equationErrors.length > 0) {
    for (const e of equationErrors) errors.push(e);
  }
  // CAD_DEBUG=1: dump every sketch in the doc up front. Useful when a
  // sketch isn't consumed by any feature yet (a work-in-progress
  // offset, etc.) so it doesn't show up in the per-feature dump below.
  if (process.env.CAD_DEBUG === '1' && sketchDoc && sketchDoc.sketches) {
    for (const [sid, sketch] of Object.entries(sketchDoc.sketches)) {
      if (!sketch || !sketch.state) continue;
      const ents = sketch.state.entities || [];
      const cons = sketch.state.constraints || [];
      console.log(`[cad-sketch-all] sketch=${sid}\n` + JSON.stringify({
        name: sketch.name,
        plane: sketch.plane,
        counts: {
          points: ents.filter(e => e.kind === 'point').length,
          lines: ents.filter(e => e.kind === 'line' && !e.construction).length,
          linesConstruction: ents.filter(e => e.kind === 'line' && e.construction).length,
          arcs: ents.filter(e => e.kind === 'arc' && !e.construction).length,
          circles: ents.filter(e => e.kind === 'circle' && !e.construction).length,
          constraints: cons.length,
        },
        entities: ents.map(e => {
          const base = { id: e.id, kind: e.kind, construction: !!e.construction };
          if (e.kind === 'point') return { ...base, x: e.x, y: e.y };
          if (e.kind === 'line') return { ...base, startId: e.startId, endId: e.endId };
          if (e.kind === 'circle') return { ...base, centerId: e.centerId, radius: e.radius };
          if (e.kind === 'arc') return { ...base, centerId: e.centerId, startId: e.startId, endId: e.endId, radius: e.radius, ccw: e.ccw };
          return base;
        }),
        constraints: cons.map(c => ({
          id: c.id, type: c.type,
          targets: c.targets.map(t => t.entityId),
          value: c.value,
          placement: c.placement,
          unit: c.unit,
          chainId: c.chainId,
          externalRef: c.externalRef,
        })),
      }, null, 2));
    }
  }
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

  // Multi-body state: each entry is one body in the part. Additive
  // features with merge=true fuse into the most-recent body; additive
  // features with merge=false create a NEW body. Cut features apply to
  // the most-recent body. Body id = the id of the FIRST feature that
  // created it (the "root"), so it stays stable across regens.
  /** @type {Array<{ id: string, brep: string, paramHash: string, faces: Array, topology: object }>} */
  const bodies = [];

  // Per-feature geometry snapshots: the affected body's BREP just before and
  // after each feature. Feature-mode patterns/mirrors read a seed's
  // before/after to derive the material it added/removed (see
  // _dispatchFeaturePattern). Captured one iteration late — at the TOP of the
  // next feature's turn `bodies` already reflects the previous feature's result
  // — plus once after the loop for the last feature.
  /** @type {Map<string, { bodyId: string|null, before: string, after: string }>} */
  const featureSnapshots = new Map();
  // Per-feature TOOL solid (the un-composed prism), for true feature patterns.
  /** @type {Map<string, { brep: string, type: string }>} */
  const featureTools = new Map();
  let _snapPrev = null; // { featureId, bodiesBefore: Map<id, brep> }
  const _captureSnapPrev = () => {
    if (_snapPrev) _captureFeatureSnapshot(_snapPrev.featureId, bodies, _snapPrev.bodiesBefore, featureSnapshots);
  };
  // Frozen projected 2D state per sketch, captured at the sketch's FIRST
  // consuming feature. A sketch's external (on-edge / projected) refs must
  // resolve at the sketch's position in history — NOT be re-evaluated against
  // newer geometry when a LATER feature reuses the same sketch. Edge topology
  // ids (`<body>/eN`) are positional and reshuffle as the body accumulates
  // features, so re-projecting a reused sketch at a later position can latch
  // onto a different physical edge and corrupt it. Freezing at first use keeps
  // every consumer seeing the same geometry. Keyed by sketchId → state.
  const _frozenSketchStates = new Map();

  for (let featureIdx = 0; featureIdx < featureTree.features.length; featureIdx++) {
    const feature = featureTree.features[featureIdx];
    // Record the PREVIOUS feature's after-state (bodies now holds its result),
    // then stash this feature's before-state for capture next turn.
    _captureSnapPrev();
    _snapPrev = { featureId: feature.id, bodiesBefore: new Map(bodies.map(b => [b.id, b.brep])) };
    if (feature.type === 'origin') continue;
    // REQ 610: suppression is the only regen-exclusion mechanism for solid
    // features. Legacy docs (and old commits) may still carry visible:false
    // on solid features from the era when hide skipped regen — treat those
    // exactly as suppressed so historical geometry reproduces. Datum kinds
    // keep visible as a render-only toggle (they produce no solid geometry,
    // so skipping them here just hides the datum in the viewer).
    const isDatumKind = feature.type === 'datumPlane' || feature.type === 'datumAxis' || feature.type === 'datumPoint';
    if (feature.suppressed === true || (!isDatumKind && feature.visible === false)) {
      console.log(`[cadRegen] skipping ${feature.id} (suppressed)`);
      continue;
    }
    if (isDatumKind && feature.visible === false) {
      console.log(`[cadRegen] skipping ${feature.id} (hidden datum)`);
      continue;
    }
    if (rollbackCutoff !== null && featureIdx >= rollbackCutoff) {
      console.log(`[cadRegen] skipping ${feature.id} (past rollback bar at index ${rollbackCutoff})`);
      continue;
    }
    const supportedTypes = ['extrude', 'cutExtrude', 'revolve', 'cutRevolve', 'sweep', 'cutSweep', 'loft', 'fillet', 'chamfer', 'datumPlane', 'datumAxis', 'datumPoint', 'mirror', 'linearPattern', 'circularPattern', 'shell', 'combine', 'hole', 'mirrorBody', 'moveCopyBody'];
    if (!supportedTypes.includes(feature.type)) {
      errors.push(`feature ${feature.id}: unsupported type '${feature.type}'`);
      continue;
    }
    // Datum planes (REQ 657) are pure frontend reference geometry — no
    // kernel call, no BRep, no body change. Skip past the prism /
    // edge-blend dispatchers entirely. The frontend computes the
    // resulting Plane3 and folds it into `geometry.datums`.
    if (feature.type === 'datumPlane' || feature.type === 'datumAxis' || feature.type === 'datumPoint') {
      // REQ 657 / 660 / 661 — pure frontend reference geometry. No
      // kernel call, no BRep, no body change. The frontend computes
      // the resolved geometry (Plane3 / Axis3 / point) and folds it
      // into `geometry.datums`.
      continue;
    }

    // Edge-blend features (fillet / chamfer) take an existing body and
    // modify it in place — no separate prism + compose stage. Handle
    // them on their own dispatch path before the prism-based features.
    if (feature.type === 'fillet' || feature.type === 'chamfer') {
      try {
        await _dispatchEdgeBlend(feature, bodies, model, client, dbClient, results, emit, vertexMap, faceMap);
      } catch (err) {
        console.error(`[cadRegen] ${feature.id} edge blend failed:`, err);
        const result = {
          featureId: feature.id,
          bodyId: null,
          faces: [],
          topology: { vertices: [], edges: [] },
          error: err.message || String(err),
          cached: false,
        };
        errors.push(`feature ${feature.id}: ${err.message || String(err)}`);
        results.push(result);
        emit(result);
      }
      continue;
    }

    // Shell feature — hollow the most-recent body by removing picked
    // faces and offsetting the rest. Like fillet/chamfer it bypasses
    // the prism + compose path and modifies the body in-place.
    if (feature.type === 'shell') {
      try {
        await _dispatchShell(feature, bodies, model, client, dbClient, results, emit, vertexMap, faceMap);
      } catch (err) {
        console.error(`[cadRegen] ${feature.id} shell failed:`, err);
        const result = {
          featureId: feature.id,
          bodyId: null,
          faces: [],
          topology: { vertices: [], edges: [] },
          error: err.message || String(err),
          cached: false,
        };
        errors.push(`feature ${feature.id}: ${err.message || String(err)}`);
        results.push(result);
        emit(result);
      }
      continue;
    }

    // Combine feature (REQ 662) — boolean op between existing bodies.
    if (feature.type === 'combine') {
      try {
        await _dispatchCombine(feature, bodies, model, client, dbClient, results, emit, vertexMap, faceMap);
      } catch (err) {
        console.error(`[cadRegen] ${feature.id} combine failed:`, err);
        const result = {
          featureId: feature.id, bodyId: null, faces: [], topology: { vertices: [], edges: [] },
          error: err.message || String(err), cached: false,
        };
        errors.push(`feature ${feature.id}: ${err.message || String(err)}`);
        results.push(result);
        emit(result);
      }
      continue;
    }

    // Mirror Body (REQ 666) — reflect selected bodies across a plane.
    if (feature.type === 'mirrorBody') {
      try {
        await _dispatchMirrorBody(feature, bodies, model, client, dbClient, results, emit, vertexMap, faceMap);
      } catch (err) {
        console.error(`[cadRegen] ${feature.id} mirrorBody failed:`, err);
        const result = {
          featureId: feature.id, bodyId: null, faces: [], topology: { vertices: [], edges: [] },
          error: err.message || String(err), cached: false,
        };
        errors.push(`feature ${feature.id}: ${err.message || String(err)}`);
        results.push(result);
        emit(result);
      }
      continue;
    }

    // Move/Copy Body (REQ 667) — translate + rotate selected bodies.
    if (feature.type === 'moveCopyBody') {
      try {
        await _dispatchMoveCopyBody(feature, bodies, model, client, dbClient, results, emit, vertexMap, faceMap);
      } catch (err) {
        console.error(`[cadRegen] ${feature.id} moveCopyBody failed:`, err);
        const result = {
          featureId: feature.id, bodyId: null, faces: [], topology: { vertices: [], edges: [] },
          error: err.message || String(err), cached: false,
        };
        errors.push(`feature ${feature.id}: ${err.message || String(err)}`);
        results.push(result);
        emit(result);
      }
      continue;
    }

    // Hole Wizard feature (REQ 663) — drill / cbore / csk / tapped
    // at every placement captured by clicking a face in the viewer.
    if (feature.type === 'hole') {
      try {
        await _dispatchHole(feature, bodies, model, client, dbClient, results, emit, vertexMap, faceMap);
      } catch (err) {
        console.error(`[cadRegen] ${feature.id} hole failed:`, err);
        const result = {
          featureId: feature.id, bodyId: null, faces: [], topology: { vertices: [], edges: [] },
          error: err.message || String(err), cached: false,
        };
        errors.push(`feature ${feature.id}: ${err.message || String(err)}`);
        results.push(result);
        emit(result);
      }
      continue;
    }

    // Pattern features (mirror / linearPattern / circularPattern) take the
    // most-recent body and emit a new body that is the source fused with
    // its transformed copies. Like edge blends, they bypass the prism +
    // compose path.
    if (feature.type === 'mirror' || feature.type === 'linearPattern' || feature.type === 'circularPattern') {
      try {
        if (feature.seedKind === 'features') {
          await _dispatchFeaturePattern(feature, bodies, model, client, dbClient, results, emit, vertexMap, faceMap, featureSnapshots, featureTools);
        } else {
          await _dispatchPattern(feature, bodies, model, client, dbClient, results, emit, vertexMap, faceMap);
        }
      } catch (err) {
        console.error(`[cadRegen] ${feature.id} pattern failed:`, err);
        const result = {
          featureId: feature.id,
          bodyId: null,
          faces: [],
          topology: { vertices: [], edges: [] },
          error: err.message || String(err),
          cached: false,
        };
        errors.push(`feature ${feature.id}: ${err.message || String(err)}`);
        results.push(result);
        emit(result);
      }
      continue;
    }

    let result;
    try {
      console.log(`[cadRegen] dispatching feature ${feature.id} type=${feature.type}`);
      // Convert Entities live link: re-project every projected sketch
      // entity against the bodies built so far. Downstream features
      // therefore see source-edge-tracked coordinates rather than
      // whatever was persisted on disk. Per-iteration (cheap; sketches
      // with no projections pass through by reference).
      let projectedSketchDoc = applyProjectionToSketchDoc(sketchDoc, bodies, { externalEdges });
      // Freeze the consumed sketch's projected 2D state at its FIRST consumer
      // (see _frozenSketchStates above). Later features reusing the same sketch
      // get the frozen state, so an external ref isn't re-evaluated against
      // newer geometry than existed when the sketch was created/first used.
      // Only the 2D entity state is frozen — host-face PLANE tracking below
      // still runs live so a sketch on a moving face follows it.
      if (feature.sketchId && projectedSketchDoc.sketches[feature.sketchId]) {
        const frozen = _frozenSketchStates.get(feature.sketchId);
        if (frozen) {
          projectedSketchDoc = {
            ...projectedSketchDoc,
            sketches: {
              ...projectedSketchDoc.sketches,
              [feature.sketchId]: { ...projectedSketchDoc.sketches[feature.sketchId], state: frozen },
            },
          };
        } else {
          _frozenSketchStates.set(feature.sketchId, projectedSketchDoc.sketches[feature.sketchId].state);
        }
      }
      // Face-hosted sketch tracking: a sketch placed on an upstream feature's
      // face (hostId 'face:<persistentFaceId>') must follow that face when the
      // upstream feature changes shape — e.g. raising an extrude's height moves
      // its cap-top, and a sketch on it should ride along. We only persist the
      // plane at creation time, so re-derive it here from the host face's
      // CURRENT geometry (faceMap, populated as prior features regenerated).
      // Datum-hosted sketches keep their fixed plane. Clone on change only —
      // applyProjectionToSketchDoc may return the stored doc by reference.
      const resolvedSketchDoc = _applyHostFacePlanes(projectedSketchDoc, faceMap);
      // Detailed sketch dump for CAD_DEBUG=1. Logs the resolved
      // sketch state the kernel will see — entities (kind, id,
      // coords), constraints (type, targets, values, on-edge
      // externalRef), plane, before/after re-projection. Helps
      // diagnose "cut produced wrong geometry" by surfacing exactly
      // what coords landed at regen time.
      if (process.env.CAD_DEBUG === '1' && feature.sketchId) {
        _dumpSketchForDebug(feature, sketchDoc, resolvedSketchDoc);
      }
      // Stage 1: build the per-feature shape (a prism for Extrude / Cut,
      // a body of revolution for Revolve / Cut Revolve, a swept solid for
      // Sweep / Cut Sweep). The cut/additive distinction only matters at
      // the compose stage — the kernel call is the same for both.
      let prism;
      if (feature.type === 'revolve' || feature.type === 'cutRevolve') {
        prism = await _regenerateRevolve(feature, resolvedSketchDoc, model, client, dbClient);
      } else if (feature.type === 'sweep' || feature.type === 'cutSweep') {
        prism = await _regenerateSweep(feature, resolvedSketchDoc, model, client, dbClient);
      } else if (feature.type === 'loft') {
        prism = await _regenerateLoft(feature, resolvedSketchDoc, model, client, dbClient);
      } else {
        prism = await _regenerateExtrude(feature, resolvedSketchDoc, model, client, dbClient, vertexMap, faceMap, bodies);
      }
      // Stash this feature's TOOL solid (the un-composed prism/revolve/sweep/
      // loft) so a downstream feature-mode pattern/mirror with this as a seed
      // can re-run the real boolean at each instance (true feature pattern),
      // instead of copying a geometry delta. REQ 822 (hybrid).
      if (prism && prism.prismBrep) featureTools.set(feature.id, { brep: prism.prismBrep, type: feature.type });
      // Surface any non-fatal per-region skips (e.g. a region the kernel
      // couldn't build) as warnings without failing the feature.
      if (prism && Array.isArray(prism.warnings) && prism.warnings.length) {
        for (const w of prism.warnings) errors.push(`feature ${feature.id}: ${w}`);
      }

      // Stage 2: figure out which bodies this feature targets and compose.
      const isAdditive = feature.type === 'extrude' || feature.type === 'revolve' || feature.type === 'sweep' || feature.type === 'loft';
      const isCut = feature.type === 'cutExtrude' || feature.type === 'cutRevolve' || feature.type === 'cutSweep';
      const wantsMerge = feature.merge !== false;  // default true

      // Multi-body seed: an additive feature that is NOT merging into an
      // existing body and has multiple regions seeds new bodies. With Merge
      // result ON, the regions were fused and we seed one body per RESULTING
      // SOLID — touching regions (e.g. a boundary-with-holes plus its plug
      // regions) merge into one body; genuinely disjoint regions (extruded
      // letters) stay separate, exactly like SolidWorks/Onshape. With merge
      // OFF (or when the fuse decomposition is unavailable), each region
      // seeds its own body. Merging into an existing body, cuts, and
      // single-region extrudes fall through to the normal compose below.
      const seedingNewBody = isAdditive && (bodies.length === 0 || !wantsMerge);
      if (seedingNewBody && Array.isArray(prism.regions) && prism.regions.length > 1) {
        const useFused = wantsMerge && Array.isArray(prism.fusedSolids) && prism.fusedSolids.length > 0;
        // Largest solid keeps the feature id (same "primary" convention as
        // the cut-split path) so body identity is stable across regens.
        const seedSolids = useFused
          ? [...prism.fusedSolids].sort((a, b) => (b.volume || 0) - (a.volume || 0))
          : null;
        const seeds = useFused
          ? seedSolids.map((s, k) => ({
              brep: s.brepBytes,
              faces: s.faces || [],
              topology: s.topology || { vertices: [], edges: [] },
              paramHash: _hashParams({ feature: prism.featureParamHash, solid: k }),
              cached: prism.cached,
            }))
          : prism.regions;
        console.log(`[cadRegen] ${feature.id} SEED ${seeds.length} bodies (one per ${useFused ? 'fused solid' : 'region'})`);
        for (let k = 0; k < seeds.length; k++) {
          const rg = seeds[k];
          // Body 0 keeps the feature id (stable identity for the "primary"
          // body); extra seeds get suffixed ids so topology/face maps stay
          // unique across bodies.
          const bodyId = k === 0 ? feature.id : `${feature.id}#body${k}`;
          const body = {
            id: bodyId,
            brep: rg.brep,
            paramHash: rg.paramHash,
            faces: _scopeFaceBoundaryEdges(rg.faces, bodyId),
            topology: _scopeTopology(rg.topology, bodyId),
          };
          body.centroid = _approxCentroidFromFaces(body.faces);
          bodies.push(body);
          for (const v of body.topology.vertices || []) vertexMap.set(v.id, v.position);
          for (const f of body.faces || []) {
            const plane = _faceRepresentativePlane(f);
            if (plane) faceMap.set(f.faceId, plane);
          }
          const seedResult = {
            featureId: feature.id,
            bodyId: body.id,
            faces: body.faces,
            topology: body.topology,
            cached: rg.cached,
            bodyParamHash: body.paramHash,
          };
          results.push(seedResult);
          emit(seedResult);
        }
        continue;
      }

      // SolidWorks Feature Scope: cuts default to "All bodies" — each
      // body that the cutting prism intersects gets material removed;
      // bodies it doesn't intersect come back unchanged. Additive
      // features still target a single body (the most recent for merge,
      // or a freshly-seeded one for !merge / first-feature).
      let targetBodies = [];
      if (isCut) {
        if (bodies.length === 0) {
          throw new Error('Cut feature needs an existing body to cut from. Add an additive Extrude, Revolve, or Sweep first.');
        }
        targetBodies = [...bodies];  // snapshot — split-off bodies created during the loop won't get re-cut
        console.log(`[cadRegen] ${feature.id} CUT all bodies (${targetBodies.length})`);
      } else if (isAdditive) {
        let targetBodyIndex;
        if (bodies.length === 0 || !wantsMerge) {
          console.log(`[cadRegen] ${feature.id} SEED new body (bodies.length=${bodies.length}, merge=${feature.merge}, wantsMerge=${wantsMerge})`);
          targetBodyIndex = bodies.length;
          bodies.push({ id: feature.id, brep: '', paramHash: '', faces: [], topology: { vertices: [], edges: [] } });
        } else {
          console.log(`[cadRegen] ${feature.id} MERGE into body ${bodies[bodies.length - 1].id} (merge=${feature.merge}, bodies.length=${bodies.length})`);
          targetBodyIndex = bodies.length - 1;
        }
        targetBodies = [bodies[targetBodyIndex]];
      }

      // Process each target body. Inner function so we can call it once
      // per body for cuts and emit per-body streaming events.
      let allCachedAcrossBodies = true;
      let anyBodyProcessed = false;
      const processBody = async (body) => {
        const currentIdx = bodies.indexOf(body);
        if (currentIdx === -1) return;  // body was removed by an earlier iteration
        anyBodyProcessed = true;
      let allCached;
      if (body.brep === '') {
        // Seed: this is the FIRST feature contributing to this body.
        // The prism IS the body so far — no boolean call needed.
        body.brep = prism.prismBrep;
        body.paramHash = prism.featureParamHash;
        // prism.merged carries the per-region scope on boundaryEdgeIds
        // (`f5#0/e0`); body.topology re-scopes with body.id producing
        // `f5/f5#0/e0`. Re-scope the face boundaries the same way so
        // the IDs line up across the two structures.
        body.faces = _scopeFaceBoundaryEdges(prism.merged, body.id);
        // Scope per-body topology IDs by the body's id so the frontend's
        // edge-id keyed Map doesn't collide between bodies (collisions
        // cause stale Line objects to linger in the scene and stay
        // visible even when the owning body is hidden).
        body.topology = _scopeTopology(prism.topology, body.id);
        // Approximate centroid from vertex positions — used by later
        // compose ops to match result solids back to this body (so a
        // body's id sticks across a non-intersecting merge or a cut).
        // Vertex-average isn't the true center of mass, but it's a fine
        // proxy for identity matching and dirt cheap to compute here
        // vs an extra kernel round-trip.
        body.centroid = _approxCentroidFromFaces(body.faces);
        allCached = prism.cached;
        // Index + emit single-body result.
        for (const v of body.topology.vertices || []) vertexMap.set(v.id, v.position);
        for (const f of body.faces || []) {
          const plane = _faceRepresentativePlane(f);
          if (plane) faceMap.set(f.faceId, plane);
        }
        result = {
          featureId: feature.id,
          bodyId: body.id,
          faces: body.faces,
          topology: body.topology,
          cached: allCached,
          // Per-body paramHash so the frontend can suppress redundant
          // perBodyGeometry updates when an event echoes the same body
          // state it already has (e.g. cache-hit regen).
          bodyParamHash: body.paramHash,
        };
      } else {
        // Compose this feature into the existing body. SolidWorks-style
        // body tracking: if the op physically splits the body (cut
        // through the middle), composed.solids has >1 entry. The largest
        // piece keeps the body's id; smaller pieces get new ids
        // `${feature.id}#splitN` and are appended to the bodies array.
        // If the op annihilates the body (cut produces empty volume),
        // composed.solids is empty and we remove the body.
        // Snapshot the body's identity BEFORE the op so we can match
        // result solids back to "the same body" (preserving its id) vs.
        // identifying which are new pieces from this feature.
        const oldCentroid = body.centroid || null;
        const composed = await _composeIntoBody({
          feature,
          prism,
          body,
          model,
          client,
          dbClient,
        });
        allCached = prism.cached && composed.cached;
        const allSolids = composed.solids || [];
        console.log(`[cadRegen] ${feature.id} compose result: ${allSolids.length} solid(s), cached=${composed.cached}`);
        for (let _i = 0; _i < allSolids.length; _i++) {
          const _s = allSolids[_i];
          console.log(`  solid[${_i}]: centroid=${JSON.stringify(_s.centroid)} volume=${_s.volume}`);
        }

        if (allSolids.length === 0) {
          // For ADDITIVE features, "no solids" should never happen — fuse
          // can't annihilate a body. If composed.solids is empty here it
          // means the cache row predates the solids-decompose schema; fall
          // back to the whole-shape brep/faces/topology so we still get
          // a valid body even without the per-solid breakdown.
          if (isAdditive) {
            console.warn(`[cadRegen] ${feature.id} compose returned 0 solids on additive op — falling back to whole-shape`);
            body.brep = composed.brep;
            body.paramHash = composed.paramHash;
            body.faces = _scopeFaceBoundaryEdges(composed.faces || [], body.id);
            body.topology = _scopeTopology(composed.topology || { vertices: [], edges: [] }, body.id);
            body.centroid = _approxCentroidFromFaces(body.faces);
            for (const v of body.topology.vertices || []) vertexMap.set(v.id, v.position);
            for (const f of body.faces || []) {
              const plane = _faceRepresentativePlane(f);
              if (plane) faceMap.set(f.faceId, plane);
            }
            result = {
              featureId: feature.id,
              bodyId: body.id,
              faces: body.faces,
              topology: body.topology,
              cached: allCached,
              bodyParamHash: body.paramHash,
            };
            results.push(result);
            emit(result);
            allCachedAcrossBodies = allCachedAcrossBodies && allCached;
            return;
          }
          // Cut produced empty volume — body annihilated.
          bodies.splice(currentIdx, 1);
          result = {
            featureId: feature.id,
            bodyId: body.id,
            faces: [],
            topology: { vertices: [], edges: [] },
            cached: allCached,
            bodyDeleted: true,
            bodyParamHash: body.paramHash,
          };
          results.push(result);
          emit(result);
          allCachedAcrossBodies = allCachedAcrossBodies && allCached;
          return;
        }

        // Identity matching: pick the result solid whose centroid is
        // closest to the OLD body's centroid as the "primary." That
        // solid is the continuation of the existing body (whether it
        // grew via fuse or shrank via cut); other solids are new pieces
        // produced by this feature. Fallback to largest-volume when we
        // don't have an old centroid (first compose on a fresh body).
        let primaryIdx = 0;
        if (oldCentroid && allSolids.length > 1) {
          let bestDist = Infinity;
          for (let i = 0; i < allSolids.length; i++) {
            const c = allSolids[i].centroid;
            if (!c) continue;
            const dx = c[0] - oldCentroid[0];
            const dy = c[1] - oldCentroid[1];
            const dz = c[2] - oldCentroid[2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < bestDist) { bestDist = d2; primaryIdx = i; }
          }
        } else if (allSolids.length > 1) {
          // Volume fallback when no prior centroid (e.g. first compose).
          let bestVol = -Infinity;
          for (let i = 0; i < allSolids.length; i++) {
            const v = allSolids[i].volume || 0;
            if (v > bestVol) { bestVol = v; primaryIdx = i; }
          }
        }
        const primary = allSolids[primaryIdx];
        body.brep = primary.brepBytes;
        body.paramHash = composed.paramHash;
        body.faces = _scopeFaceBoundaryEdges(primary.faces || [], body.id);
        body.topology = _scopeTopology(primary.topology || { vertices: [], edges: [] }, body.id);
        body.centroid = primary.centroid
          ? [primary.centroid[0], primary.centroid[1], primary.centroid[2]]
          : _approxCentroidFromFaces(body.faces);
        for (const v of body.topology.vertices || []) vertexMap.set(v.id, v.position);
        for (const f of body.faces || []) {
          const plane = _faceRepresentativePlane(f);
          if (plane) faceMap.set(f.faceId, plane);
        }
        result = {
          featureId: feature.id,
          bodyId: body.id,
          faces: body.faces,
          topology: body.topology,
          cached: allCached,
          bodyParamHash: body.paramHash,
        };
        results.push(result);
        emit(result);

        // Remaining solids = new bodies. Naming convention mirrors
        // SolidWorks: a cut that physically severs a body emits "splits"
        // (named after the parent body), while an additive op that
        // produces a disjoint piece emits a NEW body named after the
        // producing feature (since the piece is this feature's material,
        // not a fragment of an older body).
        let pieceCounter = 0;
        for (let i = 0; i < allSolids.length; i++) {
          if (i === primaryIdx) continue;
          const piece = allSolids[i];
          pieceCounter++;
          const newId = isCut
            ? `${body.id}#split${pieceCounter}`
            : (pieceCounter === 1 ? feature.id : `${feature.id}#piece${pieceCounter}`);
          const newBody = {
            id: newId,
            brep: piece.brepBytes,
            paramHash: composed.paramHash,
            faces: piece.faces || [],
            topology: _scopeTopology(piece.topology || { vertices: [], edges: [] }, newId),
            centroid: piece.centroid
              ? [piece.centroid[0], piece.centroid[1], piece.centroid[2]]
              : null,
          };
          bodies.push(newBody);
          for (const v of newBody.topology.vertices || []) vertexMap.set(v.id, v.position);
          for (const f of newBody.faces || []) {
            const plane = _faceRepresentativePlane(f);
            if (plane) faceMap.set(f.faceId, plane);
          }
          const pieceResult = {
            featureId: feature.id,
            bodyId: newBody.id,
            faces: newBody.faces,
            topology: newBody.topology,
            cached: allCached,
            bodyParamHash: newBody.paramHash,
          };
          results.push(pieceResult);
          emit(pieceResult);
        }
        allCachedAcrossBodies = allCachedAcrossBodies && allCached;
        // Per-body emits already done above; nothing more to do for
        // this body. Return from the inner function (the loop below
        // moves on to the next target body).
        return;
      }
      // Seed path: emit + accumulate cached flag, then return.
      results.push(result);
      emit(result);
      allCachedAcrossBodies = allCachedAcrossBodies && allCached;
      };  // end of processBody

      for (const tb of targetBodies) {
        await processBody(tb);
      }

      // If the cut/merge produced no body changes at all (e.g. cut
      // didn't intersect anything), surface a single informational
      // record so the frontend still knows the feature ran.
      if (!anyBodyProcessed) {
        result = {
          featureId: feature.id,
          bodyId: null,
          faces: [],
          topology: { vertices: [], edges: [] },
          cached: allCachedAcrossBodies,
        };
        results.push(result);
        emit(result);
      }
      // Per-body emits handled inside the loop — skip the bottom emit.
      continue;
    } catch (err) {
      result = {
        featureId: feature.id,
        bodyId: null,
        faces: [],
        topology: { vertices: [], edges: [] },
        error: err.message,
        cached: false,
      };
      errors.push(`feature ${feature.id}: ${err.message}`);
      results.push(result);
      emit(result);
    }
  }
  // Capture the LAST feature's after-snapshot now the loop is done.
  _captureSnapPrev();

  // Dangling host-face check: a face-hosted sketch whose reference face no
  // longer exists (its creating feature was deleted/changed) silently falls
  // back to a nearby/baked plane in _resolveHostFacePlane. Surface that as a
  // warning so the user re-picks the reference instead of getting a quietly
  // misplaced sketch. Only USED sketches (referenced by a live feature) warn.
  {
    const usedSketchIds = new Set();
    for (const f of featureTree.features) {
      if (!f) continue;
      // Skip features regen skipped: suppressed, or legacy hidden (REQ 610 —
      // visible:false on a solid feature is legacy suppression).
      const datumKind = f.type === 'datumPlane' || f.type === 'datumAxis' || f.type === 'datumPoint';
      if (f.suppressed === true || (!datumKind && f.visible === false)) continue;
      if (f.sketchId) usedSketchIds.add(f.sketchId);
      if (f.profileSketchId) usedSketchIds.add(f.profileSketchId);
      if (f.pathSketchId) usedSketchIds.add(f.pathSketchId);
      if (Array.isArray(f.sketchIds)) for (const sid of f.sketchIds) usedSketchIds.add(sid);
    }
    const dangling = _danglingHostFaceWarnings(sketchDoc, faceMap, usedSketchIds);
    for (const w of dangling.warnings) errors.push(w);
    danglingSketchIds = dangling.sketchIds;
    sketchHostFaces = dangling.resolved;
  }

  // Exact OCCT volume per body. The editor footer shows this instead of
  // integrating the tessellated mesh (the chord approximation of curved
  // faces under-counts the true volume). Computed from each body's FINAL
  // BRep so it's uniform across every op (extrude / boolean / shell / …)
  // and cache-agnostic. Non-fatal: a failure just leaves volume undefined,
  // and the frontend omits that body from the total (no mesh fallback).
  if (client) {
    for (const b of bodies) {
      if (!b.brep) continue;
      try {
        const mp = await client.call('bodyVolume', {
          aBrep: Buffer.isBuffer(b.brep) ? b.brep.toString('base64') : b.brep,
        });
        if (mp && Number.isFinite(mp.volume)) b.volume = mp.volume;
      } catch (err) {
        console.warn(`[cadRegen] bodyVolume failed for ${b.id}: ${err.message || err}`);
      }
    }
  }

  // Kernel build marker — surfaced in the editor footer next to the frontend's
  // text-NN marker so the running kernel binary can be confirmed after a
  // rebuild. Best-effort + cheap; never fails the regen.
  let kernelBuild = null;
  if (client) {
    try {
      const pong = await client.call('ping');
      if (pong && typeof pong.build === 'string') kernelBuild = pong.build;
    } catch { /* non-fatal */ }
  }

  // Emit the body roster so the frontend can list them in the Bodies
  // panel. Order = creation order (= regen order of root features).
  // `brep` (base64) only included when requested (e.g. STEP export) — it's
  // large and the normal regen response doesn't need it.
  const bodyList = bodies.map(b => (
    includeBodyBreps
      ? { id: b.id, name: null, brep: b.brep, volume: b.volume }
      : { id: b.id, name: null, volume: b.volume }
  ));

  return { features: results, errors, bodies: bodyList, kernelBuild, danglingSketchIds, sketchHostFaces };
}

/** Regenerate the model and export its bodies as a single STEP file (text).
 * Reuses the regen (cache-backed) to obtain the final composed body BReps,
 * then calls the kernel `exportStep` RPC to combine + serialize them. */
/** Serialize a set of body BReps to a CAD file via the kernel. `format` is
 * 'step' (returns { step } text) or 'stl' (returns { stlBase64 } binary). Used
 * by both the live exporters and the frozen-release exporters (controller). */
async function exportBodyBreps(breps, format, { kernelClient } = {}) {
  const client = kernelClient || cadKernelClient.getDefaultClient();
  if (!Array.isArray(breps) || breps.length === 0) {
    throw new Error('No matching body geometry to export.');
  }
  if (format === 'stl') {
    const rpc = await client.call('exportStl', { breps });
    return { stlBase64: rpc.stlBase64 || rpc.stl_base64 || rpc.stl, bodyCount: breps.length };
  }
  const rpc = await client.call('exportStep', { breps });
  return { step: rpc.step, bodyCount: breps.length };
}

async function exportModelStep(model, { kernelClient, db, bodyIds } = {}) {
  const client = kernelClient || cadKernelClient.getDefaultClient();
  const regen = await regenerateModel(model, { kernelClient: client, db, includeBodyBreps: true });
  let bodies = (regen.bodies || []).filter(b => b.brep);
  if (Array.isArray(bodyIds) && bodyIds.length > 0) {
    const want = new Set(bodyIds);
    bodies = bodies.filter(b => want.has(b.id));
  }
  const out = await exportBodyBreps(bodies.map(b => b.brep), 'step', { kernelClient: client });
  return { ...out, errors: regen.errors };
}

async function exportModelStl(model, { kernelClient, db, bodyIds } = {}) {
  const client = kernelClient || cadKernelClient.getDefaultClient();
  const regen = await regenerateModel(model, { kernelClient: client, db, includeBodyBreps: true });
  let bodies = (regen.bodies || []).filter(b => b.brep);
  if (Array.isArray(bodyIds) && bodyIds.length > 0) {
    const want = new Set(bodyIds);
    bodies = bodies.filter(b => want.has(b.id));
  }
  const out = await exportBodyBreps(bodies.map(b => b.brep), 'stl', { kernelClient: client });
  return { ...out, errors: regen.errors };
}

function _safeCallback(fn) {
  if (typeof fn !== 'function') return () => {};
  return (arg) => {
    try { fn(arg); }
    catch (e) { console.error('[cadRegenService] onFeatureResult callback threw:', e); }
  };
}

/** Dump the full sketch state the kernel will see when processing
 * `feature`, gated on CAD_DEBUG=1. Emits a single JSON block so the
 * user can grep [cad-sketch] and copy-paste cleanly. Shows points
 * + curve entities (incl. construction flag), constraints (with
 * on-edge externalRef + chainId + value + placement), the sketch
 * plane, AND the BEFORE → AFTER point-coord deltas after re-
 * projection so the projection step's effect is auditable. Helpful
 * for diagnosing "cut produced wrong geometry" by surfacing the
 * exact inputs to extractRegions + the kernel call. */
function _dumpSketchForDebug(feature, sketchDocBefore, sketchDocAfter) {
  const sid = feature.sketchId;
  if (!sid) return;
  const before = sketchDocBefore && sketchDocBefore.sketches && sketchDocBefore.sketches[sid];
  const after = sketchDocAfter && sketchDocAfter.sketches && sketchDocAfter.sketches[sid];
  if (!after) {
    console.log(`[cad-sketch] feature=${feature.id} sketch=${sid} — sketch missing from doc`);
    return;
  }
  const beforeEntities = (before && before.state && before.state.entities) || [];
  const afterEntities = (after.state && after.state.entities) || [];
  const beforeById = new Map(beforeEntities.filter(e => e.kind === 'point').map(e => [e.id, e]));
  const pointMoves = [];
  for (const e of afterEntities) {
    if (e.kind !== 'point') continue;
    const b = beforeById.get(e.id);
    if (!b) { pointMoves.push({ id: e.id, before: null, after: { x: e.x, y: e.y } }); continue; }
    if (Math.abs(b.x - e.x) > 1e-9 || Math.abs(b.y - e.y) > 1e-9) {
      pointMoves.push({ id: e.id, before: { x: b.x, y: b.y }, after: { x: e.x, y: e.y } });
    }
  }
  const summary = {
    feature: {
      id: feature.id,
      type: feature.type,
      sketchId: sid,
      distance: feature.distance,
      flipped: feature.flipped,
      regionIndices: feature.regionIndices,
      loopIndices: feature.loopIndices,
      endCondition: feature.endCondition,
      startCondition: feature.startCondition,
      direction2: feature.direction2,
      merge: feature.merge,
      suppressed: feature.suppressed,
      visible: feature.visible,
      name: feature.name,
    },
    plane: after.plane || null,
    counts: {
      points: afterEntities.filter(e => e.kind === 'point').length,
      lines: afterEntities.filter(e => e.kind === 'line' && !e.construction).length,
      linesConstruction: afterEntities.filter(e => e.kind === 'line' && e.construction).length,
      arcs: afterEntities.filter(e => e.kind === 'arc' && !e.construction).length,
      circles: afterEntities.filter(e => e.kind === 'circle' && !e.construction).length,
      constraints: ((after.state && after.state.constraints) || []).length,
    },
    entities: afterEntities.map(e => {
      const base = { id: e.id, kind: e.kind, construction: !!e.construction };
      if (e.kind === 'point') return { ...base, x: e.x, y: e.y };
      if (e.kind === 'line') return { ...base, startId: e.startId, endId: e.endId };
      if (e.kind === 'circle') return { ...base, centerId: e.centerId, radius: e.radius };
      if (e.kind === 'arc') return { ...base, centerId: e.centerId, startId: e.startId, endId: e.endId, radius: e.radius, ccw: e.ccw };
      return base;
    }),
    constraints: ((after.state && after.state.constraints) || []).map(c => ({
      id: c.id, type: c.type,
      targets: c.targets.map(t => t.entityId),
      value: c.value,
      placement: c.placement,
      driven: c.driven,
      unit: c.unit,
      chainId: c.chainId,
      externalRef: c.externalRef,
    })),
    reprojectionMoves: pointMoves,
  };
  // Run the same region extractor the kernel will use so we can see
  // EXACTLY what profile is being passed to the cut/extrude. Includes
  // outer loops + holes — counts and bounding-box per region so we can
  // tell at a glance whether the cut prism overlaps the body.
  try {
    const { regions, errors } = extractRegions(after.state || { entities: [], constraints: [] });
    summary.regions = regions.map((r, i) => {
      const allPts = [];
      const collect = (loop) => {
        for (const edge of loop) {
          if (edge.kind === 'line') { allPts.push(edge.start); allPts.push(edge.end); }
          else if (edge.kind === 'arc') { allPts.push(edge.start); allPts.push(edge.end); }
          else if (edge.kind === 'circle') {
            allPts.push({ x: edge.center.x - edge.radius, y: edge.center.y - edge.radius });
            allPts.push({ x: edge.center.x + edge.radius, y: edge.center.y + edge.radius });
          }
        }
      };
      collect(r.outer);
      for (const h of r.holes) collect(h);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of allPts) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      }
      return {
        index: i,
        outerEdges: r.outer.length,
        outerKinds: r.outer.map(e => e.kind),
        holes: r.holes.length,
        bbox: allPts.length ? { minX, minY, maxX, maxY } : null,
      };
    });
    summary.regionErrors = errors;
    summary.regionsUsed = feature.regionIndices || feature.loopIndices || [0];
  } catch (e) {
    summary.regionsError = (e && e.message) || String(e);
  }
  console.log(`[cad-sketch] feature=${feature.id}\n` + JSON.stringify(summary, null, 2));
}

async function _regenerateExtrude(feature, sketchDoc, model, client, dbClient, vertexMap, faceMap, bodies = []) {
  const sketch = sketchDoc.sketches[feature.sketchId];
  if (!sketch) throw new Error(`sketch ${feature.sketchId} not found in sketchDoc`);

  const { regions, errors: regionErrors } = extractRegions(sketch.state || { entities: [], constraints: [] }, model.__textResolver);
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
  // Per-region results (un-fused), so an additive extrude can seed one BODY
  // per disjoint region (e.g. one body per letter of extruded text) instead
  // of fusing them all into one. Each carries its own scoped faces/topology.
  const regionResults = [];
  // Per-region failures (out-of-range index, or a region the kernel can't
  // build — e.g. a pinched/self-touching arrangement face that BRepMesh
  // rejects) are isolated here: the bad region is skipped with a warning and
  // the remaining regions still build, instead of failing the whole feature
  // and cascading (broken body → "Up to" failures downstream → face-hosted
  // sketches reporting their host gone). Surfaced via the returned `warnings`.
  const regionWarnings = [];
  let allCached = true;

  const endCondition = feature.endCondition || { kind: 'blind' };

  // "Up To Body": resolve the target body by its STABLE id (resolved on the
  // frontend at pick time) so we can hand its BREP to the kernel, which
  // subtracts it and keeps the start-side piece (conforming end face). The
  // body must already exist at this point in the feature tree — features
  // process in order. Note the target may be the very body this feature merges
  // into (a rib growing up to a wall): that's fine, because at this point the
  // body holds only its UPSTREAM geometry, before this feature's contribution.
  const toBase64 = (brep) => (Buffer.isBuffer(brep) ? brep.toString('base64') : brep);
  let untilBrep = null;
  let untilBreps = null;
  let untilBodyKey = null;
  if (endCondition.kind === 'upToBody') {
    const bodyId = endCondition.bodyId;
    if (!bodyId) {
      throw new Error(
        'Up to Body: no target body selected (legacy reference). Re-open this feature and ' +
        're-pick the target body.'
      );
    }
    const targetBody = (bodies || []).find(b => b.id === bodyId);
    if (!targetBody || !targetBody.brep) {
      throw new Error(
        `Up to Body: target body '${bodyId}' is not available at this point in the feature ` +
        `tree. Pick a body that already exists before this feature — you can't terminate on a ` +
        `body this feature (or a later one) creates.`
      );
    }
    untilBrep = toBase64(targetBody.brep);
    // Cache key over the target's identity + geometry state so the extrude
    // re-runs when the body it lands on moves or changes shape.
    untilBodyKey = { id: targetBody.id, hash: targetBody.paramHash || '' };
  } else if (endCondition.kind === 'upToNext') {
    // "Up To Next": hand the kernel EVERY upstream body; it subtracts them all
    // and caps at whichever the profile reaches first. No body pick needed.
    const withBrep = (bodies || []).filter(b => b && b.brep);
    if (withBrep.length === 0) {
      throw new Error(
        'Up to Next: there is no existing body in the extrude path. Add a body first, or use a ' +
        'Blind / Through All end condition.'
      );
    }
    untilBreps = withBrep.map(b => toBase64(b.brep));
    // Cache key over all upstream bodies' identity + geometry state.
    untilBodyKey = { next: withBrep.map(b => ({ id: b.id, hash: b.paramHash || '' })) };
  }

  // When 2+ regions are selected, merge adjacent ones into a single combined
  // profile so the kernel extrudes one connected solid per group — separate
  // edge-touching prisms hang OCCT's fuse. This also lets a region whose Up-to
  // side is already solid contribute via Direction-2 with no standalone prism.
  // Single-region selections keep their original per-region scope (stable cache).
  let buildRegions = [];
  // Only MERGE profiles when the feature fuses (merge result ON). With merge
  // OFF each region must seed its OWN body (one-body-per-region), so we keep
  // them separate and let the per-region path below build a prism each.
  if (regionIndices.length > 1 && feature.merge !== false) {
    const merged = extractMergedRegions(
      sketch.state || { entities: [], constraints: [] }, regionIndices, model.__textResolver,
    );
    buildRegions = merged.regions.map((r, k) => ({ region: r, scopeKey: `m${k}` }));
  }
  if (buildRegions.length === 0) {
    for (const idx of regionIndices) {
      if (idx < 0 || idx >= regions.length) {
        regionWarnings.push(`region index ${idx} out of range (have ${regions.length}) — skipped`);
        continue;
      }
      buildRegions.push({ region: regions[idx], scopeKey: String(idx) });
    }
  }

  for (const { region, scopeKey } of buildRegions) {
    const ri = scopeKey;  // cache/scope key: original index, or `m<k>` for a merged group
    // Resolve end condition → concrete (plane, distance, flipped) kernel
    // inputs. Mid Plane / Through All translate at this layer so the
    // kernel keeps a single-distance API.
    const dispatch = _resolveEndConditionDispatch(endCondition, sketch.plane, feature, vertexMap, faceMap);
    // Start condition + direction 2 are passed through to the kernel
    // verbatim — the kernel translates the workplane by startOffset
    // and builds + fuses a second prism for direction 2.
    // For upToVertex/upToSurface, resolve the target to a signed
    // distance along the sketch normal — same idea as the end-condition
    // dispatcher, just for the start. Fallback plane on upToSurface
    // covers boolean-merge re-tagging.
    const startOffset = _resolveStartOffset(feature.startCondition, sketch.plane, vertexMap, faceMap);
    const direction2 = feature.direction2
      ? _resolveDirection2(feature.direction2, sketch.plane, feature, vertexMap, faceMap)
      : null;
    // Direction-2 "Up to Body" / "Up to Next": resolve the same target BREP(s)
    // the kernel uses to cap dir 1, so the dir-2 prism conforms to a real body
    // surface. upToBody → the picked body; upToNext → every upstream body. The
    // heavy base64 is attached AFTER the hash (mirroring dir 1): the cache key
    // uses the lightweight id+geometry-hash `dir2UntilKey` instead.
    let dir2UntilKey = null;
    let dir2UntilBrep = null;
    let dir2UntilBreps = null;
    if (direction2 && direction2.kind === 'upToBody') {
      const targetBody = (bodies || []).find(b => b.id === direction2.bodyId);
      if (!targetBody || !targetBody.brep) {
        throw new Error(
          `Direction 2 Up to Body: target body '${direction2.bodyId}' is not available at this ` +
          `point in the feature tree. Pick a body that already exists before this feature.`
        );
      }
      dir2UntilBrep = toBase64(targetBody.brep);
      dir2UntilKey = { id: targetBody.id, hash: targetBody.paramHash || '' };
    } else if (direction2 && direction2.kind === 'upToNext') {
      const withBrep = (bodies || []).filter(b => b && b.brep);
      if (withBrep.length === 0) {
        throw new Error(
          'Direction 2 Up to Next: there is no existing body in the extrude path. Add a body ' +
          'first, or use a Blind / Through All end condition for direction 2.'
        );
      }
      dir2UntilBreps = withBrep.map(b => toBase64(b.brep));
      dir2UntilKey = { next: withBrep.map(b => ({ id: b.id, hash: b.paramHash || '' })) };
    }
    if (direction2) delete direction2.bodyId;  // not a kernel field; identity is in dir2UntilKey
    const paramHash = _hashParams({
      profile: region.outer,
      holes: region.holes,
      plane: dispatch.plane,
      distance: dispatch.distance,
      flipped: dispatch.flipped,
      endKind: endCondition.kind,
      regionIndex: ri,
      startOffset,
      direction2,
      untilBody: untilBodyKey,
      // Only fold the dir-2 up-to target into the hash when it exists, so
      // extrudes WITHOUT a dir-2 up-to keep their original cache key (adding a
      // `null` here would invalidate every cached extrude region).
      ...(dir2UntilKey ? { dir2UntilBody: dir2UntilKey } : {}),
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
      const scopedFaces = _scopeFaceBoundaryEdges(cached.tessellatedFaces.faces || [], scope);
      const scopedTopo = _scopeTopology(cached.tessellatedFaces.topology, scope);
      // Cached brepBytes is a Buffer (Postgres BYTEA round-trip) — re-encode
      // to base64 for the boolean RPC.
      const brep = Buffer.isBuffer(cached.brepBytes)
        ? cached.brepBytes.toString('base64')
        : Buffer.from(cached.brepBytes || '').toString('base64');
      mergedFaces.push(...scopedFaces);
      mergedTopology.vertices.push(...scopedTopo.vertices);
      mergedTopology.edges.push(...scopedTopo.edges);
      regionBreps.push(brep);
      regionResults.push({ ri, brep, faces: scopedFaces, topology: scopedTopo, paramHash, cached: true });
      continue;
    }

    allCached = false;
    // Attach the heavy dir-2 up-to BREP(s) to the payload now (kept out of the
    // cache key above). The kernel caps the dir-2 prism against them.
    const direction2Payload = direction2
      ? {
          ...direction2,
          ...(dir2UntilBrep ? { untilBrep: dir2UntilBrep } : {}),
          ...(dir2UntilBreps ? { untilBreps: dir2UntilBreps } : {}),
        }
      : null;
    let rpc;
    try {
      rpc = await client.call('buildExtrude', {
        featureId: scope,
        profile: region.outer,
        holes: region.holes,
        plane: dispatch.plane,
        distance: dispatch.distance,
        flipped: dispatch.flipped,
        startOffset,
        // Up To Body / Up To Next ignore the Direction-1 distance — the kernel
        // sizes + caps that prism against the body BREP(s). Direction 2 is sent
        // and unioned in by the kernel: a fixed blind/through-all prism, or — when
        // dir 2 is itself an up-to condition — its own body-capped prism.
        ...(untilBrep ? { untilBrep } : {}),
        ...(untilBreps ? { untilBreps } : {}),
        ...(direction2Payload ? { direction2: direction2Payload } : {}),
      });
    } catch (err) {
      // Isolate a region the kernel can't build (e.g. a pinched/self-touching
      // arrangement face → "BRepMesh failed on a face"). Skip it with a
      // warning so the other regions still build and nothing cascades.
      regionWarnings.push(`region ${ri}: ${err.message}`);
      continue;
    }

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
    const scopedFaces = _scopeFaceBoundaryEdges(rpc.faces || [], scope);
    const scopedTopo = _scopeTopology(rpc.topology || { vertices: [], edges: [] }, scope);
    mergedFaces.push(...scopedFaces);
    mergedTopology.vertices.push(...scopedTopo.vertices);
    mergedTopology.edges.push(...scopedTopo.edges);
    regionBreps.push(rpc.brepBytes || '');
    regionResults.push({ ri, brep: rpc.brepBytes || '', faces: scopedFaces, topology: scopedTopo, paramHash, cached: false });
  }

  // Every selected region failed (or was out of range) — there is no geometry
  // to compose. Fail the feature with the collected reasons rather than
  // returning an empty prism (which would silently drop the feature).
  if (regionBreps.length === 0) {
    throw new Error(
      `extrude produced no buildable regions` +
      (regionWarnings.length ? `: ${regionWarnings.join('; ')}` : ''),
    );
  }

  // Multi-region features need a single BRep at the feature level so the
  // cumulative compose has something to fuse / cut against. For N > 1
  // we sequentially fuse the region BReps into one via buildBoolean.
  let prismBrep = regionBreps[0] || '';
  // The FINAL fuse's per-solid decomposition. Touching regions (e.g. a
  // boundary-with-holes region plus its "plug" regions) merge into one
  // solid; genuinely disjoint regions stay separate. The seed path uses
  // this to make one body per SOLID (merge on) instead of one per region.
  let fusedSolids = null;
  for (let i = 1; i < regionBreps.length; i++) {
    const fused = await client.call('buildBoolean', {
      featureId: `${feature.id}#fuse${i}`,
      op: 'fuse',
      aBrep: prismBrep,
      bBrep: regionBreps[i],
    });
    prismBrep = fused.brepBytes;
    fusedSolids = Array.isArray(fused.solids) && fused.solids.length > 0 ? fused.solids : null;
  }
  const featureParamHash = _hashParams({ regions: regionParamHashes });

  return {
    merged: mergedFaces,
    topology: mergedTopology,
    cached: allCached,
    prismBrep,
    featureParamHash,
    // Per-region results so the additive seed path can make one body per
    // disjoint region. Already scoped by `${feature.id}#${ri}`.
    regions: regionResults,
    fusedSolids,
    // Non-fatal per-region skips (surfaced to the user as warnings).
    warnings: regionWarnings,
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

  const { regions, errors: regionErrors } = extractRegions(sketch.state || { entities: [], constraints: [] }, model.__textResolver);
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

  // Diagnostic: dump axis + key params for every revolve. Lets us compare
  // working revolves vs failing cut revolves when a kernel build rejects
  // the geometry — same sketch + same axisLineId should produce identical
  // origin/dir, regardless of feature.type.
  const fmt = (v) => `(${v[0].toFixed(3)}, ${v[1].toFixed(3)}, ${v[2].toFixed(3)})`;
  console.log(
    `[cadRegen] revolve ${feature.id} (${feature.type}): ` +
    `sketch=${feature.sketchId} axisLine=${feature.axisLineId} ` +
    `axisOrigin=${fmt(axis.origin)} axisDir=${fmt(axisDir)} ` +
    `angle=${angleDeg}° flipped=${feature.flipped === true}`,
  );

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
      mergedFaces.push(..._scopeFaceBoundaryEdges(cached.tessellatedFaces.faces || [], scope));
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
    mergedFaces.push(..._scopeFaceBoundaryEdges(rpc.faces || [], scope));
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

/** Loft a solid through 2+ ordered profile sketches. One profile per section
 * (the first region's outer loop of each sketch) for now. Returns the same
 * shape as _regenerateExtrude so the composer is indifferent. Cached by
 * `${feature.id}#loft` over the section profiles + planes. */
async function _regenerateLoft(feature, sketchDoc, model, client, dbClient) {
  const sketchIds = Array.isArray(feature.sketchIds) ? feature.sketchIds : [];
  if (sketchIds.length < 2) {
    throw new Error('Loft needs at least 2 profile sketches.');
  }
  const sections = [];
  for (const sid of sketchIds) {
    const sketch = sketchDoc.sketches[sid];
    if (!sketch) throw new Error(`loft sketch ${sid} not found in sketchDoc`);
    const { regions, errors } = extractRegions(sketch.state || { entities: [], constraints: [] }, model.__textResolver);
    if (regions.length === 0) {
      throw new Error(errors[0] || `no closed loop in loft sketch ${sid}`);
    }
    sections.push({ profile: regions[0].outer, plane: sketch.plane });
  }

  const scope = `${feature.id}#loft`;
  const paramHash = _hashParams({ loft: true, sections });
  const upstreamHash = '';
  const cached = await dbClient.DesignBRepCache.findOne({
    where: { cadModelID: model.id, featureID: scope, paramHash, upstreamHash, namingVersion: NAMING_VERSION },
  });
  const mergedTopology = { vertices: [], edges: [] };
  if (cached) {
    cached.lastAccessedAt = new Date();
    await cached.save();
    const faces = _scopeFaceBoundaryEdges(cached.tessellatedFaces.faces || [], scope);
    _mergeTopology(mergedTopology, cached.tessellatedFaces.topology, scope);
    const brep = Buffer.isBuffer(cached.brepBytes)
      ? cached.brepBytes.toString('base64')
      : Buffer.from(cached.brepBytes || '').toString('base64');
    return { merged: faces, topology: mergedTopology, cached: true, prismBrep: brep, featureParamHash: paramHash };
  }

  const rpc = await client.call('buildLoft', { featureId: scope, sections });
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
  const faces = _scopeFaceBoundaryEdges(rpc.faces || [], scope);
  _mergeTopology(mergedTopology, rpc.topology, scope);
  return { merged: faces, topology: mergedTopology, cached: false, prismBrep: rpc.brepBytes || '', featureParamHash: paramHash };
}

/** Build a swept solid: drag the closed profile region from the profile
 * sketch along the chained path from the path sketch. Mirrors the
 * caching shape of _regenerateRevolve (one cache row per profile region
 * keyed by both sketches' hashes + the path-edge payload). Kernel does
 * the heavy lifting via OCCT's BRepOffsetAPI_MakePipe under the hood. */
async function _regenerateSweep(feature, sketchDoc, model, client, dbClient) {
  const profileSketch = sketchDoc.sketches[feature.profileSketchId];
  const pathSketch = sketchDoc.sketches[feature.pathSketchId];
  if (!profileSketch) throw new Error(`profile sketch ${feature.profileSketchId} not found`);
  if (!pathSketch) throw new Error(`path sketch ${feature.pathSketchId} not found`);
  if (feature.profileSketchId === feature.pathSketchId) {
    throw new Error('Sweep: profile and path must be different sketches.');
  }

  const { regions, errors: regionErrors } = extractRegions(profileSketch.state || { entities: [], constraints: [] }, model.__textResolver);
  if (regions.length === 0) {
    throw new Error(regionErrors[0] || 'no closed loops in profile sketch');
  }
  const regionIndices = Array.isArray(feature.regionIndices) ? feature.regionIndices : [0];

  // Walk the path sketch into an ordered chain of typed 3D edges. Rejects
  // forks and disconnected sub-paths so the kernel sees an unambiguous
  // wire. Single-circle paths are accepted as closed circular paths.
  const pathEdges = _extractPathEdges(pathSketch);
  if (pathEdges.length === 0) {
    throw new Error('Sweep: path sketch has no usable line/arc/circle segments.');
  }

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
      profilePlane: profileSketch.plane,
      pathEdges,
      regionIndex: ri,
      sweep: true,
    });
    const upstreamHash = '';

    const cached = await dbClient.DesignBRepCache.findOne({
      where: {
        cadModelID: model.id,
        featureID: `${feature.id}#sweep${ri}`,
        paramHash,
        upstreamHash,
        namingVersion: NAMING_VERSION,
      },
    });
    const scope = `${feature.id}#sweep${ri}`;
    regionParamHashes.push(paramHash);

    if (cached) {
      cached.lastAccessedAt = new Date();
      await cached.save();
      mergedFaces.push(..._scopeFaceBoundaryEdges(cached.tessellatedFaces.faces || [], scope));
      _mergeTopology(mergedTopology, cached.tessellatedFaces.topology, scope);
      regionBreps.push(Buffer.isBuffer(cached.brepBytes)
        ? cached.brepBytes.toString('base64')
        : Buffer.from(cached.brepBytes || '').toString('base64'));
      continue;
    }

    allCached = false;
    const rpc = await client.call('buildSweep', {
      featureId: scope,
      profile: region.outer,
      holes: region.holes,
      profilePlane: profileSketch.plane,
      pathEdges,
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
    mergedFaces.push(..._scopeFaceBoundaryEdges(rpc.faces || [], scope));
    _mergeTopology(mergedTopology, rpc.topology, scope);
    regionBreps.push(rpc.brepBytes || '');
  }

  let prismBrep = regionBreps[0] || '';
  for (let i = 1; i < regionBreps.length; i++) {
    const fused = await client.call('buildBoolean', {
      featureId: `${feature.id}#sweepFuse${i}`,
      op: 'fuse',
      aBrep: prismBrep,
      bBrep: regionBreps[i],
    });
    prismBrep = fused.brepBytes;
  }
  const featureParamHash = _hashParams({ sweep: true, regions: regionParamHashes });

  return {
    merged: mergedFaces,
    topology: mergedTopology,
    cached: allCached,
    prismBrep,
    featureParamHash,
  };
}

/** Walk the path sketch's non-construction segments into an ordered
 * chain of typed 3D edges (lines + arcs + at most one circle).
 *
 * Rules:
 * - Lone circle (no other segments): closed circular path, one edge.
 * - Lines + arcs: build adjacency by endpoint id, reject any vertex with
 *   degree > 2 (forks), reject if multiple disconnected sub-paths.
 * - Open path: start at a degree-1 vertex.
 * - Closed path: any vertex is fine — walk until we return to the start.
 *
 * Each edge's geometry is projected to world coords via the path
 * sketch's plane. Arc edges use the start/center/end form OCCT prefers
 * (BRepBuilderAPI_MakeEdge with Geom_Circle); lines just take both
 * endpoints. */
function _extractPathEdges(pathSketch) {
  const state = pathSketch.state || { entities: [] };
  const plane = pathSketch.plane;
  const project = (p) => [
    plane.origin[0] + p.x * plane.xAxis[0] + p.y * plane.yAxis[0],
    plane.origin[1] + p.x * plane.xAxis[1] + p.y * plane.yAxis[1],
    plane.origin[2] + p.x * plane.xAxis[2] + p.y * plane.yAxis[2],
  ];
  const findPt = (id) => state.entities.find(e => e.id === id && e.kind === 'point');

  const lines = state.entities.filter(e => e.kind === 'line' && !e.construction);
  const arcs = state.entities.filter(e => e.kind === 'arc' && !e.construction);
  const circles = state.entities.filter(e => e.kind === 'circle' && !e.construction);

  // Lone circle: closed circular path. Send center + radius + plane normal.
  if (circles.length === 1 && lines.length === 0 && arcs.length === 0) {
    const c = circles[0];
    const center = findPt(c.centerId);
    if (!center) throw new Error(`Sweep path: circle ${c.id} missing center point.`);
    return [{
      kind: 'circle',
      center: project(center),
      radius: Number(c.radius),
      normal: plane.normal,
    }];
  }

  const segs = [];
  for (const l of lines) segs.push({ id: l.id, kind: 'line', startId: l.startId, endId: l.endId, entity: l });
  for (const a of arcs)  segs.push({ id: a.id, kind: 'arc',  startId: a.startId, endId: a.endId, entity: a });
  if (segs.length === 0) return [];

  const adj = new Map();
  for (const s of segs) {
    if (!adj.has(s.startId)) adj.set(s.startId, []);
    if (!adj.has(s.endId)) adj.set(s.endId, []);
    adj.get(s.startId).push(s.id);
    adj.get(s.endId).push(s.id);
  }
  for (const verts of adj.values()) {
    if (verts.length > 2) {
      throw new Error('Sweep path: vertex has more than two incident segments (the path forks).');
    }
  }
  const segById = new Map(segs.map(s => [s.id, s]));
  const endpoints = [...adj.entries()].filter(([, ids]) => ids.length === 1).map(([v]) => v);
  if (endpoints.length > 2) {
    throw new Error('Sweep path: multiple disconnected sub-paths in path sketch.');
  }
  const startVertex = endpoints.length > 0 ? endpoints[0] : segs[0].startId;

  const visited = new Set();
  const edges = [];
  let currentVertex = startVertex;
  for (let i = 0; i < segs.length; i++) {
    const candidates = (adj.get(currentVertex) || []).filter(id => !visited.has(id));
    if (candidates.length === 0) break;
    const sid = candidates[0];
    visited.add(sid);
    const seg = segById.get(sid);
    const goingForward = seg.startId === currentVertex;
    const nextVertex = goingForward ? seg.endId : seg.startId;
    const aId = goingForward ? seg.startId : seg.endId;
    const bId = goingForward ? seg.endId : seg.startId;
    const aPt = findPt(aId);
    const bPt = findPt(bId);
    if (!aPt || !bPt) throw new Error(`Sweep path: segment ${seg.id} missing endpoint.`);
    if (seg.kind === 'line') {
      edges.push({ kind: 'line', start: project(aPt), end: project(bPt) });
    } else {
      // Arc — three-point form (start, mid, end) is the easiest for OCCT
      // to consume via GC_MakeArcOfCircle. Compute the mid-point on the
      // circle at the angular midpoint of the arc's sweep.
      const centerPt = findPt(seg.entity.centerId);
      if (!centerPt) throw new Error(`Sweep path: arc ${seg.id} missing center.`);
      const r = Number(seg.entity.radius);
      const ccw = seg.entity.ccw !== false;
      // Angle at the "from" point.
      const angA = Math.atan2(aPt.y - centerPt.y, aPt.x - centerPt.x);
      const angB = Math.atan2(bPt.y - centerPt.y, bPt.x - centerPt.x);
      // CCW sweep from A to B; flip when goingForward toggles ccw.
      const sweep = _arcSweep(angA, angB, goingForward ? ccw : !ccw);
      const angMid = angA + sweep / 2;
      const midPt = { x: centerPt.x + r * Math.cos(angMid), y: centerPt.y + r * Math.sin(angMid) };
      edges.push({
        kind: 'arc',
        start: project(aPt),
        mid: project(midPt),
        end: project(bPt),
      });
    }
    currentVertex = nextVertex;
    if (currentVertex === startVertex) break;  // closed-path completion
  }
  return edges;
}

/** Signed CCW sweep angle from `from` to `to`. Always returns a positive
 * value in [0, 2π) when ccw=true, negative in (-2π, 0] when ccw=false. */
function _arcSweep(from, to, ccw) {
  let d = to - from;
  if (ccw) {
    while (d <= 0) d += Math.PI * 2;
    while (d > Math.PI * 2) d -= Math.PI * 2;
  } else {
    while (d >= 0) d -= Math.PI * 2;
    while (d < -Math.PI * 2) d += Math.PI * 2;
  }
  return d;
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

/** Compose this feature's prism into an existing body. Mutates the body
 * via fuse (additive) or cut (subtractive) boolean op. Cache row keyed
 * by `${feature.id}#body` + body.paramHash as upstreamHash so editing
 * an upstream feature on the same body invalidates the chain.
 *
 * @returns {Promise<{
 *   brep: string, paramHash: string, faces: Array, topology: object, cached: boolean,
 * }>}
 */
/** Dispatch a fillet / chamfer feature. These operate on the most-recent
 * additive body's BREP directly — no prism, no compose. The kernel takes
 * the body's brep + a list of picked edges (by endpoint coords) + a
 * value (radius for fillet, leg distance for chamfer), and returns the
 * blended body. We replace the body in-place and emit the result.
 *
 * Cache key: (op kind, value, edges_json, upstream body hash). Cascades
 * via the upstream-hash field so any change to an earlier feature
 * correctly invalidates the blend.
 */
async function _dispatchEdgeBlend(feature, bodies, model, client, dbClient, results, emit, vertexMap, faceMap) {
  if (bodies.length === 0) {
    throw new Error(`${feature.type} feature needs an existing body to blend. Add an additive Extrude / Revolve / Sweep first.`);
  }
  if (!Array.isArray(feature.edges) || feature.edges.length === 0) {
    throw new Error(`${feature.type} feature has no edges picked.`);
  }
  const value = Number(feature.type === 'fillet' ? feature.radius : feature.distance);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${feature.type} value must be a positive number (got ${value}).`);
  }
  // Chamfer mode + extras. Default to 'equal' on legacy records and
  // when feature.type is 'fillet' (the kernel ignores the field).
  const chamferMode = feature.type === 'chamfer' ? (feature.mode || 'equal') : 'equal';
  let chamferDistance2 = null;
  let chamferAngle = null;
  if (feature.type === 'chamfer') {
    if (chamferMode === 'twoDistance') {
      chamferDistance2 = Number(feature.distance2);
      if (!Number.isFinite(chamferDistance2) || chamferDistance2 <= 0) {
        throw new Error(`chamfer mode 'twoDistance' requires a positive distance2 (got ${feature.distance2}).`);
      }
    } else if (chamferMode === 'distanceAngle') {
      chamferAngle = Number(feature.angle);
      if (!Number.isFinite(chamferAngle) || chamferAngle <= 0 || chamferAngle >= 90) {
        throw new Error(`chamfer mode 'distanceAngle' requires an angle in (0°, 90°) (got ${feature.angle}°).`);
      }
    }
  }
  // SolidWorks-style "All bodies" Feature Scope: a blend applied to any
  // body whose topology contains the picked edge gets that edge rounded.
  // For now we target the most-recent body (single-body case), matching
  // the additive flow. Multi-body scope is a later pass — the cache key
  // includes body.id so adding per-body iteration here doesn't conflict.
  const body = bodies[bodies.length - 1];
  const kind = feature.type;  // 'fillet' or 'chamfer'
  const paramHash = _hashParams({
    op: kind,
    value,
    edges: feature.edges,
    bodyId: body.id,
    upstream: body.paramHash,
    // Chamfer mode + extras participate in the cache key so changing mode
    // between equal / twoDistance / distanceAngle invalidates the cached
    // result. distance2 / angle nullable for non-applicable modes.
    chamferMode,
    chamferDistance2,
    chamferAngle,
  });
  const cacheKey = `${feature.id}#blend#${body.id}`;
  console.log(`[cadRegen] dispatching feature ${feature.id} type=${kind} (${feature.edges.length} edge(s), value=${value})`);
  const cached = await dbClient.DesignBRepCache.findOne({
    where: {
      cadModelID: model.id,
      featureID: cacheKey,
      paramHash,
      upstreamHash: body.paramHash,
      namingVersion: NAMING_VERSION,
    },
  });
  let brep, faces, topology, solids, cachedFlag;
  if (cached) {
    cached.lastAccessedAt = new Date();
    await cached.save();
    brep = Buffer.isBuffer(cached.brepBytes)
      ? cached.brepBytes.toString('base64')
      : Buffer.from(cached.brepBytes || '').toString('base64');
    faces = cached.tessellatedFaces.faces || [];
    topology = cached.tessellatedFaces.topology || { vertices: [], edges: [] };
    solids = cached.tessellatedFaces.solids || [];
    cachedFlag = true;
  } else {
    const rpc = await client.call('buildEdgeBlend', {
      featureId: `${feature.id}#blend`,
      aBrep: body.brep,
      kind: kind === 'fillet' ? 'fillet' : 'chamfer',
      value,
      // Pass per-edge value override through to the kernel when present.
      // Mixed radii / distances in a single MakeFillet / MakeChamfer call
      // produce the correct interacting rolling balls at junction vertices.
      edges: feature.edges.map(e => {
        const out = { start: e.start, end: e.end };
        if (typeof e.value === 'number' && Number.isFinite(e.value) && e.value > 0) {
          out.value = e.value;
        }
        return out;
      }),
      ...(kind === 'chamfer' ? {
        chamferMode,
        ...(chamferDistance2 !== null ? { distance2: chamferDistance2 } : {}),
        ...(chamferAngle !== null ? { angle: chamferAngle } : {}),
      } : {}),
    });
    await dbClient.DesignBRepCache.upsert({
      cadModelID: model.id,
      featureID: cacheKey,
      paramHash,
      upstreamHash: body.paramHash,
      brepBytes: Buffer.from(rpc.brepBytes || '', 'base64'),
      tessellatedFaces: { faces: rpc.faces || [], topology: rpc.topology || { vertices: [], edges: [] }, solids: rpc.solids || [] },
      namingVersion: NAMING_VERSION,
      lastAccessedAt: new Date(),
    });
    brep = rpc.brepBytes;
    faces = rpc.faces || [];
    topology = rpc.topology || { vertices: [], edges: [] };
    solids = rpc.solids || [];
    cachedFlag = false;
  }
  console.log(`[cadRegen] ${feature.id} ${kind} result: ${solids.length} solid(s), cached=${cachedFlag}`);

  // Replace the body's geometry with the blended result. The blend
  // doesn't split or annihilate, so we keep the body id and just
  // refresh brep / faces / topology / centroid. paramHash advances
  // to the new compose-style hash so downstream features re-eval.
  if (solids.length === 0) {
    throw new Error(`${kind} produced no solid — the operation likely failed (radius/distance too large for an edge).`);
  }
  const primary = solids[0];
  body.brep = primary.brepBytes || brep;
  body.paramHash = paramHash;
  body.faces = _scopeFaceBoundaryEdges(primary.faces || faces, body.id);
  body.topology = _scopeTopology(primary.topology || topology, body.id);
  body.centroid = primary.centroid
    ? [primary.centroid[0], primary.centroid[1], primary.centroid[2]]
    : _approxCentroidFromFaces(body.faces);
  for (const v of body.topology.vertices || []) vertexMap.set(v.id, v.position);
  for (const f of body.faces || []) {
    const plane = _faceRepresentativePlane(f);
    if (plane) faceMap.set(f.faceId, plane);
  }
  const result = {
    featureId: feature.id,
    bodyId: body.id,
    faces: body.faces,
    topology: body.topology,
    cached: cachedFlag,
    bodyParamHash: body.paramHash,
  };
  results.push(result);
  emit(result);
}

/** Build the kernel transform list for a pattern feature. Mirrors the
 * compute logic in `frontend/src/app/cad/lib/pattern.ts` — keep the
 * two in sync. Returns one transform per *copy* (the source seed is
 * implicit). For 1D linear: count − 1 entries. For 2D linear:
 * count1 * count2 − 1. For circular: count − 1. For mirror: 1. */
function _computePatternTransforms(feature) {
  if (feature.type === 'mirror') {
    if (!feature.planeSnapshot || !feature.planeSnapshot.origin || !feature.planeSnapshot.normal) {
      throw new Error('Mirror feature is missing its plane snapshot. Re-pick the mirror plane.');
    }
    return [{
      kind: 'mirror',
      origin: feature.planeSnapshot.origin,
      normal: feature.planeSnapshot.normal,
    }];
  }
  if (feature.type === 'linearPattern') {
    const d1 = feature.direction1;
    if (!d1 || !d1.axisSnapshot) throw new Error('Linear pattern: direction 1 is missing its axis snapshot.');
    if (!(Number.isInteger(d1.count) && d1.count >= 1)) throw new Error('Linear pattern: direction 1 count must be ≥ 1.');
    if (d1.count >= 2 && (!Number.isFinite(d1.spacing) || d1.spacing === 0)) {
      throw new Error('Linear pattern: direction 1 spacing must be non-zero when count ≥ 2.');
    }
    const d2 = feature.direction2;
    if (d2) {
      if (!d2.axisSnapshot) throw new Error('Linear pattern: direction 2 is missing its axis snapshot.');
      if (!(Number.isInteger(d2.count) && d2.count >= 1)) throw new Error('Linear pattern: direction 2 count must be ≥ 1.');
      if (d2.count >= 2 && (!Number.isFinite(d2.spacing) || d2.spacing === 0)) {
        throw new Error('Linear pattern: direction 2 spacing must be non-zero when count ≥ 2.');
      }
    }
    const sign1 = d1.flipped ? -1 : 1;
    const v1 = [d1.axisSnapshot.direction[0] * d1.spacing * sign1,
                d1.axisSnapshot.direction[1] * d1.spacing * sign1,
                d1.axisSnapshot.direction[2] * d1.spacing * sign1];
    const v2 = d2 ? (() => {
      const s = d2.flipped ? -1 : 1;
      return [d2.axisSnapshot.direction[0] * d2.spacing * s,
              d2.axisSnapshot.direction[1] * d2.spacing * s,
              d2.axisSnapshot.direction[2] * d2.spacing * s];
    })() : null;
    const out = [];
    for (let i = 0; i < d1.count; i++) {
      const jMax = d2 ? d2.count : 1;
      for (let j = 0; j < jMax; j++) {
        if (i === 0 && j === 0) continue;
        out.push({
          kind: 'translate',
          dx: v1[0] * i + (v2 ? v2[0] * j : 0),
          dy: v1[1] * i + (v2 ? v2[1] * j : 0),
          dz: v1[2] * i + (v2 ? v2[2] * j : 0),
        });
      }
    }
    return out;
  }
  if (feature.type === 'circularPattern') {
    if (!feature.axisSnapshot) throw new Error('Circular pattern: missing axis snapshot.');
    if (!(Number.isInteger(feature.count) && feature.count >= 2)) {
      throw new Error('Circular pattern: count must be ≥ 2.');
    }
    const stepDeg = feature.mode === 'equalSpacing'
      ? Number(feature.angleDeg) / feature.count
      : Number(feature.angleDeg);
    if (!Number.isFinite(stepDeg)) throw new Error('Circular pattern: angle is not a finite number.');
    const stepRad = (stepDeg * Math.PI) / 180;
    const sign = feature.flipped ? -1 : 1;
    const out = [];
    for (let i = 1; i < feature.count; i++) {
      out.push({
        kind: 'rotate',
        origin: feature.axisSnapshot.origin,
        direction: feature.axisSnapshot.direction,
        angleRad: sign * stepRad * i,
      });
    }
    return out;
  }
  throw new Error(`_computePatternTransforms: unknown feature type '${feature.type}'.`);
}

/** Dispatch a Mirror / Linear / Circular pattern feature. Takes the
 * most-recent body, builds the transform list from the feature's
 * snapshots, and asks the kernel to fuse the source body with its
 * transformed copies. The body is replaced in-place (keeping the
 * source feature's body id) so downstream features see one fused
 * body. `mergeWithSource: false` would emit a fresh body — not yet
 * surfaced in the UI (defaults to true). */
async function _dispatchPattern(feature, bodies, model, client, dbClient, results, emit, vertexMap, faceMap) {
  if (bodies.length === 0) {
    throw new Error(`${feature.type} feature needs an existing body to pattern. Add an Extrude / Revolve / Sweep first.`);
  }
  const body = bodies[bodies.length - 1];
  const transforms = _computePatternTransforms(feature);
  if (transforms.length === 0) {
    // count=1 with no direction 2 — pattern is a no-op. Skip the kernel
    // call entirely; the body passes through unchanged.
    console.log(`[cadRegen] ${feature.id} pattern produced 0 copies — body unchanged`);
    const result = {
      featureId: feature.id,
      bodyId: body.id,
      faces: body.faces,
      topology: body.topology,
      cached: true,
      bodyParamHash: body.paramHash,
    };
    results.push(result);
    emit(result);
    return;
  }
  const mergeWithSource = feature.mergeWithSource !== false;  // default true
  const paramHash = _hashParams({
    op: feature.type,
    transforms,
    mergeWithSource,
    bodyId: body.id,
    upstream: body.paramHash,
  });
  const cacheKey = `${feature.id}#pattern#${body.id}`;
  console.log(`[cadRegen] dispatching feature ${feature.id} type=${feature.type} (${transforms.length} transform(s))`);
  const cached = await dbClient.DesignBRepCache.findOne({
    where: {
      cadModelID: model.id,
      featureID: cacheKey,
      paramHash,
      upstreamHash: body.paramHash,
      namingVersion: NAMING_VERSION,
    },
  });
  let brep, faces, topology, solids, cachedFlag;
  if (cached) {
    cached.lastAccessedAt = new Date();
    await cached.save();
    brep = Buffer.isBuffer(cached.brepBytes)
      ? cached.brepBytes.toString('base64')
      : Buffer.from(cached.brepBytes || '').toString('base64');
    faces = cached.tessellatedFaces.faces || [];
    topology = cached.tessellatedFaces.topology || { vertices: [], edges: [] };
    solids = cached.tessellatedFaces.solids || [];
    cachedFlag = true;
  } else {
    const rpc = await client.call('buildPattern', {
      featureId: `${feature.id}#pattern`,
      aBrep: body.brep,
      transforms,
      mergeWithSource,
    });
    await dbClient.DesignBRepCache.upsert({
      cadModelID: model.id,
      featureID: cacheKey,
      paramHash,
      upstreamHash: body.paramHash,
      brepBytes: Buffer.from(rpc.brepBytes || '', 'base64'),
      tessellatedFaces: { faces: rpc.faces || [], topology: rpc.topology || { vertices: [], edges: [] }, solids: rpc.solids || [] },
      namingVersion: NAMING_VERSION,
      lastAccessedAt: new Date(),
    });
    brep = rpc.brepBytes;
    faces = rpc.faces || [];
    topology = rpc.topology || { vertices: [], edges: [] };
    solids = rpc.solids || [];
    cachedFlag = false;
  }
  if (solids.length === 0) {
    throw new Error(`${feature.type} produced no solid — kernel returned an empty result. The pattern may have produced overlapping or degenerate geometry.`);
  }
  // SW-style multi-body output: each disjoint OCCT solid in the
  // result becomes its OWN body. When pattern instances touch the
  // source (overlapping geometry), the fuse consolidates them and
  // solids.length === 1 — that case still replaces the source body
  // in place. When instances DON'T touch the source (the common
  // "stamped array of bosses" case), the fuse leaves them as
  // disjoint solids and solids.length > 1 — each extra solid gets
  // pushed to `bodies` as a new body the downstream features can
  // see. Body ids are stable across regen: the FIRST solid keeps
  // the source body's id, additional solids derive theirs from the
  // pattern feature id (`<featureId>#body{i}`).
  //
  // Helper to populate one body record from one SolidPart in
  // `solids`. Scopes face boundary edge ids and topology under the
  // body id so different bodies don't collide on shared local
  // identifiers.
  const adoptSolid = (target, s, scopeId) => {
    target.brep = s.brepBytes || '';
    target.faces = _scopeFaceBoundaryEdges(s.faces || [], scopeId);
    target.topology = _scopeTopology(s.topology || { vertices: [], edges: [] }, scopeId);
    target.centroid = s.centroid
      ? [s.centroid[0], s.centroid[1], s.centroid[2]]
      : _approxCentroidFromFaces(target.faces);
  };
  // Stage 1: first solid replaces the source body.
  const firstSolid = solids[0];
  adoptSolid(body, firstSolid, body.id);
  body.paramHash = paramHash;
  for (const v of body.topology.vertices || []) vertexMap.set(v.id, v.position);
  for (const f of body.faces || []) {
    const plane = _faceRepresentativePlane(f);
    if (plane) faceMap.set(f.faceId, plane);
  }
  const result = {
    featureId: feature.id,
    bodyId: body.id,
    faces: body.faces,
    topology: body.topology,
    cached: cachedFlag,
    bodyParamHash: body.paramHash,
  };
  results.push(result);
  emit(result);
  // Stage 2: each additional disjoint solid becomes a new body.
  for (let i = 1; i < solids.length; i++) {
    const s = solids[i];
    const newBodyId = `${feature.id}#body${i}`;
    const newBody = { id: newBodyId, brep: '', paramHash: `${paramHash}#${i}`, faces: [], topology: { vertices: [], edges: [] } };
    adoptSolid(newBody, s, newBodyId);
    bodies.push(newBody);
    for (const v of newBody.topology.vertices || []) vertexMap.set(v.id, v.position);
    for (const f of newBody.faces || []) {
      const plane = _faceRepresentativePlane(f);
      if (plane) faceMap.set(f.faceId, plane);
    }
    const extraResult = {
      featureId: feature.id,
      bodyId: newBody.id,
      faces: newBody.faces,
      topology: newBody.topology,
      cached: cachedFlag,
      bodyParamHash: newBody.paramHash,
    };
    results.push(extraResult);
    emit(extraResult);
  }
  if (solids.length > 1) {
    console.log(`[cadRegen] ${feature.id} produced ${solids.length} disjoint solid(s) → 1 source body + ${solids.length - 1} new body(ies)`);
  }
}

/** Record the body a feature created or changed (by BREP delta) so feature-mode
 * patterns can later read the seed's before/after material. Picks the
 * feature's own-id body if it changed, else the first new body, else the first
 * changed body. No change (datum / suppressed) → a null-body snapshot. */
function _captureFeatureSnapshot(featureId, bodies, bodiesBefore, snapshots) {
  const changed = (b) => {
    const prev = bodiesBefore.get(b.id);
    return prev === undefined || prev !== b.brep;
  };
  let target = bodies.find(b => (b.id === featureId || b.id.startsWith(`${featureId}#`)) && changed(b));
  if (!target) target = bodies.find(b => bodiesBefore.get(b.id) === undefined);      // new body
  if (!target) target = bodies.find(b => { const p = bodiesBefore.get(b.id); return p !== undefined && p !== b.brep; });
  if (!target) {
    snapshots.set(featureId, { bodyId: null, before: '', after: '' });
    return;
  }
  snapshots.set(featureId, {
    bodyId: target.id,
    before: bodiesBefore.get(target.id) || '',
    after: target.brep || '',
  });
}

/** Dispatch a FEATURE-mode pattern / mirror (REQ 822). Instead of copying a
 * finished body, it re-applies each seed feature's geometry delta (the material
 * it added/removed, from the before/after snapshot) at every pattern instance —
 * so a patterned cut cuts N times, a patterned boss adds N times, a mirrored
 * fillet reflects the rounded edge. Correct for ALL feature types via the
 * delta; the kernel `buildFeaturePattern` does the per-instance carve/fill. */
/** Feature types whose pattern instances can be built EXACTLY by re-running the
 * seed's tool boolean at each transform (true feature pattern). Everything else
 * (hole, fillet, chamfer, shell, nested patterns) uses the geometry-delta path,
 * matching SolidWorks (which also geometry-patterns fillets/chamfers/shells). */
const TOOL_PATTERN_TYPES = new Set(['extrude', 'cutExtrude', 'revolve', 'cutRevolve', 'sweep', 'cutSweep', 'loft']);

/** Geometry-pattern application (REQ 841): one `buildFeaturePattern` call over
 * the seed GROUP's net delta (before-first-seed → after-last-seed), replacing
 * the per-seed feature-pattern loop. Caches + replaces the body in place +
 * emits, mirroring the per-seed path's bookkeeping. */
async function _applyGeometryPattern({ feature, transforms, before, after, targetBody, model, client, dbClient, results, emit, indexBody }) {
  const paramHash = _hashParams({
    op: feature.type, mode: 'geometry', transforms,
    before: before ? _hashParams({ b: before }) : '',
    after: _hashParams({ a: after }),
    bodyId: targetBody.id, upstream: targetBody.paramHash || '',
  });
  const cacheKey = `${feature.id}#gpattern#${targetBody.id}`;
  const upstreamHash = targetBody.paramHash || '';
  const cached = await dbClient.DesignBRepCache.findOne({
    where: { cadModelID: model.id, featureID: cacheKey, paramHash, upstreamHash, namingVersion: NAMING_VERSION },
  });
  let brep, faces, topology, cachedFlag;
  if (cached) {
    cached.lastAccessedAt = new Date(); await cached.save();
    brep = Buffer.isBuffer(cached.brepBytes) ? cached.brepBytes.toString('base64') : Buffer.from(cached.brepBytes || '').toString('base64');
    faces = cached.tessellatedFaces.faces || [];
    topology = cached.tessellatedFaces.topology || { vertices: [], edges: [] };
    cachedFlag = true;
  } else {
    const rpc = await client.call('buildFeaturePattern', {
      featureId: `${feature.id}#gpattern`,
      ...(before ? { beforeBrep: before } : {}),
      afterBrep: after,
      bodyBrep: targetBody.brep,
      transforms,
    });
    await dbClient.DesignBRepCache.upsert({
      cadModelID: model.id, featureID: cacheKey, paramHash, upstreamHash,
      brepBytes: Buffer.from(rpc.brepBytes || '', 'base64'),
      tessellatedFaces: { faces: rpc.faces || [], topology: rpc.topology || { vertices: [], edges: [] }, solids: rpc.solids || [] },
      namingVersion: NAMING_VERSION, lastAccessedAt: new Date(),
    });
    brep = rpc.brepBytes; faces = rpc.faces || []; topology = rpc.topology || { vertices: [], edges: [] }; cachedFlag = false;
  }
  if (!brep) {
    throw new Error(`${feature.type}: geometry pattern produced no geometry — the instances may overlap destructively.`);
  }
  targetBody.brep = brep;
  targetBody.faces = _scopeFaceBoundaryEdges(faces, targetBody.id);
  targetBody.topology = _scopeTopology(topology, targetBody.id);
  targetBody.centroid = _approxCentroidFromFaces(targetBody.faces);
  targetBody.paramHash = paramHash;
  indexBody(targetBody);
  const r = { featureId: feature.id, bodyId: targetBody.id, faces: targetBody.faces, topology: targetBody.topology, cached: cachedFlag, bodyParamHash: targetBody.paramHash };
  results.push(r); emit(r);
}

async function _dispatchFeaturePattern(feature, bodies, model, client, dbClient, results, emit, vertexMap, faceMap, featureSnapshots, featureTools = new Map()) {
  const seedIds = Array.isArray(feature.seedFeatureIds) ? feature.seedFeatureIds : [];
  if (seedIds.length === 0) {
    throw new Error(`${feature.type}: no seed features selected. Pick at least one feature to pattern.`);
  }
  const transforms = _computePatternTransforms(feature);
  const emitNoop = () => {
    const r = { featureId: feature.id, bodyId: null, faces: [], topology: { vertices: [], edges: [] }, cached: true };
    results.push(r); emit(r);
  };
  if (transforms.length === 0) { emitNoop(); return; }  // count 1 — no copies

  const indexBody = (b) => {
    for (const v of b.topology.vertices || []) vertexMap.set(v.id, v.position);
    for (const f of b.faces || []) { const p = _faceRepresentativePlane(f); if (p) faceMap.set(f.faceId, p); }
  };

  // GEOMETRY PATTERN (REQ 841 / SolidWorks-OnShape parity): instead of re-running
  // each seed's boolean per instance (the feature-pattern loop below), copy the
  // seed GROUP's finished geometry once — the body delta between the state before
  // the FIRST seed and after the LAST seed — and fuse/cut transformed copies of
  // that. This sidesteps duplicate coincident faces that the feature-pattern path
  // leaves when re-cutting a wall near-coincident with patterned geometry (a
  // rotationally-symmetric pattern), and is faster. Preconditions: every seed has
  // a snapshot on the SAME body with a non-empty after-state; otherwise fall back
  // to the feature-pattern loop (with a warning).
  // Default ON: geometry pattern unless the feature explicitly opts out
  // (geometryPattern === false). Falls back to feature pattern below when the
  // seed group can't be geometry-patterned (multi-body / non-contiguous).
  if (feature.geometryPattern !== false) {
    // Seeds that actually changed a body (a failed/no-op seed — e.g. a fillet
    // that didn't build — leaves an empty snapshot and is skipped; it's a no-op,
    // so the surrounding before/after still bracket the real geometry change).
    const valid = seedIds.map(id => featureSnapshots.get(id)).filter(s => s && s.bodyId && s.after);
    const bodyIds = new Set(valid.map(s => s.bodyId));
    const ok = valid.length >= 1 && bodyIds.size === 1;
    const targetBody = ok ? bodies.find(b => b.id === valid[valid.length - 1].bodyId) : null;
    if (ok && targetBody && targetBody.brep) {
      await _applyGeometryPattern({
        feature, transforms,
        before: valid[0].before, after: valid[valid.length - 1].after,
        targetBody, model, client, dbClient, results, emit, indexBody,
      });
      return;
    }
    console.warn(`[cadRegen] ${feature.id}: geometry-pattern preconditions not met (seeds must change a single shared body) — falling back to feature pattern`);
  }

  let appliedAny = false;
  // Process seeds in tree order; each re-applies its delta to the running body.
  for (const seedId of seedIds) {
    const snap = featureSnapshots.get(seedId);
    if (!snap) {
      throw new Error(`${feature.type}: seed feature '${seedId}' was not found upstream. Seeds must come before the pattern in the feature tree.`);
    }
    if (!snap.bodyId || !snap.after) continue;  // seed made no geometry change
    const targetBody = bodies.find(b => b.id === snap.bodyId);
    if (!targetBody || !targetBody.brep) {
      throw new Error(`${feature.type}: the body modified by seed '${seedId}' is no longer available to pattern.`);
    }

    // Tool path (EXACT) when the seed is a tool-based feature AND we captured
    // its tool solid this regen; else the geometry-delta path (fillet/chamfer/
    // shell/nested-pattern seeds, or a missing tool).
    const seedTool = featureTools.get(seedId);
    const useTool = !!(seedTool && TOOL_PATTERN_TYPES.has(seedTool.type) && seedTool.brep);
    const fuse = useTool && !seedTool.type.startsWith('cut');

    const paramHash = _hashParams({
      op: feature.type, transforms, seedId,
      mode: useTool ? 'tool' : 'delta',
      ...(useTool
        ? { tool: _hashParams({ t: seedTool.brep }), fuse }
        : { before: snap.before ? _hashParams({ b: snap.before }) : '', after: _hashParams({ a: snap.after }) }),
      bodyId: targetBody.id, upstream: targetBody.paramHash || '',
    });
    const cacheKey = `${feature.id}#fpattern#${seedId}#${targetBody.id}`;
    const upstreamHash = targetBody.paramHash || '';
    const cached = await dbClient.DesignBRepCache.findOne({
      where: { cadModelID: model.id, featureID: cacheKey, paramHash, upstreamHash, namingVersion: NAMING_VERSION },
    });
    let brep, faces, topology, cachedFlag;
    if (cached) {
      cached.lastAccessedAt = new Date(); await cached.save();
      brep = Buffer.isBuffer(cached.brepBytes) ? cached.brepBytes.toString('base64') : Buffer.from(cached.brepBytes || '').toString('base64');
      faces = cached.tessellatedFaces.faces || [];
      topology = cached.tessellatedFaces.topology || { vertices: [], edges: [] };
      cachedFlag = true;
    } else {
      const rpc = useTool
        ? await client.call('buildToolPattern', {
            featureId: `${feature.id}#tool${seedId}`,
            bodyBrep: targetBody.brep,
            toolBrep: seedTool.brep,
            transforms,
            fuse,
          })
        : await client.call('buildFeaturePattern', {
            featureId: `${feature.id}#seed${seedId}`,
            ...(snap.before ? { beforeBrep: snap.before } : {}),
            afterBrep: snap.after,
            bodyBrep: targetBody.brep,
            transforms,
          });
      await dbClient.DesignBRepCache.upsert({
        cadModelID: model.id, featureID: cacheKey, paramHash, upstreamHash,
        brepBytes: Buffer.from(rpc.brepBytes || '', 'base64'),
        tessellatedFaces: { faces: rpc.faces || [], topology: rpc.topology || { vertices: [], edges: [] }, solids: rpc.solids || [] },
        namingVersion: NAMING_VERSION, lastAccessedAt: new Date(),
      });
      brep = rpc.brepBytes;
      faces = rpc.faces || [];
      topology = rpc.topology || { vertices: [], edges: [] };
      cachedFlag = false;
    }
    if (!brep) {
      throw new Error(`${feature.type}: seed '${seedId}' produced no geometry — the pattern instances may overlap destructively.`);
    }
    // Keep the seed's body as ONE body — feature-pattern/mirror instances belong
    // to the seed's body even when geometrically disjoint (no body fan-out;
    // that's the body-mode behavior). The whole result BREP (a compound when
    // disjoint) replaces the body in place, preserving its id for downstream.
    targetBody.brep = brep;
    targetBody.faces = _scopeFaceBoundaryEdges(faces, targetBody.id);
    targetBody.topology = _scopeTopology(topology, targetBody.id);
    targetBody.centroid = _approxCentroidFromFaces(targetBody.faces);
    targetBody.paramHash = paramHash;
    indexBody(targetBody);
    const r = { featureId: feature.id, bodyId: targetBody.id, faces: targetBody.faces, topology: targetBody.topology, cached: cachedFlag, bodyParamHash: targetBody.paramHash };
    results.push(r); emit(r);
    appliedAny = true;
  }
  if (!appliedAny) emitNoop();
}

/** Dispatch a Combine feature — boolean op (Fuse / Cut / Common)
 * between a target body and one or more tool bodies. The target
 * keeps its id (downstream features that reference it still find
 * it); the tool bodies are consumed (removed from `bodies`). When
 * the result splits into multiple disjoint solids, each extra one
 * becomes its own body using the same fan-out pattern as
 * `_dispatchPattern`. REQ 662. */
async function _dispatchCombine(feature, bodies, model, client, dbClient, results, emit, vertexMap, faceMap) {
  if (!feature.targetBodyId) throw new Error('Combine feature has no target body. Pick one.');
  if (!Array.isArray(feature.toolBodyIds) || feature.toolBodyIds.length === 0) {
    throw new Error('Combine feature has no tool bodies. Pick at least one.');
  }
  const target = bodies.find(b => b.id === feature.targetBodyId);
  if (!target) throw new Error(`Target body '${feature.targetBodyId}' not found. Re-pick.`);
  const tools = feature.toolBodyIds.map(id => {
    const b = bodies.find(bb => bb.id === id);
    if (!b) throw new Error(`Tool body '${id}' not found. Re-pick.`);
    return b;
  });
  if (tools.some(t => t.id === target.id)) {
    throw new Error('Combine: target body cannot also appear in the tool list.');
  }
  // Map operation onto the kernel's BuildBooleanOp.
  const kernelOp = feature.operation === 'add' ? 'fuse'
    : feature.operation === 'subtract' ? 'cut'
    : feature.operation === 'common' ? 'common'
    : null;
  if (!kernelOp) throw new Error(`Combine: unknown operation '${feature.operation}'.`);
  // Cache key includes the operation + target + tools + their hashes so
  // a change anywhere upstream invalidates correctly.
  const paramHash = _hashParams({
    op: 'combine',
    operation: feature.operation,
    targetBodyId: target.id,
    targetUpstream: target.paramHash,
    tools: tools.map(t => ({ id: t.id, hash: t.paramHash })),
  });
  const cacheKey = `${feature.id}#combine#${target.id}`;
  console.log(`[cadRegen] dispatching feature ${feature.id} type=combine op=${feature.operation} target=${target.id} tools=[${tools.map(t => t.id).join(',')}]`);
  const cached = await dbClient.DesignBRepCache.findOne({
    where: { cadModelID: model.id, featureID: cacheKey, paramHash, upstreamHash: target.paramHash, namingVersion: NAMING_VERSION },
  });
  let brep, faces, topology, solids, cachedFlag;
  if (cached) {
    cached.lastAccessedAt = new Date();
    await cached.save();
    brep = Buffer.isBuffer(cached.brepBytes) ? cached.brepBytes.toString('base64') : Buffer.from(cached.brepBytes || '').toString('base64');
    faces = cached.tessellatedFaces.faces || [];
    topology = cached.tessellatedFaces.topology || { vertices: [], edges: [] };
    solids = cached.tessellatedFaces.solids || [];
    cachedFlag = true;
  } else {
    // Chain the boolean ops: ((target op tool0) op tool1) … . Each
    // intermediate kernel call returns a fresh BREP that becomes the
    // `a` operand for the next call. We deliberately re-run the
    // kernel call for every tool rather than batching, because OCCT's
    // boolean primitive only takes a pair — chaining keeps the
    // kernel side simple and lets us fail-fast on the first
    // problematic tool.
    let chainedBrep = target.brep;
    let lastRpc;
    for (const tool of tools) {
      lastRpc = await client.call('buildBoolean', {
        featureId: `${feature.id}#combine#${tool.id}`,
        op: kernelOp,
        aBrep: chainedBrep,
        bBrep: tool.brep,
      });
      chainedBrep = lastRpc.brepBytes;
    }
    brep = chainedBrep;
    faces = lastRpc.faces || [];
    topology = lastRpc.topology || { vertices: [], edges: [] };
    solids = lastRpc.solids || [];
    cachedFlag = false;
    await dbClient.DesignBRepCache.upsert({
      cadModelID: model.id, featureID: cacheKey, paramHash, upstreamHash: target.paramHash,
      brepBytes: Buffer.from(brep || '', 'base64'),
      tessellatedFaces: { faces, topology, solids },
      namingVersion: NAMING_VERSION, lastAccessedAt: new Date(),
    });
  }
  if (solids.length === 0) {
    throw new Error(`Combine ${feature.operation} produced no solid. The tool bodies may not intersect the target as required by the operation.`);
  }
  // Remove the tool bodies from the roster — they're consumed by the op.
  // Do this BEFORE updating the target so the target's index stays
  // stable while we splice out tools.
  for (const tool of tools) {
    const idx = bodies.indexOf(tool);
    if (idx >= 0) bodies.splice(idx, 1);
  }
  // Same multi-body fan-out as the pattern dispatch: first solid
  // replaces the target body in place, additional disjoint solids
  // become new bodies pushed onto the roster.
  const adoptSolid = (target_, s, scopeId) => {
    target_.brep = s.brepBytes || '';
    target_.faces = _scopeFaceBoundaryEdges(s.faces || [], scopeId);
    target_.topology = _scopeTopology(s.topology || { vertices: [], edges: [] }, scopeId);
    target_.centroid = s.centroid
      ? [s.centroid[0], s.centroid[1], s.centroid[2]]
      : _approxCentroidFromFaces(target_.faces);
  };
  adoptSolid(target, solids[0], target.id);
  target.paramHash = paramHash;
  for (const v of target.topology.vertices || []) vertexMap.set(v.id, v.position);
  for (const f of target.faces || []) {
    const plane = _faceRepresentativePlane(f);
    if (plane) faceMap.set(f.faceId, plane);
  }
  const result = {
    featureId: feature.id, bodyId: target.id, faces: target.faces, topology: target.topology,
    cached: cachedFlag, bodyParamHash: target.paramHash,
  };
  results.push(result);
  emit(result);
  for (let i = 1; i < solids.length; i++) {
    const s = solids[i];
    const newBodyId = `${feature.id}#body${i}`;
    const newBody = { id: newBodyId, brep: '', paramHash: `${paramHash}#${i}`, faces: [], topology: { vertices: [], edges: [] } };
    adoptSolid(newBody, s, newBodyId);
    bodies.push(newBody);
    for (const v of newBody.topology.vertices || []) vertexMap.set(v.id, v.position);
    for (const f of newBody.faces || []) {
      const plane = _faceRepresentativePlane(f);
      if (plane) faceMap.set(f.faceId, plane);
    }
    const extraResult = {
      featureId: feature.id, bodyId: newBody.id, faces: newBody.faces, topology: newBody.topology,
      cached: cachedFlag, bodyParamHash: newBody.paramHash,
    };
    results.push(extraResult);
    emit(extraResult);
  }
}

/** REQ 666 — Mirror Body. Per source body: ask the kernel for the
 * mirrored copy only (mergeWithSource:false). If `keepOriginals`,
 * append the mirror as a new body; otherwise replace the source
 * body's BREP in place. Reuses the existing buildPattern op — no
 * kernel change required. */
async function _dispatchMirrorBody(feature, bodies, model, client, dbClient, results, emit, vertexMap, faceMap) {
  if (!Array.isArray(feature.bodyIds) || feature.bodyIds.length === 0) {
    throw new Error('Mirror Body has no bodies selected. Pick at least one body to mirror.');
  }
  if (!feature.planeSnapshot) throw new Error('Mirror Body has no mirror plane. Pick one.');
  const keep = feature.keepOriginals !== false;
  const plane = feature.planeSnapshot;
  const mirrorTransform = { kind: 'mirror', origin: plane.origin, normal: plane.normal };
  for (const bodyId of feature.bodyIds) {
    const source = bodies.find(b => b.id === bodyId);
    if (!source) throw new Error(`Mirror Body: source body '${bodyId}' not found. Re-pick.`);
    const cacheKey = `${feature.id}#mirror#${bodyId}`;
    const paramHash = _hashParams({ op: 'mirrorBody', plane: mirrorTransform, sourceUpstream: source.paramHash });
    const cached = await dbClient.DesignBRepCache.findOne({
      where: { cadModelID: model.id, featureID: cacheKey, paramHash, upstreamHash: source.paramHash, namingVersion: NAMING_VERSION },
    });
    let rpc, cachedFlag;
    if (cached) {
      cached.lastAccessedAt = new Date();
      await cached.save();
      rpc = {
        brepBytes: Buffer.isBuffer(cached.brepBytes) ? cached.brepBytes.toString('base64') : Buffer.from(cached.brepBytes || '').toString('base64'),
        faces: cached.tessellatedFaces.faces || [],
        topology: cached.tessellatedFaces.topology || { vertices: [], edges: [] },
        solids: cached.tessellatedFaces.solids || [],
      };
      cachedFlag = true;
    } else {
      rpc = await client.call('buildPattern', {
        featureId: cacheKey,
        aBrep: source.brep,
        transforms: [mirrorTransform],
        mergeWithSource: false,
      });
      await dbClient.DesignBRepCache.upsert({
        cadModelID: model.id, featureID: cacheKey, paramHash, upstreamHash: source.paramHash,
        brepBytes: Buffer.from(rpc.brepBytes || '', 'base64'),
        tessellatedFaces: { faces: rpc.faces || [], topology: rpc.topology || { vertices: [], edges: [] }, solids: rpc.solids || [] },
        namingVersion: NAMING_VERSION, lastAccessedAt: new Date(),
      });
      cachedFlag = false;
    }
    const solids = rpc.solids || [];
    if (solids.length === 0) throw new Error(`Mirror Body: kernel returned no solid for body '${bodyId}'.`);
    const adoptInto = (target, s, scopeId) => {
      target.brep = s.brepBytes || rpc.brepBytes;
      target.faces = _scopeFaceBoundaryEdges(s.faces || rpc.faces, scopeId);
      target.topology = _scopeTopology(s.topology || rpc.topology, scopeId);
      target.centroid = s.centroid ? [s.centroid[0], s.centroid[1], s.centroid[2]] : _approxCentroidFromFaces(target.faces);
      target.paramHash = paramHash;
    };
    if (keep) {
      // Add the mirror as a new body next to the original.
      const newBodyId = `${feature.id}#mirror#${bodyId}`;
      const newBody = { id: newBodyId, brep: '', paramHash: '', faces: [], topology: { vertices: [], edges: [] } };
      adoptInto(newBody, solids[0], newBodyId);
      bodies.push(newBody);
      for (const v of newBody.topology.vertices || []) vertexMap.set(v.id, v.position);
      for (const f of newBody.faces || []) {
        const plane = _faceRepresentativePlane(f);
        if (plane) faceMap.set(f.faceId, plane);
      }
      const r = { featureId: feature.id, bodyId: newBody.id, faces: newBody.faces, topology: newBody.topology, cached: cachedFlag, bodyParamHash: newBody.paramHash };
      results.push(r); emit(r);
    } else {
      adoptInto(source, solids[0], source.id);
      for (const v of source.topology.vertices || []) vertexMap.set(v.id, v.position);
      for (const f of source.faces || []) {
        const plane = _faceRepresentativePlane(f);
        if (plane) faceMap.set(f.faceId, plane);
      }
      const r = { featureId: feature.id, bodyId: source.id, faces: source.faces, topology: source.topology, cached: cachedFlag, bodyParamHash: source.paramHash };
      results.push(r); emit(r);
    }
  }
}

/** REQ 667 — Move/Copy Body. Per source body: chain a translate
 * call (if any) then a rotate call (if any). Each is a buildPattern
 * with mergeWithSource:false, taking the previous step's BREP as
 * input. Final result either replaces the source body (copy:false)
 * or appends as a new body (copy:true). */
async function _dispatchMoveCopyBody(feature, bodies, model, client, dbClient, results, emit, vertexMap, faceMap) {
  if (!Array.isArray(feature.bodyIds) || feature.bodyIds.length === 0) {
    throw new Error('Move/Copy Body has no bodies selected.');
  }
  const t = feature.translate;
  const r = feature.rotate;
  const hasT = Array.isArray(t) && (t[0] !== 0 || t[1] !== 0 || t[2] !== 0);
  const hasR = !!r && r.angleDeg !== 0;
  if (!hasT && !hasR) throw new Error('Move/Copy Body has no transform — set a translation, a rotation, or both.');
  const copy = feature.copy !== false;
  for (const bodyId of feature.bodyIds) {
    const source = bodies.find(b => b.id === bodyId);
    if (!source) throw new Error(`Move/Copy Body: source '${bodyId}' not found.`);
    const cacheKey = `${feature.id}#mc#${bodyId}`;
    const paramHash = _hashParams({ op: 'moveCopyBody', translate: t, rotate: r, sourceUpstream: source.paramHash });
    const cached = await dbClient.DesignBRepCache.findOne({
      where: { cadModelID: model.id, featureID: cacheKey, paramHash, upstreamHash: source.paramHash, namingVersion: NAMING_VERSION },
    });
    let lastRpc, cachedFlag;
    if (cached) {
      cached.lastAccessedAt = new Date();
      await cached.save();
      lastRpc = {
        brepBytes: Buffer.isBuffer(cached.brepBytes) ? cached.brepBytes.toString('base64') : Buffer.from(cached.brepBytes || '').toString('base64'),
        faces: cached.tessellatedFaces.faces || [],
        topology: cached.tessellatedFaces.topology || { vertices: [], edges: [] },
        solids: cached.tessellatedFaces.solids || [],
      };
      cachedFlag = true;
    } else {
      let chained = source.brep;
      // Translate first (matches the user-facing semantic).
      if (hasT) {
        lastRpc = await client.call('buildPattern', {
          featureId: `${cacheKey}#t`,
          aBrep: chained,
          transforms: [{ kind: 'translate', dx: t[0], dy: t[1], dz: t[2] }],
          mergeWithSource: false,
        });
        chained = lastRpc.brepBytes;
      }
      if (hasR) {
        const rad = r.angleDeg * Math.PI / 180;
        lastRpc = await client.call('buildPattern', {
          featureId: `${cacheKey}#r`,
          aBrep: chained,
          transforms: [{ kind: 'rotate', origin: r.axisSnapshot.origin, direction: r.axisSnapshot.direction, angleRad: rad }],
          mergeWithSource: false,
        });
      }
      await dbClient.DesignBRepCache.upsert({
        cadModelID: model.id, featureID: cacheKey, paramHash, upstreamHash: source.paramHash,
        brepBytes: Buffer.from(lastRpc.brepBytes || '', 'base64'),
        tessellatedFaces: { faces: lastRpc.faces || [], topology: lastRpc.topology || { vertices: [], edges: [] }, solids: lastRpc.solids || [] },
        namingVersion: NAMING_VERSION, lastAccessedAt: new Date(),
      });
      cachedFlag = false;
    }
    const solids = lastRpc.solids || [];
    if (solids.length === 0) throw new Error(`Move/Copy Body: kernel returned no solid for '${bodyId}'.`);
    const adoptInto = (target, s, scopeId) => {
      target.brep = s.brepBytes || lastRpc.brepBytes;
      target.faces = _scopeFaceBoundaryEdges(s.faces || lastRpc.faces, scopeId);
      target.topology = _scopeTopology(s.topology || lastRpc.topology, scopeId);
      target.centroid = s.centroid ? [s.centroid[0], s.centroid[1], s.centroid[2]] : _approxCentroidFromFaces(target.faces);
      target.paramHash = paramHash;
    };
    if (copy) {
      const newBodyId = `${feature.id}#mc#${bodyId}`;
      const newBody = { id: newBodyId, brep: '', paramHash: '', faces: [], topology: { vertices: [], edges: [] } };
      adoptInto(newBody, solids[0], newBodyId);
      bodies.push(newBody);
      for (const v of newBody.topology.vertices || []) vertexMap.set(v.id, v.position);
      for (const f of newBody.faces || []) {
        const plane = _faceRepresentativePlane(f);
        if (plane) faceMap.set(f.faceId, plane);
      }
      const out = { featureId: feature.id, bodyId: newBody.id, faces: newBody.faces, topology: newBody.topology, cached: cachedFlag, bodyParamHash: newBody.paramHash };
      results.push(out); emit(out);
    } else {
      adoptInto(source, solids[0], source.id);
      for (const v of source.topology.vertices || []) vertexMap.set(v.id, v.position);
      for (const f of source.faces || []) {
        const plane = _faceRepresentativePlane(f);
        if (plane) faceMap.set(f.faceId, plane);
      }
      const out = { featureId: feature.id, bodyId: source.id, faces: source.faces, topology: source.topology, cached: cachedFlag, bodyParamHash: source.paramHash };
      results.push(out); emit(out);
    }
  }
}

/** REQ 663 — Hole Wizard. Reads the placement sketch's points, builds
 * a drill cylinder (and optionally a counterbore cylinder or
 * countersink cone) at each point, and subtracts them from the
 * target body via chained buildBoolean('cut', …) calls. No new
 * kernel ops: cylinders use buildExtrude with a single-circle profile;
 * cones use buildRevolve of a right-triangle profile around the hole
 * axis. Cosmetic threads (tapped) are frontend-only — the backend
 * cuts the tap-drill cylinder and the renderer adds the translucent
 * thread shell on top. */
async function _dispatchHole(feature, bodies, model, client, dbClient, results, emit, vertexMap, faceMap) {
  if (bodies.length === 0) {
    throw new Error('Hole feature needs an existing body to drill into. Add an Extrude / Revolve / Sweep first.');
  }
  if (!Array.isArray(feature.placements) || feature.placements.length === 0) {
    throw new Error('Hole feature has no placements. Click faces in the viewer to drop hole centers.');
  }
  const { holeSpec } = require('./holeSpecs');
  const spec = holeSpec(feature.standard, feature.size);
  const target = bodies[bodies.length - 1];
  const flipped = feature.flipped === true;

  // Resolve dimensions: per-feature override wins over the spec table.
  // Tapped uses the tap-drill diameter by default; everything else
  // uses clearance so a screw passes through.
  const specDrillDia = feature.holeType === 'tapped'
    ? spec.tapDrillDiameter
    : spec.clearanceDrillDiameter;
  const drillDia = Number.isFinite(feature.drillDiameterOverride) && feature.drillDiameterOverride > 0
    ? feature.drillDiameterOverride : specDrillDia;
  const cboreDia = Number.isFinite(feature.counterboreDiameterOverride) && feature.counterboreDiameterOverride > 0
    ? feature.counterboreDiameterOverride : spec.counterboreDiameter;
  const cboreDepth = Number.isFinite(feature.counterboreDepthOverride) && feature.counterboreDepthOverride > 0
    ? feature.counterboreDepthOverride : spec.counterboreDepth;
  const cskDia = Number.isFinite(feature.countersinkDiameterOverride) && feature.countersinkDiameterOverride > 0
    ? feature.countersinkDiameterOverride : spec.countersinkDiameter;
  const cskAngleDeg = Number.isFinite(feature.countersinkAngleOverride) && feature.countersinkAngleOverride > 0
    ? feature.countersinkAngleOverride : spec.countersinkAngleDeg;
  const drillDepth = feature.endCondition.kind === 'throughAll'
    ? THROUGH_ALL_DISTANCE
    : feature.endCondition.depth;

  // Cache key — every placement, all dims (resolved), end condition.
  const paramHash = _hashParams({
    op: 'hole',
    holeType: feature.holeType,
    standard: feature.standard,
    size: feature.size,
    end: feature.endCondition,
    flipped,
    placements: feature.placements.map(p => ({ pos: p.position, n: p.faceNormal })),
    drillDia, cboreDia, cboreDepth, cskDia, cskAngleDeg,
    targetUpstream: target.paramHash,
  });
  console.log(`[cadRegen] dispatching feature ${feature.id} type=hole kind=${feature.holeType} ${feature.standard}/${feature.size} placements=${feature.placements.length} target=${target.id}`);
  const cached = await dbClient.DesignBRepCache.findOne({
    where: { cadModelID: model.id, featureID: feature.id, paramHash, upstreamHash: target.paramHash, namingVersion: NAMING_VERSION },
  });

  let brep, faces, topology, solids, cachedFlag;
  if (cached) {
    cached.lastAccessedAt = new Date();
    await cached.save();
    brep = Buffer.isBuffer(cached.brepBytes) ? cached.brepBytes.toString('base64') : Buffer.from(cached.brepBytes || '').toString('base64');
    faces = cached.tessellatedFaces.faces || [];
    topology = cached.tessellatedFaces.topology || { vertices: [], edges: [] };
    solids = cached.tessellatedFaces.solids || [];
    cachedFlag = true;
  } else {
    // Per-placement chain: drill cut → (optional cbore cut) → (optional csk cut).
    // Per-placement workplane is built from the click point + face
    // normal; we don't share a sketch plane any more (REQ 663 v2 —
    // direct face-pick placements). Each cut is its own kernel call
    // so boolean failures localize and the rest of the placements
    // still succeed.
    const norm3 = (v) => { const m = Math.hypot(v[0], v[1], v[2]); return [v[0] / m, v[1] / m, v[2] / m]; };
    const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    /** Pick any unit vector perpendicular to n. Uses the world axis
     * least aligned with n so the cross product is well-conditioned. */
    const perpToNormal = (n) => {
      const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
      const ref = ax <= ay && ax <= az ? [1, 0, 0] : ay <= ax && ay <= az ? [0, 1, 0] : [0, 0, 1];
      const d = ref[0] * n[0] + ref[1] * n[1] + ref[2] * n[2];
      return norm3([ref[0] - d * n[0], ref[1] - d * n[1], ref[2] - d * n[2]]);
    };
    let chained = target.brep;
    let lastRpc;
    for (let pi = 0; pi < feature.placements.length; pi++) {
      const pl = feature.placements[pi];
      const faceNormal = norm3(pl.faceNormal);
      const xAxis = perpToNormal(faceNormal);
      const yAxis = norm3(cross3(faceNormal, xAxis));
      // Workplane sits on the face at the click point. Normal points
      // OUT of the body (matches faceNormal). The extrude depth goes
      // into the body, so we set `flipped: !feature.flipped` (same
      // convention as Cut Extrude — the prism flips to subtract).
      const holePlane = { origin: pl.position, xAxis, yAxis, normal: faceNormal };

      // (a) Drill cylinder.
      const drillRpc = await client.call('buildExtrude', {
        featureId: `${feature.id}#p${pi}#drill`,
        profile: [{ kind: 'circle', center: { x: 0, y: 0 }, radius: drillDia / 2 }],
        holes: [],
        plane: holePlane,
        distance: drillDepth,
        flipped: !flipped,
        startOffset: 0,
      });
      lastRpc = await client.call('buildBoolean', {
        featureId: `${feature.id}#p${pi}#drillcut`,
        op: 'cut',
        aBrep: chained,
        bBrep: drillRpc.brepBytes,
      });
      chained = lastRpc.brepBytes;

      // (b) Counterbore — coaxial larger cylinder at the entry surface.
      if (feature.holeType === 'counterbore') {
        const cboreRpc = await client.call('buildExtrude', {
          featureId: `${feature.id}#p${pi}#cbore`,
          profile: [{ kind: 'circle', center: { x: 0, y: 0 }, radius: cboreDia / 2 }],
          holes: [],
          plane: holePlane,
          distance: cboreDepth,
          flipped: !flipped,
          startOffset: 0,
        });
        lastRpc = await client.call('buildBoolean', {
          featureId: `${feature.id}#p${pi}#cborecut`,
          op: 'cut',
          aBrep: chained,
          bBrep: cboreRpc.brepBytes,
        });
        chained = lastRpc.brepBytes;
      }

      // (c) Countersink — revolved cone at the entry surface. Profile
      // is a right triangle in a workplane that CONTAINS the hole
      // axis; revolve about the axis for 360° produces the cone.
      if (feature.holeType === 'countersink') {
        const cskRadius = cskDia / 2;
        const cskAngleRad = (cskAngleDeg / 2) * Math.PI / 180;
        const cskDepth = cskRadius / Math.tan(cskAngleRad);
        // Axis direction = into the body (opposite of face normal),
        // flipped if requested.
        const sign = flipped ? +1 : -1;
        const axisDir = [sign * faceNormal[0], sign * faceNormal[1], sign * faceNormal[2]];
        const revPlaneNormal = norm3(cross3(xAxis, axisDir));
        const revPlane = { origin: pl.position, xAxis, yAxis: axisDir, normal: revPlaneNormal };
        const cskRpc = await client.call('buildRevolve', {
          featureId: `${feature.id}#p${pi}#csk`,
          profile: [
            { kind: 'line', start: { x: 0, y: 0 }, end: { x: cskRadius, y: 0 } },
            { kind: 'line', start: { x: cskRadius, y: 0 }, end: { x: 0, y: cskDepth } },
            { kind: 'line', start: { x: 0, y: cskDepth }, end: { x: 0, y: 0 } },
          ],
          holes: [],
          plane: revPlane,
          axisOrigin: pl.position,
          axisDir,
          angleDeg: 360,
        });
        lastRpc = await client.call('buildBoolean', {
          featureId: `${feature.id}#p${pi}#cskcut`,
          op: 'cut',
          aBrep: chained,
          bBrep: cskRpc.brepBytes,
        });
        chained = lastRpc.brepBytes;
      }
    }

    brep = chained;
    faces = lastRpc.faces || [];
    topology = lastRpc.topology || { vertices: [], edges: [] };
    solids = lastRpc.solids || [];
    cachedFlag = false;
    await dbClient.DesignBRepCache.upsert({
      cadModelID: model.id, featureID: feature.id, paramHash, upstreamHash: target.paramHash,
      brepBytes: Buffer.from(brep || '', 'base64'),
      tessellatedFaces: { faces, topology, solids },
      namingVersion: NAMING_VERSION, lastAccessedAt: new Date(),
    });
  }

  if (solids.length === 0) {
    throw new Error('Hole feature produced no solid. The placement sketch points may all lie outside the body, or the drill depth may be zero.');
  }
  // Adopt the result into the target body slot. Hole never fans out
  // into multiple bodies — drilling can split a body in theory but
  // not within v1 scope, so additional disjoint solids are ignored.
  const scopeId = target.id;
  target.brep = solids[0].brepBytes || brep;
  target.faces = _scopeFaceBoundaryEdges(solids[0].faces || faces, scopeId);
  target.topology = _scopeTopology(solids[0].topology || topology, scopeId);
  target.centroid = solids[0].centroid
    ? [solids[0].centroid[0], solids[0].centroid[1], solids[0].centroid[2]]
    : _approxCentroidFromFaces(target.faces);
  target.paramHash = paramHash;
  for (const v of target.topology.vertices || []) vertexMap.set(v.id, v.position);
  for (const f of target.faces || []) {
    const plane = _faceRepresentativePlane(f);
    if (plane) faceMap.set(f.faceId, plane);
  }
  const result = {
    featureId: feature.id, bodyId: target.id, faces: target.faces, topology: target.topology,
    cached: cachedFlag, bodyParamHash: target.paramHash,
  };
  results.push(result);
  emit(result);
}

/** Dispatch a Shell feature — hollow the most-recent body by removing
 * the picked open faces and offsetting the rest by `thickness` mm.
 * Sign convention: positive thickness = outward, negative = inward.
 * Cache key includes the picked faces' coords + sign so an edit that
 * flips direction invalidates the cache correctly. REQ 659. */
async function _dispatchShell(feature, bodies, model, client, dbClient, results, emit, vertexMap, faceMap) {
  if (bodies.length === 0) {
    throw new Error('Shell feature needs an existing body to hollow. Add an Extrude / Revolve / Sweep first.');
  }
  if (!Array.isArray(feature.faces) || feature.faces.length === 0) {
    throw new Error('Shell feature has no faces picked. Pick at least one face to remove.');
  }
  if (!Number.isFinite(feature.thickness) || feature.thickness === 0) {
    throw new Error(`Shell thickness must be a non-zero finite number (got ${feature.thickness}).`);
  }
  // Sign convention for the kernel: positive = outward (adds material),
  // negative = inward (removes material). The frontend stores
  // `thickness` as a magnitude + a `direction` flag ('inward' /
  // 'outward'); we resolve to the signed kernel value here.
  const magnitude = Math.abs(Number(feature.thickness));
  const inward = feature.direction !== 'outward';  // default to inward (SW default)
  const signedThickness = inward ? -magnitude : magnitude;
  const tolerance = Number.isFinite(feature.tolerance) && feature.tolerance > 0
    ? Number(feature.tolerance) : 1.0e-3;

  const body = bodies[bodies.length - 1];
  // Send the kernel just centroid + normal (and the per-face thickness
  // override, reserved for later) so face matching is geometry-keyed.
  const kernelFaces = feature.faces.map(f => {
    const c = f.fallbackPlane?.origin ?? f.centroid ?? null;
    const n = f.fallbackPlane?.normal ?? f.normal ?? null;
    if (!Array.isArray(c) || c.length !== 3 || !Array.isArray(n) || n.length !== 3) {
      throw new Error(`Shell face pick is missing its centroid/normal snapshot. Re-pick.`);
    }
    return { centroid: c, normal: n, ...(typeof f.thickness === 'number' ? { thickness: f.thickness } : {}) };
  });
  const paramHash = _hashParams({
    op: 'shell',
    faces: kernelFaces,
    thickness: signedThickness,
    tolerance,
    bodyId: body.id,
    upstream: body.paramHash,
  });
  const cacheKey = `${feature.id}#shell#${body.id}`;
  console.log(`[shell:backend] feature=${feature.id} cacheKey=${cacheKey}`);
  console.log(`[shell:backend] paramHash=${paramHash} upstreamHash=${body.paramHash}`);
  console.log(`[shell:backend] kernelFaces=${JSON.stringify(kernelFaces)}`);
  console.log(`[cadRegen] dispatching feature ${feature.id} type=shell (${kernelFaces.length} face(s), thickness=${signedThickness})`);
  const cached = await dbClient.DesignBRepCache.findOne({
    where: {
      cadModelID: model.id,
      featureID: cacheKey,
      paramHash,
      upstreamHash: body.paramHash,
      namingVersion: NAMING_VERSION,
    },
  });
  let brep, faces, topology, solids, cachedFlag;
  if (cached) {
    console.log(`[shell:backend] CACHE HIT for ${cacheKey}`);
    cached.lastAccessedAt = new Date();
    await cached.save();
    brep = Buffer.isBuffer(cached.brepBytes)
      ? cached.brepBytes.toString('base64')
      : Buffer.from(cached.brepBytes || '').toString('base64');
    faces = cached.tessellatedFaces.faces || [];
    topology = cached.tessellatedFaces.topology || { vertices: [], edges: [] };
    solids = cached.tessellatedFaces.solids || [];
    cachedFlag = true;
  } else {
    console.log(`[shell:backend] CACHE MISS — calling kernel`);
    const rpc = await client.call('buildShell', {
      featureId: `${feature.id}#shell`,
      aBrep: body.brep,
      faces: kernelFaces,
      thickness: signedThickness,
      tolerance,
    });
    console.log(`[shell:backend] kernel returned: brepBytes_len=${(rpc.brepBytes||'').length} faces=${(rpc.faces||[]).length} solids=${(rpc.solids||[]).length}`);
    await dbClient.DesignBRepCache.upsert({
      cadModelID: model.id,
      featureID: cacheKey,
      paramHash,
      upstreamHash: body.paramHash,
      brepBytes: Buffer.from(rpc.brepBytes || '', 'base64'),
      tessellatedFaces: { faces: rpc.faces || [], topology: rpc.topology || { vertices: [], edges: [] }, solids: rpc.solids || [] },
      namingVersion: NAMING_VERSION,
      lastAccessedAt: new Date(),
    });
    brep = rpc.brepBytes;
    faces = rpc.faces || [];
    topology = rpc.topology || { vertices: [], edges: [] };
    solids = rpc.solids || [];
    cachedFlag = false;
  }
  if (solids.length === 0) {
    throw new Error('Shell produced no solid — most likely cause is thickness too large for the body (offset surfaces self-intersect). Try a smaller thickness.');
  }
  const primary = solids[0];
  body.brep = primary.brepBytes || brep;
  body.paramHash = paramHash;
  body.faces = _scopeFaceBoundaryEdges(primary.faces || faces, body.id);
  body.topology = _scopeTopology(primary.topology || topology, body.id);
  body.centroid = primary.centroid
    ? [primary.centroid[0], primary.centroid[1], primary.centroid[2]]
    : _approxCentroidFromFaces(body.faces);
  for (const v of body.topology.vertices || []) vertexMap.set(v.id, v.position);
  for (const f of body.faces || []) {
    const plane = _faceRepresentativePlane(f);
    if (plane) faceMap.set(f.faceId, plane);
  }
  const result = {
    featureId: feature.id,
    bodyId: body.id,
    faces: body.faces,
    topology: body.topology,
    cached: cachedFlag,
    bodyParamHash: body.paramHash,
  };
  results.push(result);
  emit(result);
}

async function _composeIntoBody({ feature, prism, body, model, client, dbClient }) {
  const isCut = feature.type === 'cutExtrude' || feature.type === 'cutRevolve' || feature.type === 'cutSweep';
  const op = isCut ? 'cut' : 'fuse';
  console.log(`[cadRegen] composing feature ${feature.id} (${feature.type}) into body ${body.id} via ${op}`);
  const paramHash = _hashParams({
    op,
    featureParamHash: prism.featureParamHash,
    bodyId: body.id,
    // Include the upstream body's hash so this compose hash cascades
    // when ANY upstream feature changes. Without this, `composed.paramHash`
    // only depends on this feature's prism + op + bodyId — meaning a
    // downstream feature whose own prism didn't change will hit the
    // STALE cache row even if an upstream change altered the body
    // it's composing into. Including upstream here makes body.paramHash
    // accumulate the full feature history.
    upstream: body.paramHash,
  });
  // Cache key INCLUDES the body id so a cut that applies to multiple
  // bodies (SolidWorks "all bodies" Feature Scope, our default) caches
  // each per-body result independently — different bodies have different
  // breps, so two calls in the same feature would otherwise collide on
  // the same cache row.
  const cacheKey = `${feature.id}#body#${body.id}`;

  const cached = await dbClient.DesignBRepCache.findOne({
    where: {
      cadModelID: model.id,
      featureID: cacheKey,
      paramHash,
      upstreamHash: body.paramHash,
      namingVersion: NAMING_VERSION,
    },
  });
  if (cached) {
    cached.lastAccessedAt = new Date();
    await cached.save();
    return {
      brep: Buffer.isBuffer(cached.brepBytes)
        ? cached.brepBytes.toString('base64')
        : Buffer.from(cached.brepBytes || '').toString('base64'),
      paramHash,
      faces: cached.tessellatedFaces.faces || [],
      topology: cached.tessellatedFaces.topology || { vertices: [], edges: [] },
      // Per-solid breakdown for SolidWorks-style body tracking. Cached
      // as an array of { brepBytes, centroid, volume, faces, topology }.
      // Empty array means the op produced no solids (cut annihilated
      // the body — handled by the caller as a body deletion).
      solids: cached.tessellatedFaces.solids || [],
      cached: true,
    };
  }

  const rpc = await client.call('buildBoolean', {
    featureId: `${feature.id}#body`,
    op,
    aBrep: body.brep,
    bBrep: prism.prismBrep,
  });

  await dbClient.DesignBRepCache.upsert({
    cadModelID: model.id,
    featureID: cacheKey,
    paramHash,
    upstreamHash: body.paramHash,
    brepBytes: Buffer.from(rpc.brepBytes || '', 'base64'),
    tessellatedFaces: { faces: rpc.faces, topology: rpc.topology, solids: rpc.solids || [] },
    namingVersion: NAMING_VERSION,
    lastAccessedAt: new Date(),
  });

  return {
    brep: rpc.brepBytes,
    paramHash,
    faces: rpc.faces || [],
    topology: rpc.topology || { vertices: [], edges: [] },
    solids: rpc.solids || [],
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
/** Approximate centroid of a body from its tessellated faces. Vertex
 * average — biased by tessellation density on curved surfaces, but
 * cheap and good enough for identity matching across regen ops (the
 * body's centroid stays close to itself even when surrounding geometry
 * changes). Used to track which result solid is "the same body" after
 * a boolean op produces multiple disjoint pieces. Returns null when
 * the faces are empty or malformed. */
function _approxCentroidFromFaces(faces) {
  if (!Array.isArray(faces) || faces.length === 0) return null;
  let sx = 0, sy = 0, sz = 0, n = 0;
  for (const f of faces) {
    const pos = f.positions;
    if (!pos) continue;
    const vCount = (pos.length / 3) | 0;
    for (let i = 0; i < vCount; i++) {
      sx += pos[i * 3 + 0];
      sy += pos[i * 3 + 1];
      sz += pos[i * 3 + 2];
    }
    n += vCount;
  }
  if (n === 0) return null;
  return [sx / n, sy / n, sz / n];
}

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

/**
 * Re-derive a face-hosted sketch's plane from its host face's CURRENT
 * geometry. Returns the SAME plane object when nothing changes (datum host,
 * or no resolvable host face) so callers can detect "changed" by identity.
 *
 * A host face that moved by an upstream edit shifts ALONG ITS NORMAL (a height
 * change) far more often than it rotates, and its in-plane orientation
 * (xAxis/yAxis) is unchanged in that case. faceMap only carries each face's
 * centroid + normal (not a full basis), so we keep the baked xAxis/yAxis/normal
 * and only re-project the baked origin onto the current face plane. That snaps
 * the sketch onto the moved face while preserving the 2D layout drawn on it.
 *
 * Resolution: exact persistent-faceId lookup first; if the id was re-tagged by
 * an upstream topology change, fall back to the parallel face nearest the baked
 * origin (the host was on/at the baked origin at creation time).
 */
function _resolveHostFacePlane(sketch, faceMap) {
  const plane = sketch && sketch.plane;
  if (!plane || !sketch.hostId || !sketch.hostId.startsWith('face:')) return plane;
  const faceId = sketch.hostId.slice('face:'.length);
  let rep = faceMap.get(faceId);
  if (!rep) {
    // Geometric fallback — parallel face whose plane is nearest the baked origin.
    let best = null, bestDist = Infinity;
    for (const cand of faceMap.values()) {
      if (!cand || !cand.normal || !cand.centroid) continue;
      const dot = cand.normal[0] * plane.normal[0] + cand.normal[1] * plane.normal[1] + cand.normal[2] * plane.normal[2];
      if (Math.abs(dot) < 0.999) continue;
      const dist = Math.abs(
        (plane.origin[0] - cand.centroid[0]) * plane.normal[0] +
        (plane.origin[1] - cand.centroid[1]) * plane.normal[1] +
        (plane.origin[2] - cand.centroid[2]) * plane.normal[2]);
      if (dist < bestDist) { bestDist = dist; best = cand; }
    }
    rep = best;
  }
  if (!rep || !rep.centroid) return plane;
  // Project the baked origin onto the current face plane along the sketch normal.
  const n = plane.normal;
  const o = plane.origin;
  const c = rep.centroid;
  const d = (o[0] - c[0]) * n[0] + (o[1] - c[1]) * n[1] + (o[2] - c[2]) * n[2];
  if (Math.abs(d) < 1.0e-9) return plane; // already on the face — no change
  return { ...plane, origin: [o[0] - d * n[0], o[1] - d * n[1], o[2] - d * n[2]] };
}

/** Warn for USED face-hosted sketches whose reference face is gone. A face is
 * "gone" when its exact persistent id isn't in the final faceMap AND there's no
 * coincident parallel face at the sketch's baked plane (within tol). A
 * coincident match means the face was merely re-tagged (same geometry) — that
 * tracks silently; a far/absent match means the host feature was deleted or
 * moved, so the sketch is on a fallback plane and the user should re-pick. */
function _danglingHostFaceWarnings(sketchDoc, faceMap, usedSketchIds) {
  const warnings = [];
  const sketchIds = [];
  // sketchId → current geometry faceId the host resolves to (for the 3D
  // highlight). Only populated for sketches whose host face is still present.
  const resolved = {};
  // No geometry to compare against (empty model, or rolled back before any
  // solid) ⇒ we can't conclude a host face is "missing" vs just not-yet-built.
  // Mirror _applyHostFacePlanes's guard and report nothing.
  if (!sketchDoc || !sketchDoc.sketches || !faceMap || faceMap.size === 0) return { warnings, sketchIds, resolved };
  // Resolution + dangling detection runs for EVERY face-hosted sketch so the
  // editor can highlight (or flag) any sketch the user inspects. Only the
  // toast warning is gated to USED sketches — an unused sketch on a fallback
  // plane is harmless noise, but the user still wants to see its row flagged.
  for (const [sid, sk] of Object.entries(sketchDoc.sketches)) {
    if (!sk || !sk.hostId || !sk.hostId.startsWith('face:')) continue;
    const faceId = sk.hostId.slice('face:'.length);
    if (faceMap.has(faceId)) { resolved[sid] = faceId; continue; }  // exact reference face still present
    const plane = sk.plane;
    if (!plane || !plane.normal || !plane.origin) continue;
    // The host's structured name rarely matches a faceMap key verbatim, so
    // resolve to the nearest coincident parallel face (same heuristic
    // _resolveHostFacePlane uses to place the sketch). Capture its KEY so the
    // editor can highlight it. A far/absent match ⇒ the host is gone.
    let bestDist = Infinity, bestId = null;
    for (const [candId, cand] of faceMap.entries()) {
      if (!cand || !cand.normal || !cand.centroid) continue;
      const dot = cand.normal[0] * plane.normal[0] + cand.normal[1] * plane.normal[1] + cand.normal[2] * plane.normal[2];
      if (Math.abs(dot) < 0.999) continue;  // not parallel
      const dist = Math.abs(
        (plane.origin[0] - cand.centroid[0]) * plane.normal[0] +
        (plane.origin[1] - cand.centroid[1]) * plane.normal[1] +
        (plane.origin[2] - cand.centroid[2]) * plane.normal[2]);
      if (dist < bestDist) { bestDist = dist; bestId = candId; }
    }
    if (bestDist > 1.0e-3) {
      sketchIds.push(sid);
      if (usedSketchIds.has(sid)) {
        warnings.push(`Sketch "${sk.name || sid}" lost its reference face (its host feature was deleted or changed). It's now on a fallback plane — re-pick the sketch's reference face (right-click the sketch → Change reference face).`);
      }
    } else if (bestId) {
      resolved[sid] = bestId;
    }
  }
  return { warnings, sketchIds, resolved };
}

/**
 * Apply {@link _resolveHostFacePlane} to every sketch in a doc. Clones only the
 * sketches whose plane actually moved (and the doc) so the stored model is
 * never mutated; returns the input doc unchanged when nothing moved.
 */
function _applyHostFacePlanes(sketchDoc, faceMap) {
  if (!sketchDoc || !sketchDoc.sketches || !faceMap || faceMap.size === 0) return sketchDoc;
  let changed = false;
  const next = {};
  for (const [sid, sk] of Object.entries(sketchDoc.sketches)) {
    const np = _resolveHostFacePlane(sk, faceMap);
    if (sk && np !== sk.plane) { next[sid] = { ...sk, plane: np }; changed = true; }
    else { next[sid] = sk; }
  }
  return changed ? { ...sketchDoc, sketches: next } : sketchDoc;
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
/** Compute the signed start offset (along sketch.plane.normal) implied
 * by an ExtrudeStartCondition. sketchPlane → 0; offset → signed
 * distance; upToVertex/upToSurface → projection of the vertex/face onto
 * the sketch normal. Throws on missing target / unresolvable lookup so
 * the caller surfaces a clear error rather than silently producing the
 * wrong start plane. */
function _resolveStartOffset(startCondition, plane, vertexMap, faceMap) {
  if (!startCondition || startCondition.kind === 'sketchPlane') return 0;
  if (startCondition.kind === 'offset') return Number(startCondition.distance) || 0;
  if (startCondition.kind === 'upToVertex') {
    const pos = vertexMap && vertexMap.get(startCondition.vertexId);
    if (!pos) {
      throw new Error(
        `Start condition Up to Vertex: vertex '${startCondition.vertexId}' not found in any ` +
        `upstream feature's topology. Re-pick the start vertex.`
      );
    }
    return (pos[0] - plane.origin[0]) * plane.normal[0]
         + (pos[1] - plane.origin[1]) * plane.normal[1]
         + (pos[2] - plane.origin[2]) * plane.normal[2];
  }
  if (startCondition.kind === 'upToSurface') {
    let target = faceMap && faceMap.get(startCondition.faceId);
    if (!target && startCondition.fallbackPlane) {
      target = {
        origin: startCondition.fallbackPlane.origin,
        normal: startCondition.fallbackPlane.normal,
        centroid: startCondition.fallbackPlane.origin,
      };
    }
    if (!target) {
      throw new Error(
        `Start condition Up to Surface: face '${startCondition.faceId}' not found in any ` +
        `upstream feature. Re-pick the start face.`
      );
    }
    // Project the face centroid onto the sketch normal — same approach
    // the end-condition Up to Surface uses, just for the start.
    return (target.centroid[0] - plane.origin[0]) * plane.normal[0]
         + (target.centroid[1] - plane.origin[1]) * plane.normal[1]
         + (target.centroid[2] - plane.origin[2]) * plane.normal[2];
  }
  if (startCondition.kind === 'offsetFromSurface') {
    let target = faceMap && faceMap.get(startCondition.faceId);
    if (!target && startCondition.fallbackPlane) {
      target = {
        origin: startCondition.fallbackPlane.origin,
        normal: startCondition.fallbackPlane.normal,
        centroid: startCondition.fallbackPlane.origin,
      };
    }
    if (!target) {
      throw new Error(
        `Start condition Offset from face: face '${startCondition.faceId}' not found in any ` +
        `upstream feature. Re-pick the reference face.`
      );
    }
    // End plane = face centroid + offset * face.normal (offset signed
    // along the face's outward normal). Project onto sketch normal to
    // get the start offset along the sketch normal direction.
    const n = plane.normal;
    const fn = target.normal;
    const dot = n[0] * fn[0] + n[1] * fn[1] + n[2] * fn[2];
    const faceSigned = (target.centroid[0] - plane.origin[0]) * n[0]
                     + (target.centroid[1] - plane.origin[1]) * n[1]
                     + (target.centroid[2] - plane.origin[2]) * n[2];
    return faceSigned + (Number(startCondition.offset) || 0) * dot;
  }
  return 0;
}

/** Resolve a direction-2 ExtrudeDirection into the kernel's
 * `{ distance, kind }` payload. Direction 2 always extrudes OPPOSITE
 * to direction 1, so for Up-to-* / Offset-from-face we measure the
 * signed projection along the sketch normal and negate per the
 * direction-1 flip flag. Blind / Through All pass through. */
function _resolveDirection2(direction2, plane, feature, vertexMap, faceMap) {
  const ec = direction2.endCondition || { kind: 'blind' };
  if (ec.kind === 'blind') return { distance: Number(direction2.distance) || 0, kind: 'blind' };
  if (ec.kind === 'throughAll') return { distance: 0, kind: 'throughAll' };
  // "Up to Body" / "Up to Next": the kernel sizes + caps the dir-2 prism
  // against body BREP(s). Distance is irrelevant here; the target BREPs are
  // attached to the payload by the caller (which has the body list). Carry the
  // picked bodyId through for the caller to resolve.
  if (ec.kind === 'upToBody') return { distance: 0, kind: 'upToBody', bodyId: ec.bodyId };
  if (ec.kind === 'upToNext') return { distance: 0, kind: 'upToNext' };
  // dir2 grows OPPOSITE direction-1. If feature.flipped=false, dir1 is
  // along +normal so dir2 is along -normal — to reach a target on the
  // -normal side, we need positive distance. signed projection along
  // +normal is negative for a -normal target, so we negate. With
  // feature.flipped=true the relationship inverts.
  const sketchN = plane.normal;
  let signed; // projection of target onto +normal from sketch origin
  if (ec.kind === 'upToVertex') {
    const pos = vertexMap && vertexMap.get(ec.vertexId);
    if (!pos) throw new Error(`Direction 2 Up to Vertex: vertex '${ec.vertexId}' not found in any upstream feature's topology. Re-pick the target vertex.`);
    signed = (pos[0] - plane.origin[0]) * sketchN[0]
           + (pos[1] - plane.origin[1]) * sketchN[1]
           + (pos[2] - plane.origin[2]) * sketchN[2];
  } else if (ec.kind === 'upToSurface' || ec.kind === 'offsetFromSurface') {
    let target = faceMap && faceMap.get(ec.faceId);
    if (!target && ec.fallbackPlane) {
      target = { origin: ec.fallbackPlane.origin, normal: ec.fallbackPlane.normal, centroid: ec.fallbackPlane.origin };
    }
    if (!target) throw new Error(`Direction 2 ${ec.kind}: face '${ec.faceId}' not found in any upstream feature. Re-pick the target face.`);
    const fn = target.normal;
    const dot = sketchN[0] * fn[0] + sketchN[1] * fn[1] + sketchN[2] * fn[2];
    if (Math.abs(Math.abs(dot) - 1) > 1e-3) {
      throw new Error(`Direction 2 ${ec.kind}: target face must be perpendicular to the extrude direction.`);
    }
    const faceSigned = (target.centroid[0] - plane.origin[0]) * sketchN[0]
                     + (target.centroid[1] - plane.origin[1]) * sketchN[1]
                     + (target.centroid[2] - plane.origin[2]) * sketchN[2];
    signed = ec.kind === 'offsetFromSurface'
      ? faceSigned + (Number(ec.offset) || 0) * dot
      : faceSigned;
  } else {
    throw new Error(`Direction 2 end condition '${ec.kind}' is not supported.`);
  }
  // dir2 distance along the dir2 direction. With flipped=false (dir1
  // along +normal), dir2 is along -normal — so a -normal-side target
  // (signed < 0) gives positive distance after negation.
  const dir2DistanceSigned = feature.flipped ? signed : -signed;
  if (dir2DistanceSigned <= 1e-6) {
    throw new Error(`Direction 2 ${ec.kind}: target is not on the direction-2 side of the sketch plane (signed=${dir2DistanceSigned.toFixed(3)}).`);
  }
  return { distance: dir2DistanceSigned, kind: 'blind' };
}

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
      // Is a candidate face perpendicular to the extrude direction (its normal
      // parallel to the sketch normal)? |cos angle| ≈ 1.
      const n = plane.normal;
      const isPerp = (t) => {
        if (!t || !t.normal) return false;
        const d = n[0] * t.normal[0] + n[1] * t.normal[1] + n[2] * t.normal[2];
        return Math.abs(Math.abs(d) - 1) <= 1e-3;
      };
      // Two-stage lookup: prefer the persistent face id from an upstream
      // feature's topology, but fall back to the plane the frontend captured at
      // pick time when the persistent id can't be resolved — OR when it resolves
      // to an UNSUITABLE (oblique) face. The latter happens when an upstream
      // change (e.g. a merge that keeps a feature the branch removed) renumbers
      // the body's faces, so the stored sub-index now points at the wrong face;
      // the pick-time plane still describes the intended perpendicular target.
      let target = faceMap && faceMap.get(endCondition.faceId);
      if ((!target || !isPerp(target)) && endCondition.fallbackPlane) {
        target = {
          origin: endCondition.fallbackPlane.origin,
          normal: endCondition.fallbackPlane.normal,
          centroid: endCondition.fallbackPlane.origin,
        };
      }
      if (!target) {
        throw new Error(
          `Up to Surface: face '${endCondition.faceId}' not found in any upstream feature. ` +
          `Re-pick the target face.`
        );
      }
      // Oblique / curved targets need BRepFeat_MakeDPrism (kernel work, future
      // pass) — reject only if even the fallback plane isn't perpendicular.
      if (!isPerp(target)) {
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
    case 'offsetFromSurface': {
      // End plane is parallel to the picked face, offset by `offset`
      // along the face's outward normal. Same fallback semantics as
      // upToSurface, same parallel-normal restriction. The signed
      // total distance from the sketch plane = face-centroid distance
      // + offset * dot(face.normal, sketch.normal).
      let target = faceMap && faceMap.get(endCondition.faceId);
      if (!target && endCondition.fallbackPlane) {
        target = {
          origin: endCondition.fallbackPlane.origin,
          normal: endCondition.fallbackPlane.normal,
          centroid: endCondition.fallbackPlane.origin,
        };
      }
      if (!target) {
        throw new Error(
          `Offset from face: face '${endCondition.faceId}' not found in any upstream ` +
          `feature. Re-pick the reference face.`
        );
      }
      const n = plane.normal;
      const fn = target.normal;
      const dot = n[0] * fn[0] + n[1] * fn[1] + n[2] * fn[2];
      if (Math.abs(Math.abs(dot) - 1) > 1e-3) {
        throw new Error(
          'Offset from face: reference face must be perpendicular to the extrude direction.'
        );
      }
      const dx = target.centroid[0] - plane.origin[0];
      const dy = target.centroid[1] - plane.origin[1];
      const dz = target.centroid[2] - plane.origin[2];
      const faceSigned = dx * n[0] + dy * n[1] + dz * n[2];
      const total = faceSigned + (Number(endCondition.offset) || 0) * dot;
      if (Math.abs(total) < 1e-6) {
        throw new Error('Offset from face: resulting end plane coincides with the sketch — nothing to extrude.');
      }
      return { plane, distance: Math.abs(total), flipped: total < 0 };
    }
    case 'upToBody':
    case 'upToNext':
      // Distance is determined by the kernel from the target body BREP(s) (sent
      // as `untilBrep` / `untilBreps`); only the workplane + direction matter
      // here. `flipped` is the user's Reverse toggle, picking which side to grow.
      return { plane, distance: 0, flipped: baseFlipped };
    default:
      throw new Error(`unknown extrude end condition: ${JSON.stringify(endCondition)}`);
  }
}

// Concat per-call topology into the feature-wide topology with namespaced
// IDs so vertex/edge IDs don't collide across loops or features. Preserves
// the polyline + isTangent fields so the viewer can render curved edges
// smoothly and style tangent boundaries (e.g. fillet) lighter.
function _mergeTopology(acc, topo, scope) {
  if (!topo) return;
  for (const v of topo.vertices || []) {
    acc.vertices.push({ id: `${scope}/${v.id}`, position: v.position });
  }
  for (const e of topo.edges || []) {
    const out = {
      id: `${scope}/${e.id}`,
      isStraight: !!e.isStraight,
      endpoints: e.endpoints,
    };
    if (e.isTangent) out.isTangent = true;
    if (e.polyline) out.polyline = e.polyline;
    acc.edges.push(out);
  }
}

/** Return a copy of `faces` with each face's `boundaryEdgeIds` re-prefixed
 * to match the scoped topology edge IDs `_mergeTopology` produces. Without
 * this, faces would carry kernel-local IDs (`e0`, `e3`) while the merged
 * topology uses scoped IDs (`f2#0/e0`, `f2#0/e3`) and "click a face to
 * pick all its edges" would silently no-op. */
function _scopeFaceBoundaryEdges(faces, scope) {
  if (!Array.isArray(faces)) return faces;
  return faces.map(f => (
    Array.isArray(f.boundaryEdgeIds) && f.boundaryEdgeIds.length > 0
      ? { ...f, boundaryEdgeIds: f.boundaryEdgeIds.map(id => `${scope}/${id}`) }
      : f
  ));
}

/** Return a copy of `topo` with vertex + edge IDs prefixed by `scope`.
 * Per-solid topology from the kernel uses local IDs (`e0`, `e1`, …) —
 * two bodies' topologies will collide on the frontend's edge-id keyed
 * Map (causing scene leakage where overwritten lines linger). Scoping
 * by body id makes them unique. */
function _scopeTopology(topo, scope) {
  if (!topo) return { vertices: [], edges: [] };
  return {
    vertices: (topo.vertices || []).map(v => ({ id: `${scope}/${v.id}`, position: v.position })),
    edges: (topo.edges || []).map(e => {
      const out = {
        id: `${scope}/${e.id}`,
        isStraight: !!e.isStraight,
        endpoints: e.endpoints,
      };
      if (e.isTangent) out.isTangent = true;
      if (e.polyline) out.polyline = e.polyline;
      return out;
    }),
  };
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
  exportBodyBreps,
  exportModelStep,
  exportModelStl,
  NAMING_VERSION,
  _buildExternalEdges, // exported for unit tests (REQ 770/773)
  _danglingHostFaceWarnings, // exported for unit tests (host-face resolution / dangling detection)
};
