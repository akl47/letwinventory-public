// SolidWorks-style implicit references: snapping a sketch point onto the
// projection of an existing model vertex or straight edge, producing an
// external-reference relation WITHOUT running Convert Entities.
//
// `ReferenceCandidate`s are 2D projections of model vertices/straight edges
// onto the active sketch plane (see `projectTopologyToCandidates`). This
// module hit-tests a cursor against those candidates and derives the
// `ExternalRef` (vertexId / edgeId) used by the on-edge constraint + the
// regen-time re-projection, so the snapped point stays glued to the geometry.

import type { ExternalRef, ReferenceCandidate } from './types';

export interface CandidateHit {
  candidateId: string;
  kind: 'vertex' | 'edge' | 'center';
  /** Snapped 2D coordinate: the vertex point, or the closest point on the
   * edge segment to the cursor. */
  x: number;
  y: number;
  /** Distance from the cursor to the snapped coordinate. */
  dist: number;
  /** The candidate that was hit (carries the cross-part descriptor, if any). */
  candidate: ReferenceCandidate;
}

/** A topology id is namespaced `<featureId>/<localId>`; the feature prefix is
 * everything before the first slash. Mirrors `_tagProjected` in the editor. */
export function featureIdFromTopoId(topoId: string): string {
  return topoId.split('/')[0] ?? '';
}

/** Split a candidate id (`cand-v-<topoId>` / `cand-e-<topoId>`) into its kind
 * and the underlying topology id. The topology id may itself contain hyphens,
 * so we strip the fixed 7-char prefix rather than splitting on '-'. */
export function parseCandidateId(
  candidateId: string,
): { kind: 'vertex' | 'edge' | 'center'; topoId: string } | null {
  if (candidateId.startsWith('cand-v-')) return { kind: 'vertex', topoId: candidateId.slice(7) };
  if (candidateId.startsWith('cand-e-')) return { kind: 'edge', topoId: candidateId.slice(7) };
  if (candidateId.startsWith('cand-c-')) return { kind: 'center', topoId: candidateId.slice(7) };
  return null;
}

export interface CrossPartEdgeDescriptor {
  definingAssemblyId: number;
  definingAssemblyRepoId: string;
  sourceInstanceId: string;
  sourcePartId: number;
  /** Edge endpoints in the source part's local frame (resolver fallback). */
  sourceStart: [number, number, number];
  sourceEnd: [number, number, number];
  /** Stable id stored in sourceGeomRef.edgeId + used as the externalEdges key. */
  stableId: string;
}

export interface CrossPartVertexDescriptor {
  definingAssemblyId: number;
  definingAssemblyRepoId: string;
  sourceInstanceId: string;
  sourcePartId: number;
  /** Vertex position in the source part's local frame (resolver fallback). */
  sourcePosition: [number, number, number];
  stableId: string;
}

/** Cross-part on-edge ref: a point/entity riding ANOTHER component's edge.
 * Resolved by the backend via the fallback endpoint geometry; the stable id in
 * `sourceGeomRef.edgeId` keys its live 2D projection for solver/determinacy. */
export function crossPartEdgeRef(d: CrossPartEdgeDescriptor): ExternalRef {
  return {
    scope: 'cross-part',
    definingAssemblyId: d.definingAssemblyId,
    definingAssemblyRepoId: d.definingAssemblyRepoId,
    sourceInstanceId: d.sourceInstanceId,
    sourcePartId: d.sourcePartId,
    sourceGeomRef: { featureId: '', edgeId: d.stableId },
    fallback: { kind: 'edge', start: d.sourceStart, end: d.sourceEnd },
    pinnedSourceCommit: null,
  };
}

/** Cross-part vertex ref: a point pinned to ANOTHER component's vertex.
 * Resolved by fallback position; no edgeId, so it's PINNED (0 DOF) like a
 * local vertex ref rather than sliding. */
export function crossPartVertexRef(d: CrossPartVertexDescriptor): ExternalRef {
  return {
    scope: 'cross-part',
    definingAssemblyId: d.definingAssemblyId,
    definingAssemblyRepoId: d.definingAssemblyRepoId,
    sourceInstanceId: d.sourceInstanceId,
    sourcePartId: d.sourcePartId,
    sourceGeomRef: { featureId: '', vertexId: d.stableId },
    fallback: { kind: 'vertex', position: d.sourcePosition },
    pinnedSourceCommit: null,
  };
}

/** Build the `ExternalRef` for a candidate. A CROSS-PART candidate (another
 * component's edge, in-context) yields a cross-part edge ref; a local vertex
 * ref pins the point to the projected vertex; a local edge ref keeps the point
 * on the projected edge. */
export function externalRefForCandidate(candidate: ReferenceCandidate): ExternalRef | null {
  if (candidate.crossPart) return crossPartEdgeRef(candidate.crossPart);
  const parsed = parseCandidateId(candidate.id);
  if (!parsed) return null;
  const featureId = featureIdFromTopoId(parsed.topoId);
  if (parsed.kind === 'vertex') return { scope: 'local', featureId, vertexId: parsed.topoId };
  // A center reference is an edge ref carrying the `center` sub-element: the
  // point pins to the projected center of that circular edge (REQ 830–832).
  if (parsed.kind === 'center') return { scope: 'local', featureId, edgeId: parsed.topoId, sub: 'center' };
  return { scope: 'local', featureId, edgeId: parsed.topoId };
}

