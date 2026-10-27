import { describe, it, expect } from 'vitest';
import { dimensionRenders, previewDimension, previewEdgeDimension, resolveEdgeDim, formatDimensionText } from './dimensions';
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

  it('3-point vertex angle renders a leader on the ray bisector (REQ 890)', () => {
    const v: PointEntity = { kind: 'point', id: 'v', x: 0, y: 0 };
    const a: PointEntity = { kind: 'point', id: 'a', x: 10, y: 0 };
    const b: PointEntity = { kind: 'point', id: 'b', x: 0, y: 10 };
    const ang: SketchConstraint = {
      id: 'ca', type: 'angle',
      targets: [{ entityId: 'a' }, { entityId: 'v' }, { entityId: 'b' }],
      value: Math.PI / 2,
    };
    const [r] = dimensionRenders(state(v, a, b, ang));
    expect(r).toBeTruthy();
    expect(r.text).toContain('90');
    // Default label anchor sits off the vertex along the 45° bisector.
    expect(r.labelAnchor.x).toBeGreaterThan(0);
    expect(r.labelAnchor.y).toBeGreaterThan(0);
    expect(r.labelAnchor.x).toBeCloseTo(r.labelAnchor.y, 6);
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
    // Solid label leader (NOT a witness line — no gap/overshoot styling)
    // from the outer edge out to the placed label.
    expect(render.extensionLines).toEqual([]);
    expect(render.labelLeader![0]).toEqual({ x: 7, y: 0 });
    expect(render.labelLeader![1]).toEqual({ x: 12, y: 0 });
  });

  it('radius render carries the single-arrow leader flag', () => {
    const c: PointEntity = { kind: 'point', id: 'c', x: 0, y: 0 };
    const k: CircleEntity = { kind: 'circle', id: 'k', centerId: 'c', radius: 10 };
    const r: SketchConstraint = {
      id: 'cr', type: 'radius', targets: [{ entityId: 'k' }], value: 10,
      placement: { x: 20, y: 0 },
    };
    const [render] = dimensionRenders(state(c, k, r));
    expect(render.leader).toBe(true);
    expect(render.curve).toEqual({ center: { x: 0, y: 0 }, radius: 10 });
  });

  // SolidWorks drag behavior: the label slides ALONG the dimension line
  // following the placement, instead of being pinned to the midpoint.
  it('label slides along the dim line to the placement projection', () => {
    const a: PointEntity = { kind: 'point', id: 'a', x: 0, y: 0 };
    const b: PointEntity = { kind: 'point', id: 'b', x: 10, y: 0 };
    const c: SketchConstraint = {
      id: 'cd', type: 'distance', targets: [{ entityId: 'a' }, { entityId: 'b' }], value: 10,
      placement: { x: 8, y: 6 },  // near B's end, 6 above
    };
    const [r] = dimensionRenders(state(a, b, c));
    expect(r.labelAnchor).toEqual({ x: 8, y: 6 });
    expect(r.labelLeader).toBeUndefined();
    expect(r.labelOutside).toBeUndefined();
  });

  it('label dragged past the span grows a leader and flips arrows outside', () => {
    const a: PointEntity = { kind: 'point', id: 'a', x: 0, y: 0 };
    const b: PointEntity = { kind: 'point', id: 'b', x: 10, y: 0 };
    const c: SketchConstraint = {
      id: 'cd', type: 'distance', targets: [{ entityId: 'a' }, { entityId: 'b' }], value: 10,
      placement: { x: 15, y: 6 },  // beyond B's end
    };
    const [r] = dimensionRenders(state(a, b, c));
    expect(r.labelAnchor).toEqual({ x: 15, y: 6 });
    // Leader runs from the nearest dim-line end (B's projection) to the label.
    expect(r.labelLeader![0]).toEqual({ x: 10, y: 6 });
    expect(r.labelLeader![1]).toEqual({ x: 15, y: 6 });
    expect(r.labelOutside).toBe(true);
  });

  it('diameter label outside the circle renders as a single-arrow radial leader (SW style)', () => {
    const c: PointEntity = { kind: 'point', id: 'c', x: 0, y: 0 };
    const k: CircleEntity = { kind: 'circle', id: 'k', centerId: 'c', radius: 5 };
    const d: SketchConstraint = {
      id: 'cdia', type: 'diameter', targets: [{ entityId: 'k' }], value: 10,
      placement: { x: 12, y: 0 },  // outside the circle along +x
    };
    const [r] = dimensionRenders(state(c, k, d));
    // Same layout as a radius dim: leader from the near edge to the label,
    // arrowhead only at the curve, with the curve info for the viewer's
    // bend-aware tangency construction.
    expect(r.leader).toBe(true);
    expect(r.dimensionLine![0]).toEqual({ x: 5, y: 0 });
    expect(r.dimensionLine![1]).toEqual({ x: 12, y: 0 });
    expect(r.labelAnchor).toEqual({ x: 12, y: 0 });
    expect(r.curve).toEqual({ center: { x: 0, y: 0 }, radius: 5 });
    expect(r.labelLeader).toBeUndefined();
  });

  it('diameter label inside the circle rides the dim line with no leader', () => {
    const c: PointEntity = { kind: 'point', id: 'c', x: 0, y: 0 };
    const k: CircleEntity = { kind: 'circle', id: 'k', centerId: 'c', radius: 5 };
    const d: SketchConstraint = {
      id: 'cdia', type: 'diameter', targets: [{ entityId: 'k' }], value: 10,
      placement: { x: 2, y: 0 },
    };
    const [r] = dimensionRenders(state(c, k, d));
    expect(r.labelAnchor).toEqual({ x: 2, y: 0 });
    expect(r.labelLeader).toBeUndefined();
  });

  it('angle label follows the placement angle around the arc', () => {
    // Two lines from the origin: along +x and +y.
    const o: PointEntity = { kind: 'point', id: 'o', x: 0, y: 0 };
    const ax: PointEntity = { kind: 'point', id: 'ax', x: 10, y: 0 };
    const ay: PointEntity = { kind: 'point', id: 'ay', x: 0, y: 10 };
    const o2: PointEntity = { kind: 'point', id: 'o2', x: 0, y: 0 };
    const lx: LineEntity = { kind: 'line', id: 'lx', startId: 'o', endId: 'ax' };
    const ly: LineEntity = { kind: 'line', id: 'ly', startId: 'o2', endId: 'ay' };
    const ang: SketchConstraint = {
      id: 'ca', type: 'angle', targets: [{ entityId: 'lx' }, { entityId: 'ly' }],
      value: Math.PI / 2,
      // ~30° above +x, radius 8 → label should sit at that angle, not the 45° bisector.
      placement: { x: 8 * Math.cos(Math.PI / 6), y: 8 * Math.sin(Math.PI / 6) },
    };
    const [r] = dimensionRenders(state(o, ax, ay, o2, lx, ly, ang));
    expect(r.arc).toBeTruthy();
    const labelAng = Math.atan2(r.labelAnchor.y, r.labelAnchor.x);
    expect(labelAng).toBeCloseTo(Math.PI / 6, 6);
    // On the span → no extension arc.
    expect(r.arcExtension).toBeUndefined();
  });

  it('angle arc beyond the line ends emits extension lines along the rays', () => {
    const o: PointEntity = { kind: 'point', id: 'o', x: 0, y: 0 };
    const ax: PointEntity = { kind: 'point', id: 'ax', x: 4, y: 0 };
    const ay: PointEntity = { kind: 'point', id: 'ay', x: 0, y: 4 };
    const o2: PointEntity = { kind: 'point', id: 'o2', x: 0, y: 0 };
    const lx: LineEntity = { kind: 'line', id: 'lx', startId: 'o', endId: 'ax' };
    const ly: LineEntity = { kind: 'line', id: 'ly', startId: 'o2', endId: 'ay' };
    const ang: SketchConstraint = {
      id: 'ca', type: 'angle', targets: [{ entityId: 'lx' }, { entityId: 'ly' }],
      value: Math.PI / 2,
      // Radius 10 — past both lines' 4-unit reach.
      placement: { x: 10 * Math.cos(Math.PI / 4), y: 10 * Math.sin(Math.PI / 4) },
    };
    const [r] = dimensionRenders(state(o, ax, ay, o2, lx, ly, ang));
    expect(r.extensionLines).toHaveLength(2);
    // Each extension runs from the line's physical end out to the arc radius.
    const lens = r.extensionLines.map(([f, t]) => Math.hypot(t.x - f.x, t.y - f.y));
    for (const L of lens) expect(L).toBeCloseTo(6, 6);
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

describe('point-to-edge dimension (externalRef → projected model edge)', () => {
  // Horizontal projected edge along y=0; keyed by the externalRef edgeId
  // (= onEdgeLookupKey for a local ref).
  const edge: [{ x: number; y: number }, { x: number; y: number }] = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
  const edges = () => new Map([['f1/e0', edge]]);
  const pointToEdge = (driven = false): SketchConstraint => ({
    id: 'cpe', type: 'point-line-distance', targets: [{ entityId: 'p' }],
    value: 6, placement: { x: 12, y: 3 }, driven,
    externalRef: { scope: 'local', featureId: 'f1', edgeId: 'f1/e0' },
  });

  it('renders the perpendicular distance from the sketch point to the projected edge', () => {
    const p: PointEntity = { kind: 'point', id: 'p', x: 4, y: 6 };
    const r = dimensionRenders(state(p, pointToEdge()), 'mm', edges());
    expect(r.length).toBe(1);
    expect(r[0].constraintId).toBe('cpe');
    const [d0, d1] = r[0].dimensionLine!;
    expect(Math.abs(d1.y - d0.y)).toBeCloseTo(6, 6); // perpendicular gap to y=0
    expect(d0.x).toBeCloseTo(12, 6);                 // placed at the cursor offset
  });

  it('renders nothing when the edge is absent from the live candidate map', () => {
    const p: PointEntity = { kind: 'point', id: 'p', x: 4, y: 6 };
    expect(dimensionRenders(state(p, pointToEdge()), 'mm', new Map()).length).toBe(0);
  });

  it('wraps a driven (reference) point-to-edge dim in parentheses', () => {
    const p: PointEntity = { kind: 'point', id: 'p', x: 4, y: 6 };
    const r = dimensionRenders(state(p, pointToEdge(true)), 'mm', edges());
    expect(r.length).toBe(1);
    expect(r[0].text.startsWith('(')).toBe(true);
  });
});

// REQ 886/907 — the SINGLE decision function behind the live preview, the
// Smart-Dim commit, and the relations-toolbar edge-dim appliers.
describe('resolveEdgeDim', () => {
  const edge: [{ x: number; y: number }, { x: number; y: number }] = [{ x: 0, y: 0 }, { x: 10, y: 0 }];

  function lineState(x1: number, y1: number, x2: number, y2: number): SketchState {
    const a: PointEntity = { kind: 'point', id: 'a', x: x1, y: y1 };
    const b: PointEntity = { kind: 'point', id: 'b', x: x2, y: y2 };
    const l: LineEntity = { kind: 'line', id: 'l', startId: 'a', endId: 'b' };
    return state(a, b, l);
  }

  it('point → perpendicular distance to the edge', () => {
    const p: PointEntity = { kind: 'point', id: 'p', x: 4, y: 6 };
    const spec = resolveEdgeDim(state(p), p, edge)!;
    expect(spec.type).toBe('point-line-distance');
    expect(spec.targetId).toBe('p');
    expect(spec.value).toBeCloseTo(6, 9);
  });

  it('angled line → angle between the lines (radians)', () => {
    const s = lineState(0, 0, 10, 10); // 45° to the horizontal edge
    const line = s.entities.find(e => e.id === 'l')!;
    const spec = resolveEdgeDim(s, line, edge)!;
    expect(spec.type).toBe('angle');
    expect(spec.targetId).toBe('l');
    expect(spec.value).toBeCloseTo(Math.PI / 4, 9);
  });

  it('parallel line → offset distance from its start endpoint', () => {
    const s = lineState(2, 5, 12, 5); // parallel to the edge, 5 above
    const line = s.entities.find(e => e.id === 'l')!;
    const spec = resolveEdgeDim(s, line, edge)!;
    expect(spec.type).toBe('point-line-distance');
    expect(spec.targetId).toBe('a');
    expect(spec.value).toBeCloseTo(5, 9);
  });

  it('non point/line entities resolve to null', () => {
    const c: PointEntity = { kind: 'point', id: 'c', x: 0, y: 0 };
    const k: CircleEntity = { kind: 'circle', id: 'k', centerId: 'c', radius: 3 };
    expect(resolveEdgeDim(state(c, k), k, edge)).toBeNull();
  });
});

describe('previewEdgeDimension', () => {
  const edge: [{ x: number; y: number }, { x: number; y: number }] = [{ x: 0, y: 0 }, { x: 10, y: 0 }];

  it('previews the perpendicular distance for a point, dim line following the cursor', () => {
    const p: PointEntity = { kind: 'point', id: 'p', x: 4, y: 6 };
    const r = previewEdgeDimension(state(p), p, edge, { x: 12, y: 3 });
    expect(r).not.toBeNull();
    const [d0, d1] = r!.dimensionLine!;
    expect(Math.abs(d1.y - d0.y)).toBeCloseTo(6, 6);
    expect(d0.x).toBeCloseTo(12, 6);
    expect(r!.text).toContain('6');
  });

  it('previews an ANGLE (arc render) for a non-parallel line — same decision as the commit', () => {
    const a: PointEntity = { kind: 'point', id: 'a', x: 0, y: 0 };
    const b: PointEntity = { kind: 'point', id: 'b', x: 10, y: 10 };
    const l: LineEntity = { kind: 'line', id: 'l', startId: 'a', endId: 'b' };
    const s = state(a, b, l);
    const r = previewEdgeDimension(s, l, edge, { x: 6, y: 2 });
    expect(r).not.toBeNull();
    expect(r!.arc).toBeTruthy();       // full angle render, not a distance layout
    expect(r!.text).toContain('45');   // 45° measured live
  });
});
