// Server-side port of `frontend/src/app/cad/lib/textGlyphs.spec.ts`.
//
// ── DRIFT GUARD ──
// Pins the Roboto glyph tessellation so this engine and the frontend engine
// stay byte-for-byte identical — otherwise the in-browser preview and the
// committed solid would render different text. The pinned numbers below are
// the SAME as the frontend spec's. If you change the tessellation math in
// cadTextGlyphs.js, change it in textGlyphs.ts too and re-pin BOTH tests.

const { loopsFromTextEntity, _tessellate, _tessellateBezier, _fontLoaded } = require('../../../services/cadTextGlyphs');
const { extractRegions } = require('../../../services/cadProfile');

function textBoxState(text, justify = 'left', w = 40, h = 10) {
  return {
    entities: [
      { kind: 'point', id: 'bl', x: 0, y: 0, construction: true },
      { kind: 'point', id: 'br', x: w, y: 0, construction: true },
      { kind: 'point', id: 'tr', x: w, y: h, construction: true },
      { kind: 'point', id: 'tl', x: 0, y: h, construction: true },
      { kind: 'line', id: 'lb', startId: 'bl', endId: 'br', construction: true },
      { kind: 'line', id: 'lr', startId: 'br', endId: 'tr', construction: true },
      { kind: 'line', id: 'lt', startId: 'tr', endId: 'tl', construction: true },
      { kind: 'line', id: 'll', startId: 'tl', endId: 'bl', construction: true },
      { kind: 'text', id: 't1', text, cornerIds: ['bl', 'br', 'tr', 'tl'], justify },
    ],
    constraints: [],
  };
}

describe('cadTextGlyphs (drift guard vs frontend textGlyphs.ts)', () => {
  it('loads the bundled Roboto font', () => {
    expect(_fontLoaded()).toBe(true);
  });

  // REQ 1048 — Bold / Italic / Bold Italic faces; same pins as the frontend.
  it.each([
    ['bold', [9, 4, 61, 24, 22], 2.2390, 0.0549, 17.7953],
    ['italic', [9, 4, 58, 24, 26], 0.8242, -0.5563, 16.9490],
    ['boldItalic', [9, 4, 59, 22, 22], 1.5041, -0.7074, 17.6025],
  ])('tessellates "AB" in %s to the pinned loops', (style, lengths, firstX, minX, maxX) => {
    expect(_fontLoaded(style)).toBe(true);
    const loops = _tessellate('AB', { x: 0, y: 0 }, 10, 'left', 1000, style);
    expect(loops.map(l => l.length)).toEqual(lengths);
    expect(loops[0][0].x).toBeCloseTo(firstX, 3);
    const xs = loops.flat().map(p => p.x), ys = loops.flat().map(p => p.y);
    expect(Math.min(...xs)).toBeCloseTo(minX, 3);
    expect(Math.max(...xs)).toBeCloseTo(maxX, 3);
    expect(Math.max(...ys)).toBeCloseTo(10, 3);
  });

  it('a bold text entity extrudes the bold face', () => {
    const st = textBoxState('AB');
    const regular = loopsFromTextEntity(st, st.entities.find(e => e.kind === 'text'));
    st.entities.find(e => e.kind === 'text').bold = true;
    const bold = loopsFromTextEntity(st, st.entities.find(e => e.kind === 'text'));
    expect(bold.map(l => l.length)).toEqual([9, 4, 61, 24, 22]);
    expect(bold.map(l => l.length)).not.toEqual(regular.map(l => l.length));
  });

  it('tessellates "AB" to the pinned loops', () => {
    const loops = _tessellate('AB', { x: 0, y: 0 }, 10, 'left', 1000);
    // A: outer outline + 1 counter; B: outer outline + 2 counters = 5 loops.
    expect(loops.length).toBe(5);
    // Adaptive Bézier segmentation (GLYPH_CHORD_MM) — re-pin if you change it.
    expect(loops.map(l => l.length)).toEqual([9, 4, 58, 27, 26]);
    expect(loops.reduce((a, l) => a + l.length, 0)).toBe(124);
    expect(loops[0][0].x).toBeCloseTo(7.6374, 3);
    expect(loops[0][0].y).toBeCloseTo(0, 6);
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (const l of loops) for (const p of l) {
      minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x);
      miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y);
    }
    expect(minx).toBeCloseTo(0.1923, 3);
    expect(miny).toBeCloseTo(0, 6);
    expect(maxx).toBeCloseTo(17.1429, 3);
    // maxy == box height (10) → caps fill the box (cap-height scaling).
    expect(maxy).toBeCloseTo(10.0000, 3);
  });

  it('does NOT double-advance glyphs', () => {
    const loops = _tessellate('AB', { x: 0, y: 0 }, 10, 'left', 1000);
    let bMinX = Infinity;
    for (const p of loops[2]) bMinX = Math.min(bMinX, p.x);
    expect(bMinX).toBeLessThan(14);
  });

  it('emits matching Bézier control-point segments (vs frontend)', () => {
    const loops = _tessellateBezier('AB', { x: 0, y: 0 }, 10, 'left', 1000);
    expect(loops.length).toBe(5);
    expect(loops.map((c) => c.length)).toEqual([8, 3, 15, 8, 9]);
    expect(loops[0][0].points[0].x).toBeCloseTo(7.6374, 3);
    expect(loops[0][0].points[0].y).toBeCloseTo(0, 6);
  });

  it('resolves #{var} placeholders before tessellating', () => {
    const state = textBoxState('#{pn}');
    const te = state.entities.find(e => e.kind === 'text');
    const literal = loopsFromTextEntity(state, te);
    const resolved = loopsFromTextEntity(state, te, s => s.replace('#{pn}', 'AB'));
    expect(resolved.length).toBe(5);
    expect(literal.length).toBeGreaterThan(resolved.length);
  });

  it('feeds extractRegions: glyph counters become holes', () => {
    const state = textBoxState('#{pn}');
    const { regions, errors } = extractRegions(state, s => s.replace('#{pn}', 'AB'));
    expect(errors).toEqual([]);
    // 5 glyph loops → 5 regions; construction box excluded.
    expect(regions.length).toBe(5);
    // At least one region (a letter outline) carries its counter as a hole.
    expect(regions.some(r => r.holes.length > 0)).toBe(true);
  });
});
