import { describe, it, expect } from 'vitest';
import {
  FEATURE_WALKERS, applyPasteChoices, buildItemsBundle, pasteBundle, planeToPlane, sketchesOf, walkFeature,
} from './clipboardItems';
import { parseBundle, serializeBundle, type ClipboardBundle } from './clipboard';
import type { Feature, FeatureTree, Plane3, Sketch, SketchDocument } from './types';
import type { EquationDoc } from './equations';

const XY: Plane3 = { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] };
const XZ_UP: Plane3 = { origin: [0, 0, 10], xAxis: [1, 0, 0], yAxis: [0, 0, 1], normal: [0, -1, 0] };

const faceOf = (fid: string) => `{"feature_id":"${fid}#0","role":"cap-top","sub_index":0,"upstream_refs":[]}`;

function sketch(id: string, over: Partial<Sketch> = {}): Sketch {
  return {
    id, hostId: 'datum:xy_plane', plane: XY, candidates: [], name: 'Sketch 1', createdAt: 1,
    state: {
      entities: [{ id: 'p1', kind: 'point', x: 0, y: 0 } as any, { id: 'p2', kind: 'point', x: 5, y: 0 } as any, { id: 'l1', kind: 'line', startId: 'p1', endId: 'p2' } as any],
      constraints: [{ id: 'd1', type: 'distance', targets: [{ entityId: 'p1' }, { entityId: 'p2' }], value: 5 }],
    },
    ...over,
  };
}

/** A part: base extrude (fbase00001) + a cut whose sketch sits on the base's top face. */
function part() {
  const doc: SketchDocument = {
    nextSketchSeq: 3,
    sketches: {
      sbase00001: sketch('sbase00001'),
      scut000001: sketch('scut000001', {
        name: 'Sketch 2', createdAt: 3, hostId: `face:${faceOf('fbase00001')}`, plane: { ...XY, origin: [0, 0, 10] },
        state: {
          entities: [{ id: 'p1', kind: 'point', x: 1, y: 1 } as any],
          constraints: [
            { id: 'd1', type: 'distance', targets: [{ entityId: 'p1' }], value: 2 },
            { id: 'oe1', type: 'on-edge', targets: [{ entityId: 'p1' }], externalRef: { scope: 'local', featureId: 'fbase00001', edgeId: 'fbase00001/e:abc' } },
          ],
        },
      }),
    },
  };
  const tree: FeatureTree = {
    nextFeatureSeq: 4,
    features: [
      { id: 'f1', type: 'origin' },
      { id: 'fbase00001', type: 'extrude', sketchId: 'sbase00001', distance: 10, name: 'Extrude 1', createdAt: 2 },
      {
        id: 'fcut000001', type: 'cutExtrude', sketchId: 'scut000001', distance: 3, name: 'Cut-Extrude 1', createdAt: 4,
        bodyIds: ['fbase00001'],
        endCondition: { kind: 'upToSurface', faceId: faceOf('fbase00001'), fallbackPlane: { origin: [0, 0, 0], normal: [0, 0, 1] } },
      },
    ],
  };
  const equations: EquationDoc = {
    entries: {
      width: { expression: 'base * 2', lastValue: 8 },
      base: { expression: '4', lastValue: 4 },
      unused: { expression: '1' },
      'sketch.scut000001.constraint.d1': { expression: 'width / 4', lastValue: 2 },
      'feature.fcut000001.distance': { expression: 'base - 1', lastValue: 3 },
      'feature.fbase00001.distance': { expression: '10' },
    },
  };
  return { doc, tree, equations };
}

const SRC = { origin: 'http://prod.lan', modelId: 7, partName: 'P', partRev: '01', description: null };
const copy = (sel: { sketchIds?: string[]; featureIds?: string[] }, p = part()) =>
  buildItemsBundle(p.doc, p.tree, p.equations, { sketchIds: sel.sketchIds ?? [], featureIds: sel.featureIds ?? [] }, SRC, 48)!;

