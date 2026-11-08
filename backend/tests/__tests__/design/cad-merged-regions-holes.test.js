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

// REQ 994 — fusing edge-adjacent faces (an outer profile + a rectangle drawn
// against its edge) must keep the holes of UNSELECTED standalone loops inside
// the merged outline (mounting-hole circles), not fill them in.
describe('extractMergedRegions — standalone holes inside merged faces', () => {
  it('keeps an unselected circle inside a fused outer + notch region as a hole', () => {
    const pts = [[0, 0], [100, 0], [100, 50], [0, 50], [20, 30], [40, 30], [40, 50], [20, 50]];
    const state = {
      entities: [
        ...pts.map(([x, y], i) => ({ kind: 'point', id: `p${i + 1}`, x, y })),
        ...[[1, 2], [2, 3], [3, 4], [4, 1], [5, 6], [6, 7], [7, 8], [8, 5]]
          .map(([a, b], i) => ({ kind: 'line', id: `l${i + 1}`, startId: `p${a}`, endId: `p${b}` })),
        { kind: 'point', id: 'c', x: 70, y: 20 },
        { kind: 'circle', id: 'hole', centerId: 'c', radius: 5 },
      ],
      constraints: [],
    };
    const { regions } = extractRegions(state);
    const faceIdx = regions.map((r, i) => i).filter(i => regions[i].outer[0].kind !== 'circle');
    expect(faceIdx.length).toBe(2);
    const { regions: merged } = extractMergedRegions(state, faceIdx);
    expect(merged.length).toBe(1);
    expect(merged[0].holes.length).toBe(1);
    expect(merged[0].holes[0][0].kind).toBe('circle');
  });
});

// Part 1490 — a rectangle drawn INSIDE an outline (not touching it) is its own
// face. Selecting the outline AND the inner rectangle must extrude solid
// there, not leave the rectangle as a hole.
describe('extractMergedRegions — selected islands inside a merged outline', () => {
  const rect = (id, x0, y0, x1, y1) => {
    const p = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    return [
      ...p.map(([x, y], i) => ({ kind: 'point', id: `${id}p${i}`, x, y })),
      ...p.map((_, i) => ({ kind: 'line', id: `${id}l${i}`, startId: `${id}p${i}`, endId: `${id}p${(i + 1) % 4}` })),
    ];
  };
  const state = {
    entities: [
      ...rect('o', 0, 0, 100, 50),
      ...rect('n', 20, 30, 40, 50),   // notch on the top edge (adjacent face)
      ...rect('i', 60, 10, 80, 20),   // island, clear of the outline
      { kind: 'point', id: 'c', x: 10, y: 10 },
      { kind: 'circle', id: 'hole', centerId: 'c', radius: 3 },
    ],
    constraints: [],
  };

  it('fills a selected island instead of cutting it as a hole', () => {
    const { regions } = extractRegions(state);
    const faceIdx = regions.map((r, i) => i).filter(i => regions[i].outer[0].kind !== 'circle');
    expect(faceIdx.length).toBe(3);
    const { regions: merged } = extractMergedRegions(state, faceIdx);
    expect(merged.length).toBe(1);
    expect(merged[0].holes.length).toBe(1);
    expect(merged[0].holes[0][0].kind).toBe('circle');
  });

  it('keeps an unselected island as a hole', () => {
    const { regions } = extractRegions(state);
    const island = regions.findIndex(r => r.outer.some(e => e.kind === 'line' && e.start.x === 60));
    const faceIdx = regions.map((r, i) => i).filter(i => regions[i].outer[0].kind !== 'circle' && i !== island);
    const { regions: merged } = extractMergedRegions(state, faceIdx);
    expect(merged.length).toBe(1);
    expect(merged[0].holes.length).toBe(2);
  });
});
