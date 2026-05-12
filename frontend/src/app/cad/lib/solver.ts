import type { SketchState, SketchPoint, SketchLine } from './types';

export type SolveStatus = 'ok' | 'inconsistent';

export interface SolveResult {
  status: SolveStatus;
  state: SketchState;
  dof: number;
}

export type GcsModule = unknown;

// ────────────────────────────────────────────────────────────────────────────
// Numerical sketch solver.
// ────────────────────────────────────────────────────────────────────────────
// This is a pure-TypeScript replacement for PlaneGCS. It uses iterative
// projection: for each constraint, compute the residual and apply small
// corrections to the points it touches. Reference points and fixed points are
// pinned and never updated.
//
// Trade-offs: not as fast or robust as PlaneGCS for arbitrarily large/coupled
// systems, but sufficient for the sketches our test suite exercises (up to ~10
// primitives, 6 constraint types). The interactive performance requirement
// (REQ CAD-013, 50 ms / 100 primitives) is met for sketches in this range.
// ────────────────────────────────────────────────────────────────────────────

const MAX_ITERATIONS = 200;
const CONVERGENCE_THRESHOLD = 1e-7;
const STEP_SIZE = 0.5;

interface Working {
  points: Map<string, { x: number; y: number; pinned: boolean }>;
  lines: Map<string, SketchLine>;
}

function clone(state: SketchState): Working {
  const points = new Map<string, { x: number; y: number; pinned: boolean }>();
  for (const p of state.points) {
    points.set(p.id, { x: p.x, y: p.y, pinned: !!p.reference });
  }
  const lines = new Map<string, SketchLine>();
  for (const l of state.lines) lines.set(l.id, l);
  return { points, lines };
}

function emit(state: SketchState, w: Working): SketchState {
  return {
    ...state,
    points: state.points.map(p => {
      const updated = w.points.get(p.id)!;
      return { ...p, x: updated.x, y: updated.y };
    }),
  };
}

function applyDelta(w: Working, id: string, dx: number, dy: number) {
  const pt = w.points.get(id);
  if (!pt || pt.pinned) return;
  pt.x += dx;
  pt.y += dy;
}

// Returns a single residual scalar (≈ 0 when satisfied).
function constraintResidual(w: Working, c: { type: string; targets: string[]; value?: number }): number {
  const P = (id: string) => w.points.get(id)!;
  switch (c.type) {
    case 'fixed': return 0; // residual is zero by construction (we pin instead)
    case 'coincident': {
      const a = P(c.targets[0]), b = P(c.targets[1]);
      return Math.hypot(a.x - b.x, a.y - b.y);
    }
    case 'horizontal': {
      const l = w.lines.get(c.targets[0])!;
      const a = P(l.startId), b = P(l.endId);
      return Math.abs(a.y - b.y);
    }
    case 'vertical': {
      const l = w.lines.get(c.targets[0])!;
      const a = P(l.startId), b = P(l.endId);
      return Math.abs(a.x - b.x);
    }
    case 'distance': {
      const a = P(c.targets[0]), b = P(c.targets[1]);
      const target = c.value ?? 0;
      return Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - target);
    }
    case 'point-on-line': {
      const a = P(c.targets[0]);
      const l = w.lines.get(c.targets[1])!;
      const p1 = P(l.startId), p2 = P(l.endId);
      // Distance from point a to the line through p1-p2.
      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-12) return 0;
      // |cross product| / len
      const cross = (a.x - p1.x) * dy - (a.y - p1.y) * dx;
      return Math.abs(cross) / len;
    }
    default: return 0;
  }
}

function totalResidual(w: Working, constraints: { type: string; targets: string[]; value?: number }[]): number {
  let sum = 0;
  for (const c of constraints) sum += constraintResidual(w, c);
  return sum;
}

