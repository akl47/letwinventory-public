'use strict';

// Assembly regeneration (REQ 752): resolve each component instance to its source
// geometry, apply the instance placement transform, scope every body/face/edge id
// by the instance id so identifiers are unique across components, and compose a
// single assembly geometry plus a per-instance roster.
//
// The child-geometry resolver is injectable so the composition/scoping/cycle logic
// is unit-testable without a CAD kernel. In production the default resolver
// regenerates (or, later, reuses frozen geometry for) each referenced part's CAD
// model.

const { Op } = require('sequelize');
const cadRegenService = require('./cadRegenService');
const cadVcsService = require('./vcs/cadVcsService');
const vcsService = require('./vcs/vcsService');
const { cadDeserialize } = require('./vcs/cadSerializer');
const mateSolver = require('./assemblyMateSolver');
const { relativePlacement, transformPoint } = require('./cadTransform');
const { resolveEdgeRef, resolveVertexRef } = require('./cadExternalRef');

const IDENTITY_PLACEMENT = { translate: [0, 0, 0], quaternion: [0, 0, 0, 1] };

// ── small vec/quat helpers (placement = translate + unit quaternion) ──────────
function qRotate(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}

function placementOf(instance) {
  const p = instance && instance.placement ? instance.placement : IDENTITY_PLACEMENT;
  const t = Array.isArray(p.translate) && p.translate.length === 3 ? p.translate : [0, 0, 0];
  const q = Array.isArray(p.quaternion) && p.quaternion.length === 4 ? p.quaternion : [0, 0, 0, 1];
  return { t, q };
}

function vnorm3(a) {
  const l = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
  return l < 1e-12 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
}

// A geometric transform exposes point(p) and dir(d), plus a `flip` flag that is
// true when the transform inverts orientation (a mirror) so triangle winding
// must be reversed to keep outward-facing normals.
function rigidTransform(q, t) {
  return {
    point: (p) => { const r = qRotate(q, p); return [r[0] + t[0], r[1] + t[1], r[2] + t[2]]; },
    dir: (d) => qRotate(q, d),
    flip: false,
  };
}

// Reflect across a world plane the geometry of a component first placed by (q,t).
function mirrorTransform(q, t, planeOrigin, planeNormal) {
  const n = vnorm3(planeNormal); const o = planeOrigin || [0, 0, 0];
  const reflectPt = (w) => { const d = (w[0] - o[0]) * n[0] + (w[1] - o[1]) * n[1] + (w[2] - o[2]) * n[2]; return [w[0] - 2 * d * n[0], w[1] - 2 * d * n[1], w[2] - 2 * d * n[2]]; };
  const reflectDir = (w) => { const d = w[0] * n[0] + w[1] * n[1] + w[2] * n[2]; return [w[0] - 2 * d * n[0], w[1] - 2 * d * n[1], w[2] - 2 * d * n[2]]; };
  return {
    point: (p) => { const r = qRotate(q, p); return reflectPt([r[0] + t[0], r[1] + t[1], r[2] + t[2]]); },
    dir: (d) => reflectDir(qRotate(q, d)),
    flip: true,
  };
}

function applyToBuffer(arr, fn) {
  if (!Array.isArray(arr)) return arr;
  const out = new Array(arr.length);
  for (let i = 0; i < arr.length; i += 3) { const r = fn([arr[i], arr[i + 1], arr[i + 2]]); out[i] = r[0]; out[i + 1] = r[1]; out[i + 2] = r[2]; }
  return out;
}

function transformSurface(surface, xform) {
  if (!surface) return surface;
  const out = { ...surface };
  if (surface.origin) out.origin = xform.point(surface.origin);
  if (surface.normal) out.normal = xform.dir(surface.normal);
  if (surface.axis) out.axis = xform.dir(surface.axis);
  return out;
}

function transformFace(face, xform) {
  let indices = face.indices;
  if (xform.flip && Array.isArray(indices)) {
    indices = indices.slice();
    for (let i = 0; i + 2 < indices.length; i += 3) { const tmp = indices[i + 1]; indices[i + 1] = indices[i + 2]; indices[i + 2] = tmp; }
  }
  return {
    ...face,
    positions: applyToBuffer(face.positions, xform.point),
    normals: applyToBuffer(face.normals, xform.dir),
    indices,
    surface: transformSurface(face.surface, xform),
  };
}

function transformEdge(edge, xform) {
  const poly = Array.isArray(edge.polyline) ? edge.polyline.map((p) => xform.point(p)) : edge.polyline;
  return { ...edge, polyline: poly };
}

// Prefix an id with the instance scope so ids are unique across components.
const scopeId = (instanceId, id) => `${instanceId}::${id}`;

