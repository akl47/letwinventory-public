// Single-stroke ("single line") engraving font — open centreline strokes, the
// kind used for V-carving / engraving where the tool follows the stroke rather
// than filling a closed outline. Because the strokes are OPEN (not closed
// regions), single-line text renders in the sketch but does NOT extrude into a
// solid; the profile extractor skips it (see profile.ts / cadProfile.js).
//
// Glyphs are defined on a unit em: x in [0, advance], y from 0 (baseline) to
// 1 (cap height). Each glyph is a list of open polylines (strokes). Coverage:
// A–Z, 0–9, space, and common punctuation; lowercase maps to uppercase.

export type Stroke = Array<[number, number]>;
interface Glyph { advance: number; strokes: Stroke[]; }

const W = 0.62;          // default advance for letters/digits
const G = (advance: number, strokes: Stroke[]): Glyph => ({ advance, strokes });

// Hand-built single-stroke forms. Legibility over beauty.
const GLYPHS: Record<string, Glyph> = {
  ' ': G(0.5, []),
  'A': G(W, [[[0, 0], [0.31, 1], [0.62, 0]], [[0.12, 0.38], [0.5, 0.38]]]),
  'B': G(W, [[[0, 0], [0, 1], [0.42, 1], [0.55, 0.86], [0.55, 0.64], [0.42, 0.5], [0, 0.5], [0.46, 0.5], [0.6, 0.34], [0.6, 0.16], [0.46, 0], [0, 0]]]),
  'C': G(W, [[[0.6, 0.82], [0.42, 1], [0.18, 1], [0, 0.78], [0, 0.22], [0.18, 0], [0.42, 0], [0.6, 0.18]]]),
  'D': G(W, [[[0, 0], [0, 1], [0.36, 1], [0.6, 0.74], [0.6, 0.26], [0.36, 0], [0, 0]]]),
  'E': G(W, [[[0.58, 1], [0, 1], [0, 0], [0.58, 0]], [[0, 0.5], [0.44, 0.5]]]),
  'F': G(W, [[[0.58, 1], [0, 1], [0, 0]], [[0, 0.5], [0.44, 0.5]]]),
  'G': G(W, [[[0.6, 0.82], [0.42, 1], [0.18, 1], [0, 0.78], [0, 0.22], [0.18, 0], [0.42, 0], [0.6, 0.18], [0.6, 0.46], [0.34, 0.46]]]),
  'H': G(W, [[[0, 1], [0, 0]], [[0.6, 1], [0.6, 0]], [[0, 0.5], [0.6, 0.5]]]),
  'I': G(0.3, [[[0.15, 1], [0.15, 0]], [[0, 1], [0.3, 1]], [[0, 0], [0.3, 0]]]),
  'J': G(W, [[[0.5, 1], [0.5, 0.2], [0.34, 0], [0.14, 0], [0, 0.2]]]),
  'K': G(W, [[[0, 1], [0, 0]], [[0.58, 1], [0, 0.46]], [[0.2, 0.62], [0.6, 0]]]),
  'L': G(W, [[[0, 1], [0, 0], [0.56, 0]]]),
  'M': G(0.72, [[[0, 0], [0, 1], [0.36, 0.5], [0.72, 1], [0.72, 0]]]),
  'N': G(W, [[[0, 0], [0, 1], [0.6, 0], [0.6, 1]]]),
  'O': G(W, [[[0.18, 1], [0.42, 1], [0.6, 0.78], [0.6, 0.22], [0.42, 0], [0.18, 0], [0, 0.22], [0, 0.78], [0.18, 1]]]),
  'P': G(W, [[[0, 0], [0, 1], [0.42, 1], [0.58, 0.84], [0.58, 0.64], [0.42, 0.48], [0, 0.48]]]),
  'Q': G(W, [[[0.18, 1], [0.42, 1], [0.6, 0.78], [0.6, 0.22], [0.42, 0], [0.18, 0], [0, 0.22], [0, 0.78], [0.18, 1]], [[0.38, 0.26], [0.62, 0]]]),
  'R': G(W, [[[0, 0], [0, 1], [0.42, 1], [0.58, 0.84], [0.58, 0.64], [0.42, 0.48], [0, 0.48]], [[0.28, 0.48], [0.6, 0]]]),
  'S': G(W, [[[0.6, 0.84], [0.42, 1], [0.18, 1], [0, 0.84], [0, 0.66], [0.18, 0.5], [0.42, 0.5], [0.6, 0.34], [0.6, 0.16], [0.42, 0], [0.18, 0], [0, 0.16]]]),
  'T': G(W, [[[0.31, 0], [0.31, 1]], [[0, 1], [0.62, 1]]]),
  'U': G(W, [[[0, 1], [0, 0.2], [0.18, 0], [0.42, 0], [0.6, 0.2], [0.6, 1]]]),
  'V': G(W, [[[0, 1], [0.31, 0], [0.62, 1]]]),
  'W': G(0.8, [[[0, 1], [0.2, 0], [0.4, 0.6], [0.6, 0], [0.8, 1]]]),
  'X': G(W, [[[0, 0], [0.6, 1]], [[0, 1], [0.6, 0]]]),
  'Y': G(W, [[[0, 1], [0.31, 0.5], [0.62, 1]], [[0.31, 0.5], [0.31, 0]]]),
  'Z': G(W, [[[0, 1], [0.6, 1], [0, 0], [0.6, 0]]]),
  '0': G(W, [[[0.18, 1], [0.42, 1], [0.6, 0.78], [0.6, 0.22], [0.42, 0], [0.18, 0], [0, 0.22], [0, 0.78], [0.18, 1]], [[0.6, 0.78], [0, 0.22]]]),
  '1': G(0.4, [[[0.08, 0.8], [0.28, 1], [0.28, 0]], [[0, 0], [0.4, 0]]]),
  '2': G(W, [[[0, 0.82], [0.18, 1], [0.42, 1], [0.6, 0.82], [0.6, 0.64], [0, 0], [0.6, 0]]]),
  '3': G(W, [[[0, 0.84], [0.18, 1], [0.42, 1], [0.6, 0.84], [0.6, 0.66], [0.42, 0.5], [0.18, 0.5]], [[0.42, 0.5], [0.6, 0.34], [0.6, 0.16], [0.42, 0], [0.18, 0], [0, 0.16]]]),
  '4': G(W, [[[0.44, 0], [0.44, 1], [0, 0.36], [0.6, 0.36]]]),
  '5': G(W, [[[0.58, 1], [0.08, 1], [0.04, 0.56], [0.22, 0.64], [0.42, 0.64], [0.6, 0.48], [0.6, 0.16], [0.42, 0], [0.18, 0], [0, 0.16]]]),
  '6': G(W, [[[0.56, 0.86], [0.4, 1], [0.18, 1], [0, 0.74], [0, 0.18], [0.18, 0], [0.42, 0], [0.6, 0.18], [0.6, 0.34], [0.42, 0.5], [0.18, 0.5], [0, 0.36]]]),
  '7': G(W, [[[0, 1], [0.6, 1], [0.22, 0]]]),
  '8': G(W, [[[0.18, 0.5], [0, 0.66], [0, 0.84], [0.18, 1], [0.42, 1], [0.6, 0.84], [0.6, 0.66], [0.42, 0.5], [0.18, 0.5], [0, 0.34], [0, 0.16], [0.18, 0], [0.42, 0], [0.6, 0.16], [0.6, 0.34], [0.42, 0.5]]]),
  '9': G(W, [[[0.04, 0.14], [0.2, 0], [0.42, 0], [0.6, 0.26], [0.6, 0.82], [0.42, 1], [0.18, 1], [0, 0.82], [0, 0.66], [0.18, 0.5], [0.42, 0.5], [0.6, 0.64]]]),
  '.': G(0.3, [[[0.13, 0.04], [0.17, 0.04]]]),
  ',': G(0.3, [[[0.17, 0.06], [0.1, -0.12]]]),
  '-': G(0.5, [[[0.08, 0.5], [0.42, 0.5]]]),
  '_': G(0.62, [[[0, 0], [0.62, 0]]]),
  ':': G(0.3, [[[0.13, 0.62], [0.17, 0.62]], [[0.13, 0.18], [0.17, 0.18]]]),
  '/': G(0.5, [[[0, 0], [0.5, 1]]]),
  '#': G(0.7, [[[0.18, 0], [0.28, 1]], [[0.42, 0], [0.52, 1]], [[0.08, 0.32], [0.62, 0.32]], [[0.08, 0.68], [0.62, 0.68]]]),
};

