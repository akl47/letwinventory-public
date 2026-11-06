import { describe, it, expect } from 'vitest';
import { assemblyOriginDatums, computeSkeletonDatums, placedOriginDatums } from './assemblyDatums';
import type { AssemblyRegenResponse, Placement } from './assembly.types';
import type { FeatureTree } from './types';

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

describe('skeleton planes referencing components (REQ 1004)', () => {
  // A flat face (one triangle) at height z, normal +Z, scoped to instance i1.
  const faceAt = (faceId: string, z: number) => ({
    faceId, persistentName: faceId, indices: [0, 1, 2],
    positions: [0, 0, z, 1, 0, z, 0, 1, z], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
  });
  const regen = (z0: number, z1: number, placement: Placement = IDENTITY) => ({
    bodies: [{ id: 'i1::b0', name: null, instanceId: 'i1', partID: 7, placement, faces: [faceAt('i1::f0', z0), faceAt('i1::f1', z1)], vertices: [], edges: [] }],
    instances: [{ instanceId: 'i1', partID: 7, placement }],
  }) as unknown as AssemblyRegenResponse;
  const stale = { origin: [0, 0, 99] as [number, number, number], normal: [0, 0, 1] as [number, number, number], xAxis: [1, 0, 0] as [number, number, number], yAxis: [0, 1, 0] as [number, number, number] };
  const midTree = (a = 'i1::f0', b = 'i1::f1') => ({
    features: [{ id: 'dp1', type: 'datumPlane', method: {
      kind: 'midPlane',
      planeRefA: { kind: 'face', faceId: a, fallbackPlane: stale },
      planeRefB: { kind: 'face', faceId: b, fallbackPlane: stale },
    } }],
  }) as unknown as FeatureTree;

  it('a mid plane between two component faces follows the faces', () => {
    expect(computeSkeletonDatums(midTree(), regen(0, 10))[0].plane!.origin[2]).toBeCloseTo(5);
    expect(computeSkeletonDatums(midTree(), regen(20, 30))[0].plane!.origin[2]).toBeCloseTo(25);
  });

  it('falls back to the pick-time snapshot when the face is gone', () => {
    expect(computeSkeletonDatums(midTree('i1::gone', 'i1::gone2'), regen(0, 10))[0].plane!.origin[2]).toBeCloseTo(99);
  });

  it('an offset from a component datum plane follows the component placement', () => {
    const tree = { features: [{ id: 'dp1', type: 'datumPlane', method: { kind: 'offset', planeRef: { kind: 'datum', datumId: 'inst:i1:xy_plane' }, distance: 2 } }] } as unknown as FeatureTree;
    const moved: Placement = { translate: [0, 0, 7], quaternion: [0, 0, 0, 1] };
    expect(computeSkeletonDatums(tree, regen(0, 1, moved))[0].plane!.origin[2]).toBeCloseTo(9);
  });
});

describe('skeleton reference points (REQ 1005)', () => {
  const face = (z: number) => ({
    faceId: 'i1::f0', persistentName: 'f0', indices: [0, 1, 2],
    positions: [0, 0, z, 3, 0, z, 0, 3, z], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
  });
  const regen = (z: number, placement: Placement) => ({
    bodies: [{ id: 'i1::b0', name: null, instanceId: 'i1', partID: 7, placement, faces: [face(z)], vertices: [], edges: [] }],
    instances: [{ instanceId: 'i1', partID: 7, placement }],
  }) as unknown as AssemblyRegenResponse;
  const tree = (method: unknown, anchor?: unknown) => ({ features: [{ id: 'pt1', type: 'datumPoint', method, ...(anchor ? { anchor } : {}) }] }) as unknown as FeatureTree;

  it('a center-of-face point follows the face', () => {
    const t = tree({ kind: 'centerOfFace', faceId: 'i1::f0', fallbackPosition: [0, 0, 99] });
    const d = computeSkeletonDatums(t, regen(4, IDENTITY))[0] as { kind: string; position: number[] };
    expect(d.kind).toBe('point');
    expect(d.position).toEqual([1, 1, 4]);
  });

  it('an anchored point moves with its component placement', () => {
    const t = tree({ kind: 'onVertex', vertexRef: { vertexId: 'v3', fallbackPosition: [1, 0, 0] } }, { instanceId: 'i1', local: [1, 0, 0] });
    const d = computeSkeletonDatums(t, regen(0, { translate: [0, 0, 5], quaternion: [0, 0, Math.SQRT1_2, Math.SQRT1_2] }))[0] as { position: number[] };
    expect(d.position[0]).toBeCloseTo(0); expect(d.position[1]).toBeCloseTo(1); expect(d.position[2]).toBeCloseTo(5);
  });

  it('falls back to the pick-time position when the component is gone', () => {
    const t = tree({ kind: 'onVertex', vertexRef: { vertexId: 'v3', fallbackPosition: [2, 2, 2] } }, { instanceId: 'gone', local: [0, 0, 0] });
    expect((computeSkeletonDatums(t, regen(0, IDENTITY))[0] as { position: number[] }).position).toEqual([2, 2, 2]);
  });
});

describe('skeleton point coordinate systems (REQ 1006)', () => {
  const placement: Placement = { translate: [0, 0, 5], quaternion: [0, 0, Math.SQRT1_2, Math.SQRT1_2] };
  const regen = { bodies: [], instances: [{ instanceId: 'i1', partID: 7, placement }] } as unknown as AssemblyRegenResponse;
  const pt = (anchor: unknown, method: unknown = { kind: 'onVertex', vertexRef: { vertexId: 'v', fallbackPosition: [0, 0, 0] } }) =>
    ({ features: [{ id: 'pt1', type: 'datumPoint', method, anchor }] }) as unknown as FeatureTree;
  const axis = (ds: ReturnType<typeof computeSkeletonDatums>, a: string) => ds.find((d) => d.id === `pt1:${a}_axis`)!.direction!.map((n) => Math.round(n * 1e6) / 1e6 + 0);

  it('draws an X/Y/Z triad aligned with the owning component', () => {
    const ds = computeSkeletonDatums(pt({ instanceId: 'i1', local: [0, 0, 0] }), regen);
    expect(ds.map((d) => d.id)).toEqual(['pt1', 'pt1:x_axis', 'pt1:y_axis', 'pt1:z_axis']);
    expect(ds[1].triad).toBe('x');
    expect(axis(ds, 'x')).toEqual([0, 1, 0]);
    expect(axis(ds, 'z')).toEqual([0, 0, 1]);
  });

  it('applies the point orientation on top of the owner axes', () => {
    const ds = computeSkeletonDatums(pt({ instanceId: 'i1', local: [0, 0, 0], quat: [Math.SQRT1_2, 0, 0, Math.SQRT1_2] }), regen);
    expect(axis(ds, 'z')).toEqual([1, 0, 0]);
  });

  it('a point owned by the assembly uses the assembly axes', () => {
    const ds = computeSkeletonDatums(pt({ instanceId: '__assembly__', local: [1, 2, 3] }), regen);
    expect((ds[0] as { position: number[] }).position).toEqual([1, 2, 3]);
    expect(axis(ds, 'x')).toEqual([1, 0, 0]);
  });
});
