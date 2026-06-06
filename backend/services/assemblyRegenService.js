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

const cadRegenService = require('./cadRegenService');
const mateSolver = require('./assemblyMateSolver');

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
      if (poly.length >= 2) bEdges.push({ polyline: poly });
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

// Default resolver: produce a component's child geometry. A part referenced as a
// sub-assembly (ref.kind === 'assembly', or no CAD model but an assembly exists)
// is recursively regenerated and returned as one rigid child (REQ 763); otherwise
// the part's active CAD working copy is regenerated.
function defaultResolveChild({ db, kernelClient }) {
  return async (instance) => {
    const wantsAssembly = instance.ref && instance.ref.kind === 'assembly';
    if (wantsAssembly) {
      const childAssembly = await db.DesignAssembly.findOne({ where: { partID: instance.partID, activeFlag: true } });
      if (!childAssembly) {
        const err = new Error(`Component part ${instance.partID} has no assembly to resolve`);
        err.statusCode = 422;
        throw err;
      }
      const sub = await regenerateAssembly(childAssembly, { db, kernelClient });
      // The sub-assembly's composed bodies are already placed in its own frame;
      // treat the whole thing as one rigid child (its body ids stay sub-scoped).
      return { faces: sub.faces, vertices: sub.vertices, edges: sub.edges, bodies: sub.bodies };
    }
    const childModel = await db.DesignCADModel.findOne({ where: { partID: instance.partID, activeFlag: true } });
    if (!childModel) {
      const err = new Error(`Component part ${instance.partID} has no CAD model to resolve`);
      err.statusCode = 422;
      throw err;
    }
    const regen = await cadRegenService.regenerateModel(childModel, { kernelClient, db, includeBodyBreps: true });
    return flattenChildGeometry(regen);
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
    if (!db || !db.DesignAssembly) continue;
    const childAssembly = await db.DesignAssembly.findOne({ where: { partID: inst.partID, activeFlag: true } });
    if (childAssembly) await assertAcyclic(childAssembly, db, new Set(visited));
  }
}

// ── main entry ──────────────────────────────────────────────────────────────

/**
 * Regenerate an assembly into a single composed geometry.
 * @param assembly DesignAssembly row (or plain { partID, assemblyDoc }).
 * @param opts.db Sequelize db (for the default resolver + cycle walk).
 * @param opts.resolveChild async (instance, assembly) => child geometry
 *        ({ faces, vertices, edges, bodies }). Injected for tests.
 * @param opts.kernelClient passed to the default resolver.
 * @returns { faces, vertices, edges, bodies, instances, errors, constraintState }
 */
async function regenerateAssembly(assembly, { db, resolveChild, kernelClient } = {}) {
  await assertAcyclic(assembly, db);
  const resolver = resolveChild || defaultResolveChild({ db, kernelClient });
  const doc = assembly.assemblyDoc || {};
  const instances = (doc.instances || []).filter((i) => !i.suppressed);
  const mates = (doc.mates || []).filter((m) => !m.suppressed);

  const composed = {
    faces: [], vertices: [], edges: [], bodies: [], instances: [], errors: [], constraintState: null,
  };

  // Phase A — resolve each component's child geometry (kernel or stub).
  const childGeoById = new Map();
  for (const inst of instances) {
    try {
      childGeoById.set(inst.instanceId, await resolver(inst, assembly));
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
  } else {
    poses = {};
    for (const inst of instances) { const { t, q } = placementOf(inst); poses[inst.instanceId] = { translate: t, quaternion: q }; }
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
  const byPart = new Map();
  for (const inst of doc.instances || []) {
    if (inst.suppressed) continue;
    if (!byPart.has(inst.partID)) { byPart.set(inst.partID, 0); order.push(inst.partID); }
    byPart.set(inst.partID, byPart.get(inst.partID) + 1);
  }
  return order.map((partID) => ({ partID, quantity: byPart.get(partID) }));
}

module.exports = {
  regenerateAssembly,
  assemblyBom,
  assertAcyclic,
  flattenChildGeometry,
  defaultResolveChild,
};
