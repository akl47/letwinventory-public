import { describe, it, expect } from 'vitest';
import { extractClosedLoop, extractClosedLoops, extractRegions, tessellateProfileLoop } from './profile';
import type { CircleProfileEdge } from './profile';
import type { SketchState, SketchEntity } from './types';
import { addRectangleCorners } from './store';
import { filletLines } from './sketchEditOps';
import { findEntity } from './types';
import type { LineEntity } from './types';

function build(points: Array<[number, number]>, lines: Array<[number, number]>): SketchState {
  const entities: SketchEntity[] = [
    ...points.map(([x, y], i): SketchEntity => ({ kind: 'point', id: `p${i + 1}`, x, y })),
    ...lines.map(([a, b], i): SketchEntity => ({ kind: 'line', id: `l${i + 1}`, startId: `p${a}`, endId: `p${b}` })),
  ];
  return { entities, constraints: [] };
}

// Build a sketch with a mix of lines and arcs. `lines` and `arcs` reference
// point indices (1-based). Arc tuple is [startIdx, endIdx, centerIdx, ccw].
function buildMixed(
  points: Array<[number, number]>,
  lines: Array<[number, number]>,
  arcs: Array<[number, number, number, boolean]>,
): SketchState {
  const entities: SketchEntity[] = [
    ...points.map(([x, y], i): SketchEntity => ({ kind: 'point', id: `p${i + 1}`, x, y })),
    ...lines.map(([a, b], i): SketchEntity => ({ kind: 'line', id: `l${i + 1}`, startId: `p${a}`, endId: `p${b}` })),
  ];
  arcs.forEach(([s, e, c, ccw], i) => {
    const start = points[s - 1];
    const center = points[c - 1];
    const radius = Math.hypot(start[0] - center[0], start[1] - center[1]);
    entities.push({
      kind: 'arc', id: `arc${i + 1}`,
      startId: `p${s}`, endId: `p${e}`, centerId: `p${c}`,
      radius, ccw,
    });
  });
  return { entities, constraints: [] };
}