function scopeFace(instanceId, face) {
  const name = face.persistentName || face.faceId;
  const scoped = scopeId(instanceId, name);
  return { ...face, persistentName: scoped, faceId: scoped };
}

// ── child-geometry shaping ────────────────────────────────────────────────────

// Collapse a raw regen result (per-feature cumulative state) to the FINAL
// renderable geometry per body — same last-write-wins the editor/controller use.
// Returns { faces, vertices, edges, bodies:[{id,name,brep?,faces,vertices,edges}] }.
function flattenChildGeometry(regen) {
  const perBody = new Map();
  for (const f of regen.features || []) {
    if (f.error) continue;
    const bid = f.bodyId || f.featureId;
    if ((f.faces || []).length) perBody.set(bid, f);
  }
  const roster = (regen.bodies && regen.bodies.length)
    ? regen.bodies.filter((b) => perBody.has(b.id))
    : [...perBody.keys()].map((id) => ({ id, name: null }));
  const faces = []; const vertices = []; const edges = []; const bodies = [];
  for (const b of roster) {
    const f = perBody.get(b.id);
    if (!f) continue;
    const bFaces = (f.faces || []).map((face) => ({
      persistentName: face.persistentName, faceId: face.faceId || face.persistentName,
      positions: face.positions, normals: face.normals, indices: face.indices,
      surface: face.surface,
    }));
    const bVerts = []; const bEdges = [];
    const topo = f.topology || {};
    for (const v of topo.vertices || []) if (v.position) bVerts.push(v.position);
    for (const e of topo.edges || []) {
      const poly = (e.polyline && e.polyline.length) ? e.polyline : (e.endpoints || []);
      if (poly.length >= 2) {
        // Preserve the edge id + endpoints so cross-part references (REQ 777) can
        // re-resolve a source edge by id or by closest-endpoint fallback.
        bEdges.push({ id: e.id, polyline: poly, endpoints: e.endpoints, isStraight: e.isStraight });
      }
    }
    faces.push(...bFaces); vertices.push(...bVerts); edges.push(...bEdges);
    bodies.push({
      id: b.id, name: b.name || null, brep: b.brep, faces: bFaces, vertices: bVerts, edges: bEdges,
      // Mass data for assembly mass properties (REQ 768), if the kernel reported it.
      volume: typeof b.volume === 'number' ? b.volume : (typeof f.volume === 'number' ? f.volume : undefined),
      centroid: b.centroid || f.centroid || undefined,
    });
  }
  return { faces, vertices, edges, bodies };
}

// All Parts ids in a revision lineage (walk up to the root, then BFS down).
// Mirrors the cad-model controller's lineagePartIds so component resolution
// keeps working after a release moves the part's design to a new Parts row.
async function lineagePartIds(partID, db) {
  let part = await db.Part.findByPk(partID);
  if (!part) return [partID];
  const seen = new Set();
  while (part.previousRevisionID && !seen.has(part.id)) {
    seen.add(part.id);
    const prev = await db.Part.findByPk(part.previousRevisionID);
    if (!prev) break;
    part = prev;
  }
  const all = new Set([part.id]);
  let frontier = [part.id];
  while (frontier.length) {
    const kids = await db.Part.findAll({ where: { previousRevisionID: frontier }, attributes: ['id'] });
    frontier = kids.map((k) => k.id).filter((id) => !all.has(id));
    frontier.forEach((id) => all.add(id));
  }
  return [...all];
}

// REQ 788 — decide WHAT state of a component's part design an instance resolves:
//   - no tracked branch (legacy) or the tracked branch IS the part's checked-out
//     branch → the live working copy ({ source: 'working' });
//   - any other tracked branch → that branch's head commit, with the doc
//     materialized from the VCS ({ source: 'commit', commitHash, doc });
//   - tracked branch gone (released → archived) → fall back to main
//     (fellBack: true, reported by the caller).
// The part row is found across the revision lineage so a released part keeps
// resolving. Exported separately from the kernel wiring so it's unit-testable.
async function resolveChildSource(instance, db) {
  const partInclude = { model: db.Part, as: 'part', attributes: ['id', 'name', 'sku', 'manufacturerPN', 'revision'] };
  let row = await db.DesignCADModel.findOne({
    where: { partID: instance.partID, activeFlag: true }, include: [partInclude],
  });
  if (!row) {
    const ids = await lineagePartIds(instance.partID, db);
    row = await db.DesignCADModel.findOne({
      where: { partID: { [Op.in]: ids }, activeFlag: true }, include: [partInclude],
    });
  }
  if (!row) {
    const err = new Error(`Component part ${instance.partID} has no design (CAD or assembly) to resolve`);
    err.statusCode = 422;
    throw err;
  }
  const tracked = instance.ref && instance.ref.branch;
  if (!tracked || row.isAssembly) return { row, source: 'working' };
  if (tracked === (row.branchName || 'main')) return { row, source: 'working' };
  const repo = await cadVcsService.repoForModel(row, db);
  let branch = tracked;
  let fellBack = false;
  let ref = await vcsService.getRef(repo, branch, db);
  if (!ref) { branch = 'main'; fellBack = true; ref = await vcsService.getRef(repo, 'main', db); }
  // No commits at all (repo never seeded) — degrade to the working copy.
  if (!ref) return { row, source: 'working', fellBack: true, branch: row.branchName || 'main' };
  const commit = await vcsService.getCommit(repo, ref.targetHash, db);
  const doc = await cadDeserialize(repo, commit.treeHash, db);
  return { row, source: 'commit', branch, fellBack, commitHash: ref.targetHash, doc };
}

