'use strict';

// REQ 1062 — the harness document round-trips through the content-addressed
// store with one blob per element.

const db = require('../../../models');
const vcs = require('../../../services/vcs/vcsService');
const { harnessSerialize, harnessDeserialize } = require('../../../services/vcs/harnessSerializer');

const repo = { repoType: 'harness', repoId: 'serializer-test' };

const doc = () => ({
  name: 'Main Harness',
  description: 'Engine bay',
  harnessData: {
    name: 'Main Harness',
    schemaVersion: 2,
    connectors: [
      { id: 'conn-2', label: 'J2', position: { x: 10, y: 0 } },
      { id: 'conn-1', label: 'J1', position: { x: 0, y: 0 } },
    ],
    cables: [{ id: 'cable-1', label: 'W1', wires: [{ id: 'w1', color: 'Red' }] }],
    components: [],
    connections: [{ id: 'c1', fromConnector: 'conn-1', fromPin: 'p1', toConnector: 'conn-2', toPin: 'p2', waypoints: [{ x: 5, y: 5 }] }],
    subHarnesses: [{ id: 'sub-1', harnessId: 7, position: { x: 50, y: 50 } }],
    groups: [{ id: 'g1', memberOffsets: [] }],
    canvasSettings: { zoom: 1, gridEnabled: true, snapToGrid: true },
  },
});

describe('harnessSerializer', () => {
  it('round-trips a harness document, preserving element order', async () => {
    const treeHash = await harnessSerialize(repo, doc(), db);
    expect(await harnessDeserialize(repo, treeHash, db)).toEqual(doc());
  });

  it('writes one named blob per element plus a meta blob', async () => {
    const tree = await vcs.readTree(repo, await harnessSerialize(repo, doc(), db), db);
    expect(tree.map((e) => e.name).sort()).toEqual([
      'cable:cable-1', 'connection:c1', 'connector:conn-1', 'connector:conn-2', 'meta', 'subharness:sub-1',
    ]);
  });

  it('produces the same tree for the same content and a different one after an edit', async () => {
    const a = await harnessSerialize(repo, doc(), db);
    expect(await harnessSerialize(repo, doc(), db)).toBe(a);
    const edited = doc();
    edited.harnessData.connectors[0].label = 'J9';
    expect(await harnessSerialize(repo, edited, db)).not.toBe(a);
  });

  it('does not version the row-derived revision, release state or part number', async () => {
    const a = await harnessSerialize(repo, doc(), db);
    const echoed = doc();
    Object.assign(echoed.harnessData, { revision: '03', releaseState: 'released', partNumber: 'LET-0001' });
    expect(await harnessSerialize(repo, echoed, db)).toBe(a);
  });

  it('round-trips an empty document', async () => {
    const empty = { name: 'Empty', description: null, harnessData: {} };
    expect(await harnessDeserialize(repo, await harnessSerialize(repo, empty, db), db)).toEqual(empty);
  });
});
