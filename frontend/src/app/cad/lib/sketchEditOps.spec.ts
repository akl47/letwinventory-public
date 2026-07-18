import { describe, it, expect } from 'vitest';
import {
  emptySketchState, addPoint, addLine, addCircle, addArc, addArcByPoints, addConstraint,
  addEllipseByPoints, addEllipticalArc, addSplineByPoints,
} from './store';
import {
  trimAt, extendLine, splitLineAt, mirrorEntities, offsetCurve, offsetChain, filletLines, chamferLines, jogLineAt,
  moveEntities, copyEntities, rotateEntities, scaleEntities,
  linearPatternEntities, circularPatternEntities, stretchEntities,
  findChainedEntities,
  previewTrimLine, previewTrimCircle, previewTrimArc,
} from './sketchEditOps';
import { findEntity, findPoint } from './types';
import type {
  LineEntity, ArcEntity, CircleEntity, PointEntity,
  EllipseEntity, EllipticalArcEntity, SplineEntity,
} from './types';

/**
 * Build a horizontal line from x1 to x2 at y, return state + line id +
 * endpoint ids for assertions.
 */
function horizontalLine(state = emptySketchState(), x1 = 0, x2 = 10, y = 0) {
  let s = state;
  const a = addPoint(s, x1, y); s = a.state;
  const b = addPoint(s, x2, y); s = b.state;
  const l = addLine(s, a.id, b.id); s = l.state;
  return { state: s, lineId: l.id, startId: a.id, endId: b.id };
}

function lineCount(state: ReturnType<typeof emptySketchState>) {
  return state.entities.filter(e => e.kind === 'line').length;
}

function arcCount(state: ReturnType<typeof emptySketchState>) {
  return state.entities.filter(e => e.kind === 'arc').length;
}

describe('trimAt — lines', () => {
  it('removes the segment between two crossing curves', () => {
    // Horizontal line from (0,0) to (10,0). Two vertical lines crossing at x=3 and x=7.
    let s = emptySketchState();
    const main = horizontalLine(s); s = main.state;
    const va = addPoint(s, 3, -1); s = va.state;
    const vb = addPoint(s, 3,  1); s = vb.state;
    const vline1 = addLine(s, va.id, vb.id); s = vline1.state;
    const vc = addPoint(s, 7, -1); s = vc.state;
    const vd = addPoint(s, 7,  1); s = vd.state;
    const vline2 = addLine(s, vc.id, vd.id); s = vline2.state;

    // Click at x=5 (between the two vertical lines).
    const r = trimAt(s, main.lineId, { x: 5, y: 0 });
    expect(r.error).toBeUndefined();
    // Original line is gone, replaced by two stub lines [0,3] and [7,10].
    expect(findEntity(r.state, main.lineId)).toBeUndefined();
    expect(lineCount(r.state)).toBe(4);  // 2 verticals + 2 trimmed stubs
  });

  it('removes the stub when the click is past the last intersection', () => {
    let s = emptySketchState();
    const main = horizontalLine(s); s = main.state;
    const va = addPoint(s, 3, -1); s = va.state;
    const vb = addPoint(s, 3,  1); s = vb.state;
    const vl = addLine(s, va.id, vb.id); s = vl.state;
    // Click past the only intersection (at x=8).
    const r = trimAt(s, main.lineId, { x: 8, y: 0 });
    expect(r.error).toBeUndefined();
    expect(findEntity(r.state, main.lineId)).toBeUndefined();
    // Only the [0, 3] stub remains plus the vertical line.
    expect(lineCount(r.state)).toBe(2);
  });

  it('trims construction lines and keeps the survivors construction (REQ 866)', () => {
    let s = emptySketchState();
    // Construction horizontal centerline crossed by two regular verticals.
    const a = addPoint(s, 0, 0); s = a.state;
    const b = addPoint(s, 10, 0); s = b.state;
    const main = addLine(s, a.id, b.id, { construction: true }); s = main.state;
    for (const x of [3, 7]) {
      const p1 = addPoint(s, x, -1); s = p1.state;
      const p2 = addPoint(s, x, 1); s = p2.state;
      const vl = addLine(s, p1.id, p2.id); s = vl.state;
    }
    const r = trimAt(s, main.id, { x: 5, y: 0 });
    expect(r.error).toBeUndefined();
    expect(findEntity(r.state, main.id)).toBeUndefined();
    const stubs = r.state.entities.filter(
      (e): e is LineEntity => e.kind === 'line' && e.construction === true);
    expect(stubs.length).toBe(2);
  });

  it('uses construction geometry as a trim boundary (REQ 866)', () => {
    let s = emptySketchState();
    const main = horizontalLine(s); s = main.state;
    // A construction vertical crossing at x=4 bounds the trim.
    const p1 = addPoint(s, 4, -1); s = p1.state;
    const p2 = addPoint(s, 4, 1); s = p2.state;
    const vl = addLine(s, p1.id, p2.id, { construction: true }); s = vl.state;
    const r = trimAt(s, main.lineId, { x: 8, y: 0 });
    expect(r.error).toBeUndefined();
    // The [0,4] stub survives (construction cutter bounded the span).
    expect(lineCount(r.state)).toBe(2);
  });

  it('deletes the entire line when no other curves intersect it', () => {
    let s = emptySketchState();
    const main = horizontalLine(s); s = main.state;
    const r = trimAt(s, main.lineId, { x: 5, y: 0 });
    expect(r.error).toBeUndefined();
    expect(findEntity(r.state, main.lineId)).toBeUndefined();
    expect(lineCount(r.state)).toBe(0);
  });

  it('deletes an unbounded construction line on trim (REQ 866 — no refusal)', () => {
    let s = emptySketchState();
    const main = horizontalLine(s); s = main.state;
    // Mark the line as construction.
    s = {
      ...s,
      entities: s.entities.map(e => e.id === main.lineId ? { ...e, construction: true } : e),
    };
    const r = trimAt(s, main.lineId, { x: 5, y: 0 });
    expect(r.error).toBeUndefined();
    expect(findEntity(r.state, main.lineId)).toBeUndefined();
  });

  it('trims a converted (on-edge) line — sub-segment survives and inherits the link', () => {
    // Mirrors the user's scenario: a converted body edge running along
    // y=0 plus a sketched vertical line crossing it at x=5. Clicking
    // trim on the right portion should remove that portion and leave
    // a sub-segment from (0,0) to (5,0). The sub-segment must keep
    // its on-edge link to the source body edge — SolidWorks parity.
    let s = emptySketchState();
    const main = horizontalLine(s); s = main.state;
    // Tag main with an on-edge constraint linking to a body edge.
    s = addConstraint(s, 'on-edge', [main.lineId]).state;
    // Set externalRef on the on-edge constraint (addConstraint helper
    // doesn't take it, so we patch it in directly).
    const oeId = s.constraints[s.constraints.length - 1].id;
    s = {
      ...s,
      constraints: s.constraints.map(c =>
        c.id === oeId ? { ...c, externalRef: { featureId: 'f1', edgeId: 'f1/e0' } } : c,
      ),
    };
    // Crossing sketched line at x=5.
    const va = addPoint(s, 5, -1); s = va.state;
    const vb = addPoint(s, 5,  1); s = vb.state;
    const vl = addLine(s, va.id, vb.id); s = vl.state;
    // Click on the RIGHT portion (x=7), expecting the (0..5) sub-segment to remain.
    const r = trimAt(s, main.lineId, { x: 7, y: 0 });
    expect(r.error).toBeUndefined();
    expect(findEntity(r.state, main.lineId)).toBeUndefined();
    // Sub-segment must exist — 2 non-construction lines after trim:
    // the vertical sketched cutter + the sub-segment.
    expect(lineCount(r.state)).toBe(2);
    // SolidWorks parity: the on-edge link survives, retargeted to the
    // new sub-segment. externalRef carries the same source edge id.
    const remainingOnEdge = r.state.constraints.filter(c => c.type === 'on-edge');
    expect(remainingOnEdge.length).toBe(1);
    expect(remainingOnEdge[0].externalRef).toEqual({ featureId: 'f1', edgeId: 'f1/e0' });
    // The on-edge constraint now targets the new sub-segment (a line
    // that is NOT the cutter `vl` and NOT the deleted `main`).
    const targetId = remainingOnEdge[0].targets[0].entityId;
    expect(targetId).not.toBe(main.lineId);
    expect(targetId).not.toBe(vl.id);
    const target = findEntity(r.state, targetId);
    expect(target?.kind).toBe('line');
  });

  it('mid-segment trim of an on-edge line — BOTH stubs inherit the link', () => {
    // Two crossing sketched lines cut the converted line at x=3 and x=7.
    // Clicking between them removes the middle (3..7) and leaves two
    // stubs (0..3) and (7..10). Each stub must inherit the on-edge
    // link to the same source body edge (with unique constraint ids).
    let s = emptySketchState();
    const main = horizontalLine(s); s = main.state;
    s = addConstraint(s, 'on-edge', [main.lineId]).state;
    const oeId = s.constraints[s.constraints.length - 1].id;
    s = {
      ...s,
      constraints: s.constraints.map(c =>
        c.id === oeId ? { ...c, externalRef: { featureId: 'f1', edgeId: 'f1/e0' } } : c,
      ),
    };
    const va = addPoint(s, 3, -1); s = va.state;
    const vb = addPoint(s, 3,  1); s = vb.state;
    s = addLine(s, va.id, vb.id).state;
    const vc = addPoint(s, 7, -1); s = vc.state;
    const vd = addPoint(s, 7,  1); s = vd.state;
    s = addLine(s, vc.id, vd.id).state;
    const r = trimAt(s, main.lineId, { x: 5, y: 0 });
    expect(r.error).toBeUndefined();
    const onEdge = r.state.constraints.filter(c => c.type === 'on-edge');
    expect(onEdge.length).toBe(2);
    expect(new Set(onEdge.map(c => c.id)).size).toBe(2);  // unique ids
    for (const c of onEdge) {
      expect(c.externalRef).toEqual({ featureId: 'f1', edgeId: 'f1/e0' });
    }
  });

  it('does not synthesize horizontal/vertical on a coincidentally axis-aligned line (B15-22 ride-along)', () => {
    // The line happens to be horizontal but carries NO orientation
    // constraint — trim must not invent one (SolidWorks doesn't).
    let s = emptySketchState();
    const main = horizontalLine(s); s = main.state;
    for (const x of [3, 7]) {
      const p1 = addPoint(s, x, -1); s = p1.state;
      const p2 = addPoint(s, x, 1); s = p2.state;
      s = addLine(s, p1.id, p2.id).state;
    }
    const r = trimAt(s, main.lineId, { x: 5, y: 0 });
    expect(r.error).toBeUndefined();
    expect(lineCount(r.state)).toBe(4);
    const orient = r.state.constraints.filter(
      c => c.type === 'horizontal' || c.type === 'vertical');
    expect(orient.length).toBe(0);
  });

  it('still inherits an EXISTING horizontal constraint onto every kept sub-segment', () => {
    let s = emptySketchState();
    const main = horizontalLine(s); s = main.state;
    s = addConstraint(s, 'horizontal', [main.lineId]).state;
    for (const x of [3, 7]) {
      const p1 = addPoint(s, x, -1); s = p1.state;
      const p2 = addPoint(s, x, 1); s = p2.state;
      s = addLine(s, p1.id, p2.id).state;
    }
    const r = trimAt(s, main.lineId, { x: 5, y: 0 });
    expect(r.error).toBeUndefined();
    const horiz = r.state.constraints.filter(c => c.type === 'horizontal');
    expect(horiz.length).toBe(2);
    expect(new Set(horiz.map(c => c.id)).size).toBe(2);
    for (const c of horiz) {
      expect(r.affectedIds).toContain(c.targets[0].entityId);
    }
  });
});

