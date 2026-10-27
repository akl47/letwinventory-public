// REQ 772/776/778 — assembly-driven LIVE cross-part regeneration. After the mate
// solve, each instance whose part references another instance's geometry is
// re-regenerated with the source geometry transformed into its frame, in
// dependency order; cycles degrade to the cached snapshot. Pure injection — no
// db/kernel.
const {
  regenerateAssembly, crossPartRefsOf, buildCrossPartDepGraph,
  topoOrderWithCycles, makeCrossPartResolver,
} = require('../../../services/assemblyRegenService');

describe('cross-part dependency graph + topo order (REQ 772/776)', () => {
  const insts = (...ids) => ids.map((id) => ({ instanceId: id }));

  it('crossPartRefsOf keeps only this assembly\'s cross-part refs', () => {
    const doc = { sketches: { s1: { state: { constraints: [
      { id: 'oe1', type: 'on-edge', externalRef: { scope: 'cross-part', definingAssemblyId: 7, sourceInstanceId: 'B', sourceGeomRef: { edgeId: 'eB' } } },
      { id: 'oe2', type: 'on-edge', externalRef: { scope: 'cross-part', definingAssemblyId: 9, sourceInstanceId: 'C' } },
      { id: 'loc', type: 'on-edge', externalRef: { scope: 'local', edgeId: 'x' } },
    ] } } } };
    const refs = crossPartRefsOf(doc, 7);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ constraintId: 'oe1', sourceInstanceId: 'B' });
  });

  it('orders dependencies before dependents (A→B→C ⇒ C,B,A)', () => {
    const g = buildCrossPartDepGraph(insts('A', 'B', 'C'), new Map([
      ['A', [{ sourceInstanceId: 'B' }]], ['B', [{ sourceInstanceId: 'C' }]],
    ]));
    const { order, backEdges } = topoOrderWithCycles(g.nodes, g.edges);
    expect(order.indexOf('C')).toBeLessThan(order.indexOf('B'));
    expect(order.indexOf('B')).toBeLessThan(order.indexOf('A'));
    expect(backEdges.size).toBe(0);
  });

  it('flags a cycle\'s edges as back-edges (A↔B)', () => {
    const g = buildCrossPartDepGraph(insts('A', 'B'), new Map([
      ['A', [{ sourceInstanceId: 'B' }]], ['B', [{ sourceInstanceId: 'A' }]],
    ]));
    const { backEdges } = topoOrderWithCycles(g.nodes, g.edges);
    expect(backEdges.has('A|B')).toBe(true);
    expect(backEdges.has('B|A')).toBe(true);
  });

  it('ignores a self-reference edge', () => {
    const g = buildCrossPartDepGraph(insts('A'), new Map([['A', [{ sourceInstanceId: 'A' }]]]));
    expect(g.edges.size).toBe(0);
  });
});

describe('makeCrossPartResolver (REQ 772/777)', () => {
  const childGeoById = new Map([['B', { bodies: [{ edges: [{ id: 'eB', polyline: [[0, 0, 0], [1, 0, 0]] }] }] }]]);
  const poses = { A: { translate: [0, 0, 0], quaternion: [0, 0, 0, 1] }, B: { translate: [10, 0, 0], quaternion: [0, 0, 0, 1] } };

  it('transforms the source edge into the dependent\'s frame', () => {
    const r = makeCrossPartResolver({ dependentId: 'A', childGeoById, poses, backEdges: new Set() });
    const out = r({ sourceInstanceId: 'B', sourceGeomRef: { edgeId: 'eB' } });
    expect(out.polyline).toEqual([[10, 0, 0], [11, 0, 0]]);
  });

  it('returns null for a cyclic back-edge (→ snapshot fallback)', () => {
    const r = makeCrossPartResolver({ dependentId: 'A', childGeoById, poses, backEdges: new Set(['A|B']) });
    expect(r({ sourceInstanceId: 'B', sourceGeomRef: { edgeId: 'eB' } })).toBeNull();
  });

  it('returns null when the source instance has no geometry', () => {
    const r = makeCrossPartResolver({ dependentId: 'A', childGeoById, poses, backEdges: new Set() });
    expect(r({ sourceInstanceId: 'Z', sourceGeomRef: { edgeId: 'eB' } })).toBeNull();
  });
});

describe('regenerateAssembly — Phase B.5 live in-context regen (REQ 772/776)', () => {
  const baseDoc = (extraInstances = {}) => ({
    id: 7, partID: 1,
    assemblyDoc: {
      instances: [
        { instanceId: 'A', partID: 10, placement: { translate: [0, 0, 0], quaternion: [0, 0, 0, 1] }, ...extraInstances.A },
        { instanceId: 'B', partID: 20, grounded: true, placement: { translate: [10, 0, 0], quaternion: [0, 0, 0, 1] }, ...extraInstances.B },
      ],
      mates: [], patterns: [],
    },
  });

  // B is the source (carries edge eB); A is the dependent.
  const childGeo = (id) => id === 'B'
    ? { faces: [], vertices: [], edges: [{ polyline: [[0, 0, 0], [1, 0, 0]] }], bodies: [{ id: 'bB', edges: [{ id: 'eB', polyline: [[0, 0, 0], [1, 0, 0]] }], faces: [], vertices: [] }] }
    : { faces: [], vertices: [], edges: [], bodies: [{ id: 'bA', edges: [], faces: [], vertices: [] }] };

  it('passes a live resolver to the dependent that yields the transformed source edge', async () => {
    let captured = null;
    const resolveChild = async (inst, _asm, opts = {}) => {
      if (inst.instanceId === 'A' && opts.externalRefResolver) {
        captured = opts.externalRefResolver({ sourceInstanceId: 'B', sourceGeomRef: { edgeId: 'eB' } });
      }
      return childGeo(inst.instanceId);
    };
    const childRefs = async (inst) => inst.instanceId === 'A'
      ? [{ constraintId: 'oe1', sourceInstanceId: 'B', externalRef: { scope: 'cross-part', definingAssemblyId: 7, sourceInstanceId: 'B', sourceGeomRef: { edgeId: 'eB' } } }]
      : [];
    const out = await regenerateAssembly(baseDoc(), { resolveChild, childRefs });
    expect(captured).not.toBeNull();
    expect(captured.polyline).toEqual([[10, 0, 0], [11, 0, 0]]); // B's edge in A's frame
    expect(out.errors).toEqual([]);
  });

  it('degrades an A↔B cycle to the snapshot and records a warning, never throwing', async () => {
    const resolveChild = async (inst) => childGeo(inst.instanceId);
    const childRefs = async (inst) => inst.instanceId === 'A'
      ? [{ constraintId: 'oeA', sourceInstanceId: 'B', externalRef: { scope: 'cross-part', definingAssemblyId: 7, sourceInstanceId: 'B', sourceGeomRef: { edgeId: 'eB' } } }]
      : [{ constraintId: 'oeB', sourceInstanceId: 'A', externalRef: { scope: 'cross-part', definingAssemblyId: 7, sourceInstanceId: 'A', sourceGeomRef: { edgeId: 'eA' } } }];
    const out = await regenerateAssembly(baseDoc(), { resolveChild, childRefs });
    expect(out.errors.some((e) => /Cyclic in-context reference/.test(e))).toBe(true);
  });
});
