import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ── DRIFT GUARD ──
// Pins the Roboto glyph tessellation so this engine and the backend port
// (backend/services/cadTextGlyphs.js + backend/tests/.../cadTextGlyphs.test.js)
// stay byte-for-byte identical — otherwise the in-browser sketch/extrude
// preview and the committed solid would render different text. Same font, same
// math, same pinned numbers on both sides. If you change the tessellation here,
// change it there and re-pin BOTH tests.

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(here, '../../../../public/');

beforeAll(() => {
  // textGlyphs loads each face via fetch('assets/fonts/…'); feed it the real
  // TTF off disk so the tessellator runs under vitest (jsdom has no asset server).
  (globalThis as { fetch: unknown }).fetch = async (url: string) => {
    const buf = readFileSync(join(PUBLIC, url));
    return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
});

describe('textGlyphs tessellation (drift guard vs backend cadTextGlyphs.js)', () => {
  it('tessellates "AB" to the pinned loops', async () => {
    const { glyphLoopsForText } = await import('./textGlyphs');
    const loops = await glyphLoopsForText('AB', { x: 0, y: 0 }, 10, 'left', 1000);
    // A: outer outline + 1 counter; B: outer outline + 2 counters = 5 loops.
    expect(loops.length).toBe(5);
    // Adaptive Bézier segmentation (GLYPH_CHORD_MM) — re-pin if you change it.
    expect(loops.map(l => l.length)).toEqual([9, 4, 58, 27, 26]);
    expect(loops.reduce((a, l) => a + l.length, 0)).toBe(124);
    // First point of the first glyph loop.
    expect(loops[0][0].x).toBeCloseTo(7.6374, 3);
    expect(loops[0][0].y).toBeCloseTo(0, 6);
    // Overall bounding box. maxy == box height (10) confirms caps fill the box
    // (cap-height scaling) — catches scale / advance / y-flip regressions.
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (const l of loops) for (const p of l) {
      minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x);
      miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y);
    }
    expect(minx).toBeCloseTo(0.1923, 3);
    expect(miny).toBeCloseTo(0, 6);
    expect(maxx).toBeCloseTo(17.1429, 3);
    expect(maxy).toBeCloseTo(10.0000, 3);
  });

  // REQ 1048 — Bold / Italic / Bold Italic faces; same pins as the backend.
  it.each([
    ['bold', [9, 4, 61, 24, 22], 2.2390, 0.0549, 17.7953],
    ['italic', [9, 4, 58, 24, 26], 0.8242, -0.5563, 16.9490],
    ['boldItalic', [9, 4, 59, 22, 22], 1.5041, -0.7074, 17.6025],
  ] as const)('tessellates "AB" in %s to the pinned loops', async (style, lengths, firstX, minX, maxX) => {
    const { glyphLoopsForText } = await import('./textGlyphs');
    const loops = await glyphLoopsForText('AB', { x: 0, y: 0 }, 10, 'left', 1000, style);
    expect(loops.map(l => l.length)).toEqual(lengths);
    expect(loops[0][0].x).toBeCloseTo(firstX, 3);
    const xs = loops.flat().map(p => p.x), ys = loops.flat().map(p => p.y);
    expect(Math.min(...xs)).toBeCloseTo(minX, 3);
    expect(Math.max(...xs)).toBeCloseTo(maxX, 3);
    expect(Math.max(...ys)).toBeCloseTo(10, 3);  // caps still fill the box
  });

  it('picks the face from the entity flags', async () => {
    const { textStyleOf } = await import('./textGlyphs');
    expect(textStyleOf({})).toBe('regular');
    expect(textStyleOf({ bold: true })).toBe('bold');
    expect(textStyleOf({ italic: true })).toBe('italic');
    expect(textStyleOf({ bold: true, italic: true })).toBe('boldItalic');
  });

  it('does NOT double-advance glyphs (kerned, not stretched)', async () => {
    const { glyphLoopsForText } = await import('./textGlyphs');
    const loops = await glyphLoopsForText('AB', { x: 0, y: 0 }, 10, 'left', 1000);
    // B's leftmost point must sit just past A's advance (~6mm at this scale),
    // not at ~2× that — the old code added the advance twice.
    let bMinX = Infinity;
    for (const p of loops[2]) bMinX = Math.min(bMinX, p.x);
    expect(bMinX).toBeLessThan(14);
  });

  it('emits matching Bézier control-point segments (vs backend)', async () => {
    const { tryGlyphBezierLoops } = await import('./textGlyphs');
    const loops = tryGlyphBezierLoops('AB', { x: 0, y: 0 }, 10, 'left', 1000)!;
    expect(loops).not.toBeNull();
    expect(loops.length).toBe(5);
    expect(loops.map(c => c.length)).toEqual([8, 3, 15, 8, 9]);
    // First segment of the first contour, first control point.
    expect(loops[0][0].points[0].x).toBeCloseTo(7.6374, 3);
    expect(loops[0][0].points[0].y).toBeCloseTo(0, 6);
  });

  it('resolves #{var} placeholders before tessellating', async () => {
    const { loopsFromTextEntityAsync } = await import('./textGlyphs');
    const state = {
      entities: [
        { kind: 'point', id: 'bl', x: 0, y: 0 },
        { kind: 'point', id: 'br', x: 40, y: 0 },
        { kind: 'point', id: 'tr', x: 40, y: 10 },
        { kind: 'point', id: 'tl', x: 0, y: 10 },
      ],
      constraints: [],
    } as never;
    const te = { kind: 'text', id: 't', text: '#{pn}', cornerIds: ['bl', 'br', 'tr', 'tl'], justify: 'left' } as never;
    const literal = await loopsFromTextEntityAsync(state, te);
    const resolved = await loopsFromTextEntityAsync(state, te, s => s.replace('#{pn}', 'AB'));
    expect(resolved.length).toBe(5);                 // 'AB' → 5 loops
    expect(literal.length).toBeGreaterThan(resolved.length);  // '#{pn}' is more glyphs
  });
});
