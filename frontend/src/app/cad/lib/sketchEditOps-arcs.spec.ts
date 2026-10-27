import { describe, it, expect } from 'vitest';
import { emptySketchState, addPoint, addLine, addCircle, addArc, addArcByPoints, addConstraint } from './store';
import {
  trimAt, extendArc, splitCircleAt, splitArcAt,
  computeFilletLineArcGeometry, filletLineArc,
  computeFilletArcArcGeometry, filletArcArc, chamferLineArc,
} from './sketchEditOps';
import { findEntity, findPoint } from './types';
import type { LineEntity, ArcEntity } from './types';

// REQ 888 — edit-op arc parity: Extend supports arcs, Split supports
// circles/arcs (trim keeping every piece), Fillet supports arc-arc
// corners, Chamfer supports line-arc corners. Same constraint-
// inheritance discipline as the line-based ops (directional constraints
// inherit, dims drop, passengers re-attach, endpoint reuse).

/** Quarter arc from (5,0) to (0,5), CCW, centered at the origin. */
function quarterArc(state = emptySketchState()) {
  const r = addArc(state, 0, 0, 5, 0, 0, 5, true);
  return { state: r.state, arcId: r.id };
}

/** Upper half-circle arc from (5,0) to (-5,0), CCW, centered at the origin. */
function upperHalfArc(state = emptySketchState()) {
  const r = addArc(state, 0, 0, 5, 0, -5, 0, true);
  return { state: r.state, arcId: r.id };
}

/** Two arcs meeting at a 90° corner at V=(10,0): arc1 is the top
 * semicircle (0,0)→V around (5,0) CW; arc2 is the right-bulging
 * semicircle V→(10,10) around (10,5) CCW. Shared V point id. */
function twoArcCorner() {
  let s = emptySketchState();
  const start1 = addPoint(s, 0, 0); s = start1.state;
  const v = addPoint(s, 10, 0); s = v.state;
  const end2 = addPoint(s, 10, 10); s = end2.state;
  const c1 = addPoint(s, 5, 0); s = c1.state;
  const c2 = addPoint(s, 10, 5); s = c2.state;
  const arc1 = addArcByPoints(s, c1.id, start1.id, v.id, false); s = arc1.state;
  const arc2 = addArcByPoints(s, c2.id, v.id, end2.id, true); s = arc2.state;
  return { state: s, arc1Id: arc1.id, arc2Id: arc2.id, vId: v.id };
}

/** Line (0,0)→V=(10,0) meeting an arc at V: arc centered (15,0) r=5
 * from V (angle 180°) to (15,5) (angle 90°), CW. At V the line's
 * out-of-corner direction is WEST and the arc's is NORTH. */
function lineArcCorner() {
  let s = emptySketchState();
  const a = addPoint(s, 0, 0); s = a.state;
  const v = addPoint(s, 10, 0); s = v.state;
  const arcCenter = addPoint(s, 15, 0); s = arcCenter.state;
  const arcEnd = addPoint(s, 15, 5); s = arcEnd.state;
  const l = addLine(s, a.id, v.id); s = l.state;
  const arc = addArcByPoints(s, arcCenter.id, v.id, arcEnd.id, false); s = arc.state;
  return { state: s, lineId: l.id, arcId: arc.id, vId: v.id };
}

