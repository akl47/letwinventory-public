import { describe, it, expect } from 'vitest';
import {
  emptyDocument, createSketch, updateSketchState, findSketchByHost, promoteVertex, promoteEdge,
  deleteSketch, setSketchVisibility, circleCenterFromProjected,
} from './document';
import { emptySketchState, ORIGIN_POINT_ID } from './store';
import type { ModelTopology, Plane3, SketchState } from './types';
import { pointsOf, findPoint, findLine } from './types';

const XY_PLANE: Plane3 = {
  origin: [0, 0, 0],
  xAxis: [1, 0, 0],
  yAxis: [0, 1, 0],
  normal: [0, 0, 1],
};

const BOX_TOPOLOGY: ModelTopology = {
  vertices: [
    { id: 'v1', position: [0, 0, 0] },
    { id: 'v2', position: [10, 0, 0] },
    { id: 'v3', position: [10, 10, 0] },
    { id: 'v4', position: [0, 10, 0] },
  ],
  edges: [
    { id: 'e1', isStraight: true, endpoints: [[0, 0, 0], [10, 0, 0]] },
    { id: 'e2', isStraight: true, endpoints: [[10, 0, 0], [10, 10, 0]] },
    { id: 'e3', isStraight: true, endpoints: [[10, 10, 0], [0, 10, 0]] },
    { id: 'e4', isStraight: true, endpoints: [[0, 10, 0], [0, 0, 0]] },
  ],
};

