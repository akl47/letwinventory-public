import { describe, it, expect } from 'vitest';
import { buildPartBundle, parseBundle, partFileName, sameModel, serializeBundle, type ClipboardBundle } from './clipboard';
import type { FeatureTree, SketchDocument } from './types';

const featureTree = { features: [{ id: 'origin', type: 'origin' }], nextFeatureSeq: 3, unit: 'mm' } as unknown as FeatureTree;
const sketchDoc = { sketches: { s1: { id: 's1' } }, nextSketchSeq: 2 } as unknown as SketchDocument;
const equations = { entries: { w: { expression: '10' } } } as any;

const model = {
  id: 7, featureTree, sketchDoc, equations,
  part: { id: 3, name: '000123', revision: '02', description: 'Bracket' },
} as any;

function bundle(): ClipboardBundle {
  return buildPartBundle(model, { origin: 'http://prod.lan', namingVersion: 48, rev: '02' });
}

describe('CAD clipboard bundle (REQ 1011–1013, 1016)', () => {
  it('a part bundle carries the whole model, its source and the naming version', () => {
    const b = bundle();
    expect(b).toMatchObject({
      kind: 'letwinventory-cad', schema: 1, scope: 'part', namingVersion: 48,
      source: { origin: 'http://prod.lan', modelId: 7, partName: '000123', partRev: '02', description: 'Bracket' },
    });
    expect(b.model).toEqual({ featureTree, sketchDoc, equations });
  });

  it('copies are deep — later edits to the source do not leak into the bundle', () => {
    const b = bundle();
    (sketchDoc.sketches as any).s1.id = 'changed';
    expect((b.model!.sketchDoc.sketches as any).s1.id).toBe('s1');
    (sketchDoc.sketches as any).s1.id = 's1';
  });

  it('round-trips through text', () => {
    const r = parseBundle(serializeBundle(bundle()), 48);
    expect(r).toEqual({ bundle: bundle() });
  });

  it('ignores pasted text that is not a CAD bundle', () => {
    expect(parseBundle('hello world', 48)).toBeNull();
    expect(parseBundle('{"a":1}', 48)).toBeNull();
    expect(parseBundle('', 48)).toBeNull();
  });

  it('refuses an unknown schema', () => {
    const t = JSON.stringify({ ...bundle(), schema: 99 });
    expect(parseBundle(t, 48)).toEqual({ error: expect.stringMatching(/newer version/) });
  });

  it('refuses assemblies', () => {
    const t = JSON.stringify({ ...bundle(), scope: 'assembly' });
    expect(parseBundle(t, 48)).toEqual({ error: 'Assemblies cannot be copied yet' });
  });

  it('a naming-version mismatch warns but does not block', () => {
    const r = parseBundle(serializeBundle(bundle()), 50);
    expect(r && 'bundle' in r && r.bundle.scope).toBe('part');
    expect(r && 'warning' in r && r.warning).toMatch(/re-pick/);
    // Unknown local version (no regen yet) → no warning.
    expect(parseBundle(serializeBundle(bundle()), null)).toEqual({ bundle: bundle() });
  });

  it('same model needs the same origin AND id', () => {
    const b = bundle();
    expect(sameModel(b, 'http://prod.lan', 7)).toBe(true);
    expect(sameModel(b, 'http://localhost:4200', 7)).toBe(false);
    expect(sameModel(b, 'http://prod.lan', 8)).toBe(false);
  });

  it('names the export file PN-rev.lwcad', () => {
    expect(partFileName(bundle())).toBe('000123-02.lwcad');
    expect(partFileName({ ...bundle(), source: { ...bundle().source, partRev: '' } })).toBe('000123.lwcad');
  });
});
