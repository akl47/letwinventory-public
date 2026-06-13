// Live "ghost" geometry for in-progress Extrude / Cut Extrude / Revolve
// features. Generates a triangle mesh from the current sidebar parameters
// so the viewer can show a translucent preview before the user commits.
// Geometry only — the viewer wraps the output in a Three.js BufferGeometry
// and applies the translucent material.
//
// This is the "cheap" preview path: ear-clipped caps + side walls / swept
// quads from the analytic profile, no boolean evaluation. For Cut Extrude
// we render the cutting prism (in red on the viewer side) rather than the
// actual subtracted result — the user gets a clear "this is the volume
// I'm removing" without paying the kernel round-trip per keystroke.

import * as THREE from 'three';
import type {
  SketchState, Plane3, LineEntity, PointEntity, ExtrudeEndCondition,
  ExtrudeStartCondition, ExtrudeDirection, SketchEntity, ArcEntity, CircleEntity,
} from './types';
import { extractRegions, tessellateProfileLoop, type ProfileRegion } from './profile';
import { projectTo3D } from './plane';
import { tessellateArc, tessellateCircle } from './tessellator';

export interface PreviewMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export interface ExtrudePreviewParams {
  sketchState: SketchState;
  plane: Plane3;
  distance: number;
  flipped: boolean;
  regionIndices: number[];
  endCondition?: ExtrudeEndCondition;
  /** Start condition — where the profile begins along the plane normal.
   * Missing == sketchPlane (offset 0). */
  startCondition?: ExtrudeStartCondition;
  /** Pre-resolved signed start offset along the plane normal. When set,
   * overrides whatever the startCondition would compute on its own —
   * used by the live preview to honor upToVertex/upToSurface starts
   * (the editor knows the target geometry and passes the projected
   * distance in). When omitted, startCondition's own `offset.distance`
   * is used and Up-To-* kinds collapse to sketchPlane (offset 0). */
  startOffsetOverride?: number;
  /** Optional second direction. When present, a second prism is built
   * starting from the same start offset and going the OPPOSITE direction
   * from direction 1. */
  direction2?: ExtrudeDirection;
  /** Resolver for `#{var}` placeholders in sketch text. The editor passes a
   * resolver built from its `textVariables` so the extrude preview shows the
   * same resolved characters the viewer's sketch overlay draws. Identity when
   * omitted. */
  resolveText?: (raw: string) => string;
}

export interface RevolvePreviewParams {
  sketchState: SketchState;
  plane: Plane3;
  axisLineId: string;
  angleDeg: number;
  flipped: boolean;
  regionIndices: number[];
}

// ────────────────────────────────────────────────────────────────────────────
// Extrude preview
// ────────────────────────────────────────────────────────────────────────────

/** Build a translucent prism mesh for the in-progress Extrude / Cut. The
 * caller already knows which colour to paint (additive vs subtractive);
 * this function only produces geometry. End conditions other than blind /
 * midPlane fall back to blind for the preview (the kernel still resolves
 * the real one on commit). Returns null when there's nothing valid to
 * preview — bad params, empty regions, etc. */
