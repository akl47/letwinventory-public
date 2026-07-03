import { describe, it, expect } from 'vitest';
import { emptySketchState, addPoint, addLine, addCircle, addArc, addArcByPoints, addConstraint } from './store';
import {
  trimAt, extendLine, splitLineAt, mirrorEntities, offsetCurve, offsetChain, filletLines, chamferLines, jogLineAt,
  moveEntities, copyEntities, rotateEntities, scaleEntities,
  linearPatternEntities, circularPatternEntities, stretchEntities,
  findChainedEntities,
} from './sketchEditOps';
import { findEntity, findPoint } from './types';
import type { LineEntity, ArcEntity, CircleEntity, PointEntity } from './types';

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

  it('rewires radius + coincident constraints onto the replacement arc', () => {
    // SolidWorks-style: trimming a circle that has a radius dim and a
    // point-on-circumference constraint should NOT silently drop those
    // constraints. They should re-anchor onto the new arc, so the
    // resulting sketch stays fully constrained.
    let s = emptySketchState();
    const c = addCircle(s, 0, 0, 5); s = c.state;
    const onCircum = addPoint(s, 5, 0); s = onCircum.state;
    // Anchor the radius via a coincident point on the circumference.
    const cc = addConstraint(s, 'coincident', [onCircum.id, c.id]); s = cc.state;
    // Pre-trim radius constraint that should also follow the arc.
    const rc = addConstraint(s, 'radius', [c.id], 5); s = rc.state;
    // Crossing line so trim has something to split against.
    const a = addPoint(s, 0, -10); s = a.state;
    const b = addPoint(s, 0,  10); s = b.state;
    const l = addLine(s, a.id, b.id); s = l.state;
    const r = trimAt(s, c.id, { x: 5, y: 0 });
    expect(r.error).toBeUndefined();
    expect(r.affectedIds && r.affectedIds.length).toBe(1);
    const newArcId = r.affectedIds![0];
    // Every constraint that referenced the circle now references the arc.
    const referencesCircle = r.state.constraints.some(con =>
      con.targets.some(t => t.entityId === c.id),
    );
    expect(referencesCircle).toBe(false);
    const radiusRef = r.state.constraints.find(con => con.type === 'radius');
    expect(radiusRef?.targets[0].entityId).toBe(newArcId);
    const coinRef = r.state.constraints.find(con =>
      con.type === 'coincident' && con.targets.some(t => t.entityId === newArcId),
    );
    expect(coinRef).toBeDefined();
    expect(coinRef!.targets.map(t => t.entityId)).toContain(onCircum.id);
  });

  it('rewires constraints when trimming an arc into a single sub-arc', () => {
    let s = emptySketchState();
    // Half-circle from (5,0) → (-5,0) above the x-axis.
    const a = addArc(s, 0, 0, 5, 0, -5, 0, true); s = a.state;
    const arcEnt = findEntity(s, a.id) as any;
    const onArc = addPoint(s, 0, 5); s = onArc.state;
    const cc = addConstraint(s, 'coincident', [onArc.id, a.id]); s = cc.state;
    // Vertical cut line at x=0 — crosses the arc at (0, 5).
    const pA = addPoint(s, 0, -10); s = pA.state;
    const pB = addPoint(s, 0,  10); s = pB.state;
    const ln = addLine(s, pA.id, pB.id); s = ln.state;
    // Click on the right half of the arc — keeps the left half.
    const r = trimAt(s, a.id, { x: 3, y: 4 });
    expect(r.error).toBeUndefined();
    expect((r.affectedIds || []).length).toBeGreaterThanOrEqual(1);
    const firstArc = r.affectedIds![0];
    const referencesOldArc = r.state.constraints.some(con =>
      con.targets.some(t => t.entityId === a.id),
    );
    expect(referencesOldArc).toBe(false);
    const coinRef = r.state.constraints.find(con =>
      con.type === 'coincident' && con.targets.some(t => t.entityId === firstArc),
    );
    expect(coinRef).toBeDefined();
    void arcEnt;
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
    expect(center.x).toBeCloseTo(10 * Math.cos(2 * Math.PI / 3));
    expect(center.y).toBeCloseTo(10 * Math.sin(2 * Math.PI / 3));
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
