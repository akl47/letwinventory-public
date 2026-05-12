import { describe, it, expect } from 'vitest';
import {
  emptySketchState, addPoint, addLine, movePoint, deletePrimitive, addConstraint, setDistanceValue,
} from './store';

describe('Sketch store (CAD-010, CAD-011, CAD-018, CAD-033)', () => {
  describe('addPoint (CAD-010)', () => {
    it('adds a point at the given location', () => {
      const s0 = emptySketchState();
      const { state: s1, id } = addPoint(s0, 3, 4);
      expect(s1.points.length).toBe(1);
      expect(s1.points[0]).toMatchObject({ id, x: 3, y: 4 });
    });

    it('is immutable', () => {
      const s0 = emptySketchState();
      addPoint(s0, 1, 1);
      expect(s0.points.length).toBe(0);
    });

    it('assigns unique IDs across multiple adds', () => {
      const s0 = emptySketchState();
      const { state: s1, id: id1 } = addPoint(s0, 0, 0);
      const { id: id2 } = addPoint(s1, 1, 1);
      expect(id1).not.toBe(id2);
    });
  });

  describe('addLine (CAD-011)', () => {
    it('adds a line between two existing points', () => {
      let s = emptySketchState();
      const p1 = addPoint(s, 0, 0); s = p1.state;
      const p2 = addPoint(s, 5, 0); s = p2.state;
      const { state: s2, id } = addLine(s, p1.id, p2.id);
      expect(s2.lines.length).toBe(1);
      expect(s2.lines[0]).toMatchObject({ id, startId: p1.id, endId: p2.id });
    });
  });

  describe('movePoint', () => {
    it('updates a non-reference point\'s location', () => {
      const { state: s1, id } = addPoint(emptySketchState(), 0, 0);
      const s2 = movePoint(s1, id, 7, 8);
      expect(s2.points[0].x).toBe(7);
      expect(s2.points[0].y).toBe(8);
    });

    it('refuses to move a reference point (CAD-033)', () => {
      // Construct a reference point manually since promote helpers live in document.
      const s1 = { points: [{ id: 'ref1', x: 0, y: 0, reference: true }], lines: [], constraints: [] };
      const s2 = movePoint(s1, 'ref1', 7, 8);
      expect(s2.points[0]).toMatchObject({ x: 0, y: 0 });
    });
  });

  describe('deletePrimitive (CAD-018)', () => {
    it('cascades to lines that depend on a deleted point', () => {
      let s = emptySketchState();
      const p1 = addPoint(s, 0, 0); s = p1.state;
      const p2 = addPoint(s, 5, 0); s = p2.state;
      const ln = addLine(s, p1.id, p2.id); s = ln.state;

      const s2 = deletePrimitive(s, p1.id);
      expect(s2.points.find(p => p.id === p1.id)).toBeUndefined();
      expect(s2.lines.find(l => l.id === ln.id)).toBeUndefined();
    });

    it('cascades through chains of dependent primitives and constraints', () => {
      let s = emptySketchState();
      const p1 = addPoint(s, 0, 0); s = p1.state;
      const p2 = addPoint(s, 5, 0); s = p2.state;
      const ln = addLine(s, p1.id, p2.id); s = ln.state;
      const c = addConstraint(s, 'horizontal', [ln.id]); s = c.state;

      const s2 = deletePrimitive(s, p1.id);
      expect(s2.points.length).toBe(1);
      expect(s2.lines.length).toBe(0);
      expect(s2.constraints.length).toBe(0);
    });

    it('refuses to delete a reference primitive (CAD-033)', () => {
      const s1 = {
        points: [{ id: 'ref1', x: 0, y: 0, reference: true }],
        lines: [],
        constraints: [],
      };
      const s2 = deletePrimitive(s1, 'ref1');
      expect(s2.points.length).toBe(1);
    });
  });

  describe('addConstraint', () => {
    it('appends a constraint with auto-assigned id', () => {
      let s = emptySketchState();
      const p1 = addPoint(s, 0, 0); s = p1.state;
      const p2 = addPoint(s, 1, 1); s = p2.state;
      const { state: s2, constraint } = addConstraint(s, 'coincident', [p1.id, p2.id]);
      expect(s2.constraints.length).toBe(1);
      expect(s2.constraints[0].id).toBe(constraint.id);
      expect(s2.constraints[0].type).toBe('coincident');
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
