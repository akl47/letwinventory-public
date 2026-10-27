// Globally-unique IDs for features and sketches.
//
// IDs used to be sequential per document (`f<nextFeatureSeq>`, `s<nextSketchSeq>`),
// which collides across branches: two branches off the same point both assign the
// next number to DIFFERENT features. A content/feature-level merge then conflates
// them. Random IDs are collision-free without any cross-branch coordination, so a
// feature added on one branch can never share an ID with a feature added on
// another. The origin (`f1`) is a fixed seed shared by every document and is NOT
// randomized — it is the same feature everywhere.

function randomSuffix(): string {
  const c = typeof globalThis !== 'undefined' ? (globalThis as { crypto?: Crypto }).crypto : undefined;
  if (c && c.getRandomValues) {
    const b = new Uint8Array(8);
    c.getRandomValues(b);
    let s = '';
    for (const x of b) s += x.toString(36).padStart(2, '0');
    return s.slice(0, 9);
  }
  return (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 9);
}

/** A globally-unique id with the given single-letter prefix (e.g. 'f', 's'). */
export function uid(prefix: string): string {
  return prefix + randomSuffix();
}

export const newFeatureId = (): string => uid('f');
export const newSketchId = (): string => uid('s');
