import { describe, it, expect } from 'vitest';
import { analyzeDeterminacy } from './determinacy';
import { emptySketchState, addPoint, addLine, addCircle, addConstraint, addRectangleCorners, ORIGIN_POINT_ID } from './store';

describe('analyzeDeterminacy', () => {
  it('marks the origin as determined in an empty sketch', () => {
    const det = analyzeDeterminacy(emptySketchState());
    expect(det.has(ORIGIN_POINT_ID)).toBe(true);
  });

  it('marks a `fixed` point as determined', () => {
    let s = emptySketchState();
    const p = addPoint(s, 5, 5); s = p.state;
    s = addConstraint(s, 'fixed', [p.id]).state;
    expect(analyzeDeterminacy(s).has(p.id)).toBe(true);
  });

  it('leaves a free point un-determined', () => {
    let s = emptySketchState();
    const p = addPoint(s, 5, 5); s = p.state;
    expect(analyzeDeterminacy(s).has(p.id)).toBe(false);
  });

  it('propagates determinacy through `coincident` between two points', () => {
    let s = emptySketchState();
    const fixed = addPoint(s, 0, 0); s = fixed.state;
    s = addConstraint(s, 'fixed', [fixed.id]).state;
    const other = addPoint(s, 0, 0); s = other.state;
    s = addConstraint(s, 'coincident', [fixed.id, other.id]).state;
    expect(analyzeDeterminacy(s).has(other.id)).toBe(true);
  });

  it('does NOT mark a partially-constrained rectangle as fully determined', () => {
    // Box with horizontal/vertical on each side + fix on one corner. Still has
    // width and height DOFs free. None of the un-fixed corners should be
    // marked determined; therefore neither should any of the four sides.
    let s = emptySketchState();
    const rect = addRectangleCorners(s, 0, 0, 10, 5); s = rect.state;
    const [l1, l2, l3, l4] = rect.ids;
    // Find corner points by walking lines.
    const findLine = (id: string) => s.entities.find(e => e.id === id)!;
    const c1 = (findLine(l1) as any).startId;  // bottom-left
    s = addConstraint(s, 'fixed', [c1]).state;
    for (const lid of [l1, l3]) s = addConstraint(s, 'horizontal', [lid]).state;
    for (const lid of [l2, l4]) s = addConstraint(s, 'vertical', [lid]).state;
    const det = analyzeDeterminacy(s);
    // Only the fixed corner is determined.
    expect(det.has(c1)).toBe(true);
    // None of the four sides are determined.
    for (const lid of [l1, l2, l3, l4]) {
      expect(det.has(lid)).toBe(false);
    }
  });

  it('marks a rectangle with width AND height dimensions as fully determined', () => {
    let s = emptySketchState();
    const rect = addRectangleCorners(s, 0, 0, 10, 5); s = rect.state;
    const [l1, l2, l3, l4] = rect.ids;
    const findEnt = (id: string) => s.entities.find(e => e.id === id)!;
    const c1 = (findEnt(l1) as any).startId;
    const c2 = (findEnt(l1) as any).endId;
    const c4 = (findEnt(l4) as any).startId;
    s = addConstraint(s, 'fixed', [c1]).state;
    for (const lid of [l1, l3]) s = addConstraint(s, 'horizontal', [lid]).state;
    for (const lid of [l2, l4]) s = addConstraint(s, 'vertical', [lid]).state;
    // Width: distance(c1, c2). Height: distance(c1, c4).
    s = addConstraint(s, 'distance', [c1, c2], 10).state;
    s = addConstraint(s, 'distance', [c1, c4], 5).state;
    const det = analyzeDeterminacy(s);
    for (const lid of [l1, l2, l3, l4]) {
      expect(det.has(lid)).toBe(true);
    }
  });

  it('marks a circle as determined when center is fixed and radius is dimensioned', () => {
    let s = emptySketchState();
    const c = addCircle(s, 0, 0, 5); s = c.state;
    const center = s.entities.find(e => e.id === (s.entities.find(en => en.id === c.id) as any).centerId)!;
    s = addConstraint(s, 'fixed', [center.id]).state;
    expect(analyzeDeterminacy(s).has(c.id)).toBe(false);  // no radius dim yet
    s = addConstraint(s, 'radius', [c.id], 5).state;
    expect(analyzeDeterminacy(s).has(c.id)).toBe(true);
  });

  // ── Edge cases the heuristic missed but the exact analyzer handles ───────

  it('triangle: 1 fixed vertex + 2 distances + 1 horizontal pinning → fully determined', () => {
    // Two free vertices, three distance-like constraints. The third side's
    // distance is implied by the other two and the horizontal of one side,
    // but the exact analyzer recognises that all four point coords are
    // pinned by the Jacobian rank.
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    const b = addPoint(s, 10, 0); s = b.state;
    const cc = addPoint(s, 5, 8); s = cc.state;
    s = addConstraint(s, 'fixed', [a.id]).state;
    s = addConstraint(s, 'distance', [a.id, b.id], 10).state;
    s = addConstraint(s, 'distance', [a.id, cc.id], Math.hypot(5, 8)).state;
    // Horizontal pins B onto the +x axis from A (otherwise the triangle
    // could rotate around A).
    const ln = addLine(s, a.id, b.id); s = ln.state;
    s = addConstraint(s, 'horizontal', [ln.id]).state;
    s = addConstraint(s, 'distance', [b.id, cc.id], Math.hypot(5, -8)).state;
    const det = analyzeDeterminacy(s);
    expect(det.has(a.id)).toBe(true);
    expect(det.has(b.id)).toBe(true);
    expect(det.has(cc.id)).toBe(true);
  });

  it('triangle without rotational anchor: stays under-constrained', () => {
    // Same as above MINUS the horizontal — the triangle is rigid in shape
    // but rotates freely around the fixed vertex. Other two vertices not
    // determined.
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    const b = addPoint(s, 10, 0); s = b.state;
    const cc = addPoint(s, 5, 8); s = cc.state;
    s = addConstraint(s, 'fixed', [a.id]).state;
    s = addConstraint(s, 'distance', [a.id, b.id], 10).state;
    s = addConstraint(s, 'distance', [a.id, cc.id], Math.hypot(5, 8)).state;
    s = addConstraint(s, 'distance', [b.id, cc.id], Math.hypot(5, -8)).state;
    const det = analyzeDeterminacy(s);
    expect(det.has(a.id)).toBe(true);
    expect(det.has(b.id)).toBe(false);  // rotation freedom
    expect(det.has(cc.id)).toBe(false);
  });

  it('horizontal line from determined point: locks the other endpoint`s y but not its x', () => {
    // Just a horizontal constraint without distance — the other endpoint
    // can slide along its y. NOT determined.
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    const b = addPoint(s, 10, 0); s = b.state;
    s = addConstraint(s, 'fixed', [a.id]).state;
    const ln = addLine(s, a.id, b.id); s = ln.state;
    s = addConstraint(s, 'horizontal', [ln.id]).state;
    expect(analyzeDeterminacy(s).has(b.id)).toBe(false);
  });
});
