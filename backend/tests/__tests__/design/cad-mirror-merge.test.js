// REQ 1031 — one Mirror tool: feature mirrors copy each seed's change on every
// body it touched.
const { _captureFeatureSnapshot } = require('../../../services/cadRegenService');

describe('feature snapshots for mirrors and patterns (REQ 1031)', () => {
  it('records every body a feature changed, primary first', () => {
    const before = new Map([['f1', 'A0'], ['f2', 'B0'], ['f3', 'C0']]);
    const bodies = [{ id: 'f1', brep: 'A1' }, { id: 'f2', brep: 'B0' }, { id: 'f3', brep: 'C1' }];
    const snaps = new Map();
    _captureFeatureSnapshot('cut1', bodies, before, snaps);
    const s = snaps.get('cut1');
    expect(s.bodyId).toBe('f1');
    expect(s.perBody).toEqual([
      { bodyId: 'f1', before: 'A0', after: 'A1' },
      { bodyId: 'f3', before: 'C0', after: 'C1' },
    ]);
  });

  it('records a new body with an empty before-state', () => {
    const snaps = new Map();
    _captureFeatureSnapshot('ext2', [{ id: 'f1', brep: 'A0' }, { id: 'ext2', brep: 'N1' }], new Map([['f1', 'A0']]), snaps);
    expect(snaps.get('ext2').perBody).toEqual([{ bodyId: 'ext2', before: '', after: 'N1' }]);
  });

  it('records nothing when no body changed', () => {
    const snaps = new Map();
    _captureFeatureSnapshot('noop', [{ id: 'f1', brep: 'A0' }], new Map([['f1', 'A0']]), snaps);
    expect(snaps.get('noop')).toEqual({ bodyId: null, before: '', after: '' });
  });
});
