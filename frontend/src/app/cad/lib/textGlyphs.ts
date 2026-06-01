// REQ Batch 6 — glyph outline tessellation for sketch text.
//
// Loads Roboto Regular once (lazily, on first use), parses glyph outlines via
// opentype.js, tessellates Bezier curves into polylines, and yields closed
// loops suitable for the extrude profile pipeline. Each character contributes
// one or more closed loops; letters like 'O' contribute two (outer + inner).
//
// ── KEEP IN SYNC WITH backend/services/cadTextGlyphs.js ──
// The backend re-runs this tessellation on regen/commit. Both MUST produce
// byte-for-byte identical loops (same Roboto TTF, same opentype.js version,
// same scale/kerning/segment counts) or the preview and the committed solid
// diverge. The `textGlyphs.spec.ts` / `cad-text-glyphs.test.js` pair pins a
// sample string on both sides as a drift guard.

import * as opentype from 'opentype.js';
import type { Font, Path, PathCommand } from 'opentype.js';
import type { TextEntity } from './types';

const FONT_URL = 'assets/fonts/Roboto-Regular.ttf';

let fontPromise: Promise<Font> | null = null;

/** Lazy-load the bundled Roboto font. Cached after the first call. */
async function loadFont(): Promise<Font> {
  if (!fontPromise) {
    fontPromise = (async () => {
      const resp = await fetch(FONT_URL);
      if (!resp.ok) throw new Error(`Roboto font fetch failed (${resp.status})`);
      const buf = await resp.arrayBuffer();
      return opentype.parse(buf);
    })();
  }
  return fontPromise;
}

/** Resolved closed loop in sketch coords: a polyline whose first and last
 * points are coincident. Each entry is one sub-path of a glyph (e.g., the
 * outer outline of 'O' vs the inner hole). */
export type GlyphLoop = Array<{ x: number; y: number }>;

/** Public synchronous accessor — returns null when the font hasn't been
 * loaded yet. Triggers a load if needed so subsequent calls succeed. */
export function tryGlyphLoopsForText(
  text: string, anchor: { x: number; y: number }, capHeightMm: number,
  alignment: 'left' | 'center' | 'right', boxWidthMm: number,
): GlyphLoop[] | null {
  if (!fontPromise) { void loadFont(); return null; }
  if (!font) return null;
  return _tessellate(font, text, anchor, capHeightMm, alignment, boxWidthMm);
}

/** Cached synchronous handle once the font is parsed — opentype.js's getPaths
 * is synchronous. */
let font: Font | null = null;
/** One-shot callbacks fired when the font finishes parsing. Consumers (e.g.
 * the viewer's sketch overlay) register here so they can re-render once Roboto
 * is available — `tryGlyphLoopsForText` returns null until then. */
const fontReadyCbs: Array<() => void> = [];
loadFont().then(f => {
  font = f;
  const cbs = fontReadyCbs.splice(0);
  for (const cb of cbs) { try { cb(); } catch { /* consumer error — ignore */ } }
}).catch(() => { /* network failure — leave null */ });

/** Register a callback fired once Roboto has parsed. Fires synchronously if the
 * font is already loaded; otherwise queued and invoked one time when the load
 * resolves. Used by the sketch overlay to re-render text on first font load. */
export function onFontReady(cb: () => void): void {
  if (font) { cb(); return; }
  fontReadyCbs.push(cb);
}

/** Cap height in font units. The box height maps to THIS (the uppercase-letter
 * height), not the larger ascender — otherwise an uppercase letter only fills
 * ~68% of the box, leaving a visible top margin. Falls back to the ascender
 * when the font lacks an OS/2 cap height. KEEP IN SYNC with cadTextGlyphs.js. */
function capHeightOf(fontObj: Font): number {
  const os2 = (fontObj as unknown as { tables?: { os2?: { sCapHeight?: number } } }).tables?.os2;
  return (os2 && os2.sCapHeight) || fontObj.ascender;
}

interface Pt { x: number; y: number; }

/** True when the box basis is the identity (axis-aligned, unit axes). */
function isAxisAligned(axx: number, axy: number, ayx: number, ayy: number): boolean {
  return Math.abs(axx - 1) < 1e-9 && Math.abs(axy) < 1e-9
      && Math.abs(ayx) < 1e-9 && Math.abs(ayy - 1) < 1e-9;
}

/** Map an axis-aligned box-local glyph point onto the box's actual basis.
 * Glyphs come out of `_tessellate` laid out axis-aligned at `bl`; this remaps
 * them onto the box frame (xAxis = bl→br, yAxis = bl→tl), optionally mirrored.
 * Identity for an axis-aligned box. This is how rotated text follows its
 * (rotated) construction box: the CORNERS carry the rotation, the glyphs ride
 * the basis. KEEP IN SYNC with cadTextGlyphs.js. */
