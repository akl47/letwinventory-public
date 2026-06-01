import { describe, it, expect } from 'vitest';
import { solveSketch } from './solver';
import type { SketchState, SketchEntity, SketchConstraint, CircleEntity, ArcEntity } from './types';
import { pointsOf, findEntity, findPoint } from './types';

function pt(id: string, x: number, y: number, construction = false): SketchEntity {
  return construction
    ? { kind: 'point', id, x, y, construction: true }
    : { kind: 'point', id, x, y };
}

function ln(id: string, startId: string, endId: string): SketchEntity {
  return { kind: 'line', id, startId, endId };
}

function circle(id: string, centerId: string, radius: number, construction = false): SketchEntity {
  return construction
    ? { kind: 'circle', id, centerId, radius, construction: true }
    : { kind: 'circle', id, centerId, radius };
}

function arc(id: string, centerId: string, startId: string, endId: string, radius: number, ccw = true): SketchEntity {
  return { kind: 'arc', id, centerId, startId, endId, radius, ccw };
}

function c(id: string, type: SketchConstraint['type'], targetIds: string[], value?: number): SketchConstraint {
  const base: SketchConstraint = {
    id, type, targets: targetIds.map(eid => ({ entityId: eid })),
  };
  if (value !== undefined) base.value = value;
  return base;
}

/**
 * Test convenience: turn the construction flag on points into explicit
 * `fixed` constraints. Production no longer pins construction (per user
 * request — SW-equivalent semantics: dashed reference but draggable).
 * These tests were written with the `pt('p', 0, 0, true)` shortcut to
 * mean "anchor this point", so we preserve that intent at the test layer.
 */
function pinned(state: SketchState): SketchState {
  const extras: SketchConstraint[] = [];
  for (const e of state.entities) {
    if (e.kind === 'point' && e.construction) {
      extras.push({ id: `_autofix_${e.id}`, type: 'fixed', targets: [{ entityId: e.id }] });
    }
  }
  if (extras.length === 0) return state;
  return { ...state, constraints: [...extras, ...state.constraints] };
}

