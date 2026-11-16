import { describe, it, expect } from 'vitest';
import { assemblyThreeMfObjects } from './assemblyThreeMf';
import { build3mfFiles } from './threeMf';
import type { ComposedBody } from './assembly.types';

const tri = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] };
const body = (id: string, instanceId: string, partID: number, faces = [tri]): ComposedBody =>
  ({ id, name: null, instanceId, partID, faces, vertices: [], edges: [], placement: { translate: [0, 0, 0], quaternion: [0, 0, 0, 1] } }) as unknown as ComposedBody;

const names: Record<number, string> = { 1: '000101', 2: '000102' };
const run = (bodies: ComposedBody[], hiddenInstanceIds: string[] = [], hiddenBodyIds: string[] = []) =>
  assemblyThreeMfObjects({
    bodies, hiddenInstanceIds: new Set(hiddenInstanceIds), hiddenBodyIds: new Set(hiddenBodyIds),
    nameOf: b => names[b.partID] ?? `Part ${b.partID}`,
  });

describe('assemblyThreeMfObjects (REQ 1076)', () => {
  it('makes one object per component instance, holding all of its bodies', () => {
    const r = run([body('i1::b1', 'i1', 1), body('i1::b2', 'i1', 1), body('i2::b1', 'i2', 2)]);
    expect(r.groups.map(g => g.map(b => b.id))).toEqual([['i1::b1', 'i1::b2'], ['i2::b1']]);
    expect(r.names).toEqual(['000101', '000102']);
  });

  it('adds the instance id when a part is used more than once', () => {
    const r = run([body('i1::b1', 'i1', 1), body('i2::b1', 'i2', 1), body('i3::b1', 'i3', 2)]);
    expect(r.names).toEqual(['000101 (i1)', '000101 (i2)', '000102']);
  });

  it('leaves out hidden instances, hidden bodies and bodies with no mesh', () => {
    const r = run(
      [body('i1::b1', 'i1', 1), body('i2::b1', 'i2', 2), body('i2::b2', 'i2', 2), body('i3::b1', 'i3', 2, [])],
      ['i1'], ['i2::b2'],
    );
    expect(r.groups.map(g => g.map(b => b.id))).toEqual([['i2::b1']]);
    expect(r.names).toEqual(['000102']);
  });

  it('returns nothing for an assembly with no geometry', () => {
    expect(run([])).toEqual({ groups: [], names: [] });
  });

  it('feeds the 3MF builder: one named build item per component', () => {
    const r = run([body('i1::b1', 'i1', 1), body('i2::b1', 'i2', 2)]);
    const model = build3mfFiles(r.groups, r.names)['3D/3dmodel.model'];
    expect(model).toContain('name="000101"');
    expect(model).toContain('name="000102"');
    expect([...model.matchAll(/<item /g)]).toHaveLength(2);
  });
});
