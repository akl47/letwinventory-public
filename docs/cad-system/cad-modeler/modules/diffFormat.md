# diffFormat.ts

> **System** ▸ [Overview](../../00-overview.md) ▸ [CAD Modeler](../../10-cad-modeler.md) ▸ [Modeler overview](../00-overview.md) ▸ **diffFormat.ts**
> Related: [VCS](../../30-vcs.md) · [Feature tree group page](../feature-tree.md)

---

## Requirements

Governed by the VCS and modeler documentation. Directly supports:

| REQ | Status | Summary |
|-----|--------|---------|
| 700 | unapproved | Diff shall report which parameters changed, with before/after values |
| 714 | unapproved | Modified sketch diff shall list specific entity and constraint changes |

---

## Succinct description

`diffFormat.ts` converts a raw `CadDiffEntry` (from the backend's structural diff) into human-readable `FormattedDiff` lines for the version-history Compare view and the check-in dialog.

---

## How it works — for everyone (non-technical)

When you compare two versions of a part, the system produces a list of what changed. This module turns those raw change records into the labeled lines you see — "Extrude 1 — distance 5 → 10", "Sketch — 2 lines moved, 1 Coincident added" — using the right symbols (+ for added, − for removed, ~ for modified) and friendly names for every constraint and entity type.

---

## How it works — in detail (technical)

### Exported types

- `DiffLine` — `{ sign: string; cls: string; text: string }` — one rendered line. `cls` is `'add'`, `'del'`, or `'mod'` (CSS class hook for color).
- `FormattedDiff extends DiffLine` — adds `sublines: DiffLine[]` for sketch sub-details.

### Exported function

`formatDiffEntry(e: CadDiffEntry): FormattedDiff`

Produces one top-level line plus optional sketch sub-lines. The top-level label prefers `e.displayName` (resolved by the backend from the feature tree), then strips the `feature:` / `sketch:` prefix from `e.name`, then uses `e.name` verbatim. A `paramDiff.changed` array is summarized inline as `— key a → b` (up to 3 parameters).

### Sketch sub-lines (`sketchSublines`)

For a modified sketch entry with a `sketchDiff` payload:
1. **Constraints first:** one sub-line per constraint change (`added` / `removed` / `modified`). Modified constraints include `value before → after`. Uses `CONSTRAINT_LABEL` for human names.
2. **Entity changes grouped by kind and status:** entities are bucketed by `"status|kind"`, then each bucket emits one summary line (`"2 lines"`, `"1 circle moved"`, etc.). This prevents a solver re-positioning every point from burying the actual user change in noise.
3. **Meta changes:** `mt.key a → b` for sketch-level metadata changes (e.g. plane or origin).

### Label tables

`ENTITY_LABEL` maps kind strings (`point`, `line`, `circle`, `arc`, `ellipse`, `ellipticalArc`, `spline`, `conic`, `text`, `picture`, `equation`, `intersection`, `splineOnSurface`) to display names.

`CONSTRAINT_LABEL` maps constraint type strings to display names, including `coincident`, `fixed`, `horizontal`, `vertical`, `distance`, `perpendicular`, `parallel`, `tangent`, `equal`, `symmetric`, `midpoint`, `concentric`, `coradial`, `collinear`, `radius`, `diameter`, `angle`, `horizontal-distance`, `vertical-distance`, `point-line-distance`, `arc-length`, `chord-distance`, `on-edge`.

### `val` helper

Formats parameter values for display: `undefined`/`null` → `∅`; integers → string; floats → up to 3 decimal places with trailing zeros stripped; objects → `JSON.stringify`; other → `String`.

---

## Key files

- `frontend/src/app/cad/lib/diffFormat.ts` — this module
- `frontend/src/app/cad/lib/diffFormat.spec.ts` — unit tests
- `frontend/src/app/models/cad-model.model.ts` — defines `CadDiffEntry` consumed here
