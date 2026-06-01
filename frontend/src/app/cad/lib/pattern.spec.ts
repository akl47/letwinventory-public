import { describe, it, expect } from 'vitest';
import { circularTransforms, linearTransforms, mirrorTransforms } from './pattern';
import type {
  CircularPatternFeature,
  LinearPatternFeature,
  MirrorFeatureFeature,
} from './types';

const xAxisSnap = { origin: [0, 0, 0] as [number, number, number], direction: [1, 0, 0] as [number, number, number] };
const yAxisSnap = { origin: [0, 0, 0] as [number, number, number], direction: [0, 1, 0] as [number, number, number] };
const zAxisSnap = { origin: [0, 0, 0] as [number, number, number], direction: [0, 0, 1] as [number, number, number] };

describe('mirrorTransforms', () => {
  it('produces a single mirror transform from the plane snapshot', () => {
    const f: MirrorFeatureFeature = {
      id: 'f1',
      type: 'mirror',
      planeRef: { kind: 'datum', datumId: 'yz_plane' },
      planeSnapshot: { origin: [0, 0, 0], xAxis: [0, 1, 0], yAxis: [0, 0, 1], normal: [1, 0, 0] },
    };
    const tr = mirrorTransforms(f);
    expect(tr).toHaveLength(1);
    expect(tr[0]).toEqual({ kind: 'mirror', origin: [0, 0, 0], normal: [1, 0, 0] });
  });
});

describe('linearTransforms', () => {
  it('emits count − 1 translates for a 1D pattern', () => {
    const f: LinearPatternFeature = {
      id: 'f1', type: 'linearPattern',
      direction1: { axisRef: { kind: 'originAxis', axisId: 'x_axis' }, axisSnapshot: xAxisSnap, spacing: 10, count: 4 },
    };
    const tr = linearTransforms(f);
    expect(tr).toHaveLength(3);
    expect(tr[0]).toEqual({ kind: 'translate', dx: 10, dy: 0, dz: 0 });
    expect(tr[1]).toEqual({ kind: 'translate', dx: 20, dy: 0, dz: 0 });
    expect(tr[2]).toEqual({ kind: 'translate', dx: 30, dy: 0, dz: 0 });
  });

  it('honors flipped on direction 1', () => {
    const f: LinearPatternFeature = {
      id: 'f1', type: 'linearPattern',
      direction1: { axisRef: { kind: 'originAxis', axisId: 'x_axis' }, axisSnapshot: xAxisSnap, spacing: 5, count: 3, flipped: true },
    };
    const tr = linearTransforms(f);
    expect(tr).toHaveLength(2);
    expect(tr[0]).toEqual({ kind: 'translate', dx: -5, dy: 0, dz: 0 });
    expect(tr[1]).toEqual({ kind: 'translate', dx: -10, dy: 0, dz: 0 });
  });

  it('emits a 2D grid minus the source seed', () => {
    const f: LinearPatternFeature = {
      id: 'f1', type: 'linearPattern',
      direction1: { axisRef: { kind: 'originAxis', axisId: 'x_axis' }, axisSnapshot: xAxisSnap, spacing: 10, count: 3 },
      direction2: { axisRef: { kind: 'originAxis', axisId: 'y_axis' }, axisSnapshot: yAxisSnap, spacing: 20, count: 2 },
    };
    const tr = linearTransforms(f);
    // 3 * 2 - 1 = 5 copies
    expect(tr).toHaveLength(5);
    // Source (0,0) is skipped. Iteration order is i=0..2, j=0..1.
    expect(tr).toContainEqual({ kind: 'translate', dx: 0, dy: 20, dz: 0 });    // (0,1)
    expect(tr).toContainEqual({ kind: 'translate', dx: 10, dy: 0, dz: 0 });    // (1,0)
    expect(tr).toContainEqual({ kind: 'translate', dx: 10, dy: 20, dz: 0 });   // (1,1)
    expect(tr).toContainEqual({ kind: 'translate', dx: 20, dy: 0, dz: 0 });    // (2,0)
    expect(tr).toContainEqual({ kind: 'translate', dx: 20, dy: 20, dz: 0 });   // (2,1)
  });

  it('rejects count < 1', () => {
    const f: LinearPatternFeature = {
      id: 'f1', type: 'linearPattern',
      direction1: { axisRef: { kind: 'originAxis', axisId: 'x_axis' }, axisSnapshot: xAxisSnap, spacing: 10, count: 0 },
    };
    expect(() => linearTransforms(f)).toThrow();
  });

  it('rejects zero spacing with count ≥ 2', () => {
    const f: LinearPatternFeature = {
      id: 'f1', type: 'linearPattern',
      direction1: { axisRef: { kind: 'originAxis', axisId: 'x_axis' }, axisSnapshot: xAxisSnap, spacing: 0, count: 3 },
    };
    expect(() => linearTransforms(f)).toThrow();
  });

  it('allows spacing=0 with count=1 (no-op pattern in that direction)', () => {
    const f: LinearPatternFeature = {
      id: 'f1', type: 'linearPattern',
      direction1: { axisRef: { kind: 'originAxis', axisId: 'x_axis' }, axisSnapshot: xAxisSnap, spacing: 0, count: 1 },
    };
    expect(linearTransforms(f)).toEqual([]);
  });
});

