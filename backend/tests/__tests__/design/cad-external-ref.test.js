// REQ 777 — the sticky-name matcher re-resolves a cross-part external reference's
// source face/edge against the SOURCE part's CURRENT topology, tolerating the
// topology renumbering that happens on nearly every edit. Exact id match first,
// then fallback geometry (edges by closest-endpoint-sum like EdgeRef3D; faces by
// centroid+normal+surfaceKind like _faceRepresentativePlane). Returns null when no
// match is within tolerance → the caller surfaces a "broken" reference.
const { resolveEdgeRef, resolveFaceRef } = require('../../../services/cadExternalRef');

// A minimal "bodies" payload shaped like the regen/kernel output.
const bodies = () => [{
  bodyId: 'b0',
  topology: {
    edges: [
      { id: 'f1#0-e0', endpoints: [[0, 0, 0], [10, 0, 0]], polyline: [[0, 0, 0], [10, 0, 0]], isStraight: true },
      { id: 'f1#0-e1', endpoints: [[10, 0, 0], [10, 5, 0]], polyline: [[10, 0, 0], [10, 5, 0]], isStraight: true },
    ],
  },
  faces: [
    { faceId: 'f1#0-f0', persistentName: 'f1#0-f0', positions: [0, 0, 0, 2, 0, 0, 2, 2, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
      surface: { kind: 'plane', origin: [0, 0, 0], normal: [0, 0, 1] } },
    { faceId: 'f1#0-f1', persistentName: 'f1#0-f1', positions: [0, 0, 5, 2, 0, 5, 2, 2, 5], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
      surface: { kind: 'plane', origin: [0, 0, 5], normal: [0, 0, 1] } },
  ],
}];

describe('cadExternalRef.resolveEdgeRef (REQ 777)', () => {
  it('resolves by exact edge id', () => {
    const r = resolveEdgeRef(bodies(), { edgeId: 'f1#0-e1' }, null);
    expect(r).toBeTruthy();
    expect(r.exact).toBe(true);
    expect(r.edge.id).toBe('f1#0-e1');
    expect(r.bodyId).toBe('b0');
  });

  it('falls back to closest-endpoint match when the id renumbered', () => {
    // Same edge geometry, different id (simulating renumber after an upstream edit).
    const b = bodies();
    b[0].topology.edges[1].id = 'f9#3-e7';
    const r = resolveEdgeRef(b, { edgeId: 'f1#0-e1' }, { kind: 'edge', start: [10, 0, 0], end: [10, 5, 0] });
    expect(r).toBeTruthy();
    expect(r.exact).toBe(false);
    expect(r.edge.id).toBe('f9#3-e7');
  });

  it('matches endpoints regardless of order (reversed edge)', () => {
    const b = bodies();
    b[0].topology.edges[1].id = 'x';
    const r = resolveEdgeRef(b, { edgeId: 'gone' }, { kind: 'edge', start: [10, 5, 0], end: [10, 0, 0] });
    expect(r && r.edge.id).toBe('x');
  });

  it('returns null when no edge is within tolerance', () => {
    const r = resolveEdgeRef(bodies(), { edgeId: 'gone' }, { kind: 'edge', start: [99, 99, 99], end: [88, 88, 88] });
    expect(r).toBeNull();
  });

  it('returns null with no fallback and no id match', () => {
    expect(resolveEdgeRef(bodies(), { edgeId: 'gone' }, null)).toBeNull();
  });
});

describe('cadExternalRef.resolveFaceRef (REQ 777)', () => {
  it('resolves by exact persistent name', () => {
    const r = resolveFaceRef(bodies(), { faceId: 'f1#0-f1' }, null);
    expect(r && r.exact).toBe(true);
    expect(r.face.faceId).toBe('f1#0-f1');
  });

  it('falls back to centroid+normal+surfaceKind when the id renumbered', () => {
    const b = bodies();
    b[0].faces[1].faceId = 'zz'; b[0].faces[1].persistentName = 'zz';
    // fallback points at the z=5 plane (centroid ~[1.33,0.67,5], normal +z)
    const r = resolveFaceRef(b, { faceId: 'f1#0-f1' }, { kind: 'face', centroid: [1.33, 0.67, 5], normal: [0, 0, 1], surfaceKind: 'plane' });
    expect(r && r.exact).toBe(false);
    expect(r.face.faceId).toBe('zz');
  });

  it('does not match a parallel face at a different location', () => {
    const b = bodies();
    b[0].faces[1].faceId = 'zz'; b[0].faces[1].persistentName = 'zz';
    // both faces are +z planes, but the fallback centroid is at z=5 → picks the z=5 one, not z=0
    const r = resolveFaceRef(b, { faceId: 'gone' }, { kind: 'face', centroid: [1.33, 0.67, 5], normal: [0, 0, 1], surfaceKind: 'plane' });
    expect(r && r.face.faceId).toBe('zz');
  });

  it('returns null when no face is within tolerance', () => {
    const r = resolveFaceRef(bodies(), { faceId: 'gone' }, { kind: 'face', centroid: [50, 50, 50], normal: [1, 0, 0], surfaceKind: 'plane' });
    expect(r).toBeNull();
  });
});
