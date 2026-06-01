import type { Axis3, DatumAxisFeature, DatumElement, DatumPlaneFeature, DatumPointFeature, EdgeRef3D, ModelGeometry, Plane3, PlaneRef, VertexRef } from './types';
import { fitCircle } from './measure';

export function buildOriginDatums(): DatumElement[] {
  return [
    { id: 'origin', kind: 'point' },
    { id: 'x_axis', kind: 'axis', direction: [1, 0, 0] },
    { id: 'y_axis', kind: 'axis', direction: [0, 1, 0] },
    { id: 'z_axis', kind: 'axis', direction: [0, 0, 1] },
    { id: 'xy_plane', kind: 'plane', direction: [0, 0, 1] },
    { id: 'yz_plane', kind: 'plane', direction: [1, 0, 0] },
    { id: 'xz_plane', kind: 'plane', direction: [0, 1, 0] },
  ];
}

export function planeForDatum(id: string): Plane3 | null {
  const O: [number, number, number] = [0, 0, 0];
  switch (id) {
    case 'xy_plane': return { origin: O, xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] };
    case 'yz_plane': return { origin: O, xAxis: [0, 1, 0], yAxis: [0, 0, 1], normal: [1, 0, 0] };
    // xAxis is -X (not +X) so the basis is RIGHT-HANDED (xAxis × yAxis ==
    // normal). With +X the basis was left-handed, which mirrored anything
    // orientation-sensitive drawn on this plane — most visibly sketch text,
    // which rendered backwards. All standard planes are now right-handed; see
    // the handedness assertion in datum.spec.ts.
    case 'xz_plane': return { origin: O, xAxis: [-1, 0, 0], yAxis: [0, 0, 1], normal: [0, 1, 0] };
    default: return null;
  }
}

// ─── Vector helpers (kept private to this module; measure.ts has its
//     own copies but importing back-and-forth would tangle the deps). ─

type V3 = [number, number, number];
const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add3 = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale3 = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len3 = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit3 = (a: V3): V3 => { const L = len3(a); return L < 1e-12 ? [0, 0, 0] : [a[0] / L, a[1] / L, a[2] / L]; };

/** Build a Plane3 given an origin + outward normal. Picks an arbitrary
 * in-plane basis (xAxis/yAxis perpendicular to normal). Choice of
 * basis is stable: xAxis prefers world-X, falls back to world-Y when
 * the normal is colinear with X. */
function planeFromNormal(origin: V3, normalRaw: V3): Plane3 | null {
  const normal = unit3(normalRaw);
  if (len3(normal) < 0.5) return null;
  const seed: V3 = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const xAxis = unit3(sub3(seed, scale3(normal, dot3(seed, normal))));
  if (len3(xAxis) < 0.5) return null;
  const yAxis = unit3(cross3(normal, xAxis));
  return { origin, xAxis, yAxis, normal };
}

/** Resolve a PlaneRef to a concrete Plane3, given the current model
 * geometry. Returns null when the reference can no longer be resolved
 * (the face id no longer exists AND no fallback was captured). */
export function resolvePlaneRef(ref: PlaneRef, geometry: ModelGeometry): Plane3 | null {
  if (ref.kind === 'datum') {
    // First try the origin planes; then look up a user datum plane.
    const origin = planeForDatum(ref.datumId);
    if (origin) return origin;
    // User datum — find in geometry.datums and reconstruct from its
    // direction. The geometry layer caches the full Plane3 on the
    // sidecar `userDatumPlanes` map (populated by featureTree); we
    // read it through the geometry if present. Fall back to a
    // normal-only plane if not.
    const d = geometry.datums.find(x => x.id === ref.datumId && x.kind === 'plane');
    if (d && (d as any).plane) return (d as any).plane as Plane3;
    if (d && d.direction) return planeFromNormal([0, 0, 0], d.direction);
    return null;
  }
  // Face ref — resolve via fallbackPlane (snapshot captured at pick time).
  return planeFromNormal(ref.fallbackPlane.origin, ref.fallbackPlane.normal);
}

function resolveVertex(ref: VertexRef, geometry: ModelGeometry): V3 | null {
  const v = geometry.topology.vertices.find(x => x.id === ref.vertexId);
  if (v) return v.position as V3;
  if (ref.fallbackPosition) return ref.fallbackPosition;
  return null;
}