/** Open stroke polylines for `text` in sketch coords, laid out left→right with
 * cap height == capHeightMm, justified within boxWidthMm. Mirrors the layout
 * of the outline engine (baseline at anchor, +x right, +y up). */
export function singleLineStrokesForText(
  text: string,
  anchor: { x: number; y: number },
  capHeightMm: number,
  alignment: 'left' | 'center' | 'right',
  boxWidthMm: number,
): Stroke[] {
  if (!text) return [];
  const gap = 0.12;  // inter-glyph spacing in em
  const glyphsOf = (ch: string): Glyph | null => GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()] ?? null;
  // Natural width in em.
  let naturalEm = 0;
  for (const ch of text) {
    const g = glyphsOf(ch);
    naturalEm += (g ? g.advance : 0.5) + gap;
  }
  if (naturalEm > 0) naturalEm -= gap;
  const naturalMm = naturalEm * capHeightMm;
  const offsetX =
    alignment === 'right'  ? boxWidthMm - Math.min(boxWidthMm, naturalMm) :
    alignment === 'center' ? (boxWidthMm - Math.min(boxWidthMm, naturalMm)) / 2 :
                             0;
  const out: Stroke[] = [];
  let penEm = 0;
  for (const ch of text) {
    const g = glyphsOf(ch);
    if (penEm * capHeightMm > boxWidthMm + 1e-3) break;
    if (g) {
      for (const stroke of g.strokes) {
        out.push(stroke.map(([sx, sy]): [number, number] => [
          anchor.x + offsetX + (penEm + sx) * capHeightMm,
          anchor.y + sy * capHeightMm,
        ]));
      }
      penEm += g.advance + gap;
    } else {
      penEm += 0.5 + gap;
    }
  }
  return out;
}
