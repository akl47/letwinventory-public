import { describe, it, expect } from 'vitest';
import {
  emptySketchState, addPoint, addLine, addCircle, addArc, movePoint, deletePrimitive,
  addConstraint, setDistanceValue,
  addRectangleCorners, addRectangleCenter, addPolygon, addSlotStraight,
  addCircle3Points, addArc3Points, addEllipse, addSpline,
  setConstructionFlag,
} from './store';
import type { SketchState, CircleEntity, ArcEntity, EllipseEntity, SplineEntity, LineEntity } from './types';
import { pointsOf, linesOf, findEntity, findPoint } from './types';

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

  describe('addCircle (REQ 566)', () => {
    it('creates a center point and a circle entity', () => {
      const { state, id } = addCircle(emptySketchState(), 5, 5, 10);
      const circle = findEntity<CircleEntity>(state, id)!;
      expect(circle.kind).toBe('circle');
      expect(circle.radius).toBe(10);
      const center = findPoint(state, circle.centerId);
      expect(center).toBeDefined();
      expect(center).toMatchObject({ x: 5, y: 5 });
    });

    it('is immutable', () => {
      const s0 = emptySketchState();
      addCircle(s0, 0, 0, 5);
      expect(s0.entities.length).toBe(0);
    });
  });

  describe('addArc (REQ 569)', () => {
    it('creates 3 points and an arc entity with radius from |center→start|', () => {
      const { state, id } = addArc(emptySketchState(), 0, 0, 10, 0, 0, 10, true);
      const arc = findEntity<ArcEntity>(state, id)!;
      expect(arc.kind).toBe('arc');
      expect(arc.radius).toBe(10);
      expect(arc.ccw).toBe(true);
      const center = findPoint(state, arc.centerId)!;
      const start = findPoint(state, arc.startId)!;
      const end = findPoint(state, arc.endId)!;
      expect(center).toMatchObject({ x: 0, y: 0 });
      expect(start).toMatchObject({ x: 10, y: 0 });
      expect(end).toMatchObject({ x: 0, y: 10 });
    });

    it('snaps the end-point to the circle of |center→start| when the raw click is off-radius', () => {
      // Center (0,0), start (10,0) → radius=10. End click at (0,5) — off-radius — should snap to (0,10).
      const { state, id } = addArc(emptySketchState(), 0, 0, 10, 0, 0, 5, true);
      const arc = findEntity<ArcEntity>(state, id)!;
      const end = findPoint(state, arc.endId)!;
      expect(Math.hypot(end.x, end.y)).toBeCloseTo(10);
      // Direction preserved (still up).
      expect(end.x).toBeCloseTo(0);
      expect(end.y).toBeCloseTo(10);
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

    it('allows moving construction points — construction is visual-only now', () => {
      // Earlier behavior pinned construction points so they couldn't be
      // dragged. SW-equivalent semantics: construction is dashed reference
      // geometry, but the user can still drag / dimension it. Only the
      // synthetic origin remains unmovable.
      const s1: SketchState = {
        entities: [{ kind: 'point', id: 'ref1', x: 0, y: 0, construction: true }],
        constraints: [],
      };
      const s2 = movePoint(s1, 'ref1', 7, 8);
      expect(pointsOf(s2)[0]).toMatchObject({ x: 7, y: 8 });
    });

    it('refuses to move the synthetic origin point', () => {
      const s1: SketchState = {
        entities: [{ kind: 'point', id: 'origin', x: 0, y: 0, construction: true }],
        constraints: [],
      };
      const s2 = movePoint(s1, 'origin', 7, 8);
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

    it('allows deleting a construction entity — construction is visual-only now', () => {
      // Construction used to be a "locked reference" mode that blocked
      // delete; the new model treats it as a pure visual style (dashed
      // reference), so the user can delete it like any other primitive.
      // The origin is the only entity that's still undeletable.
      const s1: SketchState = {
        entities: [{ kind: 'point', id: 'ref1', x: 0, y: 0, construction: true }],
        constraints: [],
      };
      const s2 = deletePrimitive(s1, 'ref1');
      expect(s2.entities.length).toBe(0);
    });

    it('refuses to delete the synthetic origin point', () => {
      const s1: SketchState = {
        entities: [{ kind: 'point', id: 'origin', x: 0, y: 0, construction: true }],
        constraints: [],
      };
      const s2 = deletePrimitive(s1, 'origin');
      expect(s2.entities.length).toBe(1);
    });

    // ── Backward cascade: support points come along when nothing else
    //    references them. ─────────────────────────────────────────────
    it('deletes a line`s endpoints when no other entity uses them', () => {
      let s = emptySketchState();
      const p1 = addPoint(s, 0, 0); s = p1.state;
      const p2 = addPoint(s, 5, 0); s = p2.state;
      const ln = addLine(s, p1.id, p2.id); s = ln.state;
      const s2 = deletePrimitive(s, ln.id);
      expect(pointsOf(s2).find(p => p.id === p1.id)).toBeUndefined();
      expect(pointsOf(s2).find(p => p.id === p2.id)).toBeUndefined();
      expect(linesOf(s2).find(l => l.id === ln.id)).toBeUndefined();
    });

    it('keeps a line`s endpoint when another line shares it', () => {
      // L-shape sharing one corner. Deleting the horizontal leg should
      // leave the corner intact because the vertical still anchors there.
      let s = emptySketchState();
      const a = addPoint(s, 0, 0); s = a.state;
      const corner = addPoint(s, 5, 0); s = corner.state;
      const c = addPoint(s, 5, 5); s = c.state;
      const horiz = addLine(s, a.id, corner.id); s = horiz.state;
      const vert = addLine(s, corner.id, c.id); s = vert.state;
      const s2 = deletePrimitive(s, horiz.id);
      // 'a' was exclusive to horiz → gone.
      expect(pointsOf(s2).find(p => p.id === a.id)).toBeUndefined();
      // corner is shared with vert → stays.
      expect(pointsOf(s2).find(p => p.id === corner.id)).toBeDefined();
      // c is exclusive to vert → stays.
      expect(pointsOf(s2).find(p => p.id === c.id)).toBeDefined();
    });

    it('keeps an endpoint that has a surviving constraint referencing it', () => {
      // Two separate lines tied at one endpoint each via a coincident
      // constraint. Deleting one line should leave its tied endpoint alive
      // because the constraint (and the other line) still anchors it.
      let s = emptySketchState();
      const a = addPoint(s, 0, 0); s = a.state;
      const b = addPoint(s, 5, 0); s = b.state;
      const c = addPoint(s, 5, 0); s = c.state;
      const d = addPoint(s, 10, 0); s = d.state;
      const l1 = addLine(s, a.id, b.id); s = l1.state;
      const l2 = addLine(s, c.id, d.id); s = l2.state;
      s = addConstraint(s, 'coincident', [b.id, c.id]).state;
      const s2 = deletePrimitive(s, l1.id);
      // 'a' was exclusive to l1 → gone.
      expect(pointsOf(s2).find(p => p.id === a.id)).toBeUndefined();
      // 'b' is tied to 'c' via a surviving coincident → b stays.
      expect(pointsOf(s2).find(p => p.id === b.id)).toBeDefined();
      // 'c' and 'd' are still anchors of l2 → stay.
      expect(pointsOf(s2).find(p => p.id === c.id)).toBeDefined();
      expect(pointsOf(s2).find(p => p.id === d.id)).toBeDefined();
    });

    it('deletes a circle`s center when nothing else uses it', () => {
      let s = emptySketchState();
      const c = addCircle(s, 0, 0, 5); s = c.state;
      const centerId = (s.entities.find(e => e.id === c.id) as any).centerId;
      const s2 = deletePrimitive(s, c.id);
      expect(pointsOf(s2).find(p => p.id === centerId)).toBeUndefined();
    });

    it('keeps a circle`s center when a concentric peer also uses it', () => {
      // Two concentric circles sharing the SAME center point id.
      let s = emptySketchState();
      const c1 = addCircle(s, 0, 0, 5); s = c1.state;
      const centerId = (s.entities.find(e => e.id === c1.id) as any).centerId;
      // Add a second circle anchored at the same center.
      const c2id = 'c2';
      s = { ...s, entities: [...s.entities, { kind: 'circle', id: c2id, centerId, radius: 10 }] };
      const s2 = deletePrimitive(s, c1.id);
      expect(pointsOf(s2).find(p => p.id === centerId)).toBeDefined();
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
        s, 'coincident', [{ entityId: ext.id }, { entityId: ln.id, sub: 'edge' }],
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

  // ── Phase B composite shape builders ──────────────────────────────────

  describe('addRectangleCorners', () => {
    it('produces 4 lines + 4 points walked CCW', () => {
      const { state, ids } = addRectangleCorners(emptySketchState(), 0, 0, 10, 5);
      expect(ids.length).toBe(4);
      expect(pointsOf(state).length).toBe(4);
      expect(linesOf(state).length).toBe(4);
      const xs = pointsOf(state).map(p => p.x).sort((a, b) => a - b);
      const ys = pointsOf(state).map(p => p.y).sort((a, b) => a - b);
      expect(xs).toEqual([0, 0, 10, 10]);
      expect(ys).toEqual([0, 0, 5, 5]);
    });
  });

  describe('addRectangleCenter', () => {
    it('mirrors the corner around the center', () => {
      const { state } = addRectangleCenter(emptySketchState(), 5, 5, 8, 7);
      const xs = pointsOf(state).map(p => p.x).sort((a, b) => a - b);
      const ys = pointsOf(state).map(p => p.y).sort((a, b) => a - b);
      // hw = 3, hh = 2 → corners at (2,3) (8,3) (8,7) (2,7)
      expect(xs).toEqual([2, 2, 8, 8]);
      expect(ys).toEqual([3, 3, 7, 7]);
    });
  });

  describe('addPolygon', () => {
    it('creates N lines and N points for a regular N-gon', () => {
      const { state, ids } = addPolygon(emptySketchState(), 0, 0, 10, 0, 6);
      expect(ids.length).toBe(6);
      expect(linesOf(state).length).toBe(6);
      expect(pointsOf(state).length).toBe(6);
      // First vertex at (10, 0)
      const first = pointsOf(state)[0];
      expect(first.x).toBeCloseTo(10);
      expect(first.y).toBeCloseTo(0);
    });
    it('rejects N < 3', () => {
      expect(() => addPolygon(emptySketchState(), 0, 0, 10, 0, 2)).toThrow();
    });
  });

  describe('addSlotStraight', () => {
    it('produces 2 lines + 2 arcs', () => {
      const { state, ids } = addSlotStraight(emptySketchState(), 0, 0, 20, 0, 5);
      expect(ids.length).toBe(4);
      const arcs = state.entities.filter((e): e is ArcEntity => e.kind === 'arc');
      const lines = state.entities.filter((e): e is LineEntity => e.kind === 'line');
      expect(arcs.length).toBe(2);
      expect(lines.length).toBe(2);
    });
  });

  describe('addCircle3Points', () => {
    it('finds the circumscribed circle through 3 non-collinear points', () => {
      const { state, id } = addCircle3Points(emptySketchState(), 0, 0, 10, 0, 5, 5);
      expect(id).not.toBeNull();
      const circle = state.entities.find((e): e is CircleEntity => e.kind === 'circle')!;
      // Circumcircle of (0,0), (10,0), (5,5) has center (5, 0) and radius 5.
      const center = findPoint(state, circle.centerId)!;
      expect(center.x).toBeCloseTo(5);
      expect(center.y).toBeCloseTo(0);
      expect(circle.radius).toBeCloseTo(5);
    });
    it('returns null id for collinear points', () => {
      const { id } = addCircle3Points(emptySketchState(), 0, 0, 5, 0, 10, 0);
      expect(id).toBeNull();
    });
  });

  describe('addArc3Points', () => {
    it('creates an arc through 3 points', () => {
      const { state, id } = addArc3Points(emptySketchState(), 10, 0, 0, 10, -10, 0);
      expect(id).not.toBeNull();
      const arc = state.entities.find((e): e is ArcEntity => e.kind === 'arc')!;
      expect(arc.radius).toBeCloseTo(10);
    });
  });

  describe('addEllipse', () => {
    it('stores center, major-axis endpoint, and minor radius', () => {
      const { state, id } = addEllipse(emptySketchState(), 0, 0, 10, 0, 5);
      const ell = findEntity(state, id) as EllipseEntity;
      expect(ell.kind).toBe('ellipse');
      expect(ell.minorRadius).toBe(5);
      const center = findPoint(state, ell.centerId)!;
      const major = findPoint(state, ell.majorAxisEndId)!;
      expect(center).toMatchObject({ x: 0, y: 0 });
      expect(major).toMatchObject({ x: 10, y: 0 });
    });
  });

  describe('addSpline', () => {
    it('materializes control points and stores their ids in order', () => {
      const { state, id } = addSpline(emptySketchState(), [
        { x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 }, { x: 15, y: 5 },
      ], 3);
      expect(id).not.toBeNull();
      const spl = findEntity(state, id!) as SplineEntity;
      expect(spl.controlPointIds.length).toBe(4);
      expect(spl.degree).toBe(3);
    });
    it('rejects fewer than degree+1 control points', () => {
      const { id } = addSpline(emptySketchState(), [{ x: 0, y: 0 }, { x: 5, y: 5 }], 3);
      expect(id).toBeNull();
    });
  });

  describe('setConstructionFlag', () => {
    it('flips a single point to construction', () => {
      const s0 = emptySketchState();
      const p = addPoint(s0, 5, 5);
      const s1 = setConstructionFlag(p.state, [p.id], true);
      expect(findEntity(s1, p.id)?.construction).toBe(true);
    });

    it('cascades to the line\'s endpoints', () => {
      let s = emptySketchState();
      const p1 = addPoint(s, 0, 0); s = p1.state;
      const p2 = addPoint(s, 10, 0); s = p2.state;
      const l = addLine(s, p1.id, p2.id); s = l.state;
      const next = setConstructionFlag(s, [l.id], true);
      // Both the line and its endpoint points become construction so the
      // dashed render is coherent.
      expect(findEntity(next, l.id)?.construction).toBe(true);
      expect(findEntity(next, p1.id)?.construction).toBe(true);
      expect(findEntity(next, p2.id)?.construction).toBe(true);
    });

    it('cascades to a circle\'s center', () => {
      const r = addCircle(emptySketchState(), 0, 0, 10);
      const circle = findEntity(r.state, r.id) as CircleEntity;
      const next = setConstructionFlag(r.state, [r.id], true);
      expect(findEntity(next, r.id)?.construction).toBe(true);
      expect(findEntity(next, circle.centerId)?.construction).toBe(true);
    });

    it('can also flip construction off', () => {
      const r = addCircle(emptySketchState(), 0, 0, 10);
      const on = setConstructionFlag(r.state, [r.id], true);
      const off = setConstructionFlag(on, [r.id], false);
      expect(findEntity(off, r.id)?.construction).toBe(false);
    });
  });

  describe('dimensional constraints', () => {
    it('stores radius/diameter/angle values', () => {
      let s = emptySketchState();
      const r = addCircle(s, 0, 0, 10); s = r.state;
      const rad = addConstraint(s, 'radius', [r.id], 15); s = rad.state;
      const dia = addConstraint(s, 'diameter', [r.id], 30); s = dia.state;
      expect(s.constraints.find(c => c.type === 'radius')?.value).toBe(15);
      expect(s.constraints.find(c => c.type === 'diameter')?.value).toBe(30);
    });
  });
});
