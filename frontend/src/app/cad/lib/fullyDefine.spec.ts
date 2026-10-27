import { describe, it, expect } from 'vitest';
import { fullyDefineSketch } from './fullyDefine';
import { analyzeDeterminacy } from './determinacy';
import { emptySketchState, ORIGIN_POINT_ID } from './store';
import type { SketchState, SketchConstraint, SketchEntity } from './types';

// REQ 889 — Fully Define Sketch: origin-anchored X/Y dims are added to
// underdetermined points (radius dims to underdetermined curves) until the
// sketch locks, with inconsistent additions rolled back.

function pt(id: string, x: number, y: number): SketchEntity {
  return { kind: 'point', id, x, y };
}

function withOrigin(entities: SketchEntity[], constraints: SketchConstraint[] = []): SketchState {
  const base = emptySketchState();
  return { ...base, entities: [...base.entities, ...entities], constraints };
}

describe('fullyDefineSketch (REQ 889)', () => {
  it('locks an under-constrained rectangle to zero free entities', async () => {
    const state = withOrigin([
      pt('p1', 0, 0), pt('p2', 10, 0), pt('p3', 10, 6), pt('p4', 0, 6),
      { kind: 'line', id: 'l1', startId: 'p1', endId: 'p2' },
      { kind: 'line', id: 'l2', startId: 'p2', endId: 'p3' },
      { kind: 'line', id: 'l3', startId: 'p3', endId: 'p4' },
      { kind: 'line', id: 'l4', startId: 'p4', endId: 'p1' },
    ]);
    const res = await fullyDefineSketch(state);
    expect(res.status).toBe('complete');
    expect(res.added.length).toBeGreaterThan(0);
    // Every entity now rolls up determined.
    const det = analyzeDeterminacy(res.state);
    for (const e of res.state.entities) {
      if (e.id === ORIGIN_POINT_ID) continue;
      expect(det.has(e.id)).toBe(true);
    }
    // Geometry did not move — dims pinned the as-drawn coordinates.
    const p3 = res.state.entities.find(e => e.id === 'p3');
    expect(p3 && p3.kind === 'point' ? [p3.x, p3.y] : null).toEqual([10, 6]);
  });

  it('locks a free circle (center + radius dims)', async () => {
    const state = withOrigin([
      pt('c1', 4, 3),
      { kind: 'circle', id: 'k', centerId: 'c1', radius: 2.5 },
    ]);
    const res = await fullyDefineSketch(state);
    expect(res.status).toBe('complete');
    const det = analyzeDeterminacy(res.state);
    expect(det.has('k')).toBe(true);
    const k = res.state.entities.find(e => e.id === 'k');
    expect(k && k.kind === 'circle' ? k.radius : null).toBeCloseTo(2.5, 6);
  });

  it('rolls back and blacklists when an addition cannot solve (partial result)', async () => {
    // The sketch is ALREADY inconsistent for p1 (a horizontal-distance of 5
    // while p1 sits at x=2 conflicts with nothing else — but any added dim
    // makes the pair unsatisfiable). fullyDefine must not corrupt: the failed
    // addition is rolled back, the entity blacklisted, and the result partial.
    const state = withOrigin(
      [pt('p1', 2, 0)],
      [{
        id: 'pre', type: 'horizontal-distance',
        targets: [{ entityId: ORIGIN_POINT_ID }, { entityId: 'p1' }], value: 5,
      }, {
        id: 'pre2', type: 'horizontal-distance',
        targets: [{ entityId: ORIGIN_POINT_ID }, { entityId: 'p1' }], value: 7,
      }],
    );
    const res = await fullyDefineSketch(state);
    expect(res.status).toBe('partial');
    // No surviving additions target the blacklisted point with a broken solve —
    // and the original constraints are untouched.
    expect(res.state.constraints.some(c => c.id === 'pre')).toBe(true);
    expect(res.state.constraints.some(c => c.id === 'pre2')).toBe(true);
  });
});
