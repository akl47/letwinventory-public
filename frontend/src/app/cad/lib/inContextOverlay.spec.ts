import { describe, it, expect } from 'vitest';
import { buildInContextOverlay } from './inContextOverlay';
import type { AssemblyRegenResponse } from './assembly.types';

const body = (instanceId: string, placement: any, pos: number[], poly: number[][]) => ({
  id: `${instanceId}::b0`, name: null, instanceId, partID: 1, placement,
  faces: [{ persistentName: `${instanceId}::f0`, faceId: `${instanceId}::f0`, positions: pos, normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2] }],
  vertices: [], edges: poly.length ? [{ polyline: poly }] : [],
});

function regen(bodies: any[], instances: any[]): AssemblyRegenResponse {
  return { faces: [], vertices: [], edges: [], bodies, instances, errors: [], constraintState: null } as any;
}

describe('buildInContextOverlay (CAD-790)', () => {
  const ID = { translate: [0, 0, 0], quaternion: [0, 0, 0, 1] };

  it('excludes the host instance and keeps the rest', () => {
    const r = regen(
      [body('host', ID, [0, 0, 0, 1, 0, 0, 0, 1, 0], [[0, 0, 0], [1, 0, 0]]),
       body('other', ID, [0, 0, 0, 1, 0, 0, 0, 1, 0], [[0, 0, 0], [1, 0, 0]])],
      [{ instanceId: 'host', partID: 1, placement: ID, bodyIds: ['host::b0'] },
       { instanceId: 'other', partID: 1, placement: ID, bodyIds: ['other::b0'] }],
    );
    const ovl = buildInContextOverlay(r, 'host');
    expect(ovl.faces.map((f) => f.instanceId)).toEqual(['other']);
    expect(ovl.faces[0].faceId).toBe('other::f0');
    expect(ovl.edges.map((e) => e.instanceId)).toEqual(['other']);
  });

  it('expresses other-instance geometry in the host local frame (subtracts host translation)', () => {
    // Host at world +10x; other at world origin. In the host frame the other
    // body sits at -10x.
    const hostPose = { translate: [10, 0, 0], quaternion: [0, 0, 0, 1] };
    const r = regen(
      [body('host', hostPose, [10, 0, 0, 11, 0, 0, 10, 1, 0], []),
       body('other', ID, [0, 0, 0, 1, 0, 0, 0, 1, 0], [[0, 0, 0], [2, 0, 0]])],
      [{ instanceId: 'host', partID: 1, placement: hostPose, bodyIds: [] },
       { instanceId: 'other', partID: 1, placement: ID, bodyIds: [] }],
    );
    const ovl = buildInContextOverlay(r, 'host');
    // other's first vertex world [0,0,0] → host-local [-10,0,0].
    expect(Array.from(ovl.faces[0].positions.slice(0, 3))).toEqual([-10, 0, 0]);
    expect(ovl.edges[0].polyline[0]).toEqual([-10, 0, 0]);
    expect(ovl.edges[0].polyline[1]).toEqual([-8, 0, 0]);
  });

  it('rotates geometry into the host frame (host rotated 90° about Z)', () => {
    const s = Math.SQRT1_2;
    const hostPose = { translate: [0, 0, 0], quaternion: [0, 0, s, s] }; // +X→+Y
    const r = regen(
      [body('other', ID, [1, 0, 0, 1, 0, 0, 1, 0, 0], [])],
      [{ instanceId: 'host', partID: 1, placement: hostPose, bodyIds: [] }],
    );
    const ovl = buildInContextOverlay(r, 'host');
    // world +X, inverse of +90°Z rotation → +X maps to -Y in host frame.
    const [x, y] = Array.from(ovl.faces[0].positions.slice(0, 2));
    expect(Math.abs(x)).toBeLessThan(1e-9);
    expect(y).toBeCloseTo(-1, 9);
  });

  it('defaults to identity when the host instance is missing from the solve', () => {
    const r = regen([body('other', ID, [3, 4, 5, 3, 4, 5, 3, 4, 5], [])], []);
    const ovl = buildInContextOverlay(r, 'host');
    expect(Array.from(ovl.faces[0].positions.slice(0, 3))).toEqual([3, 4, 5]);
  });
});

