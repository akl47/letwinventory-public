import { describe, it, expect } from 'vitest';
import { distanceToEntity, pickEntity, entityTouchesRect } from './picking';
import type {
  SketchState, PointEntity, LineEntity, CircleEntity, ArcEntity, EllipseEntity, SplineEntity,
} from './types';

// REQ 564 — parametric closest-point-on-entity. Pick accuracy must not depend on
// tessellation density of the renderer.

function state(
  ...entities: Array<PointEntity | LineEntity | CircleEntity | ArcEntity | EllipseEntity | SplineEntity>
): SketchState {
  return { entities, constraints: [] };
}

describe('picking: parametric closest-point-on-entity (REQ 564)', () => {
  describe('distanceToEntity', () => {
    it('point: returns Euclidean distance to the point', () => {
      const p: PointEntity = { kind: 'point', id: 'p1', x: 3, y: 4 };
      expect(distanceToEntity(state(p), p, { x: 0, y: 0 })).toBeCloseTo(5);
    });

    it('line: closest-point-on-segment, clamped at endpoints', () => {
      const a: PointEntity = { kind: 'point', id: 'a', x: 0, y: 0 };
      const b: PointEntity = { kind: 'point', id: 'b', x: 10, y: 0 };
      const l: LineEntity = { kind: 'line', id: 'l', startId: 'a', endId: 'b' };
      const s = state(a, b, l);
      // perpendicular projection lands inside segment
      expect(distanceToEntity(s, l, { x: 5, y: 3 })).toBeCloseTo(3);
      // projection past endpoint clamps to nearest end
      expect(distanceToEntity(s, l, { x: 15, y: 0 })).toBeCloseTo(5);
      expect(distanceToEntity(s, l, { x: -3, y: 4 })).toBeCloseTo(5);
    });

    it('circle: |distance(point, center) − radius|, independent of tessellation', () => {
      const c: PointEntity = { kind: 'point', id: 'c', x: 0, y: 0 };
      const k: CircleEntity = { kind: 'circle', id: 'k', centerId: 'c', radius: 10 };
      const s = state(c, k);
      // on circle
      expect(distanceToEntity(s, k, { x: 10, y: 0 })).toBeCloseTo(0);
      // outside
      expect(distanceToEntity(s, k, { x: 15, y: 0 })).toBeCloseTo(5);
      // inside
      expect(distanceToEntity(s, k, { x: 4, y: 0 })).toBeCloseTo(6);
      // diagonal (still parametric, not tessellation-dependent)
      expect(distanceToEntity(s, k, { x: 14, y: 0 })).toBeCloseTo(4);
    });

    it('circle: pick accuracy holds at coarse tessellation densities', () => {
      // Pick a point just barely outside the analytic circle but well inside any
      // polyline tessellation gap. A tessellated picker would falsely report a
      // larger distance; the parametric picker is exact.
      const c: PointEntity = { kind: 'point', id: 'c', x: 0, y: 0 };
      const k: CircleEntity = { kind: 'circle', id: 'k', centerId: 'c', radius: 1 };
      const s = state(c, k);
      // at angle 22.5° the chord midpoint of a 4-segment tessellation is at
      // distance r·cos(π/4) ≈ 0.7071; a pick at distance 0.95 should resolve to
      // ≈ 0.05 from the analytic circle, NOT to whatever the polyline gap is.
      const theta = Math.PI / 8;
      const probe = { x: 0.95 * Math.cos(theta), y: 0.95 * Math.sin(theta) };
      expect(distanceToEntity(s, k, probe)).toBeCloseTo(0.05);
    });

    it('arc: returns circle distance only when angle lies within sweep', () => {
      const c: PointEntity = { kind: 'point', id: 'c', x: 0, y: 0 };
      const s0: PointEntity = { kind: 'point', id: 's', x: 10, y: 0 };
      const e0: PointEntity = { kind: 'point', id: 'e', x: 0, y: 10 };
      const a: ArcEntity = {
        kind: 'arc', id: 'a', centerId: 'c', startId: 's', endId: 'e', radius: 10, ccw: true,
      };
      const st = state(c, s0, e0, a);
      // point on arc (45°)
      const onArc = { x: 10 * Math.cos(Math.PI / 4), y: 10 * Math.sin(Math.PI / 4) };
      expect(distanceToEntity(st, a, onArc)).toBeCloseTo(0);
      // point off the sweep (angle = -π/2): closest is nearest endpoint
      const offSweep = { x: 0, y: -10 };
      const distToStart = Math.hypot(offSweep.x - 10, offSweep.y);
      const distToEnd = Math.hypot(offSweep.x, offSweep.y - 10);
      const expected = Math.min(distToStart, distToEnd);
      expect(distanceToEntity(st, a, offSweep)).toBeCloseTo(expected);
    });
  });

  describe('pickEntity', () => {
    it('returns the closest entity within the pick tolerance', () => {
      const a: PointEntity = { kind: 'point', id: 'a', x: 0, y: 0 };
      const b: PointEntity = { kind: 'point', id: 'b', x: 100, y: 100 };
      const c: PointEntity = { kind: 'point', id: 'c', x: 0, y: 0 };
      const k: CircleEntity = { kind: 'circle', id: 'k', centerId: 'c', radius: 10 };
      const s = state(a, b, c, k);
      // Probe right on the circle's edge — circle wins over the far points.
      const picked = pickEntity(s, { x: 10, y: 0 }, 1);
      expect(picked?.id).toBe('k');
    });

    it('returns null when no entity is within tolerance', () => {
      const c: PointEntity = { kind: 'point', id: 'c', x: 0, y: 0 };
      const k: CircleEntity = { kind: 'circle', id: 'k', centerId: 'c', radius: 10 };
      const s = state(c, k);
      // 50 units from the circle edge, tolerance 1
      expect(pickEntity(s, { x: 60, y: 0 }, 1)).toBeNull();
    });

    it('prefers a point over a line at the same distance', () => {
      // Two entities equidistant from the probe — point should win because
      // higher-dimensional ambiguity favours the lower-dimensional pick.
      const p: PointEntity = { kind: 'point', id: 'p', x: 5, y: 0 };
      const a: PointEntity = { kind: 'point', id: 'a', x: 0, y: -3 };
      const b: PointEntity = { kind: 'point', id: 'b', x: 10, y: -3 };
      const l: LineEntity = { kind: 'line', id: 'l', startId: 'a', endId: 'b' };
      const s = state(p, a, b, l);
      // probe sits 3 units above point p and 3 units above line l simultaneously
      const picked = pickEntity(s, { x: 5, y: 3 }, 5);
      expect(picked?.id).toBe('p');
    });

    it('a far in-tolerance point no longer hijacks a curve under the cursor', () => {
      // Real app tolerances: curve 5, point 8 → point reach bonus = 3. Cursor is
      // ON the line (distance 0); the point is 4 units away — within the larger
      // point tolerance (8) but beyond the reach bonus. The line must win.
      // (Regression: point-preference used to be an unconditional early return,
      // so any in-tolerance point beat the curve the cursor was actually on.)
      const a: PointEntity = { kind: 'point', id: 'a', x: 0, y: 0 };
      const b: PointEntity = { kind: 'point', id: 'b', x: 10, y: 0 };
      const line: LineEntity = { kind: 'line', id: 'line', startId: 'a', endId: 'b' };
      const far: PointEntity = { kind: 'point', id: 'far', x: 5, y: 4 };
      expect(pickEntity(state(a, b, line, far), { x: 5, y: 0 }, 5, 8)?.id).toBe('line');
    });

    it('a point within the reach bonus still wins over a closer curve', () => {
      const a: PointEntity = { kind: 'point', id: 'a', x: 0, y: 0 };
      const b: PointEntity = { kind: 'point', id: 'b', x: 10, y: 0 };
      const line: LineEntity = { kind: 'line', id: 'line', startId: 'a', endId: 'b' };
      const near: PointEntity = { kind: 'point', id: 'near', x: 5, y: 2 };
      // Cursor ON the line (dist 0); the point is 2 units away ≤ reach bonus (3),
      // so endpoint-snapping still feels right — the point wins.
      expect(pickEntity(state(a, b, line, near), { x: 5, y: 0 }, 5, 8)?.id).toBe('near');
    });

    it('picks ellipses near their boundary', () => {
      const c: PointEntity = { kind: 'point', id: 'c', x: 0, y: 0 };
      const m: PointEntity = { kind: 'point', id: 'm', x: 10, y: 0 };
      const ell: EllipseEntity = { kind: 'ellipse', id: 'e', centerId: 'c', majorAxisEndId: 'm', minorRadius: 5 };
      const s = state(c, m, ell);
      // Probe sits right on the major-axis end — distance should be near 0.
      expect(distanceToEntity(s, ell, { x: 10, y: 0 })).toBeLessThan(0.1);
      // Probe far away should not be picked within a tight tolerance.
      expect(distanceToEntity(s, ell, { x: 100, y: 100 })).toBeGreaterThan(50);
    });

    it('picks splines near their tessellated curve', () => {
      const p0: PointEntity = { kind: 'point', id: 'p0', x: 0, y: 0 };
      const p1: PointEntity = { kind: 'point', id: 'p1', x: 5, y: 10 };
      const p2: PointEntity = { kind: 'point', id: 'p2', x: 10, y: 0 };
      const p3: PointEntity = { kind: 'point', id: 'p3', x: 15, y: 5 };
      const spl: SplineEntity = { kind: 'spline', id: 's', controlPointIds: ['p0', 'p1', 'p2', 'p3'], degree: 3 };
      const s = state(p0, p1, p2, p3, spl);
      // First control point lies on the curve (clamped knot vector).
      expect(distanceToEntity(s, spl, { x: 0, y: 0 })).toBeLessThan(0.5);
    });
  });

  describe('entityTouchesRect (REQ 863 — crossing selection)', () => {
    const rect = { minX: 2, minY: -1, maxX: 6, maxY: 1 };

    it('selects a line the rect merely crosses (endpoints outside)', () => {
      const a: PointEntity = { kind: 'point', id: 'a', x: 0, y: 0 };
      const b: PointEntity = { kind: 'point', id: 'b', x: 10, y: 0 };
      const l: LineEntity = { kind: 'line', id: 'l', startId: 'a', endId: 'b' };
      const s = state(a, b, l);
      expect(entityTouchesRect(s, l, rect)).toBe(true);
    });

    it('rejects a line entirely outside the rect', () => {
      const a: PointEntity = { kind: 'point', id: 'a', x: 0, y: 5 };
      const b: PointEntity = { kind: 'point', id: 'b', x: 10, y: 5 };
      const l: LineEntity = { kind: 'line', id: 'l', startId: 'a', endId: 'b' };
      const s = state(a, b, l);
      expect(entityTouchesRect(s, l, rect)).toBe(false);
    });

    it('selects a circle whose rim crosses the rect, but not one enclosing it untouched', () => {
      const c: PointEntity = { kind: 'point', id: 'c', x: 0, y: 0 };
      const rim: CircleEntity = { kind: 'circle', id: 'ci', centerId: 'c', radius: 4 };
      const s = state(c, rim);
      expect(entityTouchesRect(s, rim, rect)).toBe(true);
      // Huge circle far outside the rect: rect fully inside, rim never touches.
      const big: CircleEntity = { kind: 'circle', id: 'big', centerId: 'c', radius: 100 };
      const s2 = state(c, big);
      expect(entityTouchesRect(s2, big, rect)).toBe(false);
    });

    it('selects a point inside the rect only', () => {
      const inP: PointEntity = { kind: 'point', id: 'i', x: 3, y: 0 };
      const outP: PointEntity = { kind: 'point', id: 'o', x: 30, y: 0 };
      const s = state(inP, outP);
      expect(entityTouchesRect(s, inP, rect)).toBe(true);
      expect(entityTouchesRect(s, outP, rect)).toBe(false);
    });
  });
});