export function extrudePreview(p: ExtrudePreviewParams): PreviewMesh | null {
  const { regions } = extractRegions(p.sketchState, p.resolveText);
  if (regions.length === 0) return null;

  // Start offset along the plane normal. Editor passes the resolved
  // value when the start condition is Up-To-Vertex / Up-To-Surface
  // (it knows the target's 3D position from the rendered geometry).
  // Otherwise we resolve from the start condition itself: 'offset'
  // uses its signed distance, anything else stays at 0.
  const startKind = p.startCondition?.kind ?? 'sketchPlane';
  const startOffset = p.startOffsetOverride !== undefined
    ? p.startOffsetOverride
    : (startKind === 'offset'
        ? (p.startCondition as { kind: 'offset'; distance: number }).distance
        : 0);

  // Pick the two extents (relative to startOffset) that each direction
  // contributes. Mid-Plane is symmetric around the start so it ignores
  // direction 2 — same convention SolidWorks uses.
  const ranges: Array<[number, number]> = [];  // [from, to] offsets per prism
  const dir1Kind = p.endCondition?.kind ?? 'blind';
  if (dir1Kind === 'midPlane') {
    const half = resolveExtent(p.distance, dir1Kind);
    if (half === null) return null;
    ranges.push([startOffset - half, startOffset + half]);
  } else {
    const dir1Extent = resolveExtent(p.distance, dir1Kind);
    if (dir1Extent === null) return null;
    const dir1Sign = p.flipped ? -1 : 1;
    ranges.push([startOffset, startOffset + dir1Sign * dir1Extent]);
    if (p.direction2) {
      const dir2Extent = resolveExtent(p.direction2.distance, p.direction2.endCondition.kind);
      if (dir2Extent !== null && p.direction2.endCondition.kind !== 'midPlane') {
        // Direction 2 grows the OPPOSITE way from direction 1's sign.
        ranges.push([startOffset, startOffset - dir1Sign * dir2Extent]);
      }
    }
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (const [from, to] of ranges) {
    for (const ri of p.regionIndices) {
      if (ri < 0 || ri >= regions.length) continue;
      addRegionPrism(regions[ri], p.plane, from, to, positions, normals, indices);
    }
  }

  if (indices.length === 0) return null;
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}

/** Magnitude of the prism length one direction contributes. Throw-All
 * uses a large visual fallback; midPlane returns the HALF-extent so the
 * caller can center the prism manually. */
function resolveExtent(distance: number, kind: ExtrudeEndCondition['kind']): number | null {
  const THROUGH_ALL_PREVIEW = 1e4;
  if (kind === 'throughAll') return THROUGH_ALL_PREVIEW;
  // Up To Body / Up To Next's true extent is only known to the kernel (it
  // conforms to the target body). Preview a long prism so the user sees the
  // direction; the real body-conforming end appears on commit.
  if (kind === 'upToBody' || kind === 'upToNext') return THROUGH_ALL_PREVIEW;
  if (!isFinite(distance) || Math.abs(distance) < 1e-6) return null;
  if (kind === 'midPlane') return distance / 2;
  return distance;
}

/** Mutates `positions` / `normals` / `indices` in-place. Builds:
 *  - top cap (triangulated, normal = +plane.normal)
 *  - bottom cap (triangulated, normal = -plane.normal)
 *  - one quad per boundary edge of the outer loop and each hole loop. */
function addRegionPrism(
  region: ProfileRegion, plane: Plane3,
  startOffset: number, endOffset: number,
  positions: number[], normals: number[], indices: number[],
): void {
  // Tessellate the outer + hole loops at a coarser tolerance — this is a
  // visual preview, not the committed mesh. Smaller chord = denser side
  // walls + more cap triangles for no real benefit.
  const outer2d = tessellateProfileLoop(region.outer, 0.5);
  if (outer2d.length < 3) return;
  const holes2d = region.holes
    .map(h => tessellateProfileLoop(h, 0.5))
    .filter(h => h.length >= 3);

  // Triangulate the cap once in 2D (THREE.ShapeUtils does ear-clipping
  // with hole support). Reuse the index list for both top and bottom
  // caps — the bottom cap reverses winding so its normal points down.
  const contour = outer2d.map(p => new THREE.Vector2(p.x, p.y));
  const holes = holes2d.map(h => h.map(p => new THREE.Vector2(p.x, p.y)));
  // ShapeUtils.triangulateShape returns indices INTO the merged
  // [contour, ...holes] vertex array, in that order.
  const triIndices = THREE.ShapeUtils.triangulateShape(contour, holes);

  // 2D vertex set (outer then holes) — matches the index ordering above.
  const all2d = [...outer2d, ...holes2d.flat()];

  // Offset world positions for the top + bottom plates. Order: all top
  // verts first, then all bottom verts, then side wall verts (each
  // bottom-top pair gets a fresh quad with its own normal so the side
  // walls render with flat shading).
  const baseTop = positions.length / 3;
  for (const p of all2d) {
    const w = offsetPoint(plane, p.x, p.y, endOffset);
    positions.push(w[0], w[1], w[2]);
    normals.push(plane.normal[0], plane.normal[1], plane.normal[2]);
  }
  const baseBot = positions.length / 3;
  for (const p of all2d) {
    const w = offsetPoint(plane, p.x, p.y, startOffset);
    positions.push(w[0], w[1], w[2]);
    // Bottom cap normal flips so the face points away from the prism.
    normals.push(-plane.normal[0], -plane.normal[1], -plane.normal[2]);
  }

  // Cap triangles. Top cap uses the original winding; bottom flips it.
  for (const tri of triIndices) {
    indices.push(baseTop + tri[0], baseTop + tri[1], baseTop + tri[2]);
    indices.push(baseBot + tri[2], baseBot + tri[1], baseBot + tri[0]);
  }

  // Side walls — one quad per boundary edge. Each quad gets its own four
  // vertices (no sharing) so flat normals don't smudge into the caps.
  // Outer loop's normal points outward; holes flip.
  addSideWalls(outer2d, plane, startOffset, endOffset, false, positions, normals, indices);
  for (const hole2d of holes2d) {
    addSideWalls(hole2d, plane, startOffset, endOffset, true, positions, normals, indices);
  }
}

function addSideWalls(
  loop2d: { x: number; y: number }[],
  plane: Plane3, startOffset: number, endOffset: number,
  inwardNormal: boolean,
  positions: number[], normals: number[], indices: number[],
): void {
  const n = loop2d.length;
  for (let i = 0; i < n; i++) {
    const a = loop2d[i];
    const b = loop2d[(i + 1) % n];
    // Tangent direction along the loop (a → b).
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    // Outward normal in 2D: rotate tangent CW by 90° for CCW loops.
    // Holes are CW so the same rotation yields the inward normal — we
    // flip the sign to keep "outward from the prism volume".
    let nx2 = dy / len;
    let ny2 = -dx / len;
    if (inwardNormal) { nx2 = -nx2; ny2 = -ny2; }
    // Lift the 2D normal into 3D via the plane basis.
    const n3 = [
      nx2 * plane.xAxis[0] + ny2 * plane.yAxis[0],
      nx2 * plane.xAxis[1] + ny2 * plane.yAxis[1],
      nx2 * plane.xAxis[2] + ny2 * plane.yAxis[2],
    ];
    const base = positions.length / 3;
    // Four corners of the quad.
    pushVertex(positions, normals, offsetPoint(plane, a.x, a.y, startOffset), n3);
    pushVertex(positions, normals, offsetPoint(plane, b.x, b.y, startOffset), n3);
    pushVertex(positions, normals, offsetPoint(plane, b.x, b.y, endOffset), n3);
    pushVertex(positions, normals, offsetPoint(plane, a.x, a.y, endOffset), n3);
    // Two triangles per quad, winding so the front face matches `n3`.
    // If endOffset < startOffset (flipped extrude) the winding flips.
    if (endOffset >= startOffset) {
      indices.push(base, base + 1, base + 2);
      indices.push(base, base + 2, base + 3);
    } else {
      indices.push(base, base + 2, base + 1);
      indices.push(base, base + 3, base + 2);
    }
  }
}

function pushVertex(positions: number[], normals: number[], pos: [number, number, number], n: number[]): void {
  positions.push(pos[0], pos[1], pos[2]);
  normals.push(n[0], n[1], n[2]);
}

function offsetPoint(plane: Plane3, x2d: number, y2d: number, offset: number): [number, number, number] {
  const p = projectTo3D(plane, x2d, y2d);
  return [
    p[0] + plane.normal[0] * offset,
    p[1] + plane.normal[1] * offset,
    p[2] + plane.normal[2] * offset,
  ];
}

// ────────────────────────────────────────────────────────────────────────────
// Revolve preview
// ────────────────────────────────────────────────────────────────────────────

/** Sweep the profile region around the sketched axis line by `angleDeg`
 * degrees. Generates side-surface quads + (for partial revolves) start
 * and end cap triangulations so the user sees the volume that WILL be
 * generated. Returns null when params are invalid (no profile, missing
 * axis, degenerate axis line, etc.). */
export function revolvePreview(p: RevolvePreviewParams): PreviewMesh | null {
  if (!isFinite(p.angleDeg) || p.angleDeg <= 0) return null;
  const axisPoints = resolveAxisPoints(p.sketchState, p.axisLineId);
  if (!axisPoints) return null;
  const { regions } = extractRegions(p.sketchState);
  if (regions.length === 0) return null;

  // The axis in 3D — origin + unit direction. Sweep rotates each profile
  // sample around this oriented line.
  const a3 = projectTo3D(p.plane, axisPoints.a.x, axisPoints.a.y);
  const b3 = projectTo3D(p.plane, axisPoints.b.x, axisPoints.b.y);
  const axisOrigin: [number, number, number] = a3;
  let axisDir: [number, number, number] = [b3[0] - a3[0], b3[1] - a3[1], b3[2] - a3[2]];
  const axisLen = Math.hypot(axisDir[0], axisDir[1], axisDir[2]);
  if (axisLen < 1e-9) return null;
  axisDir = [axisDir[0] / axisLen, axisDir[1] / axisLen, axisDir[2] / axisLen];
  if (p.flipped) axisDir = [-axisDir[0], -axisDir[1], -axisDir[2]];

  const totalAngleRad = (p.angleDeg * Math.PI) / 180;
  // ~5° per slice keeps the silhouette smooth enough at default zoom.
  const slices = Math.max(8, Math.ceil(totalAngleRad / (Math.PI / 36)));

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (const ri of p.regionIndices) {
    if (ri < 0 || ri >= regions.length) continue;
    addRegionRevolve(
      regions[ri], p.plane, axisOrigin, axisDir, totalAngleRad, slices,
      positions, normals, indices,
    );
  }
  if (indices.length === 0) return null;
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}

function addRegionRevolve(
  region: ProfileRegion, plane: Plane3,
  axisOrigin: [number, number, number], axisDir: [number, number, number],
  totalAngleRad: number, slices: number,
  positions: number[], normals: number[], indices: number[],
): void {
  const outer2d = tessellateProfileLoop(region.outer, 0.5);
  if (outer2d.length < 3) return;
  // Profile in 3D, on the sketch plane (zero rotation slice).
  const profile3d = outer2d.map(p => projectTo3D(plane, p.x, p.y));

  // Build N rotation slices of the profile around the axis. Each slice
  // has the same vertex count as the profile; we then connect slice i to
  // slice i+1 with quad strips for the lateral surface.
  const sliceCount = slices + 1;  // closed N quads need N+1 vertex rings
  const verticesPerSlice = profile3d.length;
  const baseSide = positions.length / 3;

  for (let s = 0; s < sliceCount; s++) {
    const theta = (totalAngleRad * s) / slices;
    for (const p of profile3d) {
      const r = rotateAroundAxis(p, axisOrigin, axisDir, theta);
      positions.push(r[0], r[1], r[2]);
      // Flat-shaded by leaving the normals zero for now; the side-pass
      // below overwrites each face's vertices with averaged normals.
      normals.push(0, 0, 0);
    }
  }
  // Per-quad face normals (each pair of triangles between adjacent
  // slices and adjacent profile vertices). Re-emit duplicated vertices
  // with face-normals so flat shading reads cleanly.
  for (let s = 0; s < slices; s++) {
    for (let i = 0; i < verticesPerSlice; i++) {
      const a = baseSide + s * verticesPerSlice + i;
      const b = baseSide + s * verticesPerSlice + ((i + 1) % verticesPerSlice);
      const c = baseSide + (s + 1) * verticesPerSlice + ((i + 1) % verticesPerSlice);
      const d = baseSide + (s + 1) * verticesPerSlice + i;
      // Compute the quad's geometric normal once and overwrite all four
      // vertex normals with it. Front face = (a, b, c, d) winding.
      const pa = [positions[a*3], positions[a*3+1], positions[a*3+2]];
      const pb = [positions[b*3], positions[b*3+1], positions[b*3+2]];
      const pd = [positions[d*3], positions[d*3+1], positions[d*3+2]];
      const u = [pb[0]-pa[0], pb[1]-pa[1], pb[2]-pa[2]];
      const v = [pd[0]-pa[0], pd[1]-pa[1], pd[2]-pa[2]];
      const n: [number, number, number] = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
      const nl = Math.hypot(n[0], n[1], n[2]);
      if (nl > 1e-9) { n[0] /= nl; n[1] /= nl; n[2] /= nl; }
      // The same vertex is shared by up to 4 quads — last writer wins.
      // Acceptable for a translucent preview where pixel-perfect shading
      // isn't the point.
      for (const idx of [a, b, c, d]) {
        normals[idx*3] = n[0]; normals[idx*3+1] = n[1]; normals[idx*3+2] = n[2];
      }
      indices.push(a, b, c);
      indices.push(a, c, d);
    }
  }

  // Cap the start and end if the revolve is partial. For a full 360°
  // revolve the start and end coincide and no cap is needed (also
  // matches what OCCT's closed-revolve constructor produces).
  const isFull = Math.abs(totalAngleRad - Math.PI * 2) < 1e-3;
  if (!isFull) {
    const startProfile3d = profile3d;
    const endProfile3d = profile3d.map(p => rotateAroundAxis(p, axisOrigin, axisDir, totalAngleRad));
    // Cap normals point along ±axisDir × something; easier: use the cap
    // plane's normal which is the cross of axis and tangent. For the
    // closed loop, the cap is planar; just use the original plane's
    // normal as an approximation (rotated by 0 / totalAngleRad).
    const startNormal: [number, number, number] = [
      -plane.normal[0], -plane.normal[1], -plane.normal[2],
    ];
    const endNormal: [number, number, number] = [
      ...rotateVector(plane.normal, axisDir, totalAngleRad),
    ] as [number, number, number];
    const contour = outer2d.map(p => new THREE.Vector2(p.x, p.y));
    const triIndices = THREE.ShapeUtils.triangulateShape(contour, []);
    const startBase = positions.length / 3;
    for (const w of startProfile3d) {
      positions.push(w[0], w[1], w[2]);
      normals.push(startNormal[0], startNormal[1], startNormal[2]);
    }
    const endBase = positions.length / 3;
    for (const w of endProfile3d) {
      positions.push(w[0], w[1], w[2]);
      normals.push(endNormal[0], endNormal[1], endNormal[2]);
    }
    for (const tri of triIndices) {
      // Start cap: winding flipped so normal matches startNormal.
      indices.push(startBase + tri[2], startBase + tri[1], startBase + tri[0]);
      // End cap: original winding.
      indices.push(endBase + tri[0], endBase + tri[1], endBase + tri[2]);
    }
  }
}

function rotateAroundAxis(
  p: [number, number, number],
  origin: [number, number, number],
  axis: [number, number, number],
  theta: number,
): [number, number, number] {
  // Rodrigues' rotation formula. axis must already be unit-length.
  const cos = Math.cos(theta), sin = Math.sin(theta);
  const dx = p[0] - origin[0], dy = p[1] - origin[1], dz = p[2] - origin[2];
  const ax = axis[0], ay = axis[1], az = axis[2];
  const dotV = dx * ax + dy * ay + dz * az;
  const cx = ay * dz - az * dy;
  const cy = az * dx - ax * dz;
  const cz = ax * dy - ay * dx;
  const oneMinusCos = 1 - cos;
  return [
    origin[0] + dx * cos + cx * sin + ax * dotV * oneMinusCos,
    origin[1] + dy * cos + cy * sin + ay * dotV * oneMinusCos,
    origin[2] + dz * cos + cz * sin + az * dotV * oneMinusCos,
  ];
}

function rotateVector(
  v: [number, number, number],
  axis: [number, number, number],
  theta: number,
): [number, number, number] {
  // Same as above without the origin offset — pure direction rotation.
  return rotateAroundAxis(v, [0, 0, 0], axis, theta);
}

function resolveAxisPoints(state: SketchState, axisLineId: string): { a: PointEntity; b: PointEntity } | null {
  const line = state.entities.find(e => e.id === axisLineId && e.kind === 'line') as LineEntity | undefined;
  if (!line) return null;
  const a = state.entities.find(e => e.id === line.startId && e.kind === 'point') as PointEntity | undefined;
  const b = state.entities.find(e => e.id === line.endId && e.kind === 'point') as PointEntity | undefined;
  if (!a || !b) return null;
  return { a, b };
}

// ────────────────────────────────────────────────────────────────────────────
// Sweep preview
// ────────────────────────────────────────────────────────────────────────────

export interface SweepPreviewParams {
  profileSketchState: SketchState;
  profilePlane: Plane3;
  pathSketchState: SketchState;
  pathPlane: Plane3;
  regionIndices: number[];
}

/** Sweep the profile region(s) along the path. Builds the swept volume by
 * transporting the profile through each path sample with a parallel-
 * transport frame (minimum rotation between successive tangents). The
 * profile retains its world-space starting position; subsequent slices
 * are translated by the path delta and rotated by the accumulated
 * frame transport. Endcaps are emitted only for OPEN paths. Returns null
 * when the path can't be chained or the profile sits parallel to the
 * path's start tangent (degenerate sweep). */
export function sweepPreview(p: SweepPreviewParams): PreviewMesh | null {
  const path3 = extractPathSamples(p.pathSketchState, p.pathPlane);
  if (!path3 || path3.points.length < 2) return null;

  const { regions } = extractRegions(p.profileSketchState);
  if (regions.length === 0) return null;

  // Frame transport: at each sample, carry (N, B) forward by the minimum
  // rotation that takes the previous tangent to the current tangent. The
  // first sample's frame is anchored on the profile sketch's basis so
  // the profile appears in its drawn orientation at the path start.
  const frames = buildTransportFrames(path3, p.profilePlane);
  if (!frames) return null;

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (const ri of p.regionIndices) {
    if (ri < 0 || ri >= regions.length) continue;
    addRegionSweep(regions[ri], p.profilePlane, path3, frames, positions, normals, indices);
  }

  if (indices.length === 0) return null;
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}

interface PathSamples {
  /** 3D world-space samples along the path, in chain order. For closed
   * paths (single circle), the last sample equals the first. */
  points: Array<[number, number, number]>;
  /** True when the path closes back on itself — no endcaps in that case. */
  closed: boolean;
}

interface TransportFrame {
  tangent: [number, number, number];
  normal: [number, number, number];   // maps to profile-local x
  binormal: [number, number, number]; // maps to profile-local y
}

function extractPathSamples(state: SketchState, plane: Plane3): PathSamples | null {
  const chord = 0.5;
  // Special case: lone circle = closed circular path. Tessellate directly.
  const circles = state.entities.filter((e): e is CircleEntity =>
    e.kind === 'circle' && !e.construction);
  const lines = state.entities.filter((e): e is LineEntity =>
    e.kind === 'line' && !e.construction);
  const arcs = state.entities.filter((e): e is ArcEntity =>
    e.kind === 'arc' && !e.construction);
  if (circles.length === 1 && lines.length === 0 && arcs.length === 0) {
    const c = circles[0];
    const center = state.entities.find(en => en.id === c.centerId && en.kind === 'point') as PointEntity | undefined;
    if (!center) return null;
    const pts2 = tessellateCircle({ x: center.x, y: center.y }, c.radius, chord);
    const pts3 = pts2.map(p => projectTo3D(plane, p.x, p.y) as [number, number, number]);
    return { points: pts3, closed: true };
  }

  // Walk the segment chain: each segment carries its 2D start/end ids.
  // Build adjacency and start from a degree-1 vertex (open) or any vertex
  // (closed loop). Falls back to chronological order when adjacency fails.
  type Seg = { id: string; startId: string; endId: string; entity: LineEntity | ArcEntity };
  const segs: Seg[] = [
    ...lines.map(l => ({ id: l.id, startId: l.startId, endId: l.endId, entity: l as LineEntity | ArcEntity })),
    ...arcs.map(a => ({ id: a.id, startId: a.startId, endId: a.endId, entity: a as LineEntity | ArcEntity })),
  ];
  if (segs.length === 0) return null;

  const adj = new Map<string, string[]>();
  for (const s of segs) {
    if (!adj.has(s.startId)) adj.set(s.startId, []);
    if (!adj.has(s.endId)) adj.set(s.endId, []);
    adj.get(s.startId)!.push(s.id);
    adj.get(s.endId)!.push(s.id);
  }
  // Reject degree > 2 — the path forks, no unambiguous chain.
  for (const verts of adj.values()) {
    if (verts.length > 2) return null;
  }
  const segById = new Map(segs.map(s => [s.id, s]));
  const endpoints = [...adj.entries()].filter(([, ids]) => ids.length === 1).map(([v]) => v);
  const closed = endpoints.length === 0;
  let currentVertex = closed ? segs[0].startId : endpoints[0];
  const visited = new Set<string>();
  const pts2: Array<{ x: number; y: number }> = [];
  const findPt = (id: string) => state.entities.find(e => e.id === id && e.kind === 'point') as PointEntity | undefined;
  const startP = findPt(currentVertex);
  if (!startP) return null;
  pts2.push({ x: startP.x, y: startP.y });

  for (let i = 0; i < segs.length; i++) {
    const candidates = (adj.get(currentVertex) ?? []).filter(id => !visited.has(id));
    if (candidates.length === 0) break;
    const sid = candidates[0];
    visited.add(sid);
    const seg = segById.get(sid)!;
    const goingForward = seg.startId === currentVertex;
    const nextVertex = goingForward ? seg.endId : seg.startId;
    if (seg.entity.kind === 'line') {
      const endP = findPt(nextVertex);
      if (!endP) return null;
      pts2.push({ x: endP.x, y: endP.y });
    } else {
      // arc — tessellate then push (reversed if walking against drawn dir)
      const samples = tessellateEntityCurve(state, seg.entity, chord);
      if (samples.length < 2) return null;
      const ordered = goingForward ? samples : samples.slice().reverse();
      for (let j = 1; j < ordered.length; j++) pts2.push(ordered[j]);
    }
    currentVertex = nextVertex;
    if (closed && currentVertex === startP.id) break;
  }
  if (pts2.length < 2) return null;
  const pts3 = pts2.map(p => projectTo3D(plane, p.x, p.y) as [number, number, number]);
  return { points: pts3, closed };
}

function tessellateEntityCurve(
  state: SketchState, entity: LineEntity | ArcEntity, chord: number,
): Array<{ x: number; y: number }> {
  if (entity.kind === 'line') {
    const a = state.entities.find(e => e.id === entity.startId && e.kind === 'point') as PointEntity | undefined;
    const b = state.entities.find(e => e.id === entity.endId && e.kind === 'point') as PointEntity | undefined;
    if (!a || !b) return [];
    return [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
  }
  // Arc
  const c = state.entities.find(e => e.id === entity.centerId && e.kind === 'point') as PointEntity | undefined;
  const s = state.entities.find(e => e.id === entity.startId && e.kind === 'point') as PointEntity | undefined;
  const e = state.entities.find(en => en.id === entity.endId && en.kind === 'point') as PointEntity | undefined;
  if (!c || !s || !e) return [];
  const startAngle = Math.atan2(s.y - c.y, s.x - c.x);
  const endAngle = Math.atan2(e.y - c.y, e.x - c.x);
  return tessellateArc({ x: c.x, y: c.y }, entity.radius, startAngle, endAngle, entity.ccw !== false, chord);
}

/** Build per-sample transport frames. Initial frame's normal/binormal come
 * from the profile plane's basis (so the profile renders at its drawn
 * orientation at the path start). Subsequent frames apply the minimum
 * rotation that takes the previous tangent to the current tangent — the
 * standard "parallel transport" used to suppress twist along a curve. */
function buildTransportFrames(path: PathSamples, profilePlane: Plane3): TransportFrame[] | null {
  const n = path.points.length;
  const tangents: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    const prev = path.points[Math.max(0, i - 1)];
    const next = path.points[Math.min(n - 1, i + 1)];
    const t: [number, number, number] = [next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]];
    const len = Math.hypot(t[0], t[1], t[2]);
    if (len < 1e-9) return null;
    tangents.push([t[0] / len, t[1] / len, t[2] / len]);
  }
  // Initial frame from the profile plane: normal = profile.xAxis, binormal
  // = profile.yAxis. Reject if the profile sketch is parallel to the path
  // tangent at start (degenerate — profile would flatten to a line).
  const t0 = tangents[0];
  const profileNormal = profilePlane.normal;
  const dot = profileNormal[0] * t0[0] + profileNormal[1] * t0[1] + profileNormal[2] * t0[2];
  if (Math.abs(dot) < 0.05) return null;  // ~3° between profile plane and path tangent
  const frames: TransportFrame[] = [{
    tangent: t0,
    normal: [profilePlane.xAxis[0], profilePlane.xAxis[1], profilePlane.xAxis[2]],
    binormal: [profilePlane.yAxis[0], profilePlane.yAxis[1], profilePlane.yAxis[2]],
  }];
  for (let i = 1; i < n; i++) {
    const tPrev = tangents[i - 1];
    const tCurr = tangents[i];
    const cosA = clamp(tPrev[0] * tCurr[0] + tPrev[1] * tCurr[1] + tPrev[2] * tCurr[2], -1, 1);
    if (cosA > 0.9999) {
      // Tangent unchanged — carry frame forward.
      frames.push({ tangent: tCurr, normal: frames[i - 1].normal, binormal: frames[i - 1].binormal });
      continue;
    }
    const angle = Math.acos(cosA);
    const axis: [number, number, number] = [
      tPrev[1] * tCurr[2] - tPrev[2] * tCurr[1],
      tPrev[2] * tCurr[0] - tPrev[0] * tCurr[2],
      tPrev[0] * tCurr[1] - tPrev[1] * tCurr[0],
    ];
    const axisLen = Math.hypot(axis[0], axis[1], axis[2]);
    if (axisLen < 1e-9) {
      frames.push({ tangent: tCurr, normal: frames[i - 1].normal, binormal: frames[i - 1].binormal });
      continue;
    }
    const u: [number, number, number] = [axis[0] / axisLen, axis[1] / axisLen, axis[2] / axisLen];
    const prevFrame = frames[i - 1];
    frames.push({
      tangent: tCurr,
      normal: rotateVector(prevFrame.normal, u, angle),
      binormal: rotateVector(prevFrame.binormal, u, angle),
    });
  }
  return frames;
}

