import { describe, it, expect } from 'vitest';
import { computeMeasure, fitCircle, MeasureItem } from './measure';

// REQ 652 / 653 / 654 — Measure tool distance + angle results.

const v = (id: string, p: [number, number, number]): MeasureItem =>
  ({ kind: 'vertex', id, position: p });
const lineEdge = (id: string, start: [number, number, number], end: [number, number, number]): MeasureItem =>
  ({ kind: 'edge', id, start, end, isStraight: true });
const curveEdge = (id: string, start: [number, number, number], end: [number, number, number], length: number): MeasureItem =>
  ({ kind: 'edge', id, start, end, isStraight: false, length });
const arcEdge = (
  id: string,
  start: [number, number, number],
  end: [number, number, number],
  length: number,
  center: [number, number, number],
  radius: number,
  normal: [number, number, number],
  closed = false,
): MeasureItem => ({
  kind: 'edge', id, start, end, isStraight: false, length,
  circle: { center, radius, normal, closed },
});
const flatFace = (
  id: string,
  centroid: [number, number, number],
  normal: [number, number, number],
  area = 100,
): MeasureItem => ({ kind: 'face', id, isFlat: true, centroid, normal, area });
const curvedFace = (id: string): MeasureItem => ({ kind: 'face', id, isFlat: false });

