import { describe, it, expect } from 'vitest';
import {
  lineLineIntersection, lineCircleIntersection, circleCircleIntersection,
  reflectAcrossLine, projectOntoSegment, projectOntoLine, offsetLineLeft,
  angleInArcSweep, allCurveIntersections,
} from './geometry';
import { emptySketchState, addPoint, addLine, addCircle } from './store';

describe('lineLineIntersection', () => {
  it('returns intersection for crossing segments with correct parameters', () => {
    const r = lineLineIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: -1 }, { x: 5, y: 1 });
    expect(r).not.toBeNull();
    expect(r!.p.x).toBeCloseTo(5);
    expect(r!.p.y).toBeCloseTo(0);
    expect(r!.t1).toBeCloseTo(0.5);
    expect(r!.t2).toBeCloseTo(0.5);
  });

  it('returns null for parallel lines', () => {
    expect(lineLineIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 1 }, { x: 10, y: 1 })).toBeNull();
  });

  it('returns intersection past segment endpoints (t outside [0,1])', () => {
    const r = lineLineIntersection({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: -1 }, { x: 10, y: 1 });
    expect(r).not.toBeNull();
    expect(r!.t1).toBeCloseTo(2);
  });
});

describe('lineCircleIntersection', () => {
  it('returns two points for a chord', () => {
    const pts = lineCircleIntersection({ x: -10, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, 5);
    expect(pts).toHaveLength(2);
    expect(pts.map(p => p.x).sort()).toEqual([-5, 5]);
  });

  it('returns single point for a tangent', () => {
    const pts = lineCircleIntersection({ x: -10, y: 5 }, { x: 10, y: 5 }, { x: 0, y: 0 }, 5);
    expect(pts).toHaveLength(1);
    expect(pts[0].y).toBeCloseTo(5);
  });

  it('returns empty for a miss', () => {
    expect(lineCircleIntersection({ x: -10, y: 10 }, { x: 10, y: 10 }, { x: 0, y: 0 }, 5)).toHaveLength(0);
  });
});

describe('circleCircleIntersection', () => {
  it('returns two points for circles that cross', () => {
    const pts = circleCircleIntersection({ x: 0, y: 0 }, 5, { x: 8, y: 0 }, 5);
    expect(pts).toHaveLength(2);
    expect(pts[0].x).toBeCloseTo(4);
    expect(pts[1].x).toBeCloseTo(4);
  });

  it('returns nothing for disjoint circles', () => {
    expect(circleCircleIntersection({ x: 0, y: 0 }, 1, { x: 10, y: 0 }, 1)).toHaveLength(0);
  });

  it('returns nothing for one circle inside another', () => {
    expect(circleCircleIntersection({ x: 0, y: 0 }, 10, { x: 0, y: 0 }, 1)).toHaveLength(0);
  });
});

describe('reflectAcrossLine', () => {
  it('reflects across the X axis (line from (0,0) to (1,0))', () => {
    const r = reflectAcrossLine({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 1, y: 0 });
    expect(r.x).toBeCloseTo(3);
    expect(r.y).toBeCloseTo(-4);
  });

  it('reflects across an arbitrary line through origin', () => {
    // Line y=x; reflecting (3, 0) gives (0, 3).
    const r = reflectAcrossLine({ x: 3, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 });
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(3);
  });
});

describe('projectOntoSegment / projectOntoLine', () => {
  it('clamps to segment endpoints when projection lies outside', () => {
    const r = projectOntoSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: -3, y: 5 });
    expect(r.p.x).toBe(0);
    expect(r.t).toBe(0);
  });
  it('returns unclamped projection on infinite line', () => {
    const r = projectOntoLine({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: -3, y: 5 });
    expect(r.p.x).toBeCloseTo(-3);
    expect(r.t).toBeCloseTo(-0.3);
  });
});

describe('offsetLineLeft', () => {
  it('shifts a +X-direction line up by d', () => {
    const r = offsetLineLeft({ x: 0, y: 0 }, { x: 10, y: 0 }, 2);
    expect(r).not.toBeNull();
    expect(r!.a.y).toBeCloseTo(2);
    expect(r!.b.y).toBeCloseTo(2);
  });
});

describe('angleInArcSweep', () => {
  it('CCW arc covering [0, π/2] contains π/4', () => {
    expect(angleInArcSweep(Math.PI / 4, 0, Math.PI / 2, true)).toBe(true);
  });
  it('CCW arc covering [0, π/2] does NOT contain π', () => {
    expect(angleInArcSweep(Math.PI, 0, Math.PI / 2, true)).toBe(false);
  });
  it('CCW arc that wraps through 0 contains -π/4 (= 7π/4)', () => {
    // From 3π/2 → π/2 CCW means sweeping through 0 (i.e., across the +X axis).
    expect(angleInArcSweep(-Math.PI / 4, 3 * Math.PI / 2, Math.PI / 2, true)).toBe(true);
  });
});

describe('allCurveIntersections', () => {
  it('finds line-line intersection inside both segments', () => {
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    const b = addPoint(s, 10, 0); s = b.state;
    const l1 = addLine(s, a.id, b.id); s = l1.state;
    const c = addPoint(s, 5, -1); s = c.state;
    const d = addPoint(s, 5, 1); s = d.state;
    const l2 = addLine(s, c.id, d.id); s = l2.state;
    const pts = allCurveIntersections(s);
    expect(pts).toHaveLength(1);
    expect(pts[0].x).toBeCloseTo(5);
  });

  it('skips construction geometry', () => {
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    const b = addPoint(s, 10, 0); s = b.state;
    const l1 = addLine(s, a.id, b.id); s = l1.state;
    const c = addPoint(s, 5, -1); s = c.state;
    const d = addPoint(s, 5, 1); s = d.state;
    const l2 = addLine(s, c.id, d.id); s = l2.state;
    // Mark first line as construction.
    s = {
      ...s,
      entities: s.entities.map(e => e.id === l1.id ? { ...e, construction: true } : e),
    };
    expect(allCurveIntersections(s)).toHaveLength(0);
  });

  it('finds line-circle intersections', () => {
    let s = emptySketchState();
    const a = addPoint(s, -10, 0); s = a.state;
    const b = addPoint(s, 10, 0); s = b.state;
    const l = addLine(s, a.id, b.id); s = l.state;
    const c = addCircle(s, 0, 0, 5); s = c.state;
    const pts = allCurveIntersections(s);
    expect(pts).toHaveLength(2);
  });
});
