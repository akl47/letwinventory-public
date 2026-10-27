import { describe, it, expect } from 'vitest';
import { constraintIconsForEntity } from './constraintIcons';
import type { SketchState, PointEntity, LineEntity, SketchConstraint } from './types';

function state(...things: Array<PointEntity | LineEntity | SketchConstraint>): SketchState {
  const entities = things.filter(t => 'kind' in t && !('targets' in t)) as Array<PointEntity | LineEntity>;
  const constraints = things.filter(t => 'targets' in t) as SketchConstraint[];
  return { entities, constraints };
}

describe('constraintIconsForEntity', () => {
  it('returns a group with one icon per geometric constraint touching the entity', () => {
    const a: PointEntity = { kind: 'point', id: 'a', x: 0, y: 0 };
    const b: PointEntity = { kind: 'point', id: 'b', x: 10, y: 0 };
    const l: LineEntity = { kind: 'line', id: 'l1', startId: 'a', endId: 'b' };
    const h: SketchConstraint = { id: 'ch', type: 'horizontal', targets: [{ entityId: 'l1' }] };
    const fx: SketchConstraint = { id: 'cf', type: 'fixed', targets: [{ entityId: 'a' }] };
    const group = constraintIconsForEntity(state(a, b, l, h, fx), 'l1');
    expect(group).not.toBeNull();
    expect(group!.icons.map(i => i.constraintType).sort()).toEqual(['fixed', 'horizontal']);
  });

  it('skips dimensional constraints', () => {
    const a: PointEntity = { kind: 'point', id: 'a', x: 0, y: 0 };
    const b: PointEntity = { kind: 'point', id: 'b', x: 10, y: 0 };
    const l: LineEntity = { kind: 'line', id: 'l1', startId: 'a', endId: 'b' };
    const d: SketchConstraint = { id: 'cd', type: 'distance', targets: [{ entityId: 'a' }, { entityId: 'b' }], value: 10 };
    const h: SketchConstraint = { id: 'ch', type: 'horizontal', targets: [{ entityId: 'l1' }] };
    const group = constraintIconsForEntity(state(a, b, l, d, h), 'l1');
    expect(group!.icons.map(i => i.constraintType)).toEqual(['horizontal']);
  });

  it('does not emit duplicate icons for one constraint that hits multiple controlled points', () => {
    const a: PointEntity = { kind: 'point', id: 'a', x: 0, y: 0 };
    const b: PointEntity = { kind: 'point', id: 'b', x: 10, y: 0 };
    const l: LineEntity = { kind: 'line', id: 'l1', startId: 'a', endId: 'b' };
    const c: SketchConstraint = { id: 'cc', type: 'coincident', targets: [{ entityId: 'a' }, { entityId: 'b' }] };
    const group = constraintIconsForEntity(state(a, b, l, c), 'l1');
    expect(group!.icons).toHaveLength(1);
  });

  it('anchors the badge cluster offset perpendicular to a line', () => {
    // Horizontal line A-B along +X. CCW perpendicular is +Y.
    const a: PointEntity = { kind: 'point', id: 'a', x: 0, y: 0 };
    const b: PointEntity = { kind: 'point', id: 'b', x: 10, y: 0 };
    const l: LineEntity = { kind: 'line', id: 'l1', startId: 'a', endId: 'b' };
    const h: SketchConstraint = { id: 'ch', type: 'horizontal', targets: [{ entityId: 'l1' }] };
    const group = constraintIconsForEntity(state(a, b, l, h), 'l1');
    expect(group!.anchor.x).toBeCloseTo(5);  // midpoint x
    expect(group!.anchor.y).toBeGreaterThan(0);
  });

  it('returns null when no geometric constraints touch the entity', () => {
    const p: PointEntity = { kind: 'point', id: 'p', x: 0, y: 0 };
    expect(constraintIconsForEntity(state(p), 'p')).toBeNull();
  });
});
