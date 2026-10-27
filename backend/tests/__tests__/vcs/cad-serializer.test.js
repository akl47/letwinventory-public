'use strict';

// REQ 682 (VC-14) — CAD model document <-> content-addressed tree round-trip.
// DB-backed (SQLite via tests/setup.js).

const db = require('../../../models');
const { cadSerialize, cadDeserialize } = require('../../../services/vcs/cadSerializer');

const REPO = { repoType: 'cad', repoId: '1' };

function sampleDoc() {
  return {
    featureTree: {
      features: [
        { id: 'f1', type: 'origin', visibility: { origin: true } },
        { id: 'f2', type: 'extrude', sketchId: 's1', distance: 10 },
        { id: 'f3', type: 'extrude', sketchId: 's2', distance: 5, visible: false },
      ],
      nextFeatureSeq: 4,
    },
    sketchDoc: {
      sketches: {
        s1: { id: 's1', hostId: 'datum:xy_plane', state: { entities: [], constraints: [] } },
        s2: { id: 's2', hostId: 'datum:xz_plane', state: { entities: [{ kind: 'point', id: 'p', x: 0, y: 0 }], constraints: [] } },
      },
      nextSketchSeq: 3,
    },
    equations: { entries: { length: { expression: '100' } } },
  };
}

describe('cadSerializer', () => {
  test('round-trips a document exactly', async () => {
    const doc = sampleDoc();
    const tree = await cadSerialize(REPO, doc);
    const back = await cadDeserialize(REPO, tree);
    expect(back).toEqual(doc);
  });

  test('is deterministic — the same doc yields the same tree hash', async () => {
    const a = await cadSerialize(REPO, sampleDoc());
    const b = await cadSerialize(REPO, sampleDoc());
    expect(b).toBe(a);
  });

  test('preserves feature order', async () => {
    const back = await cadDeserialize(REPO, await cadSerialize(REPO, sampleDoc()));
    expect(back.featureTree.features.map(f => f.id)).toEqual(['f1', 'f2', 'f3']);
  });

  test('structural sharing — editing one feature only adds that blob + a new tree', async () => {
    const doc = sampleDoc();
    await cadSerialize(REPO, doc);
    const before = await db.VcsObject.count({ where: { repoType: 'cad', repoId: '1' } });

    const doc2 = JSON.parse(JSON.stringify(doc));
    doc2.featureTree.features[1].distance = 999; // edit only f2
    await cadSerialize(REPO, doc2);
    const after = await db.VcsObject.count({ where: { repoType: 'cad', repoId: '1' } });

    // Only the changed feature blob + the new tree are new; f1/f3/sketches/
    // equations/meta are all reused by content hash.
    expect(after - before).toBe(2);
  });

  test('handles an empty/default doc', async () => {
    const doc = {
      featureTree: { features: [], nextFeatureSeq: 1 },
      sketchDoc: { sketches: {}, nextSketchSeq: 1 },
      equations: { entries: {} },
    };
    const back = await cadDeserialize(REPO, await cadSerialize(REPO, doc));
    expect(back).toEqual(doc);
  });
});
