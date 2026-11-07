// REQ 1017 — a fillet/chamfer whose rounds overrun each other is retried as
// edge groups blended separately on the original body, then combined.
const { blendInGroups, isBlendOverrunError } = require('../../../services/cadBlendGroups');

const overrun = () => new Error('CAD kernel buildEdgeBlend failed (code -32603): fillet did not complete — the radius is too large for this edge set.');

// Fake kernel: a "brep" is { vol, edges }. Edges named a* and b* conflict
// when blended together; 'x' fails even alone. Each edge adds (or removes,
// when `sign` < 0) 10 units of volume.
function fakeKernel({ sign = 1, perEdge = {} } = {}) {
  const calls = { blend: [], boolean: [] };
  const deltaOf = e => (perEdge[e] ?? sign) * 10;
  return {
    calls,
    blend: async (edges) => {
      calls.blend.push(edges);
      if (edges.includes('x')) throw overrun();
      if (edges.some(e => e.startsWith('a')) && edges.some(e => e.startsWith('b'))) throw overrun();
      return { brepBytes: { vol: 100 + edges.reduce((s, e) => s + deltaOf(e), 0), edges } };
    },
    volume: async brep => brep.vol,
    boolean: async (op, a, b) => {
      calls.boolean.push(op);
      // Overlap of 1 unit between groups: a fuse gains a bit less than the
      // sum, a common loses a bit less.
      const vol = op === 'fuse' ? a.vol + (b.vol - 100) - 1 : a.vol + (b.vol - 100) + 1;
      return { brepBytes: { vol }, faces: [], solids: [{}] };
    },
  };
}

describe('grouped blend fallback (REQ 1017)', () => {
  it('recognises only the kernel overrun error', () => {
    expect(isBlendOverrunError(overrun())).toBe(true);
    expect(isBlendOverrunError(new Error('chamfer did not complete — the distance is too large'))).toBe(true);
    expect(isBlendOverrunError(new Error('fillet produced no solid'))).toBe(false);
  });

  it('groups conflicting edges and fuses additive groups', async () => {
    const k = fakeKernel();
    const r = await blendInGroups({ edges: ['a1', 'b1', 'a2', 'b2'], baseBrep: { vol: 100 }, ...k, originalError: overrun() });
    expect(r.groups).toEqual([['a1', 'a2'], ['b1', 'b2']]);
    expect(k.calls.boolean).toEqual(['fuse']);
    expect(r.rpc.brepBytes.vol).toBe(139);
  });

  it('intersects subtractive groups', async () => {
    const k = fakeKernel({ sign: -1 });
    const r = await blendInGroups({ edges: ['a1', 'b1'], baseBrep: { vol: 100 }, ...k, originalError: overrun() });
    expect(k.calls.boolean).toEqual(['common']);
    expect(r.rpc.brepBytes.vol).toBe(81);
  });

  it('rethrows the original error when an edge fails on its own', async () => {
    const err = overrun();
    await expect(blendInGroups({ edges: ['a1', 'x'], baseBrep: { vol: 100 }, ...fakeKernel(), originalError: err }))
      .rejects.toBe(err);
  });

  it('rethrows when groups mix added and removed material', async () => {
    const err = overrun();
    const k = fakeKernel({ perEdge: { a1: 1, b1: -1 } });
    await expect(blendInGroups({ edges: ['a1', 'b1'], baseBrep: { vol: 100 }, ...k, originalError: err }))
      .rejects.toBe(err);
    expect(k.calls.boolean).toEqual([]);
  });

  it('rethrows when the combined volume is impossible', async () => {
    const err = overrun();
    const k = fakeKernel();
    k.boolean = async () => ({ brepBytes: { vol: 500 }, faces: [], solids: [{}] });
    await expect(blendInGroups({ edges: ['a1', 'b1'], baseBrep: { vol: 100 }, ...k, originalError: err }))
      .rejects.toBe(err);
  });
});
