// Projected (Convert Entities) geometry: source identity + enumeration.
//
// A projected sketch entity carries no flag of its own — the link lives as an
// `on-edge` SketchConstraint whose `externalRef` names the source geometry
// (see types.ts). These helpers are the read side of that link:
//
//   * `externalRefKey`         — stable identity for a source reference, so the
//                                same edge can't be projected twice (REQ 939).
//   * `findProjectedBySource`  — the duplicate lookup used at creation time.
//   * `listProjectedCurves`    — what the rail's Projected Geometry section
//                                shows (REQ 938).
//
// Pure over SketchState so the solver, the editor, and tests all agree.

import { ExternalRef, SketchConstraint, SketchEntity, SketchState } from './types';

/** Sketch entity kinds that count as "projected geometry" for the rail list.
 * Points are deliberately excluded: an `on-edge` ref on a POINT is usually an
 * incidental snap (a drawn point riding a model edge), not a conversion, and
 * listing every such point would bury the curves the user actually converted.
 * Duplicate detection still covers points — see `findProjectedBySource`. */
const PROJECTED_CURVE_KINDS = new Set(['line', 'circle', 'arc']);

/**
 * Stable identity for the SOURCE of a projection, used to detect "already
 * projected". Two refs that name the same source geometry must produce the
 * same key; two that don't must not collide.
 *
 * Local: the topology id is already namespaced `<featureId>/<localId>`, so the
 * edge/vertex id alone is globally unique — `featureId` is derived from it and
 * adds nothing. `sub` MUST be part of the key: riding an edge and pinning to
 * that edge's projected center are different references to the same edge.
 *
 * Cross-part: `sourceGeomRef.featureId` is always empty in practice and is
 * excluded. The stable id embeds the instance for sibling parts, but skeleton
 * ids (`asketch:<sid>/<eid>`) embed the sketch instead, so `sourceInstanceId`
 * is still needed to keep skeleton refs distinct from sibling-part refs.
 * `definingAssemblyId` guards against the same instance id recurring in a
 * different assembly. Volatile fields (`fallback`, `cachedProjection`,
 * `pinnedSourceCommit`) are excluded — they change on every regen.
 */
export function externalRefKey(ref: ExternalRef | undefined | null): string | null {
  if (!ref) return null;
  // JSON-encoded tuple rather than a delimiter-joined string: cross-part stable
  // ids embed punctuation of their own (`cpe:<inst>:<ptLo>|<ptHi>`), so any
  // single-character separator risks two different refs encoding alike.
  if (ref.scope === 'cross-part') {
    const g = ref.sourceGeomRef ?? ({} as NonNullable<typeof ref.sourceGeomRef>);
    if (!(g.edgeId ?? g.faceId ?? g.vertexId)) return null;
    return JSON.stringify([
      'xp', ref.definingAssemblyId, ref.sourceInstanceId,
      g.edgeId ?? '', g.faceId ?? '', g.vertexId ?? '',
    ]);
  }
  if (!(ref.edgeId ?? ref.vertexId)) return null;
  return JSON.stringify(['local', ref.edgeId ?? '', ref.vertexId ?? '', ref.sub ?? '']);
}

/** Every `on-edge` constraint in the sketch that carries an external ref. */
function onEdgeRefConstraints(state: SketchState): SketchConstraint[] {
  return state.constraints.filter((c) => c.type === 'on-edge' && !!c.externalRef);
}

/**
 * The entity id already projected from `ref`, or null. Covers ALL entity kinds
 * (including points) so a vertex projection can't be duplicated either.
 *
 * Call this against the IN-FLIGHT state when projecting a face or a chain —
 * those loops accumulate many entities before a single commit, so checking the
 * committed document would let intra-batch duplicates through.
 */
export function findProjectedBySource(state: SketchState, ref: ExternalRef | undefined | null): string | null {
  const key = externalRefKey(ref);
  if (!key) return null;
  for (const c of onEdgeRefConstraints(state)) {
    if (externalRefKey(c.externalRef) !== key) continue;
    const entityId = c.targets[0]?.entityId;
    if (entityId && state.entities.some((e) => e.id === entityId)) return entityId;
  }
  return null;
}

export interface ProjectedCurve {
  entityId: string;
  constraintId: string;
  entity: SketchEntity;
  ref: ExternalRef;
  /** Stable source key — also the de-dupe key. */
  sourceKey: string;
  /** True when the source lives in another part or the assembly skeleton. */
  crossPart: boolean;
}

/**
 * Every projected CURVE in the sketch, in entity order. Derived from the
 * document rather than a session log, so the list survives leaving and
 * re-entering the sketch, a reload, or a break-link (which drops the
 * constraint and correctly drops the row).
 */
export function listProjectedCurves(state: SketchState): ProjectedCurve[] {
  const byId = new Map(state.entities.map((e) => [e.id, e] as const));
  const out: ProjectedCurve[] = [];
  const seen = new Set<string>();
  for (const c of onEdgeRefConstraints(state)) {
    const entityId = c.targets[0]?.entityId;
    if (!entityId || seen.has(entityId)) continue;
    const entity = byId.get(entityId);
    if (!entity || !PROJECTED_CURVE_KINDS.has(entity.kind)) continue;
    const ref = c.externalRef!;
    const sourceKey = externalRefKey(ref);
    if (!sourceKey) continue;
    seen.add(entityId);
    out.push({ entityId, constraintId: c.id, entity, ref, sourceKey, crossPart: ref.scope === 'cross-part' });
  }
  return out;
}
