import { describe, it, expect } from 'vitest';
import { buildOriginDatums, planeForDatum } from './datum';

describe('buildOriginDatums (CAD-035)', () => {
  it('produces exactly seven datum elements', () => {
    const datums = buildOriginDatums();
    expect(datums.length).toBe(7);
  });

  it('includes one origin point, three axes, three planes', () => {
    const datums = buildOriginDatums();
    expect(datums.filter(d => d.kind === 'point').length).toBe(1);
    expect(datums.filter(d => d.kind === 'axis').length).toBe(3);
    expect(datums.filter(d => d.kind === 'plane').length).toBe(3);
  });

  it('aligns each axis to its world direction', () => {
    const datums = buildOriginDatums();
    const x = datums.find(d => d.id === 'x_axis')!;
    const y = datums.find(d => d.id === 'y_axis')!;
    const z = datums.find(d => d.id === 'z_axis')!;
    expect(x.direction).toEqual([1, 0, 0]);
    expect(y.direction).toEqual([0, 1, 0]);
    expect(z.direction).toEqual([0, 0, 1]);
  });

  it('orients each datum plane along its perpendicular axis', () => {
    const datums = buildOriginDatums();
    const xy = datums.find(d => d.id === 'xy_plane')!;
    const yz = datums.find(d => d.id === 'yz_plane')!;
    const xz = datums.find(d => d.id === 'xz_plane')!;
    expect(xy.direction).toEqual([0, 0, 1]);
    expect(yz.direction).toEqual([1, 0, 0]);
    expect(xz.direction).toEqual([0, 1, 0]);
  });

  it('uses stable, predictable IDs', () => {
    const ids = buildOriginDatums().map(d => d.id).sort();
    expect(ids).toEqual(['origin', 'x_axis', 'xy_plane', 'xz_plane', 'y_axis', 'yz_plane', 'z_axis']);
  });
});

describe('planeForDatum', () => {
  it('returns a plane normal to Z for xy_plane', () => {
    const p = planeForDatum('xy_plane')!;
    expect(p.normal).toEqual([0, 0, 1]);
    expect(p.origin).toEqual([0, 0, 0]);
  });

  it('returns a plane normal to X for yz_plane', () => {
    const p = planeForDatum('yz_plane')!;
    expect(p.normal).toEqual([1, 0, 0]);
  });

  it('returns a plane normal to Y for xz_plane', () => {
    const p = planeForDatum('xz_plane')!;
    expect(p.normal).toEqual([0, 1, 0]);
  });

  it('returns null for an unknown datum id', () => {
    expect(planeForDatum('not_a_datum')).toBeNull();
  });
});