describe('circularTransforms', () => {
  it('equalSpacing 360° / count=4 produces three 90° steps', () => {
    const f: CircularPatternFeature = {
      id: 'f1', type: 'circularPattern',
      axisRef: { kind: 'originAxis', axisId: 'z_axis' }, axisSnapshot: zAxisSnap,
      count: 4, mode: 'equalSpacing', angleDeg: 360,
    };
    const tr = circularTransforms(f);
    expect(tr).toHaveLength(3);
    expect(tr[0].kind).toBe('rotate');
    if (tr[0].kind === 'rotate') {
      expect(tr[0].angleRad).toBeCloseTo(Math.PI / 2);
      expect(tr[1].kind === 'rotate' && tr[1].angleRad).toBeCloseTo(Math.PI);
      expect(tr[2].kind === 'rotate' && tr[2].angleRad).toBeCloseTo((3 * Math.PI) / 2);
    }
  });

  it('specifiedAngle uses the value as the per-step delta', () => {
    const f: CircularPatternFeature = {
      id: 'f1', type: 'circularPattern',
      axisRef: { kind: 'originAxis', axisId: 'z_axis' }, axisSnapshot: zAxisSnap,
      count: 3, mode: 'specifiedAngle', angleDeg: 30,
    };
    const tr = circularTransforms(f);
    expect(tr).toHaveLength(2);
    if (tr[0].kind === 'rotate') expect(tr[0].angleRad).toBeCloseTo(Math.PI / 6);
    if (tr[1].kind === 'rotate') expect(tr[1].angleRad).toBeCloseTo(Math.PI / 3);
  });

  it('flipped reverses rotation direction', () => {
    const f: CircularPatternFeature = {
      id: 'f1', type: 'circularPattern',
      axisRef: { kind: 'originAxis', axisId: 'z_axis' }, axisSnapshot: zAxisSnap,
      count: 4, mode: 'equalSpacing', angleDeg: 360, flipped: true,
    };
    const tr = circularTransforms(f);
    if (tr[0].kind === 'rotate') expect(tr[0].angleRad).toBeCloseTo(-Math.PI / 2);
  });

  it('rejects count < 2', () => {
    const f: CircularPatternFeature = {
      id: 'f1', type: 'circularPattern',
      axisRef: { kind: 'originAxis', axisId: 'z_axis' }, axisSnapshot: zAxisSnap,
      count: 1, mode: 'equalSpacing', angleDeg: 360,
    };
    expect(() => circularTransforms(f)).toThrow();
  });
});
