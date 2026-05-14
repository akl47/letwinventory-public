import { describe, it, expect } from 'vitest';
import {
  emptySketchState, addPoint, addLine, movePoint, deletePrimitive, addConstraint, setDistanceValue,
} from './store';
import type { SketchState } from './types';
import { pointsOf, linesOf } from './types';

describe('Sketch store (CAD-010, CAD-011, CAD-018, CAD-033, REQ 559–561)', () => {
  describe('addPoint (CAD-010)', () => {
    it('adds a Point entity at the given location', () => {
      const s0 = emptySketchState();
      const { state: s1, id } = addPoint(s0, 3, 4);
      const pts = pointsOf(s1);
      expect(pts.length).toBe(1);
      expect(pts[0]).toMatchObject({ id, x: 3, y: 4, kind: 'point' });
    });

    it('is immutable', () => {
      const s0 = emptySketchState();
      addPoint(s0, 1, 1);
      expect(pointsOf(s0).length).toBe(0);
    });

    it('assigns unique IDs across multiple adds', () => {
      const s0 = emptySketchState();
      const { state: s1, id: id1 } = addPoint(s0, 0, 0);
      const { id: id2 } = addPoint(s1, 1, 1);
      expect(id1).not.toBe(id2);
    });
  });

  describe('addLine (CAD-011)', () => {
    it('adds a Line entity between two existing points', () => {
      let s = emptySketchState();
      const p1 = addPoint(s, 0, 0); s = p1.state;
      const p2 = addPoint(s, 5, 0); s = p2.state;
      const { state: s2, id } = addLine(s, p1.id, p2.id);
      const lines = linesOf(s2);
      expect(lines.length).toBe(1);
      expect(lines[0]).toMatchObject({ id, startId: p1.id, endId: p2.id, kind: 'line' });
    });
  });

  describe('movePoint', () => {
    it("updates a non-construction point's location", () => {
      const { state: s1, id } = addPoint(emptySketchState(), 0, 0);
      const s2 = movePoint(s1, id, 7, 8);
      const p = pointsOf(s2)[0];
      expect(p.x).toBe(7);
      expect(p.y).toBe(8);
    });

    it('refuses to move a construction point (REQ 560)', () => {
      const s1: SketchState = {
        entities: [{ kind: 'point', id: 'ref1', x: 0, y: 0, construction: true }],
        constraints: [],
      };
      const s2 = movePoint(s1, 'ref1', 7, 8);
      expect(pointsOf(s2)[0]).toMatchObject({ x: 0, y: 0 });
    });
  });

  describe('deletePrimitive (CAD-018)', () => {
    it('cascades to lines that depend on a deleted point', () => {
      let s = emptySketchState();
      const p1 = addPoint(s, 0, 0); s = p1.state;
      const p2 = addPoint(s, 5, 0); s = p2.state;
      const ln = addLine(s, p1.id, p2.id); s = ln.state;

      const s2 = deletePrimitive(s, p1.id);
      expect(pointsOf(s2).find(p => p.id === p1.id)).toBeUndefined();
      expect(linesOf(s2).find(l => l.id === ln.id)).toBeUndefined();
    });

    it('cascades through chains of dependent entities and constraints', () => {
      let s = emptySketchState();
      const p1 = addPoint(s, 0, 0); s = p1.state;
      const p2 = addPoint(s, 5, 0); s = p2.state;
      const ln = addLine(s, p1.id, p2.id); s = ln.state;
      const c = addConstraint(s, 'horizontal', [ln.id]); s = c.state;

      const s2 = deletePrimitive(s, p1.id);
      expect(pointsOf(s2).length).toBe(1);
      expect(linesOf(s2).length).toBe(0);
      expect(s2.constraints.length).toBe(0);
    });

    it('refuses to delete a construction entity (REQ 560)', () => {
      const s1: SketchState = {
        entities: [{ kind: 'point', id: 'ref1', x: 0, y: 0, construction: true }],
        constraints: [],
      };
      const s2 = deletePrimitive(s1, 'ref1');
      expect(s2.entities.length).toBe(1);
    });
  });

  describe('addConstraint', () => {
    it('wraps flat-id targets into entity references (REQ 561)', () => {
      let s = emptySketchState();
      const p1 = addPoint(s, 0, 0); s = p1.state;
      const p2 = addPoint(s, 1, 1); s = p2.state;
      const { state: s2, constraint } = addConstraint(s, 'coincident', [p1.id, p2.id]);
      expect(s2.constraints.length).toBe(1);
      expect(s2.constraints[0].id).toBe(constraint.id);
      expect(s2.constraints[0].targets).toEqual([{ entityId: p1.id }, { entityId: p2.id }]);
    });

    it('accepts explicit ConstraintTarget objects for sub-element use', () => {
      let s = emptySketchState();
      const p1 = addPoint(s, 0, 0); s = p1.state;
      const p2 = addPoint(s, 5, 0); s = p2.state;
      const ln = addLine(s, p1.id, p2.id); s = ln.state;
      const ext = addPoint(s, 3, 3); s = ext.state;
      const { state: s2 } = addConstraint(
        s, 'point-on-line', [{ entityId: ext.id }, { entityId: ln.id, sub: 'edge' }],
      );
      expect(s2.constraints[0].targets).toEqual([
        { entityId: ext.id },
        { entityId: ln.id, sub: 'edge' },
      ]);
    });

    it('stores value for a distance constraint', () => {
      let s = emptySketchState();
      const p1 = addPoint(s, 0, 0); s = p1.state;
      const p2 = addPoint(s, 5, 0); s = p2.state;
      const { state: s2 } = addConstraint(s, 'distance', [p1.id, p2.id], 10);
      expect(s2.constraints[0].value).toBe(10);
    });
  });

  describe('setDistanceValue', () => {
    it('updates the value of a distance constraint', () => {
      let s = emptySketchState();
      const p1 = addPoint(s, 0, 0); s = p1.state;
      const p2 = addPoint(s, 5, 0); s = p2.state;
      const { state: s2, constraint } = addConstraint(s, 'distance', [p1.id, p2.id], 5);
      const s3 = setDistanceValue(s2, constraint.id, 25);
      expect(s3.constraints[0].value).toBe(25);
    });

    it('is a no-op for non-distance constraints', () => {
      let s = emptySketchState();
      const p1 = addPoint(s, 0, 0); s = p1.state;
      const { state: s2, constraint } = addConstraint(s, 'fixed', [p1.id]);
      const s3 = setDistanceValue(s2, constraint.id, 99);
      expect(s3.constraints[0].value).toBeUndefined();
    });
  });
});
