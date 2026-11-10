// REQ 1039 — migrate stored geometry references from the positional face /
// edge / vertex ids saved before stable topological naming (REQ 1035) to the
// stable ids. The backend's regen returns `idMigration` (legacy id → stable
// id); the editor rewrites every reference it finds and saves once.

/** Legacy positional face id → stable id. Only faces migrate: a legacy face
 * id names the feature that produced it, so it means one face. Legacy edge /
 * vertex ids (`<body>/e19`) mean a different element after every feature, so
 * they keep resolving through the backend's legacy aliases instead. */
export interface IdMigration {
  faces?: Record<string, string>;
}

/** Subtrees whose ids belong to OTHER models (cross-part refs). */
const FOREIGN_KEYS = new Set(['sourceGeomRef']);

export function hasMigrations(m: IdMigration | null | undefined): boolean {
  return !!m && Object.keys(m.faces || {}).length > 0;
}

/**
 * Return `value` with every legacy reference id replaced, sharing unchanged
 * subtrees (and returning `value` itself when nothing changed, so callers can
 * compare by identity). Covers sketch hosts (`hostId: 'face:<id>'`) and every
 * `faceId` field in sketches and features.
 */
export function migrateReferences<T>(value: T, m: IdMigration): T {
  return walk(value, m) as T;
}

function walk(value: unknown, m: IdMigration): unknown {
  if (Array.isArray(value)) {
    let out: unknown[] | null = null;
    value.forEach((v, i) => {
      const nv = walk(v, m);
      if (nv !== v) (out ??= value.slice())[i] = nv;
    });
    return out ?? value;
  }
  if (!value || typeof value !== 'object') return value;
  const obj = value as Record<string, unknown>;
  let out: Record<string, unknown> | null = null;
  for (const [key, v] of Object.entries(obj)) {
    let nv: unknown = v;
    if (FOREIGN_KEYS.has(key)) continue;
    if (typeof v === 'string') {
      if (key === 'faceId') nv = m.faces?.[v] ?? v;
      else if (key === 'hostId' && v.startsWith('face:')) {
        const id = m.faces?.[v.slice('face:'.length)];
        if (id) nv = `face:${id}`;
      }
    } else if (v && typeof v === 'object') {
      nv = walk(v, m);
    }
    if (nv !== v) (out ??= { ...obj })[key] = nv;
  }
  return out ?? value;
}

/**
 * Sketch-document migration. A legacy host id may already have drifted onto
 * another face (positional ids reshuffle), so a sketch whose host is legacy
 * takes the face the backend actually resolved it onto (`resolvedHosts`,
 * sketch id → stable face id) rather than the id's current positional meaning.
 */
export function migrateSketchDoc<T extends { sketches: Record<string, { hostId?: string }> }>(
  doc: T, m: IdMigration, resolvedHosts: Record<string, string>,
): T {
  let sketches: Record<string, { hostId?: string }> | null = null;
  for (const [sid, sk] of Object.entries(doc.sketches)) {
    const host = sk.hostId?.startsWith('face:') ? sk.hostId.slice('face:'.length) : null;
    const resolved = resolvedHosts[sid];
    if (host && resolved && host !== resolved && m.faces?.[host]) {
      (sketches ??= { ...doc.sketches })[sid] = { ...sk, hostId: `face:${resolved}` };
    }
  }
  return migrateReferences(sketches ? { ...doc, sketches } : doc, m) as T;
}

interface MateRefLike { instanceId: string; faceId: string }
interface MateLike { mateId: string; a: MateRefLike; b: MateRefLike }

/**
 * Mates whose face refs still hold a child's legacy positional id, rewritten
 * through that instance's `idMigration` (child-local legacy id → stable id).
 * Returns only the mates that change.
 */
export function migrateMateRefs<T extends MateLike>(
  mates: readonly T[], byInstance: Record<string, Record<string, string> | undefined>,
): Array<{ mateId: string; a: MateRefLike; b: MateRefLike }> {
  const fix = (r: MateRefLike): MateRefLike => {
    const id = byInstance[r.instanceId]?.[r.faceId];
    return id ? { instanceId: r.instanceId, faceId: id } : r;
  };
  const out: Array<{ mateId: string; a: MateRefLike; b: MateRefLike }> = [];
  for (const m of mates) {
    const a = fix(m.a), b = fix(m.b);
    if (a !== m.a || b !== m.b) out.push({ mateId: m.mateId, a, b });
  }
  return out;
}