function mapToBoxBasis(
  p: Pt, bl: Pt, axx: number, axy: number, ayx: number, ayy: number, boxW: number, mirror: boolean,
): Pt {
  let lx = p.x - bl.x;
  const ly = p.y - bl.y;
  if (mirror) lx = boxW - lx;
  return { x: bl.x + lx * axx + ly * ayx, y: bl.y + lx * axy + ly * ayy };
}

/** Map glyph point-loops onto the box basis (rotation/mirror via the corners).
 * No-op for an axis-aligned, un-mirrored box. */
export function applyTextTransform(
  loops: GlyphLoop[], bl: Pt, br: Pt, tl: Pt, boxW: number, boxH: number, mirror: boolean,
): GlyphLoop[] {
  const axx = (br.x - bl.x) / boxW, axy = (br.y - bl.y) / boxW;
  const ayx = (tl.x - bl.x) / boxH, ayy = (tl.y - bl.y) / boxH;
  if (!mirror && isAxisAligned(axx, axy, ayx, ayy)) return loops;
  return loops.map(l => l.map(p => mapToBoxBasis(p, bl, axx, axy, ayx, ayy, boxW, mirror)));
}

/** Same as applyTextTransform but for Bézier control-point segments. */
function applyTextBezierTransform(
  contours: GlyphBezierLoop[], bl: Pt, br: Pt, tl: Pt, boxW: number, boxH: number, mirror: boolean,
): GlyphBezierLoop[] {
  const axx = (br.x - bl.x) / boxW, axy = (br.y - bl.y) / boxW;
  const ayx = (tl.x - bl.x) / boxH, ayy = (tl.y - bl.y) / boxH;
  if (!mirror && isAxisAligned(axx, axy, ayx, ayy)) return contours;
  return contours.map(c => c.map(seg => ({
    points: seg.points.map(p => mapToBoxBasis(p, bl, axx, axy, ayx, ayy, boxW, mirror)),
  })));
}

/** Async version — waits for the font to load. Preferred for caller paths
 * that can await. */
export async function glyphLoopsForText(
  text: string, anchor: { x: number; y: number }, capHeightMm: number,
  alignment: 'left' | 'center' | 'right', boxWidthMm: number,
): Promise<GlyphLoop[]> {
  const f = await loadFont();
  return _tessellate(f, text, anchor, capHeightMm, alignment, boxWidthMm);
}

/** Resolver applied to the entity's raw text before tessellation. Used to
 * expand `#{var}` placeholders (partNumber / revision / equations) so the
 * extruded geometry matches what the viewer displays. Defaults to identity. */
export type TextResolver = (raw: string) => string;
const IDENTITY_RESOLVER: TextResolver = s => s;

/** Build a resolver that expands `#{name}` placeholders from a variable map.
 * Unknown names are left verbatim. Single source of the placeholder syntax so
 * the viewer preview and the extrude path resolve text identically. */
export function makeVarResolver(vars: Record<string, string>): TextResolver {
  return raw => raw.replace(/#\{([^}]+)\}/g, (full, name) => {
    const v = vars[String(name).trim()];
    return v === undefined ? full : v;
  });
}

/** Convert a TextEntity into closed loops in sketch coords. Reads the
 * box dimensions from the entity's 4 corner points (or returns []
 * when the font isn't loaded yet). `resolve` expands `#{var}` placeholders
 * so the profile/extrude path matches the viewer's displayed text. */
export function loopsFromTextEntity(
  state: import('./types').SketchState, e: TextEntity,
  resolve: TextResolver = IDENTITY_RESOLVER,
): GlyphLoop[] {
  if (!e.cornerIds || e.cornerIds.length !== 4) return [];
  const [blId, brId, trId, tlId] = e.cornerIds;
  const ents = state.entities;
  const bl = ents.find(p => p.id === blId && p.kind === 'point') as any;
  const br = ents.find(p => p.id === brId && p.kind === 'point') as any;
  const tl = ents.find(p => p.id === tlId && p.kind === 'point') as any;
  if (!bl || !br || !tl) return [];
  const boxW = Math.hypot(br.x - bl.x, br.y - bl.y);
  const boxH = Math.hypot(tl.x - bl.x, tl.y - bl.y);
  if (boxW < 1e-6 || boxH < 1e-6) return [];
  const text = resolve(e.text || '');
  const loops = tryGlyphLoopsForText(text, { x: bl.x, y: bl.y }, boxH, e.justify ?? 'left', boxW) ?? [];
  return applyTextTransform(loops, bl, br, tl, boxW, boxH, !!e.mirror);
}