describe('extendArc', () => {
  it('extends the endpoint nearer the click to the first crossing curve', () => {
    let s = emptySketchState();
    const qa = quarterArc(s); s = qa.state;
    // Boundary line crossing the arc's circle at (-5, 0) — the first
    // crossing walking CCW past the arc's (0, 5) end.
    const a = addPoint(s, -10, 0); s = a.state;
    const b = addPoint(s, 0, 0); s = b.state;
    const boundary = addLine(s, a.id, b.id); s = boundary.state;
    // Click near the (0, 5) end.
    const r = extendArc(s, qa.arcId, { x: 0.5, y: 4.9 });
    expect(r.error).toBeUndefined();
    const arcAfter = findEntity<ArcEntity>(r.state, qa.arcId)!;
    const endPt = findPoint(r.state, arcAfter.endId)!;
    expect(endPt.x).toBeCloseTo(-5);
    expect(endPt.y).toBeCloseTo(0);
    expect(arcAfter.radius).toBeCloseTo(5);
    // The extended endpoint is pinned to the boundary curve.
    const pin = r.state.constraints.find(c =>
      c.type === 'coincident'
      && c.targets.some(t => t.entityId === arcAfter.endId)
      && c.targets.some(t => t.entityId === boundary.id));
    expect(pin).toBeDefined();
  });

  it('extends the start endpoint backward when the click is nearer the start', () => {
    let s = emptySketchState();
    const qa = quarterArc(s); s = qa.state;
    // Boundary crossing the circle at (0, -5) — behind the (5, 0) start.
    const a = addPoint(s, 0, -10); s = a.state;
    const b = addPoint(s, 0, 0); s = b.state;
    s = addLine(s, a.id, b.id).state;
    const r = extendArc(s, qa.arcId, { x: 4.9, y: 0.5 });
    expect(r.error).toBeUndefined();
    const arcAfter = findEntity<ArcEntity>(r.state, qa.arcId)!;
    const startPt = findPoint(r.state, arcAfter.startId)!;
    expect(startPt.x).toBeCloseTo(0);
    expect(startPt.y).toBeCloseTo(-5);
    expect(arcAfter.radius).toBeCloseTo(5);
  });

  it('returns the state unchanged with an error when no boundary crosses the arc', () => {
    let s = emptySketchState();
    const qa = quarterArc(s); s = qa.state;
    const r = extendArc(s, qa.arcId, { x: 0.5, y: 4.9 });
    expect(r.error).toBe('No boundary to extend to');
    expect(r.state).toBe(s);
  });

  it('extends to a CONSTRUCTION boundary (parity with trim — REQ 866 ride-along)', () => {
    let s = emptySketchState();
    const qa = quarterArc(s); s = qa.state;
    const a = addPoint(s, -10, 0); s = a.state;
    const b = addPoint(s, 0, 0); s = b.state;
    s = addLine(s, a.id, b.id, { construction: true }).state;
    const r = extendArc(s, qa.arcId, { x: 0.5, y: 4.9 });
    expect(r.error).toBeUndefined();
    const arcAfter = findEntity<ArcEntity>(r.state, qa.arcId)!;
    const endPt = findPoint(r.state, arcAfter.endId)!;
    expect(endPt.x).toBeCloseTo(-5);
    expect(endPt.y).toBeCloseTo(0);
  });
});

describe('trimAt — arcs (B8 constraint discipline)', () => {
  const D = Math.PI / 180;
  /** Arc 0°..315° CCW around the origin (r=5) with cutter lines from
   * the interior crossing the arc at 45° and 135°. */
  function bigArcWithCutters() {
    let s = emptySketchState();
    const arc = addArc(s, 0, 0, 5, 0, 5 * Math.cos(315 * D), 5 * Math.sin(315 * D), true);
    s = arc.state;
    for (const deg of [45, 135]) {
      const p1 = addPoint(s, 0, 0); s = p1.state;
      const p2 = addPoint(s, 10 * Math.cos(deg * D), 10 * Math.sin(deg * D)); s = p2.state;
      s = addLine(s, p1.id, p2.id).state;
    }
    return { state: s, arcId: arc.id };
  }

  it('B8: a passenger at 170° re-attaches to the piece whose sweep covers it (the review case)', () => {
    // Trim at 90° splits the arc into [0°..45°] and [135°..315°]. The
    // passenger rides at 170° — it belongs to the SECOND piece. The
    // old code rewired every constraint onto the first kept piece,
    // snapping the passenger ~120° on the next solve; dims were also
    // blindly re-applied (dropped now — different sweep).
    const built = bigArcWithCutters();
    let s = built.state;
    const pass = addPoint(s, 5 * Math.cos(170 * D), 5 * Math.sin(170 * D)); s = pass.state;
    s = addConstraint(s, 'coincident', [pass.id, built.arcId]).state;
    s = addConstraint(s, 'radius', [built.arcId], 5).state;
    const r = trimAt(s, built.arcId, { x: 0, y: 5 });
    expect(r.error).toBeUndefined();
    expect(r.affectedIds?.length).toBe(2);
    const coin = r.state.constraints.find(c =>
      c.type === 'coincident'
      && c.targets.some(t => t.entityId === pass.id)
      && c.targets.some(t => r.affectedIds!.includes(t.entityId)));
    expect(coin).toBeDefined();
    // Specifically the piece that STARTS at the 135° crossing.
    const pieceId = coin!.targets.map(t => t.entityId).find(id => id !== pass.id)!;
    const piece = findEntity<ArcEntity>(r.state, pieceId)!;
    const ps = findPoint(r.state, piece.startId)!;
    expect(Math.atan2(ps.y, ps.x)).toBeCloseTo(135 * D);
    // Radius dims are NOT sweep-dependent — they transfer onto exactly ONE
    // kept piece (see trimAt constraint preservation; sweep-dependent dims
    // still drop).
    const radiusDims = r.state.constraints.filter(c => c.type === 'radius');
    expect(radiusDims.length).toBe(1);
    expect(r.affectedIds).toContain(radiusDims[0].targets[0].entityId);
  });

  it('B8: releases a passenger cut away with the removed span', () => {
    // Passenger at 90°, slightly off the circumference so it is a pure
    // passenger (not a cut marker). The removed span [45°..135°]
    // covers it → its coincident is released, not welded to a piece.
    const built = bigArcWithCutters();
    let s = built.state;
    const pass = addPoint(s, 5.01 * Math.cos(90 * D), 5.01 * Math.sin(90 * D)); s = pass.state;
    s = addConstraint(s, 'coincident', [pass.id, built.arcId]).state;
    const r = trimAt(s, built.arcId, { x: 0, y: 5 });
    expect(r.error).toBeUndefined();
    expect(r.affectedIds?.length).toBe(2);
    expect(findEntity(r.state, pass.id)).toBeDefined();
    expect(r.state.constraints.some(c =>
      c.targets.some(t => t.entityId === pass.id))).toBe(false);
  });
});

