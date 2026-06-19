import { describe, it, expect } from 'vitest';
import { WORLD_UP, orbitDir, dirToOrbit } from './viewAxis';

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

describe('viewAxis (Z-up view convention)', () => {
  it('WORLD_UP is +Z', () => {
    expect(WORLD_UP).toEqual([0, 0, 1]);
  });

  describe('orbitDir — (theta, phi) → offset direction', () => {
    it('phi=0 points to +Z (camera above → Top view)', () => {
      const d = orbitDir(0, 0);
      expect(near(d.x, 0)).toBe(true);
      expect(near(d.y, 0)).toBe(true);
      expect(near(d.z, 1)).toBe(true);
    });
    it('phi=π points to -Z (Bottom view)', () => {
      const d = orbitDir(0, Math.PI);
      expect(near(d.z, -1)).toBe(true);
    });
    it('equator: theta=0 → +X (RIGHT), theta=π/2 → +Y (right-handed about +Z)', () => {
      const r = orbitDir(0, Math.PI / 2);
      expect(near(r.x, 1)).toBe(true); expect(near(r.y, 0)).toBe(true); expect(near(r.z, 0)).toBe(true);
      const f = orbitDir(Math.PI / 2, Math.PI / 2);
      expect(near(f.x, 0)).toBe(true); expect(near(f.y, 1)).toBe(true); expect(near(f.z, 0)).toBe(true);
    });
    it('theta=-π/2 → -Y (FRONT, SW-style facing the viewer)', () => {
      const f = orbitDir(-Math.PI / 2, Math.PI / 2);
      expect(near(f.y, -1)).toBe(true);
    });
  });

  describe('dirToOrbit — inverse', () => {
    it('round-trips orbitDir for generic angles', () => {
      for (const theta of [-2, -0.5, 0.3, 1.1, 2.7]) {
        for (const phi of [0.2, 0.9, 1.5708, 2.4]) {
          const d = orbitDir(theta, phi);
          const r = dirToOrbit(d.x, d.y, d.z);
          const d2 = orbitDir(r.theta, r.phi);
          // Compare the resulting directions (theta is modular; compare vectors).
          expect(near(d2.x, d.x, 1e-9)).toBe(true);
          expect(near(d2.y, d.y, 1e-9)).toBe(true);
          expect(near(d2.z, d.z, 1e-9)).toBe(true);
        }
      }
    });
    it('TOP (+Z) → phi≈0, BOTTOM (-Z) → phi≈π', () => {
      expect(near(dirToOrbit(0, 0, 1).phi, 0)).toBe(true);
      expect(near(dirToOrbit(0, 0, -1).phi, Math.PI)).toBe(true);
    });
    it('RIGHT (+X) → phi=π/2, theta=0', () => {
      const r = dirToOrbit(1, 0, 0);
      expect(near(r.phi, Math.PI / 2)).toBe(true);
      expect(near(r.theta, 0)).toBe(true);
    });
    it('theta is 0 at the poles (no azimuth)', () => {
      expect(dirToOrbit(0, 0, 1).theta).toBe(0);
    });
  });
});
