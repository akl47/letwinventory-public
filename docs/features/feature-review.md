# Feature Review System

## Context

Today, features in the repo are tracked as 20 free-form Markdown files under `docs/features/*.md`. Each file follows a loose template (Context → Requirements with REQ IDs inline → API Contracts → DB Changes → UI → Tests → Implementation Notes). This has three structural problems:

1. **No referential integrity.** Requirements live in the database with `projectID` FKs and an audit history, but the MD docs reference them only by string IDs ("REQ 193–213"). Renames or merges silently rot the docs.
2. **No review workflow.** Features ship without formal sign-off. `EngineeringMaster` and `WireHarness` already have a `draft → review → released` workflow; features should too.
3. **No code traceability.** Nothing in the system links a feature to the branch / PR / commits that implemented it. You can't ask "what work shipped REQ 234?" and get a structured answer.

This feature replaces the MD docs with a database-backed `DesignFeature` entity that:
- Belongs to a Planning `Project` (so the system spans multiple projects).
- Runs through a 4-state formal review workflow.
- Owns its requirements via FK on `DesignRequirements`.
- Stores manual GitHub linkage (branch, PR URL, commit list).
- Has an immutable audit history.

After the system ships, a one-shot script backfills the existing 20 MD docs into the database and deletes them.

## Requirements

> Naming convention: tables/models in the design domain are prefixed `Design*` to match `DesignRequirement` and recently-confirmed user preference.

> All requirements live in **Design Controls** (categoryID 3) under root **REQ 300** (parented to REQ 105 — design review at defined stages). REQ IDs noted on each requirement below.

### F1. DesignFeature entity (REQ 301)

- **Description:** A `DesignFeatures` table stores feature records with `name`, `slug` (unique), `description`, `markdownBody`, `projectID` FK to `Projects`, owner / reviewer / approver / releaser user FKs, and timestamps. `activeFlag` for soft delete.
- **Rationale:** Database-backed records replace MD files, giving referential integrity to requirements and traceability across projects.
- **Verification:** Backend test creates feature, retrieves it, asserts all fields persist; unique constraint on slug rejected duplicates.
- **Validation:** User can browse and search features in the UI, grouped by project.

### F2. Four-state review workflow (REQ 302)

- **Description:** `DesignFeature.reviewState` enum with values `draft`, `in_review`, `approved`, `released`. Transitions enforced server-side: draft→in_review (submit), in_review→approved (approve), in_review→draft (reject), approved→released (release). PUT on a `released` feature is rejected. Edits to an `approved` feature reset it to `in_review`.
- **Rationale:** Formal sign-off matches the existing `EngineeringMaster` and `WireHarness` patterns and makes feature reviews a controlled artifact rather than an informal MD edit.
- **Verification:** Backend tests for each transition (happy path + invalid transitions return 4xx with human messages).
- **Validation:** User on the edit page sees the appropriate state-transition button; disabled buttons show tooltips explaining why.

### F3. Audit history table (REQ 303)

- **Description:** `DesignFeatureHistory` table mirrors `RequirementHistory` schema: `id`, `designFeatureID` FK, `changeType` enum, `changes` JSON, `snapshotData` JSON nullable, `changedByUserID` FK, `createdAt`. All controller mutations record a row.
- **Rationale:** Immutable audit trail required for the same reason `RequirementHistory` exists — reviewable history for regulated processes.
- **Verification:** Backend tests assert a history row is created on every mutation type with correct `changeType` and `changedByUserID`.
- **Validation:** Edit page shows a collapsible history timeline matching the existing requirement-edit-page pattern.

### F4. Requirement linkage via designFeatureID FK (REQ 304)

- **Description:** Add nullable `designFeatureID` INTEGER FK to `DesignRequirements`, ON DELETE SET NULL. One feature owns many requirements; requirements can exist without a feature (system-level / cross-cutting). New endpoints: `POST /api/design/feature/:id/link-requirement` (body `{requirementID}`) and `DELETE /api/design/feature/:id/link-requirement/:reqId`.
- **Rationale:** Restores the implicit "REQ 193–213 belong to kitting" relationship from MD docs as a structured FK that the system can navigate.
- **Verification:** Backend tests for link / unlink endpoints; FK constraint test; cascade behavior on feature delete.
- **Validation:** Edit page has a "Linked Requirements" panel with autocomplete to add and a remove control; rows link to the requirement edit page.