// Resolved-child-geometry cache. An assembly regen re-resolves EVERY component;
// a drag or mate edit only changes placements, so unchanged leaf parts can skip
// the kernel feature replay entirely. Keyed by the child row's id + updatedAt
// (any save bumps it) + the engraved __partRevision; consumers (Phase C
// transforms, cross-part edge reads) copy rather than mutate, so entries are
// safe to share. Skipped when a live externalRefResolver is in play (those
// regens depend on OTHER parts' current geometry). Leaf parts only — a nested
// assembly's row doesn't change when its own children do.
const CHILD_GEO_CACHE = new Map();
const CHILD_GEO_CACHE_MAX = 16;
function childGeoCachePut(key, value) {
  if (CHILD_GEO_CACHE.has(key)) CHILD_GEO_CACHE.delete(key);
  CHILD_GEO_CACHE.set(key, value);
  while (CHILD_GEO_CACHE.size > CHILD_GEO_CACHE_MAX) {
    CHILD_GEO_CACHE.delete(CHILD_GEO_CACHE.keys().next().value);
  }
}

// Default resolver: produce a component's child geometry. Assemblies live in the
// unified DesignCADModels table; the row's `isAssembly` flag dispatches between
// recursive assembly regen (REQ 763, one rigid child) and part-CAD regen. The
// instance's `ref.kind` is advisory only — dispatching on the row self-heals
// stale kinds (e.g. a part later converted between kinds).
function defaultResolveChild({ db, kernelClient }) {
  return async (instance, assembly, resolveOpts = {}) => {
    // REQ 788 — pick the source state: live working copy or a tracked branch's
    // head commit. The Part is included so `#{partName}`/`#{partNumber}`/…
    // sketch text variables resolve during regen.
    const src = await resolveChildSource(instance, db);
    const row = src.row;
    if (src.fellBack && resolveOpts.warn) {
      resolveOpts.warn(`Instance ${instance.instanceId}: tracked branch "${instance.ref && instance.ref.branch}" no longer exists — using ${src.branch}`);
    }
    if (row.isAssembly) {
      const sub = await regenerateAssembly(row, { db, kernelClient });
      // The sub-assembly's composed bodies are already placed in its own frame;
      // treat the whole thing as one rigid child (its body ids stay sub-scoped).
      return { faces: sub.faces, vertices: sub.vertices, edges: sub.edges, bodies: sub.bodies };
    }
    // `#{partRevision}` = the rev being worked on — a draft branch's derived
    // display rev (highest released + 1), or the released revision on main —
    // matching what the part editor bakes (cad-model regenerate handler).
    const onMainBranch = src.source === 'commit'
      ? src.branch === 'main'
      : (row.branchName || 'main') === 'main';
    const partRevision = onMainBranch
      ? (row.part && row.part.revision) || ''
      : await cadVcsService.derivedDraftRev(row, db);

    // Per-instance configuration (REQ: configurations) — the instance may pin
    // a child-part configuration; undefined = the child's own active config.
    const configurationId = instance.configurationId || null;

    if (src.source === 'commit') {
      // Branch-head doc materialized from the VCS — immutable, so cache by hash
      // (+ configuration: the same commit yields different geometry per config).
      const cacheKey = `commit:${row.id}:${src.commitHash}:${configurationId || ''}`;
      if (CHILD_GEO_CACHE.has(cacheKey)) return CHILD_GEO_CACHE.get(cacheKey);
      const modelLike = {
        id: row.id,
        featureTree: src.doc.featureTree,
        sketchDoc: src.doc.sketchDoc,
        equations: src.doc.equations,
        part: row.part,
        __partRevision: partRevision,
      };
      const regen = await cadRegenService.regenerateModel(modelLike, { kernelClient, db, includeBodyBreps: true, configurationId });
      const flat = flattenChildGeometry(regen);
      childGeoCachePut(cacheKey, flat);
      return flat;
    }

    row.__partRevision = partRevision;
    const cacheable = !resolveOpts.externalRefResolver;
    const cacheKey = `${row.id}:${row.updatedAt ? new Date(row.updatedAt).getTime() : 0}:${row.__partRevision}:${configurationId || ''}`;
    if (cacheable && CHILD_GEO_CACHE.has(cacheKey)) return CHILD_GEO_CACHE.get(cacheKey);
    const regen = await cadRegenService.regenerateModel(row, {
      kernelClient, db, includeBodyBreps: true, configurationId,
      externalRefResolver: resolveOpts.externalRefResolver, // live cross-part edges (Phase B.5)
    });
    const flat = flattenChildGeometry(regen);
    if (cacheable) childGeoCachePut(cacheKey, flat);
    return flat;
  };
}