describe('buildItemsBundle (REQ 1100)', () => {
  it('copying a feature pulls in its sketch but not upstream features', () => {
    const b = copy({ featureIds: ['fcut000001'] });
    expect(b.scope).toBe('items');
    expect(b.features!.map(f => f.id)).toEqual(['fcut000001']);
    expect(b.sketches!.map(s => s.id)).toEqual(['scut000001']);
    expect(b.primaryPlane).toEqual({ ...XY, origin: [0, 0, 10] });
  });

  it('carries the driving equations and the globals they reference, transitively', () => {
    const b = copy({ featureIds: ['fcut000001'] });
    expect(Object.keys(b.variables!).sort()).toEqual(
      ['base', 'feature.fcut000001.distance', 'sketch.scut000001.constraint.d1', 'width']);
  });

  it('never copies the Origin, and an empty selection yields nothing', () => {
    expect(buildItemsBundle(part().doc, part().tree, null, { sketchIds: [], featureIds: ['f1'] }, SRC, 48)).toBeNull();
  });

  it('is a deep copy and round-trips through text', () => {
    const p = part();
    const b = copy({ sketchIds: ['sbase00001'] }, p);
    (p.doc.sketches['sbase00001'].state.entities[0] as any).x = 99;
    expect((b.sketches![0].state.entities[0] as any).x).toBe(0);
    expect(parseBundle(serializeBundle(b), 48)).toEqual({ bundle: b });
  });

  it('an items bundle missing its arrays is refused', () => {
    const t = JSON.stringify({ ...copy({ sketchIds: ['sbase00001'] }), features: undefined });
    expect(parseBundle(t, 48)).toEqual({ error: expect.stringMatching(/incomplete/) });
  });
});

describe('feature reference walkers (REQ 1102)', () => {
  const ALL: Feature['type'][] = [
    'origin', 'extrude', 'cutExtrude', 'revolve', 'cutRevolve', 'sweep', 'cutSweep', 'fillet', 'chamfer', 'datumPlane',
    'mirror', 'linearPattern', 'circularPattern', 'shell', 'datumAxis', 'datumPoint', 'combine', 'hole', 'loft',
    'mirrorBody', 'moveCopyBody',
  ];
  it('every feature type has a walker', () => {
    expect(Object.keys(FEATURE_WALKERS).sort()).toEqual([...ALL].sort());
  });

  it('lists the sketches each sketch-based feature consumes', () => {
    expect(sketchesOf({ id: 'a', type: 'sweep', profileSketchId: 's1', pathSketchId: 's2' })).toEqual(['s1', 's2']);
    expect(sketchesOf({ id: 'a', type: 'loft', sketchIds: ['s1', 's2', 's3'] })).toEqual(['s1', 's2', 's3']);
  });

  it('visits every reference of a pattern and a hole', () => {
    const seen: string[] = [];
    const v = { sketch: (i: string) => i, ref: (k: string, i: string) => (seen.push(`${k}:${i}`), i), edge: (e: any) => (seen.push('edge'), e), moves: () => false, pt: (p: any) => p, dir: (d: any) => d };
    walkFeature({
      id: 'p', type: 'circularPattern', count: 3, mode: 'equalSpacing', angleDeg: 360, seedFeatureIds: ['fa', 'fb'],
      axisRef: { kind: 'edge', edgeRef: { start: [0, 0, 0], end: [0, 0, 1] } }, axisSnapshot: { origin: [0, 0, 0], direction: [0, 0, 1] },
    }, v as any);
    walkFeature({
      id: 'h', type: 'hole', holeType: 'drill', standard: 'iso' as any, size: 'M3' as any, endCondition: { kind: 'throughAll' }, bodyIds: ['b1'],
      placements: [{ faceId: 'face1', position: [0, 0, 0], faceCentroid: [0, 0, 0], faceNormal: [0, 0, 1] }],
    }, v as any);
    expect(seen).toEqual(['edge', 'feature:fa', 'feature:fb', 'body:b1', 'face:face1']);
  });
});

