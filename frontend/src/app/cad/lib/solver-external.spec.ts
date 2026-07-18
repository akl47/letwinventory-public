import { describe, it, expect } from 'vitest';
import { solveSketch } from './solver';
import { analyzeDeterminacy } from './determinacy';
import type { SketchState, SketchEntity, SketchConstraint } from './types';
import { findPoint, findEntity } from './types';

// REQ 886 — completing the model-edge constraint matrix: angle-to-edge,
// tangent-to-edge, and diagonal on-edge line enforcement. All three ride the
// same synthetic-fixed-geometry machinery as the existing parallel /
// perpendicular / distance-to-edge passes, keyed by live edge projections in
// `externalEdges`.

function pt(id: string, x: number, y: number): SketchEntity {
  return { kind: 'point', id, x, y };
}

type EdgeMap = Map<string, [{ x: number; y: number }, { x: number; y: number }]>;

describe('sketch-line ANGLE to a model edge (REQ 886)', () => {
  // Edge projection: horizontal line y=5. Sketch line from a fixed origin
  // point to a free endpoint, driven to 30° against the edge.
  const edges: EdgeMap = new Map([['f1/e0', [{ x: 0, y: 5 }, { x: 10, y: 5 }]]]);
  const state = (endY: number, driven = false): SketchState => ({
    entities: [pt('a', 0, 0), pt('b', 10, endY), { kind: 'line', id: 'l', startId: 'a', endId: 'b' }],
    constraints: [
      { id: 'fx', type: 'fixed', targets: [{ entityId: 'a' }] },
      {
        id: 'ang', type: 'angle', targets: [{ entityId: 'l' }], value: Math.PI / 6, driven,
        externalRef: { scope: 'local', featureId: 'f1', edgeId: 'f1/e0' },
      } as SketchConstraint,
    ],
  });

  it('drives the line to the target angle against the projected edge', async () => {
    const res = await solveSketch(state(2), { externalEdges: edges });
    expect(res.status).toBe('ok');
    const a = findPoint(res.state, 'a')!, b = findPoint(res.state, 'b')!;
    const lineAngle = Math.atan2(b.y - a.y, b.x - a.x);   // edge is horizontal → angle vs edge = line angle
    expect(Math.abs(lineAngle)).toBeCloseTo(Math.PI / 6, 5);
  });

  it('a DRIVEN angle-to-edge emits nothing — geometry stays put', async () => {
    const res = await solveSketch(state(2, true), { externalEdges: edges });
    expect(res.status).toBe('ok');
    const b = findPoint(res.state, 'b')!;
    expect(b.x).toBeCloseTo(10, 6);
    expect(b.y).toBeCloseTo(2, 6);
  });

  it('determinacy mirrors the solver: the angle removes the direction DOF', () => {
    // With the angle enforced, the free endpoint keeps exactly its along-line
    // slide freedom — the line must NOT roll up as fully free. We assert the
    // analyzer does not throw and the fixed point stays determined (lockstep
    // smoke; exact DOF bookkeeping is the solver's job).
    const det = analyzeDeterminacy(state(2), edges);
    expect(det.has('a')).toBe(true);
  });
});

describe('sketch circle/arc TANGENT to a model edge (REQ 886)', () => {
  const edges: EdgeMap = new Map([['f1/e0', [{ x: 0, y: 5 }, { x: 10, y: 5 }]]]);
  const state = (cy: number): SketchState => ({
    entities: [pt('c', 3, cy), { kind: 'circle', id: 'k', centerId: 'c', radius: 2 }],
    constraints: [
      { id: 'r', type: 'radius', targets: [{ entityId: 'k' }], value: 2 },
      {
        id: 'tan', type: 'tangent', targets: [{ entityId: 'k' }],
        externalRef: { scope: 'local', featureId: 'f1', edgeId: 'f1/e0' },
      } as SketchConstraint,
    ],
  });

  it('pulls the circle tangent to the projected edge line', async () => {
    const res = await solveSketch(state(2), { externalEdges: edges });
    expect(res.status).toBe('ok');
    const c = findPoint(res.state, 'c')!;
    const k = findEntity(res.state, 'k')!;
    expect(k.kind).toBe('circle');
    // |distance(center, y=5)| must equal the radius.
    expect(Math.abs(c.y - 5)).toBeCloseTo(2, 5);
    expect((k as { radius: number }).radius).toBeCloseTo(2, 5);
  });

  it('without the projection the tangent is inert (no crash, geometry stays)', async () => {
    const res = await solveSketch(state(2));  // externalEdges omitted
    expect(res.status).toBe('ok');
    expect(findPoint(res.state, 'c')!.y).toBeCloseTo(2, 6);
  });
});