describe('Sketch solver (CAD-012/013/014/033, REQ 558–561)', () => {
  it('honors a fixed constraint by keeping the point at its initial location', async () => {
    const state: SketchState = {
      entities: [pt('p1', 3, 4)],
      constraints: [c('c1', 'fixed', ['p1'])],
    };
    const res = await solveSketch(pinned(state));
    expect(res.status).toBe('ok');
    expect(pointsOf(res.state)[0].x).toBeCloseTo(3);
    expect(pointsOf(res.state)[0].y).toBeCloseTo(4);
  });

  it('coincident: drives two points to the same location', async () => {
    const state: SketchState = {
      entities: [pt('p1', 0, 0), pt('p2', 5, 5)],
      constraints: [c('c1', 'coincident', ['p1', 'p2'])],
    };
    const res = await solveSketch(pinned(state));
    expect(res.status).toBe('ok');
    const p1 = pointsOf(res.state).find(p => p.id === 'p1')!;
    const p2 = pointsOf(res.state).find(p => p.id === 'p2')!;
    expect(p1.x).toBeCloseTo(p2.x);
    expect(p1.y).toBeCloseTo(p2.y);
  });

  it('horizontal: aligns endpoints of a line in Y', async () => {
    const state: SketchState = {
      entities: [pt('p1', 0, 0), pt('p2', 5, 5), ln('l1', 'p1', 'p2')],
      constraints: [c('c1', 'horizontal', ['l1'])],
    };
    const res = await solveSketch(pinned(state));
    expect(res.status).toBe('ok');
    const p1 = pointsOf(res.state).find(p => p.id === 'p1')!;
    const p2 = pointsOf(res.state).find(p => p.id === 'p2')!;
    expect(p1.y).toBeCloseTo(p2.y);
  });

  it('vertical: aligns endpoints of a line in X', async () => {
    const state: SketchState = {
      entities: [pt('p1', 0, 0), pt('p2', 5, 5), ln('l1', 'p1', 'p2')],
      constraints: [c('c1', 'vertical', ['l1'])],
    };
    const res = await solveSketch(pinned(state));
    expect(res.status).toBe('ok');
    const p1 = pointsOf(res.state).find(p => p.id === 'p1')!;
    const p2 = pointsOf(res.state).find(p => p.id === 'p2')!;
    expect(p1.x).toBeCloseTo(p2.x);
  });

  it('distance: enforces target distance between two points', async () => {
    const state: SketchState = {
      entities: [pt('p1', 0, 0), pt('p2', 1, 0)],
      constraints: [
        c('c0', 'fixed', ['p1']),
        c('c1', 'distance', ['p1', 'p2'], 10),
      ],
    };
    const res = await solveSketch(pinned(state));
    expect(res.status).toBe('ok');
    const p1 = pointsOf(res.state).find(p => p.id === 'p1')!;
    const p2 = pointsOf(res.state).find(p => p.id === 'p2')!;
    const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    expect(d).toBeCloseTo(10);
  });

  it('point-on-line: drives a point onto the infinite line of a segment', async () => {
    const state: SketchState = {
      entities: [pt('p1', 0, 0), pt('p2', 10, 0), pt('p3', 5, 5), ln('l1', 'p1', 'p2')],
      constraints: [
        c('c0', 'fixed', ['p1']),
        c('c1', 'fixed', ['p2']),
        c('c2', 'coincident', ['p3', 'l1']),
      ],
    };
    const res = await solveSketch(pinned(state));
    expect(res.status).toBe('ok');
    const p3 = pointsOf(res.state).find(p => p.id === 'p3')!;
    expect(p3.y).toBeCloseTo(0);
  });

  it('reports inconsistent for conflicting distance constraints (CAD-014)', async () => {
    const state: SketchState = {
      entities: [pt('p1', 0, 0), pt('p2', 1, 0)],
      constraints: [
        c('c0', 'fixed', ['p1']),
        c('c1', 'distance', ['p1', 'p2'], 5),
        c('c2', 'distance', ['p1', 'p2'], 10),
      ],
    };
    const res = await solveSketch(pinned(state));
    expect(res.status).toBe('inconsistent');
  });

  it('construction points stay at their initial position regardless of solver pressure (REQ 560)', async () => {
    const state: SketchState = {
      entities: [pt('ref1', 3, 4, true), pt('p2', 0, 0)],
      constraints: [c('c1', 'coincident', ['ref1', 'p2'])],
    };
    const res = await solveSketch(pinned(state));
    expect(res.status).toBe('ok');
    const ref = pointsOf(res.state).find(p => p.id === 'ref1')!;
    expect(ref.x).toBeCloseTo(3);
    expect(ref.y).toBeCloseTo(4);
  });

  it('reports zero DOF for a fully-constrained rectangle', async () => {
    const state: SketchState = {
      entities: [
        pt('p1', 0, 0), pt('p2', 1, 0), pt('p3', 1, 1), pt('p4', 0, 1),
        ln('l1', 'p1', 'p2'), ln('l2', 'p2', 'p3'),
        ln('l3', 'p3', 'p4'), ln('l4', 'p4', 'p1'),
      ],
      constraints: [
        c('c0', 'fixed', ['p1']),
        c('c1', 'horizontal', ['l1']),
        c('c2', 'horizontal', ['l3']),
        c('c3', 'vertical', ['l2']),
        c('c4', 'vertical', ['l4']),
        c('c5', 'distance', ['p1', 'p2'], 10),
        c('c6', 'distance', ['p2', 'p3'], 10),
      ],
    };
    const res = await solveSketch(pinned(state));
    expect(res.status).toBe('ok');
    expect(res.dof).toBe(0);
  });
});