### F5. GitHub linkage fields (REQ 305)

- **Description:** `branchName` STRING(255), `prURL` STRING(500), `commitRefs` JSON column storing array of `{sha, url, subject?}`. No external API calls — purely manual fields.
- **Rationale:** User-confirmed scope: connect a feature to its implementing work without pulling in GitHub auth / rate limits / webhooks. Subject is optional so users can paste commit URLs without manual data entry.
- **Verification:** Backend test creates a feature with all three fields populated and round-trips them; rejects malformed `commitRefs` (non-array, missing sha).
- **Validation:** UI shows clickable cards for the PR and each commit, parsed via the GitHub link pipe.

### F6. Permissions (REQ 306)

- **Description:** New permission resource `features` with actions `read`, `write`, `delete`. New special action `features.approve` for the approve / release transitions (analogous to `requirements.approve`). Seeded in the migration AND in `backend/tests/setup.js`.
- **Rationale:** Reviewer ≠ author. The user wanted "more formal" review, so the gate on approval/release is a separate permission from general read/write.
- **Verification:** Backend tests confirm 403 without `features.approve` on the approve and release endpoints.
- **Validation:** Approve/Release buttons disabled with tooltip when the user lacks `features.approve`.

### F7. REST API surface (REQ 307)

- **Description:** New router under `/api/design/feature/` mirroring `requirement` shape. Endpoints: list (with `projectID`, `reviewState`, `ownerUserID` filters), get-by-id (includes linked requirements + history), create, update, soft-delete, submit/approve/reject/release, link-requirement, unlink-requirement, history. All errors follow CLAUDE.md §2.5 (catch SequelizeUniqueConstraintError and FK violations with human messages).
- **Rationale:** Standard REST surface needed for both the frontend and the CLI.
- **Verification:** Backend tests for every endpoint; permission tests for write/approve/delete actions.
- **Validation:** Frontend pages successfully call all endpoints; CLI works end-to-end.

### F8. Frontend list view (REQ 308)

- **Description:** `/features` route renders a table grouped by project: columns `name`, `owner`, `reviewState` chip, `requirement count`, `branchName` link. Filters: project select, review state select, owner select.
- **Rationale:** First-class list view replaces the implicit "browse `docs/features/`" workflow.
- **Verification:** Karma spec for filters, sort, empty state, error state.
- **Validation:** User can browse all features for a project at a glance and click into one to edit.

### F9. Frontend edit page (REQ 309)

- **Description:** `/features/:id/edit` with sections: header (name/slug/project/owner/reviewer), workflow control buttons gated by current `reviewState` and permissions, markdown body editor (textarea + preview), GitHub links panel (branch/PR/commits with add-row), Linked Requirements panel (autocomplete + list), collapsible history timeline.
- **Rationale:** Single page captures everything that used to live in an MD doc plus the new structured fields.
- **Verification:** Karma spec for each section; Playwright happy-path test.
- **Validation:** User can author a complete feature record without ever touching the filesystem.

### F10. GitHub link pipe (REQ 310)

- **Description:** `frontend/src/app/pipes/github-link.pipe.ts` parses a GitHub URL (pull or commit) and returns a structured `{type, owner, repo, ref, label}` for the template to render as a clickable card.
- **Rationale:** Make pasted URLs render as nice cards without backend round-trips or API auth.
- **Verification:** Karma spec covers PR URLs, commit URLs, malformed URLs (returns null), short-SHA rendering.
- **Validation:** Pasted URLs render readably in the edit and list views.

### F11. Migration script for existing MD docs (REQ 311)

- **Description:** `scripts/migrate-feature-docs.js` reads each `docs/features/*.md`, derives `slug` from filename and `name` from H1 (or filename), uses full file as `markdownBody`, sets `projectID=1`, `reviewState='released'`, `ownerUserID=claude@letwin.co`. Regex-scans body for `REQ\s*(\d+)` and any `(\d+)–(\d+)` pattern and links matching requirements by setting `designFeatureID`. Prints summary table. Supports `--dry-run`. After successful run, the MD files are deleted in a separate commit step.
- **Rationale:** Backfill historical features rather than start fresh; preserves the documentation already written.
- **Verification:** Dry-run mode prints the plan without writing. Run on a test fixture confirms expected feature/requirement linkage. Idempotent re-run (matches by slug) doesn't duplicate.
- **Validation:** After running, all 20 MD docs become DesignFeature rows; spot-check (e.g. kitting feature has REQ 193–213 linked).

