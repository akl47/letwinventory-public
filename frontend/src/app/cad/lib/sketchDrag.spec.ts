// REQ 1092 — points welded to a dragged point follow the drag.
// REQ 1093 — a drag never moves fully-defined geometry or breaks a constraint.
//
// The fixture is the part-1697 shape: a line corner welded to the end of a
// horizontal construction line whose other end is fixed.
import { describe, it, expect } from 'vitest';
import { dragHeldPoints, solveDrag, constraintResidual } from './sketchDrag';
import { analyzeDeterminacy } from './determinacy';
import type { SketchState, SketchConstraint } from './types';
import { findPoint } from './types';

function c(id: string, type: SketchConstraint['type'], targetIds: string[], value?: number): SketchConstraint {
  const base: SketchConstraint = { id, type, targets: targetIds.map(eid => ({ entityId: eid })) };
  if (value !== undefined) base.value = value;
  return base;
}

function welded(cornerX: number, cornerY: number): SketchState {
  return {
    entities: [
      { kind: 'point', id: 'anchor', x: 0, y: 0, construction: true },
      { kind: 'point', id: 'cEnd', x: 10, y: 0, construction: true },
      { kind: 'line', id: 'cl', startId: 'anchor', endId: 'cEnd', construction: true },
      { kind: 'point', id: 'corner', x: cornerX, y: cornerY },
      { kind: 'point', id: 'far', x: 10, y: 20 },
      { kind: 'line', id: 'side', startId: 'corner', endId: 'far' },
    ],
    constraints: [
      c('fix', 'fixed', ['anchor']),
      c('h', 'horizontal', ['cl']),
      c('weld', 'coincident', ['cEnd', 'corner']),
    ],
  };
}

describe('dragHeldPoints (REQ 1092)', () => {
  it('holds construction line endpoints that are not welded to the dragged point', () => {
    const held = dragHeldPoints(welded(10, 0), new Set(['far']));
    expect(held.has('anchor')).toBe(true);
    expect(held.has('cEnd')).toBe(true);
  });

  it('releases a construction endpoint welded to the dragged point', () => {
    const held = dragHeldPoints(welded(10, 0), new Set(['corner']));
    expect(held.has('cEnd')).toBe(false);
    expect(held.has('anchor')).toBe(true);
  });

  it('follows a chain of coincidents', () => {
    const st = welded(10, 0);
    st.entities.push(
      { kind: 'point', id: 'c2a', x: 10, y: 0, construction: true },
      { kind: 'point', id: 'c2b', x: 10, y: -5, construction: true },
      { kind: 'line', id: 'cl2', startId: 'c2a', endId: 'c2b', construction: true });
    st.constraints.push(c('weld2', 'coincident', ['c2a', 'cEnd']));
    const held = dragHeldPoints(st, new Set(['corner']));
    expect(held.has('c2a')).toBe(false);
    expect(held.has('c2b')).toBe(true);
  });
});

describe('drag solve keeps a weld (REQ 1092)', () => {
  it('carries the construction line end along the line', async () => {
    const r = await solveDrag(welded(13, 0), new Set(['corner']));
    expect(r.status).toBe('ok');
    const end = findPoint(r.state, 'cEnd')!;
    expect(end.x).toBeCloseTo(13, 6);
    expect(end.y).toBeCloseTo(0, 6);
  });

  it('does not report success for a drag off the horizontal line', async () => {
    const r = await solveDrag(welded(10, 3), new Set(['corner']));
    expect(r.status).not.toBe('ok');
  });

  it('a diagonal drag follows the part of the move the line allows', async () => {
    const r = await solveDrag(welded(14, 3), new Set(['corner']), { before: welded(10, 0) });
    expect(r.status).toBe('ok');
    expect(findPoint(r.state, 'corner')).toMatchObject({ x: 14, y: 0 });
    expect(findPoint(r.state, 'cEnd')!.x).toBeCloseTo(14, 6);
  });
});

/** A fixed anchor, a point `pin` dimensioned 10 from it, and a free point
 * `free` joined to `pin` by a line. `pin` is fully defined only when
 * `locked` adds the horizontal that removes its last freedom. */
