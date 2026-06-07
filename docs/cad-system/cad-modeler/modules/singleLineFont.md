# singleLineFont.ts

> **System** ▸ [Overview](../../00-overview.md) ▸ [CAD Modeler](../../10-cad-modeler.md) ▸ [Sketching](../sketching.md) ▸ **singleLineFont.ts**
> Related: [textGlyphs.ts](./textGlyphs.md) · [Sketching group page](../sketching.md) · [Profiles and arrangement](../profiles-arrangement.md)

---

## Requirements

Governed by [Sketching](../sketching.md). REQ 602 covers sketch text in general. `singleLineFont.ts` provides the engraving-style open-stroke variant — it does not contribute closed profiles to the extrude pipeline.

---

## Succinct description

`singleLineFont.ts` is a self-contained, hand-coded single-stroke engraving font covering A–Z, 0–9, space, and common punctuation, defined on a unit em. It produces open polyline strokes rather than closed outlines, so it renders in the sketch overlay but never extrudes into a solid.

---

## How it works — for everyone (non-technical)

A regular font draws filled letter shapes. An engraving font (used on CNC machines or laser engravers) draws only the center line of each stroke — the path the cutting tool follows. This module provides that center-line version: light, simple, fast, and zero network dependency. The tradeoff is that engraving text cannot be pushed into 3D; only the filled-outline version (in `textGlyphs.ts`) can extrude.

---

## How it works — in detail (technical)

### Exported types and functions

- `Stroke` — `Array<[number, number]>` — a single open polyline (x, y pairs).
- `singleLineStrokesForText(text, anchor, capHeightMm, alignment, boxWidthMm): Stroke[]` — the single exported function. Returns all strokes for the string laid out within the box.

### Glyph table

`GLYPHS: Record<string, Glyph>` where `Glyph = { advance: number; strokes: Stroke[] }`. Glyphs are defined on a **unit em**: x in `[0, advance]`, y from `0` (baseline) to `1` (cap height). Each glyph provides one or more open polylines. Lowercase input maps to the uppercase glyph (`GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()]`). Unknown characters consume `0.5 em` of advance with no strokes.

Coverage: A–Z, 0–9, space, `.`, `,`, `-`, `_`, `:`, `/`, `#`. Default advance `W = 0.62` for most letters and digits; exceptions: I (0.3), M (0.72), W (0.8).

### Layout

`singleLineStrokesForText` computes:
1. **Natural width in em:** sum of `advance + gap` (gap = 0.12 em) for all characters.
2. **X offset** for alignment (`left` = 0, `center` = half remaining space, `right` = full remaining space).
3. **Per-glyph coordinates:** scaled from unit em → mm by `capHeightMm`, then translated by `anchor + offsetX + penEm * capHeightMm`. Layout stops when `penEm * capHeightMm > boxWidthMm` (overflow clip).

Strokes are emitted as absolute `[x, y]` pairs in sketch coordinates (mm, baseline at `anchor.y`, +y up).

### Relationship to textGlyphs.ts

Both modules share the same layout conventions (baseline at anchor, +y up, capHeight mapping, alignment/overflow logic). The difference is the output:
- `singleLineFont.ts` → open `Stroke[]` polylines (visible but never extrudable)
- `textGlyphs.ts` → closed `GlyphLoop[]` or `GlyphBezierLoop[]` (extrudable via Roboto TTF)

The sketch editor selects which to use based on the `TextEntity.fontMode` field (or equivalent flag — `singleLineFont` for engraving style, `outline` for solid extrude style).

---

## Key files

- `frontend/src/app/cad/lib/singleLineFont.ts` — this module (no spec file; coverage via the sketch overlay integration)
- `frontend/src/app/cad/lib/textGlyphs.ts` — the closed-outline companion for extrudable text
