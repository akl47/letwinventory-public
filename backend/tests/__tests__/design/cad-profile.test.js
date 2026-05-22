// Server-side port of `frontend/src/app/cad/lib/profile.spec.ts` — verifies
// that `backend/services/cadProfile.js` produces the same loops the frontend
// extractor produces, so a feature created client-side can be regenerated
// server-side with identical results.

const { extractClosedLoop, extractClosedLoops } = require('../../../services/cadProfile');

function build(points, lines) {
  return {
    entities: [
      ...points.map(([x, y], i) => ({ kind: 'point', id: `p${i + 1}`, x, y })),
      ...lines.map(([a, b], i) => ({ kind: 'line', id: `l${i + 1}`, startId: `p${a}`, endId: `p${b}` })),
    ],
    constraints: [],
  };
}

describe('cadProfile.extractClosedLoop (server port)', () => {
  it('extracts a closed quadrilateral as four line edges', () => {
    const state = build(
      [[0, 0], [10, 0], [10, 10], [0, 10]],
      [[1, 2], [2, 3], [3, 4], [4, 1]],
    );
    const { loop, error } = extractClosedLoop(state);
    expect(error).toBeFalsy();
    expect(loop).not.toBeNull();
    expect(loop.length).toBe(4);
    expect(loop.every(e => e.kind === 'line')).toBe(true);
  });

  it('extracts a 4-corner-filleted rectangle as an 8-edge closed loop (4 lines + 4 arcs)', () => {
    // Same shape as the frontend test: rectangle 0..10 with radius-2 fillet
    // on every corner. Without arc support the walker treats the 4 lines as
    // disjoint single-segment components and fails with the
    // "≥3 segments" error.
    const points = [
      [2, 0], [8, 0],          // p1, p2: bottom edge tangents
      [10, 2], [10, 8],        // p3, p4: right edge tangents
      [8, 10], [2, 10],        // p5, p6: top edge tangents
      [0, 8], [0, 2],          // p7, p8: left edge tangents
      [8, 2], [8, 8],          // p9, p10: BR, TR fillet centres
      [2, 8], [2, 2],          // p11, p12: TL, BL fillet centres
    ];
    const arcs = [
      // [startIdx, endIdx, centerIdx, ccw]
      [2, 3, 9, true],
      [4, 5, 10, true],
      [6, 7, 11, true],
      [8, 1, 12, true],
    ];
    const state = {
      entities: [
        ...points.map(([x, y], i) => ({ kind: 'point', id: `p${i + 1}`, x, y })),
        // line edges between adjacent tangent pairs
        { kind: 'line', id: 'l1', startId: 'p1', endId: 'p2' },
        { kind: 'line', id: 'l2', startId: 'p3', endId: 'p4' },
        { kind: 'line', id: 'l3', startId: 'p5', endId: 'p6' },
        { kind: 'line', id: 'l4', startId: 'p7', endId: 'p8' },
        ...arcs.map(([s, e, c, ccw], i) => {
          const start = points[s - 1];
          const center = points[c - 1];
          return {
            kind: 'arc', id: `arc${i + 1}`,
            startId: `p${s}`, endId: `p${e}`, centerId: `p${c}`,
            radius: Math.hypot(start[0] - center[0], start[1] - center[1]),
            ccw,
          };
        }),
      ],
      constraints: [],
    };
    const { loops, errors } = extractClosedLoops(state);
    expect(errors).toEqual([]);
    expect(loops.length).toBe(1);
    expect(loops[0].length).toBe(8);
    expect(loops[0].filter(e => e.kind === 'line').length).toBe(4);
    expect(loops[0].filter(e => e.kind === 'arc').length).toBe(4);
  });

  it('returns a single typed circle edge for the single-circle profile', () => {
    const state = {
      entities: [
        { kind: 'point', id: 'c', x: 5, y: 5 },
        { kind: 'circle', id: 'cir1', centerId: 'c', radius: 10 },
      ],
      constraints: [],
    };
    const { loop } = extractClosedLoop(state);
    expect(loop.length).toBe(1);
    expect(loop[0]).toEqual({ kind: 'circle', center: { x: 5, y: 5 }, radius: 10 });
  });

  it('rejects an open chain', () => {
    const state = build([[0, 0], [10, 0], [10, 10]], [[1, 2], [2, 3]]);
    const { loop, error } = extractClosedLoop(state);
    expect(loop).toBeNull();
    expect(error).toBeTruthy();
  });

  it('rejects sketches with multiple disjoint loops via single-loop walker', () => {
    const state = build(
      [[0, 0], [1, 0], [0, 1], [10, 0], [11, 0], [10, 1]],
      [[1, 2], [2, 3], [3, 1], [4, 5], [5, 6], [6, 4]],
    );
    const { loop, error } = extractClosedLoop(state);
    expect(loop).toBeNull();
    expect(error).toMatch(/multiple|disjoint|loop/i);
  });

  it('excludes construction lines', () => {
    const state = {
      entities: [
        { kind: 'point', id: 'p1', x: 0, y: 0 },
        { kind: 'point', id: 'p2', x: 10, y: 0 },
        { kind: 'point', id: 'p3', x: 10, y: 10 },
        { kind: 'point', id: 'p4', x: 0, y: 10 },
        { kind: 'line', id: 'l1', startId: 'p1', endId: 'p2' },
        { kind: 'line', id: 'l2', startId: 'p2', endId: 'p3' },
        { kind: 'line', id: 'l3', startId: 'p3', endId: 'p4' },
        { kind: 'line', id: 'l4', startId: 'p4', endId: 'p1' },
        { kind: 'line', id: 'lc', startId: 'p1', endId: 'p3', construction: true },
      ],
      constraints: [],
    };
    const { loop, error } = extractClosedLoop(state);
    expect(error).toBeFalsy();
    expect(loop.length).toBe(4);
  });
});

