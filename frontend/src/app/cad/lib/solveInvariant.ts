// REQ 923 — the dimensional-consistency invariant for solver tests.
//
// A solve that reports 'ok' must actually mean it: every measurable
// dimensional constraint's stored value matches the solved geometry, and no
// non-construction line silently collapsed to zero length. The class of bug
// this guards against (REQ 922): a degenerate solution satisfies every
// residual, so status-only assertions pass while the sketch is destroyed.
//
// Pure (no vitest import) so it can also be used by debug tooling; specs
// assert `dimensionalViolations(...)` is empty after each ok solve.
import type { SketchState } from './types';
import type { SolveResult } from './solver';
import { collapsedLines, measuredDimValue } from './solveRecovery';

const DIM_TOL = 1e-3;

/** Human-readable violations of the dims-match-geometry invariant. Empty on
 * a healthy solve. Non-'ok' results return [] — the invariant only speaks
 * to solves that CLAIM success. */
export function dimensionalViolations(before: SketchState, result: SolveResult): string[] {
  if (result.status !== 'ok') return [];
  const out: string[] = [];
  for (const id of collapsedLines(before, result.state)) {
    out.push(`line '${id}' collapsed to zero length`);
  }
  for (const c of result.state.constraints) {
    if (c.value === undefined) continue;
    // Driven (reference) dims report measurements without pinning DOFs —
    // their stored value may legitimately disagree until re-measured.
    if (c.driven) continue;
    const measured = measuredDimValue(result.state, c);
    if (measured === null) continue;
    // h/v-distance store unsigned magnitudes; distance is always positive.
    const stored = Math.abs(c.value);
    if (Math.abs(measured - stored) > DIM_TOL) {
      out.push(`dim '${c.id}' (${c.type}) stores ${stored} but geometry measures ${measured}`);
    }
  }
  return out;
}
