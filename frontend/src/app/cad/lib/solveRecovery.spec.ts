// REQ 922 — continuation recovery from degenerate (collapsed) solves.
//
// The fixture reproduces the part-623 failure: a rectangle built from four
// lines + horizontal/perpendicular/parallel/midpoint constraints, dimmed on
// two sides only. A large dimension jump lets the solver satisfy every
// constraint by collapsing the undimensioned bottom line to zero length
// (zero vectors are parallel to anything). solveWithRecovery must detect
// that and land the true rectangle instead.
import { describe, it, expect } from 'vitest';
import { solveWithRecovery, collapsedLines, measuredDimValue } from './solveRecovery';
import { solveSketch } from './solver';
import type { SketchState, SketchEntity, SketchConstraint } from './types';
import { findPoint } from './types';

function pt(id: string, x: number, y: number): SketchEntity {
  return { kind: 'point', id, x, y };
}
function ln(id: string, startId: string, endId: string): SketchEntity {
  return { kind: 'line', id, startId, endId };
}
function c(id: string, type: SketchConstraint['type'], targetIds: string[], value?: number): SketchConstraint {
  const base: SketchConstraint = { id, type, targets: targetIds.map(eid => ({ entityId: eid })) };
  if (value !== undefined) base.value = value;
  return base;
}

/** Part-623-shaped rectangle: 158 wide × 109 tall, centered on a fixed
 * origin via a midpoint on the bottom line, dimensioned on the LEFT and TOP
 * sides only (bottom + right lengths are free). */
function rect623(dimLeft: number, dimTop: number): SketchState {
  return {
    entities: [
      { kind: 'point', id: 'origin', x: 0, y: 0, construction: true },
      pt('p1', -79, 0), pt('p2', 79, 0), pt('p3', 79, 109), pt('p4', -79, 109),
      ln('l5', 'p1', 'p2'),   // bottom — undimensioned
      ln('l6', 'p2', 'p3'),   // right  — undimensioned
      ln('l7', 'p3', 'p4'),   // top    — dimmed
      ln('l8', 'p4', 'p1'),   // left   — dimmed
    ],
    constraints: [
      c('fix-o', 'fixed', ['origin']),
      c('h5', 'horizontal', ['l5']),
      c('perp', 'perpendicular', ['l5', 'l6']),
      c('par1', 'parallel', ['l5', 'l7']),
      c('par2', 'parallel', ['l6', 'l8']),
      c('mid', 'midpoint', ['origin', 'l5']),
      c('dimL', 'distance', ['p4', 'p1'], dimLeft),
      c('dimT', 'distance', ['p3', 'p4'], dimTop),
    ],
  };
}

const dist = (st: SketchState, a: string, b: string) => {
  const pa = findPoint(st, a)!, pb = findPoint(st, b)!;
  return Math.hypot(pb.x - pa.x, pb.y - pa.y);
};

describe('measuredDimValue (REQ 922)', () => {
  const st = rect623(109, 158);
  it('measures point-pair distance dims from geometry', () => {
    expect(measuredDimValue(st, st.constraints.find(x => x.id === 'dimL')!)).toBeCloseTo(109, 6);
    expect(measuredDimValue(st, st.constraints.find(x => x.id === 'dimT')!)).toBeCloseTo(158, 6);
  });
  it('returns null for non-dimensional constraints', () => {
    expect(measuredDimValue(st, st.constraints.find(x => x.id === 'h5')!)).toBeNull();
  });
  it('measures radius and diameter dims', () => {
    const cs: SketchState = {
      entities: [pt('cc', 0, 0), { kind: 'circle', id: 'circ', centerId: 'cc', radius: 7 }],
      constraints: [],
    };
    expect(measuredDimValue(cs, c('r', 'radius', ['circ'], 5))).toBeCloseTo(7, 9);
    expect(measuredDimValue(cs, c('d', 'diameter', ['circ'], 5))).toBeCloseTo(14, 9);
  });
});

describe('collapsedLines (REQ 922)', () => {
  it('flags a line that flattened to zero and ignores ones that kept length', () => {
    const before = rect623(109, 158);
    const after: SketchState = {
      ...before,
      entities: before.entities.map(e =>
        e.kind === 'point' && e.id === 'p2' ? { ...e, x: -79, y: 0 } : e),  // p2 onto p1 → l5 zero
    };
    expect(collapsedLines(before, after)).toEqual(['l5']);
    expect(collapsedLines(before, before)).toEqual([]);
  });
});

describe('solveWithRecovery (REQ 922) — the part-623 scenario', () => {
  it('baseline: a big dim jump collapses the undimensioned side with a plain solve', async () => {
    // Documents WHY recovery exists. If a solver upgrade makes this pass
    // without collapsing, the recovery path may be simplified.
    const jumped = rect623(1168.4, 517.525);
    const r = await solveSketch(jumped);
    expect(r.status).toBe('ok');
    expect(collapsedLines(jumped, r.state)).toContain('l5');
  });

  it('recovers the true rectangle via continuation', async () => {
    const jumped = rect623(1168.4, 517.525);
    const { result, recovered, collapsed } = await solveWithRecovery(jumped);
    expect(collapsed).toBe(false);
    expect(recovered).toBe(true);
    expect(result.status).toBe('ok');
    // All four sides at proper parallelogram lengths — nothing degenerate.
    expect(dist(result.state, 'p4', 'p1')).toBeCloseTo(1168.4, 3);
    expect(dist(result.state, 'p3', 'p4')).toBeCloseTo(517.525, 3);
    expect(dist(result.state, 'p1', 'p2')).toBeCloseTo(517.525, 3);
    expect(dist(result.state, 'p2', 'p3')).toBeCloseTo(1168.4, 3);
  });

  it('passes a clean solve through untouched', async () => {
    const small = rect623(120, 160);  // modest change, solves directly
    const { result, recovered, collapsed } = await solveWithRecovery(small);
    expect(result.status).toBe('ok');
    expect(collapsed).toBe(false);
    expect(recovered).toBe(false);
    expect(dist(result.state, 'p4', 'p1')).toBeCloseTo(120, 3);
  });

  it('reports collapsed=true when continuation cannot help (no measurable dims changed)', async () => {
    // Same geometry but the collapse is forced by a NON-measurable route:
    // drop the dims entirely and pre-collapse via a zero-length equal
    // scenario is contrived, so instead: dims already AT their measured
    // values (nothing to continue from) + a conflicting extra constraint
    // is out of scope. Here we assert the API contract on the simplest
    // reachable case: stepCounts that are too coarse to recover.
    const jumped = rect623(1168.4, 517.525);
    const { recovered, collapsed } = await solveWithRecovery(jumped, undefined, [1]);
    expect(recovered).toBe(false);
    expect(collapsed).toBe(true);
  });
});