describe('cadProfile.extractClosedLoops (multi-component)', () => {
  it('returns two loops for two disjoint circles', () => {
    const state = {
      entities: [
        { kind: 'point', id: 'c1', x: 0, y: 0 },
        { kind: 'point', id: 'c2', x: 20, y: 0 },
        { kind: 'circle', id: 'cir1', centerId: 'c1', radius: 5 },
        { kind: 'circle', id: 'cir2', centerId: 'c2', radius: 3 },
      ],
      constraints: [],
    };
    const { loops, errors } = extractClosedLoops(state);
    expect(errors).toEqual([]);
    expect(loops.length).toBe(2);
    expect(loops.every(l => l[0].kind === 'circle')).toBe(true);
  });

  it('returns two loops for two disjoint triangles', () => {
    const state = build(
      [[0, 0], [1, 0], [0, 1], [10, 0], [11, 0], [10, 1]],
      [[1, 2], [2, 3], [3, 1], [4, 5], [5, 6], [6, 4]],
    );
    const { loops } = extractClosedLoops(state);
    expect(loops.length).toBe(2);
    for (const l of loops) expect(l.length).toBe(3);
  });

  it('returns a circle loop AND a triangle loop in the same sketch', () => {
    const state = {
      entities: [
        { kind: 'point', id: 'cc', x: 100, y: 100 },
        { kind: 'circle', id: 'cir', centerId: 'cc', radius: 5 },
        { kind: 'point', id: 'p1', x: 0, y: 0 },
        { kind: 'point', id: 'p2', x: 10, y: 0 },
        { kind: 'point', id: 'p3', x: 5, y: 10 },
        { kind: 'line', id: 'l1', startId: 'p1', endId: 'p2' },
        { kind: 'line', id: 'l2', startId: 'p2', endId: 'p3' },
        { kind: 'line', id: 'l3', startId: 'p3', endId: 'p1' },
      ],
      constraints: [],
    };
    const { loops } = extractClosedLoops(state);
    expect(loops.length).toBe(2);
    expect(loops.some(l => l[0].kind === 'circle')).toBe(true);
    expect(loops.some(l => l.every(e => e.kind === 'line') && l.length === 3)).toBe(true);
  });

  it('returns 0 loops when no valid closed component exists', () => {
    const state = build([[0, 0], [10, 0]], [[1, 2]]);
    const { loops } = extractClosedLoops(state);
    expect(loops.length).toBe(0);
  });
});