describe('splitArcAt', () => {
  it('splits at one interior crossing into two arcs sharing the crossing point', () => {
    let s = emptySketchState();
    const ha = upperHalfArc(s); s = ha.state;
    // Vertical cutter crossing the arc at (0, 5).
    const a = addPoint(s, 0, -10); s = a.state;
    const b = addPoint(s, 0, 10); s = b.state;
    s = addLine(s, a.id, b.id).state;
    const r = splitArcAt(s, ha.arcId, { x: 3, y: 4 });
    expect(r.error).toBeUndefined();
    expect(findEntity(r.state, ha.arcId)).toBeUndefined();
    expect(r.affectedIds?.length).toBe(2);
    const [a1, a2] = r.affectedIds!.map(id => findEntity<ArcEntity>(r.state, id)!);
    expect(a1.radius).toBeCloseTo(5);
    expect(a2.radius).toBeCloseTo(5);
    expect(a1.centerId).toBe(a2.centerId);
    // The two pieces share the crossing point at (0, 5).
    const sharedId = [a1.startId, a1.endId].find(id => id === a2.startId || id === a2.endId);
    expect(sharedId).toBeDefined();
    const sharedPt = findPoint(r.state, sharedId!)!;
    expect(sharedPt.x).toBeCloseTo(0);
    expect(sharedPt.y).toBeCloseTo(5);
  });

  it('inherits directional constraints onto both pieces and drops dimensions', () => {
    let s = emptySketchState();
    const ha = upperHalfArc(s); s = ha.state;
    s = addConstraint(s, 'on-edge', [ha.arcId]).state;
    s = addConstraint(s, 'radius', [ha.arcId], 5).state;
    const a = addPoint(s, 0, -10); s = a.state;
    const b = addPoint(s, 0, 10); s = b.state;
    s = addLine(s, a.id, b.id).state;
    const r = splitArcAt(s, ha.arcId, { x: 3, y: 4 });
    expect(r.error).toBeUndefined();
    // Directional class (on-edge) inherits onto EVERY piece with unique ids.
    const onEdge = r.state.constraints.filter(c => c.type === 'on-edge');
    expect(onEdge.length).toBe(2);
    expect(new Set(onEdge.map(c => c.id)).size).toBe(2);
    for (const c of onEdge) {
      expect(r.affectedIds).toContain(c.targets[0].entityId);
    }
    // Dimensional constraints drop — the pieces have different sweeps.
    expect(r.state.constraints.filter(c => c.type === 'radius').length).toBe(0);
  });

  it('re-attaches passenger points to the piece that covers them', () => {
    let s = emptySketchState();
    const ha = upperHalfArc(s); s = ha.state;
    // Passenger riding the arc at 135°.
    const k = 5 * Math.SQRT1_2;
    const pass = addPoint(s, -k, k); s = pass.state;
    s = addConstraint(s, 'coincident', [pass.id, ha.arcId]).state;
    // Cutter crossing at (0, 5) — 90°.
    const a = addPoint(s, 0, -10); s = a.state;
    const b = addPoint(s, 0, 10); s = b.state;
    s = addLine(s, a.id, b.id).state;
    const r = splitArcAt(s, ha.arcId, { x: 3, y: 4 });
    expect(r.error).toBeUndefined();
    const coin = r.state.constraints.find(c =>
      c.type === 'coincident'
      && c.targets.some(t => t.entityId === pass.id)
      && c.targets.some(t => r.affectedIds!.includes(t.entityId)));
    expect(coin).toBeDefined();
    // Specifically the 90°..180° piece (starts at the crossing (0, 5)).
    const pieceId = coin!.targets.map(t => t.entityId).find(id => id !== pass.id)!;
    const piece = findEntity<ArcEntity>(r.state, pieceId)!;
    const ps = findPoint(r.state, piece.startId)!;
    expect(ps.x).toBeCloseTo(0);
    expect(ps.y).toBeCloseTo(5);
  });

  it('errors when the arc has no interior crossing', () => {
    let s = emptySketchState();
    const ha = upperHalfArc(s); s = ha.state;
    const r = splitArcAt(s, ha.arcId, { x: 3, y: 4 });
    expect(r.error).toBeDefined();
    expect(findEntity(r.state, ha.arcId)).toBeDefined();
  });
});