describe('trimAt — circles', () => {
  it('produces an arc when a circle is crossed by a line', () => {
    // Circle radius 5 at origin, vertical line x=0 from y=-1..1 (chord).
    // The chord enters the circle at (0, 5) and (0, -5).
    let s = emptySketchState();
    const c = addCircle(s, 0, 0, 5); s = c.state;
    const a = addPoint(s, 0, -10); s = a.state;
    const b = addPoint(s, 0,  10); s = b.state;
    const l = addLine(s, a.id, b.id); s = l.state;
    // Click on the right side of the circle at (5, 0).
    const r = trimAt(s, c.id, { x: 5, y: 0 });
    expect(r.error).toBeUndefined();
    expect(findEntity(r.state, c.id)).toBeUndefined();
    expect(arcCount(r.state)).toBe(1);
  });

  it('deletes the circle if no curve crosses it', () => {
    let s = emptySketchState();
    const c = addCircle(s, 0, 0, 5); s = c.state;
    const r = trimAt(s, c.id, { x: 5, y: 0 });
    expect(r.error).toBeUndefined();
    expect(findEntity(r.state, c.id)).toBeUndefined();
  });

  it('B8: re-attaches a passenger in the KEPT span to the replacement arc; radius dim transfers', () => {
    // Circle r=5 cut by a vertical line (crossings at 90° / 270°); a
    // passenger point rides the circle at 170° via coincident. Clicking
    // at 0° removes the right wedge (−90°..90°): the passenger sits in
    // the kept span (90°..270°) and must follow onto the new arc. The
    // radius dim ALSO transfers — it isn't sweep-dependent (the kept arc
    // has the same radius); only sweep-dependent dims drop.
    let s = emptySketchState();
    const c = addCircle(s, 0, 0, 5); s = c.state;
    const ang = (170 * Math.PI) / 180;
    const pass = addPoint(s, 5 * Math.cos(ang), 5 * Math.sin(ang)); s = pass.state;
    s = addConstraint(s, 'coincident', [pass.id, c.id]).state;
    s = addConstraint(s, 'radius', [c.id], 5).state;
    const a = addPoint(s, 0, -10); s = a.state;
    const b = addPoint(s, 0,  10); s = b.state;
    s = addLine(s, a.id, b.id).state;
    const r = trimAt(s, c.id, { x: 5, y: 0 });
    expect(r.error).toBeUndefined();
    expect(r.affectedIds && r.affectedIds.length).toBe(1);
    const newArcId = r.affectedIds![0];
    // No constraint still references the deleted circle.
    expect(r.state.constraints.some(con =>
      con.targets.some(t => t.entityId === c.id))).toBe(false);
    // Passenger re-attached to the kept arc.
    const coinRef = r.state.constraints.find(con =>
      con.type === 'coincident'
      && con.targets.some(t => t.entityId === pass.id)
      && con.targets.some(t => t.entityId === newArcId));
    expect(coinRef).toBeDefined();
    // Radius dim transferred onto the kept arc (not dropped, not duplicated).
    const radiusDims = r.state.constraints.filter(con => con.type === 'radius');
    expect(radiusDims).toHaveLength(1);
    expect(radiusDims[0].targets[0].entityId).toBe(newArcId);
    expect(radiusDims[0].value).toBe(5);
  });

  it('diameter dim transfers when a circle is trimmed to an arc', () => {
    let s = emptySketchState();
    const c = addCircle(s, 0, 0, 5); s = c.state;
    s = addConstraint(s, 'diameter', [c.id], 10).state;
    const a = addPoint(s, 0, -10); s = a.state;
    const b = addPoint(s, 0,  10); s = b.state;
    s = addLine(s, a.id, b.id).state;
    const r = trimAt(s, c.id, { x: 5, y: 0 });
    expect(r.error).toBeUndefined();
    const dims = r.state.constraints.filter(con => con.type === 'diameter');
    expect(dims).toHaveLength(1);
    expect(dims[0].targets[0].entityId).toBe(r.affectedIds![0]);
  });

  it('radius dim lands on exactly ONE kept piece when an arc trim splits it in two', () => {
    // Half-circle arc (r=5, (5,0)→(−5,0) CCW) with a radius dim, cut by
    // verticals at ±45° (x = ±5·cos45°). Clicking the top (90°) removes
    // the middle span, leaving two kept pieces.
    let s = emptySketchState();
    const arc = addArc(s, 0, 0, 5, 0, -5, 0, true); s = arc.state;
    s = addConstraint(s, 'radius', [arc.id], 5).state;
    const mk = (x: number) => {
      const p1 = addPoint(s, x, 0); s = p1.state;
      const p2 = addPoint(s, x, 10); s = p2.state;
      s = addLine(s, p1.id, p2.id).state;
    };
    mk(-5 * Math.cos(Math.PI / 4));
    mk(5 * Math.cos(Math.PI / 4));
    const r = trimAt(s, arc.id, { x: 0, y: 5 });
    expect(r.error).toBeUndefined();
    expect(r.affectedIds!.length).toBe(2);
    const dims = r.state.constraints.filter(con => con.type === 'radius');
    expect(dims).toHaveLength(1);
    expect(r.affectedIds).toContain(dims[0].targets[0].entityId);
  });

  it('B8: releases a passenger whose location falls in the REMOVED span', () => {
    // Passenger rides at 10°, slightly off the circumference (beyond
    // the cut-marker tolerance) so it acts as a pure passenger, not a
    // cut boundary. Clicking at 0° removes −90°..90°, which covers the
    // passenger → its coincident was genuinely cut away and is
    // released (same as splitLineKeepingOnly's removed-middle rule).
    // The old code welded it onto the kept arc, snapping it ~100° on
    // the next solve.
    let s = emptySketchState();
    const c = addCircle(s, 0, 0, 5); s = c.state;
    const ang = (10 * Math.PI) / 180;
    const pass = addPoint(s, 5.01 * Math.cos(ang), 5.01 * Math.sin(ang)); s = pass.state;
    s = addConstraint(s, 'coincident', [pass.id, c.id]).state;
    const a = addPoint(s, 0, -10); s = a.state;
    const b = addPoint(s, 0,  10); s = b.state;
    s = addLine(s, a.id, b.id).state;
    const r = trimAt(s, c.id, { x: 5, y: 0 });
    expect(r.error).toBeUndefined();
    // Passenger point survives, but its coincident is gone.
    expect(findEntity(r.state, pass.id)).toBeDefined();
    expect(r.state.constraints.some(con =>
      con.targets.some(t => t.entityId === pass.id))).toBe(false);
  });

  it('B9: a constrained point at the cut becomes the sub-arc endpoint (weld by id, not by rewired coincident)', () => {
    let s = emptySketchState();
    // Half-circle from (5,0) → (-5,0) above the x-axis.
    const a = addArc(s, 0, 0, 5, 0, -5, 0, true); s = a.state;
    const onArc = addPoint(s, 0, 5); s = onArc.state;
    s = addConstraint(s, 'coincident', [onArc.id, a.id]).state;
    // Vertical cut line at x=0 — crosses the arc at (0, 5), the same
    // spot as the constrained point (T-junction double count → deduped).
    const pA = addPoint(s, 0, -10); s = pA.state;
    const pB = addPoint(s, 0,  10); s = pB.state;
    s = addLine(s, pA.id, pB.id).state;
    // Click on the right half of the arc — keeps the left half.
    const r = trimAt(s, a.id, { x: 3, y: 4 });
    expect(r.error).toBeUndefined();
    expect((r.affectedIds || []).length).toBe(1);
    const piece = findEntity<ArcEntity>(r.state, r.affectedIds![0])!;
    // The on-curve point is REUSED as the kept piece's start (90°..180°).
    expect(piece.startId).toBe(onArc.id);
    // Nothing references the deleted arc anymore.
    expect(r.state.constraints.some(con =>
      con.targets.some(t => t.entityId === a.id))).toBe(false);
  });

  it('B9: another circle\'s center on the circumference is NOT a trim boundary (vesica case)', () => {
    // Circles A(0,0,r5) and B(5,0,r5): B's center sits exactly ON A's
    // circumference. Trimming A inside the lens must remove the FULL
    // lens span (±60°) — B's center is neither a cut boundary nor a
    // weld candidate for the new arc's endpoints.
    let s = emptySketchState();
    const cA = addCircle(s, 0, 0, 5); s = cA.state;
    const cB = addCircle(s, 5, 0, 5); s = cB.state;
    const bCenterId = findEntity<CircleEntity>(s, cB.id)!.centerId;
    const ang = (10 * Math.PI) / 180;
    const r = trimAt(s, cA.id, { x: 5 * Math.cos(ang), y: 5 * Math.sin(ang) });
    expect(r.error).toBeUndefined();
    const arc = findEntity<ArcEntity>(r.state, r.affectedIds![0])!;
    expect(arc.startId).not.toBe(bCenterId);
    expect(arc.endId).not.toBe(bCenterId);
    // Endpoints at the circle-circle intersections (2.5, ±5·sin 60°).
    const sp = findPoint(r.state, arc.startId)!;
    const ep = findPoint(r.state, arc.endId)!;
    expect(sp.x).toBeCloseTo(2.5);
    expect(Math.abs(sp.y)).toBeCloseTo(5 * Math.sin(Math.PI / 3));
    expect(ep.x).toBeCloseTo(2.5);
    expect(Math.abs(ep.y)).toBeCloseTo(5 * Math.sin(Math.PI / 3));
    // B keeps its center.
    expect(findEntity<CircleEntity>(r.state, cB.id)!.centerId).toBe(bCenterId);
  });

  it('B9: a T-junction counts as ONE boundary — the circle is deleted, not cut into a bogus arc', () => {
    // A line ENDING on the circle used to double-count (vertex point +
    // curve touch at the same angle), defeating the "< 2 boundaries"
    // guard and minting a degenerate arc.
    let s = emptySketchState();
    const c = addCircle(s, 0, 0, 5); s = c.state;
    const a = addPoint(s, 5, 0); s = a.state;   // exactly on the circle
    const b = addPoint(s, 10, 0); s = b.state;
    s = addLine(s, a.id, b.id).state;
    const r = trimAt(s, c.id, { x: -5, y: 0 });
    expect(r.error).toBeUndefined();
    expect(findEntity(r.state, c.id)).toBeUndefined();
    expect(arcCount(r.state)).toBe(0);
  });

  it('preserves the original center point id so center-anchored constraints survive', () => {
    let s = emptySketchState();
    const c = addCircle(s, 0, 0, 5); s = c.state;
    const circ = findEntity(s, c.id) as any;
    const originalCenterId = circ.centerId as string;
    // Fix the center — exactly the kind of constraint a trim used to
    // silently drop because the old center point got cascaded out.
    s = addConstraint(s, 'fixed', [originalCenterId]).state;
    const a = addPoint(s, 0, -10); s = a.state;
    const b = addPoint(s, 0,  10); s = b.state;
    s = addLine(s, a.id, b.id).state;
    const r = trimAt(s, c.id, { x: 5, y: 0 });
    expect(r.error).toBeUndefined();
    // Center point and its `fixed` constraint both survive.
    expect(findEntity(r.state, originalCenterId)).toBeDefined();
    const fixedCon = r.state.constraints.find(con => con.type === 'fixed');
    expect(fixedCon?.targets[0].entityId).toBe(originalCenterId);
    // And the new arc uses that same center.
    const newArc = findEntity(r.state, r.affectedIds![0]) as any;
    expect(newArc.centerId).toBe(originalCenterId);
  });
});

describe('trimAt — options (trim tool sidebar)', () => {
  /** Horizontal solid line crossed by two verticals at x=3 and x=7. */
  function crossedLine() {
    let s = emptySketchState();
    const main = horizontalLine(s); s = main.state;
    const va = addPoint(s, 3, -1); s = va.state;
    const vb = addPoint(s, 3,  1); s = vb.state;
    const v1 = addLine(s, va.id, vb.id); s = v1.state;
    const vc = addPoint(s, 7, -1); s = vc.state;
    const vd = addPoint(s, 7,  1); s = vd.state;
    const v2 = addLine(s, vc.id, vd.id); s = v2.state;
    return { state: s, main, v1: v1.id, v2: v2.id };
  }

  it('keepAsConstruction: the removed middle segment survives as a construction line', () => {
    const { state: s, main } = crossedLine();
    const r = trimAt(s, main.lineId, { x: 5, y: 0 }, { keepAsConstruction: true });
    expect(r.error).toBeUndefined();
    // 2 verticals + 2 kept stubs + 1 construction remnant.
    expect(lineCount(r.state)).toBe(5);
    const remnants = r.state.entities.filter(e => e.kind === 'line' && e.construction);
    expect(remnants).toHaveLength(1);
    // The remnant spans the removed range [3,7] and REUSES the kept
    // stubs' cut points (structurally attached, no duplicate points).
    const rem = remnants[0] as LineEntity;
    const pa = findPoint(r.state, rem.startId)!;
    const pb = findPoint(r.state, rem.endId)!;
    expect([pa.x, pb.x].sort((x, y) => x - y)).toEqual([3, 7]);
    const solidStubs = r.state.entities.filter(e =>
      e.kind === 'line' && !e.construction && e.id !== main.lineId) as LineEntity[];
    const stubEndIds = new Set(solidStubs.flatMap(l => [l.startId, l.endId]));
    expect(stubEndIds.has(rem.startId)).toBe(true);
    expect(stubEndIds.has(rem.endId)).toBe(true);
  });

  it('keepAsConstruction: a no-intersection trim converts the whole line instead of deleting', () => {
    let s = emptySketchState();
    const main = horizontalLine(s); s = main.state;
    const r = trimAt(s, main.lineId, { x: 5, y: 0 }, { keepAsConstruction: true });
    expect(r.error).toBeUndefined();
    const line = findEntity<LineEntity>(r.state, main.lineId);
    expect(line).toBeDefined();
    expect(line!.construction).toBe(true);
  });

  it('keepAsConstruction: an already-construction source still deletes (conversion would no-op)', () => {
    let s = emptySketchState();
    const main = horizontalLine(s); s = main.state;
    s = { ...s, entities: s.entities.map(e => e.id === main.lineId ? { ...e, construction: true } : e) };
    const r = trimAt(s, main.lineId, { x: 5, y: 0 }, { keepAsConstruction: true });
    expect(r.error).toBeUndefined();
    expect(findEntity(r.state, main.lineId)).toBeUndefined();
  });

  it('keepAsConstruction: circle trim keeps the removed wedge as a construction arc', () => {
    let s = emptySketchState();
    const c = addCircle(s, 0, 0, 5); s = c.state;
    const a = addPoint(s, 0, -10); s = a.state;
    const b = addPoint(s, 0,  10); s = b.state;
    const l = addLine(s, a.id, b.id); s = l.state;
    const r = trimAt(s, c.id, { x: 5, y: 0 }, { keepAsConstruction: true });
    expect(r.error).toBeUndefined();
    const arcs = r.state.entities.filter(e => e.kind === 'arc') as ArcEntity[];
    expect(arcs).toHaveLength(2);
    const kept = arcs.find(x => !x.construction)!;
    const remnant = arcs.find(x => x.construction)!;
    expect(kept).toBeDefined();
    expect(remnant).toBeDefined();
    // The remnant shares BOTH endpoints with the kept arc (welded at the cuts).
    expect(new Set([kept.startId, kept.endId])).toEqual(new Set([remnant.startId, remnant.endId]));
  });

  it('ignoreConstruction: a construction curve no longer bounds the trim', () => {
    // Middle click between a construction vertical (x=3) and a solid one
    // (x=7): with the option ON the construction line is invisible to the
    // trim, so the removed span extends from the line START to x=7.
    const { state: s0, main, v1 } = crossedLine();
    const s = { ...s0, entities: s0.entities.map(e => e.id === v1 ? { ...e, construction: true } : e) };
    const r = trimAt(s, main.lineId, { x: 5, y: 0 }, { ignoreConstruction: true });
    expect(r.error).toBeUndefined();
    // The only horizontal survivor spans [7, 10] — the whole left side
    // (start..7) was removed because x=3 didn't count as a boundary.
    const horiz = (r.state.entities.filter(e => e.kind === 'line') as LineEntity[]).filter(l => {
      const p0 = findPoint(r.state, l.startId)!;
      const p1 = findPoint(r.state, l.endId)!;
      return Math.abs(p0.y - p1.y) < 1e-9;
    });
    expect(horiz).toHaveLength(1);
    const hp0 = findPoint(r.state, horiz[0].startId)!;
    const hp1 = findPoint(r.state, horiz[0].endId)!;
    expect(Math.min(hp0.x, hp1.x)).toBeCloseTo(7, 9);
    expect(Math.max(hp0.x, hp1.x)).toBeCloseTo(10, 9);
  });

  it('ignoreConstruction: the hover preview matches the click result', () => {
    const { state: s0, main, v1 } = crossedLine();
    const s = { ...s0, entities: s0.entities.map(e => e.id === v1 ? { ...e, construction: true } : e) };
    const withOpt = previewTrimLine(s, main.lineId, { x: 5, y: 0 }, { ignoreConstruction: true })!;
    const without = previewTrimLine(s, main.lineId, { x: 5, y: 0 })!;
    // Without the option the preview stops at the construction vertical (x=3);
    // with it, the span reaches the line start (x=0).
    expect(Math.min(without.start.x, without.end.x)).toBeCloseTo(3, 9);
    expect(Math.min(withOpt.start.x, withOpt.end.x)).toBeCloseTo(0, 9);
    expect(Math.max(withOpt.start.x, withOpt.end.x)).toBeCloseTo(7, 9);
  });
});