/** Same as above but waits for the font to load — used by the extrude
 * pipeline so the loops are always available on commit. */
export async function loopsFromTextEntityAsync(
  state: import('./types').SketchState, e: TextEntity,
  resolve: TextResolver = IDENTITY_RESOLVER,
): Promise<GlyphLoop[]> {
  if (!e.cornerIds || e.cornerIds.length !== 4) return [];
  const [blId, brId, , tlId] = e.cornerIds;
  const ents = state.entities;
  const bl = ents.find(p => p.id === blId && p.kind === 'point') as any;
  const br = ents.find(p => p.id === brId && p.kind === 'point') as any;
  const tl = ents.find(p => p.id === tlId && p.kind === 'point') as any;
  if (!bl || !br || !tl) return [];
  const boxW = Math.hypot(br.x - bl.x, br.y - bl.y);
  const boxH = Math.hypot(tl.x - bl.x, tl.y - bl.y);
  if (boxW < 1e-6 || boxH < 1e-6) return [];
  const text = resolve(e.text || '');
  return glyphLoopsForText(text, { x: bl.x, y: bl.y }, boxH, e.justify ?? 'left', boxW);
}

// ── Bézier-segment output (for analytic profile edges) ──
// A glyph contour as ordered Bézier segments. Each segment's `points` are
// control points in SKETCH coords: 2 = line, 3 = quadratic, 4 = cubic; the
// segment runs points[0] → points[last] and chains to the next. Feeding these
// to the kernel as `Edge::bezier` makes each curve ONE smooth face instead of
// N tessellated side faces — the fix for "fonts produce too many faces".
export type GlyphBezierSeg = { points: Array<{ x: number; y: number }> };
export type GlyphBezierLoop = GlyphBezierSeg[];

/** Sync accessor — null until the font is parsed (triggers a load). */
export function tryGlyphBezierLoops(
  text: string, anchor: { x: number; y: number }, capHeightMm: number,
  alignment: 'left' | 'center' | 'right', boxWidthMm: number,
): GlyphBezierLoop[] | null {
  if (!fontPromise) { void loadFont(); return null; }
  if (!font) return null;
  return _tessellateBezier(font, text, anchor, capHeightMm, alignment, boxWidthMm);
}

/** TextEntity → analytic Bézier contours in sketch coords. Mirrors
 * `loopsFromTextEntity` but yields control-point segments instead of sampled
 * polylines, for the smooth-face extrude path. Returns [] until font loads. */
export function bezierLoopsFromTextEntity(
  state: import('./types').SketchState, e: TextEntity,
  resolve: TextResolver = IDENTITY_RESOLVER,
): GlyphBezierLoop[] {
  if (!e.cornerIds || e.cornerIds.length !== 4) return [];
  const [blId, brId, , tlId] = e.cornerIds;
  const ents = state.entities;
  const bl = ents.find(p => p.id === blId && p.kind === 'point') as any;
  const br = ents.find(p => p.id === brId && p.kind === 'point') as any;
  const tl = ents.find(p => p.id === tlId && p.kind === 'point') as any;
  if (!bl || !br || !tl) return [];
  const boxW = Math.hypot(br.x - bl.x, br.y - bl.y);
  const boxH = Math.hypot(tl.x - bl.x, tl.y - bl.y);
  if (boxW < 1e-6 || boxH < 1e-6) return [];
  const text = resolve(e.text || '');
  const contours = tryGlyphBezierLoops(text, { x: bl.x, y: bl.y }, boxH, e.justify ?? 'left', boxW) ?? [];
  return applyTextBezierTransform(contours, bl, br, tl, boxW, boxH, !!e.mirror);
}