function resolveEdgeDirection(ref: EdgeRef3D): V3 {
  return sub3(ref.end as V3, ref.start as V3);
}

/** Rotate vector `v` around unit axis `k` by `angle` radians.
 * Rodrigues' rotation formula. */
function rotateAroundAxis(v: V3, k: V3, angle: number): V3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const kxv = cross3(k, v);
  const kdotv = dot3(k, v);
  return [
    v[0] * c + kxv[0] * s + k[0] * kdotv * (1 - c),
    v[1] * c + kxv[1] * s + k[1] * kdotv * (1 - c),
    v[2] * c + kxv[2] * s + k[2] * kdotv * (1 - c),
  ];
}

export type DatumPlaneResult =
  | { ok: true; plane: Plane3 }
  | { ok: false; error: string };

/** Compute the Plane3 a datum-plane feature produces from its method
 * dispatch. Pure; returns an `ok: false` row with a human error when
 * picks are stale or the inputs are degenerate. */
export function computeDatumPlane(feature: DatumPlaneFeature, geometry: ModelGeometry): DatumPlaneResult {
  const m = feature.method;
  switch (m.kind) {
    case 'offset': {
      const base = resolvePlaneRef(m.planeRef, geometry);
      if (!base) return { ok: false, error: 'Reference plane/face no longer exists. Re-pick.' };
      const dir = m.flipped ? -1 : 1;
      const origin = add3(base.origin, scale3(base.normal as V3, m.distance * dir));
      return { ok: true, plane: { ...base, origin } };
    }
    case 'parallelThroughPoint': {
      const base = resolvePlaneRef(m.planeRef, geometry);
      if (!base) return { ok: false, error: 'Reference plane/face no longer exists. Re-pick.' };
      const p = resolveVertex(m.vertexRef, geometry);
      if (!p) return { ok: false, error: 'Reference vertex no longer exists. Re-pick.' };
      return { ok: true, plane: { ...base, origin: p } };
    }
    case 'angleThroughEdge': {
      const base = resolvePlaneRef(m.planeRef, geometry);
      if (!base) return { ok: false, error: 'Reference plane/face no longer exists. Re-pick.' };
      const edgeDir = unit3(resolveEdgeDirection(m.edgeRef));
      if (len3(edgeDir) < 0.5) return { ok: false, error: 'Edge has zero length.' };
      const rad = (m.angleDeg * Math.PI) / 180;
      const rotatedNormal = rotateAroundAxis(base.normal as V3, edgeDir, rad);
      // Plane origin: anchor at the edge's start so the rotated plane
      // visibly passes through the edge.
      const plane = planeFromNormal(m.edgeRef.start as V3, rotatedNormal);
      if (!plane) return { ok: false, error: 'Cannot compute plane normal from inputs.' };
      return { ok: true, plane };
    }
    case 'threePoints': {
      const p0 = resolveVertex(m.vertexRefs[0], geometry);
      const p1 = resolveVertex(m.vertexRefs[1], geometry);
      const p2 = resolveVertex(m.vertexRefs[2], geometry);
      if (!p0 || !p1 || !p2) return { ok: false, error: 'One or more reference vertices no longer exist.' };
      const n = cross3(sub3(p1, p0), sub3(p2, p0));
      if (len3(n) < 1e-9) return { ok: false, error: 'The three points are collinear.' };
      const plane = planeFromNormal(p0, n);
      if (!plane) return { ok: false, error: 'Cannot derive plane from three points.' };
      return { ok: true, plane };
    }
    case 'midPlane': {
      const a = resolvePlaneRef(m.planeRefA, geometry);
      const b = resolvePlaneRef(m.planeRefB, geometry);
      if (!a || !b) return { ok: false, error: 'Reference plane/face no longer exists. Re-pick.' };
      // If parallel (or anti-parallel), build the halfway-and-parallel
      // plane. Otherwise (rare) use the bisector of the two normals
      // anchored at the midpoint between origins.
      const dot = dot3(unit3(a.normal as V3), unit3(b.normal as V3));
      const parallel = Math.abs(Math.abs(dot) - 1) < 1e-3;
      const mid: V3 = [(a.origin[0] + b.origin[0]) / 2, (a.origin[1] + b.origin[1]) / 2, (a.origin[2] + b.origin[2]) / 2];
      if (parallel) {
        return { ok: true, plane: { ...a, origin: mid } };
      }
      // Bisector: average the unit normals (sign-aligned so they don't
      // cancel) and renormalize.
      const sign = dot < 0 ? -1 : 1;
      const bAligned: V3 = scale3(b.normal as V3, sign);
      const bis = unit3([(a.normal[0] + bAligned[0]) / 2, (a.normal[1] + bAligned[1]) / 2, (a.normal[2] + bAligned[2]) / 2]);
      const plane = planeFromNormal(mid, bis);
      if (!plane) return { ok: false, error: 'Cannot bisect non-parallel reference planes.' };
      return { ok: true, plane };
    }
    case 'lineAndPerpFace': {
      const face = resolvePlaneRef(m.planeRef, geometry);
      if (!face) return { ok: false, error: 'Reference face no longer exists. Re-pick.' };
      const edgeDir = unit3(resolveEdgeDirection(m.edgeRef));
      if (len3(edgeDir) < 0.5) return { ok: false, error: 'Edge has zero length.' };
      // The new plane CONTAINS the edge and is PERPENDICULAR to the
      // reference face. Its normal = face.normal × edgeDir.
      const normal = cross3(face.normal as V3, edgeDir);
      if (len3(normal) < 1e-6) return { ok: false, error: 'Edge is perpendicular to the reference face — plane is ambiguous.' };
      const plane = planeFromNormal(m.edgeRef.start as V3, normal);
      if (!plane) return { ok: false, error: 'Cannot compute plane normal.' };
      return { ok: true, plane };
    }
    case 'pointAndPerpEdge': {
      const p = resolveVertex(m.vertexRef, geometry);
      if (!p) return { ok: false, error: 'Reference vertex no longer exists. Re-pick.' };
      const edgeDir = unit3(resolveEdgeDirection(m.edgeRef));
      if (len3(edgeDir) < 0.5) return { ok: false, error: 'Edge has zero length.' };
      const plane = planeFromNormal(p, edgeDir);
      if (!plane) return { ok: false, error: 'Cannot derive plane from inputs.' };
      return { ok: true, plane };
    }
    case 'tangentCylinder': {
      // Tangent plane to a cylindrical face is a plane that touches the
      // cylinder along one element-line. We need the cylinder's axis
      // and radius (PCA on the face mesh would do it but the model
      // geometry already has face normals — we can also approximate by
      // taking the face's mean normal as the surface normal at the
      // mean position. The tangent plane is then anchored at that
      // point with that normal.
      const face = geometry.faces.find(f => f.faceId === m.cylinderFaceId);
      if (!face) return { ok: false, error: 'Cylindrical face no longer exists. Re-pick.' };
      const ref = resolvePlaneRef(m.planeRef, geometry);
      if (!ref) return { ok: false, error: 'Reference plane no longer exists. Re-pick.' };
      // Sample face: compute its centroid + mean normal. Pick the
      // mesh point WHOSE OWN normal is most-parallel to the ref plane's
      // normal — that's where the cylinder is tangent to the ref.
      if (face.positions.length < 3 || face.normals.length < 3) {
        return { ok: false, error: 'Face mesh has no samples.' };
      }
      const refN = unit3(ref.normal as V3);
      let best = -Infinity;
      let bestPos: V3 = [0, 0, 0];
      let bestN: V3 = [0, 0, 0];
      const flip = m.flipped ? -1 : 1;
      for (let i = 0; i + 2 < face.positions.length; i += 3) {
        const n: V3 = [face.normals[i] * flip, face.normals[i + 1] * flip, face.normals[i + 2] * flip];
        const score = dot3(unit3(n), refN);
        if (score > best) {
          best = score;
          bestPos = [face.positions[i], face.positions[i + 1], face.positions[i + 2]];
          bestN = n;
        }
      }
      const plane = planeFromNormal(bestPos, bestN);
      if (!plane) return { ok: false, error: 'Cannot derive tangent plane from face.' };
      return { ok: true, plane };
    }
  }
}

