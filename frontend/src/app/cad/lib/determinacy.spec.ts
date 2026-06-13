import { describe, it, expect } from 'vitest';
import { analyzeDeterminacy } from './determinacy';
import { emptySketchState, addPoint, addLine, addCircle, addArc, addConstraint, addRectangleCorners, ORIGIN_POINT_ID } from './store';

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

  it('marks a trimmed-circle arc as determined when its start/end points are themselves fixed', () => {
    // Mirrors the trim-a-circle outcome: the surviving arc shares the
    // original circle's centerId AND its start/end are reused from
    // the existing standalone circumference points (or pinned to the
    // crossing curves). With those fully determined, the arc invariants
    // pin the radius and the analyzer rolls up.
    //
    // Geometry chosen so the arc invariant Jacobian is non-degenerate
    // — start/end NOT at (±R, 0), since at those points d|P−C|/dP.y = 0.
    let s = emptySketchState();
    const center = addPoint(s, 0, 0); s = center.state;
    s = addConstraint(s, 'fixed', [center.id]).state;
    const onArc = addPoint(s, 4, 3); s = onArc.state;
    s = addConstraint(s, 'fixed', [onArc.id]).state;
    // Pre-pin start (3, 4) and end (-3, 4) — both at distance 5 from
    // origin, at non-degenerate positions on the arc.
    const startPt = addPoint(s, 3, 4); s = startPt.state;
    s = addConstraint(s, 'fixed', [startPt.id]).state;
    const endPt = addPoint(s, -3, 4); s = endPt.state;
    s = addConstraint(s, 'fixed', [endPt.id]).state;
    // Build the arc using the prebuilt center/start/end.
    const a = addArc(s, 0, 0, 3, 4, -3, 4, true); s = a.state;
    const arcEnt = s.entities.find(e => e.id === a.id) as any;
    s = addConstraint(s, 'coincident', [center.id, arcEnt.centerId]).state;
    s = addConstraint(s, 'coincident', [startPt.id, arcEnt.startId]).state;
    s = addConstraint(s, 'coincident', [endPt.id, arcEnt.endId]).state;
    s = addConstraint(s, 'coincident', [onArc.id, a.id]).state;
    const det = analyzeDeterminacy(s);
    expect(det.has(a.id)).toBe(true);
  });

  it('treats projected (Convert Entities) anchors as pre-fixed', () => {
    // A projected line whose endpoint points are NOT explicitly fixed
    // should still report the line as determined, because the solver
    // pins those anchors at solve time. Without this, every sketch
    // that has a Convert outline never reads as fully constrained.
    // The projection link now lives in an on-edge SketchConstraint.
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    const b = addPoint(s, 10, 0); s = b.state;
    const ln = addLine(s, a.id, b.id); s = ln.state;
    s = {
      ...s,
      constraints: [
        ...s.constraints,
        { id: 'oe1', type: 'on-edge', targets: [{ entityId: ln.id }],
          externalRef: { featureId: 'f1', edgeId: 'f1/e0' } },
      ],
    };
    const det = analyzeDeterminacy(s);
    expect(det.has(a.id)).toBe(true);
    expect(det.has(b.id)).toBe(true);
    expect(det.has(ln.id)).toBe(true);
  });

  it('treats a projected circle as fully determined (center + radius pre-fixed)', () => {
    let s = emptySketchState();
    const c = addCircle(s, 5, 5, 3); s = c.state;
    s = {
      ...s,
      constraints: [
        ...s.constraints,
        { id: 'oe1', type: 'on-edge', targets: [{ entityId: c.id }],
          externalRef: { featureId: 'f1', edgeId: 'f1/e0' } },
      ],
    };
    expect(analyzeDeterminacy(s).has(c.id)).toBe(true);
  });

  it('marks a circle whose center is coincident with a fixed point + radius dim as determined', () => {
    // Mirrors the new snap-to-existing-point behavior for circle clicks.
    let s = emptySketchState();
    const p = addPoint(s, 5, 5); s = p.state;
    s = addConstraint(s, 'fixed', [p.id]).state;
    const c = addCircle(s, 5, 5, 3); s = c.state;
    const circ = s.entities.find(e => e.id === c.id) as any;
    s = addConstraint(s, 'coincident', [p.id, circ.centerId]).state;
    s = addConstraint(s, 'radius', [c.id], 3).state;
    expect(analyzeDeterminacy(s).has(c.id)).toBe(true);
  });

  it('does not crash on a radius constraint whose value is NaN', () => {
    // Failed equation can leave c.value = NaN. Without the residual
    // sanitization, every pivot falls below the tol check and the
    // whole sketch reads as under-constrained.
    let s = emptySketchState();
    const c = addCircle(s, 0, 0, 5); s = c.state;
    const center = s.entities.find(e => e.id === (s.entities.find(en => en.id === c.id) as any).centerId)!;
    s = addConstraint(s, 'fixed', [center.id]).state;
    // Add another fixed point so the analyzer has something else to
    // determine — confirms NaN in one constraint doesn't poison the
    // rest of the system.
    const q = addPoint(s, 7, 7); s = q.state;
    s = addConstraint(s, 'fixed', [q.id]).state;
    s = addConstraint(s, 'radius', [c.id], NaN).state;
    const det = analyzeDeterminacy(s);
    // q is still determined.
    expect(det.has(q.id)).toBe(true);
    // center is still determined.
    expect(det.has(center.id)).toBe(true);
    // circle is NOT determined (radius residual gets dropped).
    expect(det.has(c.id)).toBe(false);
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

describe('analyzeDeterminacy — edge-ref on-edge points (REQ 794)', () => {
  // A point glued to model edge 'f/e' via on-edge. externalEdges supplies the
  // edge's projection (horizontal line y=50). With it the point RIDES the edge
  // (1 DOF along it) → not fully determined; without it the point is pinned.
  const ptOnEdge = () => ({
    entities: [{ kind: 'point' as const, id: 'p', x: 10, y: 50 }],
    constraints: [{
      id: 'oe', type: 'on-edge' as const, targets: [{ entityId: 'p' }],
      externalRef: { scope: 'local' as const, featureId: 'f', edgeId: 'f/e' },
    }],
  });
  const edges = new Map([['f/e', [{ x: -50, y: 50 }, { x: 50, y: 50 }] as const]]);

  it('rides the edge (NOT fully determined) when the projected edge is supplied', () => {
    expect(analyzeDeterminacy(ptOnEdge(), edges).has('p')).toBe(false);
  });

  it('falls back to pinned (determined) when no projected edge is supplied', () => {
    expect(analyzeDeterminacy(ptOnEdge()).has('p')).toBe(true);
  });

  it('s4w5u4a391 repro: vertical line with both endpoints riding edges is NOT fully constrained', () => {
    const state = {
      entities: [
        { kind: 'point' as const, id: 'p1', x: -46.25, y: 50 },
        { kind: 'point' as const, id: 'p2', x: -46.25, y: -50 },
        { kind: 'line' as const, id: 'l3', startId: 'p1', endId: 'p2' },
      ],
      constraints: [
        { id: 'oe1', type: 'on-edge' as const, targets: [{ entityId: 'p1' }], externalRef: { scope: 'local' as const, featureId: 'f', edgeId: 'f/e2' } },
        { id: 'v', type: 'vertical' as const, targets: [{ entityId: 'l3' }] },
        { id: 'oe2', type: 'on-edge' as const, targets: [{ entityId: 'p2' }], externalRef: { scope: 'local' as const, featureId: 'f', edgeId: 'f/e31' } },
      ],
    };
    const e = new Map([
      ['f/e2',  [{ x: -50, y: 50 },  { x: 50, y: 50 }] as const],
      ['f/e31', [{ x: -50, y: -50 }, { x: 50, y: -50 }] as const],
    ]);
    const det = analyzeDeterminacy(state, e);
    // The line can still slide left/right (common x is free) → endpoints and
    // the line are NOT fully determined.
    expect(det.has('p1')).toBe(false);
    expect(det.has('p2')).toBe(false);
    expect(det.has('l3')).toBe(false);
  });
});

describe('analyzeDeterminacy — cross-part edge-ride points (in-context)', () => {
  it('a point riding a cross-part edge is NOT fully determined when its projection is supplied', () => {
    const state = {
      entities: [{ kind: 'point' as const, id: 'p', x: 3, y: 5 }],
      constraints: [{
        id: 'oe', type: 'on-edge' as const, targets: [{ entityId: 'p' }],
        externalRef: {
          scope: 'cross-part' as const, definingAssemblyId: 7, definingAssemblyRepoId: '7',
          sourceInstanceId: 'i2', sourcePartId: 99,
          sourceGeomRef: { featureId: '', edgeId: 'cpe:i2:abc' },
          fallback: { kind: 'edge' as const, start: [0, 0, 0] as [number, number, number], end: [10, 0, 0] as [number, number, number] },
        },
      }],
    };
    const edges = new Map([['cpe:i2:abc', [{ x: 0, y: 5 }, { x: 10, y: 5 }] as const]]);
    expect(analyzeDeterminacy(state, edges).has('p')).toBe(false);
  });
});

describe('analyzeDeterminacy — point-pair horizontal/vertical', () => {
  it('a fixed point + horizontal + horizontal-distance fully determines the other point', () => {
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    s = addConstraint(s, 'fixed', [a.id]).state;
    const b = addPoint(s, 5, 3); s = b.state;
    s = addConstraint(s, 'horizontal', [a.id, b.id]).state;        // b.y = a.y
    s = addConstraint(s, 'horizontal-distance', [a.id, b.id], 5).state; // b.x fixed
    expect(analyzeDeterminacy(s).has(b.id)).toBe(true);
  });

  it('horizontal alone leaves the other point under-determined (x free)', () => {
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    s = addConstraint(s, 'fixed', [a.id]).state;
    const b = addPoint(s, 5, 3); s = b.state;
    s = addConstraint(s, 'horizontal', [a.id, b.id]).state;
    expect(analyzeDeterminacy(s).has(b.id)).toBe(false);
  });
});
