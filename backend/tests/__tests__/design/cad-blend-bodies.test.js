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