// ──────────────────────────────────────────────────────────────────────
// User-defined Datum Axis (REQ 660) and Datum Point (REQ 661)
// ──────────────────────────────────────────────────────────────────────

export type DatumAxisResult =
  | { ok: true; axis: Axis3 }
  | { ok: false; error: string };

export type DatumPointResult =
  | { ok: true; position: [number, number, number] }
  | { ok: false; error: string };

/** Look up a face mesh in geometry.faces by its faceId. */
function findFaceMesh(geometry: ModelGeometry, faceId: string) {
  return geometry.faces.find(f => f.faceId === faceId) ?? null;
}

/** Find a topology edge by matching its endpoints to the EdgeRef3D's
 * start/end (in either order). EdgeRef3D doesn't carry an edgeId —
 * edges are identified by their picked endpoint coords. */
function findTopoEdge(geometry: ModelGeometry, ref: { start: [number, number, number]; end: [number, number, number] }, tol = 1e-3) {
  const close = (a: [number, number, number], b: [number, number, number]) =>
    Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < tol;
  for (const e of geometry.topology.edges) {
    if ((close(e.endpoints[0], ref.start) && close(e.endpoints[1], ref.end)) ||
        (close(e.endpoints[1], ref.start) && close(e.endpoints[0], ref.end))) {
      return e;
    }
  }
  return null;
}