describe('trimAt — tangency counts as a trim boundary', () => {
  // A tangent curve TOUCHES without crossing: the exact intersection
  // discriminant sits at ~0 and floating point can land it on the "miss"
  // side, silently dropping the tangency as a stop. All fixtures nudge
  // the geometry 1e-8 to the miss side to pin the flaky case.

  it('slot construction: circle bounded only by two tangent lines trims to an arc', () => {
    let s = emptySketchState();
    const c = addCircle(s, 0, 0, 5); s = c.state;
    const mkH = (y: number) => {
      const p1 = addPoint(s, -8, y); s = p1.state;
      const p2 = addPoint(s, 8, y); s = p2.state;
      s = addLine(s, p1.id, p2.id).state;
    };
    mkH(5 + 1e-8); mkH(-(5 + 1e-8));
    const r = trimAt(s, c.id, { x: 5, y: 0 });
    expect(r.error).toBeUndefined();
    // Previously: zero boundaries found → whole circle deleted.
    expect(findEntity(r.state, c.id)).toBeUndefined();
    expect(arcCount(r.state)).toBe(1);
  });

  it('a line trims at its tangency with a circle', () => {
    let s = emptySketchState();
    const c = addCircle(s, 2, 2 + 1e-8, 2); s = c.state;  // tangent to y=0 at (2,0)
    const a = addPoint(s, 0, 0); s = a.state;
    const b = addPoint(s, 10, 0); s = b.state;
    const main = addLine(s, a.id, b.id); s = main.state;
    const r = trimAt(s, main.id, { x: 6, y: 0 });
    expect(r.error).toBeUndefined();
    const lines = r.state.entities.filter(e => e.kind === 'line') as LineEntity[];
    expect(lines).toHaveLength(1);
    const p0 = findPoint(r.state, lines[0].startId)!;
    const p1 = findPoint(r.state, lines[0].endId)!;
    expect(Math.max(p0.x, p1.x)).toBeCloseTo(2, 6);  // stops at the tangency
  });

  it('an arc trims at a tangency with another circle (external tangent)', () => {
    let s = emptySketchState();
    const c1 = addCircle(s, 0, 0, 5); s = c1.state;
    const c2 = addCircle(s, 8 + 1e-8, 0, 3); s = c2.state;  // touches at (5, 0)
    const va = addPoint(s, -2, -10); s = va.state;
    const vb = addPoint(s, -2, 10); s = vb.state;
    s = addLine(s, va.id, vb.id).state;
    const r = trimAt(s, c1.id, { x: 3, y: 4 });
    expect(r.error).toBeUndefined();
    expect(arcCount(r.state)).toBe(1);
  });

  it('does NOT invent a boundary from a clearly-separated curve', () => {
    let s = emptySketchState();
    const c = addCircle(s, 0, 0, 5); s = c.state;
    const p1 = addPoint(s, -8, 5.5); s = p1.state;  // 0.5 above — not tangent
    const p2 = addPoint(s, 8, 5.5); s = p2.state;
    s = addLine(s, p1.id, p2.id).state;
    const r = trimAt(s, c.id, { x: 5, y: 0 });
    expect(r.error).toBeUndefined();
    expect(findEntity(r.state, c.id)).toBeUndefined();  // whole circle removed
    expect(arcCount(r.state)).toBe(0);
  });
});

describe('trimAt — constraint preservation', () => {
  it('endpoint constraints survive a middle trim (endpoints are reused, not recreated)', () => {
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    const b = addPoint(s, 10, 0); s = b.state;
    const main = addLine(s, a.id, b.id); s = main.state;
    s = addConstraint(s, 'fixed', [a.id]).state;
    s = addConstraint(s, 'distance', [a.id, b.id], 10).state;
    const mk = (x: number) => {
      const p1 = addPoint(s, x, -1); s = p1.state;
      const p2 = addPoint(s, x, 1); s = p2.state;
      s = addLine(s, p1.id, p2.id).state;
    };
    mk(3); mk(7);
    const r = trimAt(s, main.id, { x: 5, y: 0 });
    expect(r.error).toBeUndefined();
    // The original endpoints survive with identity intact…
    expect(findEntity(r.state, a.id)).toBeDefined();
    expect(findEntity(r.state, b.id)).toBeDefined();
    // …and so do the constraints on them.
    expect(r.state.constraints.some(c => c.type === 'fixed' && c.targets[0].entityId === a.id)).toBe(true);
    expect(r.state.constraints.some(c => c.type === 'distance')).toBe(true);
  });

  it('an endpoint whose whole side was trimmed away still cascades (SW behavior)', () => {
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    const b = addPoint(s, 10, 0); s = b.state;
    const main = addLine(s, a.id, b.id); s = main.state;
    s = addConstraint(s, 'fixed', [a.id]).state;
    const p1 = addPoint(s, 3, -1); s = p1.state;
    const p2 = addPoint(s, 3, 1); s = p2.state;
    s = addLine(s, p1.id, p2.id).state;
    // Click left of the only cutter → the [0..3] side (with `a`) is removed.
    const r = trimAt(s, main.id, { x: 1, y: 0 });
    expect(r.error).toBeUndefined();
    expect(findEntity(r.state, a.id)).toBeUndefined();
    expect(r.state.constraints.some(c => c.type === 'fixed')).toBe(false);
  });

  it('tangent survives a line trim, re-attached to the piece nearest the tangency', () => {
    let s = emptySketchState();
    const c = addCircle(s, 2, 2, 2); s = c.state;  // tangent to y=0 at (2,0)
    const a = addPoint(s, 0, 0); s = a.state;
    const b = addPoint(s, 10, 0); s = b.state;
    const main = addLine(s, a.id, b.id); s = main.state;
    s = addConstraint(s, 'tangent', [main.id, c.id]).state;
    const p1 = addPoint(s, 6, -1); s = p1.state;
    const p2 = addPoint(s, 6, 1); s = p2.state;
    s = addLine(s, p1.id, p2.id).state;
    // Remove [6..10]; the kept [0..6] piece contains the tangency at x=2.
    const r = trimAt(s, main.id, { x: 8, y: 0 });
    expect(r.error).toBeUndefined();
    const tangents = r.state.constraints.filter(x => x.type === 'tangent');
    expect(tangents).toHaveLength(1);
    const lineTarget = tangents[0].targets.map(t => t.entityId).find(id => id !== c.id)!;
    const kept = findEntity<LineEntity>(r.state, lineTarget)!;
    const k0 = findPoint(r.state, kept.startId)!;
    const k1 = findPoint(r.state, kept.endId)!;
    expect(Math.min(k0.x, k1.x)).toBeCloseTo(0, 6);
    expect(Math.max(k0.x, k1.x)).toBeCloseTo(6, 6);
  });

  it('tangent and concentric survive a circle trim onto the kept arc', () => {
    let s = emptySketchState();
    const c1 = addCircle(s, 0, 0, 5); s = c1.state;
    const ta = addPoint(s, -3, 5); s = ta.state;
    const tb = addPoint(s, 3, 5); s = tb.state;
    const tl = addLine(s, ta.id, tb.id); s = tl.state;
    s = addConstraint(s, 'tangent', [c1.id, tl.id]).state;
    const c2 = addCircle(s, 0.5, 0, 8); s = c2.state;
    s = addConstraint(s, 'concentric', [c1.id, c2.id]).state;
    const va = addPoint(s, 0, -10); s = va.state;
    const vb = addPoint(s, 0, 10); s = vb.state;
    s = addLine(s, va.id, vb.id).state;
    const r = trimAt(s, c1.id, { x: 5, y: 0 });
    expect(r.error).toBeUndefined();
    const arcId = r.affectedIds![0];
    const tangents = r.state.constraints.filter(x => x.type === 'tangent');
    expect(tangents).toHaveLength(1);
    expect(tangents[0].targets.some(t => t.entityId === arcId)).toBe(true);
    const conc = r.state.constraints.filter(x => x.type === 'concentric');
    expect(conc).toHaveLength(1);
    expect(conc[0].targets.some(t => t.entityId === arcId)).toBe(true);
  });

  it('arc trim keeps the surviving original endpoint and its constraints', () => {
    let s = emptySketchState();
    const arc = addArc(s, 0, 0, 5, 0, -5, 0, true); s = arc.state;
    const arcEnt = findEntity<ArcEntity>(s, arc.id)!;
    s = addConstraint(s, 'fixed', [arcEnt.startId]).state;
    const p1 = addPoint(s, 0, 1); s = p1.state;
    const p2 = addPoint(s, 0, 10); s = p2.state;
    s = addLine(s, p1.id, p2.id).state;
    // Click at ~137° → removes [90°..180°], keeps [0°..90°] (start side).
    const r = trimAt(s, arc.id, { x: 5 * Math.cos(2.4), y: 5 * Math.sin(2.4) });
    expect(r.error).toBeUndefined();
    expect(findEntity(r.state, arcEnt.startId)).toBeDefined();
    expect(r.state.constraints.some(c => c.type === 'fixed' && c.targets[0].entityId === arcEnt.startId)).toBe(true);
  });
});