describe('splitCircleAt', () => {
  it('splits a circle crossed by two lines into two complementary arcs', () => {
    let s = emptySketchState();
    const c = addCircle(s, 0, 0, 5); s = c.state;
    // Two cutter lines from the middle outward: crossings at (5, 0) and (0, 5).
    const mid = addPoint(s, 0, 0); s = mid.state;
    const up = addPoint(s, 0, 10); s = up.state;
    const right = addPoint(s, 10, 0); s = right.state;
    s = addLine(s, mid.id, up.id).state;
    s = addLine(s, mid.id, right.id).state;
    // Click at 45° — between the two crossings.
    const r = splitCircleAt(s, c.id, { x: 3.5, y: 3.5 });
    expect(r.error).toBeUndefined();
    expect(findEntity(r.state, c.id)).toBeUndefined();
    expect(r.affectedIds?.length).toBe(2);
    const [wedge, rest] = r.affectedIds!.map(id => findEntity<ArcEntity>(r.state, id)!);
    expect(wedge.radius).toBeCloseTo(5);
    expect(rest.radius).toBeCloseTo(5);
    // Complementary arcs: they share BOTH endpoints (swapped) and the center.
    expect(wedge.startId).toBe(rest.endId);
    expect(wedge.endId).toBe(rest.startId);
    expect(wedge.centerId).toBe(rest.centerId);
    const center = findPoint(r.state, wedge.centerId)!;
    expect(center.x).toBeCloseTo(0);
    expect(center.y).toBeCloseTo(0);
    // Split points sit at the two crossings.
    const pA = findPoint(r.state, wedge.startId)!;
    const pB = findPoint(r.state, wedge.endId)!;
    expect(pA.x).toBeCloseTo(5);
    expect(pA.y).toBeCloseTo(0);
    expect(pB.x).toBeCloseTo(0);
    expect(pB.y).toBeCloseTo(5);
  });

  it('errors when fewer than two crossings exist', () => {
    let s = emptySketchState();
    const c = addCircle(s, 0, 0, 5); s = c.state;
    const r = splitCircleAt(s, c.id, { x: 5, y: 0 });
    expect(r.error).toBeDefined();
    expect(findEntity(r.state, c.id)).toBeDefined();
  });
});