/** Compute centroid of a face mesh from its tessellated positions. */
function faceCentroid(face: { positions: Float32Array | number[] }): V3 {
  let sx = 0, sy = 0, sz = 0, n = 0;
  for (let i = 0; i + 2 < face.positions.length; i += 3) {
    sx += face.positions[i];
    sy += face.positions[i + 1];
    sz += face.positions[i + 2];
    n++;
  }
  return n === 0 ? [0, 0, 0] : [sx / n, sy / n, sz / n];
}

/** Sample a face's representative normal — first valid normal vector
 * found in the tessellated normal array. */
function faceNormal(face: { normals: Float32Array | number[] }): V3 | null {
  for (let i = 0; i + 2 < face.normals.length; i += 3) {
    const nx = face.normals[i], ny = face.normals[i + 1], nz = face.normals[i + 2];
    const L = Math.hypot(nx, ny, nz);
    if (L > 1e-6) return [nx / L, ny / L, nz / L];
  }
  return null;
}

/** Resolve a Datum Axis feature to its world-space axis. Pure;
 * returns an `ok: false` row with a human error when picks are stale
 * or inputs are degenerate. REQ 660. */
export function computeDatumAxis(feature: DatumAxisFeature, geometry: ModelGeometry): DatumAxisResult {
  const m = feature.method;
  switch (m.kind) {
    case 'twoPoints': {
      const a = resolveVertex(m.vertexRefA, geometry);
      const b = resolveVertex(m.vertexRefB, geometry);
      if (!a) return { ok: false, error: 'First vertex no longer exists. Re-pick.' };
      if (!b) return { ok: false, error: 'Second vertex no longer exists. Re-pick.' };
      const dir = unit3(sub3(b, a));
      if (len3(dir) < 1e-6) return { ok: false, error: 'The two picked points are coincident.' };
      return { ok: true, axis: { origin: a, direction: dir } };
    }
    case 'alongEdge': {
      // Look up the edge in topology to see if it's straight or circular.
      const topoEdge = findTopoEdge(geometry, m.edgeRef);
      if (topoEdge?.polyline && topoEdge.polyline.length >= 3) {
        // Curved edge — fit a circle. If it fits, axis is the
        // circle's normal through its center. Otherwise fall
        // through to straight-line treatment.
        const fit = fitCircle(topoEdge.polyline);
        if (fit) {
          return { ok: true, axis: { origin: fit.center, direction: unit3(fit.normal) } };
        }
      }
      // Straight edge — axis runs from start to end.
      const start = m.edgeRef.start as V3;
      const end = m.edgeRef.end as V3;
      const dir = unit3(sub3(end, start));
      if (len3(dir) < 1e-6) return { ok: false, error: 'Edge endpoints are coincident.' };
      return { ok: true, axis: { origin: start, direction: dir } };
    }
    case 'twoPlanesIntersection': {
      const pa = resolvePlaneRef(m.planeRefA, geometry);
      const pb = resolvePlaneRef(m.planeRefB, geometry);
      if (!pa) return { ok: false, error: 'First plane no longer resolvable. Re-pick.' };
      if (!pb) return { ok: false, error: 'Second plane no longer resolvable. Re-pick.' };
      // Line of intersection: direction = cross of normals. Origin
      // is found by solving the two-plane linear system at a third
      // axis (the one most perpendicular to both normals).
      const dir = unit3(cross3(pa.normal as V3, pb.normal as V3));
      if (len3(dir) < 1e-6) return { ok: false, error: 'Picked planes are parallel — no intersection axis.' };
      // Origin: pick the largest direction component to set its
      // coord to 0, then solve the 2x2 system for the other two.
      // (Standard line-of-intersection-of-two-planes recipe.)
      const da = dot3(pa.normal as V3, pa.origin as V3);
      const db = dot3(pb.normal as V3, pb.origin as V3);
      const ax = Math.abs(dir[0]), ay = Math.abs(dir[1]), az = Math.abs(dir[2]);
      let origin: V3;
      if (ax >= ay && ax >= az) {
        const det = pa.normal[1] * pb.normal[2] - pa.normal[2] * pb.normal[1];
        const y = (da * pb.normal[2] - db * pa.normal[2]) / det;
        const z = (pa.normal[1] * db - pb.normal[1] * da) / det;
        origin = [0, y, z];
      } else if (ay >= az) {
        const det = pa.normal[0] * pb.normal[2] - pa.normal[2] * pb.normal[0];
        const x = (da * pb.normal[2] - db * pa.normal[2]) / det;
        const z = (pa.normal[0] * db - pb.normal[0] * da) / det;
        origin = [x, 0, z];
      } else {
        const det = pa.normal[0] * pb.normal[1] - pa.normal[1] * pb.normal[0];
        const x = (da * pb.normal[1] - db * pa.normal[1]) / det;
        const y = (pa.normal[0] * db - pb.normal[0] * da) / det;
        origin = [x, y, 0];
      }
      return { ok: true, axis: { origin, direction: dir } };
    }
    case 'cylindricalFaceAxis': {
      // We don't compute the cylinder's axis from face tessellation
      // (too noisy). The frontend captures the axis when the user
      // picks the cylindrical face (kernel reports the surface type
      // + axis on hover/click), and stores it as `fallbackAxis`.
      const a = m.fallbackAxis;
      if (!a) return { ok: false, error: 'Cylindrical-face axis snapshot missing. Re-pick.' };
      return { ok: true, axis: { origin: a.origin, direction: unit3(a.direction as V3) } };
    }
    case 'pointAndPerpFace': {
      const p = resolveVertex(m.vertexRef, geometry);
      if (!p) return { ok: false, error: 'Reference point no longer exists. Re-pick.' };
      const plane = resolvePlaneRef(m.planeRef, geometry);
      if (!plane) return { ok: false, error: 'Reference face/plane no longer resolvable. Re-pick.' };
      return { ok: true, axis: { origin: p, direction: unit3(plane.normal as V3) } };
    }
  }
}