describe('pasteBundle (REQ 1101)', () => {
  it('pastes a sketch in place in the same part with a fresh id and the next name', () => {
    const p = part();
    const r = pasteBundle(p.doc, p.tree, p.equations, copy({ sketchIds: ['sbase00001'] }), { sameModel: true, now: 100 });
    expect(r.newSketchIds).toHaveLength(1);
    const s = r.doc.sketches[r.newSketchIds[0]];
    expect(s.id).not.toBe('sbase00001');
    expect(s).toMatchObject({ hostId: 'datum:xy_plane', plane: XY, name: 'Sketch 3', createdAt: 100 });
    expect(s.state).toEqual(p.doc.sketches['sbase00001'].state);
    expect(r.unresolved).toEqual([]);
    expect(Object.keys(p.doc.sketches)).toHaveLength(2);  // source untouched
  });

  it('places the first sketch on the target plane and detaches it from the old host', () => {
    const p = part();
    const r = pasteBundle(p.doc, p.tree, p.equations, copy({ sketchIds: ['sbase00001'] }),
      { sameModel: true, target: { hostId: 'datum:xz_plane', plane: XZ_UP } });
    expect(r.doc.sketches[r.newSketchIds[0]]).toMatchObject({ hostId: 'datum:xz_plane', plane: XZ_UP });
  });

  it('rewrites references between pasted items and renames default-named features', () => {
    const p = part();
    const r = pasteBundle(p.doc, p.tree, p.equations, copy({ featureIds: ['fbase00001', 'fcut000001'] }), { sameModel: true });
    const [base, cut] = r.newFeatureIds.map(id => r.tree.features.find(f => f.id === id)!) as any[];
    expect(base.name).toBe('Extrude 2');
    expect(cut.name).toBe('Cut-Extrude 2');
    expect(r.doc.sketches[base.sketchId].id).toBe(base.sketchId);
    expect(base.sketchId).not.toBe('sbase00001');
    expect(cut.bodyIds).toEqual([base.id]);
    expect(cut.endCondition.faceId).toBe(faceOf(base.id));
    const cutSketch = r.doc.sketches[cut.sketchId];
    expect(cutSketch.hostId).toBe(`face:${faceOf(base.id)}`);
    expect(cutSketch.state.constraints[1].externalRef).toEqual({ scope: 'local', featureId: base.id, edgeId: `${base.id}/e:abc` });
    expect(r.unresolved).toEqual([]);
    expect(r.tree.features.slice(0, 3)).toEqual(p.tree.features);
  });

  it('moves the other sketches and bundle-internal world data with the target plane', () => {
    const p = part();
    const target = { hostId: 'datum:plane9', plane: { ...XY, origin: [100, 0, 0] as [number, number, number] } };
    const r = pasteBundle(p.doc, p.tree, p.equations, copy({ featureIds: ['fbase00001', 'fcut000001'] }), { sameModel: true, target });
    const [base, cut] = r.newFeatureIds.map(id => r.tree.features.find(f => f.id === id)!) as any[];
    expect(r.doc.sketches[base.sketchId].plane.origin).toEqual([100, 0, 0]);
    expect(r.doc.sketches[cut.sketchId].plane.origin).toEqual([100, 0, 10]);
    expect(cut.endCondition.fallbackPlane.origin).toEqual([100, 0, 0]);
  });

  it('keeps outside references in the same part', () => {
    const p = part();
    const r = pasteBundle(p.doc, p.tree, p.equations, copy({ featureIds: ['fcut000001'] }), { sameModel: true });
    const cut = r.tree.features.at(-1) as any;
    expect(cut.bodyIds).toEqual(['fbase00001']);
    expect(cut.endCondition.faceId).toBe(faceOf('fbase00001'));
    expect(r.doc.sketches[cut.sketchId].hostId).toBe(`face:${faceOf('fbase00001')}`);
    expect(r.unresolved).toEqual([]);
  });

  it('reports outside references as unresolved in another part', () => {
    const other = { doc: { sketches: {}, nextSketchSeq: 1 } as SketchDocument, tree: { features: [{ id: 'f1', type: 'origin' }], nextFeatureSeq: 2 } as FeatureTree };
    const r = pasteBundle(other.doc, other.tree, null, copy({ featureIds: ['fcut000001'] }),
      { sameModel: false, target: { hostId: 'datum:xy_plane', plane: XY } });
    const cut = r.tree.features.at(-1) as any;
    expect(cut.name).toBe('Cut-Extrude 1');
    expect(r.unresolved.map(u => [u.itemName, u.label, u.deletable])).toEqual([
      ['Sketch 1', 'model edge reference (on-edge)', true],
      ['Cut-Extrude 1', 'end condition "up to surface"', true],
      ['Cut-Extrude 1', 'cut target body', true],
    ]);
    expect(r.unresolved.every(u => u.itemId === cut.id || u.itemId === cut.sketchId)).toBe(true);
  });
});