/** Projected 2D endpoints of every referenced model EDGE candidate, keyed by
 * the same external-ref lookup key the solver / determinacy / dimension render
 * consume (local edge → topoId, cross-part → stableId). */
export function externalEdgeLinesFromCandidates(
  candidates: ReferenceCandidate[],
): Map<string, [{ x: number; y: number }, { x: number; y: number }]> {
  const out = new Map<string, [{ x: number; y: number }, { x: number; y: number }]>();
  for (const c of candidates) {
    // Straight edges only (exactly 2 points). A curved edge's first chord
    // segment is not a meaningful "edge line", and emitting one would make a
    // center reference (same edgeId) ride that tiny segment instead of pinning
    // to the center. On-edge rides to curves are REQ 830–832.
    if (c.kind !== 'edge' || c.points.length !== 2) continue;
    const key = c.crossPart ? c.crossPart.stableId : parseCandidateId(c.id)?.topoId;
    if (key) out.set(key, [c.points[0], c.points[1]]);
  }
  return out;
}

/** Closest point on segment [a,b] to p (clamped to the segment). */
export function closestPointOnSegment(
  a: { x: number; y: number },
  b: { x: number; y: number },
  p: { x: number; y: number },
): { x: number; y: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return { x: a.x, y: a.y };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/** Closest point on a polyline (≥1 point) to p, plus its distance. A straight
 * edge candidate is a 2-point polyline (one segment); a projected curved edge
 * (arc / circle / spline) is the kernel-sampled polyline, so it must be tested
 * segment-by-segment — measuring only the first segment (the old single-segment
 * assumption) leaves the cursor on the arc body reading as "far". */
export function closestPointOnPolyline(
  points: ReadonlyArray<{ x: number; y: number }>,
  p: { x: number; y: number },
): { x: number; y: number; dist: number } {
  if (points.length === 1) {
    const a = points[0];
    return { x: a.x, y: a.y, dist: Math.hypot(a.x - p.x, a.y - p.y) };
  }
  let best = { x: points[0].x, y: points[0].y, dist: Infinity };
  for (let i = 0; i + 1 < points.length; i++) {
    const q = closestPointOnSegment(points[i], points[i + 1], p);
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < best.dist) best = { x: q.x, y: q.y, dist: d };
  }
  return best;
}

/** Nearest reference-candidate snap within `tol` of the cursor. Vertices are
 * preferred over edges when both are in range (snapping to an endpoint is
 * usually the user's intent), matching mainstream CAD inference order. */
export function nearestCandidateHit(
  candidates: ReferenceCandidate[],
  p: { x: number; y: number },
  tol: number,
): CandidateHit | null {
  let bestVertex: CandidateHit | null = null;
  let bestCenter: CandidateHit | null = null;
  let bestEdge: CandidateHit | null = null;
  for (const c of candidates) {
    if (c.kind === 'vertex') {
      const v = c.points[0];
      if (!v) continue;
      const dist = Math.hypot(v.x - p.x, v.y - p.y);
      if (dist <= tol && (!bestVertex || dist < bestVertex.dist)) {
        bestVertex = { candidateId: c.id, kind: 'vertex', x: v.x, y: v.y, dist, candidate: c };
      }
    } else if (c.kind === 'center') {
      // Projected arc/circle center (REQ 830) — a point snap, ranked alongside
      // vertices and above edges (concentric/coincident intent beats riding the
      // edge body).
      const v = c.points[0];
      if (!v) continue;
      const dist = Math.hypot(v.x - p.x, v.y - p.y);
      if (dist <= tol && (!bestCenter || dist < bestCenter.dist)) {
        bestCenter = { candidateId: c.id, kind: 'center', x: v.x, y: v.y, dist, candidate: c };
      }
    } else {
      // Straight edges only (exactly 2 points). A curved edge candidate carries
      // its tessellated polyline (>2 points) for hover HIGHLIGHTING, but
      // snapping a drawn point onto it would attach a point-on-line on-edge ref
      // against the chord — geometrically wrong. Curved on-edge / concentric
      // references are REQ 830–832 (point-on-curve solver), not wired yet.
      if (c.points.length !== 2) continue;
      const q = closestPointOnSegment(c.points[0], c.points[1], p);
      const dist = Math.hypot(q.x - p.x, q.y - p.y);
      if (dist <= tol && (!bestEdge || dist < bestEdge.dist)) {
        bestEdge = { candidateId: c.id, kind: 'edge', x: q.x, y: q.y, dist, candidate: c };
      }
    }
  }
  // Prefer the closer of vertex/center (both real points), then fall to edge.
  const point = !bestVertex ? bestCenter
    : !bestCenter ? bestVertex
    : (bestCenter.dist < bestVertex.dist ? bestCenter : bestVertex);
  return point ?? bestEdge;
}