function _tessellate(
  fontObj: Font, text: string,
  anchor: { x: number; y: number }, capHeightMm: number,
  alignment: 'left' | 'center' | 'right', boxWidthMm: number,
): GlyphLoop[] {
  if (!text) return [];
  // Scale font units → mm by matching the font's ascender to the box height.
  const scale = capHeightMm / capHeightOf(fontObj);
  // Full kerned text width in mm, for the alignment offset + overflow clamp.
  const pxAdvance = fontObj.getAdvanceWidth(text, fontObj.unitsPerEm, { kerning: true });
  const naturalMm = pxAdvance * scale;
  const offsetX =
    alignment === 'right'  ? boxWidthMm - Math.min(boxWidthMm, naturalMm) :
    alignment === 'center' ? (boxWidthMm - Math.min(boxWidthMm, naturalMm)) / 2 :
                             0;
  const out: GlyphLoop[] = [];
  // getPaths already lays the whole string out horizontally WITH kerning, so
  // each path's coordinates are the glyph's absolute position in font units —
  // we must NOT add a per-glyph advance again (that double-spaced the text).
  // `advance` is tracked only to decide where the box overflows.
  const paths = fontObj.getPaths(text, 0, 0, fontObj.unitsPerEm, { kerning: true });
  let advance = 0;
  for (let i = 0; i < text.length; i++) {
    const glyph = fontObj.charToGlyph(text[i]);
    const path = paths[i];
    if (!path) { advance += (glyph.advanceWidth ?? 0) * scale; continue; }
    // Stop before a glyph that starts past the right edge of the box.
    if (advance > boxWidthMm + 1e-3) break;
    const subpaths = pathToSubpaths(path);
    for (const sp of subpaths) {
      const tess = tessellateSubpath(sp, scale);
      if (tess.length >= 3) {
        // opentype's y points up; sketch y is already up, but getPaths emits
        // outlines below the baseline as positive-down, so negate y.
        const loop = tess.map(p => ({
          x: anchor.x + offsetX + p.x,
          y: anchor.y - p.y,
        }));
        out.push(loop);
      }
    }
    advance += (glyph.advanceWidth ?? 0) * scale;
  }
  return out;
}

/** Same layout as `_tessellate`, but emits Bézier control-point segments per
 * contour instead of sampled polylines. Shares the scale / alignment / advance
 * math so the analytic edges land exactly where the sampled preview does. */
function _tessellateBezier(
  fontObj: Font, text: string,
  anchor: { x: number; y: number }, capHeightMm: number,
  alignment: 'left' | 'center' | 'right', boxWidthMm: number,
): GlyphBezierLoop[] {
  if (!text) return [];
  const scale = capHeightMm / capHeightOf(fontObj);
  const pxAdvance = fontObj.getAdvanceWidth(text, fontObj.unitsPerEm, { kerning: true });
  const naturalMm = pxAdvance * scale;
  const offsetX =
    alignment === 'right'  ? boxWidthMm - Math.min(boxWidthMm, naturalMm) :
    alignment === 'center' ? (boxWidthMm - Math.min(boxWidthMm, naturalMm)) / 2 :
                             0;
  const out: GlyphBezierLoop[] = [];
  const paths = fontObj.getPaths(text, 0, 0, fontObj.unitsPerEm, { kerning: true });
  let advance = 0;
  for (let i = 0; i < text.length; i++) {
    const glyph = fontObj.charToGlyph(text[i]);
    const path = paths[i];
    if (!path) { advance += (glyph.advanceWidth ?? 0) * scale; continue; }
    if (advance > boxWidthMm + 1e-3) break;
    for (const sp of pathToSubpaths(path)) {
      const segs = subpathToBezierSegs(sp, scale);
      if (segs.length === 0) continue;
      out.push(segs.map(s => ({
        points: s.points.map(p => ({ x: anchor.x + offsetX + p.x, y: anchor.y - p.y })),
      })));
    }
    advance += (glyph.advanceWidth ?? 0) * scale;
  }
  return out;
}

