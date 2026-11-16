import { describe, it, expect } from 'vitest';
import { placementAt, rayPlanePoint } from './insertPlacement';

describe('insert preview placement (REQ 1081)', () => {
  it('finds where the view ray meets the camera-facing plane', () => {
    // Looking down -Z from z=100 at a plane through (0,0,10).
    expect(rayPlanePoint([5, 7, 100], [0, 0, -1], [0, 0, 10], [0, 0, 1])).toEqual([5, 7, 10]);
  });

  it('handles an oblique ray', () => {
    const p = rayPlanePoint([0, 0, 10], [1, 0, -1], [0, 0, 0], [0, 0, 1])!;
    expect(p[0]).toBeCloseTo(10);
    expect(p[2]).toBeCloseTo(0);
  });

  it('gives no point for a ray parallel to the plane or pointing away from it', () => {
    expect(rayPlanePoint([0, 0, 10], [1, 0, 0], [0, 0, 0], [0, 0, 1])).toBeNull();
    expect(rayPlanePoint([0, 0, 10], [0, 0, 1], [0, 0, 0], [0, 0, 1])).toBeNull();
  });

  it('places the component at the picked point in the assembly orientation', () => {
    const point: [number, number, number] = [1, 2, 3];
    const p = placementAt(point);
    expect(p).toEqual({ translate: [1, 2, 3], quaternion: [0, 0, 0, 1] });
    expect(p.translate).not.toBe(point);
  });
});
