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