// ── cycle detection ───────────────────────────────────────────────────────────

// Reject an assembly that transitively contains itself. Walks referenced parts
// that are themselves assemblies (subassemblies, Phase 3); the direct case
// (inserting the assembly's own part) is caught without a DB.
async function assertAcyclic(assembly, db, visited = new Set()) {
  if (visited.has(assembly.partID)) {
    const err = new Error('Circular assembly reference: an assembly cannot contain itself');
    err.statusCode = 409;
    throw err;
  }
  visited.add(assembly.partID);
  const instances = ((assembly.assemblyDoc || {}).instances) || [];
  for (const inst of instances) {
    if (inst.partID === assembly.partID) {
      const err = new Error('Circular assembly reference: an assembly cannot contain itself');
      err.statusCode = 409;
      throw err;
    }
    if (!db || !db.DesignCADModel) continue;
    const childAssembly = await db.DesignCADModel.findOne({ where: { partID: inst.partID, activeFlag: true, isAssembly: true } });
    if (childAssembly) await assertAcyclic(childAssembly, db, new Set(visited));
  }
}

// ── cross-part in-context references (REQ 770/772/776/777) ────────────────────

// Extract a part's cross-part on-edge references that are DEFINED BY this
// assembly. Each becomes a dependency edge (this instance → sourceInstanceId).
function crossPartRefsOf(sketchDoc, assemblyId) {
  const out = [];
  for (const sketch of Object.values((sketchDoc && sketchDoc.sketches) || {})) {
    for (const c of (sketch && sketch.state && sketch.state.constraints) || []) {
      const er = c.externalRef;
      if (c.type !== 'on-edge' || !er || er.scope !== 'cross-part') continue;
      if (assemblyId != null && er.definingAssemblyId != null && er.definingAssemblyId !== assemblyId) continue;
      out.push({ constraintId: c.id, sourceInstanceId: er.sourceInstanceId, externalRef: er });
    }
  }
  return out;
}

// Default cross-part-ref loader: read the instance's active CAD model's sketchDoc.
function defaultChildRefs({ db }) {
  return async (instance, assemblyId) => {
    if (!db || !db.DesignCADModel) return [];
    // Cross-part refs live in part-CAD sketch docs only; sub-assembly rows
    // (isAssembly) have no sketches.
    const model = await db.DesignCADModel.findOne({ where: { partID: instance.partID, activeFlag: true, isAssembly: false } });
    if (!model) return [];
    return crossPartRefsOf(model.sketchDoc, assemblyId);
  };
}

// Dependency graph: edge D → S means "D's geometry depends on S's pose/geometry".
function buildCrossPartDepGraph(instances, refsByInstance) {
  const nodes = new Set(instances.map((i) => i.instanceId));
  const edges = new Map();
  for (const inst of instances) {
    const srcs = new Set();
    for (const r of refsByInstance.get(inst.instanceId) || []) {
      if (r.sourceInstanceId && nodes.has(r.sourceInstanceId) && r.sourceInstanceId !== inst.instanceId) srcs.add(r.sourceInstanceId);
    }
    if (srcs.size) edges.set(inst.instanceId, srcs);
  }
  return { nodes, edges };
}

// Topological order with dependencies (sources) first. Nodes left in a cycle are
// appended at the end and their unsatisfied edges returned as back-edges; the
// resolver degrades those to the cached snapshot rather than failing (REQ 776).
function topoOrderWithCycles(nodes, edges) {
  const remaining = new Map();
  for (const n of nodes) remaining.set(n, new Set(edges.get(n) || []));
  const dependents = new Map();
  for (const [d, srcs] of edges) for (const s of srcs) {
    if (!dependents.has(s)) dependents.set(s, new Set());
    dependents.get(s).add(d);
  }
  const order = [];
  const placed = new Set();
  const queue = [...nodes].filter((n) => remaining.get(n).size === 0);
  while (queue.length) {
    const n = queue.shift();
    if (placed.has(n)) continue;
    placed.add(n); order.push(n);
    for (const d of dependents.get(n) || []) {
      const r = remaining.get(d); r.delete(n);
      if (r.size === 0 && !placed.has(d)) queue.push(d);
    }
  }
  const backEdges = new Set();
  for (const n of nodes) {
    if (placed.has(n)) continue;
    order.push(n);
    for (const s of remaining.get(n)) backEdges.add(`${n}|${s}`);
  }
  return { order, backEdges };
}