/** Split a Path into sub-paths (each starts with a MoveTo). */
function pathToSubpaths(path: Path): PathCommand[][] {
  const out: PathCommand[][] = [];
  let cur: PathCommand[] = [];
  for (const c of path.commands) {
    if (c.type === 'M' && cur.length > 0) {
      out.push(cur);
      cur = [c];
    } else {
      cur.push(c);
    }
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

// Adaptive Bézier segmentation. Each emitted segment becomes a profile line
// edge → one side face on extrude, so over-tessellating small glyphs explodes
// the face count and slows everything down. We pick a segment count from the
// curve's control-polygon length in MM (font units × scale) against a target
// chord, clamped to keep tiny curves cheap and big text smooth. KEEP IN SYNC
// with backend/services/cadTextGlyphs.js.
const GLYPH_CHORD_MM = 0.35;  // ~max chord length per segment
const GLYPH_MIN_SEGS = 2;
const GLYPH_MAX_SEGS = 16;
function adaptiveSegs(ctrlLenFontUnits: number, scale: number): number {
  const lenMm = ctrlLenFontUnits * scale;
  const n = Math.ceil(lenMm / GLYPH_CHORD_MM);
  return Math.max(GLYPH_MIN_SEGS, Math.min(GLYPH_MAX_SEGS, n));
}

/** Tessellate a single sub-path (MoveTo + LineTo/QuadTo/CubicTo... + Close)
 * into a polyline in sketch units. */
function tessellateSubpath(commands: PathCommand[], scale: number): Array<{ x: number; y: number }> {
  if (commands.length === 0) return [];
  const out: Array<{ x: number; y: number }> = [];
  let cx = 0, cy = 0;
  const push = (x: number, y: number) => out.push({ x: x * scale, y: y * scale });
  const hyp = (ax: number, ay: number, bx: number, by: number) => Math.hypot(bx - ax, by - ay);
  for (const c of commands) {
    switch (c.type) {
      case 'M': {
        cx = c.x ?? 0; cy = c.y ?? 0;
        push(cx, cy);
        break;
      }
      case 'L': {
        cx = c.x ?? 0; cy = c.y ?? 0;
        push(cx, cy);
        break;
      }
      case 'Q': {
        // Quadratic Bezier from (cx,cy) via (x1,y1) to (xe,ye).
        const x1 = c.x1 ?? 0, y1 = c.y1 ?? 0, xe = c.x ?? 0, ye = c.y ?? 0;
        const segs = adaptiveSegs(hyp(cx, cy, x1, y1) + hyp(x1, y1, xe, ye), scale);
        for (let s = 1; s <= segs; s++) {
          const t = s / segs;
          const it = 1 - t;
          const x = it * it * cx + 2 * it * t * x1 + t * t * xe;
          const y = it * it * cy + 2 * it * t * y1 + t * t * ye;
          push(x, y);
        }
        cx = xe; cy = ye;
        break;
      }
      case 'C': {
        // Cubic Bezier — Roboto uses these.
        const x1 = c.x1 ?? 0, y1 = c.y1 ?? 0, x2 = c.x2 ?? 0, y2 = c.y2 ?? 0;
        const xe = c.x ?? 0, ye = c.y ?? 0;
        const segs = adaptiveSegs(
          hyp(cx, cy, x1, y1) + hyp(x1, y1, x2, y2) + hyp(x2, y2, xe, ye), scale);
        for (let s = 1; s <= segs; s++) {
          const t = s / segs;
          const it = 1 - t;
          const x = it * it * it * cx + 3 * it * it * t * x1 + 3 * it * t * t * x2 + t * t * t * xe;
          const y = it * it * it * cy + 3 * it * it * t * y1 + 3 * it * t * t * y2 + t * t * t * ye;
          push(x, y);
        }
        cx = xe; cy = ye;
        break;
      }
      case 'Z': {
        // Close the loop — duplicate first point at the end.
        if (out.length > 0 && (out[0].x !== out[out.length - 1].x || out[0].y !== out[out.length - 1].y)) {
          out.push(out[0]);
        }
        break;
      }
    }
  }
  return out;
}

/** Emit one Bézier segment per path command (control points in scaled glyph
 * units): L → 2 points (line), Q → 3 (quadratic), C → 4 (cubic). The Z close
 * adds a final line segment back to the contour start. KEEP IN SYNC with
 * backend/services/cadTextGlyphs.js. */
function subpathToBezierSegs(commands: PathCommand[], scale: number): GlyphBezierSeg[] {
  if (commands.length === 0) return [];
  const segs: GlyphBezierSeg[] = [];
  let cx = 0, cy = 0, sx = 0, sy = 0;
  const p = (x: number, y: number) => ({ x: x * scale, y: y * scale });
  for (const c of commands) {
    switch (c.type) {
      case 'M': cx = c.x ?? 0; cy = c.y ?? 0; sx = cx; sy = cy; break;
      case 'L': {
        const ex = c.x ?? 0, ey = c.y ?? 0;
        segs.push({ points: [p(cx, cy), p(ex, ey)] });
        cx = ex; cy = ey;
        break;
      }
      case 'Q': {
        const x1 = c.x1 ?? 0, y1 = c.y1 ?? 0, ex = c.x ?? 0, ey = c.y ?? 0;
        segs.push({ points: [p(cx, cy), p(x1, y1), p(ex, ey)] });
        cx = ex; cy = ey;
        break;
      }
      case 'C': {
        const x1 = c.x1 ?? 0, y1 = c.y1 ?? 0, x2 = c.x2 ?? 0, y2 = c.y2 ?? 0, ex = c.x ?? 0, ey = c.y ?? 0;
        segs.push({ points: [p(cx, cy), p(x1, y1), p(x2, y2), p(ex, ey)] });
        cx = ex; cy = ey;
        break;
      }
      case 'Z':
        if (cx !== sx || cy !== sy) {
          segs.push({ points: [p(cx, cy), p(sx, sy)] });
          cx = sx; cy = sy;
        }
        break;
    }
  }
  return segs;
}
