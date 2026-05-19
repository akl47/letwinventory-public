import { describe, it, expect } from 'vitest';
import { migrateSketchState, migrateSketchDocument, isLegacySketchState } from './migration';
import type { LegacySketchState } from './migration';

// Phase A REQ 565: schema migration.
//
// Legacy schema: { points: [{ id, x, y, reference? }], lines: [{ id, startId, endId, reference? }],
//                  constraints: [{ id, type, targets: string[], value? }] }
//
// New schema: { entities: SketchEntity[], constraints: SketchConstraint[] }
//   where SketchEntity is a tagged union (kind: 'point' | 'line' | …) and constraint
//   targets are objects { entityId, sub? } not flat strings.

describe('migration: legacy SketchState → entity model (REQ 565)', () => {
  const legacy: LegacySketchState = {
    points: [
      { id: 'p1', x: 0, y: 0 },
      { id: 'p2', x: 10, y: 0 },
      { id: 'ref1', x: 5, y: 5, reference: true },
    ],
    lines: [
      { id: 'l1', startId: 'p1', endId: 'p2' },
      { id: 'lref', startId: 'p1', endId: 'ref1', reference: true },
    ],
    constraints: [
      { id: 'c0', type: 'fixed', targets: ['p1'] },
      { id: 'c1', type: 'horizontal', targets: ['l1'] },
      { id: 'c2', type: 'distance', targets: ['p1', 'p2'], value: 10 },
      { id: 'c3', type: 'point-on-line', targets: ['ref1', 'l1'] },
    ],
  };

  it('detects a legacy state via shape', () => {
    expect(isLegacySketchState(legacy)).toBe(true);
    expect(isLegacySketchState({ entities: [], constraints: [] })).toBe(false);
  });

  it('converts every point to a Point entity preserving id and coordinates', () => {
    const next = migrateSketchState(legacy);
    const p1 = next.entities.find(e => e.id === 'p1');
    expect(p1).toBeDefined();
    expect(p1!.kind).toBe('point');
    expect((p1 as any).x).toBe(0);
    expect((p1 as any).y).toBe(0);
  });

  it('converts every line to a Line entity preserving endpoint ids', () => {
    const next = migrateSketchState(legacy);
    const l1 = next.entities.find(e => e.id === 'l1');
    expect(l1).toBeDefined();
    expect(l1!.kind).toBe('line');
    expect((l1 as any).startId).toBe('p1');
    expect((l1 as any).endId).toBe('p2');
  });

  it('rewrites the reference boolean as construction on the entity', () => {
    const next = migrateSketchState(legacy);
    const ref1 = next.entities.find(e => e.id === 'ref1');
    const lref = next.entities.find(e => e.id === 'lref');
    expect(ref1!.construction).toBe(true);
    expect(lref!.construction).toBe(true);
    const p1 = next.entities.find(e => e.id === 'p1');
    expect(p1!.construction).toBeFalsy();
  });

  it('rewrites every constraint target as { entityId } preserving order', () => {
    const next = migrateSketchState(legacy);
    const fixed = next.constraints.find(c => c.id === 'c0')!;
    expect(fixed.targets).toEqual([{ entityId: 'p1' }]);
    const distance = next.constraints.find(c => c.id === 'c2')!;
    expect(distance.targets).toEqual([{ entityId: 'p1' }, { entityId: 'p2' }]);
    expect(distance.value).toBe(10);
    const pol = next.constraints.find(c => c.id === 'c3')!;
    expect(pol.targets).toEqual([{ entityId: 'ref1' }, { entityId: 'l1' }]);
    // Legacy 'point-on-line' was merged into the unified 'coincident'.
    expect(pol.type).toBe('coincident');
  });

  it('round-trips a state that is already in the new schema unchanged', () => {
    const already = {
      entities: [
        { kind: 'point' as const, id: 'p1', x: 1, y: 2 },
      ],
      constraints: [
        { id: 'c0', type: 'fixed' as const, targets: [{ entityId: 'p1' }] },
      ],
    };
    const next = migrateSketchState(already);
    expect(next).toEqual(already);
  });

  it('migrates every sketch in a SketchDocument', () => {
    const doc = {
      sketches: {
        s1: {
          id: 's1',
          hostId: 'datum:xy_plane',
          plane: { origin: [0, 0, 0] as [number, number, number], xAxis: [1, 0, 0] as [number, number, number], yAxis: [0, 1, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number] },
          state: legacy,
          candidates: [],
        },
      },
      nextSketchSeq: 2,
    };
    const next = migrateSketchDocument(doc);
    expect(next.sketches.s1.state).toEqual(migrateSketchState(legacy));
  });
});
