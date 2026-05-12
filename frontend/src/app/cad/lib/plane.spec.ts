import { describe, it, expect } from 'vitest';
import { projectTo3D, projectFrom3D } from './plane';
import type { Plane3 } from './types';

const XY_PLANE: Plane3 = {
  origin: [0, 0, 0],
  xAxis: [1, 0, 0],
  yAxis: [0, 1, 0],
  normal: [0, 0, 1],
};

const YZ_PLANE: Plane3 = {
  origin: [0, 0, 0],
  xAxis: [0, 1, 0],
  yAxis: [0, 0, 1],
  normal: [1, 0, 0],
};

const OFFSET_XY: Plane3 = {
  origin: [10, 5, 3],
  xAxis: [1, 0, 0],
  yAxis: [0, 1, 0],
  normal: [0, 0, 1],
};

describe('Plane projection (CAD-022)', () => {
  describe('projectTo3D', () => {
    it('places (x,y) on XY plane at z=0', () => {
      const p = projectTo3D(XY_PLANE, 3, 4);
      expect(p).toEqual([3, 4, 0]);
    });

    it('places (x,y) on YZ plane mapping the in-plane axes correctly', () => {
      const p = projectTo3D(YZ_PLANE, 3, 4);
      expect(p).toEqual([0, 3, 4]);
    });

    it('respects the plane origin offset', () => {
      const p = projectTo3D(OFFSET_XY, 3, 4);
      expect(p).toEqual([13, 9, 3]);
    });
  });

  describe('projectFrom3D', () => {
    it('extracts (x,y) from a 3D point on the XY plane', () => {
      const p = projectFrom3D(XY_PLANE, [3, 4, 0]);
      expect(p.x).toBeCloseTo(3);
      expect(p.y).toBeCloseTo(4);
    });

    it('extracts (x,y) using the plane basis (YZ plane)', () => {
      const p = projectFrom3D(YZ_PLANE, [0, 3, 4]);
      expect(p.x).toBeCloseTo(3);
      expect(p.y).toBeCloseTo(4);
    });
  });

  describe('round-trip 2D ↔ 3D', () => {
    it('preserves coordinates on XY plane', () => {
      const a = projectTo3D(XY_PLANE, 7, -2);
      const b = projectFrom3D(XY_PLANE, a);
      expect(b.x).toBeCloseTo(7);
      expect(b.y).toBeCloseTo(-2);
    });

    it('preserves coordinates on an offset plane', () => {
      const a = projectTo3D(OFFSET_XY, 7, -2);
      const b = projectFrom3D(OFFSET_XY, a);
      expect(b.x).toBeCloseTo(7);
      expect(b.y).toBeCloseTo(-2);
    });
  });
});