/** Resolve a Datum Point feature to its world-space position.
 * REQ 661. */
export function computeDatumPoint(feature: DatumPointFeature, geometry: ModelGeometry): DatumPointResult {
  const m = feature.method;
  switch (m.kind) {
    case 'onVertex': {
      const p = resolveVertex(m.vertexRef, geometry);
      if (!p) return { ok: false, error: 'Vertex no longer exists. Re-pick.' };
      return { ok: true, position: p };
    }
    case 'centerOfFace': {
      const face = findFaceMesh(geometry, m.faceId);
      if (face) return { ok: true, position: faceCentroid(face) };
      // Face renamed across regen — fall back to the snapshot.
      return { ok: true, position: m.fallbackPosition };
    }
    case 'centerOfCircularEdge': {
      const topoEdge = findTopoEdge(geometry, m.edgeRef);
      if (topoEdge?.polyline && topoEdge.polyline.length >= 3) {
        const fit = fitCircle(topoEdge.polyline);
        if (fit) return { ok: true, position: fit.center };
      }
      return { ok: false, error: 'Edge is not circular (or its polyline is missing). Re-pick a circular edge.' };
    }
    case 'centerOfMass': {
      // The frontend captures body.centroid at pick time as a fallback;
      // the live centroid lives on the body record but isn't part of
      // ModelGeometry yet, so today we always use the snapshot.
      return { ok: true, position: m.fallbackPosition };
    }
    case 'alongEdge': {
      const t = Math.max(0, Math.min(1, m.t));
      const s = m.edgeRef.start as V3;
      const e = m.edgeRef.end as V3;
      // For straight edges this is exact; for curved edges, fall
      // back to lerping the chord (good enough for a reference
      // point — analytic param-along-curve needs kernel support).
      return { ok: true, position: [
        s[0] + (e[0] - s[0]) * t,
        s[1] + (e[1] - s[1]) * t,
        s[2] + (e[2] - s[2]) * t,
      ] };
    }
  }
}
