// REQ 775/776/777/778 — cross-part Convert Entities support for the assembly
// editor. Pure helpers (no Angular/Three) so they unit-test cleanly:
//   - parse the `instanceId::rawId` scoped ids that composed assembly geometry
//     carries (assemblyRegenService scopeId), to tell a cross-instance pick from
//     a same-part one;
//   - build the `scope:'cross-part'` externalRef for an on-edge constraint;
//   - classify a cross-part ref's status (out-of-context / stale / cyclic /
//     broken / ok) for the feature-tree + sketch-overlay badges.
import type { ExternalRef } from './types';

export type CrossPartExternalRef = Extract<ExternalRef, { scope: 'cross-part' }>;
export type CrossPartFallback = NonNullable<CrossPartExternalRef['fallback']>;

/** REQ 915 — sentinel `sourceInstanceId` marking a cross-part ref whose source
 * is the defining assembly's own SKELETON sketch (not a component instance).
 * Mirrors the backend constant in assemblyRegenService.js. */
export const SKELETON_INSTANCE_ID = '__skeleton__';

/** True when a cross-part ref sources the assembly skeleton. */
export function isSkeletonRef(er: ExternalRef | undefined | null): boolean {
  return !!er && er.scope === 'cross-part' && er.sourceInstanceId === SKELETON_INSTANCE_ID;
}

/** Split a composed-assembly scoped id `instanceId::rawId` (rawId is the source
 * part's own face/edge id). Returns null for an unscoped (same-part) id. */
export function parseScopedId(scopedId: string): { instanceId: string; rawId: string } | null {
  const i = scopedId.indexOf('::');
  if (i < 0) return null;
  return { instanceId: scopedId.slice(0, i), rawId: scopedId.slice(i + 2) };
}

export interface CrossPartPick {
  /** The picked geometry's composed id, e.g. `i2::f1#0-e0`. */
  scopedId: string;
  /** The source instance's underlying Part id. */
  sourcePartId: number;
  /** The assembly being edited (defines the relative transform). */
  definingAssemblyId: number;
  definingAssemblyRepoId: string;
  /** Stability fallback captured at pick time, in the SOURCE part's frame. */
  fallback?: CrossPartFallback;
}

/** Build the cross-part externalRef for an on-edge constraint from a pick on
 * another instance's geometry. Returns null when the pick is NOT instance-scoped
 * (i.e. it belongs to the part being edited — use a local ref instead). */
export function buildCrossPartExternalRef(pick: CrossPartPick): CrossPartExternalRef | null {
  const parsed = parseScopedId(pick.scopedId);
  if (!parsed) return null;
  const rawId = parsed.rawId;
  const featureId = rawId.split('/')[0] ?? '';
  return {
    scope: 'cross-part',
    definingAssemblyId: pick.definingAssemblyId,
    definingAssemblyRepoId: pick.definingAssemblyRepoId,
    sourceInstanceId: parsed.instanceId,
    sourcePartId: pick.sourcePartId,
    sourceGeomRef: { featureId, edgeId: rawId },
    fallback: pick.fallback,
    pinnedSourceCommit: null,
  };
}

export type CrossPartRefStatus = 'ok' | 'out-of-context' | 'stale' | 'cyclic' | 'broken';

/** Classify a cross-part ref for badge display, given the assembly currently open
 * in the editor and the regen `errors` array. `broken` is passed in by the caller
 * (it knows whether the last resolve produced geometry). */
export function classifyCrossPartRef(
  er: CrossPartExternalRef,
  opts: { openAssemblyId?: number | null; errors?: string[]; broken?: boolean } = {},
): CrossPartRefStatus {
  const { openAssemblyId, errors = [], broken } = opts;
  if (broken) return 'broken';
  if (openAssemblyId != null && er.definingAssemblyId !== openAssemblyId) return 'out-of-context';
  if (errors.some((e) => /Cyclic in-context/.test(e) && e.includes(er.sourceInstanceId))) return 'cyclic';
  if (er.cachedProjection?.stale) return 'stale';
  return 'ok';
}

/** Human label for a status badge. */
export function crossPartStatusLabel(s: CrossPartRefStatus): string {
  switch (s) {
    case 'out-of-context': return 'Out of context';
    case 'stale': return 'Out of date';
    case 'cyclic': return 'Cyclic reference';
    case 'broken': return 'Broken reference';
    default: return 'In context';
  }
}
