import { describe, it, expect } from 'vitest';
import { equationMergeRows } from './mergeEquations';

// REQ 955 — the merge picker lists every equation that differs.
describe('equationMergeRows (REQ 955)', () => {
  it('lists added, removed, and changed variables; skips identical ones', () => {
    const main = { entries: { shared: { expression: '10' }, same: { expression: '1' }, mainOnly: { expression: '3' } } };
    const branch = { entries: { shared: { expression: '20' }, same: { expression: '1' }, branchOnly: { expression: '5' } } };
    expect(equationMergeRows(main, branch)).toEqual([
      { name: 'branchOnly', status: 'added' },
      { name: 'mainOnly', status: 'removed' },
      { name: 'shared', status: 'modified' },
    ]);
  });

  it('handles missing documents', () => {
    expect(equationMergeRows(null, { entries: { a: { expression: '1' } } })).toEqual([{ name: 'a', status: 'added' }]);
    expect(equationMergeRows(undefined, undefined)).toEqual([]);
  });
});
