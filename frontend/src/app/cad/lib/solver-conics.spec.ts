import { describe, it, expect } from 'vitest';
import { solveSketch } from './solver';
import { analyzeDeterminacy } from './determinacy';
import type { SketchState, SketchEntity, SketchConstraint } from './types';
import { findPoint, findEntity } from './types';

// REQ 882 — ellipses and parabolas registered as PlaneGCS solver geometry.
// Before this, point_on_ellipse / tangent_le referenced an ellipse id that
// was never pushed, so applying either constraint THREW and broke the whole
// solve. These tests exercise the previously-broken paths end-to-end.

function pt(id: string, x: number, y: number): SketchEntity {
  return { kind: 'point', id, x, y };
}

function fixed(id: string, target: string): SketchConstraint {
  return { id, type: 'fixed', targets: [{ entityId: target }] };
}

/** Ellipse: center (0,0), major radius 5 along +x, minor radius 3. */
function ellipseState(extra: SketchEntity[], constraints: SketchConstraint[]): SketchState {
  return {
    entities: [
      pt('c', 0, 0), pt('m', 5, 0),
      { kind: 'ellipse', id: 'el', centerId: 'c', majorAxisEndId: 'm', minorRadius: 3 },
      ...extra,
    ],
    constraints: [fixed('fc', 'c'), fixed('fm', 'm'), ...constraints],
  };
}

describe('ellipse as solver geometry (REQ 882)', () => {
  it('a bare ellipse solves without throwing (registration smoke)', async () => {
    const res = await solveSketch(ellipseState([], []));
    expect(res.status).toBe('ok');
  });

  it('point-on-ellipse (coincident) pulls a free point onto the ellipse', async () => {
    const res = await solveSketch(ellipseState(
      [pt('p', 4, 2)],
      [{ id: 'co', type: 'coincident', targets: [{ entityId: 'p' }, { entityId: 'el' }] }],
    ));
    expect(res.status).toBe('ok');
    const p = findPoint(res.state, 'p')!;
    // On the ellipse ⇔ sum of focal distances = 2a. The minor radius is a
    // legitimate free parameter (nothing pins it here), so derive the foci
    // from the SOLVED radmin: f = √(a² − b'²), a = 5 (center + major vertex
    // are fixed and the internal alignment holds the vertex on the conic).
    const el = findEntity(res.state, 'el')!;
    const bSolved = el.kind === 'ellipse' ? el.minorRadius : NaN;
    const f = Math.sqrt(25 - bSolved * bSolved);
    const d = Math.hypot(p.x - f, p.y) + Math.hypot(p.x + f, p.y);
    expect(d).toBeCloseTo(10, 3);
  });

  it('tangent line-ellipse (tangent_le) pulls a horizontal line to |y| = b', async () => {
    const res = await solveSketch(ellipseState(
      [pt('a', -4, 2), pt('b', 4, 2), { kind: 'line', id: 'l', startId: 'a', endId: 'b' }],
      [
        { id: 'h', type: 'horizontal', targets: [{ entityId: 'l' }] },
        { id: 'tan', type: 'tangent', targets: [{ entityId: 'l' }, { entityId: 'el' }] },
      ],
    ));
    expect(res.status).toBe('ok');
    const a = findPoint(res.state, 'a')!;
    const el = findEntity(res.state, 'el')!;
    const b = el.kind === 'ellipse' ? el.minorRadius : NaN;
    // A horizontal tangent to a centered axis-aligned ellipse sits at ±b.
    expect(Math.abs(a.y)).toBeCloseTo(b, 4);
  });

  it('reads the solved minor radius back onto the entity', async () => {
    // Pin a point on the ellipse at (0, 4): with center and major vertex
    // fixed, the only way to satisfy point-on-ellipse is minorRadius → 4.
    const res = await solveSketch(ellipseState(
      [pt('p', 0, 4)],
      [
        fixed('fp', 'p'),
        { id: 'co', type: 'coincident', targets: [{ entityId: 'p' }, { entityId: 'el' }] },
      ],
    ));
    expect(res.status).toBe('ok');
    const el = findEntity(res.state, 'el')!;
    expect(el.kind === 'ellipse' ? el.minorRadius : NaN).toBeCloseTo(4, 4);
  });

  it('determinacy: a fully-pinned ellipse rolls up determined', () => {
    // Fixed center + fixed major vertex + a fixed point on the curve pin the
    // minor radius through the point-on-ellipse residual.
    const state = ellipseState(
      [pt('p', 0, 3)],
      [
        fixed('fp', 'p'),
        { id: 'co', type: 'coincident', targets: [{ entityId: 'p' }, { entityId: 'el' }] },
      ],
    );
    const det = analyzeDeterminacy(state);
    expect(det.has('el')).toBe(true);
  });
});

describe('parabola as solver geometry (REQ 882)', () => {
  it('a parabola with pinned vertex/focus solves without throwing', async () => {
    const state: SketchState = {
      entities: [
        pt('v', 0, 0), pt('f', 0, 2), pt('s', 4, 2),
        { kind: 'conic', id: 'pb', conicType: 'parabola', pointIds: ['v', 'f', 's'] },
      ],
      constraints: [fixed('fv', 'v'), fixed('ff', 'f')],
    };
    const res = await solveSketch(state);
    expect(res.status).toBe('ok');
  });
});