describe('extendLine', () => {
  it('extends the end nearer the click to the closest boundary line', () => {
    // Short horizontal line 0..5. Vertical line at x=8.
    let s = emptySketchState();
    const main = horizontalLine(s, 0, 5, 0); s = main.state;
    const va = addPoint(s, 8, -1); s = va.state;
    const vb = addPoint(s, 8,  1); s = vb.state;
    const vl = addLine(s, va.id, vb.id); s = vl.state;
    // Click near the right end of the main line.
    const r = extendLine(s, main.lineId, { x: 4.9, y: 0 });
    expect(r.error).toBeUndefined();
    const endPt = findPoint(r.state, main.endId)!;
    expect(endPt.x).toBeCloseTo(8);
    expect(endPt.y).toBeCloseTo(0);
  });

  it('extends backward when click is near the start', () => {
    let s = emptySketchState();
    const main = horizontalLine(s, 0, 5, 0); s = main.state;
    const va = addPoint(s, -3, -1); s = va.state;
    const vb = addPoint(s, -3,  1); s = vb.state;
    const vl = addLine(s, va.id, vb.id); s = vl.state;
    const r = extendLine(s, main.lineId, { x: 0.1, y: 0 });
    expect(r.error).toBeUndefined();
    const startPt = findPoint(r.state, main.startId)!;
    expect(startPt.x).toBeCloseTo(-3);
  });

  it('errors when no boundary is present', () => {
    let s = emptySketchState();
    const main = horizontalLine(s, 0, 5, 0); s = main.state;
    const r = extendLine(s, main.lineId, { x: 5, y: 0 });
    expect(r.error).toBe('No boundary to extend to');
  });

  it('extends to a circle', () => {
    let s = emptySketchState();
    const main = horizontalLine(s, 0, 5, 0); s = main.state;
    // Circle centered at (10, 0) radius 1 — crossed by the line's extension at x=9 and x=11.
    const c = addCircle(s, 10, 0, 1); s = c.state;
    const r = extendLine(s, main.lineId, { x: 4.9, y: 0 });
    expect(r.error).toBeUndefined();
    const endPt = findPoint(r.state, main.endId)!;
    expect(endPt.x).toBeCloseTo(9);  // nearest of the two circle hits.
  });

  it('does not drag adjacent geometry when the endpoint is shared', () => {
    // L-shape: horizontal line (0,0)→(5,0) and vertical line sharing its end
    // point at (5,0)→(5,5). Boundary at x=10 (vertical line we'll extend to).
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    const corner = addPoint(s, 5, 0); s = corner.state;
    const c = addPoint(s, 5, 5); s = c.state;
    const horiz = addLine(s, a.id, corner.id); s = horiz.state;
    const vert = addLine(s, corner.id, c.id); s = vert.state;
    // Boundary the horizontal line will extend to: vertical line at x=10.
    const ba = addPoint(s, 10, -1); s = ba.state;
    const bb = addPoint(s, 10, 1); s = bb.state;
    const boundary = addLine(s, ba.id, bb.id); s = boundary.state;

    const r = extendLine(s, horiz.id, { x: 4.9, y: 0 });
    expect(r.error).toBeUndefined();
    // The corner point at (5,0) — shared with the vertical line — must NOT
    // have moved. Otherwise the L collapses into a Z.
    const cornerAfter = findPoint(r.state, corner.id)!;
    expect(cornerAfter.x).toBeCloseTo(5);
    expect(cornerAfter.y).toBeCloseTo(0);
    // The extended line now ends at (10, 0) via a fresh point id.
    const horizAfter = findEntity<LineEntity>(r.state, horiz.id)!;
    expect(horizAfter.endId).not.toBe(corner.id);
    const newEnd = findPoint(r.state, horizAfter.endId)!;
    expect(newEnd.x).toBeCloseTo(10);
    expect(newEnd.y).toBeCloseTo(0);
    // Vertical line still anchors at the original corner.
    const vertAfter = findEntity<LineEntity>(r.state, vert.id)!;
    expect(vertAfter.startId).toBe(corner.id);
    // A coincident constraint was added so the corner stays collinear
    // with the extended line if anyone edits later. (Coincident is the
    // unified "this is on that" type — solver dispatches on target kinds.)
    const onLine = r.state.constraints.find(
      c => c.type === 'coincident'
        && c.targets.some(t => t.entityId === corner.id)
        && c.targets.some(t => t.entityId === horiz.id),
    );
    expect(onLine).toBeDefined();
  });

  it('adds a coincident-to-curve constraint when extending to a circle', () => {
    let s = emptySketchState();
    const main = horizontalLine(s, 0, 5, 0); s = main.state;
    const c = addCircle(s, 10, 0, 1); s = c.state;
    const r = extendLine(s, main.lineId, { x: 4.9, y: 0 });
    expect(r.error).toBeUndefined();
    const onCurve = r.state.constraints.find(
      cn => cn.type === 'coincident'
        && cn.targets.some(t => t.entityId === c.id),
    );
    expect(onCurve).toBeDefined();
  });

  it('extends to a CONSTRUCTION boundary (parity with trim — REQ 866 ride-along)', () => {
    let s = emptySketchState();
    const main = horizontalLine(s, 0, 5, 0); s = main.state;
    const va = addPoint(s, 8, -1); s = va.state;
    const vb = addPoint(s, 8,  1); s = vb.state;
    s = addLine(s, va.id, vb.id, { construction: true }).state;
    const r = extendLine(s, main.lineId, { x: 4.9, y: 0 });
    expect(r.error).toBeUndefined();
    const endPt = findPoint(r.state, main.endId)!;
    expect(endPt.x).toBeCloseTo(8);
    expect(endPt.y).toBeCloseTo(0);
  });
});

describe('splitLineAt', () => {
  it('splits a line into two collinear lines at the click point', () => {
    let s = emptySketchState();
    const main = horizontalLine(s, 0, 10, 0); s = main.state;
    const r = splitLineAt(s, main.lineId, { x: 4, y: 0 });
    expect(r.error).toBeUndefined();
    expect(findEntity(r.state, main.lineId)).toBeUndefined();
    expect(lineCount(r.state)).toBe(2);
    // The new split point sits at (4, 0).
    const splitPt = r.state.entities.find(
      e => e.kind === 'point' && Math.abs((e as PointEntity).x - 4) < 1e-9
        && Math.abs((e as PointEntity).y - 0) < 1e-9,
    );
    expect(splitPt).toBeDefined();
  });

  it('refuses to split at an endpoint', () => {
    let s = emptySketchState();
    const main = horizontalLine(s, 0, 10, 0); s = main.state;
    const r = splitLineAt(s, main.lineId, { x: 0, y: 0 });
    expect(r.error).toBe('Cannot split at an endpoint');
  });

  it('B3: splitting a rectangle side keeps corner ids, adjacent sides connected, horizontal on both pieces', () => {
    // Rectangle with SHARED corner points. Splitting the bottom side
    // must reuse the corners (the old code minted duplicates, tearing
    // the rectangle), share the split point between the two pieces,
    // inherit `horizontal` onto both with unique cloned ids, and drop
    // dimensional constraints — the splitArcAt discipline.
    let s = emptySketchState();
    const p00 = addPoint(s, 0, 0); s = p00.state;
    const p10 = addPoint(s, 10, 0); s = p10.state;
    const p11 = addPoint(s, 10, 10); s = p11.state;
    const p01 = addPoint(s, 0, 10); s = p01.state;
    const bottom = addLine(s, p00.id, p10.id); s = bottom.state;
    const right = addLine(s, p10.id, p11.id); s = right.state;
    const top = addLine(s, p11.id, p01.id); s = top.state;
    const left = addLine(s, p01.id, p00.id); s = left.state;
    s = addConstraint(s, 'horizontal', [bottom.id]).state;
    s = addConstraint(s, 'distance', [bottom.id], 10).state;  // dim → must drop

    const r = splitLineAt(s, bottom.id, { x: 4, y: 0 });
    expect(r.error).toBeUndefined();
    expect(r.affectedIds?.length).toBe(2);
    const [l1, l2] = r.affectedIds!.map(id => findEntity<LineEntity>(r.state, id)!);
    // Corners keep their ids — the pieces reuse them.
    expect(l1.startId).toBe(p00.id);
    expect(l2.endId).toBe(p10.id);
    // Adjacent sides stay anchored on the original corners.
    expect(findEntity<LineEntity>(r.state, right.id)!.startId).toBe(p10.id);
    expect(findEntity<LineEntity>(r.state, left.id)!.endId).toBe(p00.id);
    expect(findEntity(r.state, top.id)).toBeDefined();
    // The pieces share the split point at (4, 0).
    expect(l1.endId).toBe(l2.startId);
    const split = findPoint(r.state, l1.endId)!;
    expect(split.x).toBeCloseTo(4);
    expect(split.y).toBeCloseTo(0);
    // `horizontal` inherited onto BOTH pieces with unique ids.
    const horiz = r.state.constraints.filter(c => c.type === 'horizontal');
    expect(horiz.length).toBe(2);
    expect(new Set(horiz.map(c => c.id)).size).toBe(2);
    expect(horiz.map(c => c.targets[0].entityId).sort())
      .toEqual([l1.id, l2.id].sort());
    // Dims drop (each piece has a different length).
    expect(r.state.constraints.filter(c => c.type === 'distance').length).toBe(0);
  });

  it('B3: re-attaches a passenger point to the piece covering its parameter', () => {
    let s = emptySketchState();
    const main = horizontalLine(s, 0, 10, 0); s = main.state;
    const pass = addPoint(s, 6, 0); s = pass.state;
    s = addConstraint(s, 'coincident', [pass.id, main.lineId]).state;
    const r = splitLineAt(s, main.lineId, { x: 4, y: 0 });
    expect(r.error).toBeUndefined();
    const [, id2] = r.affectedIds!;
    // Passenger (t = 0.6) belongs to the second piece [0.4 .. 1].
    const coin = r.state.constraints.filter(c => c.type === 'coincident');
    expect(coin.length).toBe(1);
    expect(coin[0].targets.map(t => t.entityId).sort())
      .toEqual([id2, pass.id].sort());
  });

  it('B3: reuses an existing point within tolerance as the split point', () => {
    let s = emptySketchState();
    const main = horizontalLine(s, 0, 10, 0); s = main.state;
    const marker = addPoint(s, 4.0004, 0); s = marker.state;
    const r = splitLineAt(s, main.lineId, { x: 4, y: 0 });
    expect(r.error).toBeUndefined();
    const [l1, l2] = r.affectedIds!.map(id => findEntity<LineEntity>(r.state, id)!);
    expect(l1.endId).toBe(marker.id);
    expect(l2.startId).toBe(marker.id);
  });
});

describe('mirrorEntities — on-axis points (part 619 over-constraint)', () => {
  /** Vertical construction axis at x=0. */
  function withAxis() {
    let s = emptySketchState();
    const a1 = addPoint(s, 0, -20); s = a1.state;
    const a2 = addPoint(s, 0, 20); s = a2.state;
    const ax = addLine(s, a1.id, a2.id, { construction: true }); s = ax.state;
    return { s, axisId: ax.id };
  }

  it('a chain endpoint ON the axis is SHARED (no copy, no degenerate symmetric)', () => {
    // L-profile whose two chain ends sit on the axis: (0,10)→(5,10)→(5,0)→(0,0).
    let { s, axisId } = withAxis();
    const p1 = addPoint(s, 0, 10); s = p1.state;
    const p2 = addPoint(s, 5, 10); s = p2.state;
    const p3 = addPoint(s, 5, 0); s = p3.state;
    const p4 = addPoint(s, 0, 0); s = p4.state;
    const l1 = addLine(s, p1.id, p2.id); s = l1.state;
    const l2 = addLine(s, p2.id, p3.id); s = l2.state;
    const l3 = addLine(s, p3.id, p4.id); s = l3.state;
    const r = mirrorEntities(s, [l1.id, l2.id, l3.id], axisId);
    expect(r.error).toBeUndefined();
    expect(r.affectedIds).toHaveLength(3);
    // Only the two OFF-axis points pair up — the on-axis ends are welded
    // by identity. A zero-length symmetric pair made the solver's
    // perpendicular primitive singular → whole sketch "over-constrained".
    const syms = r.state.constraints.filter(c => c.type === 'symmetric');
    expect(syms).toHaveLength(2);
    // The mirrored outer lines attach to the ORIGINAL on-axis points.
    const m1 = findEntity<LineEntity>(r.state, r.affectedIds![0])!;
    expect([m1.startId, m1.endId]).toContain(p1.id);
    const m3 = findEntity<LineEntity>(r.state, r.affectedIds![2])!;
    expect([m3.startId, m3.endId]).toContain(p4.id);
  });

  it('a circle centered on the axis is self-symmetric — no duplicate is created', () => {
    let { s, axisId } = withAxis();
    const c = addCircle(s, 0, 5, 3); s = c.state;
    const before = s.entities.length;
    const r = mirrorEntities(s, [c.id], axisId);
    expect(r.error).toBeUndefined();
    expect(r.affectedIds).toHaveLength(0);
    expect(r.state.entities.length).toBe(before);
    expect(r.state.constraints.filter(x => x.type === 'symmetric')).toHaveLength(0);
  });

  it('a line lying entirely on the axis is skipped as its own mirror', () => {
    let { s, axisId } = withAxis();
    const q1 = addPoint(s, 0, 2); s = q1.state;
    const q2 = addPoint(s, 0, 8); s = q2.state;
    const l = addLine(s, q1.id, q2.id); s = l.state;
    const before = s.entities.length;
    const r = mirrorEntities(s, [l.id], axisId);
    expect(r.error).toBeUndefined();
    expect(r.affectedIds).toHaveLength(0);
    expect(r.state.entities.length).toBe(before);
  });
});

