import { describe, it, expect } from 'vitest';
import { dimensionRenders, previewDimension, formatDimensionText } from './dimensions';
import type {
  SketchState, PointEntity, LineEntity, CircleEntity, ArcEntity, SketchConstraint,
} from './types';

function state(...things: Array<PointEntity | LineEntity | CircleEntity | ArcEntity | SketchConstraint>): SketchState {
  const entities = things.filter(t => 'kind' in t && t.kind !== undefined && !('targets' in t)) as Array<PointEntity | LineEntity | CircleEntity | ArcEntity>;
  const constraints = things.filter(t => 'targets' in t) as SketchConstraint[];
  return { entities, constraints };
}

describe('formatDimensionText', () => {
  it('always appends the unit suffix on length dims', () => {
    expect(formatDimensionText('radius', 5, undefined, 'mm')).toBe('R 5 mm');
    expect(formatDimensionText('radius', 5.5, undefined, 'mm')).toBe('R 5.5 mm');
    expect(formatDimensionText('diameter', 10, undefined, 'mm')).toBe('⌀ 10 mm');
    expect(formatDimensionText('horizontal-distance', 10, undefined, 'mm')).toBe('↔ 10 mm');
    expect(formatDimensionText('vertical-distance', 5, undefined, 'mm')).toBe('↕ 5 mm');
  });
  it('formats angle in degrees with °', () => {
    expect(formatDimensionText('angle', Math.PI / 2, undefined, 'mm')).toBe('90°');
    expect(formatDimensionText('angle', Math.PI / 4, undefined, 'mm')).toBe('45°');
  });
  it('uses the per-dim unit override when present', () => {
    // 25.4 mm stored, override = in → "1 in"
    expect(formatDimensionText('distance', 25.4, 'in', 'mm')).toBe('1 in');
    expect(formatDimensionText('distance', 25.4, 'in', 'in')).toBe('1 in');
  });
});

describe('dimensionRenders', () => {
  it('emits one render per dimensional constraint, skips geometric ones', () => {
    const a: PointEntity = { kind: 'point', id: 'a', x: 0, y: 0 };
    const b: PointEntity = { kind: 'point', id: 'b', x: 10, y: 0 };
    const dist: SketchConstraint = { id: 'cd', type: 'distance', targets: [{ entityId: 'a' }, { entityId: 'b' }], value: 10 };
    const coincident: SketchConstraint = { id: 'cc', type: 'coincident', targets: [{ entityId: 'a' }, { entityId: 'b' }] };
    const renders = dimensionRenders(state(a, b, dist, coincident));
    expect(renders.length).toBe(1);
    expect(renders[0].constraintId).toBe('cd');
    expect(renders[0].text).toBe('10 mm');
  });

  it('distance render includes extension lines from each measured point to the dim line', () => {
    const a: PointEntity = { kind: 'point', id: 'a', x: 0, y: 0 };
    const b: PointEntity = { kind: 'point', id: 'b', x: 10, y: 0 };
    const c: SketchConstraint = {
      id: 'cd', type: 'distance', targets: [{ entityId: 'a' }, { entityId: 'b' }], value: 10,
      placement: { x: 5, y: 6 },  // 6 units above the segment
    };
    const [r] = dimensionRenders(state(a, b, c));
    expect(r.dimensionLine).not.toBeNull();
    // Dim line is parallel to the segment, offset perpendicular by 6.
    expect(r.dimensionLine![0]).toEqual({ x: 0, y: 6 });
    expect(r.dimensionLine![1]).toEqual({ x: 10, y: 6 });
    // Extension lines: A → A's projection, B → B's projection.
    expect(r.extensionLines).toHaveLength(2);
    expect(r.extensionLines[0][0]).toMatchObject({ x: 0, y: 0 });
    expect(r.extensionLines[0][1]).toEqual({ x: 0, y: 6 });
    expect(r.extensionLines[1][0]).toMatchObject({ x: 10, y: 0 });
    expect(r.extensionLines[1][1]).toEqual({ x: 10, y: 6 });
  });

  it('radius render is a leader from the curve edge out to the placement', () => {
    const c: PointEntity = { kind: 'point', id: 'c', x: 0, y: 0 };
    const k: CircleEntity = { kind: 'circle', id: 'k', centerId: 'c', radius: 10 };
    const r: SketchConstraint = {
      id: 'cr', type: 'radius', targets: [{ entityId: 'k' }], value: 10,
      placement: { x: 20, y: 0 },  // placed along +x
    };
    const [render] = dimensionRenders(state(c, k, r));
    expect(render.text).toBe('R 10 mm');
    // Leader starts at the edge (10, 0) and ends at the placement (20, 0).
    expect(render.dimensionLine![0]).toEqual({ x: 10, y: 0 });
    expect(render.dimensionLine![1]).toEqual({ x: 20, y: 0 });
    // No witness lines for radius dimensions.
    expect(render.extensionLines).toEqual([]);
  });

  it('radial-distance render leaders from the inner radius to the outer radius', () => {
    const c: PointEntity = { kind: 'point', id: 'c', x: 0, y: 0 };
    const inner: CircleEntity = { kind: 'circle', id: 'i', centerId: 'c', radius: 4 };
    const outer: CircleEntity = { kind: 'circle', id: 'o', centerId: 'c', radius: 7 };
    const rd: SketchConstraint = {
      id: 'crd', type: 'radial-distance',
      targets: [{ entityId: 'i' }, { entityId: 'o' }], value: 3,
      placement: { x: 12, y: 0 },  // along +x
    };
    const [render] = dimensionRenders(state(c, inner, outer, rd));
    expect(render.text).toBe('ΔR 3 mm');
    // Dimension line spans the gap: inner edge (4,0) → outer edge (7,0).
    expect(render.dimensionLine![0]).toEqual({ x: 4, y: 0 });
    expect(render.dimensionLine![1]).toEqual({ x: 7, y: 0 });
    // Extension from the outer edge out to the placed label.
    expect(render.extensionLines[0][0]).toEqual({ x: 7, y: 0 });
    expect(render.extensionLines[0][1]).toEqual({ x: 12, y: 0 });
  });

  it('uses a sensible default placement when constraint.placement is missing', () => {
    const a: PointEntity = { kind: 'point', id: 'a', x: 0, y: 0 };
    const b: PointEntity = { kind: 'point', id: 'b', x: 10, y: 0 };
    const c: SketchConstraint = { id: 'cd', type: 'distance', targets: [{ entityId: 'a' }, { entityId: 'b' }], value: 10 };
    const [r] = dimensionRenders(state(a, b, c));
    // Still emits a dim line at some non-zero offset above the segment.
    expect(r.dimensionLine).not.toBeNull();
    expect(r.dimensionLine![0].y).toBeGreaterThan(0);
  });
});

