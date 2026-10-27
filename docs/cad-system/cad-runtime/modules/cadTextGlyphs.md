# cadTextGlyphs — Text Glyph Tessellator

> **System** ▸ [Overview](../../00-overview.md) ▸ [CAD Modeler](../../10-cad-modeler.md) ▸ [Regeneration Pipeline](../regen-pipeline.md) ▸ **cadTextGlyphs**
> Related: [cadProfile](./cadProfile.md)

---

## Requirements

| REQ | Status | Summary |
|-----|--------|---------|
| 602 | unapproved | Text tool — user picks an anchor, types a string, selects a font; result is a sketch text entity that can be extruded |

### REQ 602 — Text tool

- **Description:** The sketcher shall provide a Text tool: the user picks an anchor point, types a text string, and selects a font; the result is a text sketch entity that can be extruded, cut, or engraved on a face.
- **Rationale:** Embossed or engraved part labels, serial numbers, and markings are a routine manufacturing requirement.
- **Verification:** Test — `backend/tests/__tests__/design/cad-text-glyphs.test.js` pins a sample string's Bézier loop output against the frontend's `textGlyphs.spec.ts` fixture to guard against drift.
- **Validation:** A designer can type a part number, extrude it, and produce a solid with legible raised lettering matching the on-screen preview.

---

## Succinct description

`cadTextGlyphs.js` is the server-side port of `frontend/src/app/cad/lib/textGlyphs.ts`. It parses Roboto glyph outlines via `opentype.js` and converts them into closed Bézier-segment loops in sketch coordinates, so the profile extractor (`cadProfile.js`) can include text in extrude profiles.

## How it works — for everyone (non-technical)

When a designer places a text sketch entity and extrudes it, the server needs to know the exact shape of each letter. This module reads the Roboto font file and traces the outline of each character as a sequence of curves — the same mathematical curves the browser's canvas renderer uses. The result is handed to the geometry engine, which builds a smooth-faced solid for every letter.

## How it works — in detail (technical)

### Exports

```javascript
module.exports = { loopsFromTextEntity, bezierLoopsFromTextEntity };
```

The font is loaded synchronously at module init from `backend/assets/fonts/Roboto-Regular.ttf` via `opentype.js`. If the file is missing, `font` remains `null` and both exports return `[]` — regen degrades to "text contributes no geometry" rather than crashing.

### `bezierLoopsFromTextEntity(state, e, resolve?) → Array<Array<{points}>>`

Primary export consumed by `cadProfile.js#extractClosedLoops`. Returns an array of contours; each contour is an ordered list of Bézier segments `{ points: [{x,y},...] }` (2 points = line, 3 = quadratic, 4 = cubic). These feed the kernel's `Edge::bezier` path so each glyph curve becomes one smooth OCCT edge — not a polyline approximation.

Steps:

1. Validates the text entity's `cornerIds` (4 ids for bottom-left, bottom-right, top-right, top-left corners).
2. Resolves `e.text` through the `resolve` callback (expands `#{var}` placeholders).
3. Calls `tessellateBezier(text, anchor, boxH, justify, boxW)` to lay out glyphs and produce contours in box-local coordinates.
4. Calls `applyTextBezierTransform(contours, bl, br, tl, ...)` to rotate/mirror the contours onto the actual box basis in sketch coordinates.

### `tessellateBezier(text, anchor, capHeightMm, alignment, boxWidthMm)`

For each character:

- Derives `scale = capHeightMm / capHeightOf(font)` (`capHeightOf` returns `os2.sCapHeight || font.ascender`).
- Calls `font.getPaths(text, ...)` with `kerning: true` to get per-glyph path objects.
- Calls `pathToSubpaths(p)` then `subpathToBezierSegs(commands, scale)` to emit one `{ points }` segment per M/L/Q/C command. The `Z` close command emits a closing line segment only when the current point differs from the subpath start.
- Applies `alignment` (`left`/`center`/`right`) as an `offsetX`.
- Clips at `boxWidthMm` — characters starting past the right edge are dropped.
- Y is flipped (`anchor.y - pt.y`) to convert from font coordinates (Y up) to sketch coordinates (Y up with origin at bottom-left).

### `loopsFromTextEntity(state, e, resolve?)`

Legacy export returning polyline loops (chord-tolerance sampled). Kept for callers that don't need analytic Bézier curves.

### Sync requirement with the frontend

The two tessellators (`cadTextGlyphs.js` and `textGlyphs.ts`) must produce byte-identical loops. Both use the same `Roboto-Regular.ttf` file, the same `opentype.js` version, the same scale formula, the same Bézier segment counts (Q=12 per quadrant, C=16 per quadrant in the polyline path), and the same y-flip. The drift guard in `backend/tests/__tests__/design/cad-text-glyphs.test.js` pins a sample string's output against the frontend fixture.

---

## Key files

- `backend/services/cadTextGlyphs.js` — this module
- `backend/assets/fonts/Roboto-Regular.ttf` — the font file (must match the frontend copy exactly)
- `frontend/src/app/cad/lib/textGlyphs.ts` — frontend mirror (must stay in sync)
- `backend/services/cadProfile.js` — calls `bezierLoopsFromTextEntity` from `extractClosedLoops`
