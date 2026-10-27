'use strict';

// Server-side port of `frontend/src/app/cad/lib/textGlyphs.ts`. Tessellates
// Roboto glyph outlines into closed loops so the server's profile extractor
// (`cadProfile.js`) can turn sketch text into real extrudable geometry on
// commit/regen — matching what the frontend preview draws.
//
// ── KEEP IN SYNC WITH frontend/src/app/cad/lib/textGlyphs.ts ──
// The two tessellators MUST produce byte-for-byte identical loops or the
// in-browser preview and the committed solid will diverge. Same font (the
// SAME Roboto-Regular.ttf, copied into backend/assets/fonts), same opentype.js
// version, same scale (capHeight/ascender), same kerning, same Bézier segment
// counts (Q=12, C=16), same y-flip. The `cad-text-glyphs.test.js` drift guard
// pins a sample string against the frontend's `textGlyphs.spec.ts`.

const fs = require('fs');
const path = require('path');
const opentype = require('opentype.js');

const FONT_PATH = path.join(__dirname, '..', 'assets', 'fonts', 'Roboto-Regular.ttf');

/** Parsed Roboto, loaded once at module init. Synchronous — this is a server
 * process, the font is on local disk. Null only if the file is missing. */
let font = null;
try {
  const buf = fs.readFileSync(FONT_PATH);
  // opentype.parse wants an ArrayBuffer; slice to the Buffer's exact view.
  font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
} catch (err) {
  // Leave font null; loopsFromTextEntity returns [] so a missing font
  // degrades to "text contributes no geometry" rather than crashing regen.
  // eslint-disable-next-line no-console
  console.error(`[cadTextGlyphs] failed to load Roboto from ${FONT_PATH}:`, err.message);
}

const IDENTITY_RESOLVER = (s) => s;

/** Cap height in font units — KEEP IN SYNC with textGlyphs.ts `capHeightOf`. */
function capHeightOf(f) {
  const os2 = f.tables && f.tables.os2;
  return (os2 && os2.sCapHeight) || f.ascender;
}

/** Map an axis-aligned box-local glyph point onto the box's actual basis
 * (xAxis = bl→br, yAxis = bl→tl), optionally mirrored. Identity for an
 * axis-aligned box. This is how rotated text follows its rotated box — the
 * corners carry the rotation. KEEP IN SYNC with textGlyphs.ts `mapToBoxBasis`. */
function mapToBoxBasis(p, bl, axx, axy, ayx, ayy, boxW, mirror) {
  let lx = p.x - bl.x;
  const ly = p.y - bl.y;
  if (mirror) lx = boxW - lx;
  return { x: bl.x + lx * axx + ly * ayx, y: bl.y + lx * axy + ly * ayy };
}

function isAxisAligned(axx, axy, ayx, ayy) {
  return Math.abs(axx - 1) < 1e-9 && Math.abs(axy) < 1e-9
      && Math.abs(ayx) < 1e-9 && Math.abs(ayy - 1) < 1e-9;
}

/** Map Bézier control-point contours onto the box basis (rotation/mirror). */
function applyTextBezierTransform(contours, bl, br, tl, boxW, boxH, mirror) {
  const axx = (br.x - bl.x) / boxW, axy = (br.y - bl.y) / boxW;
  const ayx = (tl.x - bl.x) / boxH, ayy = (tl.y - bl.y) / boxH;
  if (!mirror && isAxisAligned(axx, axy, ayx, ayy)) return contours;
  return contours.map((c) => c.map((seg) => ({
    points: seg.points.map((p) => mapToBoxBasis(p, bl, axx, axy, ayx, ayy, boxW, mirror)),
  })));
}

/**
 * Convert a text sketch entity into closed glyph loops in sketch coords.
 * Mirrors `loopsFromTextEntity` in textGlyphs.ts.
 *
 * @param {object} state sketch state ({entities, constraints})
 * @param {object} e text entity ({kind:'text', text, cornerIds:[bl,br,tr,tl], justify?})
 * @param {(raw:string)=>string} [resolve] expands `#{var}` placeholders
 * @returns {Array<Array<{x:number,y:number}>>}
 */
function loopsFromTextEntity(state, e, resolve = IDENTITY_RESOLVER) {
  if (!font) return [];
  if (!e.cornerIds || e.cornerIds.length !== 4) return [];
  const [blId, brId, , tlId] = e.cornerIds;
  const ents = state.entities;
  const bl = ents.find((p) => p.id === blId && p.kind === 'point');
  const br = ents.find((p) => p.id === brId && p.kind === 'point');
  const tl = ents.find((p) => p.id === tlId && p.kind === 'point');
  if (!bl || !br || !tl) return [];
  const boxW = Math.hypot(br.x - bl.x, br.y - bl.y);
  const boxH = Math.hypot(tl.x - bl.x, tl.y - bl.y);
  if (boxW < 1e-6 || boxH < 1e-6) return [];
  const text = resolve(e.text || '');
  return tessellate(text, { x: bl.x, y: bl.y }, boxH, e.justify || 'left', boxW);
}