// Build a live externalRefResolver for dependent `dependentId`: match each ref's
// source edge against the source instance's current geometry, then express it in
// the dependent's local frame via the solved poses. Returns null (→ cached
// snapshot) for cyclic back-edges or anything that can't be resolved.
function makeCrossPartResolver({ dependentId, childGeoById, poses, backEdges }) {
  return (externalRef) => {
    const sId = externalRef && externalRef.sourceInstanceId;
    if (!sId) return null;
    if (backEdges && backEdges.has(`${dependentId}|${sId}`)) return null;
    const sourceGeo = childGeoById.get(sId);
    const poseD = poses[dependentId], poseS = poses[sId];
    if (!sourceGeo || !poseD || !poseS) return null;
    const rel = relativePlacement(poseD, poseS); // S-local → D-local
    const geomRef = externalRef.sourceGeomRef || {};
    const fallback = externalRef.fallback;
    // VERTEX ref (cross-part Convert on a vertex): resolve the point and return
    // it as a degenerate edge (both endpoints equal) so the shared point-on-edge
    // re-projection pins the sketch point to it.
    if (geomRef.vertexId || (fallback && fallback.kind === 'vertex')) {
      const v = resolveVertexRef(sourceGeo.bodies || [], geomRef, fallback);
      if (!v) return null;
      const p = transformPoint(rel, v.position);
      return { polyline: [p, p], isStraight: true };
    }
    const m = resolveEdgeRef(sourceGeo.bodies || [], geomRef, fallback);
    if (!m) return null;
    const edge = m.edge;
    const poly = edge.polyline && edge.polyline.length >= 2
      ? edge.polyline
      : (edge.endpoints && edge.endpoints.length === 2 ? edge.endpoints : null);
    if (!poly) return null;
    return { polyline: poly.map((p) => transformPoint(rel, p)), isStraight: edge.isStraight };
  };
}

// ── main entry ──────────────────────────────────────────────────────────────

/**
 * Regenerate an assembly into a single composed geometry.
 * @param assembly DesignCADModel assembly row (or plain { partID, assemblyDoc }).
 * @param opts.db Sequelize db (for the default resolver + cycle walk).
 * @param opts.resolveChild async (instance, assembly) => child geometry
 *        ({ faces, vertices, edges, bodies }). Injected for tests.
 * @param opts.kernelClient passed to the default resolver.
 * @returns { faces, vertices, edges, bodies, instances, errors, constraintState }
 */
