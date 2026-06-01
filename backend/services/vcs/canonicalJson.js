'use strict';

// REQ 670 (VC-2) — canonical JSON serialization, the linchpin of content
// addressing. Two values with equal logical content MUST serialize to
// byte-identical strings so they hash equal; otherwise deduplication and
// diff break. Differs from JSON.stringify in two ways that matter:
//   1. object keys are emitted in sorted order (insertion order is erased);
//   2. non-finite numbers (NaN/±Infinity) throw instead of silently
//      becoming `null` — two distinct values must never collide on one hash.
// Arrays stay ordered (order is semantically meaningful). Numbers otherwise
// follow JS/JSON rules (-0 renders as 0, 1.0 renders as 1).

function serialize(v) {
  if (v === null) return 'null';

  const t = typeof v;

  if (t === 'number') {
    if (!Number.isFinite(v)) {
      throw new Error(`canonicalJson: non-finite number (${v}) cannot be hashed deterministically`);
    }
    return JSON.stringify(v === 0 ? 0 : v); // collapse -0 -> 0
  }

  if (t === 'string' || t === 'boolean') return JSON.stringify(v);

  if (t === 'bigint') {
    throw new Error('canonicalJson: bigint is not supported');
  }

  if (Array.isArray(v)) {
    // Match JSON.stringify: undefined / functions / symbols become null in arrays.
    const parts = v.map((el) => {
      const s = serialize(el);
      return s === undefined ? 'null' : s;
    });
    return '[' + parts.join(',') + ']';
  }

  if (t === 'object') {
    const keys = Object.keys(v).sort();
    const parts = [];
    for (const k of keys) {
      const s = serialize(v[k]);
      if (s === undefined) continue; // omit undefined-valued keys, like JSON.stringify
      parts.push(JSON.stringify(k) + ':' + s);
    }
    return '{' + parts.join(',') + '}';
  }

  // functions / symbols / undefined -> omitted (object) or null (array)
  return undefined;
}

/** Deterministically serialize a JSON-compatible value (sorted keys, ordered
 * arrays, finite numbers only). Throws on non-finite numbers and bigint. */
function canonicalJson(value) {
  const out = serialize(value);
  return out === undefined ? 'null' : out;
}

module.exports = { canonicalJson };