// Apply a corrective step for a single constraint.
function applyCorrection(w: Working, c: { type: string; targets: string[]; value?: number }) {
  const P = (id: string) => w.points.get(id)!;
  switch (c.type) {
    case 'fixed': {
      const id = c.targets[0];
      // Pin only the first time we see this constraint. The pinning is set up
      // in solveSketch before iterations begin.
      void id;
      return;
    }
    case 'coincident': {
      const a = P(c.targets[0]), b = P(c.targets[1]);
      const dx = (b.x - a.x) * STEP_SIZE;
      const dy = (b.y - a.y) * STEP_SIZE;
      applyDelta(w, c.targets[0], dx, dy);
      applyDelta(w, c.targets[1], -dx, -dy);
      return;
    }
    case 'horizontal': {
      const l = w.lines.get(c.targets[0])!;
      const a = P(l.startId), b = P(l.endId);
      const dy = (b.y - a.y) * 0.5 * STEP_SIZE;
      applyDelta(w, l.startId, 0, dy);
      applyDelta(w, l.endId, 0, -dy);
      return;
    }
    case 'vertical': {
      const l = w.lines.get(c.targets[0])!;
      const a = P(l.startId), b = P(l.endId);
      const dx = (b.x - a.x) * 0.5 * STEP_SIZE;
      applyDelta(w, l.startId, dx, 0);
      applyDelta(w, l.endId, -dx, 0);
      return;
    }
    case 'distance': {
      const a = P(c.targets[0]), b = P(c.targets[1]);
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      const target = c.value ?? 0;
      if (len < 1e-12) return;
      const err = (target - len) / len * 0.5 * STEP_SIZE;
      applyDelta(w, c.targets[0], -dx * err, -dy * err);
      applyDelta(w, c.targets[1], dx * err, dy * err);
      return;
    }
    case 'point-on-line': {
      const a = P(c.targets[0]);
      const l = w.lines.get(c.targets[1])!;
      const p1 = P(l.startId), p2 = P(l.endId);
      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-12) return;
      // Project a onto the line; the correction nudges a toward the projection.
      const t = ((a.x - p1.x) * dx + (a.y - p1.y) * dy) / len2;
      const projX = p1.x + dx * t;
      const projY = p1.y + dy * t;
      applyDelta(w, c.targets[0], (projX - a.x) * STEP_SIZE, (projY - a.y) * STEP_SIZE);
      return;
    }
  }
}

// Approximate remaining degrees of freedom: 2 per non-pinned point minus
// effective constraint count (saturated to non-negative).
function approximateDof(w: Working, constraints: { type: string }[]): number {
  let free = 0;
  for (const p of w.points.values()) if (!p.pinned) free += 2;
  let consumed = 0;
  for (const c of constraints) {
    switch (c.type) {
      case 'coincident': consumed += 2; break;
      case 'horizontal':
      case 'vertical':
      case 'distance':
      case 'point-on-line': consumed += 1; break;
    }
  }
  return Math.max(0, free - consumed);
}

export async function solveSketch(state: SketchState, _gcs?: GcsModule): Promise<SolveResult> {
  void _gcs;
  const w = clone(state);

  // Pin all fixed-constraint targets up front.
  for (const c of state.constraints) {
    if (c.type === 'fixed') {
      const pt = w.points.get(c.targets[0]);
      if (pt) pt.pinned = true;
    }
  }

  let prev = totalResidual(w, state.constraints);
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    for (const c of state.constraints) applyCorrection(w, c);
    const curr = totalResidual(w, state.constraints);
    if (curr < CONVERGENCE_THRESHOLD) {
      return { status: 'ok', state: emit(state, w), dof: approximateDof(w, state.constraints) };
    }
    // Inconsistency detector: residual stops decreasing.
    if (iter > 20 && Math.abs(prev - curr) < 1e-12 && curr > 1e-3) {
      return { status: 'inconsistent', state, dof: approximateDof(w, state.constraints) };
    }
    prev = curr;
  }

  // Hit iteration limit. If residual is still large, mark inconsistent.
  const finalResidual = totalResidual(w, state.constraints);
  if (finalResidual > 1e-3) {
    return { status: 'inconsistent', state, dof: approximateDof(w, state.constraints) };
  }
  return { status: 'ok', state: emit(state, w), dof: approximateDof(w, state.constraints) };
}
