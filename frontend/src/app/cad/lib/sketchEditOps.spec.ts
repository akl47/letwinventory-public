import { describe, it, expect } from 'vitest';
import { emptySketchState, addPoint, addLine, addCircle, addArc } from './store';
import {
  trimAt, extendLine, splitLineAt, mirrorEntities, offsetCurve, filletLines, chamferLines,
  moveEntities, copyEntities, rotateEntities, scaleEntities,
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

  it('deletes the entire line when no other curves intersect it', () => {
    let s = emptySketchState();
    const main = horizontalLine(s); s = main.state;
    const r = trimAt(s, main.lineId, { x: 5, y: 0 });
    expect(r.error).toBeUndefined();
    expect(findEntity(r.state, main.lineId)).toBeUndefined();
    expect(lineCount(r.state)).toBe(0);
  });

  it('refuses to trim construction geometry', () => {
    let s = emptySketchState();
    const main = horizontalLine(s); s = main.state;
    // Mark the line as construction.
    s = {
      ...s,
      entities: s.entities.map(e => e.id === main.lineId ? { ...e, construction: true } : e),
    };
    const r = trimAt(s, main.lineId, { x: 5, y: 0 });
    expect(r.error).toBeDefined();
    expect(findEntity(r.state, main.lineId)).toBeDefined();
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
