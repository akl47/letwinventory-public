// Translates technical CAD error messages (from profile.ts, the kernel, the
// solver, etc.) into user-actionable hints. Keep the original error attached
// in the result so the console / dev tools still have the full detail; the
// user gets the friendly summary.
//
// New cases: add an entry to `MAPPERS` ordered most-specific-first so the
// first match wins. Each mapper takes the raw message and returns either a
// friendly string or null (no match → fall through).

type Mapper = (raw: string) => string | null;

const MAPPERS: Mapper[] = [
  // Profile extraction failures from extractClosedLoops / extractClosedLoop.
  (raw) => /open chain detected at point/i.test(raw) || /open chain at point/i.test(raw)
    ? 'Sketch has a loose endpoint — make sure every line connects to form a closed shape.'
    : null,
  (raw) => /point.*touches.*edges/i.test(raw)
    ? 'A point is shared by more than two lines — closed profiles can only fork through arcs or circles, not by stacking lines.'
    : null,
  (raw) => /sketch has no lines/i.test(raw)
    ? 'Sketch is empty — draw a closed shape before extruding.'
    : null,
  (raw) => /closed profile requires at least 3 line segments/i.test(raw)
    ? 'Profile needs at least 3 line segments to form a closed shape.'
    : null,
  (raw) => /no closed loops in sketch/i.test(raw)
    ? 'No closed shape found in this sketch. Draw a rectangle, polygon, or circle first.'
    : null,

  // Known kernel limits we ship around.
  (raw) => /'circle' edge mixed into a polygon profile/i.test(raw)
    ? 'A circle cannot be combined with other lines in the same profile yet — draw it as its own shape.'
    : null,
  (raw) => /profile must have at least 3 edges/i.test(raw)
    ? 'Profile needs at least 3 connected edges.'
    : null,

  // Mixed-curve loops (slots, ellipses, splines) — not yet supported by the
  // straight-line + single-circle profile walker.
  (raw) => /arc.*not yet supported|mixed.*line.*arc.*not supported/i.test(raw)
    ? 'Profiles mixing lines and arcs (e.g. slots) are not yet extrudable. This shape is work in progress.'
    : null,

  // Kernel transport problems.
  (raw) => /kernel unavailable|kernel disconnected|ECONNREFUSED|socket closed/i.test(raw)
    ? 'CAD kernel is not running. Start the kernel service and try again.'
    : null,
  (raw) => /timed out/i.test(raw)
    ? 'CAD kernel did not respond in time. Check the kernel logs for what it is doing.'
    : null,

  // Solver complaints.
  (raw) => /over-constrained|conflicting constraints/i.test(raw)
    ? 'Sketch is over-constrained — remove a constraint to make the system solvable.'
    : null,
];

export function friendlyError(raw: string | null | undefined): string {
  if (!raw) return 'Something went wrong.';
  const trimmed = raw.trim();
  for (const m of MAPPERS) {
    const friendly = m(trimmed);
    if (friendly) return friendly;
  }
  return trimmed;
}
