// The solve behind a sketch drag (REQs 1092, 1093). Pure so it is
// unit-testable; the sketch editor only supplies the inputs and emits the result.
import type { SketchConstraint, SketchState } from './types';
import { findEntity, findPoint } from './types';
import { textBoxParts } from './store';
import { solveSketch, type SolveOptions, type SolveResult } from './solver';

/** Point ids a drag of `dragged` keeps fixed: curve centers and construction
 * line endpoints, minus the ones that have to follow the dragged points. */
export function dragHeldPoints(state: SketchState, dragged: Set<string>): Set<string> {
  const held = new Set<string>();
  for (const e of state.entities) {
    if (e.kind === 'arc' || e.kind === 'circle') held.add(e.centerId);
    else if (e.kind === 'line' && e.construction) { held.add(e.startId); held.add(e.endId); }
  }
  // An arc's endpoint can only move with its center (the radius is pinned),
  // so dragging a slot's rail end carries that cap along.
  for (const e of state.entities) {
    if (e.kind === 'arc' && (dragged.has(e.startId) || dragged.has(e.endId))) held.delete(e.centerId);
  }
  // A text box is one rigid unit: its corners and centerline must follow the
  // dragged point. Holding them left nothing free, so PlaneGCS dropped the
  // box constraints and reported success with the box broken.
  for (const e of state.entities) {
    if (e.kind === 'text') for (const id of textBoxParts(state, e.id).points) held.delete(id);
  }
  // A point welded to a dragged one must follow it. Held, both ends of the
  // coincident are fixed, so PlaneGCS drops it and reports success with the
  // weld pulled apart (a construction line left behind by its corner).
  const follow = [...dragged];
  const seen = new Set(dragged);
  while (follow.length) {
    const id = follow.pop()!;
    for (const c of state.constraints) {
      if (c.type !== 'coincident' || c.targets.length !== 2) continue;
      const [a, b] = [c.targets[0].entityId, c.targets[1].entityId];
      const other = a === id ? b : b === id ? a : null;
      if (other === null || seen.has(other)) continue;
      seen.add(other);
      held.delete(other);
      follow.push(other);
    }
  }
  return held;
}

export interface DragSolveInputs {
  /** Fully-defined point ids (analyzeDeterminacy). They never move in a drag. */
  determined?: Set<string>;
  /** Points pinned to projected model geometry — never movable. */
  anchors?: Set<string>;
  externalEdges?: SolveOptions['externalEdges'];
  /** The sketch before this drag step moved the dragged points. Lets the
   * narrowest pass be discarded when it throws a neighbour much further than
   * the drag itself. */
  before?: SketchState;
}

/**
 * Solve a drag with the dragged points pinned at the cursor and curve radii
 * pinned (the user is translating; resizing needs an explicit dimension).
 * Fully-defined points stay where they are, so dragging fully-defined geometry
 * is refused outright. The solver spreads a move over every point it is
 * allowed to touch, so the allowed set widens in three steps: only the points
 * that share a line or arc with a dragged point (a rectangle corner moves its
 * two neighbours, not the opposite corner); then everything except the points
 * `dragHeldPoints` names — the defining points of slots, tabs, rounded shapes
 * — so dragging one slot center leaves the other where it is; then those too.
 * A result that broke a constraint counts as unsolved. When the exact cursor
 * position can't be solved, the move is retried along one axis only.
 */
export async function solveDrag(state: SketchState, dragged: Set<string>, inputs: DragSolveInputs = {}): Promise<SolveResult> {
  const refused: SolveResult = { status: 'inconsistent', state, dof: 0 };
  const determined = inputs.determined ?? new Set<string>();
  for (const id of dragged) if (determined.has(id)) return refused;
  const held = dragHeldPoints(state, dragged);
  const movable = new Set<string>();
  for (const e of state.entities) {
    if (e.kind === 'point' && !dragged.has(e.id) && !inputs.anchors?.has(e.id) && !determined.has(e.id)) movable.add(e.id);
  }
  const opts = { pinAllRadii: true, externalEdges: inputs.externalEdges };
  const unheld = new Set([...movable].filter(id => !held.has(id)));
  const near = dragNeighbours(state, dragged);
  const passes = [new Set([...unheld].filter(id => near.has(id))), unheld, movable];
  const attempt = async (requested: SketchState): Promise<SolveResult | null> => {
    for (const [i, pass] of passes.entries()) {
      const r = await solveSketch(requested, { ...opts, movablePoints: pass });
      if (r.status !== 'ok' || droppedConstraint(r.state, dragged, pass)) continue;
      if (i === 0 && inputs.before && overshoots(inputs.before, requested, r.state, dragged)) continue;
      return r;
    }
    return null;
  };
  const exact = await attempt(state);
  if (exact) return exact;
  // The cursor left where the constraints let the point go (a point on a
  // horizontal line dragged diagonally). Follow the part of the move they do
  // allow: one axis at a time, the larger component first.
  if (!inputs.before) return refused;
  const before = inputs.before;
  const delta = (axis: 'x' | 'y') => Math.max(0, ...[...dragged].map(id =>
    Math.abs((findPoint(state, id)?.[axis] ?? 0) - (findPoint(before, id)?.[axis] ?? 0))));
  const axes: ('x' | 'y')[] = delta('x') >= delta('y') ? ['x', 'y'] : ['y', 'x'];
  for (const axis of axes) {
    if (delta(axis) < 1e-9) continue;
    const other = axis === 'x' ? 'y' : 'x';
    const slid = await attempt({
      ...state,
      entities: state.entities.map(e => {
        const b = e.kind === 'point' && dragged.has(e.id) ? findPoint(before, e.id) : undefined;
        return e.kind === 'point' && b ? { ...e, [other]: b[other] } : e;
      }),
    });
    if (slid) return slid;
  }
  return refused;
}