describe('mirrorEntities', () => {
  it('mirrors a line across an axis', () => {
    // Axis: x-axis (line from (0,0) to (10,0)). Target: line from (1,1) to (3,2).
    let s = emptySketchState();
    const axis = horizontalLine(s, 0, 10, 0); s = axis.state;
    const ta = addPoint(s, 1, 1); s = ta.state;
    const tb = addPoint(s, 3, 2); s = tb.state;
    const tl = addLine(s, ta.id, tb.id); s = tl.state;
    const r = mirrorEntities(s, [tl.id], axis.lineId);
    expect(r.error).toBeUndefined();
    expect(r.affectedIds).toHaveLength(1);
    const mirroredLine = findEntity<LineEntity>(r.state, r.affectedIds![0])!;
    const ma = findPoint(r.state, mirroredLine.startId)!;
    const mb = findPoint(r.state, mirroredLine.endId)!;
    expect(ma.x).toBeCloseTo(1); expect(ma.y).toBeCloseTo(-1);
    expect(mb.x).toBeCloseTo(3); expect(mb.y).toBeCloseTo(-2);
  });

  it('mirrors a circle across an axis (radius preserved, center reflected)', () => {
    let s = emptySketchState();
    const axis = horizontalLine(s, 0, 10, 0); s = axis.state;
    const c = addCircle(s, 5, 3, 2); s = c.state;
    const r = mirrorEntities(s, [c.id], axis.lineId);
    expect(r.error).toBeUndefined();
    const mirrored = findEntity<CircleEntity>(r.state, r.affectedIds![0])!;
    const ce = findPoint(r.state, mirrored.centerId)!;
    expect(ce.x).toBeCloseTo(5); expect(ce.y).toBeCloseTo(-3);
    expect(mirrored.radius).toBeCloseTo(2);
  });

  it('flips arc CCW direction when mirroring', () => {
    let s = emptySketchState();
    const axis = horizontalLine(s, 0, 10, 0); s = axis.state;
    const arc = addArc(s, 5, 3, 7, 3, 5, 5, true); s = arc.state;
    const r = mirrorEntities(s, [arc.id], axis.lineId);
    expect(r.error).toBeUndefined();
    const mirrored = findEntity<ArcEntity>(r.state, r.affectedIds![0])!;
    expect(mirrored.ccw).toBe(false);
  });

  it('adds symmetric constraints linking each line endpoint pair to the axis', () => {
    let s = emptySketchState();
    const axis = horizontalLine(s, 0, 10, 0); s = axis.state;
    const ta = addPoint(s, 1, 1); s = ta.state;
    const tb = addPoint(s, 3, 2); s = tb.state;
    const tl = addLine(s, ta.id, tb.id); s = tl.state;
    const before = s.constraints.length;
    const r = mirrorEntities(s, [tl.id], axis.lineId);
    expect(r.error).toBeUndefined();
    const added = r.state.constraints.slice(before);
    const sym = added.filter(c => c.type === 'symmetric');
    expect(sym).toHaveLength(2);
    for (const c of sym) {
      expect(c.targets).toHaveLength(3);
      // Third target is the axis line.
      expect(c.targets[2].entityId).toBe(axis.lineId);
    }
  });

  it('adds equal + symmetric constraints for a mirrored circle', () => {
    let s = emptySketchState();
    const axis = horizontalLine(s, 0, 10, 0); s = axis.state;
    const c = addCircle(s, 5, 3, 2); s = c.state;
    const before = s.constraints.length;
    const r = mirrorEntities(s, [c.id], axis.lineId);
    expect(r.error).toBeUndefined();
    const added = r.state.constraints.slice(before);
    expect(added.filter(c => c.type === 'symmetric')).toHaveLength(1);  // center pair
    expect(added.filter(c => c.type === 'equal')).toHaveLength(1);      // radius lock
  });

  it('B14: mirrored chains share ONE reflected point per shared corner', () => {
    // Rectangle above the axis, all four sides mirrored. Each corner
    // must reflect once and be shared by both adjacent mirrored sides
    // — the old per-entity reflection stacked duplicate points.
    let s = emptySketchState();
    const axis = horizontalLine(s, 0, 10, 0); s = axis.state;
    const p1 = addPoint(s, 1, 1); s = p1.state;
    const p2 = addPoint(s, 4, 1); s = p2.state;
    const p3 = addPoint(s, 4, 3); s = p3.state;
    const p4 = addPoint(s, 1, 3); s = p4.state;
    const l1 = addLine(s, p1.id, p2.id); s = l1.state;
    const l2 = addLine(s, p2.id, p3.id); s = l2.state;
    const l3 = addLine(s, p3.id, p4.id); s = l3.state;
    const l4 = addLine(s, p4.id, p1.id); s = l4.state;
    const pointsBefore = s.entities.filter(e => e.kind === 'point').length;
    const r = mirrorEntities(s, [l1.id, l2.id, l3.id, l4.id], axis.lineId);
    expect(r.error).toBeUndefined();
    expect(r.affectedIds).toHaveLength(4);
    const m = r.affectedIds!.map(id => findEntity<LineEntity>(r.state, id)!);
    // Adjacent mirrored sides share point ids around the loop.
    expect(m[0].endId).toBe(m[1].startId);
    expect(m[1].endId).toBe(m[2].startId);
    expect(m[2].endId).toBe(m[3].startId);
    expect(m[3].endId).toBe(m[0].startId);
    // Exactly 4 new points (not 8).
    const pointsAfter = r.state.entities.filter(e => e.kind === 'point').length;
    expect(pointsAfter - pointsBefore).toBe(4);
    // One symmetric constraint per unique corner pair.
    expect(r.state.constraints.filter(c => c.type === 'symmetric')).toHaveLength(4);
  });

  it('B14: a construction line mirrors as construction (entity + support points)', () => {
    let s = emptySketchState();
    const axis = horizontalLine(s, 0, 10, 0); s = axis.state;
    const ta = addPoint(s, 1, 1); s = ta.state;
    const tb = addPoint(s, 3, 2); s = tb.state;
    const tl = addLine(s, ta.id, tb.id, { construction: true }); s = tl.state;
    const r = mirrorEntities(s, [tl.id], axis.lineId);
    expect(r.error).toBeUndefined();
    const m = findEntity<LineEntity>(r.state, r.affectedIds![0])!;
    expect(m.construction).toBe(true);
    expect(findPoint(r.state, m.startId)!.construction).toBe(true);
    expect(findPoint(r.state, m.endId)!.construction).toBe(true);
  });

  it('B14: mirrors an ellipse (center + major-axis end reflected, minorRadius kept)', () => {
    let s = emptySketchState();
    const axis = horizontalLine(s, 0, 10, 0); s = axis.state;
    const ce = addPoint(s, 2, 1); s = ce.state;
    const me = addPoint(s, 5, 1); s = me.state;
    const ell = addEllipseByPoints(s, ce.id, me.id, 0.8); s = ell.state;
    const r = mirrorEntities(s, [ell.id], axis.lineId);
    expect(r.error).toBeUndefined();
    expect(r.affectedIds).toHaveLength(1);
    const m = findEntity<EllipseEntity>(r.state, r.affectedIds![0])!;
    expect(m.kind).toBe('ellipse');
    const mc = findPoint(r.state, m.centerId)!;
    const mm = findPoint(r.state, m.majorAxisEndId)!;
    expect(mc.x).toBeCloseTo(2); expect(mc.y).toBeCloseTo(-1);
    expect(mm.x).toBeCloseTo(5); expect(mm.y).toBeCloseTo(-1);
    expect(m.minorRadius).toBeCloseTo(0.8);
    // Two symmetric constraints — center pair + major-end pair.
    expect(r.state.constraints.filter(c => c.type === 'symmetric')).toHaveLength(2);
  });

  it('B14: mirrors an ellipticalArc — endpoints map to the reflected originals, traversal flips', () => {
    let s = emptySketchState();
    const axis = horizontalLine(s, 0, 10, 0); s = axis.state;
    // Quarter elliptical arc: center (0,2), major end (4,2), minor 1,
    // parametric 0..π/2 CCW — from (4,2) to (0,3).
    const ea = addEllipticalArc(s, 0, 2, 4, 2, 1, 0, Math.PI / 2, true); s = ea.state;
    const r = mirrorEntities(s, [ea.id], axis.lineId);
    expect(r.error).toBeUndefined();
    expect(r.affectedIds).toHaveLength(1);
    const m = findEntity<EllipticalArcEntity>(r.state, r.affectedIds![0])!;
    expect(m.kind).toBe('ellipticalArc');
    expect(m.minorRadius).toBeCloseTo(1);
    const mc = findPoint(r.state, m.centerId)!;
    const mm = findPoint(r.state, m.majorAxisEndId)!;
    expect(mc.x).toBeCloseTo(0); expect(mc.y).toBeCloseTo(-2);
    expect(mm.x).toBeCloseTo(4); expect(mm.y).toBeCloseTo(-2);
    // Evaluate the mirrored arc's endpoints in the tessellator's frame
    // (minor axis = major direction rotated +90°): they must be the
    // reflections of the original endpoints (4,2)→(4,−2), (0,3)→(0,−3).
    const evalAt = (t: number) => {
      const M = Math.hypot(mm.x - mc.x, mm.y - mc.y);
      const ux = (mm.x - mc.x) / M, uy = (mm.y - mc.y) / M;
      const ca = M * Math.cos(t), sb = m.minorRadius * Math.sin(t);
      return { x: mc.x + ux * ca - uy * sb, y: mc.y + uy * ca + ux * sb };
    };
    const startPt = evalAt(m.startAngle);
    const endPt = evalAt(m.endAngle);
    expect(startPt.x).toBeCloseTo(4); expect(startPt.y).toBeCloseTo(-2);
    expect(endPt.x).toBeCloseTo(0);   expect(endPt.y).toBeCloseTo(-3);
    // Reflection reverses the traversal direction.
    expect(m.ccw).toBe(false);
  });

  it('B14: mirrors a spline (control points reflected, degree kept)', () => {
    let s = emptySketchState();
    const axis = horizontalLine(s, 0, 10, 0); s = axis.state;
    const coords = [[0, 1], [1, 2], [2, 1], [3, 2]] as const;
    const cpIds: string[] = [];
    for (const [x, y] of coords) {
      const p = addPoint(s, x, y); s = p.state; cpIds.push(p.id);
    }
    const sp = addSplineByPoints(s, cpIds, 3); s = sp.state;
    const r = mirrorEntities(s, [sp.id], axis.lineId);
    expect(r.error).toBeUndefined();
    expect(r.affectedIds).toHaveLength(1);
    const m = findEntity<SplineEntity>(r.state, r.affectedIds![0])!;
    expect(m.kind).toBe('spline');
    expect(m.degree).toBe(3);
    expect(m.controlPointIds).toHaveLength(4);
    m.controlPointIds.forEach((id, i) => {
      const pt = findPoint(r.state, id)!;
      expect(pt.x).toBeCloseTo(coords[i][0]);
      expect(pt.y).toBeCloseTo(-coords[i][1]);
    });
  });
});

describe('offsetCurve', () => {
  it('offsets a horizontal line above or below depending on sidePoint', () => {
    let s = emptySketchState();
    const main = horizontalLine(s, 0, 10, 0); s = main.state;
    // sidePoint above → line shifts up.
    const above = offsetCurve(s, main.lineId, 2, { x: 5, y: 1 });
    expect(above.error).toBeUndefined();
    const ln = findEntity<LineEntity>(above.state, above.affectedIds![0])!;
    const a = findPoint(above.state, ln.startId)!;
    expect(a.y).toBeCloseTo(2);
    // sidePoint below → line shifts down.
    const below = offsetCurve(s, main.lineId, 2, { x: 5, y: -1 });
    const ln2 = findEntity<LineEntity>(below.state, below.affectedIds![0])!;
    const a2 = findPoint(below.state, ln2.startId)!;
    expect(a2.y).toBeCloseTo(-2);
  });

  it('grows a circle when sidePoint is outside', () => {
    let s = emptySketchState();
    const c = addCircle(s, 0, 0, 5); s = c.state;
    const r = offsetCurve(s, c.id, 2, { x: 10, y: 0 });
    expect(r.error).toBeUndefined();
    const offsetCircle = findEntity<CircleEntity>(r.state, r.affectedIds![0])!;
    expect(offsetCircle.radius).toBeCloseTo(7);
  });

  it('shrinks a circle when sidePoint is inside', () => {
    let s = emptySketchState();
    const c = addCircle(s, 0, 0, 5); s = c.state;
    const r = offsetCurve(s, c.id, 2, { x: 0, y: 0 });
    expect(r.error).toBeUndefined();
    const offsetCircle = findEntity<CircleEntity>(r.state, r.affectedIds![0])!;
    expect(offsetCircle.radius).toBeCloseTo(3);
  });

  it('refuses to collapse a circle below zero', () => {
    let s = emptySketchState();
    const c = addCircle(s, 0, 0, 1); s = c.state;
    const r = offsetCurve(s, c.id, 5, { x: 0, y: 0 });
    expect(r.error).toBe('Offset would collapse circle');
  });
});

