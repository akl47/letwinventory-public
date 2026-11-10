// Unit tests for `_danglingHostFaceWarnings` — host-face resolution + dangling
// detection that drives the editor's 3D host-face highlight and the tree's
// "reference face missing" indicator.
//
// A face-hosted sketch stores a structured persistent face NAME in `hostId`
// (`face:{...json...}`), which rarely matches a current geometry faceId
// verbatim. Resolution therefore falls back to the nearest coincident parallel
// face in the regen-wide faceMap, returning that face's id for the highlight.
// When no coincident face exists, the host is "gone" and the sketch is flagged.

const { _danglingHostFaceWarnings } = require('../../../services/cadRegenService');

const NORMAL_Z = [0, 0, 1];

function faceHostedSketch(name, originZ) {
  return {
    name,
    hostId: `face:{"feature_id":"f1#0","role":"cap-top","sub_index":0}`,
    plane: { origin: [0, 0, originZ], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: NORMAL_Z },
  };
}

// faceMap value shape used by the resolver: { normal, centroid } (+ others).
function faceEntry(centroidZ) {
  return { normal: NORMAL_Z, centroid: [0, 0, centroidZ] };
}

describe('_danglingHostFaceWarnings', () => {
  test('resolves a present host face to the coincident faceId (no warning)', () => {
    const sketchDoc = { sketches: { sA: faceHostedSketch('Sketch A', 5) } };
    const faceMap = new Map([
      ['face-top-id', faceEntry(5)],   // coincident with the sketch plane
      ['face-bot-id', faceEntry(0)],   // parallel but offset — wrong distance
    ]);
    const out = _danglingHostFaceWarnings(sketchDoc, faceMap, new Set(['sA']));
    expect(out.resolved).toEqual({ sA: 'face-top-id' });
    expect(out.sketchIds).toEqual([]);
    expect(out.warnings).toEqual([]);
  });

  test('ignores an exact host-id hit that is no longer parallel (positional id reshuffle)', () => {
    const sk = faceHostedSketch('Sketch A', 5);
    const hostKey = sk.hostId.slice('face:'.length);
    const sketchDoc = { sketches: { sA: sk } };
    const faceMap = new Map([
      [hostKey, { normal: [0, -1, 0], centroid: [0, 0, 3] }],  // same id, now a side wall
      ['face-top-id', faceEntry(5)],
    ]);
    const out = _danglingHostFaceWarnings(sketchDoc, faceMap, new Set(['sA']));
    expect(out.resolved).toEqual({ sA: 'face-top-id' });
    expect(out.warnings).toEqual([]);
  });

  test('a host face split by a later op resolves to one of its pieces (REQ 1036)', () => {
    const sk = faceHostedSketch('Sketch A', 5);
    const piece = sk.hostId.slice('face:'.length).replace('"sub_index":0', '"sub_index":0,"split":"1"');
    const faceMap = new Map([
      ['unrelated-coplanar', faceEntry(5)],  // the geometric fallback would take this one
      [piece, { ...faceEntry(5), faceId: piece }],
    ]);
    const out = _danglingHostFaceWarnings({ sketches: { sA: sk } }, faceMap, new Set(['sA']));
    expect(out.resolved).toEqual({ sA: piece });
  });

  test('a legacy positional host id resolves to the stable id it maps to (REQ 1039)', () => {
    const sk = faceHostedSketch('Sketch A', 5);
    const legacy = sk.hostId.slice('face:'.length);
    const entry = { ...faceEntry(5), faceId: 'stable-top' };
    const faceMap = new Map([['stable-top', entry], [legacy, entry]]);
    const out = _danglingHostFaceWarnings({ sketches: { sA: sk } }, faceMap, new Set(['sA']));
    expect(out.resolved).toEqual({ sA: 'stable-top' });
  });

  test('flags a sketch whose host face has no coincident match (dangling)', () => {
    const sketchDoc = { sketches: { sA: faceHostedSketch('Sketch A', 20) } };
    const faceMap = new Map([
      ['face-top-id', faceEntry(5)],   // parallel but 15 units away
    ]);
    const out = _danglingHostFaceWarnings(sketchDoc, faceMap, new Set(['sA']));
    expect(out.resolved).toEqual({});
    expect(out.sketchIds).toEqual(['sA']);
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toMatch(/lost its reference face/);
  });

  test('flags an UNUSED dangling sketch on its row but emits no toast warning', () => {
    const sketchDoc = { sketches: { sA: faceHostedSketch('Sketch A', 20) } };
    const faceMap = new Map([['face-top-id', faceEntry(5)]]);
    const out = _danglingHostFaceWarnings(sketchDoc, faceMap, new Set()); // not used
    expect(out.sketchIds).toEqual(['sA']);   // row indicator still shows
    expect(out.warnings).toEqual([]);        // but no noisy toast
  });

  test('ignores datum-hosted sketches entirely', () => {
    const sketchDoc = {
      sketches: { sD: { name: 'D', hostId: 'datum:xy_plane', plane: { origin: [0, 0, 0], normal: NORMAL_Z } } },
    };
    const faceMap = new Map([['face-top-id', faceEntry(5)]]);
    const out = _danglingHostFaceWarnings(sketchDoc, faceMap, new Set(['sD']));
    expect(out.resolved).toEqual({});
    expect(out.sketchIds).toEqual([]);
    expect(out.warnings).toEqual([]);
  });

  test('reports nothing when there is no geometry to compare against', () => {
    const sketchDoc = { sketches: { sA: faceHostedSketch('Sketch A', 5) } };
    const out = _danglingHostFaceWarnings(sketchDoc, new Map(), new Set(['sA']));
    expect(out.resolved).toEqual({});
    expect(out.sketchIds).toEqual([]);
    expect(out.warnings).toEqual([]);
  });
});