describe('applyPasteChoices (REQ 1102)', () => {
  function crossPaste() {
    const b = copy({ featureIds: ['fcut000001'] });
    const r = pasteBundle({ sketches: {}, nextSketchSeq: 1 }, { features: [{ id: 'f1', type: 'origin' }], nextFeatureSeq: 2 }, null, b,
      { sameModel: false, target: { hostId: 'datum:xy_plane', plane: XY } });
    return { b, r };
  }

  it('Delete rewrites the reference away', () => {
    const { b, r } = crossPaste();
    const out = applyPasteChoices(r, b, { deleteKeys: r.unresolved.map(u => u.key) });
    const cut = out.tree.features.at(-1) as any;
    expect(cut.endCondition).toEqual({ kind: 'blind' });
    expect(cut.bodyIds).toBeUndefined();
    expect(out.doc.sketches[cut.sketchId].state.constraints.map(c => c.id)).toEqual(['d1']);
    expect(out.unresolved).toEqual([]);
  });

  it('Leave dangling keeps the reference', () => {
    const { b, r } = crossPaste();
    const out = applyPasteChoices(r, b, { deleteKeys: [] });
    expect((out.tree.features.at(-1) as any).endCondition.kind).toBe('upToSurface');
    expect(out.unresolved).toHaveLength(3);
  });

  it('drops a fillet edge that was deleted and keeps the rest', () => {
    const fillet: Feature = { id: 'ffil000001', type: 'fillet', radius: 1, edges: [{ start: [0, 0, 0], end: [1, 0, 0] }, { start: [0, 0, 0], end: [0, 1, 0] }] };
    const b: ClipboardBundle = { kind: 'letwinventory-cad', schema: 1, scope: 'items', namingVersion: 48, source: SRC, sketches: [], features: [fillet], variables: {}, primaryPlane: null };
    const r = pasteBundle({ sketches: {}, nextSketchSeq: 1 }, { features: [], nextFeatureSeq: 1 }, null, b, { sameModel: false });
    expect(r.unresolved.map(u => u.label)).toEqual(['edge 1', 'edge 2']);
    const out = applyPasteChoices(r, b, { deleteKeys: [r.unresolved[0].key] });
    expect((out.tree.features[0] as any).edges).toEqual([{ start: [0, 0, 0], end: [0, 1, 0] }]);
  });

  it('a required reference can only dangle', () => {
    const plane: Feature = { id: 'fpln000001', type: 'datumPlane', method: { kind: 'offset', distance: 5, planeRef: { kind: 'face', faceId: 'faceX', fallbackPlane: XY } } };
    const b: ClipboardBundle = { kind: 'letwinventory-cad', schema: 1, scope: 'items', namingVersion: 48, source: SRC, sketches: [], features: [plane], variables: {}, primaryPlane: null };
    const r = pasteBundle({ sketches: {}, nextSketchSeq: 1 }, { features: [], nextFeatureSeq: 1 }, null, b, { sameModel: false });
    expect(r.unresolved).toMatchObject([{ label: 'reference plane', deletable: false }]);
  });
});

describe('variables on paste (REQ 1103)', () => {
  it('re-keys driving equations onto the pasted items and adds missing globals', () => {
    const b = copy({ featureIds: ['fcut000001'] });
    const r = pasteBundle({ sketches: {}, nextSketchSeq: 1 }, { features: [], nextFeatureSeq: 1 }, { entries: { other: { expression: '1' } } }, b, { sameModel: false });
    const cut = r.tree.features[0] as any;
    expect(r.equations.entries[`feature.${cut.id}.distance`].expression).toBe('base - 1');
    expect(r.equations.entries[`sketch.${cut.sketchId}.constraint.d1`].expression).toBe('width / 4');
    expect(r.equations.entries['width'].expression).toBe('base * 2');
    expect(r.equations.entries['base'].expression).toBe('4');
    expect(r.equations.entries['other'].expression).toBe('1');
    expect(r.equations.entries['feature.fcut000001.distance']).toBeUndefined();
    expect(r.clashes).toEqual([]);
  });

  it('a same-named variable with a different expression is a clash that defaults to the existing one', () => {
    const b = copy({ featureIds: ['fcut000001'] });
    const r = pasteBundle({ sketches: {}, nextSketchSeq: 1 }, { features: [], nextFeatureSeq: 1 }, { entries: { base: { expression: '9' }, width: { expression: 'base * 2' } } }, b, { sameModel: false });
    expect(r.clashes).toEqual([{ name: 'base', incoming: '4', existing: '9', value: 4 }]);
    expect(r.equations.entries['base'].expression).toBe('9');
  });

  it('rename adds the copied variable under a new name; bake inlines its value', () => {
    const b = copy({ featureIds: ['fcut000001'] });
    const r = pasteBundle({ sketches: {}, nextSketchSeq: 1 }, { features: [], nextFeatureSeq: 1 }, { entries: { base: { expression: '9' } } }, b, { sameModel: false });
    const cut = r.tree.features[0] as any;
    const renamed = applyPasteChoices(r, b, { deleteKeys: [], variables: { base: 'rename' } });
    expect(renamed.equations.entries['base_2'].expression).toBe('4');
    expect(renamed.equations.entries[`feature.${cut.id}.distance`].expression).toBe('base_2 - 1');
    expect(renamed.equations.entries['width'].expression).toBe('base_2 * 2');
    expect(renamed.equations.entries['base'].expression).toBe('9');
    const baked = applyPasteChoices(r, b, { deleteKeys: [], variables: { base: 'bake' } });
    expect(baked.equations.entries[`feature.${cut.id}.distance`].expression).toBe('(4) - 1');
    expect(baked.equations.entries['base_2']).toBeUndefined();
  });
});

describe('planeToPlane', () => {
  it('carries the source plane frame onto the target', () => {
    const m = planeToPlane(XY, XZ_UP);
    expect(m.pt([0, 0, 0])).toEqual([0, 0, 10]);
    expect(m.pt([2, 3, 0])).toEqual([2, 0, 13]);
    expect(m.dir([0, 0, 1])).toEqual([0, -1, 0]);
  });
});
