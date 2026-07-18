// REQ 915/916 — skeleton in-context references: assembly-sketch geometry
// evaluation, the skeleton branch of the cross-part resolver, and the Phase
// B.5 re-regen of skeleton-only dependents. Pure injection — no db/kernel.
const {
  regenerateAssembly, makeCrossPartResolver,
} = require('../../../services/assemblyRegenService');
const { skeletonEdges, skeletonGeoMap, matchSkeletonFallback } = require('../../../services/assemblySkeleton');
const { pinCrossPartRefs } = require('../../../services/vcs/cadVcsService');
const db = require('../../../models');
const { createTestPart, createTestUser } = require('../../helpers');

const XY = { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] };
const SKETCH_DOC = {
  nextSketchSeq: 2,
  sketches: {
    s1: {
      id: 's1', hostId: 'datum:xy_plane', plane: XY,
      state: {
        entities: [
          { kind: 'point', id: 'pa', x: 0, y: 0 },
          { kind: 'point', id: 'pb', x: 50, y: 0 },
          { kind: 'line', id: 'l1', startId: 'pa', endId: 'pb' },
          { kind: 'point', id: 'pc', x: 5, y: 5 },
          { kind: 'point', id: 'cc', x: 20, y: 20 },
          { kind: 'circle', id: 'k1', centerId: 'cc', radius: 4 },
          // Construction geometry stays sketch-local (not referenceable).
          { kind: 'point', id: 'cp1', x: 9, y: 9, construction: true },
        ],
        constraints: [],
      },
      candidates: [],
    },
  },
};

describe('assemblySkeleton geometry evaluation (REQ 915)', () => {
  it('emits world-frame polylines with asketch: keys; skips construction', () => {
    const edges = skeletonEdges(SKETCH_DOC);
    const keys = edges.map((e) => e.key);
    expect(keys).toContain('asketch:s1/l1');
    expect(keys).toContain('asketch:s1/k1');
    expect(keys).toContain('asketch:s1/pc');
    expect(keys.some((k) => k.includes('cp1'))).toBe(false);
    const line = edges.find((e) => e.key === 'asketch:s1/l1');
    expect(line.isStraight).toBe(true);
    expect(line.polyline).toEqual([[0, 0, 0], [50, 0, 0]]);
    const circle = edges.find((e) => e.key === 'asketch:s1/k1');
    expect(circle.isStraight).toBe(false);
    expect(circle.polyline.length).toBeGreaterThan(8);
  });

  it('geo map carries edge keys + vertex keys (line ends, circle center, point self)', () => {
    const map = skeletonGeoMap(SKETCH_DOC);
    expect(map.get('asketch:s1/l1').polyline).toEqual([[0, 0, 0], [50, 0, 0]]);
    expect(map.get('asketchv:s1/l1/start').polyline).toEqual([[0, 0, 0], [0, 0, 0]]);
    expect(map.get('asketchv:s1/l1/end').polyline).toEqual([[50, 0, 0], [50, 0, 0]]);
    expect(map.get('asketchv:s1/k1/center').polyline).toEqual([[20, 20, 0], [20, 20, 0]]);
    expect(map.get('asketchv:s1/pc/self').polyline).toEqual([[5, 5, 0], [5, 5, 0]]);
  });

  it('geometric fallback matches a close edge, rejects a distant one', () => {
    const map = skeletonGeoMap(SKETCH_DOC);
    const hit = matchSkeletonFallback(map, { kind: 'edge', start: [0.1, 0, 0], end: [49.9, 0, 0] });
    expect(hit).not.toBeNull();
    expect(hit.polyline).toEqual([[0, 0, 0], [50, 0, 0]]);
    expect(matchSkeletonFallback(map, { kind: 'edge', start: [500, 0, 0], end: [600, 0, 0] })).toBeNull();
  });
});

