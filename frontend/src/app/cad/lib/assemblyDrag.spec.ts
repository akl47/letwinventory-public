import { describe, it, expect } from 'vitest';
import {
  DRAG_THRESHOLD_PX,
  exceedsDragThreshold,
  canDragInstance,
  screenDeltaToWorld,
  translatedPlacement,
} from './assemblyDrag';
import type { AssemblyInstance, Placement } from './assembly.types';

const inst = (over: Partial<AssemblyInstance> = {}): AssemblyInstance => ({
  instanceId: 'i1',
  partID: 1,
  placement: { translate: [0, 0, 0], quaternion: [0, 0, 0, 1] },
  ...over,
});

describe('exceedsDragThreshold (CAD-782)', () => {
  it('is false for movement at or under the threshold', () => {
    expect(exceedsDragThreshold(0, 0)).toBe(false);
    expect(exceedsDragThreshold(DRAG_THRESHOLD_PX, 0)).toBe(false);
    expect(exceedsDragThreshold(0, DRAG_THRESHOLD_PX)).toBe(false);
  });

  it('is true once movement passes the threshold', () => {
    expect(exceedsDragThreshold(DRAG_THRESHOLD_PX + 0.01, 0)).toBe(true);
    expect(exceedsDragThreshold(10, 10)).toBe(true);
  });

  it('uses euclidean distance, not per-axis', () => {
    // dx=dy=3 -> hypot ~4.24 > default 4
    expect(exceedsDragThreshold(3, 3)).toBe(true);
    expect(exceedsDragThreshold(2, 2)).toBe(false); // hypot ~2.83
  });

  it('honours a custom threshold', () => {
    expect(exceedsDragThreshold(5, 0, 10)).toBe(false);
    expect(exceedsDragThreshold(11, 0, 10)).toBe(true);
  });
});

describe('canDragInstance (CAD-782)', () => {
  it('allows a plain, un-grounded component', () => {
    expect(canDragInstance(inst())).toBe(true);
  });

  it('rejects a grounded component', () => {
    expect(canDragInstance(inst({ grounded: true }))).toBe(false);
  });

  it('rejects a suppressed component', () => {
    expect(canDragInstance(inst({ suppressed: true }))).toBe(false);
  });

  it('rejects null / undefined', () => {
    expect(canDragInstance(null)).toBe(false);
    expect(canDragInstance(undefined)).toBe(false);
  });
});

describe('screenDeltaToWorld (CAD-782)', () => {
  const right: [number, number, number] = [1, 0, 0];
  const up: [number, number, number] = [0, 1, 0];

  it('maps +dx to +camRight scaled by unitsPerPixel', () => {
    expect(screenDeltaToWorld(10, 0, right, up, 0.5)).toEqual([5, 0, 0]);
  });

  it('maps +dy (screen down) to -camUp', () => {
    expect(screenDeltaToWorld(0, 10, right, up, 0.5)).toEqual([0, -5, 0]);
  });

  it('combines both axes in the camera basis', () => {
    // arbitrary orthonormal-ish basis
    const r: [number, number, number] = [0, 0, 1];
    const u: [number, number, number] = [0, 1, 0];
    expect(screenDeltaToWorld(4, 2, r, u, 1)).toEqual([0, -2, 4]);
  });

  it('returns zero for zero movement', () => {
    expect(screenDeltaToWorld(0, 0, right, up, 0.5)).toEqual([0, 0, 0]);
  });
});

describe('translatedPlacement (CAD-783)', () => {
  it('shifts translate by the world delta', () => {
    const p: Placement = { translate: [1, 2, 3], quaternion: [0, 0, 0, 1] };
    const out = translatedPlacement(p, [10, -5, 0.5]);
    expect(out.translate).toEqual([11, -3, 3.5]);
  });

  it('preserves the quaternion (orientation unchanged)', () => {
    const p: Placement = { translate: [0, 0, 0], quaternion: [0.1, 0.2, 0.3, 0.9] };
    const out = translatedPlacement(p, [1, 1, 1]);
    expect(out.quaternion).toEqual([0.1, 0.2, 0.3, 0.9]);
  });

  it('does not mutate the input placement', () => {
    const p: Placement = { translate: [1, 1, 1], quaternion: [0, 0, 0, 1] };
    translatedPlacement(p, [2, 2, 2]);
    expect(p.translate).toEqual([1, 1, 1]);
  });
});
