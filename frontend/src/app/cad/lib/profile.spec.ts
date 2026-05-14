import { describe, it, expect } from 'vitest';
import { extractClosedLoop } from './profile';
import type { SketchState, SketchEntity } from './types';

function build(points: Array<[number, number]>, lines: Array<[number, number]>): SketchState {
  const entities: SketchEntity[] = [
    ...points.map(([x, y], i): SketchEntity => ({ kind: 'point', id: `p${i + 1}`, x, y })),
    ...lines.map(([a, b], i): SketchEntity => ({ kind: 'line', id: `l${i + 1}`, startId: `p${a}`, endId: `p${b}` })),
  ];
  return { entities, constraints: [] };
}

describe('Profile extraction (CAD-038, REQ 560)', () => {
  it('extracts a closed quadrilateral loop', () => {
    const state = build(
      [[0, 0], [10, 0], [10, 10], [0, 10]],
      [[1, 2], [2, 3], [3, 4], [4, 1]],
    );
    const { loop, error } = extractClosedLoop(state);
    expect(error).toBeFalsy();
    expect(loop).not.toBeNull();
    expect(loop!.length).toBe(4);
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
});