/**
 * TextEntity → analytic Bézier contours in sketch coords. Mirrors
 * `bezierLoopsFromTextEntity` in textGlyphs.ts. Each contour is an ordered
 * list of segments; each segment's `points` are control points (2 = line,
 * 3 = quadratic, 4 = cubic). Feeds the kernel's Edge::bezier path so each
 * glyph curve is ONE smooth face.
 *
 * @returns {Array<Array<{points: Array<{x:number,y:number}>}>>}
 */
function bezierLoopsFromTextEntity(state, e, resolve = IDENTITY_RESOLVER) {
  if (!font) return [];
  if (!e.cornerIds || e.cornerIds.length !== 4) return [];
  const [blId, brId, , tlId] = e.cornerIds;
  const ents = state.entities;
  const bl = ents.find((p) => p.id === blId && p.kind === 'point');
  const br = ents.find((p) => p.id === brId && p.kind === 'point');
  const tl = ents.find((p) => p.id === tlId && p.kind === 'point');
  if (!bl || !br || !tl) return [];
  const boxW = Math.hypot(br.x - bl.x, br.y - bl.y);
  const boxH = Math.hypot(tl.x - bl.x, tl.y - bl.y);
  if (boxW < 1e-6 || boxH < 1e-6) return [];
  const text = resolve(e.text || '');
  const contours = tessellateBezier(text, { x: bl.x, y: bl.y }, boxH, e.justify || 'left', boxW);
  return applyTextBezierTransform(contours, bl, br, tl, boxW, boxH, !!e.mirror);
}

/** Bézier-segment layout — same math as `tessellate` but emits control-point
 * segments per contour. KEEP IN SYNC with textGlyphs.ts `_tessellateBezier`. */
function tessellateBezier(text, anchor, capHeightMm, alignment, boxWidthMm) {
  if (!font || !text) return [];
  const scale = capHeightMm / capHeightOf(font);
  const pxAdvance = font.getAdvanceWidth(text, font.unitsPerEm, { kerning: true });
  const naturalMm = pxAdvance * scale;
  const offsetX =
    alignment === 'right' ? boxWidthMm - Math.min(boxWidthMm, naturalMm) :
    alignment === 'center' ? (boxWidthMm - Math.min(boxWidthMm, naturalMm)) / 2 :
      0;
  const out = [];
  const paths = font.getPaths(text, 0, 0, font.unitsPerEm, { kerning: true });
  let advance = 0;
  for (let i = 0; i < text.length; i++) {
    const glyph = font.charToGlyph(text[i]);
    const p = paths[i];
    if (!p) { advance += (glyph.advanceWidth || 0) * scale; continue; }
    if (advance > boxWidthMm + 1e-3) break;
    for (const sp of pathToSubpaths(p)) {
      const segs = subpathToBezierSegs(sp, scale);
      if (segs.length === 0) continue;
      out.push(segs.map((s) => ({
        points: s.points.map((pt) => ({ x: anchor.x + offsetX + pt.x, y: anchor.y - pt.y })),
      })));
    }
    advance += (glyph.advanceWidth || 0) * scale;
  }
  return out;
}

/** Emit one Bézier segment per path command (control points in scaled glyph
 * units). KEEP IN SYNC with textGlyphs.ts `subpathToBezierSegs`. */
function subpathToBezierSegs(commands, scale) {
  if (commands.length === 0) return [];
  const segs = [];
  let cx = 0, cy = 0, sx = 0, sy = 0;
  const p = (x, y) => ({ x: x * scale, y: y * scale });
  for (const c of commands) {
    switch (c.type) {
      case 'M': cx = c.x || 0; cy = c.y || 0; sx = cx; sy = cy; break;
      case 'L': segs.push({ points: [p(cx, cy), p(c.x || 0, c.y || 0)] }); cx = c.x || 0; cy = c.y || 0; break;
      case 'Q':
        segs.push({ points: [p(cx, cy), p(c.x1 || 0, c.y1 || 0), p(c.x || 0, c.y || 0)] });
        cx = c.x || 0; cy = c.y || 0;
        break;
      case 'C':
        segs.push({ points: [p(cx, cy), p(c.x1 || 0, c.y1 || 0), p(c.x2 || 0, c.y2 || 0), p(c.x || 0, c.y || 0)] });
        cx = c.x || 0; cy = c.y || 0;
        break;
      case 'Z':
        if (cx !== sx || cy !== sy) { segs.push({ points: [p(cx, cy), p(sx, sy)] }); cx = sx; cy = sy; }
        break;
      default: break;
    }
  }
  return segs;
}

