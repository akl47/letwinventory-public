// REQ 1024 — a Fillet/Chamfer blends each picked edge on the body it belongs to.
const { _groupEdgesByBody } = require('../../../services/cadRegenService');

const body = (id, endpoints) => ({ id, topology: { edges: endpoints.map((ep, i) => ({ id: `${id}/e${i}`, endpoints: ep })) } });
const pick = (start, end) => ({ start, end });

describe('multi-body edge blend grouping (REQ 1024)', () => {
  const b1 = body('b1', [[[0, 0, 0], [10, 0, 0]], [[0, 0, 0], [0, 10, 0]]]);
  const b2 = body('b2', [[[50, 0, 0], [60, 0, 0]]]);

  it('groups each edge with the body that owns it', () => {
    const e1 = pick([0, 0, 0], [10, 0, 0]);
    const e2 = pick([60, 0, 0], [50, 0, 0]);  // reversed direction still matches
    const e3 = pick([0, 10, 0], [0, 0, 0]);
    const groups = _groupEdgesByBody([b1, b2], [e1, e2, e3]);
    expect([...groups.keys()]).toEqual([b1, b2]);
    expect(groups.get(b1)).toEqual([e1, e3]);
    expect(groups.get(b2)).toEqual([e2]);
  });

  it('gives an edge on only an earlier body to that body', () => {
    const e = pick([0, 0, 0], [10, 0, 0]);
    const groups = _groupEdgesByBody([b1, b2], [e]);
    expect([...groups.keys()]).toEqual([b1]);
  });

  it('prefers the most recent body when two bodies share an edge', () => {
    const twin = body('b3', [[[0, 0, 0], [10, 0, 0]]]);
    const groups = _groupEdgesByBody([b1, twin], [pick([0, 0, 0], [10, 0, 0])]);
    expect([...groups.keys()]).toEqual([twin]);
  });

  it('falls back to the most recent body when no body has topology', () => {
    const bare = [{ id: 'x' }, { id: 'y' }];
    const groups = _groupEdgesByBody(bare, [pick([0, 0, 0], [1, 0, 0])]);
    expect([...groups.keys()]).toEqual([bare[1]]);
  });
});

// REQ 1051 — a picked edge is found by the faces it lies on, not only its
// saved coordinates, so it survives a face moving (e.g. an extrude height).
describe('edge picks follow their faces (REQ 1051)', () => {
  const flat = (faceId, z, boundaryEdgeIds) => ({
    faceId, boundaryEdgeIds,
    positions: [0, 0, z, 10, 0, z, 0, 10, z], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
  });
  // The top face moved from z=10 to z=6; its two edges moved with it.
  const moved = {
    id: 'b1',
    faces: [flat('top', 6, ['b1/e0', 'b1/e1']), { faceId: 'side', boundaryEdgeIds: ['b1/e0', 'b1/e2'], positions: [], normals: [] }],
    topology: { edges: [
      { id: 'b1/e0', endpoints: [[0, 0, 6], [10, 0, 6]] },
      { id: 'b1/e1', endpoints: [[0, 10, 6], [10, 10, 6]] },
      { id: 'b1/e2', endpoints: [[0, 0, 0], [0, 0, 6]] },
    ] },
  };

  it('finds the edge two named faces share', () => {
    const groups = _groupEdgesByBody([moved], [{ start: [0, 0, 10], end: [10, 0, 10], faces: ['top', 'side'] }]);
    expect(groups.get(moved)).toEqual([expect.objectContaining({ start: [0, 0, 6], end: [10, 0, 6] })]);
  });

  it('measures a single planar face in its current plane', () => {
    const groups = _groupEdgesByBody([moved], [{ start: [0, 10, 10], end: [10, 10, 10], faceId: 'top' }]);
    expect(groups.get(moved)).toEqual([expect.objectContaining({ start: [0, 10, 6], end: [10, 10, 6] })]);
  });

  it('keeps the saved coordinates when the named face is gone', () => {
    const e = { start: [0, 0, 10], end: [10, 0, 10], faceId: 'gone' };
    expect(_groupEdgesByBody([moved], [e]).get(moved)).toEqual([e]);
  });

  it('gives the edge to the body owning its faces', () => {
    const other = body('b2', [[[0, 0, 10], [10, 0, 10]]]);  // sits at the saved coordinates
    const groups = _groupEdgesByBody([moved, other], [{ start: [0, 0, 10], end: [10, 0, 10], faces: ['top', 'side'] }]);
    expect([...groups.keys()]).toEqual([moved]);
  });
});