describe('filletLines', () => {
  it('rounds a right-angle corner of two perpendicular lines', () => {
    // L-shape sharing (10, 0). Fillet with radius 2 → tangent at (8,0)
    // and (10,2); arc center (8,2); CCW sweep.
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    const corner = addPoint(s, 10, 0); s = corner.state;
    const c = addPoint(s, 10, 10); s = c.state;
    const l1 = addLine(s, a.id, corner.id); s = l1.state;
    const l2 = addLine(s, corner.id, c.id); s = l2.state;
    const r = filletLines(s, l1.id, l2.id, 2);
    expect(r.error).toBeUndefined();

    // L1 should now end at (8, 0) on a NEW point id.
    const l1After = findEntity<LineEntity>(r.state, l1.id)!;
    const l1EndPt = findPoint(r.state, l1After.endId)!;
    expect(l1EndPt.x).toBeCloseTo(8);
    expect(l1EndPt.y).toBeCloseTo(0);
    expect(l1After.endId).not.toBe(corner.id);

    // L2 should now start at (10, 2) on a NEW point id.
    const l2After = findEntity<LineEntity>(r.state, l2.id)!;
    const l2StartPt = findPoint(r.state, l2After.startId)!;
    expect(l2StartPt.x).toBeCloseTo(10);
    expect(l2StartPt.y).toBeCloseTo(2);
    expect(l2After.startId).not.toBe(corner.id);

    // Arc with center (8, 2) and radius 2 should exist.
    const newArc = r.state.entities.find(e => e.kind === 'arc') as ArcEntity | undefined;
    expect(newArc).toBeDefined();
    expect(newArc!.radius).toBeCloseTo(2);
    const arcCenter = findPoint(r.state, newArc!.centerId)!;
    expect(arcCenter.x).toBeCloseTo(8);
    expect(arcCenter.y).toBeCloseTo(2);

    // Two tangent constraints linking each line to the new arc.
    const tangents = r.state.constraints.filter(c => c.type === 'tangent');
    expect(tangents).toHaveLength(2);
  });

  it('errors when the radius is too large for one of the lines', () => {
    let s = emptySketchState();
    // Short horizontal + vertical, R larger than either leg.
    const a = addPoint(s, 0, 0); s = a.state;
    const corner = addPoint(s, 2, 0); s = corner.state;
    const c = addPoint(s, 2, 2); s = c.state;
    const l1 = addLine(s, a.id, corner.id); s = l1.state;
    const l2 = addLine(s, corner.id, c.id); s = l2.state;
    const r = filletLines(s, l1.id, l2.id, 5);
    expect(r.error).toMatch(/too large/);
  });

  it('rejects parallel lines', () => {
    let s = emptySketchState();
    const a1 = addPoint(s, 0, 0); s = a1.state;
    const a2 = addPoint(s, 10, 0); s = a2.state;
    const l1 = addLine(s, a1.id, a2.id); s = l1.state;
    const b1 = addPoint(s, 0, 5); s = b1.state;
    const b2 = addPoint(s, 10, 5); s = b2.state;
    const l2 = addLine(s, b1.id, b2.id); s = l2.state;
    const r = filletLines(s, l1.id, l2.id, 1);
    expect(r.error).toMatch(/parallel/i);
  });

  it('B12 (REQ 896): a dimensioned corner survives as a virtual sharp pinned by collinear construction lines', () => {
    // The corner point carries a dim, so it survives the fillet's
    // orphan sweep — the old behavior left it FREE (2 DOF) while the
    // dim kept measuring it. Now the keepRemovedAsConstruction
    // mechanism fires automatically: one construction line per leg,
    // each collinear with its source line, pinning the point at the
    // theoretical corner so the dim stays solvable.
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    const corner = addPoint(s, 10, 0); s = corner.state;
    const c = addPoint(s, 10, 10); s = c.state;
    const l1 = addLine(s, a.id, corner.id); s = l1.state;
    const l2 = addLine(s, corner.id, c.id); s = l2.state;
    s = addConstraint(s, 'distance', [a.id, corner.id], 10).state;
    const r = filletLines(s, l1.id, l2.id, 2);
    expect(r.error).toBeUndefined();
    // Corner point survives at the theoretical corner; dim intact.
    const cornerAfter = findPoint(r.state, corner.id)!;
    expect(cornerAfter).toBeDefined();
    expect(cornerAfter.x).toBeCloseTo(10);
    expect(cornerAfter.y).toBeCloseTo(0);
    const dim = r.state.constraints.find(con => con.type === 'distance')!;
    expect(dim.targets.map(t => t.entityId)).toContain(corner.id);
    // Virtual sharp: two construction lines THROUGH the corner point
    // (the tangent-anchor construction lines don't touch it), plus a
    // collinear constraint tying each back to its source line.
    const throughCorner = r.state.entities.filter(
      (e): e is LineEntity => e.kind === 'line' && e.construction === true
        && (e.startId === corner.id || e.endId === corner.id));
    expect(throughCorner.length).toBe(2);
    const collinears = r.state.constraints.filter(con => con.type === 'collinear');
    expect(collinears.length).toBe(2);
    const collinearTargets = collinears.flatMap(con => con.targets.map(t => t.entityId));
    expect(collinearTargets).toContain(l1.id);
    expect(collinearTargets).toContain(l2.id);
  });

  it('B12: an unconstrained corner is still cleaned up (no gratuitous construction lines)', () => {
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    const corner = addPoint(s, 10, 0); s = corner.state;
    const c = addPoint(s, 10, 10); s = c.state;
    const l1 = addLine(s, a.id, corner.id); s = l1.state;
    const l2 = addLine(s, corner.id, c.id); s = l2.state;
    const r = filletLines(s, l1.id, l2.id, 2);
    expect(r.error).toBeUndefined();
    expect(findPoint(r.state, corner.id)).toBeUndefined();
    expect(r.state.constraints.filter(con => con.type === 'collinear').length).toBe(0);
  });
});

describe('trim previews on construction sources (REQ 866 ride-along)', () => {
  it('previewTrimLine previews a construction line like trimAt trims it', () => {
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    const b = addPoint(s, 10, 0); s = b.state;
    const main = addLine(s, a.id, b.id, { construction: true }); s = main.state;
    for (const x of [3, 7]) {
      const p1 = addPoint(s, x, -1); s = p1.state;
      const p2 = addPoint(s, x, 1); s = p2.state;
      s = addLine(s, p1.id, p2.id).state;
    }
    const seg = previewTrimLine(s, main.id, { x: 5, y: 0 });
    expect(seg).not.toBeNull();
    expect(seg!.start.x).toBeCloseTo(3);
    expect(seg!.end.x).toBeCloseTo(7);
  });

  it('previewTrimCircle previews a construction circle', () => {
    let s = emptySketchState();
    const c = addCircle(s, 0, 0, 5); s = c.state;
    s = { ...s, entities: s.entities.map(e => e.id === c.id ? { ...e, construction: true } : e) };
    const a = addPoint(s, 0, -10); s = a.state;
    const b = addPoint(s, 0, 10); s = b.state;
    s = addLine(s, a.id, b.id).state;
    const poly = previewTrimCircle(s, c.id, { x: 5, y: 0 });
    expect(poly).not.toBeNull();
    expect(poly!.length).toBeGreaterThan(1);
  });

  it('previewTrimArc previews a construction arc', () => {
    let s = emptySketchState();
    const arc = addArc(s, 0, 0, 5, 0, -5, 0, true); s = arc.state;
    s = { ...s, entities: s.entities.map(e => e.id === arc.id ? { ...e, construction: true } : e) };
    const a = addPoint(s, 0, -10); s = a.state;
    const b = addPoint(s, 0, 10); s = b.state;
    s = addLine(s, a.id, b.id).state;
    const poly = previewTrimArc(s, arc.id, { x: 3, y: 4 });
    expect(poly).not.toBeNull();
    expect(poly!.length).toBeGreaterThan(1);
  });
});

describe('chamferLines', () => {
  it('cuts a right-angle corner with a straight chamfer of the requested distance', () => {
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    const corner = addPoint(s, 10, 0); s = corner.state;
    const c = addPoint(s, 10, 10); s = c.state;
    const l1 = addLine(s, a.id, corner.id); s = l1.state;
    const l2 = addLine(s, corner.id, c.id); s = l2.state;
    const r = chamferLines(s, l1.id, l2.id, 2);
    expect(r.error).toBeUndefined();

    // The new chamfer line connects (8,0) → (10,2).
    const l1After = findEntity<LineEntity>(r.state, l1.id)!;
    const l2After = findEntity<LineEntity>(r.state, l2.id)!;
    const l1EndPt = findPoint(r.state, l1After.endId)!;
    const l2StartPt = findPoint(r.state, l2After.startId)!;
    expect(l1EndPt.x).toBeCloseTo(8);
    expect(l1EndPt.y).toBeCloseTo(0);
    expect(l2StartPt.x).toBeCloseTo(10);
    expect(l2StartPt.y).toBeCloseTo(2);
    // A new straight line was added (not an arc).
    const newLines = r.state.entities.filter(e => e.kind === 'line').length;
    expect(newLines).toBe(3);
    expect(r.state.entities.filter(e => e.kind === 'arc').length).toBe(0);
  });

  it('distance-distance: V=5/H=3 at a right-angle corner trims the horizontal line by H=3 and the vertical line by V=5, regardless of input line order', () => {
    // Bottom-right corner of a rectangle. L1 is the horizontal bottom edge
    // (so its endpoint near the corner should be trimmed by H=3, leaving
    // it at x=10-3=7). L2 is the vertical right edge (so its endpoint near
    // the corner should be trimmed by V=5, leaving it at y=0+5=5).
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    const corner = addPoint(s, 10, 0); s = corner.state;
    const c = addPoint(s, 10, 10); s = c.state;
    const l1 = addLine(s, a.id, corner.id); s = l1.state;           // bottom
    const l2 = addLine(s, corner.id, c.id); s = l2.state;           // right
    const r = chamferLines(s, l1.id, l2.id, {
      kind: 'distance-distance', distance1: 5, distance2: 3,
    });
    expect(r.error).toBeUndefined();
    const l1End = findPoint(r.state, findEntity<LineEntity>(r.state, l1.id)!.endId)!;
    const l2Start = findPoint(r.state, findEntity<LineEntity>(r.state, l2.id)!.startId)!;
    // Bottom edge truncated at (7, 0) — H=3 trim, vertical extent zero.
    expect(l1End.x).toBeCloseTo(7);
    expect(l1End.y).toBeCloseTo(0);
    // Right edge truncated at (10, 5) — V=5 trim, horizontal extent zero.
    expect(l2Start.x).toBeCloseTo(10);
    expect(l2Start.y).toBeCloseTo(5);
  });

  it('distance-distance: input order swap (vertical line passed first) produces the same geometry', () => {
    // Same corner, same V=5/H=3, but pass L2 (vertical) before L1
    // (horizontal). The internal more-vertical-first swap must not flip
    // which line gets the V trim vs the H trim — the V input always trims
    // the vertical leg.
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    const corner = addPoint(s, 10, 0); s = corner.state;
    const c = addPoint(s, 10, 10); s = c.state;
    const l1 = addLine(s, a.id, corner.id); s = l1.state;           // bottom
    const l2 = addLine(s, corner.id, c.id); s = l2.state;           // right
    const r = chamferLines(s, l2.id, l1.id, {
      kind: 'distance-distance', distance1: 5, distance2: 3,
    });
    expect(r.error).toBeUndefined();
    const l1End = findPoint(r.state, findEntity<LineEntity>(r.state, l1.id)!.endId)!;
    const l2Start = findPoint(r.state, findEntity<LineEntity>(r.state, l2.id)!.startId)!;
    expect(l1End.x).toBeCloseTo(7);
    expect(l1End.y).toBeCloseTo(0);
    expect(l2Start.x).toBeCloseTo(10);
    expect(l2Start.y).toBeCloseTo(5);
  });
});

describe('moveEntities', () => {
  it('translates every support point of the selected entities by (dx, dy)', () => {
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    const b = addPoint(s, 10, 0); s = b.state;
    const ln = addLine(s, a.id, b.id); s = ln.state;
    const r = moveEntities(s, [ln.id], 5, 3);
    expect(r.error).toBeUndefined();
    const aAfter = findPoint(r.state, a.id)!;
    const bAfter = findPoint(r.state, b.id)!;
    expect(aAfter.x).toBeCloseTo(5); expect(aAfter.y).toBeCloseTo(3);
    expect(bAfter.x).toBeCloseTo(15); expect(bAfter.y).toBeCloseTo(3);
  });
});

describe('copyEntities', () => {
  it('duplicates a line into a fresh entity with new point ids', () => {
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    const b = addPoint(s, 10, 0); s = b.state;
    const ln = addLine(s, a.id, b.id); s = ln.state;
    const r = copyEntities(s, [ln.id], 0, 5);
    expect(r.error).toBeUndefined();
    expect(r.affectedIds).toHaveLength(1);
    const newId = r.affectedIds![0];
    expect(newId).not.toBe(ln.id);
    // New line points are at (0, 5) and (10, 5).
    const newLn = findEntity<LineEntity>(r.state, newId)!;
    const na = findPoint(r.state, newLn.startId)!;
    const nb = findPoint(r.state, newLn.endId)!;
    expect(na.y).toBeCloseTo(5);
    expect(nb.y).toBeCloseTo(5);
    // Original still in place.
    const origA = findPoint(r.state, a.id)!;
    expect(origA.y).toBeCloseTo(0);
  });

  it('copies an ellipticalArc — all fields, remapped point ids (kind-gap ride-along)', () => {
    let s = emptySketchState();
    const ea = addEllipticalArc(s, 0, 0, 4, 0, 1.5, 0.3, 2.1, false); s = ea.state;
    const r = copyEntities(s, [ea.id], 10, 0);
    expect(r.error).toBeUndefined();
    expect(r.affectedIds).toHaveLength(1);
    const copy = findEntity<EllipticalArcEntity>(r.state, r.affectedIds![0])!;
    expect(copy.kind).toBe('ellipticalArc');
    const orig = findEntity<EllipticalArcEntity>(r.state, ea.id)!;
    expect(copy.centerId).not.toBe(orig.centerId);
    expect(copy.majorAxisEndId).not.toBe(orig.majorAxisEndId);
    expect(findPoint(r.state, copy.centerId)!.x).toBeCloseTo(10);
    expect(findPoint(r.state, copy.majorAxisEndId)!.x).toBeCloseTo(14);
    expect(copy.minorRadius).toBeCloseTo(1.5);
    expect(copy.startAngle).toBeCloseTo(0.3);
    expect(copy.endAngle).toBeCloseTo(2.1);
    expect(copy.ccw).toBe(false);
  });
});