### F12. CLI: scripts/feature.js (REQ 312)

- **Description:** Sister CLI to `req.js`. Commands: `list [--project <id>] [--state <state>]`, `get <id>`, `create <json>`, `update <id> <json>`, `submit <id>`, `approve <id>`, `reject <id>`, `release <id>`, `link-req <featureId> <reqId>`, `unlink-req <featureId> <reqId>`. Same auth pattern (test-login, JWT cached in /tmp).
- **Rationale:** Lets the slash command and humans manage features from the terminal without spinning up the UI.
- **Verification:** Manual exercise of each command against a running backend.
- **Validation:** `/feature` slash command and ad-hoc admin work runs through this CLI.

### F13. /feature slash command writes to DB (REQ 313)

- **Description:** Update `.claude/commands/feature.md` so step 1 ("Write Feature Spec") creates a `DesignFeature` record via `node scripts/feature.js create` instead of writing to `docs/features/<name>.md`. Subsequent requirement creation calls `req.js create` with `--feature <id>` (new flag in `req.js`) so the requirement is linked at creation.
- **Rationale:** Closes the loop: the workflow that generated the MD docs we're killing now generates DB records instead.
- **Verification:** Manual run of `/feature <name>` against the system; confirm a DesignFeature record exists with linked requirements.
- **Validation:** Future features are tracked in the DB by default; no new MD files appear under `docs/features/`.

## API Contracts

| Method | Path | Request | Response (200) |
|--------|------|---------|---------------|
| GET | `/api/design/feature` | `?projectID=&reviewState=&ownerUserID=` | `[{id, name, slug, description, projectID, reviewState, ownerUserID, branchName, prURL, requirementCount, ...}]` |
| GET | `/api/design/feature/:id` | — | `{...all fields, requirements: [...], recentHistory: [...]}` |
| POST | `/api/design/feature` | `{name, slug, description, markdownBody, projectID, ownerUserID, reviewerUserID?, branchName?, prURL?, commitRefs?}` | created feature |
| PUT | `/api/design/feature/:id` | partial body | updated feature |
| DELETE | `/api/design/feature/:id` | — | `{success: true}` |
| POST | `/api/design/feature/:id/submit` | — | feature with `reviewState='in_review'` |
| POST | `/api/design/feature/:id/approve` | — | feature with `reviewState='approved'`; requires `features.approve` |
| POST | `/api/design/feature/:id/reject` | `{reason?}` | feature with `reviewState='draft'` |
| POST | `/api/design/feature/:id/release` | — | feature with `reviewState='released'`; requires `features.approve` |
| POST | `/api/design/feature/:id/link-requirement` | `{requirementID}` | `{success: true}` |
| DELETE | `/api/design/feature/:id/link-requirement/:reqId` | — | `{success: true}` |
| GET | `/api/design/feature/:id/history` | `?offset=&limit=` | paginated history rows with user info |

Errors: `SequelizeUniqueConstraintError` on slug → `"A Feature with slug 'x' already exists"`. FK violation on projectID/ownerUserID/requirementID → human message naming the missing entity. Invalid state transition → `"Cannot approve a feature in state 'draft' — submit for review first"`.

## UI Design

**`/features` (list view)**
- Page header with project filter, state filter, owner filter, search box, "+ New Feature" button.
- Table grouped by project (collapsible groups). Columns: Name (link), Owner avatar+name, State chip, Req count, Branch (link if set), Updated.
- Empty state: "No features yet for this project. Create one to get started."
- Loading state: skeleton rows.

**`/features/new`**
- Two-field form: Name + Project (select). On submit, creates a draft feature and routes to the edit page.

