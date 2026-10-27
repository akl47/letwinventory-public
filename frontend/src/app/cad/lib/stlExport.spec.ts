import { describe, it, expect } from 'vitest';
import { buildBinaryStl } from './stlExport';

describe('buildBinaryStl', () => {
  // A unit quad in the XY plane (CCW) → two triangles, normal +Z.
  const quad = {
    positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
    indices: [0, 1, 2, 0, 2, 3],
  };

  it('writes an 84 + 50·N byte buffer with the triangle count in the header', () => {
    const buf = buildBinaryStl([quad]);
    expect(buf.byteLength).toBe(84 + 2 * 50);
    const view = new DataView(buf);
    expect(view.getUint32(80, true)).toBe(2);
  });

  it('computes a +Z facet normal for CCW winding', () => {
    const view = new DataView(buildBinaryStl([quad]));
    // First facet normal starts right after the 84-byte header.
    expect(view.getFloat32(84, true)).toBeCloseTo(0, 6);     // nx
    expect(view.getFloat32(88, true)).toBeCloseTo(0, 6);     // ny
    expect(view.getFloat32(92, true)).toBeCloseTo(1, 6);     // nz
  });

  it('skips degenerate (zero-area) triangles and trims the buffer', () => {
    const degenerate = { positions: [0, 0, 0, 1, 0, 0, 2, 0, 0], indices: [0, 1, 2] };
    const buf = buildBinaryStl([quad, degenerate]);
    // Only the quad's 2 triangles survive; the collinear one is dropped.
    expect(buf.byteLength).toBe(84 + 2 * 50);
    expect(new DataView(buf).getUint32(80, true)).toBe(2);
  });

  it('handles an empty mesh list', () => {
    const buf = buildBinaryStl([]);
    expect(buf.byteLength).toBe(84);
    expect(new DataView(buf).getUint32(80, true)).toBe(0);
  });
});
