import type {
  SketchState, SketchEntity, SketchConstraint, ConstraintType,
  SketchDocument, Sketch, FeatureTree, Feature,
} from './types';
import { ensureOriginPoint } from './store';
import { upgradeFeatureTree } from './featureTree';

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
    let constraints = modern.constraints.map(c =>
      LEGACY_ON_TYPES.has(c.type) ? { ...c, type: rewriteLegacyType(c.type) } : c,
    );
    // SW-style on-edge constraint backfill: previously the link to a 3D
    // body edge lived in a `projectedFrom` field on the sketch entity.
    // Now it's a SketchConstraint of type 'on-edge' that targets the
    // entity. Synthesise one for every entity that still carries the old
    // field, and strip the field so the entity stays clean. Idempotent —
    // if a constraint already exists for the entity, we skip.
    const existingTargets = new Set<string>();
    for (const c of constraints) {
      if (c.type !== 'on-edge') continue;
      for (const t of c.targets) existingTargets.add(t.entityId);
    }
    const synthesised: SketchConstraint[] = [];
    const cleanedEntities = modern.entities.map(e => {
      const pf = (e as SketchEntity & { projectedFrom?: { featureId: string; edgeId: string } }).projectedFrom;
      if (!pf) return e;
      if (!existingTargets.has(e.id)) {
        synthesised.push({
          id: `on-edge-${e.id}`,
          type: 'on-edge',
          targets: [{ entityId: e.id }],
          externalRef: { featureId: pf.featureId, edgeId: pf.edgeId },
        });
        existingTargets.add(e.id);
      }
      const { projectedFrom: _stripped, ...rest } = e as SketchEntity & { projectedFrom?: unknown };
      void _stripped;
      return rest as SketchEntity;
    });
    if (synthesised.length > 0) constraints = [...constraints, ...synthesised];
    // REQ Batch 6 — retrofit a `fixed` constraint on existing text
    // boxes' BL corner so dimensioning them doesn't drift the
    // whole box. Idempotent: skipped when the BL is already fixed.
    const hasFixedOn = (pointId: string) =>
      constraints.some(c => c.type === 'fixed' && c.targets[0]?.entityId === pointId);
    for (const e of cleanedEntities) {
      if (e.kind !== 'text') continue;
      const te = e as import('./types').TextEntity;
      if (!te.cornerIds || te.cornerIds.length < 1) continue;
      const blId = te.cornerIds[0];
      if (!hasFixedOn(blId)) {
        constraints = [...constraints, {
          id: `c-textfix-${te.id}`,
          type: 'fixed',
          targets: [{ entityId: blId }],
        }];
      }
    }
    // REQ Batch 6 — repair text entities that lost their text /
    // cornerIds fields (e.g. via a stale signal write). Heuristic:
    // if a text entity has no cornerIds AND no anchorId, find a
    // 4-construction-point axis-aligned rectangle in the same
    // sketch state and bind it.
    const repairedEntities = cleanedEntities.map(e => {
      if (e.kind !== 'text') return e;
      const te = e as import('./types').TextEntity;
      if (te.cornerIds && te.cornerIds.length === 4) return e;
      if (te.anchorId !== undefined) return e;
      // Recover: scan construction points for a rectangle.
      const pts = cleanedEntities.filter(p => p.kind === 'point' && (p as any).construction === true) as Array<{ id: string; x: number; y: number; kind: 'point' }>;
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const a = pts[i], b = pts[j];
          if (Math.abs(a.x - b.x) < 1e-3 || Math.abs(a.y - b.y) < 1e-3) continue;
          const xmin = Math.min(a.x, b.x), xmax = Math.max(a.x, b.x);
          const ymin = Math.min(a.y, b.y), ymax = Math.max(a.y, b.y);
          const blP = pts.find(p => Math.abs(p.x - xmin) < 1e-3 && Math.abs(p.y - ymin) < 1e-3);
          const brP = pts.find(p => Math.abs(p.x - xmax) < 1e-3 && Math.abs(p.y - ymin) < 1e-3);
          const trP = pts.find(p => Math.abs(p.x - xmax) < 1e-3 && Math.abs(p.y - ymax) < 1e-3);
          const tlP = pts.find(p => Math.abs(p.x - xmin) < 1e-3 && Math.abs(p.y - ymax) < 1e-3);
          if (blP && brP && trP && tlP) {
            return {
              ...te, text: te.text || 'Text',
              cornerIds: [blP.id, brP.id, trP.id, tlP.id] as [string, string, string, string],
            };
          }
        }
      }
      return e;
    });
    // REQ 770/771 — backfill `scope:'local'` onto any on-edge externalRef that
    // predates the local/cross-part discriminated union (including ones
    // synthesised above). Idempotent; cross-part refs already carry a scope.
    const scoped = constraints.map(c => {
      const er = c.externalRef as { scope?: string } | undefined;
      if (c.type === 'on-edge' && er && er.scope === undefined) {
        return { ...c, externalRef: { ...er, scope: 'local' as const } } as SketchConstraint;
      }
      return c;
    });
    return ensureOriginPoint({ ...modern, entities: repairedEntities, constraints: scoped });
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
    if (f.type !== 'extrude' && f.type !== 'cutExtrude') return f;
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
      next = { ...next, endCondition: { kind: 'blind' } } as typeof legacy;
    }
    return next as Feature;
  });
  // REQ 610: legacy `visible:false` on solid features upgrades to
  // `suppressed:true` (hide-that-skips-regen is dead; datums keep visible).
  return upgradeFeatureTree({ ...tree, features });
}