describe('Sketch document (CAD-022, CAD-023, CAD-026, CAD-028, CAD-030)', () => {
  describe('emptyDocument', () => {
    it('has no sketches', () => {
      const d = emptyDocument();
      expect(Object.keys(d.sketches).length).toBe(0);
    });
  });

  describe('createSketch (CAD-022, CAD-023)', () => {
    it('creates a sketch with the given host and plane (CAD-022)', () => {
      const d0 = emptyDocument();
      const { doc: d1, sketchId } = createSketch(d0, 'datum:xy_plane', XY_PLANE, null);
      const sk = d1.sketches[sketchId];
      expect(sk).toBeTruthy();
      expect(sk.hostId).toBe('datum:xy_plane');
      expect(sk.plane).toEqual(XY_PLANE);
    });

    it('initializes the sketch with empty state', () => {
      const { doc, sketchId } = createSketch(emptyDocument(), 'datum:xy_plane', XY_PLANE, null);
      expect(doc.sketches[sketchId].state).toEqual(emptySketchState());
    });

    it('hosts a sketch on a face id (CAD-022)', () => {
      const { doc, sketchId } = createSketch(emptyDocument(), 'face:0', XY_PLANE, null);
      expect(doc.sketches[sketchId].hostId).toBe('face:0');
    });
  });

  describe('reference candidates (CAD-030)', () => {
    it('projects every straight edge and unique vertex of the topology onto the plane', () => {
      const { doc, sketchId } = createSketch(emptyDocument(), 'face:0', XY_PLANE, BOX_TOPOLOGY);
      const sk = doc.sketches[sketchId];
      const vertexCandidates = sk.candidates.filter(c => c.kind === 'vertex');
      const edgeCandidates = sk.candidates.filter(c => c.kind === 'edge');
      expect(vertexCandidates.length).toBe(4);
      expect(edgeCandidates.length).toBe(4);
    });

    it('omits degenerate edge projections (zero length on the plane)', () => {
      // An edge perpendicular to the XY plane projects to a single point — skip it.
      const topo: ModelTopology = {
        vertices: [{ id: 'v1', position: [0, 0, 0] }, { id: 'v2', position: [0, 0, 5] }],
        edges: [{ id: 'e1', isStraight: true, endpoints: [[0, 0, 0], [0, 0, 5]] }],
      };
      const { doc, sketchId } = createSketch(emptyDocument(), 'face:0', XY_PLANE, topo);
      const edgeCandidates = doc.sketches[sketchId].candidates.filter(c => c.kind === 'edge');
      expect(edgeCandidates.length).toBe(0);
    });

    it('produces no candidates when topology is null (datum-plane sketch)', () => {
      const { doc, sketchId } = createSketch(emptyDocument(), 'datum:xy_plane', XY_PLANE, null);
      expect(doc.sketches[sketchId].candidates.length).toBe(0);
    });

    it('exposes the center of a projected circular edge as a center candidate (REQ 830)', () => {
      // A full circle edge (closed polyline) centered at (5, 7) radius 3 on XY.
      const n = 24;
      const polyline: Array<[number, number, number]> = [];
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * 2 * Math.PI;
        polyline.push([5 + 3 * Math.cos(a), 7 + 3 * Math.sin(a), 0]);
      }
      const topo: ModelTopology = {
        vertices: [],
        edges: [{ id: 'f1/e0', isStraight: false, endpoints: [[8, 7, 0], [8, 7, 0]], polyline }],
      };
      const { doc, sketchId } = createSketch(emptyDocument(), 'face:0', XY_PLANE, topo);
      const centers = doc.sketches[sketchId].candidates.filter(c => c.kind === 'center');
      expect(centers.length).toBe(1);
      expect(centers[0].id).toBe('cand-c-f1/e0');
      expect(centers[0].points[0].x).toBeCloseTo(5, 6);
      expect(centers[0].points[0].y).toBeCloseTo(7, 6);
    });

    it('emits no center candidate for a straight edge', () => {
      const { doc, sketchId } = createSketch(emptyDocument(), 'face:0', XY_PLANE, BOX_TOPOLOGY);
      expect(doc.sketches[sketchId].candidates.filter(c => c.kind === 'center').length).toBe(0);
    });
  });

  describe('circleCenterFromProjected (REQ 830)', () => {
    it('returns the centroid of a closed circular loop', () => {
      const n = 16; const pts: Array<{ x: number; y: number }> = [];
      for (let i = 0; i <= n; i++) { const a = (i / n) * 2 * Math.PI; pts.push({ x: 2 + 5 * Math.cos(a), y: -1 + 5 * Math.sin(a) }); }
      const c = circleCenterFromProjected(pts);
      expect(c!.x).toBeCloseTo(2, 6);
      expect(c!.y).toBeCloseTo(-1, 6);
    });

    it('returns the circumcenter of an open arc', () => {
      const n = 12; const pts: Array<{ x: number; y: number }> = [];
      for (let i = 0; i <= n; i++) { const a = (i / n) * (Math.PI / 2); pts.push({ x: 4 * Math.cos(a), y: 4 * Math.sin(a) }); }
      const c = circleCenterFromProjected(pts);
      expect(c!.x).toBeCloseTo(0, 4);
      expect(c!.y).toBeCloseTo(0, 4);
    });

    it('returns null for a straight (collinear) polyline', () => {
      expect(circleCenterFromProjected([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }])).toBeNull();
    });

    it('returns null for a non-circular (elliptical) sample', () => {
      const n = 16; const pts: Array<{ x: number; y: number }> = [];
      for (let i = 0; i <= n; i++) { const a = (i / n) * 2 * Math.PI; pts.push({ x: 6 * Math.cos(a), y: 2 * Math.sin(a) }); }
      expect(circleCenterFromProjected(pts)).toBeNull();
    });
  });

  describe('findSketchByHost (CAD-028)', () => {
    it('returns the sketch hosted by the given id', () => {
      const { doc, sketchId } = createSketch(emptyDocument(), 'face:0', XY_PLANE, null);
      const found = findSketchByHost(doc, 'face:0');
      expect(found?.id).toBe(sketchId);
    });

    it('returns null when no sketch is hosted', () => {
      expect(findSketchByHost(emptyDocument(), 'face:42')).toBeNull();
    });
  });

  describe('updateSketchState (CAD-026)', () => {
    it('replaces the state of the named sketch', () => {
      const { doc, sketchId } = createSketch(emptyDocument(), 'datum:xy_plane', XY_PLANE, null);
      const newState: SketchState = {
        entities: [{ kind: 'point', id: 'p1', x: 1, y: 2 }],
        constraints: [],
      };
      const doc2 = updateSketchState(doc, sketchId, newState);
      expect(doc2.sketches[sketchId].state).toEqual(newState);
    });

    it('does not mutate the original document', () => {
      const { doc, sketchId } = createSketch(emptyDocument(), 'datum:xy_plane', XY_PLANE, null);
      const original = doc.sketches[sketchId].state;
      updateSketchState(doc, sketchId, {
        entities: [{ kind: 'point', id: 'p1', x: 1, y: 2 }],
        constraints: [],
      });
      expect(doc.sketches[sketchId].state).toBe(original);
    });
  });

  describe('promoteVertex / promoteEdge', () => {
    it('promoteVertex returns a construction point (REQ 560)', () => {
      const { state, id } = promoteVertex(emptySketchState(), 'v1', 3, 4);
      const pt = findPoint(state, id);
      expect(pt?.construction).toBe(true);
      expect(pt?.x).toBe(3);
      expect(pt?.y).toBe(4);
    });

    it('promoteEdge returns a construction line with two construction endpoints (REQ 560)', () => {
      const { state, id } = promoteEdge(emptySketchState(), 'e1', { x: 0, y: 0 }, { x: 10, y: 0 });
      expect(findLine(state, id)?.construction).toBe(true);
      // Exclude the synthetic origin point (always construction) from the
      // count — we only care about the two endpoints promoteEdge introduced.
      const userConstruction = pointsOf(state)
        .filter(p => p.id !== ORIGIN_POINT_ID && p.construction === true);
      expect(userConstruction.length).toBe(2);
    });
  });

  describe('deleteSketch (REQ 608)', () => {
    it('removes the named sketch from the document', () => {
      const { doc: d1, sketchId } = createSketch(emptyDocument(), 'datum:xy_plane', XY_PLANE, null);
      const d2 = deleteSketch(d1, sketchId);
      expect(d2.sketches[sketchId]).toBeUndefined();
      expect(Object.keys(d2.sketches)).toHaveLength(0);
    });

    it('is a no-op when the sketch is not in the document', () => {
      const d0 = emptyDocument();
      const d1 = deleteSketch(d0, 'not-a-real-id');
      expect(d1).toEqual(d0);
    });

    it('does not mutate the original document', () => {
      const { doc: d1, sketchId } = createSketch(emptyDocument(), 'datum:xy_plane', XY_PLANE, null);
      const beforeKeys = Object.keys(d1.sketches);
      deleteSketch(d1, sketchId);
      expect(Object.keys(d1.sketches)).toEqual(beforeKeys);
    });

    it('preserves other sketches', () => {
      let doc = emptyDocument();
      const r1 = createSketch(doc, 'datum:xy_plane', XY_PLANE, null);
      doc = r1.doc;
      const r2 = createSketch(doc, 'datum:xz_plane', XY_PLANE, null);
      doc = r2.doc;
      const d3 = deleteSketch(doc, r1.sketchId);
      expect(d3.sketches[r1.sketchId]).toBeUndefined();
      expect(d3.sketches[r2.sketchId]).toBeDefined();
    });
  });

  describe('setSketchVisibility (REQ 614)', () => {
    it('sets visible=false on the named sketch', () => {
      const { doc: d1, sketchId } = createSketch(emptyDocument(), 'datum:xy_plane', XY_PLANE, null);
      const d2 = setSketchVisibility(d1, sketchId, false);
      expect(d2.sketches[sketchId].visible).toBe(false);
    });

    it('sets visible=true on the named sketch (restoring after hide)', () => {
      const { doc: d1, sketchId } = createSketch(emptyDocument(), 'datum:xy_plane', XY_PLANE, null);
      const d2 = setSketchVisibility(d1, sketchId, false);
      const d3 = setSketchVisibility(d2, sketchId, true);
      expect(d3.sketches[sketchId].visible).toBe(true);
    });

    it('is a no-op when the sketch is not in the document', () => {
      const d0 = emptyDocument();
      const d1 = setSketchVisibility(d0, 'not-a-real-id', false);
      expect(d1).toEqual(d0);
    });

    it('does not mutate the original document', () => {
      const { doc: d1, sketchId } = createSketch(emptyDocument(), 'datum:xy_plane', XY_PLANE, null);
      setSketchVisibility(d1, sketchId, false);
      expect(d1.sketches[sketchId].visible).toBeUndefined();
    });
  });
});
