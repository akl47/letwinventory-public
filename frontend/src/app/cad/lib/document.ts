import type { SketchDocument, Sketch, SketchState, ModelTopology, Plane3, HostId, ReferenceCandidate } from './types';
import { emptySketchState } from './store';
import { projectFrom3D } from './plane';

let _docSeq = 0;
function nextCandidateId(): string {
  return `cand-${++_docSeq}`;
}

export function emptyDocument(): SketchDocument {
  return { sketches: {}, nextSketchSeq: 1 };
}

function projectTopologyToCandidates(plane: Plane3, topology: ModelTopology | null): ReferenceCandidate[] {
  if (!topology) return [];
  const candidates: ReferenceCandidate[] = [];
  for (const v of topology.vertices) {
    const p = projectFrom3D(plane, v.position);
    candidates.push({ id: `cand-v-${v.id}`, kind: 'vertex', points: [p] });
  }
  for (const e of topology.edges) {
    if (!e.isStraight) continue;
    const a = projectFrom3D(plane, e.endpoints[0]);
    const b = projectFrom3D(plane, e.endpoints[1]);
    const dx = a.x - b.x, dy = a.y - b.y;
    if (Math.hypot(dx, dy) < 1e-9) continue; // degenerate: perpendicular to plane
    candidates.push({ id: `cand-e-${e.id}`, kind: 'edge', points: [a, b] });
  }
  return candidates;
}

export function createSketch(
  doc: SketchDocument,
  hostId: HostId,
  plane: Plane3,
  topology: ModelTopology | null,
): { doc: SketchDocument; sketchId: string } {
  const sketchId = `s${doc.nextSketchSeq}`;
  const sketch: Sketch = {
    id: sketchId,
    hostId,
    plane,
    state: emptySketchState(),
    candidates: projectTopologyToCandidates(plane, topology),
  };
  return {
    doc: {
      sketches: { ...doc.sketches, [sketchId]: sketch },
      nextSketchSeq: doc.nextSketchSeq + 1,
    },
    sketchId,
  };
}

export function updateSketchState(
  doc: SketchDocument, sketchId: string, state: SketchState,
): SketchDocument {
  const existing = doc.sketches[sketchId];
  if (!existing) return doc;
  return {
    ...doc,
    sketches: { ...doc.sketches, [sketchId]: { ...existing, state } },
  };
}

export function findSketchByHost(doc: SketchDocument, hostId: HostId): Sketch | null {
  for (const sketch of Object.values(doc.sketches)) {
    if (sketch.hostId === hostId) return sketch;
  }
  return null;
}

export function promoteVertex(state: SketchState, candidateId: string, x: number, y: number)
  : { state: SketchState; id: string } {
  const id = `ref-${candidateId}`;
  return {
    state: { ...state, points: [...state.points, { id, x, y, reference: true }] },
    id,
  };
}

export function promoteEdge(
  state: SketchState, candidateId: string,
  start: { x: number; y: number }, end: { x: number; y: number },
): { state: SketchState; id: string } {
  const startId = `ref-${candidateId}-s`;
  const endId = `ref-${candidateId}-e`;
  const id = `ref-${candidateId}`;
  return {
    state: {
      points: [
        ...state.points,
        { id: startId, x: start.x, y: start.y, reference: true },
        { id: endId, x: end.x, y: end.y, reference: true },
      ],
      lines: [...state.lines, { id, startId, endId, reference: true }],
      constraints: state.constraints,
    },
    id,
  };
}
