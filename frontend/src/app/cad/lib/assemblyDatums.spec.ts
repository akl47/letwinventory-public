import { describe, it, expect } from 'vitest';
import { assemblyOriginDatums, placedOriginDatums } from './assemblyDatums';
import type { Placement } from './assembly.types';

const IDENTITY: Placement = { translate: [0, 0, 0], quaternion: [0, 0, 0, 1] };
// 90° about +Z: maps +X→+Y, +Y→−X.
const ROT_Z90: Placement = { translate: [0, 0, 0], quaternion: [0, 0, Math.SQRT1_2, Math.SQRT1_2] };

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

describe('assemblyOriginDatums (CAD-785)', () => {
  it('returns the seven canonical origin datums when all visible', () => {
    const ds = assemblyOriginDatums({});
    expect(ds.map((d) => d.id).sort()).toEqual(
      ['origin', 'x_axis', 'xy_plane', 'xz_plane', 'y_axis', 'yz_plane', 'z_axis'],
    );
    expect(ds.filter((d) => d.kind === 'point').length).toBe(1);
    expect(ds.filter((d) => d.kind === 'axis').length).toBe(3);
    expect(ds.filter((d) => d.kind === 'plane').length).toBe(3);
  });

  it('treats a missing visibility key as visible', () => {
    expect(assemblyOriginDatums({ x_axis: true }).length).toBe(7);
  });

  it('hides individual datums whose visibility is false', () => {
    const ds = assemblyOriginDatums({ xy_plane: false, origin: false });
    expect(ds.map((d) => d.id)).not.toContain('xy_plane');
    expect(ds.map((d) => d.id)).not.toContain('origin');
    expect(ds.length).toBe(5);
  });

  it('returns nothing when every datum is hidden', () => {
    const allHidden = { origin: false, x_axis: false, y_axis: false, z_axis: false, xy_plane: false, yz_plane: false, xz_plane: false };
    expect(assemblyOriginDatums(allHidden)).toEqual([]);
  });

  it('uses canonical ids (no sidecars) so they render at the world origin', () => {
    const x = assemblyOriginDatums({}).find((d) => d.id === 'x_axis')!;
    expect((x as { axis?: unknown }).axis).toBeUndefined();
  });
});

describe('placedOriginDatums (CAD-784)', () => {
  it('namespaces all seven datum ids by prefix', () => {
    const ds = placedOriginDatums(IDENTITY, 'inst:i1:');
    expect(ds.map((d) => d.id).sort()).toEqual([
      'inst:i1:origin', 'inst:i1:x_axis', 'inst:i1:xy_plane', 'inst:i1:xz_plane',
      'inst:i1:y_axis', 'inst:i1:yz_plane', 'inst:i1:z_axis',
    ]);
  });

  it('places the origin point at the placement translation', () => {
    const ds = placedOriginDatums({ translate: [10, -3, 2], quaternion: [0, 0, 0, 1] }, 'p:');
    const pt = ds.find((d) => d.kind === 'point') as { position: [number, number, number] };
    expect(pt.position).toEqual([10, -3, 2]);
  });

  it('carries axis sidecars with origin at the translation and direction = identity dir', () => {
    const ds = placedOriginDatums({ translate: [5, 0, 0], quaternion: [0, 0, 0, 1] }, 'p:');
    const x = ds.find((d) => d.id === 'p:x_axis') as { axis: { origin: number[]; direction: number[] } };
    expect(x.axis.origin).toEqual([5, 0, 0]);
    expect(x.axis.direction.map((v) => Math.round(v))).toEqual([1, 0, 0]);
  });

  it('rotates axis directions by the placement quaternion (+X → +Y under Z90)', () => {
    const ds = placedOriginDatums(ROT_Z90, 'p:');
    const x = ds.find((d) => d.id === 'p:x_axis') as { axis: { direction: [number, number, number] } };
    expect(near(x.axis.direction[0], 0)).toBe(true);
    expect(near(x.axis.direction[1], 1)).toBe(true);
    expect(near(x.axis.direction[2], 0)).toBe(true);
  });

  it('carries a full plane sidecar (origin + basis) for each reference plane', () => {
    const ds = placedOriginDatums({ translate: [1, 2, 3], quaternion: [0, 0, 0, 1] }, 'p:');
    const xy = ds.find((d) => d.id === 'p:xy_plane') as {
      plane: { origin: number[]; xAxis: number[]; yAxis: number[]; normal: number[] };
    };
    expect(xy.plane.origin).toEqual([1, 2, 3]);
    expect(xy.plane.normal.map((v) => Math.round(v))).toEqual([0, 0, 1]);
  });

  it('rotates the plane normal by the placement (XY normal +Z stays +Z under Z90)', () => {
    const ds = placedOriginDatums(ROT_Z90, 'p:');
    const xy = ds.find((d) => d.id === 'p:xy_plane') as { plane: { normal: [number, number, number] } };
    expect(near(xy.plane.normal[2], 1)).toBe(true);
  });
});