describe('computeMeasure', () => {
  describe('single-pick (REQ 652 baseline)', () => {
    it('returns empty result for no picks', () => {
      const r = computeMeasure([]);
      expect(r.summary).toBe('');
      expect(r.rows).toEqual([]);
    });

    it('reports X/Y/Z for a single vertex', () => {
      const r = computeMeasure([v('p', [1, 2, 3])]);
      expect(r.summary).toBe('Vertex');
      expect(r.rows.map(x => x.label)).toEqual(['X', 'Y', 'Z']);
      expect(r.rows[0].value).toMatch(/^1\./);
      expect(r.rows[1].value).toMatch(/^2\./);
      expect(r.rows[2].value).toMatch(/^3\./);
    });

    it('reports chord length for a single straight edge', () => {
      const r = computeMeasure([lineEdge('e', [0, 0, 0], [3, 4, 0])]);
      expect(r.summary).toBe('Line edge');
      expect(r.rows[0].label).toBe('Length');
      expect(r.rows[0].value).toMatch(/^5\./);
    });

    it('uses kernel-emitted length for a curved edge when present', () => {
      // semicircle of radius 5 → length = π·5 ≈ 15.708; endpoints chord = 10.
      const r = computeMeasure([curveEdge('e', [-5, 0, 0], [5, 0, 0], Math.PI * 5)]);
      expect(r.summary).toBe('Curved edge');
      expect(r.rows[0].value).toMatch(/^15\.7/);
    });
  });

  describe('two-vertex distance (REQ 653 case b)', () => {
    it('reports 3D Euclidean distance between two vertices', () => {
      const r = computeMeasure([v('a', [0, 0, 0]), v('b', [3, 4, 12])]);
      expect(r.summary).toBe('Distance between two vertices');
      // Now also emits ΔX / ΔY / ΔZ component rows alongside Distance.
      expect(r.rows.length).toBe(4);
      expect(r.rows[0].label).toBe('Distance');
      expect(r.rows[0].value).toMatch(/^13\./);
      expect(r.rows.map(x => x.label)).toEqual(['Distance', 'ΔX', 'ΔY', 'ΔZ']);
    });
  });

  describe('vertex-to-edge distance (REQ 653 case c)', () => {
    it('reports perpendicular distance from a point to a line', () => {
      // Line on x-axis y=0; point at (5, 7, 0) → perpendicular distance = 7.
      const r = computeMeasure([v('p', [5, 7, 0]), lineEdge('e', [0, 0, 0], [10, 0, 0])]);
      expect(r.rows[0].label).toBe('Distance');
      expect(r.rows[0].value).toMatch(/^7\./);
    });

    it('handles the swapped pick order (edge first, vertex second)', () => {
      const r = computeMeasure([lineEdge('e', [0, 0, 0], [10, 0, 0]), v('p', [5, 7, 0])]);
      expect(r.rows[0].value).toMatch(/^7\./);
    });

    it('falls back to point-to-start when the edge is degenerate', () => {
      const r = computeMeasure([v('p', [3, 4, 0]), lineEdge('e', [0, 0, 0], [0, 0, 0])]);
      expect(r.rows[0].value).toMatch(/^5\./);
    });
  });

  describe('edge-edge distance (REQ 653 case d) and angle (REQ 654)', () => {
    it('reports angle 90° for perpendicular edges', () => {
      const r = computeMeasure([
        lineEdge('e0', [0, 0, 0], [10, 0, 0]),
        lineEdge('e1', [0, 0, 0], [0, 10, 0]),
      ]);
      expect(r.summary).toBe('Two edges');
      expect(r.rows[0].label).toBe('Angle');
      expect(r.rows[0].value).toMatch(/^90\./);
    });

    it('reports angle 45° for diagonal-meeting edges', () => {
      const r = computeMeasure([
        lineEdge('e0', [0, 0, 0], [10, 0, 0]),
        lineEdge('e1', [0, 0, 0], [10, 10, 0]),
      ]);
      expect(r.rows[0].value).toMatch(/^45\./);
    });

    it('treats parallel edges as 0° and reports perpendicular distance instead', () => {
      // Two parallel x-axis lines, separated by 4 in y.
      const r = computeMeasure([
        lineEdge('e0', [0, 0, 0], [10, 0, 0]),
        lineEdge('e1', [0, 4, 0], [10, 4, 0]),
      ]);
      expect(r.summary).toBe('Two parallel edges');
      expect(r.rows.length).toBe(2);
      const distRow = r.rows.find(x => x.label === 'Distance');
      expect(distRow?.value).toMatch(/^4\./);
      const angleRow = r.rows.find(x => x.label === 'Angle');
      expect(angleRow?.value).toMatch(/^0\./);
    });

    it('treats anti-parallel edges as parallel (0°)', () => {
      // Same physical lines, one walked in reverse — direction is opposite
      // sign but the lines they define are identical.
      const r = computeMeasure([
        lineEdge('e0', [0, 0, 0], [10, 0, 0]),
        lineEdge('e1', [10, 4, 0], [0, 4, 0]),
      ]);
      expect(r.summary).toBe('Two parallel edges');
    });

    it('handles skew lines (non-intersecting, non-parallel) and reports the angle between directions', () => {
      // Line 1 along +X at z=0; line 2 along +Y at z=5. Angle between directions = 90°.
      const r = computeMeasure([
        lineEdge('e0', [0, 0, 0], [10, 0, 0]),
        lineEdge('e1', [0, 0, 5], [0, 10, 5]),
      ]);
      expect(r.summary).toBe('Two edges');
      expect(r.rows[0].value).toMatch(/^90\./);
    });

    it('declines to compute when at least one edge is curved', () => {
      const r = computeMeasure([
        lineEdge('e0', [0, 0, 0], [10, 0, 0]),
        curveEdge('e1', [0, 0, 0], [10, 0, 0], 15),
      ]);
      // Message reworded to "non-circular curves not yet supported".
      expect(r.summary).toMatch(/curve/);
      expect(r.rows).toEqual([]);
    });
  });

  describe('fitCircle', () => {
    it('fits a full circle in the XY plane', () => {
      const r = 10;
      const poly: Array<[number, number, number]> = [];
      const N = 32;
      for (let i = 0; i <= N; i++) {
        const t = (i / N) * 2 * Math.PI;
        poly.push([r * Math.cos(t), r * Math.sin(t), 0]);
      }
      const fit = fitCircle(poly);
      expect(fit).not.toBeNull();
      expect(fit!.radius).toBeCloseTo(r, 6);
      expect(fit!.center[0]).toBeCloseTo(0, 6);
      expect(fit!.center[1]).toBeCloseTo(0, 6);
      expect(fit!.center[2]).toBeCloseTo(0, 6);
      expect(Math.abs(fit!.normal[2])).toBeCloseTo(1, 6);
      expect(fit!.closed).toBe(true);
    });

    it('fits a 90° arc (open)', () => {
      const r = 5;
      const poly: Array<[number, number, number]> = [];
      const N = 8;
      for (let i = 0; i <= N; i++) {
        const t = (i / N) * (Math.PI / 2);
        poly.push([r * Math.cos(t), r * Math.sin(t), 0]);
      }
      const fit = fitCircle(poly);
      expect(fit).not.toBeNull();
      expect(fit!.radius).toBeCloseTo(r, 5);
      expect(fit!.closed).toBe(false);
    });

    it('rejects a non-circular polyline (sine-wave)', () => {
      const poly: Array<[number, number, number]> = [];
      for (let i = 0; i <= 16; i++) {
        const x = i;
        poly.push([x, 5 * Math.sin(x), 0]);
      }
      expect(fitCircle(poly)).toBeNull();
    });

    it('returns null for a too-short polyline', () => {
      expect(fitCircle([[0, 0, 0], [1, 0, 0]])).toBeNull();
    });
  });

  describe('circular edge single-pick', () => {
    it('reports radius for a partial arc', () => {
      const r = computeMeasure([arcEdge('e', [10, 0, 0], [0, 10, 0], 15.708, [0, 0, 0], 10, [0, 0, 1], false)]);
      expect(r.summary).toBe('Arc edge');
      const radiusRow = r.rows.find(x => x.label === 'Radius');
      expect(radiusRow?.value).toMatch(/^10\./);
      const diameterRow = r.rows.find(x => x.label === 'Diameter');
      expect(diameterRow).toBeUndefined();
    });

    it('reports radius + diameter + circumference for a full circle', () => {
      const r = computeMeasure([arcEdge('e', [10, 0, 0], [10, 0, 0], 62.83, [0, 0, 0], 10, [0, 0, 1], true)]);
      expect(r.summary).toBe('Full circle edge');
      const labels = r.rows.map(x => x.label);
      expect(labels).toContain('Length');
      expect(labels).toContain('Radius');
      expect(labels).toContain('Diameter');
      expect(labels).toContain('Circumference');
      const diameterRow = r.rows.find(x => x.label === 'Diameter')!;
      expect(diameterRow.value).toMatch(/^20\./);
    });
  });

  describe('two circular curves', () => {
    it('reports center-to-center distance for two coaxial circles', () => {
      // Two parallel circles, normals along +Z, centers at z=0 and z=10.
      const c0 = arcEdge('e0', [5, 0, 0], [5, 0, 0], 31.4, [0, 0, 0], 5, [0, 0, 1], true);
      const c1 = arcEdge('e1', [5, 0, 10], [5, 0, 10], 31.4, [0, 0, 10], 5, [0, 0, 1], true);
      const r = computeMeasure([c0, c1]);
      expect(r.summary).toBe('Two circular curves');
      const dist = r.rows.find(x => x.label === 'Center distance');
      expect(dist?.value).toMatch(/^10\./);
      const axial = r.rows.find(x => x.label === 'Axial');
      expect(axial?.value).toMatch(/^10\./);
      const radial = r.rows.find(x => x.label === 'Radial');
      expect(radial?.value).toMatch(/^0\./);
    });

    it('reports center distance for two non-coaxial circles', () => {
      const c0 = arcEdge('e0', [0, 0, 0], [0, 0, 0], 31.4, [0, 0, 0], 5, [0, 0, 1], true);
      const c1 = arcEdge('e1', [3, 4, 0], [3, 4, 0], 31.4, [3, 4, 0], 5, [0, 0, 1], true);
      const r = computeMeasure([c0, c1]);
      const dist = r.rows.find(x => x.label === 'Center distance');
      expect(dist?.value).toMatch(/^5\./);
    });
  });

  describe('circle to line', () => {
    it('reports perpendicular distance from a line to a circle center', () => {
      const c = arcEdge('e0', [5, 0, 0], [5, 0, 0], 31.4, [0, 0, 0], 5, [0, 0, 1], true);
      const l = lineEdge('e1', [-10, 7, 0], [10, 7, 0]);
      const r = computeMeasure([c, l]);
      expect(r.summary).toBe('Arc/circle to line');
      expect(r.rows[0].value).toMatch(/^7\./);
    });
  });

  describe('face single-pick', () => {
    it('reports area + centroid + normal for a flat face', () => {
      const r = computeMeasure([flatFace('f', [5, 5, 0], [0, 0, 1], 100)]);
      expect(r.summary).toBe('Flat face');
      const labels = r.rows.map(x => x.label);
      expect(labels).toContain('Area');
      expect(labels).toContain('Centroid X');
      expect(labels).toContain('Normal');
    });

    it('skips normal row for a curved face but still emits geometry when present', () => {
      const r = computeMeasure([{ kind: 'face', id: 'f', isFlat: false, area: 50, centroid: [1, 2, 3] }]);
      expect(r.summary).toBe('Curved face');
      const labels = r.rows.map(x => x.label);
      expect(labels).toContain('Area');
      expect(labels).not.toContain('Normal');
    });
  });

  describe('face combinations', () => {
    it('reports perpendicular distance from a vertex to a flat face', () => {
      // Plane at z=0 with normal +Z; vertex at z=7 → distance 7.
      const r = computeMeasure([v('p', [3, 4, 7]), flatFace('f', [0, 0, 0], [0, 0, 1])]);
      expect(r.summary).toBe('Perpendicular distance from vertex to face');
      expect(r.rows[0].value).toMatch(/^7\./);
    });

    it('declines vertex-to-curved-face perpendicular distance', () => {
      const r = computeMeasure([v('p', [0, 0, 7]), curvedFace('f')]);
      expect(r.rows).toEqual([]);
      expect(r.summary).toMatch(/curved/);
    });

    it('reports angle between two perpendicular flat faces (planes)', () => {
      // Two planes whose normals are perpendicular → 90° between planes.
      const r = computeMeasure([
        flatFace('f0', [0, 0, 0], [0, 0, 1]),
        flatFace('f1', [0, 0, 0], [1, 0, 0]),
      ]);
      expect(r.summary).toBe('Two faces');
      expect(r.rows[0].value).toMatch(/^90\./);
    });

    it('reports distance + 0° for two parallel flat faces', () => {
      // Two horizontal planes at z=0 and z=5, both normal +Z.
      const r = computeMeasure([
        flatFace('f0', [0, 0, 0], [0, 0, 1]),
        flatFace('f1', [0, 0, 5], [0, 0, 1]),
      ]);
      expect(r.summary).toBe('Two parallel faces');
      const dist = r.rows.find(x => x.label === 'Distance');
      expect(dist?.value).toMatch(/^5\./);
      const ang = r.rows.find(x => x.label === 'Angle');
      expect(ang?.value).toMatch(/^0\./);
    });

    it('reports angle between an edge and a flat face', () => {
      // Edge along +X, face is the XY plane (normal +Z). Edge lies IN
      // the plane → angle between edge and plane = 0°.
      const r = computeMeasure([
        lineEdge('e', [0, 0, 0], [10, 0, 0]),
        flatFace('f', [0, 0, 0], [0, 0, 1]),
      ]);
      expect(r.summary).toBe('Edge to face');
      const ang = r.rows.find(x => x.label === 'Angle');
      expect(ang?.value).toMatch(/^0\./);
      // Edge parallel to plane → also emits distance.
      const dist = r.rows.find(x => x.label === 'Distance');
      expect(dist).toBeDefined();
    });

    it('reports 90° edge-to-face angle when edge is perpendicular to plane', () => {
      // Edge along +Z meeting the XY plane.
      const r = computeMeasure([
        lineEdge('e', [0, 0, 0], [0, 0, 10]),
        flatFace('f', [0, 0, 0], [0, 0, 1]),
      ]);
      const ang = r.rows.find(x => x.label === 'Angle');
      expect(ang?.value).toMatch(/^90\./);
    });
  });
});
