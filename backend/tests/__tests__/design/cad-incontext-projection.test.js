// REQ 770/775 — cross-part Convert Entities. A sketch in part A carries an
// on-edge constraint whose externalRef.scope is 'cross-part'; the source edge
// (already transformed into A's frame) is supplied via opts.externalEdges keyed
// by constraint id. applyProjectionToSketchDoc must project that edge into A's
// sketch plane exactly like an intra-part converted edge. Pure — no kernel/db.
const { applyProjectionToSketchDoc } = require('../../../services/cadProjection');
const { _buildExternalEdges } = require('../../../services/cadRegenService');

const XY_PLANE = { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] };

// A sketch with a line (p1->p2) at arbitrary current coords, linked to a source
// edge by a cross-part on-edge constraint with id `oe1`.
const docWithCrossPartLine = () => ({
  sketches: {
    s1: {
      id: 's1', plane: XY_PLANE,
      state: {
        entities: [
          { kind: 'point', id: 'p1', x: 0, y: 0 },
          { kind: 'point', id: 'p2', x: 1, y: 1 },
          { kind: 'line', id: 'l1', startId: 'p1', endId: 'p2' },
        ],
        constraints: [
          {
            id: 'oe1', type: 'on-edge', targets: [{ entityId: 'l1' }],
            externalRef: {
              scope: 'cross-part', definingAssemblyId: 7, definingAssemblyRepoId: '42',
              sourceInstanceId: 'i2', sourcePartId: 99,
              sourceGeomRef: { featureId: 'f3', edgeId: 'f3/e1' },
            },
          },
        ],
      },
    },
  },
});

const ptById = (doc, id) => doc.sketches.s1.state.entities.find(e => e.id === id);

describe('cross-part Convert Entities projection (REQ 770/775)', () => {
  it('projects the supplied source edge into the sketch plane', () => {
    const doc = docWithCrossPartLine();
    // source edge lying in A's XY plane (z=0): from (2,3) to (5,3)
    const externalEdges = { oe1: { polyline: [[2, 3, 0], [5, 3, 0]], isStraight: true } };
    const out = applyProjectionToSketchDoc(doc, [], { externalEdges });
    const p1 = ptById(out, 'p1'), p2 = ptById(out, 'p2');
    // the two endpoints land on (2,3) and (5,3) in some order
    const locs = [[p1.x, p1.y], [p2.x, p2.y]].map(([x, y]) => `${x},${y}`).sort();
    expect(locs).toEqual(['2,3', '5,3']);
  });

  it('projects through the plane basis (offset/rotated source edge)', () => {
    const doc = docWithCrossPartLine();
    // a non-axis-aligned source edge; projection is dot with xAxis/yAxis
    const externalEdges = new Map([['oe1', { polyline: [[4, -1, 0], [4, 6, 0]] }]]);
    const out = applyProjectionToSketchDoc(doc, [], { externalEdges });
    const p1 = ptById(out, 'p1'), p2 = ptById(out, 'p2');
    const ys = [p1.y, p2.y].sort((a, b) => a - b);
    expect([p1.x, p2.x]).toEqual([4, 4]);     // x = dot with [1,0,0]
    expect(ys).toEqual([-1, 6]);              // y = dot with [0,1,0]
  });

  it('leaves the entity untouched when the cross-part ref is unresolved', () => {
    const doc = docWithCrossPartLine();
    const out = applyProjectionToSketchDoc(doc, [], { externalEdges: {} }); // nothing supplied
    // unresolved → points stay at their persisted coords (editor flags it broken)
    expect(out).toBe(doc); // pass-through by reference (no change)
  });

  it('does not treat a local on-edge ref as cross-part', () => {
    const doc = docWithCrossPartLine();
    doc.sketches.s1.state.constraints[0].externalRef = { scope: 'local', featureId: 'f3', edgeId: 'f3/e1' };
    // local ref with no matching body edge → no projection, pass-through
    const out = applyProjectionToSketchDoc(doc, [], { externalEdges: { oe1: { polyline: [[2, 3, 0], [5, 3, 0]] } } });
    expect(ptById(out, 'p1')).toEqual({ kind: 'point', id: 'p1', x: 0, y: 0 });
  });
});

// REQ 770/773 — _buildExternalEdges chooses the live resolver when present and
// otherwise the cached snapshot (the standalone / out-of-assembly path).
describe('_buildExternalEdges: resolver-vs-snapshot selection (REQ 770/773)', () => {
  const withRef = (extra) => ({
    sketches: { s1: { id: 's1', state: { entities: [], constraints: [{
      id: 'oe1', type: 'on-edge', targets: [{ entityId: 'l1' }],
      externalRef: { scope: 'cross-part', sourceInstanceId: 'i2', sourcePartId: 99,
        sourceGeomRef: { featureId: 'f3', edgeId: 'f3/e1' }, ...extra },
    }] } } },
  });

  it('uses the cached snapshot when no resolver is supplied (standalone)', () => {
    const doc = withRef({ cachedProjection: { edges: [{ polyline: [[1, 1, 0], [2, 2, 0]] }] } });
    const m = _buildExternalEdges(doc, undefined);
    expect(m.get('oe1')).toMatchObject({ polyline: [[1, 1, 0], [2, 2, 0]] });
  });

  it('prefers the live resolver over the snapshot', () => {
    const doc = withRef({ cachedProjection: { edges: [{ polyline: [[1, 1, 0], [2, 2, 0]] }] } });
    const resolver = () => ({ polyline: [[9, 9, 9], [8, 8, 8]], isStraight: true });
    const m = _buildExternalEdges(doc, resolver);
    expect(m.get('oe1').polyline).toEqual([[9, 9, 9], [8, 8, 8]]);
  });

  it('falls back to the snapshot when the resolver returns null', () => {
    const doc = withRef({ cachedProjection: { edges: [{ polyline: [[1, 1, 0], [2, 2, 0]] }] } });
    const m = _buildExternalEdges(doc, () => null);
    expect(m.get('oe1').polyline).toEqual([[1, 1, 0], [2, 2, 0]]);
  });

  it('omits a cross-part ref with neither resolver nor snapshot (unresolved)', () => {
    const m = _buildExternalEdges(withRef({}), undefined);
    expect(m.has('oe1')).toBe(false);
  });

  it('ignores local on-edge constraints', () => {
    const doc = { sketches: { s1: { state: { constraints: [
      { id: 'oeL', type: 'on-edge', externalRef: { scope: 'local', featureId: 'f1', edgeId: 'f1/e0' } },
    ] } } } };
    expect(_buildExternalEdges(doc, undefined).size).toBe(0);
  });
});
