// REQ 878 — Onshape-style instant rollback. Moving the rollback bar is a pure
// view change over already-computed features; the editor repaints from the
// cached regen response and only re-runs the kernel when the newly-visible
// range was never built. `cacheCoversRollback` decides that: it returns true
// when the cached feature set already covers every VISIBLE SOLID feature below
// the bar, so the repaint is the whole job.

export interface RollbackFeatureMeta {
  id: string;
  type: string;
  suppressed?: boolean;
  visible?: boolean;
}

/**
 * True when `cachedIds` holds a result for every visible solid feature at a
 * tree index below `cutoff` (null = roll to end → all features).
 *
 * Excluded from the requirement (they never appear as body results in a regen
 * response, so their absence is not a cache gap):
 *   - `origin`
 *   - datum features (datumPlane / datumAxis / datumPoint) — reference geometry
 *   - suppressed features (skipped by regen)
 *   - hidden features (`visible === false`)
 */
export function cacheCoversRollback(
  features: RollbackFeatureMeta[],
  cachedIds: ReadonlySet<string>,
  cutoff: number | null,
): boolean {
  if (cachedIds.size === 0) return false; // nothing cached yet — must regen
  const limit = cutoff === null ? features.length : cutoff;
  for (let i = 0; i < features.length && i < limit; i++) {
    const f = features[i];
    if (f.type === 'origin') continue;
    if (f.type === 'datumPlane' || f.type === 'datumAxis' || f.type === 'datumPoint') continue;
    if (f.suppressed === true) continue;
    if (f.visible === false) continue;
    if (!cachedIds.has(f.id)) return false; // a visible feature was never built
  }
  return true;
}
