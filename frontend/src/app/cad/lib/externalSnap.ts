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
  kind: 'vertex' | 'edge';
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
): { kind: 'vertex' | 'edge'; topoId: string } | null {
  if (candidateId.startsWith('cand-v-')) return { kind: 'vertex', topoId: candidateId.slice(7) };
  if (candidateId.startsWith('cand-e-')) return { kind: 'edge', topoId: candidateId.slice(7) };
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
  return parsed.kind === 'vertex'
    ? { scope: 'local', featureId, vertexId: parsed.topoId }
    : { scope: 'local', featureId, edgeId: parsed.topoId };
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

/** Nearest reference-candidate snap within `tol` of the cursor. Vertices are
 * preferred over edges when both are in range (snapping to an endpoint is
 * usually the user's intent), matching mainstream CAD inference order. */
export function nearestCandidateHit(
  candidates: ReferenceCandidate[],
  p: { x: number; y: number },
  tol: number,
): CandidateHit | null {
  let bestVertex: CandidateHit | null = null;
  let bestEdge: CandidateHit | null = null;
  for (const c of candidates) {
    if (c.kind === 'vertex') {
      const v = c.points[0];
      if (!v) continue;
      const dist = Math.hypot(v.x - p.x, v.y - p.y);
      if (dist <= tol && (!bestVertex || dist < bestVertex.dist)) {
        bestVertex = { candidateId: c.id, kind: 'vertex', x: v.x, y: v.y, dist, candidate: c };
      }
    } else {
      const a = c.points[0];
      const b = c.points[1];
      if (!a || !b) continue;
      const q = closestPointOnSegment(a, b, p);
      const dist = Math.hypot(q.x - p.x, q.y - p.y);
      if (dist <= tol && (!bestEdge || dist < bestEdge.dist)) {
        bestEdge = { candidateId: c.id, kind: 'edge', x: q.x, y: q.y, dist, candidate: c };
      }
    }
  }
  return bestVertex ?? bestEdge;
}
