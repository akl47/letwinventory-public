# errorMessages.ts

> **System** ▸ [Overview](../../00-overview.md) ▸ [CAD Modeler](../../10-cad-modeler.md) ▸ [Modeler overview](../00-overview.md) ▸ **errorMessages.ts**
> Related: [equations.ts](./equations.md) · [Sketching group page](../sketching.md) · [Profiles and arrangement](../profiles-arrangement.md)

---

## Requirements

No single requirement maps exclusively to this module. `friendlyError` is infrastructure that supports the user-visible error requirements across the modeler, including REQ 526 (reject inconsistent constraints with a user-visible message) and REQ 532 (present a rejection message when a constraint is rejected). Governed by the [modeler overview](../00-overview.md).

---

## Succinct description

`errorMessages.ts` translates raw technical error strings from the profile extractor, solver, and kernel transport into concise, user-actionable sentences via a priority-ordered list of regex mappers.

---

## How it works — for everyone (non-technical)

When something goes wrong — a sketch isn't closed, the constraint solver can't find a solution, the geometry engine isn't running — this module intercepts the technical error message and replaces it with plain English that tells you what to fix, rather than showing you an internal program error.

---

## How it works — in detail (technical)

### Exported API

Single export: `friendlyError(raw: string | null | undefined): string`.

Returns a human-readable sentence. If no mapper matches, returns the trimmed raw string unchanged. If `raw` is null/undefined/empty, returns `'Something went wrong.'`

### Mapper table (priority order, first match wins)

| Category | Raw pattern (regex) | Friendly message |
|----------|--------------------|--------------------|
| Profile: open chain | `/open chain detected at point/i` or `/open chain at point/i` | "Sketch has a loose endpoint — make sure every line connects to form a closed shape." |
| Profile: branching point | `/point.*touches.*edges/i` | "A point is shared by more than two lines — closed profiles can only fork through arcs or circles, not by stacking lines." |
| Profile: empty | `/sketch has no lines/i` | "Sketch is empty — draw a closed shape before extruding." |
| Profile: too few segments | `/closed profile requires at least 3 line segments/i` | "Profile needs at least 3 line segments to form a closed shape." |
| Profile: no loops | `/no closed loops in sketch/i` | "No closed shape found in this sketch. Draw a rectangle, polygon, or circle first." |
| Kernel: circle mixed | `/'circle' edge mixed into a polygon profile/i` | "A circle cannot be combined with other lines in the same profile yet — draw it as its own shape." |
| Kernel: too few edges | `/profile must have at least 3 edges/i` | "Profile needs at least 3 connected edges." |
| Mixed arc/line (slots) | `/arc.*not yet supported\|mixed.*line.*arc.*not supported/i` | "Profiles mixing lines and arcs (e.g. slots) are not yet extrudable. This shape is work in progress." |
| Kernel unavailable | `/kernel unavailable\|kernel disconnected\|ECONNREFUSED\|socket closed/i` | "CAD kernel is not running. Start the kernel service and try again." |
| Kernel timeout | `/timed out/i` | "CAD kernel did not respond in time. Check the kernel logs for what it is doing." |
| Solver over-constrained | `/over-constrained\|conflicting constraints/i` | "Sketch is over-constrained — remove a constraint to make the system solvable." |

### Extension pattern

New cases are added to the module-level `MAPPERS` array. Place more-specific patterns before more-general ones; the first non-null return wins. Each mapper is `(raw: string) => string | null`.

---

## Key files

- `frontend/src/app/cad/lib/errorMessages.ts` — this module
- `frontend/src/app/cad/lib/errorMessages.spec.ts` — unit tests
