// Regression: a multi-region extrude/cut routes through extractMergedRegions
// (the profile-merge path). For DISJOINT standalone loops — text glyphs, in
// particular — that path must preserve each selected region's holes (a letter's
// counter). It previously rebuilt holes only from the SELECTED loop set, so a
// glyph's counter (never itself in the selection) was dropped and the letter
// extruded solid — the "the holes got filled in" bug.

const { extractRegions, extractMergedRegions } = require('../../../services/cadProfile');

function textBoxState(text, w = 40, h = 10) {
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
      { kind: 'text', id: 't1', text, cornerIds: ['bl', 'br', 'tr', 'tl'], justify: 'left' },
    ],
    constraints: [],
  };
}

describe('extractMergedRegions — hole preservation for text glyphs', () => {
  it('keeps each selected glyph-body region\'s counters (the "AB" letters stay hollow)', () => {
    const state = textBoxState('AB');
    const { regions } = extractRegions(state);

    // Glyph bodies are the regions that carry holes (A: 1 counter, B: 2).
    const bodyIdx = regions.map((r, i) => i).filter(i => regions[i].holes.length > 0);
    expect(bodyIdx.length).toBeGreaterThanOrEqual(2); // A and B bodies

    const expectedHoleCounts = bodyIdx.map(i => regions[i].holes.length).sort();

    const { regions: merged } = extractMergedRegions(state, bodyIdx);
    // One merged region per selected disjoint glyph — NOT fused into one.
    expect(merged.length).toBe(bodyIdx.length);
    // Every counter survives the merge path.
    const mergedHoleCounts = merged.map(r => r.holes.length).sort();
    expect(mergedHoleCounts).toEqual(expectedHoleCounts);
    expect(merged.every(r => r.holes.length > 0)).toBe(true);
  });

  it('a single selected glyph body keeps its hole', () => {
    const state = textBoxState('O');
    const { regions } = extractRegions(state);
    const bodyIdx = regions.map((r, i) => i).filter(i => regions[i].holes.length > 0);
    expect(bodyIdx.length).toBe(1); // the O body

    const { regions: merged } = extractMergedRegions(state, [bodyIdx[0]]);
    expect(merged.length).toBe(1);
    expect(merged[0].holes.length).toBe(1);
  });
});
