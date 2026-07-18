// Fully Define Sketch (REQ 889) — iteratively add origin-anchored
// horizontal/vertical distance dimensions to underdetermined points (and
// radius dims to underdetermined curves) until the determinacy analyzer
// reports every entity locked, or no further progress is possible.
//
// The scheme mirrors SolidWorks' default Fully Define behavior: each free
// point gets an X and a Y dimension from the sketch origin at its measured
// value, so the geometry does not move — the dimensions merely pin what is
// already there. Any addition that turns the solve inconsistent is rolled
// back and its entity blacklisted, so a pathological sketch degrades to a
// partial result instead of corrupting.

import type { SketchState } from './types';
import { findPoint } from './types';
import { addConstraint, ORIGIN_POINT_ID } from './store';
import { analyzeDeterminacy, type ExternalEdgeMap } from './determinacy';
import { solveSketch } from './solver';

export interface FullyDefineResult {
  state: SketchState;
  /** Constraint ids added (post-rollback — only the survivors). */
  added: string[];
  /** 'complete' when every entity rolls up determined; 'partial' when the
   * iteration budget ran out or additions kept going inconsistent. */
  status: 'complete' | 'partial';
}

const MAX_ITERATIONS = 50;

/** Label-offset stagger so generated dimension labels don't stack. */
function placementFor(p: { x: number; y: number }, i: number): { x: number; y: number } {
  return { x: p.x + 3 + i * 1.5, y: p.y + 3 + i * 1.5 };
}

export async function fullyDefineSketch(
  state: SketchState, externalEdges: ExternalEdgeMap = new Map(),
): Promise<FullyDefineResult> {
  let s = state;
  const added: string[] = [];
  const skip = new Set<string>();
  let lastPicked: string | null = null;
  // Review-fix: remember which dims each entity's round contributed so a
  // later blacklist can UNDO them — previously a no-progress blacklist left
  // the (useless) dims of its own earlier successful round in the sketch.
  const addedByEntity = new Map<string, string[]>();
  const rollbackEntity = (entityId: string) => {
    const ids = addedByEntity.get(entityId);
    if (!ids?.length) return;
    s = { ...s, constraints: s.constraints.filter(c => !ids.includes(c.id)) };
    for (const id of ids) {
      const i = added.indexOf(id);
      if (i >= 0) added.splice(i, 1);
    }
    addedByEntity.delete(entityId);
  };

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const det = analyzeDeterminacy(s, externalEdges);

    // First underdetermined POINT (skipping the origin and blacklisted ids),
    // then underdetermined curves whose only free parameter is the radius.
    const freePoint = s.entities.find(e =>
      e.kind === 'point' && e.id !== ORIGIN_POINT_ID && !det.has(e.id) && !skip.has(e.id));
    const freeCurve = freePoint ? undefined : s.entities.find(e =>
      (e.kind === 'circle' || e.kind === 'arc') && !det.has(e.id) && !skip.has(e.id));

    if (!freePoint && !freeCurve) {
      // Nothing left we know how to dimension. Complete iff every entity
      // (excluding blacklisted ones) rolled up determined.
      const allDet = s.entities.every(e => det.has(e.id) || skip.has(e.id) || e.id === ORIGIN_POINT_ID);
      return { state: s, added, status: allDet && skip.size === 0 ? 'complete' : 'partial' };
    }

    // No-progress guard: if a successful addition round left the SAME entity
    // underdetermined (e.g. a residual whose gradient degenerates at the
    // measured value), blacklist it — and roll back its now-useless dims —
    // rather than spinning to the budget.
    const pickedId = (freePoint ?? freeCurve)!.id;
    if (pickedId === lastPicked) {
      skip.add(pickedId);
      rollbackEntity(pickedId);
      lastPicked = null;
      continue;
    }
    lastPicked = pickedId;

    let next = s;
    const newIds: string[] = [];
    if (freePoint && freePoint.kind === 'point') {
      const p = findPoint(next, freePoint.id)!;
      // Measured-value dims: geometry does not move, DOF just locks. A ZERO
      // offset uses the point-pair alignment constraint instead of a 0-valued
      // dim — SolidWorks does the same. EPS is a drawing tolerance (1e-6),
      // not machine epsilon: a point at x = 1e-7 is "on the axis" for any
      // practical purpose and should align, not carry a 1e-7-valued dim.
      const EPS = 1e-6;
      if (Math.abs(p.x) < EPS) {
        const a = addConstraint(next, 'vertical', [ORIGIN_POINT_ID, p.id]);
        next = a.state; newIds.push(a.constraint.id);
      } else {
        const h = addConstraint(next, 'horizontal-distance', [ORIGIN_POINT_ID, p.id],
          Math.abs(p.x), placementFor(p, added.length));
        next = h.state; newIds.push(h.constraint.id);
      }
      if (Math.abs(p.y) < EPS) {
        const a = addConstraint(next, 'horizontal', [ORIGIN_POINT_ID, p.id]);
        next = a.state; newIds.push(a.constraint.id);
      } else {
        const v = addConstraint(next, 'vertical-distance', [ORIGIN_POINT_ID, p.id],
          Math.abs(p.y), placementFor(p, added.length + 1));
        next = v.state; newIds.push(v.constraint.id);
      }
    } else if (freeCurve && (freeCurve.kind === 'circle' || freeCurve.kind === 'arc')) {
      // Place the radius label near the curve, not at the origin.
      const center = findPoint(next, freeCurve.centerId);
      const anchor = center ? { x: center.x + freeCurve.radius, y: center.y } : { x: 0, y: 0 };
      const r = addConstraint(next, 'radius', [freeCurve.id], freeCurve.radius,
        placementFor(anchor, added.length));
      next = r.state; newIds.push(r.constraint.id);
    }

    const res = await solveSketch(next, { externalEdges });
    if (res.status !== 'ok') {
      // Roll back this addition entirely and never revisit its entity.
      skip.add((freePoint ?? freeCurve)!.id);
      continue;
    }
    // Review-fix: a dim PlaneGCS reports REDUNDANT didn't reduce any DOF —
    // it over-annotates geometry already held by symmetric/equal/etc. that
    // the analyzer under-reported. Keep it out of the sketch and blacklist
    // the entity instead of committing amber-flagged noise.
    if (res.redundant?.some(id => newIds.includes(id))) {
      skip.add((freePoint ?? freeCurve)!.id);
      continue;
    }
    s = res.state;
    added.push(...newIds);
    addedByEntity.set(pickedId, newIds);
  }
  return { state: s, added, status: 'partial' };
}
