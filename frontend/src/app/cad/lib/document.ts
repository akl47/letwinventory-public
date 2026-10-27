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

export function projectTopologyToCandidates(plane: Plane3, topology: ModelTopology | null): ReferenceCandidate[] {
  if (!topology) return [];
  const candidates: ReferenceCandidate[] = [];
  for (const v of topology.vertices) {
    const p = projectFrom3D(plane, v.position);
    candidates.push({ id: `cand-v-${v.id}`, kind: 'vertex', points: [p] });
  }
  for (const e of topology.edges) {
    if (e.isStraight) {
      const a = projectFrom3D(plane, e.endpoints[0]);
      const b = projectFrom3D(plane, e.endpoints[1]);
      const dx = a.x - b.x, dy = a.y - b.y;
      if (Math.hypot(dx, dy) < 1e-9) continue; // degenerate: perpendicular to plane
      candidates.push({ id: `cand-e-${e.id}`, kind: 'edge', points: [a, b] });
    } else if (e.polyline && e.polyline.length >= 2) {
      // Curved edge (arc / circle / spline): project the kernel-sampled polyline
      // so it can be hovered and snapped like a straight edge. The two endpoints
      // alone are a chord — the cursor on the arc body would read as far away and
      // the edge never highlights. Drop points that collapse together when the
      // edge runs nearly perpendicular to the sketch plane.
      const proj: Array<{ x: number; y: number }> = [];
      for (const p3 of e.polyline) {
        const q = projectFrom3D(plane, p3);
        const last = proj[proj.length - 1];
        if (!last || Math.hypot(q.x - last.x, q.y - last.y) > 1e-9) proj.push(q);
      }
      if (proj.length >= 2) candidates.push({ id: `cand-e-${e.id}`, kind: 'edge', points: proj });
      // Arc/circle center (REQ 830): if the projected polyline fits a circle,
      // expose its center as a snap target so a placed circle/arc/point can be
      // made concentric / coincident-to-center. Non-circular curves (splines)
      // fail the fit and get no center.
      const center = circleCenterFromProjected(proj);
      if (center) candidates.push({ id: `cand-c-${e.id}`, kind: 'center', points: [center] });
    }
  }
  return candidates;
}

/** Fit a circle to projected 2D polyline samples and return its center, or null
 * when the samples aren't circular (e.g. a spline) or are too few. Handles both
 * a closed loop (full circle) and an open arc. Mirrors the backend's
 * `_circleFromPolyline` / `_arcFromPolyline` center derivation so the snap and
 * the regen-time re-projection agree. */
export function circleCenterFromProjected(
  pts: ReadonlyArray<{ x: number; y: number }>,
): { x: number; y: number } | null {
  if (pts.length < 3) return null;
  const first = pts[0], last = pts[pts.length - 1];
  const closed = Math.hypot(last.x - first.x, last.y - first.y) < 1e-4;
  // Parity with the backend (`_circleFromPolyline` requires >= 8 samples for a
  // closed loop): only offer a center the regen-time re-projection will also
  // produce. Without this, a coarse 3-7 point closed loop snaps here but the
  // backend yields no center, so the relation can't track the model. (Also
  // rejects the degenerate 3-point "closed" loop whose centroid is a false
  // center.) Open arcs use the circumcircle path below at >= 3 like the backend.
  if (closed && pts.length < 8) return null;
  let cx: number, cy: number;
  if (closed) {
    // Centroid of the distinct loop samples.
    let sx = 0, sy = 0;
    for (let i = 0; i < pts.length - 1; i++) { sx += pts[i].x; sy += pts[i].y; }
    cx = sx / (pts.length - 1); cy = sy / (pts.length - 1);
  } else {
    // Circumcircle of first / middle / last.
    const mid = pts[Math.floor(pts.length / 2)];
    const d = 2 * (first.x * (mid.y - last.y) + mid.x * (last.y - first.y) + last.x * (first.y - mid.y));
    if (Math.abs(d) < 1e-12) return null; // collinear → straight, not circular
    const a2 = first.x * first.x + first.y * first.y;
    const b2 = mid.x * mid.x + mid.y * mid.y;
    const c2 = last.x * last.x + last.y * last.y;
    cx = (a2 * (mid.y - last.y) + b2 * (last.y - first.y) + c2 * (first.y - mid.y)) / d;
    cy = (a2 * (last.x - mid.x) + b2 * (first.x - last.x) + c2 * (mid.x - first.x)) / d;
  }
  const radius = Math.hypot(pts[0].x - cx, pts[0].y - cy);
  if (radius < 1e-6) return null;
  // Every sample must lie on the fitted circle (within 1% + epsilon) — rejects
  // ellipses / splines whose "center" would be meaningless.
  const ok = pts.every(p => Math.abs(Math.hypot(p.x - cx, p.y - cy) - radius) < radius * 0.01 + 1e-3);
  if (!ok) return null;
  return { x: cx, y: cy };
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
