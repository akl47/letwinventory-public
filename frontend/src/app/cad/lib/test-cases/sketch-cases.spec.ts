// Verifies every sketch test case from the catalog builds as documented, and
// that its constraint graph resolves to the expected determinacy. Shares its
// case list with the manual-verification generator
// (scripts/gen-sketch-test-part.mjs) via ./sketch-cases, so the two never drift.
//
// Deliberately does NOT call the PlaneGCS solver: the WASM solver can't be
// instantiated under the bundled unit-test runner (see solver.spec.ts), so DOF
// is asserted via the synchronous Jacobian-rank analyzer (analyzeDeterminacy),
// the same one that drives the editor's fully-constrained indicator.
import { describe, it, expect } from 'vitest';
import { SKETCH_CASES } from './sketch-cases';
import { emptySketchState, ORIGIN_POINT_ID } from '../store';
import { analyzeDeterminacy } from '../determinacy';
import { migrateSketchState } from '../migration';
import type { LegacySketchState } from '../migration';
import type { SketchState } from '../types';

// A sketch is fully constrained when every real (non-origin) point/line/circle/
// arc is pinned by the constraint graph. Mirrors the feature-tree indicator.
function fullyConstrained(state: SketchState): boolean {
  const tracked = state.entities.filter(e =>
    (e.kind === 'point' && e.id !== ORIGIN_POINT_ID)
    || e.kind === 'line' || e.kind === 'circle' || e.kind === 'arc');
  if (tracked.length === 0) return false;
  const determined = analyzeDeterminacy(state);
  return tracked.every(e => determined.has(e.id));
}

describe('sketch catalog test cases', () => {
  it('has the expected number of cases', () => {
    // Guards against a case silently dropping out of the shared list.
    expect(SKETCH_CASES.length).toBe(69);
  });

  for (const c of SKETCH_CASES) {
    it(`${c.id} — ${c.title}`, () => {
      // Legacy-schema case (S12): must upgrade to the entity model on load.
      if (c.raw) {
        const migrated = migrateSketchState(c.raw as LegacySketchState);
        expect(migrated.entities.some(e => e.kind === 'line')).toBe(true);
        return;
      }

      // Builds without throwing → origin + ≥1 authored entity.
      const state = c.build!(emptySketchState());
      expect(state.entities.length).toBeGreaterThan(1);

      // Determinacy expectations where the catalog pins one (S06 fully
      // constrained, S07 under-constrained). analyzeDeterminacy is rank-based
      // and synchronous — no solver needed.
      if (c.expect?.fullyConstrained === true) expect(fullyConstrained(state)).toBe(true);
      if (c.expect?.fullyConstrained === false) expect(fullyConstrained(state)).toBe(false);
    });
  }
});