async function regenerateAssembly(assembly, { db, resolveChild, kernelClient, childRefs } = {}) {
  await assertAcyclic(assembly, db);
  const resolver = resolveChild || defaultResolveChild({ db, kernelClient });
  const doc = assembly.assemblyDoc || {};
  const instances = (doc.instances || []).filter((i) => !i.suppressed);
  // Origin mates carry no face-pair geometry — they fix a component to the
  // assembly origin via its grounded flag + identity placement, so they're
  // excluded from the solver's residual set.
  const mates = (doc.mates || []).filter((m) => !m.suppressed && m.type !== 'origin');

  const composed = {
    faces: [], vertices: [], edges: [], bodies: [], instances: [], errors: [], constraintState: null,
  };

  // Phase A — resolve each component's child geometry (kernel or stub).
  const childGeoById = new Map();
  for (const inst of instances) {
    try {
      childGeoById.set(inst.instanceId, await resolver(inst, assembly, {
        warn: (m) => composed.errors.push(m),
      }));
    } catch (err) {
      composed.errors.push(`Instance ${inst.instanceId} (part ${inst.partID}): ${err.message}`);
    }
  }

  // Phase B — solve mates to position the components (REQ 755). With no mates the
  // stored placements are used unchanged (Phase 1 behavior).
  let poses;
  if (mates.length) {
    const solved = solveAssemblyMates(instances, mates, childGeoById, composed.errors);
    poses = solved.poses;
    composed.constraintState = {
      state: solved.state, dof: solved.dof, converged: solved.converged, residualNorm: solved.residualNorm,
    };
    // Surface any auto-corrected mate flips (the solver recovered a consistent
    // alignment) so the caller can persist them — keeps the stored flip in sync
    // with the rendered geometry and the mate-edit checkbox.
    if (solved.resolvedFlips) {
      const corrections = [];
      for (const mate of mates) {
        const resolved = solved.resolvedFlips[mate.id];
        if (resolved !== undefined && !!mate.flip !== !!resolved) corrections.push({ mateId: mate.id, flip: !!resolved });
      }
      if (corrections.length) composed.flipCorrections = corrections;
    }
  } else {
    poses = {};
    for (const inst of instances) { const { t, q } = placementOf(inst); poses[inst.instanceId] = { translate: t, quaternion: q }; }
  }

  // Phase B.5 — live cross-part in-context resolution (REQ 772/776/778). Now that
  // poses are known, re-regenerate each instance whose part references geometry
  // from ANOTHER instance in this assembly, feeding the source geometry
  // transformed into the dependent's frame. Processed in dependency order; cycles
  // degrade to the cached snapshot; under-constrained assemblies are flagged.
  const refsByInstance = new Map();
  const refsLoader = childRefs || defaultChildRefs({ db });
  for (const inst of instances) {
    if (!childGeoById.has(inst.instanceId)) continue;
    try {
      const refs = await refsLoader(inst, assembly.id);
      if (refs && refs.length) refsByInstance.set(inst.instanceId, refs);
    } catch (e) { /* instance simply has no cross-part refs */ }
  }
  if (refsByInstance.size) {
    const { nodes, edges } = buildCrossPartDepGraph(instances, refsByInstance);
    const { order, backEdges } = topoOrderWithCycles(nodes, edges);
    // Only an UNDER-constrained assembly makes a cross-part reference
    // ambiguous: the source instance still has free DOF, so its solved pose
    // (and thus the geometry the reference projects) isn't uniquely defined.
    // An OVER-constrained assembly has redundant/conflicting mates but the
    // pose is still determined, so the reference resolves deterministically —
    // flagging it as ambiguous was a false positive (over-constraint is
    // surfaced separately via the assembly's constraint state).
    const ambiguous = composed.constraintState && composed.constraintState.state === 'under';
    for (const instanceId of order) {
      const deps = edges.get(instanceId);
      if (!deps || !deps.size) continue; // not a dependent
      const inst = instances.find((i) => i.instanceId === instanceId);
      if (!inst) continue;
      const externalRefResolver = makeCrossPartResolver({ dependentId: instanceId, childGeoById, poses, backEdges });
      try {
        const live = await resolver(inst, assembly, { externalRefResolver });
        if (live) childGeoById.set(instanceId, live);
      } catch (err) {
        composed.errors.push(`In-context regen of instance ${instanceId}: ${err.message}`);
      }
      for (const s of deps) {
        if (backEdges.has(`${instanceId}|${s}`)) {
          composed.errors.push(`Cyclic in-context reference ${instanceId} → ${s}: resolved from cached snapshot`);
        }
      }
      if (ambiguous) {
        composed.errors.push(`In-context reference on instance ${instanceId} is ambiguous: assembly is ${composed.constraintState.state}-constrained`);
      }
    }
  }

  // Build the list of render units: the base instances (at their solved pose)
  // plus any pattern/mirror copies derived from a seed (REQ 760/761).
  const renderUnits = [];
  for (const inst of instances) {
    const childGeo = childGeoById.get(inst.instanceId);
    if (!childGeo) continue; // resolve error already recorded
    const pose = poses[inst.instanceId] || (() => { const { t, q } = placementOf(inst); return { translate: t, quaternion: q }; })();
    renderUnits.push({
      instanceId: inst.instanceId, partID: inst.partID, grounded: !!inst.grounded,
      childGeo, pose, xform: rigidTransform(pose.quaternion, pose.translate), derivedFrom: null,
    });
  }
  expandPatterns((doc.patterns || []).filter((p) => !p.suppressed), renderUnits, composed.errors);

  // Phase C — transform each render unit, scope ids by instance, compose.
  for (const unit of renderUnits) {
    const { instanceId, childGeo, xform, pose } = unit;
    const placedBodies = (childGeo.bodies || []).map((b) => ({
      id: scopeId(instanceId, b.id),
      name: b.name || null,
      instanceId,
      partID: unit.partID,
      // BRep is the seed's UNTRANSFORMED child brep; placement is applied
      // kernel-side at export. Pattern/mirror copies carry the seed brep + their
      // own placement (mirror copies are export-approximated as the seed for now).
      brep: b.brep,
      placement: pose ? { translate: pose.translate, quaternion: pose.quaternion } : null,
      derivedFrom: unit.derivedFrom,
      // Volume is invariant under rigid/mirror transforms; the centroid moves.
      volume: typeof b.volume === 'number' ? b.volume : undefined,
      centroid: b.centroid ? xform.point(b.centroid) : undefined,
      faces: (b.faces || []).map((f) => scopeFace(instanceId, transformFace(f, xform))),
      vertices: (b.vertices || []).map((p) => xform.point(p)),
      edges: (b.edges || []).map((e) => transformEdge(e, xform)),
    }));

    for (const b of placedBodies) {
      composed.faces.push(...b.faces);
      composed.vertices.push(...b.vertices);
      composed.edges.push(...b.edges);
      composed.bodies.push(b);
    }
    composed.instances.push({
      instanceId, partID: unit.partID, placement: pose ? { translate: pose.translate, quaternion: pose.quaternion } : null,
      grounded: !!unit.grounded, derivedFrom: unit.derivedFrom,
      bodyIds: placedBodies.map((b) => b.id),
    });
  }

  return composed;
}

