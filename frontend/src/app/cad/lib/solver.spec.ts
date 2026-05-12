import { describe, it, expect } from 'vitest';
import { solveSketch } from './solver';
import type { SketchState } from './types';

// These tests will fail until the implementation in Step 6 wires a real
// PlaneGCS module (or a deterministic test double). For now they document the
// constraint-solving contract.

function pt(id: string, x: number, y: number, reference = false) {
  return { id, x, y, reference };
}

describe('Sketch solver (CAD-012, CAD-013, CAD-014, CAD-033)', () => {
  it('honors a fixed constraint by keeping the point at its initial location', async () => {
    const state: SketchState = {
      points: [pt('p1', 3, 4)],
      lines: [],
      constraints: [{ id: 'c1', type: 'fixed', targets: ['p1'] }],
    };
    const res = await solveSketch(state);
    expect(res.status).toBe('ok');
    expect(res.state.points[0].x).toBeCloseTo(3);
    expect(res.state.points[0].y).toBeCloseTo(4);
  });

  it('coincident: drives two points to the same location', async () => {
    const state: SketchState = {
      points: [pt('p1', 0, 0), pt('p2', 5, 5)],
      lines: [],
      constraints: [{ id: 'c1', type: 'coincident', targets: ['p1', 'p2'] }],
    };
    const res = await solveSketch(state);
    expect(res.status).toBe('ok');
    const p1 = res.state.points.find(p => p.id === 'p1')!;
    const p2 = res.state.points.find(p => p.id === 'p2')!;
    expect(p1.x).toBeCloseTo(p2.x);
    expect(p1.y).toBeCloseTo(p2.y);
  });

  it('horizontal: aligns endpoints of a line in Y', async () => {
    const state: SketchState = {
      points: [pt('p1', 0, 0), pt('p2', 5, 5)],
      lines: [{ id: 'l1', startId: 'p1', endId: 'p2' }],
      constraints: [{ id: 'c1', type: 'horizontal', targets: ['l1'] }],
    };
    const res = await solveSketch(state);
    expect(res.status).toBe('ok');
    const p1 = res.state.points.find(p => p.id === 'p1')!;
    const p2 = res.state.points.find(p => p.id === 'p2')!;
    expect(p1.y).toBeCloseTo(p2.y);
  });

  it('vertical: aligns endpoints of a line in X', async () => {
    const state: SketchState = {
      points: [pt('p1', 0, 0), pt('p2', 5, 5)],
      lines: [{ id: 'l1', startId: 'p1', endId: 'p2' }],
      constraints: [{ id: 'c1', type: 'vertical', targets: ['l1'] }],
    };
    const res = await solveSketch(state);
    expect(res.status).toBe('ok');
    const p1 = res.state.points.find(p => p.id === 'p1')!;
    const p2 = res.state.points.find(p => p.id === 'p2')!;
    expect(p1.x).toBeCloseTo(p2.x);
  });

  it('distance: enforces target distance between two points', async () => {
    const state: SketchState = {
      points: [pt('p1', 0, 0), pt('p2', 1, 0)],
      lines: [],
      constraints: [
        { id: 'c0', type: 'fixed', targets: ['p1'] },
        { id: 'c1', type: 'distance', targets: ['p1', 'p2'], value: 10 },
      ],
    };
    const res = await solveSketch(state);
    expect(res.status).toBe('ok');
    const p1 = res.state.points.find(p => p.id === 'p1')!;
    const p2 = res.state.points.find(p => p.id === 'p2')!;
    const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    expect(d).toBeCloseTo(10);
  });

  it('point-on-line: drives a point onto the infinite line of a segment', async () => {
    const state: SketchState = {
      points: [pt('p1', 0, 0), pt('p2', 10, 0), pt('p3', 5, 5)],
      lines: [{ id: 'l1', startId: 'p1', endId: 'p2' }],
      constraints: [
        { id: 'c0', type: 'fixed', targets: ['p1'] },
        { id: 'c1', type: 'fixed', targets: ['p2'] },
        { id: 'c2', type: 'point-on-line', targets: ['p3', 'l1'] },
      ],
    };
    const res = await solveSketch(state);
    expect(res.status).toBe('ok');
    const p3 = res.state.points.find(p => p.id === 'p3')!;
    expect(p3.y).toBeCloseTo(0);
  });

  it('reports inconsistent for conflicting distance constraints (CAD-014)', async () => {
    const state: SketchState = {
      points: [pt('p1', 0, 0), pt('p2', 1, 0)],
      lines: [],
      constraints: [
        { id: 'c0', type: 'fixed', targets: ['p1'] },
        { id: 'c1', type: 'distance', targets: ['p1', 'p2'], value: 5 },
        { id: 'c2', type: 'distance', targets: ['p1', 'p2'], value: 10 },
      ],
    };
    const res = await solveSketch(state);
    expect(res.status).toBe('inconsistent');
  });

  it('reference points stay at their initial position regardless of solver pressure (CAD-033)', async () => {
    const state: SketchState = {
      points: [pt('ref1', 3, 4, true), pt('p2', 0, 0)],
      lines: [],
      constraints: [{ id: 'c1', type: 'coincident', targets: ['ref1', 'p2'] }],
    };
    const res = await solveSketch(state);
    expect(res.status).toBe('ok');
    const ref = res.state.points.find(p => p.id === 'ref1')!;
    expect(ref.x).toBeCloseTo(3);
    expect(ref.y).toBeCloseTo(4);
  });

  it('reports zero DOF for a fully-constrained rectangle', async () => {
    // Four corners of a 10x10 box: fix p1, horizontal+vertical pairs, two distances.
    const state: SketchState = {
      points: [pt('p1', 0, 0), pt('p2', 1, 0), pt('p3', 1, 1), pt('p4', 0, 1)],
      lines: [
        { id: 'l1', startId: 'p1', endId: 'p2' },
        { id: 'l2', startId: 'p2', endId: 'p3' },
        { id: 'l3', startId: 'p3', endId: 'p4' },
        { id: 'l4', startId: 'p4', endId: 'p1' },
      ],
      constraints: [
        { id: 'c0', type: 'fixed', targets: ['p1'] },
        { id: 'c1', type: 'horizontal', targets: ['l1'] },
        { id: 'c2', type: 'horizontal', targets: ['l3'] },
        { id: 'c3', type: 'vertical', targets: ['l2'] },
        { id: 'c4', type: 'vertical', targets: ['l4'] },
        { id: 'c5', type: 'distance', targets: ['p1', 'p2'], value: 10 },
        { id: 'c6', type: 'distance', targets: ['p2', 'p3'], value: 10 },
      ],
    };
    const res = await solveSketch(state);
    expect(res.status).toBe('ok');
    expect(res.dof).toBe(0);
  });
});
