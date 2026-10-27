'use strict';

// REQ 962 — pattern features are capped at MAX_PATTERN_COPIES copies; over
// the cap the feature fails with a readable error before any transform list
// is built.

const { _computePatternTransforms, MAX_PATTERN_COPIES } = require('../../../services/cadRegenService');

const AXIS = { origin: [0, 0, 0], direction: [1, 0, 0] };

describe('Pattern copy limit (REQ 962)', () => {
  test('the limit is 1000 copies', () => {
    expect(MAX_PATTERN_COPIES).toBe(1000);
  });

  test('a linear pattern at the limit builds; one over is refused', () => {
    const ok = _computePatternTransforms({ type: 'linearPattern', direction1: { axisSnapshot: AXIS, count: 1001, spacing: 1 } });
    expect(ok).toHaveLength(1000);
    expect(() => _computePatternTransforms({ type: 'linearPattern', direction1: { axisSnapshot: AXIS, count: 1002, spacing: 1 } }))
      .toThrow(/1001 copies exceeds the limit of 1000/);
  });

  test('a 2D linear pattern counts both directions', () => {
    expect(() => _computePatternTransforms({
      type: 'linearPattern',
      direction1: { axisSnapshot: AXIS, count: 100, spacing: 1 },
      direction2: { axisSnapshot: { origin: [0, 0, 0], direction: [0, 1, 0] }, count: 100, spacing: 1 },
    })).toThrow(/9999 copies exceeds/);
  });

  test('a huge circular count is refused without allocating', () => {
    const t0 = Date.now();
    expect(() => _computePatternTransforms({ type: 'circularPattern', axisSnapshot: { origin: [0, 0, 0], direction: [0, 0, 1] }, count: 1e9, angleDeg: 360, mode: 'equalSpacing' }))
      .toThrow(/exceeds the limit/);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
