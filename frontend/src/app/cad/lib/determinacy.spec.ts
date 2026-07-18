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

  it('marks a point pinned to an arc/circle center (sub:center) as determined — 0 DOF (REQ 832)', () => {
    let s = emptySketchState();
    const p = addPoint(s, 5, 7); s = p.state;
    // An on-edge constraint with a center sub-element pins (does NOT ride): no
    // externalEdges line is needed, and the point is fully determined.
    s = { ...s, constraints: [...s.constraints, {
      id: 'cc1', type: 'concentric', targets: [{ entityId: p.id }],
      externalRef: { scope: 'local', featureId: 'f1', edgeId: 'f1/e0', sub: 'center' },
    }] };
    expect(analyzeDeterminacy(s).has(p.id)).toBe(true);
  });

  it('a 90° angle dimension contributes rank (review B2 — sin residual had zero gradient at right angles)', () => {
    // L1 fixed along +x; L2 shares the fixed vertex; a 90° angle dim + a
    // length dim must fully determine L2's free endpoint. The old sin-based
    // residual had Jacobian cos(90°)=0, so the endpoint read as free.
    let s = emptySketchState();
    const v = addPoint(s, 0, 0); s = v.state;
    const a = addPoint(s, 10, 0); s = a.state;
    s = addConstraint(s, 'fixed', [v.id]).state;
    s = addConstraint(s, 'fixed', [a.id]).state;
    const l1 = addLine(s, v.id, a.id); s = l1.state;
    const b = addPoint(s, 0, 7); s = b.state;
    const l2 = addLine(s, v.id, b.id); s = l2.state;
    s = addConstraint(s, 'angle', [l1.id, l2.id], Math.PI / 2).state;
    s = addConstraint(s, 'distance', [v.id, b.id], 7).state;
    const det = analyzeDeterminacy(s);
    expect(det.has(b.id)).toBe(true);
    expect(det.has(l2.id)).toBe(true);
  });

  it('a zero-valued horizontal-distance dim contributes rank (review B8-class)', () => {
    // "Align via 0-dim": the old squared residual (dx² − v²) had gradient 0
    // at dx = v = 0, so the aligned point read as free on that axis.
    let s = emptySketchState();
    const p = addPoint(s, 0, 4); s = p.state;
    s = addConstraint(s, 'horizontal-distance', [ORIGIN_POINT_ID, p.id], 0).state;
    s = addConstraint(s, 'vertical-distance', [ORIGIN_POINT_ID, p.id], 4).state;
    expect(analyzeDeterminacy(s).has(p.id)).toBe(true);
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

  // ── Tangent-at-endpoint singular configuration (part 619 / p13 repro) ────
  // A line tangent to a circle whose endpoint is ALSO coincident-on that
  // circle: the solution set is discrete (the bimodal two-sided tangent — you
  // can't drag between the two positions), so the sketch IS fully
  // constrained. The generic |dist(center,line)| − r tangency residual is
  // gradient-degenerate at the solution (parallel to the point-on-circle
  // row), which used to report a phantom DOF.

  it('line tangent to a circle at its on-circle endpoint reads fully determined', () => {
    let s = emptySketchState();
    const c0 = addPoint(s, 0, 0); s = c0.state;
    s = addConstraint(s, 'fixed', [c0.id]).state;
    const k = addCircle(s, 0, 0, 5); s = k.state;
    const circle = s.entities.find(e => e.id === k.id) as any;
    s = addConstraint(s, 'coincident', [circle.centerId, c0.id]).state;
    s = addConstraint(s, 'radius', [k.id], 5).state;
    // Horizontal tangent line touching the circle at A = (0, 5).
    const a = addPoint(s, 0, 5); s = a.state;
    const b = addPoint(s, 10, 5); s = b.state;
    const l = addLine(s, a.id, b.id); s = l.state;
    s = addConstraint(s, 'coincident', [a.id, k.id]).state;       // A on circle
    s = addConstraint(s, 'tangent', [k.id, l.id]).state;          // line tangent
    s = addConstraint(s, 'horizontal', [l.id]).state;             // direction pinned
    s = addConstraint(s, 'horizontal-distance', [a.id, b.id], 10).state;  // B pinned along
    const det = analyzeDeterminacy(s);
    expect(det.has(a.id)).toBe(true);
    expect(det.has(b.id)).toBe(true);
    expect(det.has(l.id)).toBe(true);
  });

  it('generic offset tangent (no endpoint on the curve) still contributes exactly 1 row', () => {
    // Same setup but the line's endpoints are NOT on the circle — the
    // tangency alone pins the line's offset; endpoints stay free along it.
    let s = emptySketchState();
    const c0 = addPoint(s, 0, 0); s = c0.state;
    s = addConstraint(s, 'fixed', [c0.id]).state;
    const k = addCircle(s, 0, 0, 5); s = k.state;
    const circle = s.entities.find(e => e.id === k.id) as any;
    s = addConstraint(s, 'coincident', [circle.centerId, c0.id]).state;
    s = addConstraint(s, 'radius', [k.id], 5).state;
    const a = addPoint(s, -10, 5); s = a.state;
    const b = addPoint(s, 10, 5); s = b.state;
    const l = addLine(s, a.id, b.id); s = l.state;
    s = addConstraint(s, 'tangent', [k.id, l.id]).state;
    s = addConstraint(s, 'horizontal', [l.id]).state;
    const det = analyzeDeterminacy(s);
    // x of both endpoints is still free — must NOT read as determined.
    expect(det.has(a.id)).toBe(false);
    expect(det.has(b.id)).toBe(false);
  });

  it('line tangent to an arc at a shared endpoint (fillet pattern) reads fully determined', () => {
    let s = emptySketchState();
    const c0 = addPoint(s, 0, 0); s = c0.state;
    s = addConstraint(s, 'fixed', [c0.id]).state;
    // Arc centered at the fixed point, R5, from (5,0) to (0,5).
    const arc = addArc(s, 0, 0, 5, 0, 0, 5, true); s = arc.state;
    const arcEnt = s.entities.find(e => e.id === arc.id) as any;
    s = addConstraint(s, 'coincident', [arcEnt.centerId, c0.id]).state;
    s = addConstraint(s, 'radius', [arc.id], 5).state;
    s = addConstraint(s, 'fixed', [arcEnt.startId]).state;
    // Line leaving the arc's END point tangentially (horizontal at y=5).
    const b = addPoint(s, 10, 5); s = b.state;
    const l = addLine(s, arcEnt.endId, b.id); s = l.state;
    s = addConstraint(s, 'tangent', [arc.id, l.id]).state;
    s = addConstraint(s, 'horizontal', [l.id]).state;
    s = addConstraint(s, 'horizontal-distance', [arcEnt.endId, b.id], 10).state;
    const det = analyzeDeterminacy(s);
    // Horizontal + tangent-at-the-shared-endpoint force the radius at the
    // arc end vertical → the end's angular position is discrete (top or
    // bottom of the circle), and B rides from it. Fully determined.
    expect(det.has(arcEnt.endId)).toBe(true);
    expect(det.has(b.id)).toBe(true);
  });

  // ── Tangent junction of two determined circles (part 619 / p1-mrphjqg2) ──
  // A point shared by two circles that are TANGENT to each other sits at
  // their single touch point — isolated, hence constrained — but the two
  // point-on-circle gradients are (anti)parallel there, so plain rank
  // analysis reported a phantom sliding DOF. The tangent-junction fixpoint
  // pass detects the configuration and pins the point.

  it('point at the tangency of two determined circles reads determined (external tangent)', () => {
    let s = emptySketchState();
    const c1c = addPoint(s, 0, 0); s = c1c.state;
    s = addConstraint(s, 'fixed', [c1c.id]).state;
    const k1 = addCircle(s, 0, 0, 5); s = k1.state;
    const k1e = s.entities.find(e => e.id === k1.id) as any;
    s = addConstraint(s, 'coincident', [k1e.centerId, c1c.id]).state;
    s = addConstraint(s, 'radius', [k1.id], 5).state;
    const c2c = addPoint(s, 8, 0); s = c2c.state;
    s = addConstraint(s, 'fixed', [c2c.id]).state;
    const k2 = addCircle(s, 8, 0, 3); s = k2.state;
    const k2e = s.entities.find(e => e.id === k2.id) as any;
    s = addConstraint(s, 'coincident', [k2e.centerId, c2c.id]).state;
    s = addConstraint(s, 'radius', [k2.id], 3).state;
    // Touch point at (5, 0) — coincident on BOTH circles.
    const p = addPoint(s, 5, 0); s = p.state;
    s = addConstraint(s, 'coincident', [p.id, k1.id]).state;
    s = addConstraint(s, 'coincident', [p.id, k2.id]).state;
    expect(analyzeDeterminacy(s).has(p.id)).toBe(true);
  });

  it('point on two tangent circles stays FREE when one circle is undetermined', () => {
    let s = emptySketchState();
    const c1c = addPoint(s, 0, 0); s = c1c.state;
    s = addConstraint(s, 'fixed', [c1c.id]).state;
    const k1 = addCircle(s, 0, 0, 5); s = k1.state;
    const k1e = s.entities.find(e => e.id === k1.id) as any;
    s = addConstraint(s, 'coincident', [k1e.centerId, c1c.id]).state;
    s = addConstraint(s, 'radius', [k1.id], 5).state;
    // Second circle: free-floating center, no radius dim.
    const k2 = addCircle(s, 8, 0, 3); s = k2.state;
    const p = addPoint(s, 5, 0); s = p.state;
    s = addConstraint(s, 'coincident', [p.id, k1.id]).state;
    s = addConstraint(s, 'coincident', [p.id, k2.id]).state;
    expect(analyzeDeterminacy(s).has(p.id)).toBe(false);
  });

  it('fillet-style junction: shared endpoint of two tangent DETERMINED arcs pins, and the arcs resolve', () => {
    // Mirrors part 619: big arc (r=5, center fixed) meets a small arc
    // (r=3, center fixed at distance 8 → externally tangent) at a shared
    // endpoint; each arc's OTHER endpoint is fixed, pinning both radii
    // through the arc invariants. The junction is the touch point.
    let s = emptySketchState();
    const cA = addPoint(s, 0, 0); s = cA.state;
    s = addConstraint(s, 'fixed', [cA.id]).state;
    const cB = addPoint(s, 8, 0); s = cB.state;
    s = addConstraint(s, 'fixed', [cB.id]).state;
    // Arc A: center (0,0) r=5, from (0,5) to the junction (5,0), CW as ccw=false.
    const a1 = addArc(s, 0, 0, 0, 5, 5, 0, false); s = a1.state;
    const a1e = s.entities.find(e => e.id === a1.id) as any;
    s = addConstraint(s, 'coincident', [a1e.centerId, cA.id]).state;
    s = addConstraint(s, 'fixed', [a1e.startId]).state;
    // Arc B: center (8,0) r=3, from the junction (5,0) to (8,3).
    const b1 = addArc(s, 8, 0, 5, 0, 8, 3, true); s = b1.state;
    const b1e = s.entities.find(e => e.id === b1.id) as any;
    s = addConstraint(s, 'coincident', [b1e.centerId, cB.id]).state;
    s = addConstraint(s, 'fixed', [b1e.endId]).state;
    // Weld the junction: arc B starts where arc A ends.
    s = addConstraint(s, 'coincident', [a1e.endId, b1e.startId]).state;
    const det = analyzeDeterminacy(s);
    expect(det.has(a1e.endId)).toBe(true);
    expect(det.has(a1.id)).toBe(true);
    expect(det.has(b1.id)).toBe(true);
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
