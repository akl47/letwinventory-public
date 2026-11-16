import { describe, it, expect } from 'vitest';
import { insertBranchDefault } from './assembly-edit.controller';

// REQ 1080 — a new instance tracks a branch that actually has geometry.
describe('insertBranchDefault', () => {
  it('tracks main once the part has a released revision', () => {
    expect(insertBranchDefault({ hasReleased: true, branchName: 'draft/02' })).toBe('main');
  });

  it('tracks the working branch of a part that was never released', () => {
    expect(insertBranchDefault({ hasReleased: false, branchName: 'draft/01' })).toBe('draft/01');
  });

  it('falls back to main when the branch is unknown', () => {
    expect(insertBranchDefault({ hasReleased: false })).toBe('main');
  });
});