function dimensioned(locked: boolean): SketchState {
  return {
    entities: [
      { kind: 'point', id: 'anchor', x: 0, y: 0 },
      { kind: 'point', id: 'pin', x: 10, y: 0 },
      { kind: 'point', id: 'free', x: 10, y: 8 },
      { kind: 'line', id: 'l', startId: 'pin', endId: 'free' },
    ],
    constraints: [
      c('fix', 'fixed', ['anchor']),
      c('d', 'distance', ['anchor', 'pin'], 10),
      ...(locked ? [c('hz', 'horizontal', ['anchor', 'pin'])] : []),
    ],
  };
}
const moved = (st: SketchState, id: string, x: number, y: number): SketchState =>
  ({ ...st, entities: st.entities.map(e => e.id === id && e.kind === 'point' ? { ...e, x, y } : e) });

describe('solveDrag (REQ 1093)', () => {
  it('refuses to drag a fully-defined point', async () => {
    const st = dimensioned(true);
    const determined = analyzeDeterminacy(st);
    expect(determined.has('pin')).toBe(true);
    const r = await solveDrag(moved(st, 'pin', 12, 3), new Set(['pin']), { determined });
    expect(r.status).not.toBe('ok');
  });

  it('leaves fully-defined points in place while a free point is dragged', async () => {
    const st = dimensioned(true);
    const r = await solveDrag(moved(st, 'free', 14, 9), new Set(['free']), { determined: analyzeDeterminacy(st) });
    expect(r.status).toBe('ok');
    expect(findPoint(r.state, 'pin')).toMatchObject({ x: 10, y: 0 });
    expect(findPoint(r.state, 'free')).toMatchObject({ x: 14, y: 9 });
  });

  it('refuses a drag that would break a dimension to fixed geometry', async () => {
    // pin may swing around the anchor but not leave the 10-radius circle;
    // dragged and anchor are both pinned, so PlaneGCS would drop the dim.
    const st = dimensioned(false);
    const r = await solveDrag(moved(st, 'pin', 14, 0), new Set(['pin']), { determined: analyzeDeterminacy(st) });
    expect(r.status).not.toBe('ok');
  });
});

describe('constraintResidual', () => {
  it('measures how far a constraint is from satisfied', () => {
    const st = moved(dimensioned(true), 'pin', 13, 4);
    const by = (id: string) => st.constraints.find(x => x.id === id)!;
    expect(constraintResidual(st, by('d'))).toBeCloseTo(Math.hypot(13, 4) - 10, 9);
    expect(constraintResidual(st, by('hz'))).toBeCloseTo(4, 9);
    expect(constraintResidual(st, by('fix'))).toBeNull();
  });
});

describe('solveDrag moves only what it has to (REQ 1093)', () => {
  /** The part-1697 rectangle: four lines, horizontal + perpendicular + two
   * parallels, no dimensions. */
  const rect: SketchState = {
    entities: [
      { kind: 'point', id: 'bl', x: 0, y: 0 }, { kind: 'point', id: 'br', x: 40, y: 0 },
      { kind: 'point', id: 'tr', x: 40, y: 30 }, { kind: 'point', id: 'tl', x: 0, y: 30 },
      { kind: 'line', id: 'bot', startId: 'bl', endId: 'br' }, { kind: 'line', id: 'rgt', startId: 'br', endId: 'tr' },
      { kind: 'line', id: 'top', startId: 'tr', endId: 'tl' }, { kind: 'line', id: 'lft', startId: 'tl', endId: 'bl' },
    ],
    constraints: [
      c('h', 'horizontal', ['bot']), c('perp', 'perpendicular', ['bot', 'rgt']),
      c('par1', 'parallel', ['bot', 'top']), c('par2', 'parallel', ['rgt', 'lft']),
    ],
  };

  it('dragging a rectangle corner leaves the opposite corner where it is', async () => {
    const r = await solveDrag(moved(rect, 'tl', -3, 34), new Set(['tl']), { before: rect });
    expect(r.status).toBe('ok');
    expect(findPoint(r.state, 'br')).toMatchObject({ x: 40, y: 0 });
    expect(findPoint(r.state, 'bl')!.x).toBeCloseTo(-3, 6);
    expect(findPoint(r.state, 'tr')!.y).toBeCloseTo(34, 6);
  });
});
