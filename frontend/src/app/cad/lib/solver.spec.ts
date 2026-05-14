import { describe, it, expect } from 'vitest';
import { solveSketch } from './solver';
import type { SketchState, SketchEntity, SketchConstraint } from './types';
import { pointsOf } from './types';

function pt(id: string, x: number, y: number, construction = false): SketchEntity {
  return construction
    ? { kind: 'point', id, x, y, construction: true }
    : { kind: 'point', id, x, y };
}

function ln(id: string, startId: string, endId: string): SketchEntity {
  return { kind: 'line', id, startId, endId };
}

function c(id: string, type: SketchConstraint['type'], targetIds: string[], value?: number): SketchConstraint {
  const base: SketchConstraint = {
    id, type, targets: targetIds.map(eid => ({ entityId: eid })),
  };
  if (value !== undefined) base.value = value;
  return base;
}

describe('Sketch solver (CAD-012/013/014/033, REQ 558–561)', () => {
  it('honors a fixed constraint by keeping the point at its initial location', async () => {
    const state: SketchState = {
      entities: [pt('p1', 3, 4)],
      constraints: [c('c1', 'fixed', ['p1'])],
    };
    const res = await solveSketch(state);
    expect(res.status).toBe('ok');
    expect(pointsOf(res.state)[0].x).toBeCloseTo(3);
    expect(pointsOf(res.state)[0].y).toBeCloseTo(4);
  });

  it('coincident: drives two points to the same location', async () => {
    const state: SketchState = {
      entities: [pt('p1', 0, 0), pt('p2', 5, 5)],
      constraints: [c('c1', 'coincident', ['p1', 'p2'])],
    };
    const res = await solveSketch(state);
    expect(res.status).toBe('ok');
    const p1 = pointsOf(res.state).find(p => p.id === 'p1')!;
    const p2 = pointsOf(res.state).find(p => p.id === 'p2')!;
    expect(p1.x).toBeCloseTo(p2.x);
    expect(p1.y).toBeCloseTo(p2.y);
  });

  it('horizontal: aligns endpoints of a line in Y', async () => {
    const state: SketchState = {
      entities: [pt('p1', 0, 0), pt('p2', 5, 5), ln('l1', 'p1', 'p2')],
      constraints: [c('c1', 'horizontal', ['l1'])],
    };
    const res = await solveSketch(state);
    expect(res.status).toBe('ok');
    const p1 = pointsOf(res.state).find(p => p.id === 'p1')!;
    const p2 = pointsOf(res.state).find(p => p.id === 'p2')!;
    expect(p1.y).toBeCloseTo(p2.y);
  });

  it('vertical: aligns endpoints of a line in X', async () => {
    const state: SketchState = {
      entities: [pt('p1', 0, 0), pt('p2', 5, 5), ln('l1', 'p1', 'p2')],
      constraints: [c('c1', 'vertical', ['l1'])],
    };
    const res = await solveSketch(state);
    expect(res.status).toBe('ok');
    const p1 = pointsOf(res.state).find(p => p.id === 'p1')!;
    const p2 = pointsOf(res.state).find(p => p.id === 'p2')!;
    expect(p1.x).toBeCloseTo(p2.x);
  });

  it('distance: enforces target distance between two points', async () => {
    const state: SketchState = {
      entities: [pt('p1', 0, 0), pt('p2', 1, 0)],
      constraints: [
        c('c0', 'fixed', ['p1']),
        c('c1', 'distance', ['p1', 'p2'], 10),
      ],
    };
    const res = await solveSketch(state);
    expect(res.status).toBe('ok');
    const p1 = pointsOf(res.state).find(p => p.id === 'p1')!;
    const p2 = pointsOf(res.state).find(p => p.id === 'p2')!;
    const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    expect(d).toBeCloseTo(10);
  });

  it('point-on-line: drives a point onto the infinite line of a segment', async () => {
    const state: SketchState = {
      entities: [pt('p1', 0, 0), pt('p2', 10, 0), pt('p3', 5, 5), ln('l1', 'p1', 'p2')],
      constraints: [
        c('c0', 'fixed', ['p1']),
        c('c1', 'fixed', ['p2']),
        c('c2', 'point-on-line', ['p3', 'l1']),
      ],
    };
    const res = await solveSketch(state);
    expect(res.status).toBe('ok');
    const p3 = pointsOf(res.state).find(p => p.id === 'p3')!;
    expect(p3.y).toBeCloseTo(0);
  });

  it('reports inconsistent for conflicting distance constraints (CAD-014)', async () => {
    const state: SketchState = {
      entities: [pt('p1', 0, 0), pt('p2', 1, 0)],
      constraints: [
        c('c0', 'fixed', ['p1']),
        c('c1', 'distance', ['p1', 'p2'], 5),
        c('c2', 'distance', ['p1', 'p2'], 10),
      ],
    };
    const res = await solveSketch(state);
    expect(res.status).toBe('inconsistent');
  });

  it('construction points stay at their initial position regardless of solver pressure (REQ 560)', async () => {
    const state: SketchState = {
      entities: [pt('ref1', 3, 4, true), pt('p2', 0, 0)],
      constraints: [c('c1', 'coincident', ['ref1', 'p2'])],
    };
    const res = await solveSketch(state);
    expect(res.status).toBe('ok');
    const ref = pointsOf(res.state).find(p => p.id === 'ref1')!;
    expect(ref.x).toBeCloseTo(3);
    expect(ref.y).toBeCloseTo(4);
  });

  it('reports zero DOF for a fully-constrained rectangle', async () => {
    const state: SketchState = {
      entities: [
        pt('p1', 0, 0), pt('p2', 1, 0), pt('p3', 1, 1), pt('p4', 0, 1),
        ln('l1', 'p1', 'p2'), ln('l2', 'p2', 'p3'),
        ln('l3', 'p3', 'p4'), ln('l4', 'p4', 'p1'),
      ],
      constraints: [
        c('c0', 'fixed', ['p1']),
        c('c1', 'horizontal', ['l1']),
        c('c2', 'horizontal', ['l3']),
        c('c3', 'vertical', ['l2']),
        c('c4', 'vertical', ['l4']),
        c('c5', 'distance', ['p1', 'p2'], 10),
        c('c6', 'distance', ['p2', 'p3'], 10),
      ],
    };
    const res = await solveSketch(state);
    expect(res.status).toBe('ok');
    expect(res.dof).toBe(0);
  });
});
