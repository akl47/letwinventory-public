# Harness design tool as a mode of the CAD app — plan

Status: **phase 1 (backend) and phase 2 (editor) written; migration applied to dev; no test suite run and not yet seen in a browser. Phase 3 not started.** Branch `harness-cad-shell`, 2026-11-14.

## Direction (as decided)

- **Frontend:** one tool. The harness editor becomes a *mode* of the CAD editor
  (like assembly mode): same part tabs, ribbon, rail and footer. Harness editing
  behaves as it did in the old harness tool (canvas, dialogs, properties).
- **Backend:** separate. Harnesses keep their own tables (`WireHarnesses`,
  `HarnessRevisionHistory`), API (`/api/parts/harness`) and permission resource
  (`harness`).
- **Workflow:** the harness backend gets its own copy of the CAD workflow —
  check out / check in, draft branches off a protected `main`, commit history,
  Release to a numeric revision, approval-gated Production (letter) release.

"Separate backend" here means separate tables, API, permissions and repositories.
The document-agnostic VCS library (`backend/services/vcs/vcsWorkingCopy`,
`vcsBranchOps`, `vcsRelease`, `workflowEngine`, object/ref store) is reused through
a harness binding rather than copy-pasted; harness repositories live in the shared
`VcsObjects` / `VcsRefs` tables under `repoType: 'harness'`.

## Phase 1 — backend (written)

| Piece | Where |
|---|---|
| Working-copy columns on `WireHarnesses` (`branchName`, `baseCommitHash`, `dirty`, `lastContentSavedAt`, lock trio, `releaseLocked`, `createdByUserID`) and the `harness.approve` permission | `backend/migrations/20261114000000-harness-version-control.js` (**not applied**), `backend/models/parts/WireHarness.js` |
| Serializer: one blob per connector / cable / component / connection / sub-harness + a meta blob | `backend/services/vcs/harnessSerializer.js` |
| Binding, revision numbering, repo adoption, release | `backend/services/vcs/harnessVcsService.js` |
| Harness review workflow (`harness.write` / `harness.approve`) | `backend/services/vcs/workflowEngine.js` |
| Endpoints | `backend/api/parts/harness/{controller,routes}.js` |
| Diff labels for harness elements | `backend/services/vcs/cadDiffService.js` |
| Tests | `backend/tests/__tests__/parts/harness-vcs.test.js`, `harness-serializer.test.js`; `harness.test.js` trimmed |

Model:

- One repository per `WireHarness` row (`repoId` = row id).
- Released revision labels are write-once tags; `WireHarness.revision` is the
  working revision (the released label on `main`, the next numeric on a draft branch).
  No `Parts` row is minted per revision — that is the one deliberate difference from CAD.
- `PUT /:id` saves content only for the holder of an unexpired checkout on a
  draft branch (423 otherwise), with the same stale-save token check as CAD (409).
- `POST /:id/release` on a checked-in draft branch → next numeric revision, tag,
  `releaseLocked`, branch archived. Refused if dirty, checked out by someone else,
  behind main, or a sub-harness is unreleased (the message names them).
- `POST /:id/production-release` → next letter tag on the same commit; needs an
  approval of that commit by someone other than the submitter.
- Harnesses that predate this are adopted on first access, no data migration:
  released → `main` tagged with its revision; anything else → `draft/<rev>` with
  its content as uncommitted changes.

Removed endpoints: `submit-review`, `reject`, `release-production`, `revert`
(replaced by workflow, production-release and undo-checkout / history).

## Phase 2 — editor (written)

- Route `/harness/editor/:id` → `CadEditorComponent` with the `harnessMode` route flag
  (a harness need not have a part, so it is addressed by harness id). `/harness` and
  `/harness/editor` redirect to the CAD landing page.
- `HarnessEditController` (`frontend/src/app/components/harness/harness-edit.controller.ts`),
  provided per editor like `AssemblyEditController`, carries the logic of the old harness
  page: document, selection, tools, dialogs, parts sync, undo/redo, debounced save with the
  save token. The editor mirrors `hx.harness()` into `model()` so the shared File tab reads it
  as it reads a CAD model, and pushes its `readonly()` into the controller.
- The File tab's shared verbs go through `vcsApi` — `HarnessService` in harness mode,
  `CadModelService` otherwise (same method shapes).
- Viewport: `app-harness-canvas` instead of the 3D viewer. Left rail: `app-harness-property-panel`.
  Ribbon: **Harness** tab (tools, insert, arrange, undo/redo), **Visualize** (zoom, grid, bounds),
  **File** gains Import/Export JSON and Export PNG.
- CAD part tabs: `CadTab.harnessID`, identity via `tabKey()`.
- CAD landing page lists harnesses (Harness type chip, New harness); reachable with `cad` or
  `harness` permission. Nav "Harness Design" entry removed.
- Removed: `harness-page`, `harness-toolbar`, `harness-list-view`, and the restyle's status
  footer, document tabs and tab service.
- Tests written: `harness-edit.controller.spec.ts`, `cadTabs.spec.ts` additions, `e2e/harness.spec.ts`.

Known gaps: editing a sub-harness in place from its parent is refused unless that sub-harness
is also checked out; the History button is hidden in harness mode until phase 3.

## Phase 3 — history and leftovers

- Version history / compare for harnesses (commit thumbnails from the canvas PNG).
- Merge for a draft branch that is behind main (per-element picker). Until then a
  behind-main branch cannot be released; this only arises with two concurrent draft branches.
- Sub-harness references pinned to a commit at check-in.
- e2e spec; docs.

## Requirements

- REQ 1062–1066 — harness version control backend (unapproved).
- REQ 1067–1068 — harness mode in the CAD editor; landing page, tabs and routes (unapproved).
- REQ 1057–1061 — from the abandoned restyle; superseded by 1067–1068, to be deleted in the UI.

## Notes

- `HarnessRevisionHistory` now records only `created`, `released` and
  `production_release`; day-to-day history is the commit log.
- The wire-end / midpoint findings in `docs/harness-editor-review.md` are
  independent of this work and still open.