describe('filletArcArc', () => {
  it('computeFilletArcArcGeometry: fillet center at R_i ± r from each arc center, tangent points on both curves', () => {
    const { state: s, arc1Id, arc2Id } = twoArcCorner();
    const g = computeFilletArcArcGeometry(s, arc1Id, arc2Id, 1);
    expect(g).not.toBeNull();
    // B11: pin the CORRECT tangency per side — EXTERNAL to arc1
    // (|C_F − c1| = R + r = 6), INTERNAL to arc2 (|C_F − c2| = R − r = 4)
    // — and the fillet center on the corner's interior side. The old
    // min-of-either assertion let a wrong-side/wrong-type root pass.
    const dA = Math.hypot(g!.C_F.x - 5, g!.C_F.y - 0);
    const dB = Math.hypot(g!.C_F.x - 10, g!.C_F.y - 5);
    expect(dA).toBeCloseTo(6, 6);
    expect(dB).toBeCloseTo(4, 6);
    expect(g!.C_F.x).toBeGreaterThan(10);
    expect(g!.C_F.y).toBeGreaterThan(0);
    // Tangent points lie on both the source circle and the fillet circle.
    expect(Math.hypot(g!.T_arcA.x - 5, g!.T_arcA.y - 0)).toBeCloseTo(5, 6);
    expect(Math.hypot(g!.T_arcB.x - 10, g!.T_arcB.y - 5)).toBeCloseTo(5, 6);
    expect(Math.hypot(g!.T_arcA.x - g!.C_F.x, g!.T_arcA.y - g!.C_F.y)).toBeCloseTo(1, 6);
    expect(Math.hypot(g!.T_arcB.x - g!.C_F.x, g!.T_arcB.y - g!.C_F.y)).toBeCloseTo(1, 6);
  });

  it('trims both arcs to the tangent points and inserts a tangent fillet arc', () => {
    const { state: s, arc1Id, arc2Id, vId } = twoArcCorner();
    const r = filletArcArc(s, arc1Id, arc2Id, 1);
    expect(r.error).toBeUndefined();
    expect(r.affectedIds?.length).toBeGreaterThanOrEqual(1);
    const fillet = findEntity<ArcEntity>(r.state, r.affectedIds![0])!;
    expect(fillet.kind).toBe('arc');
    expect(fillet.radius).toBeCloseTo(1);
    // Each source arc's near-V endpoint was rebound to a fresh tangent point.
    const a1 = findEntity<ArcEntity>(r.state, arc1Id)!;
    const a2 = findEntity<ArcEntity>(r.state, arc2Id)!;
    expect(a1.endId).not.toBe(vId);
    expect(a2.startId).not.toBe(vId);
    // The fillet's endpoints ARE the rebound tangent points (shared ids).
    expect(fillet.startId).toBe(a1.endId);
    expect(fillet.endId).toBe(a2.startId);
    // Tangent points still lie on the source circles.
    const t1 = findPoint(r.state, fillet.startId)!;
    const t2 = findPoint(r.state, fillet.endId)!;
    expect(Math.hypot(t1.x - 5, t1.y - 0)).toBeCloseTo(5, 6);
    expect(Math.hypot(t2.x - 10, t2.y - 5)).toBeCloseTo(5, 6);
    // Tangent constraints lock the fillet to each source arc.
    const tangents = r.state.constraints.filter(c => c.type === 'tangent');
    expect(tangents.length).toBe(2);
  });

  it('rejects arcs that do not share a corner', () => {
    let s = emptySketchState();
    const a1 = addArc(s, 0, 0, 5, 0, 0, 5, true); s = a1.state;
    const a2 = addArc(s, 20, 0, 25, 0, 20, 5, true); s = a2.state;
    expect(computeFilletArcArcGeometry(s, a1.id, a2.id, 1)).toBeNull();
    expect(filletArcArc(s, a1.id, a2.id, 1).error).toBeDefined();
  });
});

