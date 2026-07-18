import { describe, it, expect } from 'vitest';
import { cacheCoversRollback, RollbackFeatureMeta } from './rollbackCoverage';

const F = (id: string, type = 'extrude', extra: Partial<RollbackFeatureMeta> = {}): RollbackFeatureMeta =>
  ({ id, type, ...extra });

// A small tree: origin, then 4 solid features, with a datum in the middle.
const TREE: RollbackFeatureMeta[] = [
  F('f1', 'origin'),
  F('f2'),
  F('f3', 'datumPlane'),
  F('f4'),
  F('f5', 'cutExtrude'),
  F('f6'),
];

describe('cacheCoversRollback', () => {
  it('is false when nothing is cached', () => {
    expect(cacheCoversRollback(TREE, new Set(), null)).toBe(false);
  });

  it('is true (no regen) when the full response covers a roll-to-end', () => {
    const cached = new Set(['f2', 'f4', 'f5', 'f6']); // datum + origin excluded
    expect(cacheCoversRollback(TREE, cached, null)).toBe(true);
  });

  it('is true when rolling the bar UP over already-built features', () => {
    const cached = new Set(['f2', 'f4', 'f5', 'f6']);
    // Bar before index 4 → only f2 must be covered (f4/f5/f6 are hidden by the bar).
    expect(cacheCoversRollback(TREE, cached, 4)).toBe(true);
  });

  it('is false when a visible feature below the bar was never built', () => {
    // Last regen ran with the bar parked high — f5/f6 not in cache. Rolling to
    // end must regen to build them.
    const cached = new Set(['f2', 'f4']);
    expect(cacheCoversRollback(TREE, cached, null)).toBe(false);
    // f5 (index 4) is still visible at cutoff 5 and uncached → must regen.
    expect(cacheCoversRollback(TREE, cached, 5)).toBe(false);
    // ...but rolling to index 4 (f5 + f6 hidden by the bar) is covered.
    expect(cacheCoversRollback(TREE, cached, 4)).toBe(true);
  });

  it('ignores origin, datums, suppressed and hidden features', () => {
    const tree: RollbackFeatureMeta[] = [
      F('f1', 'origin'),
      F('f2', 'extrude', { suppressed: true }),
      F('f3', 'datumAxis'),
      F('f4', 'extrude', { visible: false }),
      F('f5'),
    ];
    // Only f5 is a visible solid feature; covering it is enough.
    expect(cacheCoversRollback(tree, new Set(['f5']), null)).toBe(true);
  });
});
