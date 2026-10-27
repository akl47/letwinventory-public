import { describe, it, expect } from 'vitest';
import { solveSketch } from './solver';
import { setDimensionValue, addPoint, addLine, addCircle, addConstraint, emptySketchState, ORIGIN_POINT_ID } from './store';
import { findPoint, findEntity } from './types';
import type { SketchState } from './types';

// A negative dimension value flips the dimension's direction (SolidWorks-style):
// setDimensionValue reflects the driven geometry to the opposite side and stores
// the magnitude; the sign-agnostic solver then holds the flipped side.

function fix(state: SketchState, id: string): SketchState {
  return addConstraint(state, 'fixed', [id]).state;
}

describe('negative dimension flips direction (setDimensionValue)', () => {
  it('horizontal-distance: negative moves the point to the other side of the anchor', async () => {
    let s = emptySketchState();                       // seeds the origin at (0,0)
    s = fix(s, ORIGIN_POINT_ID);
    const b = addPoint(s, 5, 0); s = b.state;
    const { state: withDim, constraint } = addConstraint(s, 'horizontal-distance', [ORIGIN_POINT_ID, b.id], 5);
    s = withDim;
    s = (await solveSketch(s)).state;
    expect(findPoint(s, b.id)!.x).toBeCloseTo(5, 6);   // right of origin

    // Enter -5 → flip to the left, magnitude preserved.
    s = setDimensionValue(s, constraint.id, -5);
    expect(s.constraints.find(c => c.id === constraint.id)!.value).toBe(5);   // stored magnitude
    s = (await solveSketch(s)).state;
    expect(findPoint(s, b.id)!.x).toBeCloseTo(-5, 6);  // now left of origin
    expect(findPoint(s, b.id)!.y).toBeCloseTo(0, 6);
  });

  it('vertical-distance: negative flips the point below the anchor', async () => {
    let s = emptySketchState();
    s = fix(s, ORIGIN_POINT_ID);
    const b = addPoint(s, 0, 4); s = b.state;
    const { state: withDim, constraint } = addConstraint(s, 'vertical-distance', [ORIGIN_POINT_ID, b.id], 4);
    s = withDim;
    s = (await solveSketch(s)).state;
    expect(findPoint(s, b.id)!.y).toBeCloseTo(4, 6);

    s = setDimensionValue(s, constraint.id, -4);
    s = (await solveSketch(s)).state;
    expect(findPoint(s, b.id)!.y).toBeCloseTo(-4, 6);  // flipped below
  });

  it('a positive value never flips — it holds the current side', async () => {
    let s = emptySketchState();
    s = fix(s, ORIGIN_POINT_ID);
    const b = addPoint(s, -5, 0); s = b.state;         // start on the LEFT
    const { state: withDim, constraint } = addConstraint(s, 'horizontal-distance', [ORIGIN_POINT_ID, b.id], 5);
    s = withDim;
    s = (await solveSketch(s)).state;
    expect(findPoint(s, b.id)!.x).toBeCloseTo(-5, 6);

    // Re-entering a positive value keeps it on the left (no flip).
    s = setDimensionValue(s, constraint.id, 7);
    s = (await solveSketch(s)).state;
    expect(findPoint(s, b.id)!.x).toBeCloseTo(-7, 6);  // still left, resized
  });

  it('point-line-distance: negative reflects the point across the line', async () => {
    let s = emptySketchState();
    // A fixed horizontal line along y=0.
    const la = addPoint(s, 0, 0); s = la.state;
    const lb = addPoint(s, 10, 0); s = lb.state;
    s = fix(s, la.id); s = fix(s, lb.id);
    const line = addLine(s, la.id, lb.id); s = line.state;
    const p = addPoint(s, 5, 3); s = p.state;          // 3 above the line
    const { state: withDim, constraint } = addConstraint(s, 'point-line-distance', [p.id, line.id], 3);
    s = withDim;
    s = (await solveSketch(s)).state;
    expect(findPoint(s, p.id)!.y).toBeCloseTo(3, 4);

    s = setDimensionValue(s, constraint.id, -3);
    s = (await solveSketch(s)).state;
    expect(findPoint(s, p.id)!.y).toBeCloseTo(-3, 4);  // flipped below the line
  });

  // REQ 893 (review B1): the flip must reflect the FREE side, never an anchor.
  // Which point sits in which target slot is pure pick order — reflecting a
  // hardcoded slot can teleport the origin or a fixed point.
  describe('REQ 893 — flip targets the free side, never an anchor', () => {
    it('reversed pick order (origin as targets[1]): origin never moves, the free point flips', async () => {
      let s = emptySketchState();
      s = fix(s, ORIGIN_POINT_ID);
      const b = addPoint(s, 5, 0); s = b.state;
      // Picked in the "unfavorable" order: free point first, origin second.
      const { state: withDim, constraint } = addConstraint(s, 'horizontal-distance', [b.id, ORIGIN_POINT_ID], 5);
      s = withDim;
      s = (await solveSketch(s)).state;
      expect(findPoint(s, b.id)!.x).toBeCloseTo(5, 6);

      s = setDimensionValue(s, constraint.id, -5);
      // The origin entity's stored coordinates are untouched by the reflect.
      expect(findPoint(s, ORIGIN_POINT_ID)).toMatchObject({ x: 0, y: 0 });
      expect(s.constraints.find(c => c.id === constraint.id)!.value).toBe(5);
      s = (await solveSketch(s)).state;
      expect(findPoint(s, ORIGIN_POINT_ID)!.x).toBeCloseTo(0, 6);
      expect(findPoint(s, b.id)!.x).toBeCloseTo(-5, 6);  // free side flipped
    });

    it('fixed point as targets[1]: the free targets[0] point reflects across it', async () => {
      let s = emptySketchState();
      const f = addPoint(s, 10, 0); s = f.state;
      s = fix(s, f.id);
      const p = addPoint(s, 5, 0); s = p.state;
      const { state: withDim, constraint } = addConstraint(s, 'horizontal-distance', [p.id, f.id], 5);
      s = withDim;
      s = (await solveSketch(s)).state;
      expect(findPoint(s, p.id)!.x).toBeCloseTo(5, 6);   // left of the anchor

      s = setDimensionValue(s, constraint.id, -5);
      expect(findPoint(s, f.id)!.x).toBe(10);            // anchor untouched
      s = (await solveSketch(s)).state;
      expect(findPoint(s, f.id)!.x).toBeCloseTo(10, 6);
      expect(findPoint(s, p.id)!.x).toBeCloseTo(15, 6);  // now right of the anchor
    });

    it('both targets anchored: geometry unchanged, magnitude stored', () => {
      let s = emptySketchState();
      s = fix(s, ORIGIN_POINT_ID);
      const f = addPoint(s, 5, 0); s = f.state;
      s = fix(s, f.id);
      const { state: withDim, constraint } = addConstraint(s, 'horizontal-distance', [ORIGIN_POINT_ID, f.id], 5);
      s = withDim;
      const before = s.entities;
      // Nothing can legally move — store the magnitude only; the next solve
      // surfaces the over-constraint as usual.
      s = setDimensionValue(s, constraint.id, -5);
      expect(s.entities).toEqual(before);
      expect(s.constraints.find(c => c.id === constraint.id)!.value).toBe(5);
    });

    it('point-line-distance with an anchored point: magnitude only, no reflection', () => {
      let s = emptySketchState();
      const la = addPoint(s, 0, 0); s = la.state;
      const lb = addPoint(s, 10, 0); s = lb.state;
      const line = addLine(s, la.id, lb.id); s = line.state;
      const p = addPoint(s, 5, 3); s = p.state;
      s = fix(s, p.id);                                  // the measured point is the anchor
      const { state: withDim, constraint } = addConstraint(s, 'point-line-distance', [p.id, line.id], 3);
      s = withDim;
      const before = s.entities;
      // Reflecting the LINE instead is out of v1 scope (REQ 893) — the
      // anchored-point case stores the magnitude without moving anything.
      s = setDimensionValue(s, constraint.id, -3);
      expect(s.entities).toEqual(before);
      expect(s.constraints.find(c => c.id === constraint.id)!.value).toBe(3);
    });
  });

  it('non-directional dims (radius) store the magnitude, geometry unchanged', () => {
    let s = emptySketchState();
    const circle = addCircle(s, 4, 4, 3); s = circle.state;
    const before = findEntity(s, circle.id);
    const { state: withDim, constraint } = addConstraint(s, 'radius', [circle.id], 3);
    s = withDim;
    // A negative radius is meaningless — store the magnitude, don't move geometry.
    s = setDimensionValue(s, constraint.id, -5);
    expect(s.constraints.find(c => c.id === constraint.id)!.value).toBe(5);
    const after = findEntity(s, circle.id);
    expect(after).toEqual(before);   // circle center + radius untouched
  });
});
