// REQ 989 — why a CAD ribbon action is unavailable, as hover-tooltip text.
//
// Each check is [blocked, reason]; the first blocked one wins, so list them in
// priority order (read-only before "exit the sketch" before missing geometry).
// null = available: the button keeps its normal tooltip.

export type DisabledCheck = readonly [blocked: boolean, reason: string];

export function disabledReason(...checks: DisabledCheck[]): string | null {
  for (const [blocked, reason] of checks) if (blocked) return reason;
  return null;
}

export const DISABLED_REASON = {
  inSketch: 'Exit the sketch first',
  noBody: 'Needs a solid body — extrude a sketch first',
  twoBodies: 'Needs at least two bodies',
  twoSketches: 'Needs at least two sketches (profile + path)',
  notCheckedOutByMe: 'Check out the part first',
  lockedByMe: 'Already checked out by you',
  lockedByOther: 'Checked out by another user',
  needsApproval: 'Requires workflow approval first',
  needsTwoCommits: 'Needs at least two commits to compare',
  loading: 'Loading…',
  busy: 'Working…',
  selectComponent: 'Select a component first',
  twoComponents: 'Needs at least two components',
  noSketch: 'Open a sketch first — Features → Sketch',
  selectGeometry: 'Select sketch geometry first',
  selectProjected: 'Select a projected (linked) entity first',
  fullyDefined: 'Sketch is already fully defined',
} as const;