describe('previewDimension', () => {
  it('builds a render for an in-progress Smart Dim pick + cursor placement', () => {
    const a: PointEntity = { kind: 'point', id: 'a', x: 0, y: 0 };
    const b: PointEntity = { kind: 'point', id: 'b', x: 10, y: 0 };
    const r = previewDimension(state(a, b), 'distance', ['a', 'b'], 10, { x: 5, y: 4 });
    expect(r).not.toBeNull();
    expect(r!.constraintId).toBe('__preview__');
    expect(r!.dimensionLine![0]).toEqual({ x: 0, y: 4 });
    expect(r!.dimensionLine![1]).toEqual({ x: 10, y: 4 });
  });
});

describe('point-line-distance render — parallel-lines case', () => {
  it('uses a perpendicular dim line + parallel extension lines when the picked point is on a line parallel to the target', () => {
    // l1: horizontal at y=10, l2: horizontal at y=0. p is l1.startId.
    const p1a: PointEntity = { kind: 'point', id: 'p1a', x: 0, y: 10 };
    const p1b: PointEntity = { kind: 'point', id: 'p1b', x: 5, y: 10 };
    const p2a: PointEntity = { kind: 'point', id: 'p2a', x: 0, y: 0 };
    const p2b: PointEntity = { kind: 'point', id: 'p2b', x: 5, y: 0 };
    const l1: LineEntity = { kind: 'line', id: 'l1', startId: 'p1a', endId: 'p1b' };
    const l2: LineEntity = { kind: 'line', id: 'l2', startId: 'p2a', endId: 'p2b' };
    // Placement at x=12 (past the right end of both lines). Dim line
    // should be vertical at x=12, spanning y=0..10.
    const r = previewDimension(
      state(p1a, p1b, p2a, p2b, l1, l2),
      'point-line-distance', ['p1a', 'l2'], 10, { x: 12, y: 5 },
    );
    expect(r).not.toBeNull();
    const [d0, d1] = r!.dimensionLine!;
    expect(d0.x).toBeCloseTo(12);
    expect(d1.x).toBeCloseTo(12);
    expect(Math.abs(d0.y - d1.y)).toBeCloseTo(10);
    // Extension lines should run ALONG the source lines (horizontal),
    // each from an endpoint OF that line out to the dim line.
    expect(r!.extensionLines).toHaveLength(2);
    for (const [from, to] of r!.extensionLines) {
      // |Δy| should be ~0 (extension is along the horizontal source line).
      expect(Math.abs(to.y - from.y)).toBeLessThan(1e-6);
    }
  });

  it('renders a chord-distance dim between the arc’s start and end points', () => {
    const c: PointEntity = { kind: 'point', id: 'c', x: 0, y: 0 };
    const s: PointEntity = { kind: 'point', id: 's', x: 5, y: 0 };
    const e: PointEntity = { kind: 'point', id: 'e', x: 0, y: 5 };
    const a: ArcEntity = { kind: 'arc', id: 'a', centerId: 'c', startId: 's', endId: 'e', radius: 5, ccw: true };
    const r = previewDimension(state(c, s, e, a), 'chord-distance', ['a'], 7.07, { x: 5, y: 5 });
    expect(r).not.toBeNull();
    // Same render shape as a distance dim between (5,0) and (0,5).
    expect(r!.dimensionLine).not.toBeNull();
    expect(r!.extensionLines).toHaveLength(2);
    expect(r!.text).toContain('—');
  });

  it('wraps driven dim text in parentheses', () => {
    const a: PointEntity = { kind: 'point', id: 'a', x: 0, y: 0 };
    const b: PointEntity = { kind: 'point', id: 'b', x: 10, y: 0 };
    const driven: SketchConstraint = {
      id: 'cdriven', type: 'distance',
      targets: [{ entityId: 'a' }, { entityId: 'b' }],
      value: 10, driven: true,
    };
    const r = dimensionRenders(state(a, b, driven));
    expect(r.length).toBe(1);
    expect(r[0].text).toBe('(10 mm)');
  });

  it('falls back to the original point-to-line render when the point is not on a parallel line', () => {
    // p is a free-standing point, not an endpoint of any line. The
    // original render extends BOTH p and its foot perpendicular to
    // `l` by the same offset, producing a dim line along that
    // perpendicular (extension lines along the perp too).
    const p: PointEntity = { kind: 'point', id: 'p', x: 5, y: 10 };
    const a: PointEntity = { kind: 'point', id: 'a', x: 0, y: 0 };
    const b: PointEntity = { kind: 'point', id: 'b', x: 10, y: 0 };
    const l: LineEntity = { kind: 'line', id: 'l', startId: 'a', endId: 'b' };
    const r = previewDimension(state(p, a, b, l), 'point-line-distance', ['p', 'l'], 10, { x: 5, y: 15 });
    expect(r).not.toBeNull();
    const [d0, d1] = r!.dimensionLine!;
    // dim line is vertical (along perp to horizontal l): both x=5, y
    // differs by |p.y - foot.y| = 10.
    expect(d0.x).toBeCloseTo(5);
    expect(d1.x).toBeCloseTo(5);
    expect(Math.abs(d0.y - d1.y)).toBeCloseTo(10);
  });
});

