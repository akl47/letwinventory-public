import { describe, it, expect } from 'vitest';
import { extractClosedLoop } from './profile';

function build(points: Array<[number, number]>, lines: Array<[number, number]>) {
  return {
    points: points.map(([x, y], i) => ({ id: `p${i + 1}`, x, y })),
    lines: lines.map(([a, b], i) => ({ id: `l${i + 1}`, startId: `p${a}`, endId: `p${b}` })),
    constraints: [],
  };
}

describe('Profile extraction (CAD-038)', () => {
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
    // Two separate triangles sharing no vertices.
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
});