function clamp(x: number, lo: number, hi: number): number { return x < lo ? lo : x > hi ? hi : x; }

function addRegionSweep(
  region: ProfileRegion, profilePlane: Plane3,
  path: PathSamples, frames: TransportFrame[],
  positions: number[], normals: number[], indices: number[],
): void {
  const outer2d = tessellateProfileLoop(region.outer, 0.5);
  if (outer2d.length < 3) return;

  const verticesPerSlice = outer2d.length;
  const sliceCount = path.points.length;
  const baseSide = positions.length / 3;

  // Sample 0 reference: profile vertices in 3D, on the profile plane.
  const profileRef3d = outer2d.map(p => projectTo3D(profilePlane, p.x, p.y) as [number, number, number]);
  // Local 2D coords of each profile vertex in the profile-plane basis
  // — needed so we can re-express them in each transport frame.
  const profileLocal = outer2d.map(p => ({ u: p.x, v: p.y }));

  // Build all slice vertices.
  const pathOrigin = path.points[0];
  for (let s = 0; s < sliceCount; s++) {
    const frame = frames[s];
    const center = path.points[s];
    for (let i = 0; i < verticesPerSlice; i++) {
      const { u, v } = profileLocal[i];
      // Sample 0: use the profile's own 3D position verbatim (anchored).
      // Subsequent samples: rebuild from the transport frame at that
      // sample plus the path translation. This keeps the profile looking
      // identical at the start and gracefully sweeps it as the frame
      // rotates.
      if (s === 0) {
        positions.push(profileRef3d[i][0], profileRef3d[i][1], profileRef3d[i][2]);
      } else {
        positions.push(
          center[0] + u * frame.normal[0] + v * frame.binormal[0],
          center[1] + u * frame.normal[1] + v * frame.binormal[1],
          center[2] + u * frame.normal[2] + v * frame.binormal[2],
        );
      }
      normals.push(0, 0, 0);  // overwritten below per-quad
    }
  }

  // Side-wall quads. Closed paths still close because path.points[N-1]
  // == path.points[0] for circles (we kept the closing duplicate in
  // extractPathSamples). The frame at sliceCount-1 is the rotated-back
  // frame, so the seam aligns visually.
  for (let s = 0; s < sliceCount - 1; s++) {
    for (let i = 0; i < verticesPerSlice; i++) {
      const iNext = (i + 1) % verticesPerSlice;
      const a = baseSide + s * verticesPerSlice + i;
      const b = baseSide + s * verticesPerSlice + iNext;
      const c = baseSide + (s + 1) * verticesPerSlice + iNext;
      const d = baseSide + (s + 1) * verticesPerSlice + i;
      const pa: [number, number, number] = [positions[a * 3], positions[a * 3 + 1], positions[a * 3 + 2]];
      const pb: [number, number, number] = [positions[b * 3], positions[b * 3 + 1], positions[b * 3 + 2]];
      const pd: [number, number, number] = [positions[d * 3], positions[d * 3 + 1], positions[d * 3 + 2]];
      const u: [number, number, number] = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
      const v: [number, number, number] = [pd[0] - pa[0], pd[1] - pa[1], pd[2] - pa[2]];
      const nx = u[1] * v[2] - u[2] * v[1];
      const ny = u[2] * v[0] - u[0] * v[2];
      const nz = u[0] * v[1] - u[1] * v[0];
      const nl = Math.hypot(nx, ny, nz) || 1;
      const norm: [number, number, number] = [nx / nl, ny / nl, nz / nl];
      for (const idx of [a, b, c, d]) {
        normals[idx * 3] = norm[0];
        normals[idx * 3 + 1] = norm[1];
        normals[idx * 3 + 2] = norm[2];
      }
      indices.push(a, b, c);
      indices.push(a, c, d);
    }
  }

  // Endcaps for open paths only — closed paths (circles) have no
  // exposed face to cap.
  if (!path.closed) {
    const contour = outer2d.map(p => new THREE.Vector2(p.x, p.y));
    const triIndices = THREE.ShapeUtils.triangulateShape(contour, []);
    // Start cap normal: -tangent at sample 0; end cap normal: +tangent at last.
    const startNormal: [number, number, number] = [-frames[0].tangent[0], -frames[0].tangent[1], -frames[0].tangent[2]];
    const endNormal: [number, number, number] = [frames[sliceCount - 1].tangent[0], frames[sliceCount - 1].tangent[1], frames[sliceCount - 1].tangent[2]];
    const startBase = positions.length / 3;
    for (let i = 0; i < verticesPerSlice; i++) {
      const idx = baseSide + 0 * verticesPerSlice + i;
      positions.push(positions[idx * 3], positions[idx * 3 + 1], positions[idx * 3 + 2]);
      normals.push(startNormal[0], startNormal[1], startNormal[2]);
    }
    const endBase = positions.length / 3;
    for (let i = 0; i < verticesPerSlice; i++) {
      const idx = baseSide + (sliceCount - 1) * verticesPerSlice + i;
      positions.push(positions[idx * 3], positions[idx * 3 + 1], positions[idx * 3 + 2]);
      normals.push(endNormal[0], endNormal[1], endNormal[2]);
    }
    for (const tri of triIndices) {
      indices.push(startBase + tri[2], startBase + tri[1], startBase + tri[0]);  // flipped winding
      indices.push(endBase + tri[0], endBase + tri[1], endBase + tri[2]);
    }
  }
}
