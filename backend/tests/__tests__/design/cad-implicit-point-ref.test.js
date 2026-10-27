// REQ 792–794 — SolidWorks-style implicit references. A sketch point carries an
// on-edge constraint whose local externalRef names a model VERTEX (vertexId) or
// EDGE (edgeId). applyProjectionToSketchDoc must re-project the single point:
//   vertex → pin to the vertex's projected position
//   edge   → project the point onto the edge line, preserving where it sits
// Pure — no kernel/db. Mirrors cad-incontext-projection.test.js style.
const { applyProjectionToSketchDoc } = require('../../../services/cadProjection');

const XY_PLANE = { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] };
const ptById = (doc, id) => doc.sketches.s1.state.entities.find(e => e.id === id);

// One free point `p`, glued to model geometry by a local on-edge constraint.
const docWithPointRef = (externalRef, start = { x: 0, y: 0 }) => ({
  sketches: {
    s1: {
      id: 's1', plane: XY_PLANE,
      state: {
        entities: [{ kind: 'point', id: 'p', x: start.x, y: start.y }],
        constraints: [{ id: 'oe1', type: 'on-edge', targets: [{ entityId: 'p' }], externalRef }],
      },
    },
  },
});

// A body whose topology carries one vertex and one straight edge.
const bodies = [{
  topology: {
    vertices: [{ id: 'f1/v0', position: [4, 7, 0] }],
    edges: [{ id: 'f1/e0', isStraight: true, endpoints: [[0, 5, 0], [10, 5, 0]] }],
  },
}];

describe('implicit vertex reference (REQ 793)', () => {
  it('pins the point to the projected vertex position', () => {
    const doc = docWithPointRef({ scope: 'local', featureId: 'f1', vertexId: 'f1/v0' });
    const out = applyProjectionToSketchDoc(doc, bodies);
    const p = ptById(out, 'p');
    expect([p.x, p.y]).toEqual([4, 7]);
  });

  it('leaves the point untouched when the vertex is absent from topology', () => {
    const doc = docWithPointRef({ scope: 'local', featureId: 'f1', vertexId: 'f1/MISSING' });
    const out = applyProjectionToSketchDoc(doc, bodies);
    expect(out).toBe(doc); // pass-through by reference (no change)
  });
});

describe('implicit edge reference (REQ 794)', () => {
  it('projects the point onto the edge line (closest point on segment)', () => {
    // point currently at (3, 2); edge is the line y=5 from x=0..10 → closest is (3,5)
    const doc = docWithPointRef({ scope: 'local', featureId: 'f1', edgeId: 'f1/e0' }, { x: 3, y: 2 });
    const out = applyProjectionToSketchDoc(doc, bodies);
    const p = ptById(out, 'p');
    expect([p.x, p.y]).toEqual([3, 5]);
  });

  it('clamps to the nearest endpoint when the point is past the edge', () => {
    const doc = docWithPointRef({ scope: 'local', featureId: 'f1', edgeId: 'f1/e0' }, { x: 20, y: 1 });
    const out = applyProjectionToSketchDoc(doc, bodies);
    const p = ptById(out, 'p');
    expect([p.x, p.y]).toEqual([10, 5]);
  });
});

// Cross-part VERTEX Convert (in-context): the resolver supplies the source
// vertex as a degenerate edge (both endpoints equal) keyed by constraint id;
// the shared point-on-edge re-projection pins the sketch point to it.
describe('cross-part vertex re-projection (Convert on a vertex)', () => {
  it('pins a point to the resolved vertex via a degenerate cross-part edge', () => {
    const doc = {
      sketches: { s1: { id: 's1', plane: XY_PLANE, state: {
        entities: [{ kind: 'point', id: 'p', x: 0, y: 0 }],
        constraints: [{
          id: 'oe1', type: 'on-edge', targets: [{ entityId: 'p' }],
          externalRef: {
            scope: 'cross-part', definingAssemblyId: 7, definingAssemblyRepoId: '7',
            sourceInstanceId: 'i2', sourcePartId: 99,
            sourceGeomRef: { featureId: '', vertexId: 'cpv:i2:x' },
            fallback: { kind: 'vertex', position: [6, 8, 0] },
          },
        }],
      } } },
    };
    // resolver output for a vertex = degenerate edge at the projected vertex
    const externalEdges = { oe1: { polyline: [[6, 8, 0], [6, 8, 0]], isStraight: true } };
    const out = applyProjectionToSketchDoc(doc, [], { externalEdges });
    const p = out.sketches.s1.state.entities.find(e => e.id === 'p');
    expect([p.x, p.y]).toEqual([6, 8]);
  });
});

describe('resolveVertexRef', () => {
  const { resolveVertexRef } = require('../../../services/cadExternalRef');
  const bodies = [{ bodyId: 'b0', topology: { vertices: [{ id: 'f/v0', position: [1, 2, 3] }, { id: 'f/v1', position: [9, 9, 9] }] } }];
  it('matches by exact vertex id', () => {
    expect(resolveVertexRef(bodies, { vertexId: 'f/v1' }, null).position).toEqual([9, 9, 9]);
  });
  it('falls back to the closest vertex by position', () => {
    const r = resolveVertexRef(bodies, {}, { kind: 'vertex', position: [1.0001, 2, 3] });
    expect(r.position).toEqual([1, 2, 3]);
    expect(r.exact).toBe(false);
  });
});
