import { describe, it, expect } from 'vitest';
import { inferLineEnd, inferAlignment, ALIGN_TOL } from './inference';
import type { SketchState, PointEntity, LineEntity } from './types';

const empty: SketchState = { entities: [], constraints: [] };

describe('inferLineEnd', () => {
  it('snaps near-horizontal lines and proposes a Horizontal constraint', () => {
    // start at (0,0), cursor at (10, 0.3) — that's atan2(0.3, 10) ≈ 1.7° < 5°.
    const r = inferLineEnd(empty, { x: 0, y: 0 }, { x: 10, y: 0.3 });
    expect(r.snapped).toEqual({ x: 10, y: 0 });
    expect(r.constraint?.type).toBe('horizontal');
    expect(r.hint).toBe('horizontal');
  });

  it('snaps near-vertical lines and proposes a Vertical constraint', () => {
    const r = inferLineEnd(empty, { x: 0, y: 0 }, { x: 0.4, y: 10 });
    expect(r.snapped).toEqual({ x: 0, y: 10 });
    expect(r.constraint?.type).toBe('vertical');
    expect(r.hint).toBe('vertical');
  });

  it('infers PARALLEL against an existing angled line (REQ 864)', () => {
    // Reference line at 30°, far from the drawing area (no on-curve hit).
    const a: PointEntity = { kind: 'point', id: 'a', x: 100, y: 100 };
    const b: PointEntity = { kind: 'point', id: 'b', x: 100 + 10 * Math.cos(Math.PI / 6), y: 100 + 10 * Math.sin(Math.PI / 6) };
    const l: LineEntity = { kind: 'line', id: 'ref', startId: 'a', endId: 'b' };
    const state: SketchState = { entities: [a, b, l], constraints: [] };
    // Draw from origin at ~32° (within 5° of the reference's 30°).
    const cursor = { x: 10 * Math.cos(32 * Math.PI / 180), y: 10 * Math.sin(32 * Math.PI / 180) };
    const r = inferLineEnd(state, { x: 0, y: 0 }, cursor);
    expect(r.constraint?.type).toBe('parallel');
    expect(r.constraint?.targets).toEqual([{ self: true }, { entityId: 'ref' }]);
    // Snapped direction is exactly 30°.
    const ang = Math.atan2(r.snapped.y, r.snapped.x) * 180 / Math.PI;
    expect(ang).toBeCloseTo(30, 5);
    expect(r.hint).toBe('parallel');
  });

  it('infers PERPENDICULAR against an existing angled line (REQ 864)', () => {
    const a: PointEntity = { kind: 'point', id: 'a', x: 100, y: 100 };
    const b: PointEntity = { kind: 'point', id: 'b', x: 100 + 10 * Math.cos(Math.PI / 6), y: 100 + 10 * Math.sin(Math.PI / 6) };
    const l: LineEntity = { kind: 'line', id: 'ref', startId: 'a', endId: 'b' };
    const state: SketchState = { entities: [a, b, l], constraints: [] };
    // Draw at ~118° — within 5° of 30° + 90°.
    const cursor = { x: 10 * Math.cos(118 * Math.PI / 180), y: 10 * Math.sin(118 * Math.PI / 180) };
    const r = inferLineEnd(state, { x: 0, y: 0 }, cursor);
    expect(r.constraint?.type).toBe('perpendicular');
    const ang = Math.atan2(r.snapped.y, r.snapped.x) * 180 / Math.PI;
    expect(ang).toBeCloseTo(120, 5);
  });

  it('does not infer parallel against axis-aligned reference lines (H/V own those)', () => {
    const a: PointEntity = { kind: 'point', id: 'a', x: 100, y: 100 };
    const b: PointEntity = { kind: 'point', id: 'b', x: 120, y: 100 };  // horizontal ref
    const l: LineEntity = { kind: 'line', id: 'ref', startId: 'a', endId: 'b' };
    const state: SketchState = { entities: [a, b, l], constraints: [] };
    // ~2° from horizontal → the HORIZONTAL branch fires, not parallel.
    const r = inferLineEnd(state, { x: 0, y: 0 }, { x: 10, y: 0.3 });
    expect(r.constraint?.type).toBe('horizontal');
  });

  it('returns the raw cursor when the angle is too oblique', () => {
    const r = inferLineEnd(empty, { x: 0, y: 0 }, { x: 10, y: 7 });
    expect(r.snapped).toEqual({ x: 10, y: 7 });
    expect(r.constraint).toBeNull();
    expect(r.hint).toBeNull();
  });

  it('snaps onto an existing line and proposes point-on-line', () => {
    // A horizontal line from (-50, 5) to (50, 5).
    const a: PointEntity = { kind: 'point', id: 'a', x: -50, y: 5 };
    const b: PointEntity = { kind: 'point', id: 'b', x: 50, y: 5 };
    const l: LineEntity = { kind: 'line', id: 'l1', startId: 'a', endId: 'b' };
    const state: SketchState = { entities: [a, b, l], constraints: [] };
    // Cursor offset 1 unit above the line at x=10 (within LINE_SNAP_TOL).
    const r = inferLineEnd(state, { x: 20, y: 0 }, { x: 10, y: 6 });
    expect(r.snapped).toEqual({ x: 10, y: 5 });
    expect(r.constraint?.type).toBe('coincident');
    expect(r.constraint?.targets[1]).toEqual({ entityId: 'l1' });
    expect(r.hint).toBe('on line');
  });

  it('does not snap to a line near its endpoints (coincident reuse takes over there)', () => {
    const a: PointEntity = { kind: 'point', id: 'a', x: -50, y: 5 };
    const b: PointEntity = { kind: 'point', id: 'b', x: 50, y: 5 };
    const l: LineEntity = { kind: 'line', id: 'l1', startId: 'a', endId: 'b' };
    const state: SketchState = { entities: [a, b, l], constraints: [] };
    // Cursor right next to endpoint 'b'.
    const r = inferLineEnd(state, { x: 20, y: 0 }, { x: 49.5, y: 5.2 });
    // Near-endpoint zone is excluded from line-snap so coincident point reuse
    // (handled in the editor) wins. The result is a raw cursor passthrough,
    // not a point-on-line constraint.
    expect(r.constraint?.type).not.toBe('coincident');
  });

  it('snaps onto construction lines the same as normal lines', () => {
    // Construction geometry is a full inference target (SolidWorks behaviour):
    // hovering near a construction line drops the same coincident-on-line snap
    // a normal line would. Cursor (10,6) projects onto the line at (10,5).
    const a: PointEntity = { kind: 'point', id: 'a', x: -50, y: 5 };
    const b: PointEntity = { kind: 'point', id: 'b', x: 50, y: 5 };
    const l: LineEntity = { kind: 'line', id: 'l1', startId: 'a', endId: 'b', construction: true };
    const state: SketchState = { entities: [a, b, l], constraints: [] };
    const r = inferLineEnd(state, { x: 20, y: 0 }, { x: 10, y: 6 });
    expect(r.constraint?.type).toBe('coincident');
  });

  it('polar-snaps to a 30° angle and emits a guide from the start', () => {
    // 30° from +x: dx/dy ratio = cos(30°)/sin(30°) ≈ 1.732. Land cursor on
    // that ray at length 10 → (8.66, 5).
    const r = inferLineEnd(empty, { x: 0, y: 0 }, { x: 8.66, y: 5 });
    expect(r.constraint).toBeNull();         // polar is visual only
    expect(r.hint).toBe('30°');
    expect(r.guides).toBeDefined();
    expect(r.guides!.length).toBe(1);
    expect(r.guides![0].from).toEqual({ x: 0, y: 0 });
    expect(r.snapped.x).toBeCloseTo(8.66, 1);
    expect(r.snapped.y).toBeCloseTo(5, 1);
  });

  it('aligns to a remote sketch point`s vertical and emits a guide from it', () => {
    // A remote point at (20, 0). Start drawing from (-10, 0); cursor at
    // (20.3, 12) → cursor.x is within ALIGN_TOL of remote.x → snap.
    const remote: PointEntity = { kind: 'point', id: 'remote', x: 20, y: 0 };
    const state: SketchState = { entities: [remote], constraints: [] };
    const r = inferLineEnd(state, { x: -10, y: 0 }, { x: 20.3, y: 12 });
    expect(r.hint).toBe('aligned');
    expect(r.snapped.x).toBeCloseTo(20);
    expect(r.snapped.y).toBeCloseTo(12);
    expect(r.guides![0].from).toEqual({ x: 20, y: 0 });
  });
});