describe('fillet oversized-radius guards (B11)', () => {
  const D = Math.PI / 180;

  it('computeFilletLineArcGeometry rejects a radius whose LINE tangent point leaves the segment', () => {
    // Same 90° corner as lineArcCorner but with a SHORT line
    // (7,0)→(10,0). Radius 8 puts T_line at x≈4.75 — past the far
    // endpoint. Pre-guard this returned corrupt geometry (the line
    // reversed); now it rejects, like line-line fillet always has.
    let s = emptySketchState();
    const a = addPoint(s, 7, 0); s = a.state;
    const v = addPoint(s, 10, 0); s = v.state;
    const arcCenter = addPoint(s, 15, 0); s = arcCenter.state;
    const arcEnd = addPoint(s, 15, 5); s = arcEnd.state;
    const l = addLine(s, a.id, v.id); s = l.state;
    const arc = addArcByPoints(s, arcCenter.id, v.id, arcEnd.id, false); s = arc.state;
    expect(computeFilletLineArcGeometry(s, l.id, arc.id, 8)).toBeNull();
    expect(filletLineArc(s, l.id, arc.id, 8).error).toBeDefined();
    // A modest radius still succeeds on the same corner.
    const ok = computeFilletLineArcGeometry(s, l.id, arc.id, 1);
    expect(ok).not.toBeNull();
    expect(ok!.T_line.x).toBeGreaterThanOrEqual(7);
    expect(ok!.T_line.x).toBeLessThanOrEqual(10);
    expect(ok!.T_line.y).toBeCloseTo(0);
  });

  it('computeFilletLineArcGeometry rejects a radius whose ARC tangent point leaves the sweep', () => {
    // Full-length line, SHORT arc (30°: 180°→150° CW around (15,0)).
    // Radius 6 lands T_arc at ≈147° — outside the sweep.
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    const v = addPoint(s, 10, 0); s = v.state;
    const arcCenter = addPoint(s, 15, 0); s = arcCenter.state;
    const arcEnd = addPoint(s, 15 + 5 * Math.cos(150 * D), 5 * Math.sin(150 * D)); s = arcEnd.state;
    const l = addLine(s, a.id, v.id); s = l.state;
    const arc = addArcByPoints(s, arcCenter.id, v.id, arcEnd.id, false); s = arc.state;
    expect(computeFilletLineArcGeometry(s, l.id, arc.id, 6)).toBeNull();
    expect(filletLineArc(s, l.id, arc.id, 6).error).toBeDefined();
    // A radius whose tangent point stays inside the 30° sweep is fine.
    const ok = computeFilletLineArcGeometry(s, l.id, arc.id, 2);
    expect(ok).not.toBeNull();
    expect(Math.hypot(ok!.T_arc.x - 15, ok!.T_arc.y)).toBeCloseTo(5, 6);
  });

  it('computeFilletArcArcGeometry rejects a radius whose tangent point leaves either sweep', () => {
    // Two SHORT arcs (30° each) forming the same 90° corner at
    // V=(10,0) as twoArcCorner. Radius 2 pushes arc2's tangent point
    // to ≈−59° — outside its −90°..−60° sweep; radius 0.5 stays in.
    let s = emptySketchState();
    const start1 = addPoint(s, 5 + 5 * Math.cos(30 * D), 5 * Math.sin(30 * D)); s = start1.state;
    const v = addPoint(s, 10, 0); s = v.state;
    const c1 = addPoint(s, 5, 0); s = c1.state;
    const c2 = addPoint(s, 10, 5); s = c2.state;
    const end2 = addPoint(s, 10 + 5 * Math.cos(-60 * D), 5 + 5 * Math.sin(-60 * D)); s = end2.state;
    const arc1 = addArcByPoints(s, c1.id, start1.id, v.id, false); s = arc1.state;   // 30°→0° CW
    const arc2 = addArcByPoints(s, c2.id, v.id, end2.id, true); s = arc2.state;      // −90°→−60° CCW
    expect(computeFilletArcArcGeometry(s, arc1.id, arc2.id, 2)).toBeNull();
    expect(filletArcArc(s, arc1.id, arc2.id, 2).error).toBeDefined();
    const ok = computeFilletArcArcGeometry(s, arc1.id, arc2.id, 0.5);
    expect(ok).not.toBeNull();
    // Correct tangency types on the valid root: external to arc1,
    // internal to arc2.
    expect(Math.hypot(ok!.C_F.x - 5, ok!.C_F.y - 0)).toBeCloseTo(5.5, 6);
    expect(Math.hypot(ok!.C_F.x - 10, ok!.C_F.y - 5)).toBeCloseTo(4.5, 6);
  });
});

