'use strict';

// REQ 670 (VC-2) — canonical serialization is the linchpin of content
// addressing: logically-equal content must serialize byte-identically so it
// hashes equal (dedup + diff depend on it). Pure function, no DB.

const { canonicalJson } = require('../../../services/vcs/canonicalJson');

describe('canonicalJson', () => {
  test('sorts object keys so insertion order does not matter', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  test('sorts nested object keys recursively (arrays stay ordered)', () => {
    const x = canonicalJson({ z: { d: 1, c: 2 }, a: [{ y: 1, x: 2 }] });
    const y = canonicalJson({ a: [{ x: 2, y: 1 }], z: { c: 2, d: 1 } });
    expect(x).toBe(y);
  });

  test('preserves array element order (arrays are ordered, not sorted)', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalJson([1, 2, 3])).not.toBe(canonicalJson([3, 2, 1]));
  });

  test('normalizes numbers: -0 and 0 are equal; integer-valued floats drop the decimal', () => {
    expect(canonicalJson({ n: -0 })).toBe(canonicalJson({ n: 0 }));
    expect(canonicalJson({ n: 1.0 })).toBe('{"n":1}');
  });

  test('is idempotent: re-serializing a parsed canonical form is byte-identical', () => {
    const obj = { b: 'x', a: { d: 2, c: [2, 1] }, m: null };
    const once = canonicalJson(obj);
    const twice = canonicalJson(JSON.parse(once));
    expect(twice).toBe(once);
  });

  test('rejects non-finite numbers so two distinct values cannot both hash as null', () => {
    expect(() => canonicalJson({ n: NaN })).toThrow();
    expect(() => canonicalJson({ n: Infinity })).toThrow();
    expect(() => canonicalJson({ n: -Infinity })).toThrow();
  });

  test('serializes null and nested null consistently', () => {
    expect(canonicalJson({ a: null })).toBe('{"a":null}');
    expect(canonicalJson(null)).toBe('null');
  });
});
