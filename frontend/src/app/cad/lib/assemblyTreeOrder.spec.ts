import { describe, it, expect } from 'vitest';
import { assemblyTreeRefs, creationOrderTree, reorderBlocker, withRollbackBar, OrderRow } from './assemblyTreeOrder';

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

describe('assembly rollback bar (REQ 1028)', () => {
  type Row = OrderRow & { rolledBack?: boolean };
  const rows: Row[] = [
    r('origin'),
    r('component:i1', 0, 100), r('component-origin:i1', 1),
    r('skelplane:a', 0, 150),
    r('component:i2', 0, 200), r('component-origin:i2', 1),
    r('pattern:p1'),
  ];
  const bar: Row = r('__rollback_bar__');

  it('shows no bar when rolled forward', () => {
    const out = withRollbackBar(rows, null, bar);
    expect(out.map((x) => x.key)).toEqual(rows.map((x) => x.key));
    expect(out.some((x) => x.rolledBack)).toBe(false);
  });

  it('sits before the first row at the cutoff and greys rows below it', () => {
    const out = withRollbackBar(rows, 150, bar);
    expect(out.map((x) => x.key)).toEqual(['origin', 'component:i1', 'component-origin:i1', '__rollback_bar__', 'skelplane:a', 'component:i2', 'component-origin:i2', 'pattern:p1']);
    expect(out.filter((x) => x.rolledBack).map((x) => x.key)).toEqual(['skelplane:a', 'component:i2', 'component-origin:i2']);
  });

  it('component rows carry their creation time so they can be dragged', () => {
    const out = creationOrderTree([r('component:i1')], [], { i1: 42 });
    expect(out[0].createdAt).toBe(42);
  });
});

describe('assembly tree reorder limits (REQ 1028)', () => {
  const refs = assemblyTreeRefs({
    instanceIds: ['i1', 'i2'],
    skeletonFeatures: [{ id: 'fA', method: { kind: 'offset', ref: { kind: 'face', faceId: 'i1::f3' } } } as { id: string }],
    skeletonSketches: [{ id: 'sB', hostId: 'datum:fA' } as { id: string }],
    instanceRefs: { i2: ['skelsketch:sB'] },
  });
  const at = new Map([['component:i1', 100], ['skelplane:fA', 200], ['skelsketch:sB', 300], ['component:i2', 400]]);
  const label = (k: string) => k;

  it('collects references from skeleton data and component in-context refs', () => {
    expect([...refs.get('skelplane:fA')!]).toEqual(['component:i1']);
    expect([...refs.get('skelsketch:sB')!]).toEqual(['skelplane:fA']);
    expect([...refs.get('component:i2')!]).toEqual(['skelsketch:sB']);
  });

  it('blocks moving a row above what it references', () => {
    expect(reorderBlocker('skelsketch:sB', 150, refs, at, label)).toMatch(/skelsketch:sB references skelplane:fA/);
  });

  it('blocks moving a row below what references it', () => {
    expect(reorderBlocker('component:i1', 250, refs, at, label)).toMatch(/skelplane:fA references component:i1/);
  });

  it('allows moves that keep references in order', () => {
    expect(reorderBlocker('component:i2', 350, refs, at, label)).toBeNull();
  });
});
