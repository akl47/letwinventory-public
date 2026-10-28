import { describe, it, expect } from 'vitest';
import { disabledReason, DISABLED_REASON } from './disabledReason';

// REQ 989 — disabled ribbon buttons explain themselves on hover.
describe('disabledReason', () => {
  it('returns null when no check blocks (button enabled, normal tooltip)', () => {
    expect(disabledReason()).toBeNull();
    expect(disabledReason([false, 'a'], [false, 'b'])).toBeNull();
  });

  it('returns the FIRST blocking reason — order is priority', () => {
    expect(disabledReason([false, 'a'], [true, 'b'], [true, 'c'])).toBe('b');
  });

  it('read-only wins over the in-sketch and no-body reasons', () => {
    const r = disabledReason(
      [true, 'Check out to edit'],
      [true, DISABLED_REASON.inSketch],
      [true, DISABLED_REASON.noBody],
    );
    expect(r).toBe('Check out to edit');
  });

  it('names a concrete next step for every standard precondition', () => {
    expect(DISABLED_REASON.inSketch).toMatch(/exit the sketch/i);
    expect(DISABLED_REASON.noBody).toMatch(/extrude/i);
    expect(DISABLED_REASON.twoBodies).toMatch(/two bodies/i);
    expect(DISABLED_REASON.twoSketches).toMatch(/two sketches/i);
    expect(DISABLED_REASON.notCheckedOutByMe).toMatch(/check out/i);
    expect(DISABLED_REASON.needsApproval).toMatch(/approv/i);
    expect(DISABLED_REASON.noSketch).toMatch(/sketch/i);
  });
});
