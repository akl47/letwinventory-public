import { describe, it, expect } from 'vitest';
import {
  segmentsForCircle, segmentsForArc, tessellateCircle, tessellateArc, tessellateEntity,
  tessellateEllipse, tessellateSpline,
} from './tessellator';
import type {
  SketchState, SketchEntity, PointEntity, CircleEntity, ArcEntity, EllipseEntity, SplineEntity,
} from './types';

// Small helper: pack a variadic list of entities into a SketchState. Used by
// dispatch tests below where tessellateEntity needs a state to resolve
// per-entity point references.
const state = (...entities: SketchEntity[]): SketchState => ({ entities, constraints: [] });

// REQ 562 — chord-height tessellator. Tests assert chord-error bound and vertex counts.

describe('tessellator: chord-tolerance polyline approximation (REQ 562)', () => {
  describe('segmentsForCircle', () => {
    it('returns at least 3 segments for any positive radius and tolerance', () => {
      expect(segmentsForCircle(10, 1)).toBeGreaterThanOrEqual(3);
      expect(segmentsForCircle(0.01, 0.001)).toBeGreaterThanOrEqual(3);
    });

    it('matches the analytical chord-height formula n = ceil(π / acos(1 − tol/r)) within ±1', () => {
      const r = 10, tol = 0.5;
      const expected = Math.ceil(Math.PI / Math.acos(1 - tol / r));
      const actual = segmentsForCircle(r, tol);
      expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);
    });

    it('scales segment count with tighter tolerance (smaller tol ⇒ more segments)', () => {
      expect(segmentsForCircle(10, 0.01)).toBeGreaterThan(segmentsForCircle(10, 1));
    });

    it('treats tolerance ≥ radius as the minimum 3 segments', () => {
      expect(segmentsForCircle(1, 5)).toBe(3);
    });
  });

  describe('tessellateCircle', () => {
    it('produces a closed polyline whose first and last points coincide', () => {
      const pts = tessellateCircle({ x: 0, y: 0 }, 10, 0.5);
      expect(pts.length).toBeGreaterThanOrEqual(4);
      expect(pts[0].x).toBeCloseTo(pts[pts.length - 1].x);
      expect(pts[0].y).toBeCloseTo(pts[pts.length - 1].y);
    });

    it('keeps every vertex within radius + 1e-6 of the center', () => {
      const r = 7.5;
      const pts = tessellateCircle({ x: 2, y: 3 }, r, 0.1);
      for (const p of pts) {
        const d = Math.hypot(p.x - 2, p.y - 3);
        expect(d).toBeCloseTo(r, 5);
      }
    });

    it('produces an exact chord-error ≤ tolerance at every midpoint', () => {
      const r = 10, tol = 0.2;
      const pts = tessellateCircle({ x: 0, y: 0 }, r, tol);
      for (let i = 0; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2;
        const my = (pts[i].y + pts[i + 1].y) / 2;
        const chordHeight = r - Math.hypot(mx, my);
        expect(chordHeight).toBeLessThanOrEqual(tol + 1e-6);
      }
    });
  });

  describe('segmentsForArc', () => {
    it('scales segment count linearly with sweep angle', () => {
      const r = 10, tol = 0.5;
      const full = segmentsForArc(r, Math.PI * 2, tol);
      const half = segmentsForArc(r, Math.PI, tol);
      expect(Math.abs(full - 2 * half)).toBeLessThanOrEqual(2);
    });

    it('returns at least 1 segment for any non-zero sweep', () => {
      expect(segmentsForArc(10, 0.001, 0.5)).toBeGreaterThanOrEqual(1);
    });
  });

  describe('tessellateArc', () => {
    it('respects the sweep direction (CCW)', () => {
      const pts = tessellateArc(
        { x: 0, y: 0 }, 10,
        0, Math.PI / 2,
        true, 0.1,
      );
      expect(pts[0].x).toBeCloseTo(10);
      expect(pts[0].y).toBeCloseTo(0);
      expect(pts[pts.length - 1].x).toBeCloseTo(0, 5);
      expect(pts[pts.length - 1].y).toBeCloseTo(10, 5);
    });

    it('respects the sweep direction (CW)', () => {
      const pts = tessellateArc(
        { x: 0, y: 0 }, 10,
        0, -Math.PI / 2,
        false, 0.1,
      );
      expect(pts[0].x).toBeCloseTo(10);
      expect(pts[pts.length - 1].y).toBeCloseTo(-10, 5);
    });
  });

  describe('tessellateEntity', () => {
    function state(...entities: Array<PointEntity | CircleEntity | ArcEntity | EllipseEntity>): SketchState {
      return { entities, constraints: [] };
    }

    it('dispatches to circle tessellation for kind=circle', () => {
      const center: PointEntity = { kind: 'point', id: 'c', x: 0, y: 0 };
      const circle: CircleEntity = { kind: 'circle', id: 'k1', centerId: 'c', radius: 5 };
      const result = tessellateEntity(state(center, circle), circle, 0.1);
      expect(result.length).toBeGreaterThanOrEqual(4);
      expect(result[0].x).toBeCloseTo(result[result.length - 1].x);
    });

    it('dispatches to arc tessellation for kind=arc', () => {
      const center: PointEntity = { kind: 'point', id: 'c', x: 0, y: 0 };
      const start: PointEntity = { kind: 'point', id: 's', x: 10, y: 0 };
      const end: PointEntity = { kind: 'point', id: 'e', x: 0, y: 10 };
      const arc: ArcEntity = { kind: 'arc', id: 'a1', centerId: 'c', startId: 's', endId: 'e', radius: 10, ccw: true };
      const result = tessellateEntity(state(center, start, end, arc), arc, 0.1);
      expect(result[0].x).toBeCloseTo(10);
      expect(result[result.length - 1].y).toBeCloseTo(10, 5);
    });

    it('returns an empty array for entities that need no tessellation (point, line)', () => {
      const p: PointEntity = { kind: 'point', id: 'p1', x: 1, y: 2 };
      expect(tessellateEntity(state(p), p, 0.1)).toEqual([]);
    });
  });

  describe('tessellateEllipse', () => {
    it('samples points on the parametric ellipse curve', () => {
      const pts = tessellateEllipse({ x: 0, y: 0 }, { x: 10, y: 0 }, 5, 0.1);
      // Sample at t=0 should be at the major-axis end.
      expect(pts[0].x).toBeCloseTo(10);
      expect(pts[0].y).toBeCloseTo(0);
      // Curve must close back to start.
      expect(pts[pts.length - 1].x).toBeCloseTo(pts[0].x, 5);
      expect(pts[pts.length - 1].y).toBeCloseTo(pts[0].y, 5);
      // All points satisfy x²/a² + y²/b² == 1.
      for (const p of pts) {
        const err = (p.x * p.x) / 100 + (p.y * p.y) / 25 - 1;
        expect(Math.abs(err)).toBeLessThan(1e-6);
      }
    });

    it('handles a rotated major axis', () => {
      // Major axis points along (cos45°, sin45°). Major radius == sqrt(50) ≈ 7.07.
      const pts = tessellateEllipse({ x: 0, y: 0 }, { x: 5, y: 5 }, 1, 0.05);
      // Sample at t=0 hits the major-axis end exactly.
      expect(pts[0].x).toBeCloseTo(5);
      expect(pts[0].y).toBeCloseTo(5);
    });
  });

  describe('tessellateSpline', () => {
    it('passes through first and last control points (clamped knot vector)', () => {
      const ctrls = [{ x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 }, { x: 15, y: 5 }];
      const pts = tessellateSpline(ctrls, 3, 0.5);
      expect(pts[0].x).toBeCloseTo(0);
      expect(pts[0].y).toBeCloseTo(0);
      expect(pts[pts.length - 1].x).toBeCloseTo(15);
      expect(pts[pts.length - 1].y).toBeCloseTo(5);
    });

    it('returns an empty array when there are too few control points for the degree', () => {
      expect(tessellateSpline([{ x: 0, y: 0 }, { x: 1, y: 1 }], 3, 0.1)).toEqual([]);
    });
  });

  describe('tessellateEntity (new kinds)', () => {
    it('dispatches to ellipse tessellation', () => {
      const center: PointEntity = { kind: 'point', id: 'c', x: 0, y: 0 };
      const major: PointEntity = { kind: 'point', id: 'm', x: 10, y: 0 };
      const ell: EllipseEntity = { kind: 'ellipse', id: 'e1', centerId: 'c', majorAxisEndId: 'm', minorRadius: 5 };
      const result = tessellateEntity(state(center, major, ell), ell, 0.1);
      expect(result.length).toBeGreaterThan(8);
    });
    it('dispatches to spline tessellation', () => {
      const p0: PointEntity = { kind: 'point', id: 'p0', x: 0, y: 0 };
      const p1: PointEntity = { kind: 'point', id: 'p1', x: 5, y: 10 };
      const p2: PointEntity = { kind: 'point', id: 'p2', x: 10, y: 0 };
      const p3: PointEntity = { kind: 'point', id: 'p3', x: 15, y: 5 };
      const spl: SplineEntity = { kind: 'spline', id: 's1', controlPointIds: ['p0', 'p1', 'p2', 'p3'], degree: 3 };
      const result = tessellateEntity(state(p0, p1, p2, p3, spl), spl, 0.5);
      expect(result[0].x).toBeCloseTo(0);
      expect(result[result.length - 1].x).toBeCloseTo(15);
    });
  });
});
