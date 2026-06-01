import { describe, it, expect } from 'vitest';
import { buildOriginDatums, computeDatumPlane, planeForDatum, resolvePlaneRef } from './datum';
import type { DatumPlaneFeature, ModelGeometry } from './types';

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

  it('every standard plane has a right-handed basis (xAxis × yAxis == normal)', () => {
    // A left-handed basis mirrors orientation-sensitive geometry (most
    // visibly: sketch text renders backwards). Guard all three.
    for (const id of ['xy_plane', 'yz_plane', 'xz_plane']) {
      const p = planeForDatum(id)!;
      const [ax, ay, az] = p.xAxis;
      const [bx, by, bz] = p.yAxis;
      const cross: [number, number, number] = [
        ay * bz - az * by,
        az * bx - ax * bz,
        ax * by - ay * bx,
      ];
      expect(cross).toEqual(p.normal);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// REQ 657 — Datum Plane construction methods.
// One test per method on known-geometry inputs, plus error paths for
// degenerate inputs (collinear three-points, zero-length edge, missing
// references).
// ─────────────────────────────────────────────────────────────────────

function emptyGeom(): ModelGeometry {
  return { datums: [], faces: [], topology: { vertices: [], edges: [] } };
}
function geomWithVertex(id: string, p: [number, number, number]): ModelGeometry {
  return {
    datums: [], faces: [],
    topology: { vertices: [{ id, position: p }], edges: [] },
  };
}
function vRef(id: string, p: [number, number, number]) {
  return { vertexId: id, fallbackPosition: p };
}
const XY_DATUM = { kind: 'datum' as const, datumId: 'xy_plane' };

describe('computeDatumPlane (REQ 657)', () => {
  describe('offset', () => {
    it('moves the XY plane up by +distance along its normal', () => {
      const f: DatumPlaneFeature = {
        id: 'f1', type: 'datumPlane',
        method: { kind: 'offset', planeRef: XY_DATUM, distance: 10 },
      };
      const r = computeDatumPlane(f, emptyGeom());
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.plane.origin[2]).toBeCloseTo(10, 9);
        expect(r.plane.normal[2]).toBeCloseTo(1, 9);
      }
    });

    it('flips offset direction when flipped: true', () => {
      const f: DatumPlaneFeature = {
        id: 'f1', type: 'datumPlane',
        method: { kind: 'offset', planeRef: XY_DATUM, distance: 10, flipped: true },
      };
      const r = computeDatumPlane(f, emptyGeom());
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.plane.origin[2]).toBeCloseTo(-10, 9);
    });

    it('reports an error when the reference plane is unknown', () => {
      const f: DatumPlaneFeature = {
        id: 'f1', type: 'datumPlane',
        method: { kind: 'offset', planeRef: { kind: 'datum', datumId: 'made_up' }, distance: 5 },
      };
      expect(computeDatumPlane(f, emptyGeom()).ok).toBe(false);
    });
  });

  describe('parallelThroughPoint', () => {
    it('anchors a parallel plane at the picked vertex', () => {
      const geom = geomWithVertex('v1', [3, 4, 7]);
      const f: DatumPlaneFeature = {
        id: 'f1', type: 'datumPlane',
        method: { kind: 'parallelThroughPoint', planeRef: XY_DATUM, vertexRef: vRef('v1', [3, 4, 7]) },
      };
      const r = computeDatumPlane(f, geom);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.plane.origin).toEqual([3, 4, 7]);
        expect(r.plane.normal[2]).toBeCloseTo(1, 9);
      }
    });

    it('falls back to vertexRef.fallbackPosition when topology lacks the id', () => {
      const f: DatumPlaneFeature = {
        id: 'f1', type: 'datumPlane',
        method: { kind: 'parallelThroughPoint', planeRef: XY_DATUM, vertexRef: vRef('missing', [1, 2, 3]) },
      };
      const r = computeDatumPlane(f, emptyGeom());
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.plane.origin).toEqual([1, 2, 3]);
    });
  });

  describe('angleThroughEdge', () => {
    it('rotates the XY plane by 90° about an x-axis edge → YZ-ish plane', () => {
      const f: DatumPlaneFeature = {
        id: 'f1', type: 'datumPlane',
        method: {
          kind: 'angleThroughEdge', planeRef: XY_DATUM,
          edgeRef: { start: [0, 0, 0], end: [10, 0, 0] }, angleDeg: 90,
        },
      };
      const r = computeDatumPlane(f, emptyGeom());
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.plane.normal[0]).toBeCloseTo(0, 6);
        expect(r.plane.normal[1]).toBeCloseTo(-1, 6);
        expect(r.plane.normal[2]).toBeCloseTo(0, 6);
      }
    });

    it('errors on zero-length edge', () => {
      const f: DatumPlaneFeature = {
        id: 'f1', type: 'datumPlane',
        method: {
          kind: 'angleThroughEdge', planeRef: XY_DATUM,
          edgeRef: { start: [1, 1, 1], end: [1, 1, 1] }, angleDeg: 30,
        },
      };
      expect(computeDatumPlane(f, emptyGeom()).ok).toBe(false);
    });
  });

  describe('threePoints', () => {
    it('builds an XY-aligned plane from three z=0 points', () => {
      const geom: ModelGeometry = {
        datums: [], faces: [],
        topology: {
          vertices: [
            { id: 'a', position: [0, 0, 0] },
            { id: 'b', position: [10, 0, 0] },
            { id: 'c', position: [0, 10, 0] },
          ],
          edges: [],
        },
      };
      const f: DatumPlaneFeature = {
        id: 'f1', type: 'datumPlane',
        method: {
          kind: 'threePoints',
          vertexRefs: [vRef('a', [0, 0, 0]), vRef('b', [10, 0, 0]), vRef('c', [0, 10, 0])],
        },
      };
      const r = computeDatumPlane(f, geom);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(Math.abs(r.plane.normal[2])).toBeCloseTo(1, 6);
        expect(r.plane.origin).toEqual([0, 0, 0]);
      }
    });

    it('rejects three collinear points', () => {
      const f: DatumPlaneFeature = {
        id: 'f1', type: 'datumPlane',
        method: {
          kind: 'threePoints',
          vertexRefs: [vRef('a', [0, 0, 0]), vRef('b', [1, 0, 0]), vRef('c', [2, 0, 0])],
        },
      };
      const r = computeDatumPlane(f, emptyGeom());
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/collinear/i);
    });
  });

  describe('midPlane', () => {
    it('builds the halfway-parallel plane between two parallel datums', () => {
      const upstreamPlane = {
        origin: [0, 0, 10] as [number, number, number],
        xAxis: [1, 0, 0] as [number, number, number],
        yAxis: [0, 1, 0] as [number, number, number],
        normal: [0, 0, 1] as [number, number, number],
      };
      const geom: ModelGeometry = {
        datums: [{ id: 'datum:f10', kind: 'plane', direction: [0, 0, 1], plane: upstreamPlane } as any],
        faces: [], topology: { vertices: [], edges: [] },
      };
      const f: DatumPlaneFeature = {
        id: 'f1', type: 'datumPlane',
        method: {
          kind: 'midPlane',
          planeRefA: XY_DATUM,
          planeRefB: { kind: 'datum', datumId: 'datum:f10' },
        },
      };
      const r = computeDatumPlane(f, geom);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.plane.origin[2]).toBeCloseTo(5, 9);
        expect(r.plane.normal[2]).toBeCloseTo(1, 9);
      }
    });
  });

  describe('lineAndPerpFace', () => {
    it('builds a plane containing the edge, perpendicular to the ref face', () => {
      // Reference face XY (normal +Z); edge along +X. Result: plane
      // contains +X and is perpendicular to XY → normal ±Y.
      const f: DatumPlaneFeature = {
        id: 'f1', type: 'datumPlane',
        method: {
          kind: 'lineAndPerpFace',
          edgeRef: { start: [0, 0, 0], end: [10, 0, 0] },
          planeRef: XY_DATUM,
        },
      };
      const r = computeDatumPlane(f, emptyGeom());
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.plane.normal[0]).toBeCloseTo(0, 6);
        expect(Math.abs(r.plane.normal[1])).toBeCloseTo(1, 6);
        expect(r.plane.normal[2]).toBeCloseTo(0, 6);
      }
    });
  });

  describe('pointAndPerpEdge', () => {
    it('builds a plane through the point with the edge direction as the normal', () => {
      const geom = geomWithVertex('v1', [5, 5, 5]);
      const f: DatumPlaneFeature = {
        id: 'f1', type: 'datumPlane',
        method: {
          kind: 'pointAndPerpEdge',
          vertexRef: vRef('v1', [5, 5, 5]),
          edgeRef: { start: [0, 0, 0], end: [0, 0, 10] },  // +Z direction
        },
      };
      const r = computeDatumPlane(f, geom);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.plane.origin).toEqual([5, 5, 5]);
        expect(Math.abs(r.plane.normal[2])).toBeCloseTo(1, 6);
      }
    });
  });
});

describe('resolvePlaneRef', () => {
  it('resolves origin datum ids to their hard-coded planes', () => {
    const p = resolvePlaneRef({ kind: 'datum', datumId: 'xy_plane' }, emptyGeom());
    expect(p).not.toBeNull();
    expect(p?.normal[2]).toBeCloseTo(1, 9);
  });

  it('returns null for unknown datum ids in an empty geometry', () => {
    expect(resolvePlaneRef({ kind: 'datum', datumId: 'unknown' }, emptyGeom())).toBeNull();
  });

  it('resolves a face ref via its fallbackPlane snapshot', () => {
    const p = resolvePlaneRef({
      kind: 'face', faceId: 'irrelevant',
      fallbackPlane: { origin: [1, 2, 3], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
    }, emptyGeom());
    expect(p).not.toBeNull();
    expect(p?.origin).toEqual([1, 2, 3]);
  });
});
