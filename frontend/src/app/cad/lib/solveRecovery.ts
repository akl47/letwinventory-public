// ────────────────────────────────────────────────────────────────────────────
// REQ 922 — degenerate-solve detection + continuation recovery.
//
// A successful solve can still be WRONG for the user: the solver satisfies
// every constraint by collapsing an undimensioned line to zero length (a
// zero vector is parallel/perpendicular to anything), typically after a
// large dimension jump on a partially-dimensioned profile. These helpers
// detect that outcome and recover by continuation: seed each measurable
// dimension at its currently-measured value and re-solve while stepping the
// values toward their targets — small steps keep Newton on the
// non-degenerate branch.
//
// Pure lib so the behavior is unit-testable (the component's commit() just
// orchestrates: solve → detect → retry → emit/revert).
// ────────────────────────────────────────────────────────────────────────────
import { solveSketch, type SolveOptions, type SolveResult } from './solver';
import type { SketchState, SketchConstraint } from './types';
import { findPoint } from './types';

const COLLAPSE_TOL = 1e-3;

function lineLen(st: SketchState, l: { startId: string; endId: string }): number {
  const a = findPoint(st, l.startId), b = findPoint(st, l.endId);
  return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
}

/** Ids of non-construction lines that had real length in `before` and are
 * zero-length in `after` — the degenerate-collapse signature. */
export function collapsedLines(before: SketchState, after: SketchState): string[] {
  const afterById = new Map(after.entities.map(e => [e.id, e]));
  const out: string[] = [];
  for (const e of before.entities) {
    if (e.kind !== 'line' || e.construction) continue;
    const ae = afterById.get(e.id);
    if (ae?.kind !== 'line') continue;
    if (lineLen(before, e) > COLLAPSE_TOL && lineLen(after, ae) <= COLLAPSE_TOL) out.push(e.id);
  }
  return out;
}

/** A dim's value measured from CURRENT geometry, or null when the type isn't
 * measurable this way (angle, point-line). Seeds the continuation retry at a
 * value the geometry already satisfies. */
export function measuredDimValue(state: SketchState, c: SketchConstraint): number | null {
  if (c.type === 'radius' || c.type === 'diameter') {
    const e = state.entities.find(en => en.id === c.targets[0]?.entityId);
    if (!e || (e.kind !== 'circle' && e.kind !== 'arc')) return null;
    return c.type === 'diameter' ? e.radius * 2 : e.radius;
  }
  if (c.type !== 'distance' && c.type !== 'horizontal-distance' && c.type !== 'vertical-distance') return null;
  if (c.targets.length !== 2) return null;
  const a = findPoint(state, c.targets[0].entityId);
  const b = findPoint(state, c.targets[1].entityId);
  if (!a || !b) return null;
  if (c.type === 'horizontal-distance') return Math.abs(b.x - a.x);
  if (c.type === 'vertical-distance') return Math.abs(b.y - a.y);
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export interface RecoveredSolve {
  result: SolveResult;
  /** True when the first solve collapsed and the continuation retry fixed it. */
  recovered: boolean;
  /** True when even the retry could only find a degenerate solution — the
   * caller should reject the commit (and, for value edits, revert). */
  collapsed: boolean;
}

/**
 * solveSketch + degenerate-collapse detection + continuation recovery.
 * `stepCounts` is exposed for tests; the defaults walk the values in 4
 * steps and fall back to 12 finer ones.
 */
export async function solveWithRecovery(
  state: SketchState, opts?: SolveOptions, stepCounts: number[] = [4, 12],
): Promise<RecoveredSolve> {
  const result = await solveSketch(state, opts);
  if (result.status !== 'ok' || collapsedLines(state, result.state).length === 0) {
    return { result, recovered: false, collapsed: false };
  }
  const retry = await solveByContinuation(state, opts, stepCounts);
  if (retry) return { result: retry, recovered: true, collapsed: false };
  return { result, recovered: false, collapsed: true };
}

/** The continuation retry on its own. Null when no dim differs from its
 * measured value or every step count fails/collapses. */
export async function solveByContinuation(
  next: SketchState, opts?: SolveOptions, stepCounts: number[] = [4, 12],
): Promise<SolveResult | null> {
  const starts = new Map<string, number>();
  for (const c of next.constraints) {
    if (c.value === undefined) continue;
    if (c.driven) continue;  // the solver ignores driven dims — nothing to walk
    const m = measuredDimValue(next, c);
    if (m !== null && Math.abs(m - c.value) > 1e-9) starts.set(c.id, m);
  }
  if (starts.size === 0) return null;
  outer: for (const steps of stepCounts) {
    let cur = next;
    let last: SolveResult | null = null;
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const stepState: SketchState = {
        ...next,
        entities: cur.entities,
        // Last step uses the exact target constraint objects.
        constraints: k === steps ? next.constraints : next.constraints.map(c => {
          const s = starts.get(c.id);
          return s === undefined || c.value === undefined ? c : { ...c, value: s + (c.value - s) * t };
        }),
      };
      const r = await solveSketch(stepState, opts);
      if (r.status !== 'ok' || collapsedLines(stepState, r.state).length > 0) continue outer;
      cur = r.state;
      last = r;
    }
    return last;
  }
  return null;
}