/** True when a point that wasn't dragged moved more than twice as far as the
 * dragged points did in this step — a valid solution, but not one a user
 * would call following the cursor. */
function overshoots(before: SketchState, requested: SketchState, solved: SketchState, dragged: Set<string>): boolean {
  const step = (from: SketchState, to: SketchState, id: string) => {
    const a = findPoint(from, id), b = findPoint(to, id);
    return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
  };
  let drag = 0;
  for (const id of dragged) drag = Math.max(drag, step(before, requested, id));
  return solved.entities.some(e => e.kind === 'point' && !dragged.has(e.id) && step(before, solved, e.id) > 2 * drag + 1e-6);
}

/** The other points of every line or arc that ends at a dragged point, or at
 * a point welded to one. */
function dragNeighbours(state: SketchState, dragged: Set<string>): Set<string> {
  const ends = new Set(dragged);
  const follow = [...dragged];
  while (follow.length) {
    const id = follow.pop()!;
    for (const c of state.constraints) {
      if (c.type !== 'coincident' || c.targets.length !== 2) continue;
      const [a, b] = [c.targets[0].entityId, c.targets[1].entityId];
      const other = a === id ? b : b === id ? a : null;
      if (other !== null && !ends.has(other)) { ends.add(other); follow.push(other); }
    }
  }
  const out = new Set(ends);
  for (const e of state.entities) {
    if (e.kind !== 'line' && e.kind !== 'arc') continue;
    const pts = pointsOfTarget(state, e.id);
    if (pts.some(id => ends.has(id))) for (const id of pts) out.add(id);
  }
  return out;
}

/** PlaneGCS drops a constraint whose points are all fixed and still reports
 * success. True when the drag left such a constraint unsatisfied. */
function droppedConstraint(solved: SketchState, dragged: Set<string>, movable: Set<string>): boolean {
  for (const c of solved.constraints) {
    if (c.driven || c.externalRef) continue;
    const pts = c.targets.flatMap(t => pointsOfTarget(solved, t.entityId));
    if (!pts.some(id => dragged.has(id)) || pts.some(id => movable.has(id))) continue;
    const r = constraintResidual(solved, c);
    if (r !== null && r > 1e-3) return true;
  }
  return false;
}

function pointsOfTarget(state: SketchState, id: string): string[] {
  const e = findEntity(state, id);
  if (!e) return [];
  if (e.kind === 'point') return [e.id];
  if (e.kind === 'line') return [e.startId, e.endId];
  if (e.kind === 'circle') return [e.centerId];
  if (e.kind === 'arc') return [e.centerId, e.startId, e.endId];
  return [];
}

/** How far the geometry is from satisfying `c`, or null for a constraint
 * type this doesn't measure. */
export function constraintResidual(state: SketchState, c: SketchConstraint): number | null {
  const pt = (i: number) => findPoint(state, c.targets[i]?.entityId ?? '');
  const vec = (i: number) => {
    const l = findEntity(state, c.targets[i]?.entityId ?? '');
    if (l?.kind !== 'line') return null;
    const a = findPoint(state, l.startId), b = findPoint(state, l.endId);
    return a && b ? { a, x: b.x - a.x, y: b.y - a.y, len: Math.hypot(b.x - a.x, b.y - a.y) } : null;
  };
  switch (c.type) {
    case 'coincident': {
      const a = pt(0), b = pt(1);
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null;
    }
    case 'horizontal':
    case 'vertical': {
      const axis = c.type === 'horizontal' ? 'y' : 'x';
      if (c.targets.length === 1) { const v = vec(0); return v ? Math.abs(v[axis]) : null; }
      const a = pt(0), b = pt(1);
      return a && b ? Math.abs(a[axis] - b[axis]) : null;
    }
    case 'parallel':
    case 'perpendicular': {
      const u = vec(0), v = vec(1);
      if (!u || !v || u.len === 0 || v.len === 0) return null;
      const n = c.type === 'parallel' ? u.x * v.y - u.y * v.x : u.x * v.x + u.y * v.y;
      return Math.abs(n) / (u.len * v.len);
    }
    case 'equal': {
      const u = vec(0), v = vec(1);
      return u && v ? Math.abs(u.len - v.len) : null;
    }
    case 'distance': {
      const a = pt(0), b = pt(1);
      return a && b && c.value !== undefined ? Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - c.value) : null;
    }
    case 'point-line-distance': {
      const p = pt(0), v = vec(1);
      if (!p || !v || v.len === 0 || c.value === undefined) return null;
      return Math.abs(Math.abs(v.x * (p.y - v.a.y) - v.y * (p.x - v.a.x)) / v.len - c.value);
    }
    default:
      return null;
  }
}
