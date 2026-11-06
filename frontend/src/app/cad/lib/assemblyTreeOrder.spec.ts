import { describe, it, expect } from 'vitest';
import { creationOrderTree, OrderRow } from './assemblyTreeOrder';

const r = (key: string, depth = 0, createdAt?: number): OrderRow => ({ key, depth, createdAt });

describe('assembly tree creation order (REQ 1007)', () => {
  const base = [
    r('origin'), r('origin-datum:xy_plane', 1),
    r('component:i1'), r('component-origin:i1', 1), r('component-datum:i1:origin', 2),
    r('component:i2'),
    r('pattern:p1'), r('displaystate:d1'),
  ];

  it('interleaves components and skeleton rows by creation time', () => {
    const out = creationOrderTree(base, [r('skelplane:a', 0, 150), r('skelsketch:s', 0, 250)], { i1: 100, i2: 200 });
    expect(out.map((x) => x.key)).toEqual([
      'origin', 'origin-datum:xy_plane',
      'component:i1', 'component-origin:i1', 'component-datum:i1:origin',
      'skelplane:a', 'component:i2', 'skelsketch:s',
      'pattern:p1', 'displaystate:d1',
    ]);
  });

  it('components without a creation time stay first in stored order', () => {
    const out = creationOrderTree(base, [r('skelplane:a', 0, 5)], {});
    expect(out.map((x) => x.key).slice(2, 7)).toEqual(['component:i1', 'component-origin:i1', 'component-datum:i1:origin', 'component:i2', 'skelplane:a']);
  });
});
