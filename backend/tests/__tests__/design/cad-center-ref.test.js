// REQ 830–832 — arc/circle CENTER external reference. A sketch point carries an
// on-edge constraint whose local externalRef names a circular model edge with
// `sub: 'center'`. applyProjectionToSketchDoc must pin that point to the edge's
// projected center each regen (concentric for a circle/arc placed by its
// center, coincident-to-center for a standalone point), and leave it alone when
// the edge is absent or isn't circular. Pure — no kernel/db.
const { applyProjectionToSketchDoc } = require('../../../services/cadProjection');

const XY_PLANE = { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] };
const ptById = (doc, id) => doc.sketches.s1.state.entities.find(e => e.id === id);

// Closed circular polyline (first === last) sampled finely enough for the fit.
function circlePolyline(cx, cy, r, n = 24) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a), 0]);
  }
  return pts;
}
// Open arc polyline (first !== last).
function arcPolyline(cx, cy, r, a0, a1, n = 16) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n);
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a), 0]);
  }
  return pts;
}

const docWithCenterRef = (start = { x: 0, y: 0 }) => ({
  sketches: {
    s1: {
      id: 's1', plane: XY_PLANE,
      state: {
        entities: [{ kind: 'point', id: 'p', x: start.x, y: start.y }],
        constraints: [{
          id: 'cc1', type: 'concentric', targets: [{ entityId: 'p' }],
          externalRef: { scope: 'local', featureId: 'f1', edgeId: 'f1/e0', sub: 'center' },
        }],
      },
    },
  },
});

const bodyWithCircle = (cx, cy, r) => [{
  topology: {
    vertices: [],
    edges: [{ id: 'f1/e0', isStraight: false, endpoints: [[cx + r, cy, 0], [cx + r, cy, 0]], polyline: circlePolyline(cx, cy, r) }],
  },
}];

describe('center reference re-projection (REQ 832)', () => {
  it('pins the point to a full circle\'s projected center', () => {
    const doc = docWithCenterRef({ x: 0, y: 0 });
    const out = applyProjectionToSketchDoc(doc, bodyWithCircle(5, 7, 3));
    const p = ptById(out, 'p');
    expect(p.x).toBeCloseTo(5, 6);
    expect(p.y).toBeCloseTo(7, 6);
  });

  it('pins the point to an arc\'s projected center', () => {
    const doc = docWithCenterRef({ x: 0, y: 0 });
    const bodies = [{
      topology: {
        vertices: [],
        edges: [{ id: 'f1/e0', isStraight: false, endpoints: [[8, 2, 0], [2, 8, 0]], polyline: arcPolyline(2, 2, 6, 0, Math.PI / 2) }],
      },
    }];
    const out = applyProjectionToSketchDoc(doc, bodies);
    const p = ptById(out, 'p');
    expect(p.x).toBeCloseTo(2, 4);
    expect(p.y).toBeCloseTo(2, 4);
  });

  it('tracks the model: re-projecting after the circle moves moves the point', () => {
    const doc = docWithCenterRef({ x: 5, y: 7 });
    const out = applyProjectionToSketchDoc(doc, bodyWithCircle(12, -3, 4));
    const p = ptById(out, 'p');
    expect(p.x).toBeCloseTo(12, 6);
    expect(p.y).toBeCloseTo(-3, 6);
  });

  it('leaves the point untouched when the referenced edge is absent', () => {
    const doc = docWithCenterRef({ x: 1, y: 1 });
    const out = applyProjectionToSketchDoc(doc, [{ topology: { vertices: [], edges: [] } }]);
    expect(out).toBe(doc); // pass-through (no change)
  });

  it('does NOT pin to a STRAIGHT edge (no circular center to derive)', () => {
    const doc = docWithCenterRef({ x: 1, y: 1 });
    const bodies = [{ topology: { vertices: [], edges: [{ id: 'f1/e0', isStraight: true, endpoints: [[0, 0, 0], [10, 0, 0]] }] } }];
    const out = applyProjectionToSketchDoc(doc, bodies);
    expect(out).toBe(doc); // no polyline / not circular → skipped
  });

  it('re-projects a coincident-to-center point (the center ref is not treated as a user pin)', () => {
    // A standalone point gets a `coincident` center ref. isPointPinned must NOT
    // treat that coincident as a user pin that blocks re-projection (REQ 831).
    const doc = {
      sketches: {
        s1: {
          id: 's1', plane: XY_PLANE,
          state: {
            entities: [{ kind: 'point', id: 'p', x: 0, y: 0 }],
            constraints: [{
              id: 'co1', type: 'coincident', targets: [{ entityId: 'p' }],
              externalRef: { scope: 'local', featureId: 'f1', edgeId: 'f1/e0', sub: 'center' },
            }],
          },
        },
      },
    };
    const out = applyProjectionToSketchDoc(doc, bodyWithCircle(5, 7, 3));
    const p = ptById(out, 'p');
    expect(p.x).toBeCloseTo(5, 6);
    expect(p.y).toBeCloseTo(7, 6);
  });
});
