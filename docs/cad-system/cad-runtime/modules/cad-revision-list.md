# cad-revision-list

> **System** ▸ [Overview](../../00-overview.md) ▸ [VCS](../../30-vcs.md) ▸ **cad-revision-list**
> Related: [cad-editor](./cad-editor.md) · [cad-mini-preview](./cad-mini-preview.md) · [cad-preview-3d](./cad-preview-3d.md) · [VCS](../../30-vcs.md)

---

## Requirements

| REQ | Status | Summary |
|-----|--------|---------|
| 702 | unapproved | Compare view between two commits with structural diff + 3D body diff |
| 711 | unapproved | Version-history 3D preview shows stored low-res commit image as placeholder |
| 712 | unapproved | Interactive camera rotation/zoom + point-to-point distance in the 3D preview |
| 732 | unapproved | Branches management tab listing every branch, with Submit/Rebase/Merge/Archive actions |

### REQ 702 — Compare view

- **Description:** The CAD editor shall provide a Compare view between two commits that shows the structural diff (added/removed/modified features and sketches) and, for modified commits, the 3D body diff coloured by face status (unchanged/added/removed).
- **Rationale:** Reviewers need to see what changed between commits geometrically, not just textually.
- **Verification:** Select two commits, open Compare; confirm the structural diff lists changes and the 3D panels colour faces correctly.
- **Validation:** A reviewer can identify a geometric change without reading raw JSON.

---

## Succinct description

The CAD version-history panel: four views (Graph, Diff, Log, Branches) for exploring commit history, comparing commits, and managing draft branches.

## How it works — for everyone (non-technical)

The version history panel is like the "History" pane in a drawing app or the commit log in a code editor. You can see every save (commit) as a dot on a timeline, click a dot to see a thumbnail of what the part looked like, or pick two commits to compare them side-by-side. The Branches tab lists every draft branch and lets you manage them — submit for review, merge changes from main, or archive a finished branch.

## How it works — in detail (technical)

**Selector:** `app-cad-revision-list`

Loaded as a standalone route for the part's CAD history page (linked from the part detail page's CAD tab).

### Four views

`view` signal is one of `'timeline' | 'compare' | 'table' | 'branches'`.

**Timeline (Graph):** Fetches `GET /api/design/cad-model/:id/history/graph` → `CadVersionGraph`. Lays out the DAG with two swim-lanes (main/experiment). SVG edges are cubic bezier paths; node circles are clickable to select a commit. The selected commit triggers `GET /api/design/cad-model/:id/commits/:hash` to load full commit details + a `CadMiniPreviewComponent`.

**Diff (Compare):** Two commit selectors feed `GET /api/design/cad-model/:id/diff?a=HASH&b=HASH` → `CadCommitDiff`. Structural diff entries are formatted via `formatDiffEntry` from `cad/lib/diffFormat.ts`. Two `CadPreview3dComponent` instances render the geometry of each commit with face coloring by `FaceStatus`. The camera-lock toggle (REQ 726) links both preview cameras via the `PreviewCamera` output/input pair.

**Log (Table):** A dense table of all commits with hash, message, author, tags, workflow state badge, and a `CadMiniPreviewComponent` thumbnail per row.

**Branches:** Lists all branches via `GET /api/design/cad-model/:id/branches`. Each row shows branch name, head hash, behind-main status, and action buttons: Submit, Merge (reconcile), Archive. Merge opens a feature-picker panel populated from `GET /api/design/cad-model/:id/branches/:name/diff`.

### Workflow state badges

`n.state` maps to CSS class `draft | in_review | approved | released`, producing a colour chip: grey/blue/green/teal.

## Key files

- `frontend/src/app/components/cad/cad-revision-list/cad-revision-list.component.ts`
- `frontend/src/app/cad/lib/diffFormat.ts` — `formatDiffEntry`, `FormattedDiff`
- `frontend/src/app/models/cad-model.model.ts` — `CadVersionGraph`, `CadVersionNode`, `CadCommitDiff`, `FaceStatus`
- `frontend/src/app/components/cad/cad-mini-preview/cad-mini-preview.component.ts`
- `frontend/src/app/components/cad/cad-preview-3d/cad-preview-3d.component.ts`
