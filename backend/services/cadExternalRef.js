'use strict';

// REQ 777 — sticky-name matcher for cross-part in-context references. A reference
// names a face/edge in the SOURCE part by id, but the source part's topology
// renumbers on nearly every edit, so resolution is two-stage:
//   1. exact id match (fast path, stable within a commit);
//   2. fallback to stored geometry — edges by closest-endpoint-sum (mirrors the
//      EdgeRef3D matching used by fillet/chamfer), faces by centroid + normal +
//      surface kind (mirrors _faceRepresentativePlane / the faceMap fallback).
// Returns null when nothing matches within tolerance; the caller surfaces a
// "broken" reference + repair affordance (REQ 777). This module is pure (bodies +
// ref in, match out) so it unit-tests without the kernel or db.

const POS_TOL = 0.05;      // mm — generous; renumbered geometry is identical, not approximate
const NORMAL_DOT = 0.9;    // faces must point roughly the same way

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
const dist = (a, b) => len(sub(a, b));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function unit(a) { const l = len(a); return l < 1e-12 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l]; }

function edgeEndpoints(edge) {
  if (edge.endpoints && edge.endpoints.length === 2) return edge.endpoints;
  const p = edge.polyline;
  if (p && p.length >= 2) return [p[0], p[p.length - 1]];
  return null;
}

/** Centroid + outward normal of a tessellated face (mirrors _faceRepresentativePlane). */
function faceCentroidNormal(face) {
  if (face.surface && face.surface.kind === 'plane' && face.surface.origin) {
    // prefer the analytic plane, but centroid still comes from the mesh below
  }
  const pos = face.positions, nor = face.normals;
  if (!pos || !nor || pos.length < 3) {
    if (face.centroid && face.normal) return { centroid: face.centroid, normal: unit(face.normal) };
    return null;
  }
  const n = pos.length / 3;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += pos[i * 3]; cy += pos[i * 3 + 1]; cz += pos[i * 3 + 2]; }
  return { centroid: [cx / n, cy / n, cz / n], normal: unit([nor[0], nor[1], nor[2]]) };
}

/**
 * Resolve a source EDGE against the current bodies.
 * @returns {{edge, bodyId, exact:boolean}|null}
 */
function resolveEdgeRef(bodies, geomRef, fallback, opts = {}) {
  const posTol = opts.posTol != null ? opts.posTol : POS_TOL;
  const wantId = geomRef && geomRef.edgeId;

  // 1. exact id
  if (wantId) {
    for (const body of bodies || []) {
      for (const e of (body.topology && body.topology.edges) || body.edges || []) {
        if (e.id === wantId) return { edge: e, bodyId: body.bodyId, exact: true };
      }
    }
  }
  // 2. fallback by endpoint geometry
  if (fallback && fallback.kind === 'edge') {
    const a = fallback.start, b = fallback.end;
    let best = null, bestCost = Infinity;
    for (const body of bodies || []) {
      for (const e of (body.topology && body.topology.edges) || body.edges || []) {
        const ep = edgeEndpoints(e);
        if (!ep) continue;
        const fwd = dist(ep[0], a) + dist(ep[1], b);
        const rev = dist(ep[0], b) + dist(ep[1], a);
        const cost = Math.min(fwd, rev);
        if (cost < bestCost) { bestCost = cost; best = { edge: e, bodyId: body.bodyId, exact: false }; }
      }
    }
    if (best && bestCost <= 2 * posTol) return best;
  }
  return null;
}

/**
 * Resolve a source FACE against the current bodies.
 * @returns {{face, bodyId, exact:boolean}|null}
 */
function resolveFaceRef(bodies, geomRef, fallback, opts = {}) {
  const posTol = opts.posTol != null ? opts.posTol : POS_TOL;
  const normalDot = opts.normalDot != null ? opts.normalDot : NORMAL_DOT;
  const wantId = geomRef && geomRef.faceId;

  // 1. exact id (persistentName preferred, faceId fallback)
  if (wantId) {
    for (const body of bodies || []) {
      for (const f of body.faces || []) {
        if (f.persistentName === wantId || f.faceId === wantId) return { face: f, bodyId: body.bodyId, exact: true };
      }
    }
  }
  // 2. fallback by centroid + normal + surface kind
  if (fallback && fallback.kind === 'face') {
    const wantKind = fallback.surfaceKind;
    const wantNormal = unit(fallback.normal || [0, 0, 1]);
    let best = null, bestCost = Infinity;
    for (const body of bodies || []) {
      for (const f of body.faces || []) {
        if (wantKind && f.surface && f.surface.kind && f.surface.kind !== wantKind) continue;
        const cn = faceCentroidNormal(f);
        if (!cn) continue;
        if (Math.abs(dot(cn.normal, wantNormal)) < normalDot) continue;
        const cost = dist(cn.centroid, fallback.centroid);
        if (cost < bestCost) { bestCost = cost; best = { face: f, bodyId: body.bodyId, exact: false }; }
      }
    }
    if (best && bestCost <= posTol) return best;
  }
  return null;
}

module.exports = { resolveEdgeRef, resolveFaceRef };