describe('makeCrossPartResolver — skeleton branch (REQ 915/916)', () => {
  const skeletonGeo = skeletonGeoMap(SKETCH_DOC);
  const poses = { A: { translate: [10, 0, 0], quaternion: [0, 0, 0, 1] } };

  it('resolves a skeleton edge into the dependent local frame', () => {
    const r = makeCrossPartResolver({ dependentId: 'A', childGeoById: new Map(), poses, backEdges: new Set(), skeletonGeo });
    const out = r({ sourceInstanceId: '__skeleton__', sourceGeomRef: { edgeId: 'asketch:s1/l1' } });
    // Skeleton is world-frame; A sits at x=10 → edge shifts by −10 in A-local.
    expect(out.isStraight).toBe(true);
    expect(out.polyline).toEqual([[-10, 0, 0], [40, 0, 0]]);
  });

  it('resolves a skeleton vertex as a degenerate edge', () => {
    const r = makeCrossPartResolver({ dependentId: 'A', childGeoById: new Map(), poses, backEdges: new Set(), skeletonGeo });
    const out = r({ sourceInstanceId: '__skeleton__', sourceGeomRef: { vertexId: 'asketchv:s1/l1/end' } });
    expect(out.polyline).toEqual([[40, 0, 0], [40, 0, 0]]);
  });

  it('falls back geometrically when the exact key is gone, null when nothing matches', () => {
    const r = makeCrossPartResolver({ dependentId: 'A', childGeoById: new Map(), poses, backEdges: new Set(), skeletonGeo });
    const fb = r({
      sourceInstanceId: '__skeleton__',
      sourceGeomRef: { edgeId: 'asketch:s1/DELETED' },
      fallback: { kind: 'edge', start: [0, 0, 0], end: [50, 0, 0] },
    });
    expect(fb.polyline).toEqual([[-10, 0, 0], [40, 0, 0]]);
    const miss = r({
      sourceInstanceId: '__skeleton__',
      sourceGeomRef: { edgeId: 'asketch:s1/DELETED' },
      fallback: { kind: 'edge', start: [900, 0, 0], end: [950, 0, 0] },
    });
    expect(miss).toBeNull();
  });
});

describe('regenerateAssembly — skeleton payload + skeleton-only dependents (REQ 915/916)', () => {
  const asm = () => ({
    id: 7, partID: 1,
    sketchDoc: SKETCH_DOC,
    assemblyDoc: {
      instances: [
        { instanceId: 'A', partID: 10, grounded: true, placement: { translate: [10, 0, 0], quaternion: [0, 0, 0, 1] } },
      ],
      mates: [], patterns: [],
    },
  });
  const childGeo = { faces: [], vertices: [], edges: [], bodies: [{ id: 'bA', edges: [], faces: [], vertices: [] }] };

  it('returns the skeleton edges in the composed response', async () => {
    const out = await regenerateAssembly(asm(), {
      resolveChild: async () => childGeo,
      childRefs: async () => [],
    });
    expect(out.skeleton.partID).toBe(1);
    expect(out.skeleton.edges.map((e) => e.key)).toContain('asketch:s1/l1');
  });

  it('re-regens an instance whose ONLY dependency is the skeleton, with a live resolver', async () => {
    let captured = null;
    let regens = 0;
    const resolveChild = async (inst, _a, opts = {}) => {
      regens++;
      if (opts.externalRefResolver) {
        captured = opts.externalRefResolver({ sourceInstanceId: '__skeleton__', sourceGeomRef: { edgeId: 'asketch:s1/l1' } });
      }
      return childGeo;
    };
    const childRefs = async () => [
      { constraintId: 'oe1', sourceInstanceId: '__skeleton__', externalRef: { scope: 'cross-part', definingAssemblyId: 7, sourceInstanceId: '__skeleton__', sourceGeomRef: { edgeId: 'asketch:s1/l1' } } },
    ];
    const out = await regenerateAssembly(asm(), { resolveChild, childRefs });
    // Phase A resolve + Phase B.5 live re-regen — the skeleton-only dependent
    // must NOT be skipped by the empty-deps guard.
    expect(regens).toBe(2);
    expect(captured).not.toBeNull();
    expect(captured.polyline).toEqual([[-10, 0, 0], [40, 0, 0]]);
    expect(out.errors).toEqual([]);
  });
});

describe('pinCrossPartRefs skips skeleton refs (REQ 915)', () => {
  it('does not touch pinnedSourceCommit on a skeleton ref', async () => {
    const user = await createTestUser({ displayName: 'Skeleton Pin User' });
    const part = await createTestPart();
    const model = await db.DesignCADModel.create({
      partID: part.id, createdByUserID: user.id, revision: 'A',
      releaseState: 'draft', activeFlag: true,
      featureTree: { features: [] },
      sketchDoc: {
        nextSketchSeq: 2,
        sketches: { s1: { id: 's1', hostId: 'datum:xy_plane', plane: XY, state: { entities: [], constraints: [
          { id: 'oe1', type: 'on-edge', targets: [{ entityId: 'p1' }], externalRef: {
            scope: 'cross-part', definingAssemblyId: 7, definingAssemblyRepoId: '7',
            sourceInstanceId: '__skeleton__', sourcePartId: 999,
            sourceGeomRef: { featureId: '', edgeId: 'asketch:s1/l1' },
            pinnedSourceCommit: null,
          } },
        ] }, candidates: [] } },
      },
    });
    const pinned = await pinCrossPartRefs(model, db);
    expect(pinned).toEqual([]);
    const row = await db.DesignCADModel.findByPk(model.id);
    const er = row.sketchDoc.sketches.s1.state.constraints[0].externalRef;
    expect(er.pinnedSourceCommit).toBeNull();
  });
});