describe('rotateEntities', () => {
  it('rotates a point 90° CCW around the origin', () => {
    let s = emptySketchState();
    const p = addPoint(s, 10, 0); s = p.state;
    const r = rotateEntities(s, [p.id], { x: 0, y: 0 }, Math.PI / 2);
    expect(r.error).toBeUndefined();
    const pAfter = findPoint(r.state, p.id)!;
    expect(pAfter.x).toBeCloseTo(0);
    expect(pAfter.y).toBeCloseTo(10);
  });
});

describe('scaleEntities', () => {
  it('scales a circle`s radius and center distance by the factor', () => {
    let s = emptySketchState();
    const c = addCircle(s, 10, 0, 2); s = c.state;
    const r = scaleEntities(s, [c.id], { x: 0, y: 0 }, 3);
    expect(r.error).toBeUndefined();
    const circ = findEntity<CircleEntity>(r.state, c.id)!;
    const center = findPoint(r.state, circ.centerId)!;
    expect(center.x).toBeCloseTo(30);  // scaled 3×
    expect(circ.radius).toBeCloseTo(6);  // radius scaled too
  });

  it('scales an ellipticalArc`s minorRadius along with its points (kind-gap ride-along)', () => {
    let s = emptySketchState();
    const ea = addEllipticalArc(s, 2, 0, 6, 0, 1, 0, Math.PI, true); s = ea.state;
    const r = scaleEntities(s, [ea.id], { x: 0, y: 0 }, 2);
    expect(r.error).toBeUndefined();
    const m = findEntity<EllipticalArcEntity>(r.state, ea.id)!;
    expect(m.minorRadius).toBeCloseTo(2);
    expect(findPoint(r.state, m.centerId)!.x).toBeCloseTo(4);
    expect(findPoint(r.state, m.majorAxisEndId)!.x).toBeCloseTo(12);
  });
});

describe('linearPatternEntities', () => {
  it('produces (count - 1) clones spaced by (dx, dy)', () => {
    let s = emptySketchState();
    const c = addCircle(s, 0, 0, 3); s = c.state;
    const r = linearPatternEntities(s, [c.id], 10, 0, 4);
    expect(r.error).toBeUndefined();
    expect(r.affectedIds?.length).toBe(3);  // 4 total, 1 original + 3 clones
    const lastId = r.affectedIds![r.affectedIds!.length - 1];
    const last = findEntity<CircleEntity>(r.state, lastId)!;
    const center = findPoint(r.state, last.centerId)!;
    expect(center.x).toBeCloseTo(30);
  });
  it('rejects count < 2', () => {
    let s = emptySketchState();
    const c = addCircle(s, 0, 0, 3); s = c.state;
    expect(linearPatternEntities(s, [c.id], 10, 0, 1).error).toBeDefined();
  });
});

describe('circularPatternEntities', () => {
  it('produces (count - 1) clones rotated around the pivot', () => {
    let s = emptySketchState();
    const c = addCircle(s, 10, 0, 1); s = c.state;
    const r = circularPatternEntities(s, [c.id], { x: 0, y: 0 }, 2 * Math.PI, 4);
    expect(r.error).toBeUndefined();
    expect(r.affectedIds?.length).toBe(3);
    const firstId = r.affectedIds![0];
    const first = findEntity<CircleEntity>(r.state, firstId)!;
    const center = findPoint(r.state, first.centerId)!;
    // B10: full-circle patterns step by total/count — the first clone
    // of a 360°/4 pattern lands at 90°, not 120°.
    expect(center.x).toBeCloseTo(10 * Math.cos(Math.PI / 2));
    expect(center.y).toBeCloseTo(10 * Math.sin(Math.PI / 2));
  });

  it('B10: a full 360° pattern spaces N occurrences evenly — no clone stacked on the original', () => {
    let s = emptySketchState();
    const c = addCircle(s, 10, 0, 1); s = c.state;
    const r = circularPatternEntities(s, [c.id], { x: 0, y: 0 }, 2 * Math.PI, 4);
    expect(r.error).toBeUndefined();
    expect(r.affectedIds?.length).toBe(3);
    const angles = r.affectedIds!
      .map(id => findEntity<CircleEntity>(r.state, id)!)
      .map(circ => findPoint(r.state, circ.centerId)!)
      .map(p => ((Math.atan2(p.y, p.x) * 180) / Math.PI + 360) % 360)
      .sort((x, y) => x - y);
    expect(angles[0]).toBeCloseTo(90);
    expect(angles[1]).toBeCloseTo(180);
    expect(angles[2]).toBeCloseTo(270);
  });

  it('B10: partial sweeps keep the endpoint-inclusive convention (180°/3 → 90° and 180°)', () => {
    let s = emptySketchState();
    const c = addCircle(s, 10, 0, 1); s = c.state;
    const r = circularPatternEntities(s, [c.id], { x: 0, y: 0 }, Math.PI, 3);
    expect(r.error).toBeUndefined();
    expect(r.affectedIds?.length).toBe(2);
    const angles = r.affectedIds!
      .map(id => findEntity<CircleEntity>(r.state, id)!)
      .map(circ => findPoint(r.state, circ.centerId)!)
      .map(p => ((Math.atan2(p.y, p.x) * 180) / Math.PI + 360) % 360)
      .sort((x, y) => x - y);
    expect(angles[0]).toBeCloseTo(90);
    expect(angles[1]).toBeCloseTo(180);
  });
});

describe('jogLineAt', () => {
  it('replaces the line with 5 segments forming a Z-jog', () => {
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    const b = addPoint(s, 10, 0); s = b.state;
    const l = addLine(s, a.id, b.id); s = l.state;
    const r = jogLineAt(s, l.id, 0.3, 0.7, 2);  // jog from x=3 to x=7, perp offset 2
    expect(r.error).toBeUndefined();
    expect(r.affectedIds?.length).toBe(5);
    // The original line is gone.
    expect(findEntity(r.state, l.id)).toBeUndefined();
  });
  it('rejects degenerate inputs (zero offset, swapped params, etc.)', () => {
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    const b = addPoint(s, 10, 0); s = b.state;
    const l = addLine(s, a.id, b.id); s = l.state;
    expect(jogLineAt(s, l.id, 0.3, 0.7, 0).error).toBeDefined();    // zero offset
    expect(jogLineAt(s, l.id, 0.7, 0.3, 2).error).toBeDefined();    // swapped t1 / t2
    expect(jogLineAt(s, l.id, -0.1, 0.5, 2).error).toBeDefined();   // t1 < 0
    expect(jogLineAt(s, l.id, 0.5, 1.1, 2).error).toBeDefined();    // t2 > 1
  });
});

describe('stretchEntities', () => {
  it('moves only the point entities in the selection — lines stretch', () => {
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    const b = addPoint(s, 10, 0); s = b.state;
    addLine(s, a.id, b.id); s = addLine(s, a.id, b.id).state;
    const r = stretchEntities(s, [b.id], 5, 0);
    expect(r.error).toBeUndefined();
    expect(findPoint(r.state, a.id)).toMatchObject({ x: 0, y: 0 });
    expect(findPoint(r.state, b.id)).toMatchObject({ x: 15, y: 0 });
  });
  it('selecting only a line does NOT move its endpoints (use Move instead)', () => {
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    const b = addPoint(s, 10, 0); s = b.state;
    const l = addLine(s, a.id, b.id); s = l.state;
    const r = stretchEntities(s, [l.id], 5, 0);
    expect(findPoint(r.state, a.id)).toMatchObject({ x: 0, y: 0 });
    expect(findPoint(r.state, b.id)).toMatchObject({ x: 10, y: 0 });
  });
});

