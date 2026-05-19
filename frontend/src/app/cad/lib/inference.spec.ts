import { describe, it, expect } from 'vitest';
import { inferLineEnd } from './inference';
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

  it('ignores construction lines when hunting for on-line snaps', () => {
    const a: PointEntity = { kind: 'point', id: 'a', x: -50, y: 5 };
    const b: PointEntity = { kind: 'point', id: 'b', x: 50, y: 5 };
    const l: LineEntity = { kind: 'line', id: 'l1', startId: 'a', endId: 'b', construction: true };
    const state: SketchState = { entities: [a, b, l], constraints: [] };
    const r = inferLineEnd(state, { x: 20, y: 0 }, { x: 10, y: 6 });
    expect(r.constraint?.type).not.toBe('coincident');
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