// ── pattern / mirror expansion (REQ 760/761) ──────────────────────────────────

// Append derived render units for each linear/circular/mirror pattern. Each
// pattern references a seed instance (already a render unit) and reuses its
// resolved child geometry with computed placements.
function expandPatterns(patterns, renderUnits, errors) {
  const seedOf = (id) => renderUnits.find((u) => u.instanceId === id && !u.derivedFrom);
  for (const pat of patterns) {
    const seed = seedOf(pat.seedInstanceId);
    if (!seed) { errors.push(`Pattern ${pat.patternId}: seed instance ${pat.seedInstanceId} not found`); continue; }
    const sq = seed.pose.quaternion; const st = seed.pose.translate;

    if (pat.kind === 'mirror') {
      const id = `${seed.instanceId}#${pat.patternId}m`;
      renderUnits.push({
        instanceId: id, partID: seed.partID, grounded: false, childGeo: seed.childGeo,
        pose: { translate: st, quaternion: sq },
        xform: mirrorTransform(sq, st, pat.planeOrigin || [0, 0, 0], pat.planeNormal || [1, 0, 0]),
        derivedFrom: { patternId: pat.patternId, seedInstanceId: seed.instanceId, kind: 'mirror' },
      });
      continue;
    }

    const count = Math.max(1, Math.min(1000, Number(pat.count) || 1));
    for (let i = 1; i < count; i++) {
      let pose;
      if (pat.kind === 'linear') {
        const step = pat.spacing || [0, 0, 0];
        pose = { translate: [st[0] + step[0] * i, st[1] + step[1] * i, st[2] + step[2] * i], quaternion: sq };
      } else if (pat.kind === 'circular') {
        const axisOrigin = pat.axisOrigin || [0, 0, 0];
        const axisDir = vnorm3(pat.axisDir || [0, 0, 1]);
        const angle = (Number(pat.angleStep) || 0) * i;
        const dq = quatAboutAxis(axisDir, angle);
        const rel = [st[0] - axisOrigin[0], st[1] - axisOrigin[1], st[2] - axisOrigin[2]];
        const rot = qRotate(dq, rel);
        pose = { translate: [rot[0] + axisOrigin[0], rot[1] + axisOrigin[1], rot[2] + axisOrigin[2]], quaternion: qMul3(dq, sq) };
      } else {
        errors.push(`Pattern ${pat.patternId}: unknown kind "${pat.kind}"`); break;
      }
      const id = `${seed.instanceId}#${pat.patternId}_${i}`;
      renderUnits.push({
        instanceId: id, partID: seed.partID, grounded: false, childGeo: seed.childGeo,
        pose, xform: rigidTransform(pose.quaternion, pose.translate),
        derivedFrom: { patternId: pat.patternId, seedInstanceId: seed.instanceId, kind: pat.kind, index: i },
      });
    }
  }
}

function quatAboutAxis(axis, angle) {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}
function qMul3(a, b) {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3];
  const bx = b[0], by = b[1], bz = b[2], bw = b[3];
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

// ── mate solving (REQ 755-757) ────────────────────────────────────────────────

// Build a faceId → analytic surface lookup (child LOCAL frame) for one instance.
function faceSurfaceMap(childGeo) {
  const map = new Map();
  for (const body of (childGeo && childGeo.bodies) || []) {
    for (const f of body.faces || []) {
      if (f.surface) map.set(f.faceId || f.persistentName, f.surface);
    }
  }
  return map;
}