/** Core tessellation — identical math to textGlyphs.ts `_tessellate`. */
function tessellate(text, anchor, capHeightMm, alignment, boxWidthMm) {
  if (!font || !text) return [];
  const scale = capHeightMm / capHeightOf(font);
  const pxAdvance = font.getAdvanceWidth(text, font.unitsPerEm, { kerning: true });
  const naturalMm = pxAdvance * scale;
  const offsetX =
    alignment === 'right' ? boxWidthMm - Math.min(boxWidthMm, naturalMm) :
    alignment === 'center' ? (boxWidthMm - Math.min(boxWidthMm, naturalMm)) / 2 :
      0;
  const out = [];
  // getPaths lays the whole string out horizontally WITH kerning, so each
  // path's coords are already the glyph's absolute position — do NOT add a
  // per-glyph advance again. `advance` is tracked only for the overflow clamp.
  const paths = font.getPaths(text, 0, 0, font.unitsPerEm, { kerning: true });
  let advance = 0;
  for (let i = 0; i < text.length; i++) {
    const glyph = font.charToGlyph(text[i]);
    const p = paths[i];
    if (!p) { advance += (glyph.advanceWidth || 0) * scale; continue; }
    if (advance > boxWidthMm + 1e-3) break;
    const subpaths = pathToSubpaths(p);
    for (const sp of subpaths) {
      const tess = tessellateSubpath(sp, scale);
      if (tess.length >= 3) {
        const loop = tess.map((pt) => ({ x: anchor.x + offsetX + pt.x, y: anchor.y - pt.y }));
        out.push(loop);
      }
    }
    advance += (glyph.advanceWidth || 0) * scale;
  }
  return out;
}

/** Split a Path into sub-paths (each starts with a MoveTo). */
function pathToSubpaths(p) {
  const out = [];
  let cur = [];
  for (const c of p.commands) {
    if (c.type === 'M' && cur.length > 0) { out.push(cur); cur = [c]; }
    else cur.push(c);
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

// Adaptive Bézier segmentation — KEEP IN SYNC with textGlyphs.ts. Each segment
// becomes a profile line edge → one side face on extrude, so we scale segment
// count to the curve's control-polygon length in mm against a target chord.
const GLYPH_CHORD_MM = 0.35;
const GLYPH_MIN_SEGS = 2;
const GLYPH_MAX_SEGS = 16;
function adaptiveSegs(ctrlLenFontUnits, scale) {
  const n = Math.ceil((ctrlLenFontUnits * scale) / GLYPH_CHORD_MM);
  return Math.max(GLYPH_MIN_SEGS, Math.min(GLYPH_MAX_SEGS, n));
}

/** Tessellate one sub-path into a closed polyline (font units → mm via scale). */
function tessellateSubpath(commands, scale) {
  if (commands.length === 0) return [];
  const out = [];
  let cx = 0, cy = 0;
  const push = (x, y) => out.push({ x: x * scale, y: y * scale });
  const hyp = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  for (const c of commands) {
    switch (c.type) {
      case 'M': cx = c.x || 0; cy = c.y || 0; push(cx, cy); break;
      case 'L': cx = c.x || 0; cy = c.y || 0; push(cx, cy); break;
      case 'Q': {
        const x1 = c.x1 || 0, y1 = c.y1 || 0, xe = c.x || 0, ye = c.y || 0;
        const segs = adaptiveSegs(hyp(cx, cy, x1, y1) + hyp(x1, y1, xe, ye), scale);
        for (let s = 1; s <= segs; s++) {
          const t = s / segs, it = 1 - t;
          push(it * it * cx + 2 * it * t * x1 + t * t * xe,
            it * it * cy + 2 * it * t * y1 + t * t * ye);
        }
        cx = xe; cy = ye;
        break;
      }
      case 'C': {
        const x1 = c.x1 || 0, y1 = c.y1 || 0, x2 = c.x2 || 0, y2 = c.y2 || 0;
        const xe = c.x || 0, ye = c.y || 0;
        const segs = adaptiveSegs(
          hyp(cx, cy, x1, y1) + hyp(x1, y1, x2, y2) + hyp(x2, y2, xe, ye), scale);
        for (let s = 1; s <= segs; s++) {
          const t = s / segs, it = 1 - t;
          push(
            it * it * it * cx + 3 * it * it * t * x1 + 3 * it * t * t * x2 + t * t * t * xe,
            it * it * it * cy + 3 * it * it * t * y1 + 3 * it * t * t * y2 + t * t * t * ye);
        }
        cx = xe; cy = ye;
        break;
      }
      case 'Z':
        if (out.length > 0 && (out[0].x !== out[out.length - 1].x || out[0].y !== out[out.length - 1].y)) {
          out.push(out[0]);
        }
        break;
      default: break;
    }
  }
  return out;
}

module.exports = {
  loopsFromTextEntity,
  bezierLoopsFromTextEntity,
  // exported for the drift-guard test
  _tessellate: tessellate,
  _tessellateBezier: tessellateBezier,
  _fontLoaded: () => font !== null,
};