**`/features/:id/edit`**
- Header card: name (editable), slug (readonly after create), project select, owner avatar, reviewer select, state chip.
- State transition action bar: shows the buttons valid for the current state (Submit / Approve / Reject / Release / Edit Body). Buttons gated by permission with tooltips.
- Body section: full-width markdown textarea + live preview (right column). Save button bottom-right.
- GitHub Links section: `branchName` text input, `prURL` text input rendering a card preview when valid, commits sub-list with add-row UI (each commit: SHA + URL + optional subject).
- Linked Requirements section: autocomplete to add + table of linked reqs (id, description, approval status, remove button).
- History section: collapsible timeline (closed by default), paginated.

## Database Changes

One migration: `backend/migrations/20260504000000-add-design-feature-review.js`.

Up:
1. Create `DesignFeatures` per F1.
2. Create `DesignFeatureHistory` per F3.
3. Alter `DesignRequirements`: add `designFeatureID` INTEGER NULL FK to `DesignFeatures(id)` ON DELETE SET NULL.
4. Seed permissions: insert into `Permissions` rows for `features.read`, `features.write`, `features.delete`, `features.approve`.

Down: drop tables, drop column, delete the seeded permissions.

## Test Scenarios

### Backend (Jest, `backend/tests/__tests__/design/`)

- **design-feature.test.js**:
  - Create / read / update / soft-delete happy paths.
  - Slug unique constraint produces human error.
  - Workflow: every valid transition + every invalid transition.
  - Update on `approved` resets to `in_review`.
  - Update on `released` returns 4xx.
  - Permission gates: 403 without `features.write` on PUT, without `features.approve` on approve/release.
  - link-requirement / unlink-requirement happy paths and invalid IDs.
  - Cascade: deleting a feature sets linked `DesignRequirement.designFeatureID` to null.
- **design-feature-history.test.js**:
  - History row created with correct `changeType` on each mutation.
  - History rows include `changedByUserID`.
  - History endpoint paginates.

### Frontend (Karma, `*.spec.ts`)

- `feature-list-view.spec.ts`: filters, empty state, error state, group-by-project rendering.
- `feature-edit-page.spec.ts`: section rendering, state transition buttons gated correctly, save flow, requirement autocomplete, GitHub link preview.
- `feature-new-page.spec.ts`: validation, navigates to edit page on success.
- `github-link.pipe.spec.ts`: PR URL, commit URL, malformed URL.
- `design-feature.service.spec.ts`: each method calls correct endpoint with correct payload.

### E2E (Playwright, `frontend/e2e/feature-review.spec.ts`)

- Log in → create feature → fill body → submit for review → switch user → approve → release → assert state badge.
- Link a requirement → confirm req appears under feature; navigate to req page and confirm back-link.

## Implementation Notes

### Files to create
See plan at `~/.claude/plans/i-want-a-more-serialized-mitten.md`.

### Existing patterns to follow
- **Audit shape**: `backend/models/design/requirementHistory.js`. Copy field-for-field for `DesignFeatureHistory`.
- **Workflow controller**: `backend/api/manufacturing/master/controller.js` — its submit/approve/release handlers are the closest match.
- **Permission seeding (migration + tests)**: `backend/migrations/20260407000000-create-manufacturing-tables.js` + `backend/tests/setup.js`.
- **Edit page with history**: `frontend/src/app/components/design/requirement-edit-page/`.
- **Mat-autocomplete remote search**: `frontend/src/app/components/inventory/part-edit-page/part-edit-page.ts` (BOM autocomplete pattern).
- **Soft-reset on edit**: `DesignRequirement` resets approved → unapproved on update; mirror with approved → in_review.

### Edge cases
- Slug collision on create → human error per F1 verification.
- Migration of MD docs may find requirements that do not exist (typos, soft-deleted reqs); script should warn and continue, not fail.
- A user without `features.approve` editing an approved feature: PUT must still succeed (resetting to in_review), but the approve button must be disabled.
- `DesignRequirement.designFeatureID` must remain settable even when the requirement is `approved` — the link is metadata, not part of the requirement's content.
- `released` features are read-only at the API level; the UI should reflect this with a "Released — read only" banner.

### Out of scope
- GitHub API integration (auth, webhooks, CI status). Manual fields only.
- Per-feature revision history (like `WireHarness` revisions A→B). A released feature is terminal; further work creates a new feature record.
- Cross-feature dependencies / parent-child feature trees.
