import { describe, it, expect } from 'vitest';
import { extractClosedLoop, extractClosedLoops, tessellateProfileLoop } from './profile';
import type { CircleProfileEdge } from './profile';
import type { SketchState, SketchEntity } from './types';

function build(points: Array<[number, number]>, lines: Array<[number, number]>): SketchState {
  const entities: SketchEntity[] = [
    ...points.map(([x, y], i): SketchEntity => ({ kind: 'point', id: `p${i + 1}`, x, y })),
    ...lines.map(([a, b], i): SketchEntity => ({ kind: 'line', id: `l${i + 1}`, startId: `p${a}`, endId: `p${b}` })),
  ];
  return { entities, constraints: [] };
}

describe('Profile extraction (CAD-038, REQ 560, REQ 617)', () => {
  it('extracts a closed quadrilateral as four line edges (REQ 617)', () => {
    const state = build(
      [[0, 0], [10, 0], [10, 10], [0, 10]],
      [[1, 2], [2, 3], [3, 4], [4, 1]],
    );
    const { loop, error } = extractClosedLoop(state);
    expect(error).toBeFalsy();
    expect(loop).not.toBeNull();
    expect(loop!.length).toBe(4);
    expect(loop!.every(e => e.kind === 'line')).toBe(true);
    // Walked endpoints should chain head-to-tail.
    for (let i = 0; i < loop!.length; i++) {
      const cur = loop![i];
      const next = loop![(i + 1) % loop!.length];
      if (cur.kind === 'line' && next.kind === 'line') {
        expect(cur.end).toEqual(next.start);
      }
    }
  });

  it('rejects an open chain', () => {
    const state = build(
      [[0, 0], [10, 0], [10, 10]],
      [[1, 2], [2, 3]],
    );
    const { loop, error } = extractClosedLoop(state);
    expect(loop).toBeNull();
    expect(error).toBeTruthy();
  });

  it('rejects sketches with no lines', () => {
    const state = build([[0, 0]], []);
    const { loop, error } = extractClosedLoop(state);
    expect(loop).toBeNull();
    expect(error).toMatch(/no lines|empty/i);
  });

  it('rejects sketches with multiple disjoint loops', () => {
    const state = build(
      [[0, 0], [1, 0], [0, 1], [10, 0], [11, 0], [10, 1]],
      [[1, 2], [2, 3], [3, 1], [4, 5], [5, 6], [6, 4]],
    );
    const { loop, error } = extractClosedLoop(state);
    expect(loop).toBeNull();
    expect(error).toMatch(/multiple|disjoint|loop/i);
  });

  it('rejects sketches with fewer than 3 lines', () => {
    const state = build([[0, 0], [5, 0]], [[1, 2]]);
    const { loop, error } = extractClosedLoop(state);
    expect(loop).toBeNull();
    expect(error).toBeTruthy();
  });

  it('excludes construction lines from profile extraction (REQ 560)', () => {
    // Quadrilateral with an extra construction line crossing it diagonally.
    const state: SketchState = {
      entities: [
        { kind: 'point', id: 'p1', x: 0, y: 0 },
        { kind: 'point', id: 'p2', x: 10, y: 0 },
        { kind: 'point', id: 'p3', x: 10, y: 10 },
        { kind: 'point', id: 'p4', x: 0, y: 10 },
        { kind: 'line', id: 'l1', startId: 'p1', endId: 'p2' },
        { kind: 'line', id: 'l2', startId: 'p2', endId: 'p3' },
        { kind: 'line', id: 'l3', startId: 'p3', endId: 'p4' },
        { kind: 'line', id: 'l4', startId: 'p4', endId: 'p1' },
        { kind: 'line', id: 'lc', startId: 'p1', endId: 'p3', construction: true },
      ],
      constraints: [],
    };
    const { loop, error } = extractClosedLoop(state);
    expect(error).toBeFalsy();
    expect(loop!.length).toBe(4);
  });

  describe('single-circle profile (REQ 612, REQ 617)', () => {
    it('returns a single typed circle edge (not a tessellated polyline)', () => {
      const state: SketchState = {
        entities: [
          { kind: 'point', id: 'c', x: 5, y: 5 },
          { kind: 'circle', id: 'cir1', centerId: 'c', radius: 10 },
        ],
        constraints: [],
      };
      const { loop, error } = extractClosedLoop(state);
      expect(error).toBeFalsy();
      expect(loop).not.toBeNull();
      expect(loop!.length).toBe(1);
      expect(loop![0].kind).toBe('circle');
      const edge = loop![0] as CircleProfileEdge;
      expect(edge.center).toEqual({ x: 5, y: 5 });
      expect(edge.radius).toBe(10);
    });

    it('tessellateProfileLoop on a single-circle profile yields vertices on the circle', () => {
      const state: SketchState = {
        entities: [
          { kind: 'point', id: 'c', x: 5, y: 5 },
          { kind: 'circle', id: 'cir1', centerId: 'c', radius: 10 },
        ],
        constraints: [],
      };
      const { loop } = extractClosedLoop(state);
      const pts = tessellateProfileLoop(loop!);
      expect(pts.length).toBeGreaterThanOrEqual(8);
      for (const p of pts) {
        const r = Math.hypot(p.x - 5, p.y - 5);
        expect(Math.abs(r - 10)).toBeLessThan(0.1);
      }
    });

    it('excludes a construction circle (no profile)', () => {
      const state: SketchState = {
        entities: [
          { kind: 'point', id: 'c', x: 0, y: 0 },
          { kind: 'circle', id: 'cir1', centerId: 'c', radius: 5, construction: true },
        ],
        constraints: [],
      };
      const { loop, error } = extractClosedLoop(state);
      expect(loop).toBeNull();
      expect(error).toBeTruthy();
    });

    it('rejects multiple circles (out of single-circle-profile scope)', () => {
      const state: SketchState = {
        entities: [
          { kind: 'point', id: 'c1', x: 0, y: 0 },
          { kind: 'point', id: 'c2', x: 20, y: 0 },
          { kind: 'circle', id: 'cir1', centerId: 'c1', radius: 5 },
          { kind: 'circle', id: 'cir2', centerId: 'c2', radius: 3 },
        ],
        constraints: [],
      };
      const { loop, error } = extractClosedLoop(state);
      expect(loop).toBeNull();
      expect(error).toBeTruthy();
    });
  });

  describe('extractClosedLoops — multiple disjoint loops (REQ 620)', () => {
    it('returns two loops for two disjoint circles', () => {
      const state: SketchState = {
        entities: [
          { kind: 'point', id: 'c1', x: 0, y: 0 },
          { kind: 'point', id: 'c2', x: 20, y: 0 },
          { kind: 'circle', id: 'cir1', centerId: 'c1', radius: 5 },
          { kind: 'circle', id: 'cir2', centerId: 'c2', radius: 3 },
        ],
        constraints: [],
      };
      const { loops, errors } = extractClosedLoops(state);
      expect(errors).toEqual([]);
      expect(loops.length).toBe(2);
      expect(loops[0][0].kind).toBe('circle');
      expect(loops[1][0].kind).toBe('circle');
    });

    it('returns two loops for two disjoint triangles', () => {
      const state = build(
        [[0, 0], [1, 0], [0, 1], [10, 0], [11, 0], [10, 1]],
        [[1, 2], [2, 3], [3, 1], [4, 5], [5, 6], [6, 4]],
      );
      const { loops } = extractClosedLoops(state);
      expect(loops.length).toBe(2);
      for (const l of loops) expect(l.length).toBe(3);
    });

    it('returns a circle loop AND a triangle loop in the same sketch', () => {
      const state: SketchState = {
        entities: [
          { kind: 'point', id: 'cc', x: 100, y: 100 },
          { kind: 'circle', id: 'cir', centerId: 'cc', radius: 5 },
          { kind: 'point', id: 'p1', x: 0, y: 0 },
          { kind: 'point', id: 'p2', x: 10, y: 0 },
          { kind: 'point', id: 'p3', x: 5, y: 10 },
          { kind: 'line', id: 'l1', startId: 'p1', endId: 'p2' },
          { kind: 'line', id: 'l2', startId: 'p2', endId: 'p3' },
          { kind: 'line', id: 'l3', startId: 'p3', endId: 'p1' },
        ],
        constraints: [],
      };
      const { loops } = extractClosedLoops(state);
      expect(loops.length).toBe(2);
      expect(loops.some(l => l[0].kind === 'circle')).toBe(true);
      expect(loops.some(l => l.every(e => e.kind === 'line') && l.length === 3)).toBe(true);
    });

    it('returns 0 loops when no valid closed component exists', () => {
      const state = build([[0, 0], [10, 0]], [[1, 2]]);
      const { loops } = extractClosedLoops(state);
      expect(loops.length).toBe(0);
    });
  });
});
