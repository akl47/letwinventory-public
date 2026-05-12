import { describe, it, expect } from 'vitest';
import { emptyDocument, createSketch, updateSketchState, findSketchByHost, promoteVertex, promoteEdge } from './document';
import { emptySketchState } from './store';
import type { ModelTopology, Plane3 } from './types';

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
      const newState = { points: [{ id: 'p1', x: 1, y: 2 }], lines: [], constraints: [] };
      const doc2 = updateSketchState(doc, sketchId, newState);
      expect(doc2.sketches[sketchId].state).toEqual(newState);
    });

    it('does not mutate the original document', () => {
      const { doc, sketchId } = createSketch(emptyDocument(), 'datum:xy_plane', XY_PLANE, null);
      const original = doc.sketches[sketchId].state;
      updateSketchState(doc, sketchId, { points: [{ id: 'p1', x: 1, y: 2 }], lines: [], constraints: [] });
      expect(doc.sketches[sketchId].state).toBe(original);
    });
  });

  describe('promoteVertex / promoteEdge', () => {
    it('promoteVertex returns a reference point with reference=true', () => {
      const { state, id } = promoteVertex(emptySketchState(), 'v1', 3, 4);
      const pt = state.points.find(p => p.id === id);
      expect(pt?.reference).toBe(true);
      expect(pt?.x).toBe(3);
      expect(pt?.y).toBe(4);
    });

    it('promoteEdge returns a reference line with two reference endpoints', () => {
      const { state, id } = promoteEdge(emptySketchState(), 'e1', { x: 0, y: 0 }, { x: 10, y: 0 });
      expect(state.lines.find(l => l.id === id)?.reference).toBe(true);
      expect(state.points.filter(p => p.reference === true).length).toBe(2);
    });
  });
});
