// REQ 877 — stale uncommitted-changes warning. A working copy that is dirty
// and hasn't seen a content save for this long warns the lock holder in the
// editor. Clocked from `lastContentSavedAt` (content saves only — renames,
// lock heartbeats, and default-view saves don't reset it).

export const STALE_DIRTY_THRESHOLD_MS = 4 * 60 * 60 * 1000;

/** Age of the uncommitted work in ms once past the threshold, else null.
 * Null for clean copies, missing/unparseable timestamps (legacy rows), and
 * work under the threshold. */
export function staleDirtyAgeMs(
  model: { dirty?: boolean; lastContentSavedAt?: string | null },
  nowMs: number,
): number | null {
  if (!model.dirty || !model.lastContentSavedAt) return null;
  const saved = Date.parse(model.lastContentSavedAt);
  if (Number.isNaN(saved)) return null;
  const age = nowMs - saved;
  return age >= STALE_DIRTY_THRESHOLD_MS ? age : null;
}

/** Humanized age for the banner: whole hours under a day, whole days after. */
export function formatStaleAge(ms: number): string {
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}
