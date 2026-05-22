import type {
  SketchState, SketchEntity, SketchConstraint, ConstraintType,
  SketchDocument, Sketch, FeatureTree, Feature,
} from './types';
import { ensureOriginPoint } from './store';

// Legacy constraint types that have been folded into `coincident`. They
// remain in old persisted documents but can't be expressed in the live
// `ConstraintType` union, so we keep them as string literals for the
// migrator and rewrite each occurrence on load.
const LEGACY_ON_TYPES = new Set<string>(['point-on-line', 'point-on-curve']);

/** Rewrite an in-memory constraint's type so any stored legacy "on"
 * variants surface as `coincident`. Idempotent. */
function rewriteLegacyType(type: string): ConstraintType {
  if (LEGACY_ON_TYPES.has(type)) return 'coincident';
  return type as ConstraintType;
}

// ──────────────────────────────────────────────────────────────────────────
// Legacy schema (pre-entity-model). Kept here as a self-contained type so the
// rest of the codebase can move on. Loader/migration code is the only consumer.
// REQ 565: schema migration on load.
// ──────────────────────────────────────────────────────────────────────────

export interface LegacyPoint {
  id: string;
  x: number;
  y: number;
  reference?: boolean;
}

export interface LegacyLine {
  id: string;
  startId: string;
  endId: string;
  reference?: boolean;
}

export interface LegacyConstraint {
  // Legacy data may carry constraint type strings that have since been
  // removed from the live `ConstraintType` union (e.g. `point-on-line`,
  // `point-on-curve` were merged into `coincident`). Typed as `string`
  // so the migrator can read them; `rewriteLegacyType` normalizes each
  // value before it enters the live state.
  id: string;
  type: string;
  targets: string[];
  value?: number;
}

export interface LegacySketchState {
  points: LegacyPoint[];
  lines: LegacyLine[];
  constraints: LegacyConstraint[];
}

export function isLegacySketchState(state: unknown): state is LegacySketchState {
  if (!state || typeof state !== 'object') return false;
  const s = state as Record<string, unknown>;
  return Array.isArray(s['points']) && Array.isArray(s['lines']) && !Array.isArray(s['entities']);
}

export function migrateSketchState(state: LegacySketchState | SketchState): SketchState {
  if (!isLegacySketchState(state)) {
    // Modern schema — still backfill the origin point so sketches saved
    // before the origin became a real entity get it on load, and rewrite
    // any persisted `point-on-line` / `point-on-curve` constraints into
    // `coincident` since the unified type replaced them. Idempotent.
    const modern = state as SketchState;
    const constraints = modern.constraints.map(c =>
      LEGACY_ON_TYPES.has(c.type) ? { ...c, type: rewriteLegacyType(c.type) } : c,
    );
    return ensureOriginPoint({ ...modern, constraints });
  }

  const entities: SketchEntity[] = [];
  for (const p of state.points) {
    const e: SketchEntity = { kind: 'point', id: p.id, x: p.x, y: p.y };
    if (p.reference) e.construction = true;
    entities.push(e);
  }
  for (const l of state.lines) {
    const e: SketchEntity = { kind: 'line', id: l.id, startId: l.startId, endId: l.endId };
    if (l.reference) e.construction = true;
    entities.push(e);
  }

  const constraints: SketchConstraint[] = state.constraints.map(c => {
    const next: SketchConstraint = {
      id: c.id,
      type: rewriteLegacyType(c.type),
      targets: c.targets.map(t => ({ entityId: t })),
    };
    if (c.value !== undefined) next.value = c.value;
    return next;
  });

  return ensureOriginPoint({ entities, constraints });
}

export function migrateSketchDocument(doc: SketchDocument): SketchDocument {
  const sketches: Record<string, Sketch> = {};
  for (const [id, s] of Object.entries(doc.sketches)) {
    sketches[id] = { ...s, state: migrateSketchState(s.state as LegacySketchState | SketchState) };
  }
  return { ...doc, sketches };
}

/** Read-side compatibility shim for ExtrudeFeature:
 *   - `regionIndices` missing + legacy `loopIndices` present → copy across.
 *     Region indices line up with loop indices for non-nested sketches.
 *   - `endCondition` missing → default to { kind: 'blind' }. Lets the new
 *     end-condition dropdown branch consistently without sprinkling
 *     ?? 'blind' defaults across the codebase.
 */
export function migrateFeatureTree(tree: FeatureTree): FeatureTree {
  const features = tree.features.map((f): Feature => {
    if (f.type !== 'extrude') return f;
    const legacy = f as Feature & {
      loopIndices?: number[]; regionIndices?: number[];
      endCondition?: { kind: string };
    };
    let next = legacy;
    if (next.regionIndices === undefined && next.loopIndices !== undefined) {
      const { loopIndices, ...rest } = next;
      next = { ...rest, regionIndices: loopIndices };
    }
    if (next.endCondition === undefined) {
      next = { ...next, endCondition: { kind: 'blind' } };
    }
    return next as Feature;
  });
  return { ...tree, features };
}