describe('fillet virtual sharp (B12 / REQ 896)', () => {
  it('filletLineArc pins a constrained corner point onto both surviving curves', () => {
    const built = lineArcCorner();
    let s = built.state;
    const anchor = addPoint(s, 0, 5); s = anchor.state;
    s = addConstraint(s, 'distance', [anchor.id, built.vId], 5).state;
    const r = filletLineArc(s, built.lineId, built.arcId, 1);
    expect(r.error).toBeUndefined();
    // The dim keeps the corner point alive …
    expect(findPoint(r.state, built.vId)).toBeDefined();
    // … and it is pinned at the theoretical corner: coincident onto the
    // line's carrier AND the arc's circle (their intersection = V).
    const hasCoin = (otherId: string) => r.state.constraints.some(c =>
      c.type === 'coincident'
      && c.targets.some(t => t.entityId === built.vId)
      && c.targets.some(t => t.entityId === otherId));
    expect(hasCoin(built.lineId)).toBe(true);
    expect(hasCoin(built.arcId)).toBe(true);
    // The dim still measures the corner.
    const dim = r.state.constraints.find(c => c.type === 'distance')!;
    expect(dim.targets.map(t => t.entityId)).toContain(built.vId);
  });

  it('filletArcArc pins a constrained corner point onto both source circles', () => {
    const built = twoArcCorner();
    let s = built.state;
    const anchor = addPoint(s, 0, 5); s = anchor.state;
    s = addConstraint(s, 'distance', [anchor.id, built.vId], 11).state;
    const r = filletArcArc(s, built.arc1Id, built.arc2Id, 1);
    expect(r.error).toBeUndefined();
    expect(findPoint(r.state, built.vId)).toBeDefined();
    const hasCoin = (otherId: string) => r.state.constraints.some(c =>
      c.type === 'coincident'
      && c.targets.some(t => t.entityId === built.vId)
      && c.targets.some(t => t.entityId === otherId));
    expect(hasCoin(built.arc1Id)).toBe(true);
    expect(hasCoin(built.arc2Id)).toBe(true);
  });

  it('an unconstrained corner point is still removed (no gratuitous pins)', () => {
    const built = twoArcCorner();
    const r = filletArcArc(built.state, built.arc1Id, built.arc2Id, 1);
    expect(r.error).toBeUndefined();
    expect(findPoint(r.state, built.vId)).toBeUndefined();
    expect(r.state.constraints.some(c =>
      c.targets.some(t => t.entityId === built.vId))).toBe(false);
  });
});

describe('chamferLineArc', () => {
  it('cuts the corner with a straight chamfer at the setback distance along line and arc', () => {
    const { state: s, lineId, arcId, vId } = lineArcCorner();
    const r = chamferLineArc(s, lineId, arcId, 2);
    expect(r.error).toBeUndefined();
    const lineAfter = findEntity<LineEntity>(r.state, lineId)!;
    const arcAfter = findEntity<ArcEntity>(r.state, arcId)!;
    // Line trimmed back 2 units from the corner: endpoint now at (8, 0).
    expect(lineAfter.endId).not.toBe(vId);
    const lEnd = findPoint(r.state, lineAfter.endId)!;
    expect(lEnd.x).toBeCloseTo(8);
    expect(lEnd.y).toBeCloseTo(0);
    // Arc trimmed back an ARC-LENGTH of 2 from the corner: angular walk
    // of 2/5 rad from V's angle (180°) toward the far endpoint (CW).
    expect(arcAfter.startId).not.toBe(vId);
    const aStart = findPoint(r.state, arcAfter.startId)!;
    expect(Math.hypot(aStart.x - 15, aStart.y - 0)).toBeCloseTo(5);
    expect(aStart.x).toBeCloseTo(15 - 5 * Math.cos(0.4));
    expect(aStart.y).toBeCloseTo(5 * Math.sin(0.4));
    // The chamfer cut line connects the two setback points (shared ids —
    // the same structural coupling chamferLines uses).
    expect(r.affectedIds?.length).toBe(3);
    const cut = findEntity<LineEntity>(r.state, r.affectedIds![2])!;
    expect(cut.kind).toBe('line');
    expect([cut.startId, cut.endId]).toContain(lineAfter.endId);
    expect([cut.startId, cut.endId]).toContain(arcAfter.startId);
  });

  it('errors when the distance exceeds the line length or the arc sweep', () => {
    const { state: s, lineId, arcId } = lineArcCorner();
    expect(chamferLineArc(s, lineId, arcId, 20).error).toBeDefined();
  });

  it('errors when the entities do not share a corner', () => {
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    const b = addPoint(s, 5, 0); s = b.state;
    const l = addLine(s, a.id, b.id); s = l.state;
    const arc = addArc(s, 20, 0, 25, 0, 20, 5, true); s = arc.state;
    expect(chamferLineArc(s, l.id, arc.id, 1).error).toBeDefined();
  });
});
