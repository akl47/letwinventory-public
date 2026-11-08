// REQ 1029 — features that add or remove material act on the bodies in their scope.
const { _scopedBodies, _scopeFeatureFaceIds } = require('../../../services/cadRegenService');

describe('feature body scope (REQ 1029)', () => {
  const bodies = [{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }];

  it('uses the fallback when the feature has no scope', () => {
    const fallback = [bodies[2]];
    expect(_scopedBodies({}, bodies, fallback)).toBe(fallback);
    expect(_scopedBodies({ bodyIds: [] }, bodies, fallback)).toBe(fallback);
  });

  it('returns the scoped bodies in the order picked', () => {
    expect(_scopedBodies({ bodyIds: ['f3', 'f1'] }, bodies, null).map(b => b.id)).toEqual(['f3', 'f1']);
  });

  it('names a scoped body that no longer exists', () => {
    expect(() => _scopedBodies({ bodyIds: ['f9'] }, bodies, null)).toThrow(/f9.*no longer exists/);
  });

  it('scopes a feature\'s face ids to one body without touching other faces', () => {
    const mine = { faceId: '{"feature_id":"h1#p0#drillcut#body0","role":"side"}' };
    const other = { faceId: '{"feature_id":"f1#0","role":"cap"}' };
    const [a, b] = _scopeFeatureFaceIds([mine, other], 'h1', 'f2');
    expect(a.faceId).toBe('{"feature_id":"h1#@f2#p0#drillcut#body0","role":"side"}');
    expect(b).toBe(other);
  });
});
