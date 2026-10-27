// REQ 770/774 — the serializer must strip the volatile snapshot fields
// (cachedProjection.stale / resolvedAt) before hashing so re-resolving an
// in-context reference does not mint a new blob/commit, while keeping the
// meaningful snapshot content and the pinned commit.
const { stripVolatileSketch } = require('../../../services/vcs/cadSerializer');

const sketchWith = (cachedProjection) => ({
  id: 's1',
  state: {
    entities: [{ kind: 'line', id: 'l1', startId: 'p1', endId: 'p2' }],
    constraints: [
      {
        id: 'oe1', type: 'on-edge', targets: [{ entityId: 'l1' }],
        externalRef: {
          scope: 'cross-part', definingAssemblyId: 7, definingAssemblyRepoId: '42',
          sourceInstanceId: 'i2', sourcePartId: 99,
          sourceGeomRef: { featureId: 'f3', edgeId: 'f3/e1' },
          pinnedSourceCommit: 'abc123',
          cachedProjection,
        },
      },
    ],
  },
});

describe('cadSerializer.stripVolatileSketch (REQ 770/774)', () => {
  it('removes stale + resolvedAt but keeps edges, relPlacement, pinnedSourceCommit', () => {
    const s = sketchWith({
      stale: true, resolvedAt: 1700000000000,
      relPlacement: { translate: [1, 2, 3], quaternion: [0, 0, 0, 1] },
      edges: [{ polyline: [[0, 0, 0], [1, 0, 0]] }],
    });
    const out = stripVolatileSketch(s);
    const cp = out.state.constraints[0].externalRef.cachedProjection;
    expect(cp.stale).toBeUndefined();
    expect(cp.resolvedAt).toBeUndefined();
    expect(cp.edges).toEqual([{ polyline: [[0, 0, 0], [1, 0, 0]] }]);
    expect(cp.relPlacement).toEqual({ translate: [1, 2, 3], quaternion: [0, 0, 0, 1] });
    expect(out.state.constraints[0].externalRef.pinnedSourceCommit).toBe('abc123');
  });

  it('produces identical content for sketches differing only in volatile fields', () => {
    const a = stripVolatileSketch(sketchWith({ stale: true, resolvedAt: 1, edges: [{ polyline: [[0, 0, 0]] }] }));
    const b = stripVolatileSketch(sketchWith({ stale: false, resolvedAt: 999, edges: [{ polyline: [[0, 0, 0]] }] }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('returns the same object when there is nothing volatile to strip', () => {
    const s = { id: 's2', state: { entities: [], constraints: [{ id: 'c', type: 'horizontal', targets: [] }] } };
    expect(stripVolatileSketch(s)).toBe(s);
  });

  it('is a no-op on a local externalRef', () => {
    const s = { id: 's3', state: { entities: [], constraints: [
      { id: 'oe', type: 'on-edge', targets: [{ entityId: 'l1' }], externalRef: { scope: 'local', featureId: 'f1', edgeId: 'f1/e0' } },
    ] } };
    expect(stripVolatileSketch(s)).toBe(s);
  });
});
