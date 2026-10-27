// REQ 885 — slot profiles extrude. The four slot tools produce two geometric
// families: the straight/centerpoint slots (a capsule: 2 lines + 2 semicircle
// caps) and the arc slots (an annular sector: inner arc + outer arc + 2 caps).
// The profile walker must emit each as ONE region of typed mixed edges — the
// exact loop `_regenerateExtrude` hands to the kernel, whose profile builder
// accepts line+arc wires. (The old "profiles mixing lines and arcs are not yet
// extrudable" error mapper was stale — no code produces that error — and has
// been removed from the frontend error catalog.)

const { extractRegions } = require('../../../services/cadProfile');

describe('cadProfile.extractRegions — slot profiles (REQ 885)', () => {
  it('straight/centerpoint slot (capsule: 2 lines + 2 arcs) yields one mixed-edge region', () => {
    // Capsule: centerline from (-10,0) to (10,0), radius 3.
    const state = {
      entities: [
        { kind: 'point', id: 'tl', x: -10, y: 3 },
        { kind: 'point', id: 'tr', x: 10, y: 3 },
        { kind: 'point', id: 'br', x: 10, y: -3 },
        { kind: 'point', id: 'bl', x: -10, y: -3 },
        { kind: 'point', id: 'cr', x: 10, y: 0 },
        { kind: 'point', id: 'cl', x: -10, y: 0 },
        { kind: 'line', id: 'top', startId: 'tl', endId: 'tr' },
        // Right cap: (10,3) → (10,-3) through (13,0) — clockwise.
        { kind: 'arc', id: 'capR', startId: 'tr', endId: 'br', centerId: 'cr', radius: 3, ccw: false },
        { kind: 'line', id: 'bot', startId: 'br', endId: 'bl' },
        // Left cap: (-10,-3) → (-10,3) through (-13,0) — clockwise.
        { kind: 'arc', id: 'capL', startId: 'bl', endId: 'tl', centerId: 'cl', radius: 3, ccw: false },
      ],
      constraints: [],
    };

    const { regions, errors } = extractRegions(state);
    expect(errors || []).toEqual([]);
    expect(regions.length).toBe(1);
    expect(regions[0].holes).toEqual([]);
    const kinds = regions[0].outer.map(e => e.kind).sort();
    expect(regions[0].outer.length).toBe(4);
    expect(kinds.filter(k => k === 'line').length).toBe(2);
    expect(kinds.filter(k => k === 'arc').length).toBe(2);
  });

  it('arc slot (annular sector: 4 arcs) yields one all-arc region', () => {
    // Centerline arc: center (0,0), radius 10, sweep 0°→90°, slot half-width 2.
    const state = {
      entities: [
        { kind: 'point', id: 'i0', x: 8, y: 0 },
        { kind: 'point', id: 'o0', x: 12, y: 0 },
        { kind: 'point', id: 'i1', x: 0, y: 8 },
        { kind: 'point', id: 'o1', x: 0, y: 12 },
        { kind: 'point', id: 'c', x: 0, y: 0 },
        { kind: 'point', id: 'e0', x: 10, y: 0 },
        { kind: 'point', id: 'e1', x: 0, y: 10 },
        // Inner rail 0°→90° CCW, outer rail traversal direction is free — the
        // walker uses both half-edges of every curve.
        { kind: 'arc', id: 'inner', startId: 'i0', endId: 'i1', centerId: 'c', radius: 8, ccw: true },
        { kind: 'arc', id: 'outer', startId: 'o0', endId: 'o1', centerId: 'c', radius: 12, ccw: true },
        // End caps bulge outward past the sweep ends (through (10,-2) / (-2,10))
        // — clockwise, so they don't cut through the sector interior.
        { kind: 'arc', id: 'cap0', startId: 'o0', endId: 'i0', centerId: 'e0', radius: 2, ccw: false },
        { kind: 'arc', id: 'cap1', startId: 'i1', endId: 'o1', centerId: 'e1', radius: 2, ccw: false },
      ],
      constraints: [],
    };

    const { regions, errors } = extractRegions(state);
    expect(errors || []).toEqual([]);
    expect(regions.length).toBe(1);
    expect(regions[0].holes).toEqual([]);
    expect(regions[0].outer.length).toBe(4);
    expect(regions[0].outer.every(e => e.kind === 'arc')).toBe(true);
  });
});