describe('inferAlignment', () => {
  // The synthetic origin lives at (0,0) on every sketch plane. The engine
  // resolves it from its reserved id even when it isn't materialised as an
  // entity in the passed state.
  const remote = (id: string, x: number, y: number): PointEntity => ({ kind: 'point', id, x, y });

  it('always arms the origin: a point near the origin`s vertical gets a vertical constraint to it', () => {
    // Cursor x within ALIGN_TOL of 0 (the origin`s x) → vertical (shared-x).
    const r = inferAlignment(empty, { x: 0.4, y: 30 }, []);
    expect(r.refs).toEqual([{ refId: 'origin', type: 'vertical' }]);
    expect(r.snapped).toEqual({ x: 0, y: 30 });
    expect(r.hints).toContain('vertical');
    expect(r.guides[0].from).toEqual({ x: 0, y: 0 });
  });

  it('aligns horizontally (shared-y) to the origin', () => {
    const r = inferAlignment(empty, { x: 30, y: -0.5 }, []);
    expect(r.refs).toEqual([{ refId: 'origin', type: 'horizontal' }]);
    expect(r.snapped).toEqual({ x: 30, y: 0 });
    expect(r.hints).toContain('horizontal');
  });

  it('does NOT align to a point that has not been armed (hover-to-arm)', () => {
    const state: SketchState = { entities: [remote('p1', 25, 0)], constraints: [] };
    // Cursor lined up with p1`s vertical, but p1 isn`t armed → no fire
    // (origin is far away in x, so nothing fires at all).
    const r = inferAlignment(state, { x: 25.3, y: 40 }, []);
    expect(r.refs).toEqual([]);
    expect(r.snapped).toEqual({ x: 25.3, y: 40 });
    expect(r.hints).toEqual([]);
  });

  it('aligns to a point once it is armed', () => {
    const state: SketchState = { entities: [remote('p1', 25, 0)], constraints: [] };
    const r = inferAlignment(state, { x: 25.3, y: 40 }, ['p1']);
    expect(r.refs).toEqual([{ refId: 'p1', type: 'vertical' }]);
    expect(r.snapped).toEqual({ x: 25, y: 40 });
    expect(r.guides[0].from).toEqual({ x: 25, y: 0 });
  });

  it('infers a simultaneous horizontal + vertical against two different refs (fully locking the point)', () => {
    // pV at x=10 (vertical ref), pH at y=20 (horizontal ref). Cursor near both.
    const state: SketchState = {
      entities: [remote('pV', 10, -5), remote('pH', -5, 20)],
      constraints: [],
    };
    const r = inferAlignment(state, { x: 10.4, y: 19.6 }, ['pV', 'pH']);
    expect(r.snapped).toEqual({ x: 10, y: 20 });
    expect(r.refs).toEqual(
      expect.arrayContaining([
        { refId: 'pV', type: 'vertical' },
        { refId: 'pH', type: 'horizontal' },
      ]),
    );
    expect(r.refs.length).toBe(2);
    expect(r.hints).toEqual(expect.arrayContaining(['vertical', 'horizontal']));
    expect(r.guides.length).toBe(2);
  });

  it('does not fire outside the alignment tolerance', () => {
    const r = inferAlignment(empty, { x: ALIGN_TOL + 0.5, y: ALIGN_TOL + 0.5 }, []);
    expect(r.refs).toEqual([]);
    expect(r.snapped).toEqual({ x: ALIGN_TOL + 0.5, y: ALIGN_TOL + 0.5 });
  });

  it('keeps only the closer axis when a single ref would satisfy both H and V (avoids a degenerate double-constraint)', () => {
    // Cursor near the origin in BOTH axes — that is "on" the origin, which is
    // coincident territory, not a pair of H+V relations to the same point.
    const r = inferAlignment(empty, { x: 0.3, y: 0.8 }, []);
    expect(r.refs.length).toBe(1);
    // dx (0.3) < dy (0.8) → vertical (shared-x) is the closer alignment.
    expect(r.refs[0]).toEqual({ refId: 'origin', type: 'vertical' });
  });

  it('excludes ids passed in opts.excludeIds (e.g. the gesture`s own anchor)', () => {
    const state: SketchState = { entities: [remote('p1', 25, 0)], constraints: [] };
    const r = inferAlignment(state, { x: 25.3, y: 40 }, ['p1'], { excludeIds: ['p1'] });
    expect(r.refs).toEqual([]);
  });
});