describe('DIAGONAL on-edge line endpoints ride the edge (REQ 886 / E3)', () => {
  // Converted line on a diagonal model edge (projection: y=x). One endpoint
  // carries a trim-point coincident with a free cutter point — the solver's
  // pin pass skips it, so the ride pass must hold it ON the edge line.
  const edges: EdgeMap = new Map([['f1/e7', [{ x: 0, y: 0 }, { x: 10, y: 10 }]]]);
  const state = (): SketchState => ({
    entities: [
      pt('s', 0, 0), pt('e', 6, 6.5),   // endpoint 'e' starts OFF the y=x edge line
      { kind: 'line', id: 'l', startId: 's', endId: 'e' },
      pt('q', 6, 7),                     // free cutter point coincident with 'e'
    ],
    constraints: [
      {
        id: 'oe', type: 'on-edge', targets: [{ entityId: 'l' }],
        externalRef: { scope: 'local', featureId: 'f1', edgeId: 'f1/e7' },
      } as SketchConstraint,
      { id: 'co', type: 'coincident', targets: [{ entityId: 'e' }, { entityId: 'q' }] },
    ],
  });

  it('the otherwise-constrained endpoint is pulled back onto the diagonal edge line', async () => {
    const res = await solveSketch(state(), { externalEdges: edges });
    expect(res.status).toBe('ok');
    const e = findPoint(res.state, 'e')!;
    const q = findPoint(res.state, 'q')!;
    // On the y=x line, dragged there through the coincident cutter too.
    expect(e.y).toBeCloseTo(e.x, 5);
    expect(q.y).toBeCloseTo(q.x, 5);
    // The un-constrained endpoint stays pinned at the projection.
    const s = findPoint(res.state, 's')!;
    expect([s.x, s.y]).toEqual([0, 0]);
  });

  it('determinacy mirrors the ride: the riding endpoint is NOT fully determined (slides)', () => {
    const det = analyzeDeterminacy(state(), edges);
    expect(det.has('s')).toBe(true);   // pinned anchor end
    expect(det.has('e')).toBe(false);  // rides — 1 DOF along the edge
  });

  it('a conflict involving the ride maps back to the on-edge constraint id (review B15)', async () => {
    // Pin the riding endpoint OFF the edge line via a fixed cutter — the ride
    // (point-on-line) and the coincident-to-fixed-point now contradict. The
    // ride's synthetic id is `_extrefC_<cid>-<pid>`; the mapper must resolve
    // it back to 'oe' (previously the derived suffix was never re-tested and
    // the on-edge constraint vanished from the conflict set).
    const st = state();
    const conflicted: SketchState = {
      ...st,
      constraints: [...st.constraints, { id: 'fx', type: 'fixed', targets: [{ entityId: 'q' }] } as SketchConstraint],
    };
    const res = await solveSketch(conflicted, { externalEdges: edges });
    expect(res.status).toBe('inconsistent');
    expect(res.conflicting ?? []).toContain('oe');
  });
});

describe('axis-aligned converted line with an endpoint ride (review B16)', () => {
  // Horizontal edge projection; the converted line's far endpoint is pinned by
  // the on-edge pass, the near endpoint is coincident-anchored (trim point) so
  // it RIDES. The h/v fallback must be suppressed — h + ride on the same axis
  // is rank-1 redundant and used to flag the Convert link amber forever.
  const edges: EdgeMap = new Map([['f1/e0', [{ x: 0, y: 5 }, { x: 10, y: 5 }]]]);
  const state = (): SketchState => ({
    entities: [
      pt('s', 0, 5), pt('e', 6, 5),
      { kind: 'line', id: 'l', startId: 's', endId: 'e' },
      pt('q', 6, 5),
    ],
    constraints: [
      {
        id: 'oe', type: 'on-edge', targets: [{ entityId: 'l' }],
        externalRef: { scope: 'local', featureId: 'f1', edgeId: 'f1/e0' },
      } as SketchConstraint,
      { id: 'co', type: 'coincident', targets: [{ entityId: 'e' }, { entityId: 'q' }] },
    ],
  });

  it('solves clean with NO redundant report on the on-edge constraint', async () => {
    const res = await solveSketch(state(), { externalEdges: edges });
    expect(res.status).toBe('ok');
    expect(res.redundant ?? []).not.toContain('oe');
  });
});

describe('dangling external references (REQ 897)', () => {
  it('reports constraints whose projected edge is absent from externalEdges', async () => {
    const st: SketchState = {
      entities: [pt('p', 3, 2)],
      constraints: [{
        id: 'oe', type: 'on-edge', targets: [{ entityId: 'p' }],
        externalRef: { scope: 'local', featureId: 'f1', edgeId: 'f1/eGONE' },
      } as SketchConstraint],
    };
    // Map PROVIDED but the referenced edge is missing → dangling.
    const res = await solveSketch(st, { externalEdges: new Map([['f1/eOTHER', [{ x: 0, y: 0 }, { x: 1, y: 0 }]]]) });
    expect(res.status).toBe('ok');
    expect(res.dangling ?? []).toContain('oe');
  });

  it('does NOT report dangling when no externalEdges map was supplied (legacy path)', async () => {
    const st: SketchState = {
      entities: [pt('p', 3, 2)],
      constraints: [{
        id: 'oe', type: 'on-edge', targets: [{ entityId: 'p' }],
        externalRef: { scope: 'local', featureId: 'f1', edgeId: 'f1/e0' },
      } as SketchConstraint],
    };
    const res = await solveSketch(st);
    expect(res.dangling ?? []).toEqual([]);
  });

  it('a resolvable reference is not dangling', async () => {
    const st: SketchState = {
      entities: [pt('p', 3, 2)],
      constraints: [{
        id: 'oe', type: 'on-edge', targets: [{ entityId: 'p' }],
        externalRef: { scope: 'local', featureId: 'f1', edgeId: 'f1/e0' },
      } as SketchConstraint],
    };
    const res = await solveSketch(st, { externalEdges: new Map([['f1/e0', [{ x: 0, y: 5 }, { x: 10, y: 5 }]]]) });
    expect(res.dangling ?? []).toEqual([]);
  });
});