describe('Sketch solver: B.2 geometric constraints (REQs 582–589)', () => {
  it('perpendicular: makes two lines meet at 90° (REQ 582)', async () => {
    // l1 along +x (pinned); l2 starts at origin at 45°. Apply perpendicular → l2 along +y.
    const state: SketchState = {
      entities: [
        pt('a1', 0, 0), pt('a2', 10, 0),  // l1
        pt('b1', 0, 0), pt('b2', 5, 5),    // l2
        ln('l1', 'a1', 'a2'),
        ln('l2', 'b1', 'b2'),
      ],
      constraints: [
        c('cf1', 'fixed', ['a1']),
        c('cf2', 'fixed', ['a2']),
        c('cc', 'coincident', ['a1', 'b1']),
        c('cp', 'perpendicular', ['l1', 'l2']),
      ],
    };
    const res = await solveSketch(pinned(state));
    expect(res.status).toBe('ok');
    const b1 = pointsOf(res.state).find(p => p.id === 'b1')!;
    const b2 = pointsOf(res.state).find(p => p.id === 'b2')!;
    const dx = b2.x - b1.x, dy = b2.y - b1.y;
    // l1 direction is (1,0); l2 direction should be perpendicular ⇒ dx ≈ 0.
    expect(Math.abs(dx)).toBeLessThan(1e-6);
    expect(Math.abs(dy)).toBeGreaterThan(0);
  });

  it('parallel: drives two lines to the same direction (REQ 583)', async () => {
    const state: SketchState = {
      entities: [
        pt('a1', 0, 0), pt('a2', 10, 0),  // l1 along +x
        pt('b1', 0, 5), pt('b2', 5, 8),    // l2 at some angle
        ln('l1', 'a1', 'a2'),
        ln('l2', 'b1', 'b2'),
      ],
      constraints: [
        c('cf1', 'fixed', ['a1']),
        c('cf2', 'fixed', ['a2']),
        c('cf3', 'fixed', ['b1']),
        c('cp', 'parallel', ['l1', 'l2']),
      ],
    };
    const res = await solveSketch(pinned(state));
    expect(res.status).toBe('ok');
    const b1 = pointsOf(res.state).find(p => p.id === 'b1')!;
    const b2 = pointsOf(res.state).find(p => p.id === 'b2')!;
    // Both lines along ±x ⇒ Δy of l2 ≈ 0.
    expect(Math.abs(b2.y - b1.y)).toBeLessThan(1e-6);
  });

  it('tangent (line+circle): line is tangent to circle after solve (REQ 584)', async () => {
    // Horizontal line at y=2; construction circle at origin radius 5 (radius pinned).
    // Apply tangent ⇒ only the line can move ⇒ y → ±5.
    const state: SketchState = {
      entities: [
        pt('p1', 0, 0, true),
        circle('c1', 'p1', 5, true),  // construction → radius pinned
        pt('l1s', -10, 2), pt('l1e', 10, 2),
        ln('l1', 'l1s', 'l1e'),
        pt('lock1', -10, 0, true), pt('lock2', 10, 0, true),
        ln('lhoriz', 'lock1', 'lock2'),
      ],
      constraints: [
        c('cph', 'parallel', ['l1', 'lhoriz']),
        c('ct', 'tangent', ['l1', 'c1']),
      ],
    };
    // pinAllRadii: construction circle's radius stays at 5, so the line is the
    // only thing that can move to satisfy the tangent constraint.
    const res = await solveSketch(pinned(state), { pinAllRadii: true });
    expect(res.status).toBe('ok');
    const l1s = pointsOf(res.state).find(p => p.id === 'l1s')!;
    const l1e = pointsOf(res.state).find(p => p.id === 'l1e')!;
    // After solve: l1 is horizontal, so l1s.y == l1e.y; both should be ±5.
    expect(l1s.y).toBeCloseTo(l1e.y);
    expect(Math.abs(l1s.y)).toBeCloseTo(5);
  });

  it('tangent (circle+circle): circles are externally or internally tangent (REQ 584)', async () => {
    // Two construction (radius-pinned) circles, centers 7 apart, radii 5 and 3.
    // Apply tangent ⇒ |centers| → 8 (external) or 2 (internal).
    const state: SketchState = {
      entities: [
        pt('p1', 0, 0, true),
        circle('c1', 'p1', 5, true),
        pt('p2', 7, 0),
        circle('c2', 'p2', 3, true),
      ],
      constraints: [
        c('ct', 'tangent', ['c1', 'c2']),
      ],
    };
    // pinAllRadii: both radii stay at 5 and 3; the free center moves to
    // produce a tangent configuration.
    const res = await solveSketch(pinned(state), { pinAllRadii: true });
    expect(res.status).toBe('ok');
    const p2 = pointsOf(res.state).find(p => p.id === 'p2')!;
    const d = Math.hypot(p2.x, p2.y);
    // Either external (|centers|=8) or internal (|centers|=2) tangent.
    expect([8, 2].some(t => Math.abs(d - t) < 1e-3)).toBe(true);
  });

  it('equal (two lines): equates lengths (REQ 585)', async () => {
    const state: SketchState = {
      entities: [
        pt('a1', 0, 0, true), pt('a2', 10, 0, true), // l1 = length 10 (pinned)
        pt('b1', 0, 5, true), pt('b2', 3, 5),         // l2 = length 3, free at b2
        ln('l1', 'a1', 'a2'),
        ln('l2', 'b1', 'b2'),
      ],
      constraints: [
        c('ce', 'equal', ['l1', 'l2']),
      ],
    };
    const res = await solveSketch(pinned(state));
    expect(res.status).toBe('ok');
    const b1 = pointsOf(res.state).find(p => p.id === 'b1')!;
    const b2 = pointsOf(res.state).find(p => p.id === 'b2')!;
    expect(Math.hypot(b2.x - b1.x, b2.y - b1.y)).toBeCloseTo(10);
  });

  it('equal (two circles): equates radii (REQ 585)', async () => {
    const state: SketchState = {
      entities: [
        pt('p1', 0, 0, true),
        circle('c1', 'p1', 5),
        pt('p2', 20, 0, true),
        circle('c2', 'p2', 2),
      ],
      constraints: [
        c('ce', 'equal', ['c1', 'c2']),
      ],
    };
    const res = await solveSketch(pinned(state));
    expect(res.status).toBe('ok');
    const c1Solved = findEntity<CircleEntity>(res.state, 'c1')!;
    const c2Solved = findEntity<CircleEntity>(res.state, 'c2')!;
    expect(c1Solved.radius).toBeCloseTo(c2Solved.radius);
  });

  it('midpoint: pins a point to the midpoint of a line segment (REQ 587)', async () => {
    const state: SketchState = {
      entities: [
        pt('a', 0, 0, true), pt('b', 10, 0, true),
        ln('l1', 'a', 'b'),
        pt('m', 0, 0),
      ],
      constraints: [
        c('cm', 'midpoint', ['m', 'l1']),
      ],
    };
    const res = await solveSketch(pinned(state));
    expect(res.status).toBe('ok');
    const m = pointsOf(res.state).find(p => p.id === 'm')!;
    expect(m.x).toBeCloseTo(5);
    expect(m.y).toBeCloseTo(0);
  });

  it('symmetric: two points become mirror images about a line (REQ 586)', async () => {
    // Line along +x at y=0. Point p1 at (3, 4); p2 at (5, -1). After symmetric, p2 should be (3, -4).
    const state: SketchState = {
      entities: [
        pt('la', 0, 0, true), pt('lb', 10, 0, true),
        ln('axis', 'la', 'lb'),
        pt('p1', 3, 4, true),
        pt('p2', 5, -1),
      ],
      constraints: [
        c('cs', 'symmetric', ['p1', 'p2', 'axis']),
      ],
    };
    const res = await solveSketch(pinned(state));
    expect(res.status).toBe('ok');
    const p2 = pointsOf(res.state).find(p => p.id === 'p2')!;
    expect(p2.x).toBeCloseTo(3);
    expect(p2.y).toBeCloseTo(-4);
  });

  it('concentric: two circles share a center after solve (REQ 588)', async () => {
    const state: SketchState = {
      entities: [
        pt('p1', 0, 0, true),
        circle('c1', 'p1', 5),
        pt('p2', 8, 3),
        circle('c2', 'p2', 2),
      ],
      constraints: [
        c('cc', 'concentric', ['c1', 'c2']),
      ],
    };
    const res = await solveSketch(pinned(state));
    expect(res.status).toBe('ok');
    const p2 = pointsOf(res.state).find(p => p.id === 'p2')!;
    expect(p2.x).toBeCloseTo(0);
    expect(p2.y).toBeCloseTo(0);
  });

  it('coradial: two circles share both center AND radius after solve', async () => {
    const state: SketchState = {
      entities: [
        pt('p1', 0, 0, true),
        circle('c1', 'p1', 5),
        pt('p2', 8, 3),
        circle('c2', 'p2', 2),
      ],
      constraints: [
        c('cr', 'coradial', ['c1', 'c2']),
      ],
    };
    const res = await solveSketch(pinned(state));
    expect(res.status).toBe('ok');
    const p2 = pointsOf(res.state).find(p => p.id === 'p2')!;
    expect(p2.x).toBeCloseTo(0);
    expect(p2.y).toBeCloseTo(0);
    const c2After = findEntity(res.state, 'c2') as CircleEntity;
    expect(c2After.radius).toBeCloseTo(5);
  });

  it('collinear: two lines lie on the same infinite line after solve (REQ 589)', async () => {
    // l1 along +x at y=0 (pinned). l2 nearby but tilted. After collinear, l2 lies along +x at y=0.
    const state: SketchState = {
      entities: [
        pt('a1', 0, 0, true), pt('a2', 10, 0, true),
        ln('l1', 'a1', 'a2'),
        pt('b1', 15, 1), pt('b2', 20, 3),
        ln('l2', 'b1', 'b2'),
      ],
      constraints: [
        c('ccol', 'collinear', ['l1', 'l2']),
      ],
    };
    const res = await solveSketch(pinned(state));
    expect(res.status).toBe('ok');
    const b1 = pointsOf(res.state).find(p => p.id === 'b1')!;
    const b2 = pointsOf(res.state).find(p => p.id === 'b2')!;
    // After solve, both endpoints of l2 lie on y=0.
    expect(Math.abs(b1.y)).toBeLessThan(1e-3);
    expect(Math.abs(b2.y)).toBeLessThan(1e-3);
  });

  // ── Dimensional constraints: radius / diameter / angle ────────────────

  it('radius constraint drives a circle to the target radius', async () => {
    const state: SketchState = {
      entities: [
        pt('c1', 0, 0),
        circle('k1', 'c1', 3.7),
      ],
      constraints: [
        c('cr', 'radius', ['k1'], 12),
      ],
    };
    const res = await solveSketch(pinned(state));
    expect(res.status).toBe('ok');
    const k1 = findEntity(res.state, 'k1') as CircleEntity;
    expect(k1.radius).toBeCloseTo(12, 3);
  });

  it('diameter constraint drives a circle to the target diameter', async () => {
    const state: SketchState = {
      entities: [
        pt('c1', 0, 0),
        circle('k1', 'c1', 3.7),
      ],
      constraints: [
        c('cd', 'diameter', ['k1'], 20),
      ],
    };
    const res = await solveSketch(pinned(state));
    expect(res.status).toBe('ok');
    const k1 = findEntity(res.state, 'k1') as CircleEntity;
    expect(k1.radius).toBeCloseTo(10, 3);
  });

  it('angle constraint enforces the angle between two lines', async () => {
    // Fix the origin and one anchor of each line so the solver has a unique
    // configuration to drive toward.
    const state: SketchState = {
      entities: [
        pt('o', 0, 0, true),
        pt('a', 10, 0, true),
        ln('la', 'o', 'a'),
        pt('b', 7, 1),
        ln('lb', 'o', 'b'),
      ],
      constraints: [
        // 90° in radians.
        c('cang', 'angle', ['la', 'lb'], Math.PI / 2),
      ],
    };
    const res = await solveSketch(pinned(state));
    expect(res.status).toBe('ok');
    // After solve lb should be perpendicular to la (the +x axis).
    const b = pointsOf(res.state).find(p => p.id === 'b')!;
    expect(Math.abs(b.x)).toBeLessThan(1e-2);
  });

  // ── Curve / axis-specific constraints ─────────────────────────────────

  it('point-on-curve pulls a point onto a circle', async () => {
    const state: SketchState = {
      entities: [
        pt('cc', 0, 0, true), circle('k1', 'cc', 10, true),
        pt('p', 5, 5),  // starts off the circle
      ],
      constraints: [c('cpc', 'coincident', ['p', 'k1'])],
    };
    // pinAllRadii: circle stays at radius 10 instead of shrinking to absorb p.
    const res = await solveSketch(pinned(state), { pinAllRadii: true });
    expect(res.status).toBe('ok');
    const p = pointsOf(res.state).find(pt => pt.id === 'p')!;
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(10, 3);
  });

  it('horizontal-distance drives Δx with no constraint on Δy', async () => {
    const state: SketchState = {
      entities: [
        pt('a', 0, 0, true),
        pt('b', 3, 7),
      ],
      constraints: [c('chd', 'horizontal-distance', ['a', 'b'], 25)],
    };
    const res = await solveSketch(pinned(state));
    expect(res.status).toBe('ok');
    const b = pointsOf(res.state).find(pt => pt.id === 'b')!;
    expect(Math.abs(b.x - 25)).toBeLessThan(1e-2);
    // Δy stays free — initial y=7 should be preserved (a is pinned).
    expect(Math.abs(b.y - 7)).toBeLessThan(1e-2);
  });

  it('vertical-distance drives Δy with no constraint on Δx', async () => {
    const state: SketchState = {
      entities: [
        pt('a', 0, 0, true),
        pt('b', 5, 1),
      ],
      constraints: [c('cvd', 'vertical-distance', ['a', 'b'], 12)],
    };
    const res = await solveSketch(pinned(state));
    expect(res.status).toBe('ok');
    const b = pointsOf(res.state).find(pt => pt.id === 'b')!;
    expect(Math.abs(b.x - 5)).toBeLessThan(1e-2);
    expect(Math.abs(b.y - 12)).toBeLessThan(1e-2);
  });

  it('horizontal-distance + vertical-distance fully pin Δx and Δy (chamfer use case)', async () => {
    const state: SketchState = {
      entities: [
        pt('a', 0, 0, true),
        pt('b', 2, 3),
      ],
      constraints: [
        c('chd', 'horizontal-distance', ['a', 'b'], 10),
        c('cvd', 'vertical-distance', ['a', 'b'], 5),
      ],
    };
    const res = await solveSketch(pinned(state));
    expect(res.status).toBe('ok');
    const b = pointsOf(res.state).find(pt => pt.id === 'b')!;
    expect(Math.abs(b.x - 10)).toBeLessThan(1e-2);
    expect(Math.abs(b.y - 5)).toBeLessThan(1e-2);
  });

  it('point-line-distance drives perpendicular distance to a line', async () => {
    const state: SketchState = {
      entities: [
        pt('a', 0, 0, true), pt('b', 10, 0, true),
        ln('l', 'a', 'b'),
        pt('p', 5, 1),
      ],
      constraints: [c('cpld', 'point-line-distance', ['p', 'l'], 7)],
    };
    const res = await solveSketch(pinned(state));
    expect(res.status).toBe('ok');
    const p = pointsOf(res.state).find(pt => pt.id === 'p')!;
    // Line lies on y=0 → perpendicular distance == |p.y|.
    expect(Math.abs(Math.abs(p.y) - 7)).toBeLessThan(1e-2);
  });

  it('chord-distance drives the straight-line distance between an arc’s endpoints', async () => {
    // Center at origin, start at (5, 0), end somewhere on the radius
    // circle. The chord-distance constraint pulls the chord length to
    // exactly 6 → end must land where |start - end| = 6.
    const state: SketchState = {
      entities: [
        pt('c', 0, 0, true),
        pt('s', 5, 0, true),
        pt('e', 0, 5),
        arc('a', 'c', 's', 'e', 5, true),
      ],
      constraints: [c('cc', 'chord-distance', ['a'], 6)],
    };
    const res = await solveSketch(pinned(state));
    expect(res.status).toBe('ok');
    const startPt = pointsOf(res.state).find(pt => pt.id === 's')!;
    const endPt = pointsOf(res.state).find(pt => pt.id === 'e')!;
    const chordLen = Math.hypot(endPt.x - startPt.x, endPt.y - startPt.y);
    expect(Math.abs(chordLen - 6)).toBeLessThan(1e-2);
  });

  it('skips driven dimensions — they report measurements without pinning DOFs', async () => {
    // Two points, one driving distance (5), and a driven horizontal-
    // distance dim that would conflict if it weren't driven. The
    // solver should satisfy the driving 5 and ignore the driven
    // 999.
    const drivenC: SketchConstraint = {
      id: 'driven', type: 'horizontal-distance',
      targets: [{ entityId: 'a' }, { entityId: 'b' }],
      value: 999, driven: true,
    };
    const state: SketchState = {
      entities: [pt('a', 0, 0, true), pt('b', 5, 0)],
      constraints: [c('drive', 'distance', ['a', 'b'], 5), drivenC],
    };
    const res = await solveSketch(pinned(state));
    expect(res.status).toBe('ok');
    const b = pointsOf(res.state).find(pt => pt.id === 'b')!;
    // Distance = 5; not 999. Driven dim ignored.
    expect(Math.hypot(b.x, b.y)).toBeCloseTo(5, 2);
  });

  it('linked offset constraint set (parallel + equal len + perp construction line + perp dim) solves cleanly with dof=0', async () => {
    // Reproduces the linkSingleOffset constraint set for lines and
    // verifies the solver converges fully. Source line is fixed;
    // offset has 4 free DOFs; the 4 constraints pin all 4.
    const state: SketchState = {
      entities: [
        pt('a', 0,  0, true),  pt('b', 10, 0, true),  // source endpoints (fixed)
        ln('orig', 'a', 'b'),
        pt('oa', 0,  3),       pt('ob', 10, 3),        // offset endpoints (initial guess)
        ln('off', 'oa', 'ob'),
        ln('cl1', 'a', 'oa'),  // perpendicular construction line
      ],
      constraints: [
        c('par',   'parallel',           ['orig', 'off']),
        c('eq',    'equal',              ['orig', 'off']),
        c('perp',  'perpendicular',      ['orig', 'cl1']),
        c('pld',   'point-line-distance', ['a', 'off'], 3),
      ],
    };
    const res = await solveSketch(pinned(state));
    expect(res.status).toBe('ok');
    expect(res.dof).toBe(0);  // fully constrained
    const oa = pointsOf(res.state).find(pt => pt.id === 'oa')!;
    const ob = pointsOf(res.state).find(pt => pt.id === 'ob')!;
    expect(Math.abs(oa.x)).toBeLessThan(1e-2);
    expect(Math.abs(Math.abs(oa.y) - 3)).toBeLessThan(1e-2);
    expect(Math.abs(ob.x - 10)).toBeLessThan(1e-2);
    expect(Math.abs(Math.abs(ob.y) - 3)).toBeLessThan(1e-2);
    expect(Math.sign(oa.y)).toBe(Math.sign(ob.y));
  });

  it('linked chain offset (2-line L-shape) with the full constraint set solves to dof=0', async () => {
    // Mirrors linkOffsetsToOriginals's output for a 2-line open
    // chain. The L is horizontal+vertical, both source lines
    // fully pinned. Offset gets: per-segment parallel + dim, 2
    // perpendicular construction lines at the chain ends, and a
    // coincident at the corner (the offset L's corner endpoint
    // is shared between off1.endId and off2.startId).
    const state: SketchState = {
      entities: [
        // source L: (0,0) → V(10,0) → (10,10)
        pt('a',  0,  0,  true), pt('v',  10, 0,  true), pt('c',  10, 10, true),
        ln('o1', 'a', 'v'),
        ln('o2', 'v', 'c'),
        // offset L (outward — offset1 below x-axis y=-3, offset2 right of x=10 at x=13).
        pt('oa', 0, -3),  pt('ov1', 13, -3),
        pt('ov2', 13, -3), pt('oc', 13, 10),
        ln('of1', 'oa',  'ov1'),
        ln('of2', 'ov2', 'oc'),
        // Chain-end perpendicular construction lines.
        ln('cl-a', 'a', 'oa', false), ln('cl-c', 'c', 'oc', false),
      ],
      constraints: [
        // Per-segment direction + dim.
        c('par1', 'parallel',           ['o1', 'of1']),
        c('par2', 'parallel',           ['o2', 'of2']),
        c('dim1', 'point-line-distance', ['a', 'of1'], 3),
        c('dim2', 'point-line-distance', ['v', 'of2'], 3),
        // Chain-end perpendicular construction line perpendicular constraints.
        c('perpA', 'perpendicular', ['o1', 'cl-a']),
        c('perpC', 'perpendicular', ['o2', 'cl-c']),
        // Corner coincident between off1.endId and off2.startId.
        c('cornerC', 'coincident', ['ov1', 'ov2']),
      ],
    };
    const res = await solveSketch(pinned(state));
    expect(res.status).toBe('ok');
    expect(res.dof).toBe(0);
  });

  it('linked offset over a REAL fully-constrained source (origin + horizontal + length dim) → dof=0', async () => {
    // The previous spec used `fixed` on both source endpoints
    // (the simplest way to nail them down). Real user workflow:
    // source has a coincident-with-origin + horizontal + length
    // dim setup. Verify the linked offset still solves to dof=0.
    const state: SketchState = {
      entities: [
        pt('o', 0, 0),                              // sketch origin (auto-fixed)
        pt('a', 0, 0),     pt('b', 10, 0),         // source endpoints (initial)
        ln('orig', 'a', 'b'),
        pt('oa', 0, 3),    pt('ob', 10, 3),         // offset endpoints
        ln('off', 'oa', 'ob'),
        ln('cl1', 'a', 'oa'),                       // perp construction line
      ],
      constraints: [
        // Source pinning.
        c('fix-o',   'fixed',      ['o']),
        c('coin-ao', 'coincident', ['a', 'o']),     // a at origin
        c('horiz',   'horizontal', ['orig']),       // orig direction
        c('len',     'distance',   ['a', 'b'], 10), // orig length
        // Offset linking (the linkSingleOffset constraint set).
        c('par',    'parallel',           ['orig', 'off']),
        c('eq',     'equal',              ['orig', 'off']),
        c('perp',   'perpendicular',      ['orig', 'cl1']),
        c('pld',    'point-line-distance', ['a', 'off'], 3),
      ],
    };
    const res = await solveSketch(state);
    expect(res.status).toBe('ok');
    expect(res.dof).toBe(0);  // entire sketch fully constrained
  });
});