describe('offsetChain', () => {
  it('reconciles a 90° convex corner with an arc filler when fillCorners is on', () => {
    // L-shape: line from (0,0)→(10,0), then (10,0)→(10,10). The
    // convex corner is at (10, 0) — offsetting outward (sidePoint
    // below + right) should produce two offset lines + a quarter
    // arc filler at the corner.
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    const b = addPoint(s, 10, 0); s = b.state;
    const c = addPoint(s, 10, 10); s = c.state;
    const l1 = addLine(s, a.id, b.id); s = l1.state;
    const l2 = addLine(s, b.id, c.id); s = l2.state;
    // sidePoint below for l1 (offset down), right of l2 (offset right)
    // → both offsets go "outward" from the L → convex corner at b.
    const items = [
      { entityId: l1.id, sidePoint: { x: 5, y: -2 } },
      { entityId: l2.id, sidePoint: { x: 12, y: 5 } },
    ];
    const r = offsetChain(s, items, 3, { fillCorners: true });
    expect(r.error).toBeUndefined();
    // 2 offset lines + 1 arc filler.
    expect(r.affectedIds?.length).toBe(3);
    const lastId = r.affectedIds![2];
    const filler = findEntity(r.state, lastId);
    expect(filler?.kind).toBe('arc');
  });
  it('intersect-trims a concave corner without an arc', () => {
    // L-shape same as above but offset INWARD: sidePoint above l1
    // and left of l2 → concave corner → no arc; offsets trim to
    // the (interior) intersection.
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    const b = addPoint(s, 10, 0); s = b.state;
    const c = addPoint(s, 10, 10); s = c.state;
    const l1 = addLine(s, a.id, b.id); s = l1.state;
    const l2 = addLine(s, b.id, c.id); s = l2.state;
    const items = [
      { entityId: l1.id, sidePoint: { x: 5, y: 2 } },
      { entityId: l2.id, sidePoint: { x: 8, y: 5 } },
    ];
    const r = offsetChain(s, items, 3, { fillCorners: true });
    expect(r.error).toBeUndefined();
    // Concave: only 2 offset lines, no filler.
    expect(r.affectedIds?.length).toBe(2);
    for (const id of r.affectedIds!) {
      expect(findEntity(r.state, id)?.kind).toBe('line');
    }
  });
  it('bothDirections doubles the output count', () => {
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    const b = addPoint(s, 10, 0); s = b.state;
    const l = addLine(s, a.id, b.id); s = l.state;
    const r = offsetChain(s, [{ entityId: l.id, sidePoint: { x: 5, y: 1 } }], 2, { bothDirections: true });
    expect(r.error).toBeUndefined();
    expect(r.affectedIds?.length).toBe(2);
  });
  it('reconciles corners when adjacent curves have DISTINCT point IDs at the shared vertex (user-drawn polyline)', () => {
    // Real user workflow: draw line 1 with addLine, then draw line 2
    // with addLine starting at a NEW point that happens to coincide
    // with line 1's end. The two lines visually meet but use
    // separate (coincidence-constrained) point ids — no shared id.
    // Chain detection should still see them as connected and the
    // corner should reconcile.
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    const b1 = addPoint(s, 10, 0); s = b1.state;
    const b2 = addPoint(s, 10, 0); s = b2.state;  // SAME coord as b1, different id
    const c = addPoint(s, 10, 10); s = c.state;
    const l1 = addLine(s, a.id, b1.id); s = l1.state;
    const l2 = addLine(s, b2.id, c.id); s = l2.state;
    const items = [
      { entityId: l1.id, sidePoint: { x: 5, y: -2 } },    // offset down (convex side)
      { entityId: l2.id, sidePoint: { x: 12, y: 5 } },    // offset right
    ];
    const r = offsetChain(s, items, 3, { fillCorners: true });
    expect(r.error).toBeUndefined();
    // 2 offset lines + 1 filler arc — corner was reconciled
    // despite b1 !== b2.
    expect(r.affectedIds?.length).toBe(3);
    expect(findEntity(r.state, r.affectedIds![2])?.kind).toBe('arc');
  });

  it('fully constrains a single-line offset when linkToOriginals is on', () => {
    // SolidWorks-style: offset of a fully-constrained line
    // produces a fully-constrained offset line. Constraint set:
    //   parallel + equal length + 1 perpendicular construction
    //   line + point-line-distance dim. 4 constraints, 4 DOFs
    //   killed (verified by solver spec). A second perpendicular
    //   construction line over-constrained the system per
    //   PlaneGCS's redundancy detection.
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    const b = addPoint(s, 10, 0); s = b.state;
    const l = addLine(s, a.id, b.id); s = l.state;
    const r = offsetChain(s, [{ entityId: l.id, sidePoint: { x: 5, y: 3 } }], 3,
      { linkToOriginals: true });
    expect(r.error).toBeUndefined();
    expect(r.affectedIds?.length).toBe(1);
    const lines = r.state.entities.filter(e => e.kind === 'line');
    expect(lines.length).toBe(3);  // orig + offset + 1 construction
    const construction = lines.filter(l => l.construction === true);
    expect(construction.length).toBe(1);
    const types = r.state.constraints.map(c => c.type);
    expect(types).toContain('parallel');
    expect(types).toContain('equal');
    expect(types).toContain('perpendicular');
    expect(types).toContain('point-line-distance');
    const dim = r.state.constraints.find(c => c.type === 'point-line-distance');
    expect(dim?.placement).toBeDefined();
    expect(dim?.value).toBe(3);
  });

  it('fully constrains a single-arc offset (concentric + radius dim + 2 radial construction lines)', () => {
    let s = emptySketchState();
    const arc = addArc(s, 0, 0, 5, 0, 0, 5, true); s = arc.state;  // quarter arc, CCW
    const r = offsetChain(s, [{ entityId: arc.id, sidePoint: { x: 10, y: 10 } }], 2,
      { linkToOriginals: true });
    expect(r.error).toBeUndefined();
    const types = r.state.constraints.map(co => co.type);
    expect(types).toContain('concentric');
    expect(types).toContain('radius');
    // Two coincident constraints — one per arc endpoint, each
    // pinning the offset endpoint on the radial through the
    // source's matching endpoint.
    expect(types.filter(t => t === 'coincident').length).toBeGreaterThanOrEqual(2);
    // Two construction lines (the radials).
    const construction = r.state.entities.filter(e => e.kind === 'line' && e.construction);
    expect(construction.length).toBe(2);
  });

  it('fully constrains a single-circle offset', () => {
    let s = emptySketchState();
    const c = addCircle(s, 0, 0, 5); s = c.state;
    const r = offsetChain(s, [{ entityId: c.id, sidePoint: { x: 10, y: 0 } }], 2,
      { linkToOriginals: true });
    expect(r.error).toBeUndefined();
    const types = r.state.constraints.map(co => co.type);
    expect(types).toContain('concentric');
    expect(types).toContain('radius');
    const dim = r.state.constraints.find(co => co.type === 'radius' && co.targets[0].entityId !== c.id);
    expect(dim?.value).toBe(7);   // 5 + 2 (outward)
    expect(dim?.placement).toBeDefined();
  });

  it('chain offset: parallel + dim per segment + chain-end perpendicular construction lines + corner coincidents', () => {
    // L-shape polyline of two perpendicular lines. Each offset
    // line gets parallel + a perpendicular-distance dim. Chain
    // ends get perpendicular construction lines pinning the
    // outermost offset endpoints to perpendicular feet of source
    // endpoints. The corner endpoint between adjacent offsets is
    // coincident-pinned (in reconcileCorner). Together these
    // fully constrain an open chain offset.
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    const b1 = addPoint(s, 10, 0); s = b1.state;
    const b2 = addPoint(s, 10, 0); s = b2.state;
    const c = addPoint(s, 10, 10); s = c.state;
    const l1 = addLine(s, a.id, b1.id); s = l1.state;
    const l2 = addLine(s, b2.id, c.id); s = l2.state;
    const items = [
      { entityId: l1.id, sidePoint: { x: 5, y: -2 } },
      { entityId: l2.id, sidePoint: { x: 12, y: 5 } },
    ];
    const r = offsetChain(s, items, 3, { fillCorners: true, linkToOriginals: true });
    expect(r.error).toBeUndefined();
    const parallels = r.state.constraints.filter(co => co.type === 'parallel');
    expect(parallels.length).toBe(2);
    const dims = r.state.constraints.filter(co => co.type === 'point-line-distance');
    expect(dims.length).toBe(2);  // one per segment
    expect(dims.every(d => d.value === 3)).toBe(true);
    // 2 perpendicular construction lines (one per chain end) +
    // 2 perpendicular constraints.
    expect(r.state.constraints.filter(co => co.type === 'perpendicular').length).toBe(2);
    const construction = r.state.entities.filter(e => e.kind === 'line' && e.construction);
    expect(construction.length).toBe(2);
    // The convex corner is implicitly coincident via the filler
    // arc sharing point ids with the adjacent offsets — no
    // explicit coincident constraint needed. (Concave corners
    // would add one in reconcileCorner.)
  });

  it('chain offset: CONCAVE corner merges the two offset corners into one shared endpoint', () => {
    // L-shape but offset INWARD this time — concave corner.
    // Adjacent offsets trim to the intersection. The corner is pinned
    // by MERGING the two near-V endpoints into a single shared point id
    // (SolidWorks-style corner topology), not by an explicit coincident
    // constraint — see reconcileCorner's concave branch.
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    const b1 = addPoint(s, 10, 0); s = b1.state;
    const b2 = addPoint(s, 10, 0); s = b2.state;
    const c = addPoint(s, 10, 10); s = c.state;
    const l1 = addLine(s, a.id, b1.id); s = l1.state;
    const l2 = addLine(s, b2.id, c.id); s = l2.state;
    const items = [
      { entityId: l1.id, sidePoint: { x: 5, y: 2 } },   // offset into the corner interior
      { entityId: l2.id, sidePoint: { x: 8, y: 5 } },
    ];
    const r = offsetChain(s, items, 1, { fillCorners: true, linkToOriginals: true });
    expect(r.error).toBeUndefined();
    // The two offset lines must share a single endpoint id at the merged corner.
    const offsetLines = (r.affectedIds ?? [])
      .map(id => findEntity(r.state, id))
      .filter((e): e is LineEntity => !!e && e.kind === 'line');
    expect(offsetLines.length).toBe(2);
    const [o0, o1] = offsetLines;
    const shared = [o0.startId, o0.endId].find(id => id === o1.startId || id === o1.endId);
    expect(shared).toBeDefined();
  });

  it('handles single-segment queues (no corner pass)', () => {
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    const b = addPoint(s, 10, 0); s = b.state;
    const l = addLine(s, a.id, b.id); s = l.state;
    const r = offsetChain(s, [{ entityId: l.id, sidePoint: { x: 5, y: 2 } }], 1.5, {});
    expect(r.error).toBeUndefined();
    expect(r.affectedIds?.length).toBe(1);
  });

  it('reconciles a line→arc corner (convex): adds an arc filler at the shared vertex', () => {
    // Line: (0, 0) → V=(10, 0). Arc: quarter CW around center
    // (15, 0) from V up to (15, 5). At V the line outgoing is
    // WEST and the arc outgoing is NORTH — a real 90° corner.
    // Offset OUTWARD (line down, arc to larger radius). The
    // offsets diverge → convex → filler arc.
    //
    // IMPORTANT: build the line + arc with a SHARED V point id
    // so the chain detector sees them as connected. addArc /
    // addLine alone wouldn't (they create fresh point ids).
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    const v = addPoint(s, 10, 0); s = v.state;
    const arcCenter = addPoint(s, 15, 0); s = arcCenter.state;
    const arcEnd = addPoint(s, 15, 5); s = arcEnd.state;
    const l = addLine(s, a.id, v.id); s = l.state;
    const arc = addArcByPoints(s, arcCenter.id, v.id, arcEnd.id, false); s = arc.state;  // CW
    const items = [
      { entityId: l.id, sidePoint: { x: 5, y: -2 } },     // offset down
      { entityId: arc.id, sidePoint: { x: 30, y: 5 } },   // sidePoint OUTSIDE → larger radius
    ];
    const r = offsetChain(s, items, 2, { fillCorners: true });
    expect(r.error).toBeUndefined();
    expect(r.affectedIds?.length).toBe(3);  // 2 offsets + 1 filler arc
    const filler = findEntity(r.state, r.affectedIds![2]);
    expect(filler?.kind).toBe('arc');
  });

  it('reconciles a line→arc corner (concave): trims to the line-circle intersection', () => {
    // Same L + arc with shared V, offset INWARD. The corner's
    // interior is the upper-left quadrant; offsetting "into" it
    // means line goes UP (y+) and arc goes LARGER radius (the
    // arc bulges east of V around center (15, 0), so the OUTWARD
    // radial direction at V points WEST → into the interior).
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    const v = addPoint(s, 10, 0); s = v.state;
    const arcCenter = addPoint(s, 15, 0); s = arcCenter.state;
    const arcEnd = addPoint(s, 15, 5); s = arcEnd.state;
    const l = addLine(s, a.id, v.id); s = l.state;
    const arc = addArcByPoints(s, arcCenter.id, v.id, arcEnd.id, false); s = arc.state;
    const items = [
      { entityId: l.id, sidePoint: { x: 5, y: 1 } },     // up — into interior
      { entityId: arc.id, sidePoint: { x: 5, y: 5 } },   // far from arc center → larger radius → moves arc V-end WEST into interior
    ];
    const r = offsetChain(s, items, 1, { fillCorners: true });
    expect(r.error).toBeUndefined();
    expect(r.affectedIds?.length).toBe(2);  // 2 offsets, no filler
  });

  it('reconciles an arc→arc corner (convex): adds an arc filler at the shared vertex', () => {
    // Two arcs meeting at V=(10, 0) with a 90° corner. The
    // shared point id is the key — without it the chain
    // detector would treat them as disconnected.
    let s = emptySketchState();
    const start1 = addPoint(s, 0, 0); s = start1.state;
    const v = addPoint(s, 10, 0); s = v.state;
    const end2 = addPoint(s, 10, 10); s = end2.state;
    const c1 = addPoint(s, 5, 0); s = c1.state;
    const c2 = addPoint(s, 10, 5); s = c2.state;
    // arc1: top semicircle from start1 to v, center c1, CW
    // → outgoing at V (back along arc1) points NORTH.
    const arc1 = addArcByPoints(s, c1.id, start1.id, v.id, false); s = arc1.state;
    // arc2: right-bulging semicircle from v to end2, center c2, CCW
    // → outgoing at V (along sweep) points EAST.
    const arc2 = addArcByPoints(s, c2.id, v.id, end2.id, true); s = arc2.state;
    const items = [
      { entityId: arc1.id, sidePoint: { x: 5, y: 20 } },  // outside arc1 → larger radius
      { entityId: arc2.id, sidePoint: { x: 20, y: 5 } },  // outside arc2 → larger radius
    ];
    const r = offsetChain(s, items, 2, { fillCorners: true });
    expect(r.error).toBeUndefined();
    expect(r.affectedIds?.length).toBe(3);  // 2 offsets + 1 filler arc
    const filler = findEntity(r.state, r.affectedIds![2]);
    expect(filler?.kind).toBe('arc');
  });

  it('skips filler at a convex line→arc corner when fillCorners=false (sharp miter)', () => {
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    const v = addPoint(s, 10, 0); s = v.state;
    const arcCenter = addPoint(s, 15, 0); s = arcCenter.state;
    const arcEnd = addPoint(s, 15, 5); s = arcEnd.state;
    const l = addLine(s, a.id, v.id); s = l.state;
    const arc = addArcByPoints(s, arcCenter.id, v.id, arcEnd.id, false); s = arc.state;
    const items = [
      { entityId: l.id, sidePoint: { x: 5, y: -2 } },
      { entityId: arc.id, sidePoint: { x: 30, y: 5 } },
    ];
    const r = offsetChain(s, items, 2, { fillCorners: false });
    expect(r.error).toBeUndefined();
    expect(r.affectedIds?.length).toBe(2);  // just the two offsets, extended to intersection
  });
});

describe('findChainedEntities', () => {
  it('walks endpoint-connected lines (polyline)', () => {
    // Build a 3-segment polyline: a→b→c→d.
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    const b = addPoint(s, 5, 0); s = b.state;
    const c = addPoint(s, 5, 5); s = c.state;
    const d = addPoint(s, 10, 5); s = d.state;
    const l1 = addLine(s, a.id, b.id); s = l1.state;
    const l2 = addLine(s, b.id, c.id); s = l2.state;
    const l3 = addLine(s, c.id, d.id); s = l3.state;
    // Plus an unrelated disconnected line.
    const e = addPoint(s, 20, 20); s = e.state;
    const f = addPoint(s, 30, 30); s = f.state;
    const l4 = addLine(s, e.id, f.id); s = l4.state;
    const chain = findChainedEntities(s, l1.id);
    expect(chain.has(l1.id)).toBe(true);
    expect(chain.has(l2.id)).toBe(true);
    expect(chain.has(l3.id)).toBe(true);
    expect(chain.has(l4.id)).toBe(false);
  });
  it('does not chain through circles (no endpoints)', () => {
    let s = emptySketchState();
    const c = addCircle(s, 0, 0, 5); s = c.state;
    expect(findChainedEntities(s, c.id).size).toBe(1);
  });
  it('chains through construction curves (construction is a valid offset source)', () => {
    let s = emptySketchState();
    const a = addPoint(s, 0, 0); s = a.state;
    const b = addPoint(s, 5, 0); s = b.state;
    const c = addPoint(s, 5, 5); s = c.state;
    const l1 = addLine(s, a.id, b.id); s = l1.state;
    const l2 = addLine(s, b.id, c.id, { construction: true }); s = l2.state;  // construction
    const chain = findChainedEntities(s, l1.id);
    // Construction is allowed as an offset source (see findChainedEntities /
    // offsetCurve), so the walk reaches l2 through the shared endpoint.
    expect(chain.has(l1.id)).toBe(true);
    expect(chain.has(l2.id)).toBe(true);
  });
});