// Canonical solver geometry for a component's origin datums, in its LOCAL frame
// (REQ: mate against planes/origins). Keyed by datum id.
const DATUM_GEOM = {
  origin: { kind: 'point', origin: [0, 0, 0] },
  x_axis: { kind: 'axis', origin: [0, 0, 0], direction: [1, 0, 0], radius: 0 },
  y_axis: { kind: 'axis', origin: [0, 0, 0], direction: [0, 1, 0], radius: 0 },
  z_axis: { kind: 'axis', origin: [0, 0, 0], direction: [0, 0, 1], radius: 0 },
  xy_plane: { kind: 'plane', origin: [0, 0, 0], normal: [0, 0, 1] },
  yz_plane: { kind: 'plane', origin: [0, 0, 0], normal: [1, 0, 0] },
  xz_plane: { kind: 'plane', origin: [0, 0, 0], normal: [0, 1, 0] },
};

// Convert a kernel surface classification into a solver mate-geometry.
function surfaceToGeom(surface) {
  if (!surface) return null;
  if (surface.kind === 'plane') {
    return { kind: 'plane', origin: surface.origin, normal: surface.normal || [0, 0, 1] };
  }
  if (surface.kind === 'cylinder') {
    return { kind: 'axis', origin: surface.origin, direction: surface.axis || [0, 0, 1], radius: surface.radius || 0 };
  }
  return null;
}

// Solve the assembly's mates and return per-instance poses + constraint state.
// Resolves each mate's face references to analytic surfaces from the resolved
// child geometry; mates with a missing instance/face/surface are skipped with an
// error so the rest of the assembly still solves.
function solveAssemblyMates(instances, mates, childGeoById, errors) {
  const surfacesByInstance = new Map();
  for (const inst of instances) surfacesByInstance.set(inst.instanceId, faceSurfaceMap(childGeoById.get(inst.instanceId)));

  // At least one grounded instance is required; auto-ground the first otherwise.
  const solverInstances = instances.map((inst) => {
    const { t, q } = placementOf(inst);
    return { id: inst.instanceId, grounded: !!inst.grounded, translate: t, quaternion: q };
  });
  if (solverInstances.length && !solverInstances.some((i) => i.grounded)) solverInstances[0].grounded = true;

  const resolveRef = (ref) => {
    const m = surfacesByInstance.get(ref.instanceId);
    if (!m) return { error: `mate references unknown instance ${ref.instanceId}` };
    // Datum references (origin point / axis / plane) have canonical geometry in
    // the component's LOCAL frame — no kernel surface lookup needed.
    const datum = DATUM_GEOM[ref.faceId];
    if (datum) return { geom: { ...datum } };
    const surface = m.get(ref.faceId);
    if (!surface) return { error: `mate references face ${ref.faceId} with no analytic surface on instance ${ref.instanceId}` };
    const geom = surfaceToGeom(surface);
    if (!geom) return { error: `mate face ${ref.faceId} surface (${surface.kind}) is not mateable` };
    return { geom };
  };

  const solverMates = [];
  for (const mate of mates) {
    const a = resolveRef(mate.a); const b = resolveRef(mate.b);
    if (a.error || b.error) { errors.push(`Mate ${mate.id}: ${a.error || b.error}`); continue; }
    solverMates.push({
      id: mate.id, type: mate.type,
      a: { instanceId: mate.a.instanceId, geom: a.geom },
      b: { instanceId: mate.b.instanceId, geom: b.geom },
      value: mate.value, flip: mate.flip,
    });
  }

  if (!solverMates.length) {
    const poses = {};
    for (const i of solverInstances) poses[i.id] = { translate: i.translate, quaternion: i.quaternion };
    return { poses, state: 'under', dof: solverInstances.filter((i) => !i.grounded).length * 6, converged: true, residualNorm: 0 };
  }
  return mateSolver.solveMates(solverInstances, solverMates);
}

// ── bill of materials (REQ 753) ───────────────────────────────────────────────

/**
 * Aggregate an assembly's instances into one BOM line per distinct part.
 * @returns [{ partID, quantity }] (stable order: first appearance).
 */
function assemblyBom(assembly) {
  const doc = assembly.assemblyDoc || {};
  const order = [];
  const byKey = new Map();
  for (const inst of doc.instances || []) {
    if (inst.suppressed) continue;
    // Different configurations of the same part are different BOM line items
    // (a Short bracket isn't interchangeable with a Long one).
    const configurationId = inst.configurationId || null;
    const key = `${inst.partID}:${configurationId || ''}`;
    if (!byKey.has(key)) { byKey.set(key, { partID: inst.partID, configurationId, quantity: 0 }); order.push(key); }
    byKey.get(key).quantity += 1;
  }
  return order.map((key) => byKey.get(key));
}

module.exports = {
  regenerateAssembly,
  assemblyBom,
  assertAcyclic,
  flattenChildGeometry,
  defaultResolveChild,
  resolveChildSource,
  // cross-part in-context helpers (REQ 772/776/777) — exported for unit tests
  crossPartRefsOf,
  buildCrossPartDepGraph,
  topoOrderWithCycles,
  makeCrossPartResolver,
};