describe('cross-part edge identity for snapping', () => {
  const ID = { translate: [0, 0, 0], quaternion: [0, 0, 0, 1] };

  it('carries partID, source-frame endpoints, and a stable id on overlay edges', () => {
    // Other component translated +10 in x: a world edge (10,0,0)->(13,0,0) is
    // (0,0,0)->(3,0,0) in its own (source) frame.
    const other = body('i2', { translate: [10, 0, 0], quaternion: [0, 0, 0, 1] }, [10, 0, 0, 11, 0, 0, 10, 1, 0], [[10, 0, 0], [13, 0, 0]]);
    other.partID = 99;
    const r = regen([body('host', ID, [0, 0, 0, 1, 0, 0, 0, 1, 0], []), other], [
      { instanceId: 'host', partID: 1, placement: ID, bodyIds: ['host::b0'] },
      { instanceId: 'i2', partID: 99, placement: { translate: [10, 0, 0], quaternion: [0, 0, 0, 1] }, bodyIds: ['i2::b0'] },
    ]);
    const ov = buildInContextOverlay(r, 'host');
    expect(ov.edges).toHaveLength(1);
    const e = ov.edges[0];
    expect(e.partID).toBe(99);
    expect(e.sourceStart.map((n) => Math.round(n))).toEqual([0, 0, 0]);
    expect(e.sourceEnd.map((n) => Math.round(n))).toEqual([3, 0, 0]);
    expect(e.stableId.startsWith('cpe:i2:')).toBe(true);
  });

  it('stable id is order-independent (flipped polyline → same id)', () => {
    const mk = (poly: number[][]) => {
      const o = body('i2', ID, [0, 0, 0, 1, 0, 0, 0, 1, 0], poly);
      const r = regen([body('host', ID, [0, 0, 0, 1, 0, 0, 0, 1, 0], []), o],
        [{ instanceId: 'host', partID: 1, placement: ID, bodyIds: [] }, { instanceId: 'i2', partID: 1, placement: ID, bodyIds: [] }]);
      return buildInContextOverlay(r, 'host').edges[0].stableId;
    };
    expect(mk([[1, 2, 3], [4, 5, 6]])).toBe(mk([[4, 5, 6], [1, 2, 3]]));
  });
});

describe('cross-part overlay vertices', () => {
  const ID = { translate: [0, 0, 0], quaternion: [0, 0, 0, 1] };
  it('emits overlay vertices in host frame with source identity + stable id', () => {
    const other: any = body('i2', { translate: [10, 0, 0], quaternion: [0, 0, 0, 1] }, [10, 0, 0, 11, 0, 0, 10, 1, 0], []);
    other.partID = 99;
    other.vertices = [[13, 0, 0]];  // world-space vertex
    const r = regen([body('host', ID, [0, 0, 0, 1, 0, 0, 0, 1, 0], []), other],
      [{ instanceId: 'host', partID: 1, placement: ID, bodyIds: [] },
       { instanceId: 'i2', partID: 99, placement: { translate: [10, 0, 0], quaternion: [0, 0, 0, 1] }, bodyIds: [] }]);
    const ov = buildInContextOverlay(r, 'host');
    expect(ov.vertices).toHaveLength(1);
    const v = ov.vertices[0];
    expect(v.partID).toBe(99);
    expect(v.position.map((n) => Math.round(n))).toEqual([13, 0, 0]);       // host frame (host at origin)
    expect(v.sourcePosition.map((n) => Math.round(n))).toEqual([3, 0, 0]);  // source frame (i2 at +10)
    expect(v.stableId.startsWith('cpv:i2:')).toBe(true);
  });
});

describe('skeleton overlay entries (REQ 915)', () => {
  const ID = { translate: [0, 0, 0] as [number, number, number], quaternion: [0, 0, 0, 1] as [number, number, number, number] };
  it('appends skeleton edges/vertices in host-local frame with asketch keys', () => {
    const r: AssemblyRegenResponse = {
      faces: [], vertices: [], edges: [], bodies: [], errors: [], constraintState: null,
      instances: [{ instanceId: 'host', partID: 1, placement: { translate: [10, 0, 0], quaternion: [0, 0, 0, 1] }, bodyIds: [] } as never],
      skeleton: {
        partID: 77,
        edges: [
          { sketchId: 's1', entityId: 'l1', key: 'asketch:s1/l1', polyline: [[0, 0, 0], [50, 0, 0]], isStraight: true, kind: 'line' },
          { sketchId: 's1', entityId: 'pc', key: 'asketch:s1/pc', polyline: [[5, 5, 0]], isStraight: true, kind: 'point' },
        ],
      },
    };
    const ov = buildInContextOverlay(r, 'host');
    const edge = ov.edges.find((e) => e.stableId === 'asketch:s1/l1')!;
    expect(edge).toBeTruthy();
    expect(edge.instanceId).toBe('__skeleton__');
    expect(edge.partID).toBe(77);
    // Host at +10 → skeleton shifts −10 in host-local.
    expect(edge.polyline[0].map(Math.round)).toEqual([-10, 0, 0]);
    expect(edge.polyline[1].map(Math.round)).toEqual([40, 0, 0]);
    // Fallback stays in the skeleton's own (world) frame.
    expect(edge.sourceStart).toEqual([0, 0, 0]);
    expect(edge.sourceEnd).toEqual([50, 0, 0]);
    // Line endpoints + standalone points appear as skeleton vertices.
    const vids = ov.vertices.filter((v) => v.instanceId === '__skeleton__').map((v) => v.stableId);
    expect(vids).toContain('asketchv:s1/l1/start');
    expect(vids).toContain('asketchv:s1/l1/end');
    expect(vids).toContain('asketchv:s1/pc/self');
  });

  it('no skeleton in the regen → no skeleton overlay entries', () => {
    const r: AssemblyRegenResponse = {
      faces: [], vertices: [], edges: [], bodies: [], errors: [], constraintState: null,
      instances: [{ instanceId: 'host', partID: 1, placement: ID, bodyIds: [] } as never],
    };
    const ov = buildInContextOverlay(r, 'host');
    expect(ov.edges.some((e) => e.instanceId === '__skeleton__')).toBe(false);
  });
});
