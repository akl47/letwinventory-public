import type {
  SketchDocument, Sketch, SketchState, ModelTopology, Plane3, HostId, ReferenceCandidate,
  PointEntity, LineEntity,
} from './types';
import { emptySketchState } from './store';
import { projectFrom3D } from './plane';
import { newSketchId } from './ids';

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
  const sketchId = newSketchId(); // globally-unique (see ids.ts); nextSketchSeq still advanced for UI gating
  // SolidWorks-style default name: "Sketch N" where N counts existing
  // sketches in the doc. setSketchName overrides this when the user
  // renames; we only fill in at creation.
  const defaultName = `Sketch ${Object.keys(doc.sketches).length + 1}`;
  const sketch: Sketch = {
    id: sketchId,
    hostId,
    plane,
    state: emptySketchState(),
    candidates: projectTopologyToCandidates(plane, topology),
    // Unified creation timestamp so the feature tree can interleave
    // orphan sketches between features by chronological order, the way
    // SolidWorks does. Date.now() is precise enough — two creates
    // within the same ms are rare and stable-sort breaks ties by id.
    createdAt: Date.now(),
    name: defaultName,
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

export function deleteSketch(doc: SketchDocument, sketchId: string): SketchDocument {
  if (!(sketchId in doc.sketches)) return doc;
  const next: Record<string, Sketch> = {};
  for (const [id, sk] of Object.entries(doc.sketches)) {
    if (id !== sketchId) next[id] = sk;
  }
  return { ...doc, sketches: next };
}

export function setSketchVisibility(doc: SketchDocument, sketchId: string, visible: boolean): SketchDocument {
  const existing = doc.sketches[sketchId];
  if (!existing) return doc;
  return {
    ...doc,
    sketches: { ...doc.sketches, [sketchId]: { ...existing, visible } },
  };
}

export function setSketchName(doc: SketchDocument, sketchId: string, name: string): SketchDocument {
  const existing = doc.sketches[sketchId];
  if (!existing) return doc;
  return {
    ...doc,
    sketches: { ...doc.sketches, [sketchId]: { ...existing, name } },
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
  const e: PointEntity = { kind: 'point', id, x, y, construction: true };
  return { state: { ...state, entities: [...state.entities, e] }, id };
}

export function promoteEdge(
  state: SketchState, candidateId: string,
  start: { x: number; y: number }, end: { x: number; y: number },
): { state: SketchState; id: string } {
  const startId = `ref-${candidateId}-s`;
  const endId = `ref-${candidateId}-e`;
  const id = `ref-${candidateId}`;
  const sp: PointEntity = { kind: 'point', id: startId, x: start.x, y: start.y, construction: true };
  const ep: PointEntity = { kind: 'point', id: endId, x: end.x, y: end.y, construction: true };
  const ln: LineEntity = { kind: 'line', id, startId, endId, construction: true };
  return {
    state: {
      entities: [...state.entities, sp, ep, ln],
      constraints: state.constraints,
    },
    id,
  };
}