describe('Profile extraction (CAD-038, REQ 560, REQ 617)', () => {
  it('extracts a closed loop from a real rectangle with filletLines applied to every corner', () => {
    // Reproduces the user's scenario: addRectangleCorners + 4 calls to
    // filletLines (default options — no construction lines, mirroring the
    // fillet sidebar default `filletKeepConstruction = false`). Discovers
    // corner ids dynamically because addPoint assigns random suffixes.
    let { state, ids: _lineIds } = addRectangleCorners({ entities: [], constraints: [] }, 0, 0, 20, 20);
    void _lineIds;
    // Snapshot the rectangle's 4 corners up-front: each is a point that's
    // an endpoint of exactly 2 lines in the initial state. After filleting
    // a corner that point is orphan, so we need the snapshot to drive the
    // 4-iteration loop (we can't re-discover it later).
    const corners: string[] = [];
    for (const e of state.entities) {
      if (e.kind !== 'point') continue;
      const incCount = state.entities.filter(
        x => x.kind === 'line' && !x.construction && (x.startId === e.id || x.endId === e.id),
      ).length;
      if (incCount === 2) corners.push(e.id);
    }
    expect(corners.length).toBe(4);
    for (const corner of corners) {
      const inc: LineEntity[] = [];
      for (const e of state.entities) {
        if (e.kind !== 'line' || e.construction) continue;
        if (e.startId === corner || e.endId === corner) inc.push(e);
      }
      expect(inc.length).toBe(2);
      const r = filletLines(state, inc[0].id, inc[1].id, 2);
      expect(r.error).toBeUndefined();
      state = r.state;
    }
    const lineCount = state.entities.filter(e => e.kind === 'line' && !e.construction).length;
    const arcCount  = state.entities.filter(e => e.kind === 'arc'  && !e.construction).length;
    expect(lineCount).toBe(4);
    expect(arcCount).toBe(4);
    const { loops, errors } = extractClosedLoops(state);
    expect(errors).toEqual([]);
    expect(loops.length).toBe(1);
    expect(loops[0].length).toBe(8);
  });

  it('extracts a 4-corner-filleted rectangle as a 4-line + 4-arc closed loop', () => {
    // Rectangle from (0, 0) to (10, 10) with fillet radius 2 on every corner.
    // 4 truncated lines + 4 quarter-arcs alternating around the perimeter:
    //
    //   p4 --L4-- p3       points at the tangent positions (2 per corner):
    //   /         \         p1 = (2,  0),  p2 = (8,  0)   bottom edge
    //  arc4      arc2       p3 = (10, 2),  p4 = (10, 8)   right edge
    //   \         /         p5 = (8,  10), p6 = (2,  10)  top edge
    //   p5 --L3-- p6        p7 = (0,  8),  p8 = (0,  2)   left edge
    //                       c1..c4 = arc centres at the four (interior) corners
    //   …rotated so reading bottom-left clockwise: p1 p2 (BR corner) p3 p4
    //                                              (TR) p5 p6 (TL) p7 p8 (BL) ↻
    const points: Array<[number, number]> = [
      [2,  0],  // p1 — bottom edge, near BR
      [8,  0],  // p2 — bottom edge, near BR
      [10, 2],  // p3 — right edge, near BR
      [10, 8],  // p4 — right edge, near TR
      [8,  10], // p5 — top edge, near TR
      [2,  10], // p6 — top edge, near TL
      [0,  8],  // p7 — left edge, near TL
      [0,  2],  // p8 — left edge, near BL
      [8,  2],  // p9  — BR fillet centre
      [8,  8],  // p10 — TR fillet centre
      [2,  8],  // p11 — TL fillet centre
      [2,  2],  // p12 — BL fillet centre
    ];
    const state = buildMixed(
      points,
      [[1, 2], [3, 4], [5, 6], [7, 8]],            // straight legs of each edge
      [[2, 3, 9, true], [4, 5, 10, true],          // BR, TR fillets (CCW from outside)
       [6, 7, 11, true], [8, 1, 12, true]],        // TL, BL fillets
    );
    const { loop, error } = extractClosedLoop(state);
    expect(error).toBeFalsy();
    expect(loop).not.toBeNull();
    expect(loop!.length).toBe(8);
    expect(loop!.filter(e => e.kind === 'line').length).toBe(4);
    expect(loop!.filter(e => e.kind === 'arc').length).toBe(4);
    // Loop walks head-to-tail through both line and arc edges.
    for (let i = 0; i < loop!.length; i++) {
      const cur = loop![i];
      const next = loop![(i + 1) % loop!.length];
      const curEnd   = 'end'   in cur  ? cur.end   : null;
      const nextStart = 'start' in next ? next.start : null;
      if (curEnd && nextStart) {
        expect(curEnd.x).toBeCloseTo(nextStart.x);
        expect(curEnd.y).toBeCloseTo(nextStart.y);
      }
    }
  });

  it('extracts a closed quadrilateral as four line edges (REQ 617)', () => {
    const state = build(
      [[0, 0], [10, 0], [10, 10], [0, 10]],
      [[1, 2], [2, 3], [3, 4], [4, 1]],
    );
    const { loop, error } = extractClosedLoop(state);
    expect(error).toBeFalsy();
    expect(loop).not.toBeNull();
    expect(loop!.length).toBe(4);
    expect(loop!.every(e => e.kind === 'line')).toBe(true);
    // Walked endpoints should chain head-to-tail.
    for (let i = 0; i < loop!.length; i++) {
      const cur = loop![i];
      const next = loop![(i + 1) % loop!.length];
      if (cur.kind === 'line' && next.kind === 'line') {
        expect(cur.end).toEqual(next.start);
      }
    }
  });

  it('rejects an open chain', () => {
    const state = build(
      [[0, 0], [10, 0], [10, 10]],
      [[1, 2], [2, 3]],
    );
    const { loop, error } = extractClosedLoop(state);
    expect(loop).toBeNull();
    expect(error).toBeTruthy();
  });

  it('rejects sketches with no lines', () => {
    const state = build([[0, 0]], []);
    const { loop, error } = extractClosedLoop(state);
    expect(loop).toBeNull();
    expect(error).toMatch(/no lines|empty/i);
  });

  it('rejects sketches with multiple disjoint loops', () => {
    const state = build(
      [[0, 0], [1, 0], [0, 1], [10, 0], [11, 0], [10, 1]],
      [[1, 2], [2, 3], [3, 1], [4, 5], [5, 6], [6, 4]],
    );
    const { loop, error } = extractClosedLoop(state);
    expect(loop).toBeNull();
    expect(error).toMatch(/multiple|disjoint|loop/i);
  });

  it('rejects sketches with fewer than 3 lines', () => {
    const state = build([[0, 0], [5, 0]], [[1, 2]]);
    const { loop, error } = extractClosedLoop(state);
    expect(loop).toBeNull();
    expect(error).toBeTruthy();
  });

  it('excludes construction lines from profile extraction (REQ 560)', () => {
    // Quadrilateral with an extra construction line crossing it diagonally.
    const state: SketchState = {
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
    expect(loop!.length).toBe(4);
  });

  describe('single-circle profile (REQ 612, REQ 617)', () => {
    it('returns a single typed circle edge (not a tessellated polyline)', () => {
      const state: SketchState = {
        entities: [
          { kind: 'point', id: 'c', x: 5, y: 5 },
          { kind: 'circle', id: 'cir1', centerId: 'c', radius: 10 },
        ],
        constraints: [],
      };
      const { loop, error } = extractClosedLoop(state);
      expect(error).toBeFalsy();
      expect(loop).not.toBeNull();
      expect(loop!.length).toBe(1);
      expect(loop![0].kind).toBe('circle');
      const edge = loop![0] as CircleProfileEdge;
      expect(edge.center).toEqual({ x: 5, y: 5 });
      expect(edge.radius).toBe(10);
    });

    it('tessellateProfileLoop on a single-circle profile yields vertices on the circle', () => {
      const state: SketchState = {
        entities: [
          { kind: 'point', id: 'c', x: 5, y: 5 },
          { kind: 'circle', id: 'cir1', centerId: 'c', radius: 10 },
        ],
        constraints: [],
      };
      const { loop } = extractClosedLoop(state);
      const pts = tessellateProfileLoop(loop!);
      expect(pts.length).toBeGreaterThanOrEqual(8);
      for (const p of pts) {
        const r = Math.hypot(p.x - 5, p.y - 5);
        expect(Math.abs(r - 10)).toBeLessThan(0.1);
      }
    });

    it('excludes a construction circle (no profile)', () => {
      const state: SketchState = {
        entities: [
          { kind: 'point', id: 'c', x: 0, y: 0 },
          { kind: 'circle', id: 'cir1', centerId: 'c', radius: 5, construction: true },
        ],
        constraints: [],
      };
      const { loop, error } = extractClosedLoop(state);
      expect(loop).toBeNull();
      expect(error).toBeTruthy();
    });

    it('rejects multiple circles (out of single-circle-profile scope)', () => {
      const state: SketchState = {
        entities: [
          { kind: 'point', id: 'c1', x: 0, y: 0 },
          { kind: 'point', id: 'c2', x: 20, y: 0 },
          { kind: 'circle', id: 'cir1', centerId: 'c1', radius: 5 },
          { kind: 'circle', id: 'cir2', centerId: 'c2', radius: 3 },
        ],
        constraints: [],
      };
      const { loop, error } = extractClosedLoop(state);
      expect(loop).toBeNull();
      expect(error).toBeTruthy();
    });
  });

  describe('two-segment closed loops with a curved edge', () => {
    it('accepts a semicircle arc + diameter line (D-shape)', () => {
      // Arc over the top from (10,0) to (-10,0), closed by the diameter line.
      const state: SketchState = {
        entities: [
          { kind: 'point', id: 'c', x: 0, y: 0 },
          { kind: 'point', id: 'a', x: 10, y: 0 },
          { kind: 'point', id: 'b', x: -10, y: 0 },
          { kind: 'arc', id: 'arc1', centerId: 'c', startId: 'a', endId: 'b', radius: 10, ccw: true },
          { kind: 'line', id: 'l1', startId: 'b', endId: 'a' },
        ],
        constraints: [],
      };
      const { loop, error } = extractClosedLoop(state);
      expect(error).toBeFalsy();
      expect(loop).not.toBeNull();
      expect(loop!.length).toBe(2);
      expect(loop!.map((e) => e.kind).sort()).toEqual(['arc', 'line']);
    });

    it('rejects two straight lines between the same points (zero area)', () => {
      const state: SketchState = {
        entities: [
          { kind: 'point', id: 'p1', x: 0, y: 0 },
          { kind: 'point', id: 'p2', x: 10, y: 0 },
          { kind: 'line', id: 'l1', startId: 'p1', endId: 'p2' },
          { kind: 'line', id: 'l2', startId: 'p2', endId: 'p1' },
        ],
        constraints: [],
      };
      const { loop, error } = extractClosedLoop(state);
      expect(loop).toBeNull();
      expect(error).toBeTruthy();
    });
  });

  describe('extractClosedLoops — multiple disjoint loops (REQ 620)', () => {
    it('returns two loops for two disjoint circles', () => {
      const state: SketchState = {
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
      expect(loops[0][0].kind).toBe('circle');
      expect(loops[1][0].kind).toBe('circle');
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
      const state: SketchState = {
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

  describe('extractRegions — nested loops produce annular regions', () => {
    it('concentric circles → 2 regions: inner disk (no holes), donut (outer has one hole)', () => {
      const state: SketchState = {
        entities: [
          { kind: 'point', id: 'c', x: 0, y: 0 },
          { kind: 'circle', id: 'outer', centerId: 'c', radius: 10 },
          { kind: 'circle', id: 'inner', centerId: 'c', radius: 4 },
        ],
        constraints: [],
      };
      const { regions, errors } = extractRegions(state);
      expect(errors).toEqual([]);
      expect(regions.length).toBe(2);
      const innerRegion = regions.find(r =>
        r.outer.length === 1 && r.outer[0].kind === 'circle' && r.outer[0].radius === 4,
      )!;
      const outerRegion = regions.find(r =>
        r.outer.length === 1 && r.outer[0].kind === 'circle' && r.outer[0].radius === 10,
      )!;
      expect(innerRegion).toBeDefined();
      expect(outerRegion).toBeDefined();
      expect(innerRegion.holes.length).toBe(0);
      expect(outerRegion.holes.length).toBe(1);
      const hole = outerRegion.holes[0];
      expect(hole[0].kind).toBe('circle');
      expect((hole[0] as any).radius).toBe(4);
    });

    it('two disjoint circles → 2 hole-less regions', () => {
      const state: SketchState = {
        entities: [
          { kind: 'point', id: 'c1', x: 0, y: 0 },
          { kind: 'point', id: 'c2', x: 50, y: 0 },
          { kind: 'circle', id: 'cir1', centerId: 'c1', radius: 5 },
          { kind: 'circle', id: 'cir2', centerId: 'c2', radius: 5 },
        ],
        constraints: [],
      };
      const { regions } = extractRegions(state);
      expect(regions.length).toBe(2);
      for (const r of regions) expect(r.holes.length).toBe(0);
    });

    it('three nested circles A⊃B⊃C → 3 regions, holes only one level deep', () => {
      const state: SketchState = {
        entities: [
          { kind: 'point', id: 'c', x: 0, y: 0 },
          { kind: 'circle', id: 'a', centerId: 'c', radius: 30 },
          { kind: 'circle', id: 'b', centerId: 'c', radius: 20 },
          { kind: 'circle', id: 'c2', centerId: 'c', radius: 10 },
        ],
        constraints: [],
      };
      const { regions } = extractRegions(state);
      expect(regions.length).toBe(3);
      // Direct-child constraint: A's hole is B (not C); B's hole is C; C has no holes.
      const byRadius = (r: number) => regions.find(reg =>
        reg.outer[0].kind === 'circle' && (reg.outer[0] as any).radius === r,
      )!;
      const a = byRadius(30);
      const b = byRadius(20);
      const c = byRadius(10);
      expect(c.holes.length).toBe(0);
      expect(b.holes.length).toBe(1);
      expect((b.holes[0][0] as any).radius).toBe(10);
      expect(a.holes.length).toBe(1);
      expect((a.holes[0][0] as any).radius).toBe(20);
    });

    it('single loop → 1 region with no holes', () => {
      const state: SketchState = {
        entities: [
          { kind: 'point', id: 'c', x: 0, y: 0 },
          { kind: 'circle', id: 'only', centerId: 'c', radius: 5 },
        ],
        constraints: [],
      };
      const { regions } = extractRegions(state);
      expect(regions.length).toBe(1);
      expect(regions[0].holes.length).toBe(0);
    });
  });

  describe('Convert Entities — on-edge constraint links to body edge', () => {
    // SolidWorks treats a converted entity as a first-class line/arc/
    // circle with an `on-edge` constraint pointing at the source body
    // edge. The entity itself is plain; the constraint is the link.
    // Profile extraction is agnostic to the link — it just walks the
    // geometry. These tests lock that contract.
    it('3 sketched lines + 1 converted line forms a closed rectangle', () => {
      const state: SketchState = {
        entities: [
          { kind: 'point', id: 'p1', x: 0,  y: 0 },
          { kind: 'point', id: 'p2', x: 10, y: 0 },
          { kind: 'point', id: 'p3', x: 10, y: 10 },
          { kind: 'point', id: 'p4', x: 0,  y: 10 },
          { kind: 'line',  id: 'l1', startId: 'p1', endId: 'p2' },
          { kind: 'line',  id: 'l2', startId: 'p2', endId: 'p3' },
          { kind: 'line',  id: 'l3', startId: 'p3', endId: 'p4' },
          // The "converted" closing edge — same shape as l1/l2/l3, but
          // the on-edge constraint below pins it to a body edge.
          { kind: 'line',  id: 'l4', startId: 'p4', endId: 'p1' },
        ],
        constraints: [
          { id: 'oe1', type: 'on-edge', targets: [{ entityId: 'l4' }],
            externalRef: { featureId: 'f1', edgeId: 'f1/e0' } },
        ],
      };
      const { loops } = extractClosedLoops(state);
      expect(loops.length).toBe(1);
      expect(loops[0].length).toBe(4);
    });

    it('converted arc closes a rectangle-with-arc-side profile', () => {
      // Three straight sides + one converted semicircular arc on the right:
      //   (0,0) → (5,0) → arc → (5,10) → (0,10) → (0,0)
      // The arc is the projection of a fillet on the body; the rest is
      // sketched. Must form one closed loop regardless of which side is
      // projected.
      const state: SketchState = {
        entities: [
          { kind: 'point', id: 'p1', x: 0, y: 0 },
          { kind: 'point', id: 'p2', x: 5, y: 0 },
          { kind: 'point', id: 'p3', x: 5, y: 10 },
          { kind: 'point', id: 'p4', x: 0, y: 10 },
          { kind: 'point', id: 'pc', x: 5, y: 5 },  // arc centre
          { kind: 'line',  id: 'l1', startId: 'p1', endId: 'p2' },
          // ccw: true bulges the arc RIGHT (x > 5), away from the rectangle —
          // as the diagram above intends. ccw: false would sweep it LEFT
          // through (0, 5), crossing the left edge l3 and degenerating the
          // profile into a self-intersecting 3-edge region.
          { kind: 'arc',   id: 'a1', startId: 'p2', endId: 'p3', centerId: 'pc',
            radius: 5, ccw: true },
          { kind: 'line',  id: 'l2', startId: 'p3', endId: 'p4' },
          { kind: 'line',  id: 'l3', startId: 'p4', endId: 'p1' },
        ],
        constraints: [
          { id: 'oe1', type: 'on-edge', targets: [{ entityId: 'a1' }],
            externalRef: { featureId: 'f1', edgeId: 'f1/e0' } },
        ],
      };
      const { loops } = extractClosedLoops(state);
      expect(loops.length).toBe(1);
      expect(loops[0].length).toBe(4);
    });

    it('an all-converted closed loop (4 projected lines) extracts as one region', () => {
      // Every side is locked to a body edge via on-edge. Profile
      // extraction must not require any sketched (non-projected)
      // entities at all.
      const state: SketchState = {
        entities: [
          { kind: 'point', id: 'p1', x: 0,  y: 0 },
          { kind: 'point', id: 'p2', x: 10, y: 0 },
          { kind: 'point', id: 'p3', x: 10, y: 10 },
          { kind: 'point', id: 'p4', x: 0,  y: 10 },
          { kind: 'line',  id: 'l1', startId: 'p1', endId: 'p2' },
          { kind: 'line',  id: 'l2', startId: 'p2', endId: 'p3' },
          { kind: 'line',  id: 'l3', startId: 'p3', endId: 'p4' },
          { kind: 'line',  id: 'l4', startId: 'p4', endId: 'p1' },
        ],
        constraints: [
          { id: 'oe1', type: 'on-edge', targets: [{ entityId: 'l1' }], externalRef: { featureId: 'f1', edgeId: 'f1/e0' } },
          { id: 'oe2', type: 'on-edge', targets: [{ entityId: 'l2' }], externalRef: { featureId: 'f1', edgeId: 'f1/e1' } },
          { id: 'oe3', type: 'on-edge', targets: [{ entityId: 'l3' }], externalRef: { featureId: 'f1', edgeId: 'f1/e2' } },
          { id: 'oe4', type: 'on-edge', targets: [{ entityId: 'l4' }], externalRef: { featureId: 'f1', edgeId: 'f1/e3' } },
        ],
      };
      const { regions } = extractRegions(state);
      expect(regions.length).toBe(1);
      expect(regions[0].outer.length).toBe(4);
      expect(regions[0].holes.length).toBe(0);
    });
  });
});
