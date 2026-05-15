import { describe, it, expect } from 'vitest';
import { makePureJsKernel } from './kernel';
import type { ProfileLoop } from './profile';
import type { Plane3 } from './types';

const XY: Plane3 = { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] };

describe('Pure-JS extrude kernel (REQ 617)', () => {
  it('a single-circle profile produces exactly three faces: top cap, bottom cap, lateral', () => {
    const kernel = makePureJsKernel();
    const loop: ProfileLoop = [{ kind: 'circle', center: { x: 0, y: 0 }, radius: 10 }];
    const { faces } = kernel.buildExtrude(loop, XY, 20);
    expect(faces.length).toBe(3);
    const ids = faces.map(f => f.faceId);
    expect(ids.some(id => id.endsWith(':top'))).toBe(true);
    expect(ids.some(id => id.endsWith(':bottom'))).toBe(true);
    expect(ids.some(id => /:side\d+$/.test(id))).toBe(true);
  });

  it('a four-line rectangle profile produces six faces (2 caps + 4 sides)', () => {
    const kernel = makePureJsKernel();
    const loop: ProfileLoop = [
      { kind: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { kind: 'line', start: { x: 10, y: 0 }, end: { x: 10, y: 10 } },
      { kind: 'line', start: { x: 10, y: 10 }, end: { x: 0, y: 10 } },
      { kind: 'line', start: { x: 0, y: 10 }, end: { x: 0, y: 0 } },
    ];
    const { faces } = kernel.buildExtrude(loop, XY, 5);
    expect(faces.length).toBe(6);
    expect(faces.filter(f => /:side\d+$/.test(f.faceId)).length).toBe(4);
  });

  it('the cylinder lateral face contains many tessellated triangles but one faceId', () => {
    const kernel = makePureJsKernel();
    const loop: ProfileLoop = [{ kind: 'circle', center: { x: 0, y: 0 }, radius: 50 }];
    const { faces } = kernel.buildExtrude(loop, XY, 10);
    const lateral = faces.find(f => /:side\d+$/.test(f.faceId))!;
    // Larger radius => finer tessellation => more triangles in the single face.
    expect(lateral.indices.length).toBeGreaterThan(60);  // > 10 triangles = 30 indices, plenty of headroom
    // All triangles share one faceId.
    expect(lateral.faceId).toMatch(/:side0$/);
  });

  it('every face has matching position and normal counts (three components each)', () => {
    const kernel = makePureJsKernel();
    const loop: ProfileLoop = [{ kind: 'circle', center: { x: 0, y: 0 }, radius: 5 }];
    const { faces } = kernel.buildExtrude(loop, XY, 5);
    for (const f of faces) {
      expect(f.positions.length).toBe(f.normals.length);
      expect(f.positions.length % 3).toBe(0);
    }
  });

  it('cylinder cap has (n-2) triangles for n polyline vertices', () => {
    const kernel = makePureJsKernel();
    const r = 10;
    const loop: ProfileLoop = [{ kind: 'circle', center: { x: 0, y: 0 }, radius: r }];
    const { faces } = kernel.buildExtrude(loop, XY, 5);
    const top = faces.find(f => f.faceId.endsWith(':top'))!;
    const n = top.positions.length / 3;
    expect(top.indices.length).toBe((n - 2) * 3);
    // Sanity: vertex count matches the cap polyline (no orphans).
    const usedIdxs = new Set<number>(Array.from(top.indices));
    expect(usedIdxs.size).toBe(n);
  });

  it('cylinder side vertices all lie at radius from the axis', () => {
    const kernel = makePureJsKernel();
    const r = 25;
    const loop: ProfileLoop = [{ kind: 'circle', center: { x: 0, y: 0 }, radius: r }];
    const { faces } = kernel.buildExtrude(loop, XY, 8);
    const lateral = faces.find(f => /:side\d+$/.test(f.faceId))!;
    for (let i = 0; i < lateral.positions.length; i += 3) {
      const x = lateral.positions[i];
      const y = lateral.positions[i + 1];
      // Z is the extrude axis on XY plane; radius is in x/y.
      expect(Math.abs(Math.hypot(x, y) - r)).toBeLessThan(0.5);
    }
  });
});