describe('point-line-distance render — non-parallel case (leader lines)', () => {
  it('offsets along the line so witness + dim lines are NOT collinear', () => {
    // Line l along x-axis (y=0); point p above it at (4, 6) → perp distance 6.
    const la: PointEntity = { kind: 'point', id: 'la', x: 0, y: 0 };
    const lb: PointEntity = { kind: 'point', id: 'lb', x: 10, y: 0 };
    const p: PointEntity = { kind: 'point', id: 'p', x: 4, y: 6 };
    const l: LineEntity = { kind: 'line', id: 'l', startId: 'la', endId: 'lb' };
    const r = previewDimension(
      state(la, lb, p, l), 'point-line-distance', ['p', 'l'], 6, { x: 12, y: 3 },
    );
    expect(r).not.toBeNull();
    const [d0, d1] = r!.dimensionLine!;
    // Dim line spans the perpendicular gap (Δy = 6), i.e. it is vertical.
    expect(Math.abs(d1.y - d0.y)).toBeCloseTo(6, 6);
    expect(Math.abs(d1.x - d0.x)).toBeCloseTo(0, 6);
    // Foot is at (4,0); placement (12,3) → along = (12-4)=8 → dim line at x=12.
    expect(d0.x).toBeCloseTo(12, 6);
    // Witness lines run ALONG the line (horizontal), not collapsed onto the dim line.
    const [[wp0, wp1], [wf0, wf1]] = r!.extensionLines;
    expect(wp0).toMatchObject({ x: 4, y: 6 });   // from the point
    expect(wp1.x).toBeCloseTo(12, 6);            // out to the dim line
    expect(wp1.y).toBeCloseTo(6, 6);             // still at the point's level (horizontal witness)
    expect(wf0).toMatchObject({ x: 4, y: 0 });   // from the foot on the line
    expect(wf1.x).toBeCloseTo(12, 6);
    expect(wf1.y).toBeCloseTo(0, 6);
  });
});
