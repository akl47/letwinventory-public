# CLAUDE.md

## Project-Specific Rules

**Don't run builds, migrations, or type checks.** The webapp runs in Docker with hot reload — the user reports build errors. No `ng build`, `npm run build`, `sequelize db:migrate`, `tsc --noEmit`.

**Always ask before running tests** (Jest, Karma, Playwright, `scripts/run-tests.sh`).

**Never skip generating requirements.** If `req.js` fails or the API is unreachable, STOP and tell the user.

### New feature workflow (strict order)

1. **Requirements first.** Use `node scripts/req.js`:
   - List categories: `categories`. View hierarchy: `tree /tmp/req-tree.json`.
   - Create: `create '<json>'` with `description`, `rationale`, `verification`, `validation`, `parentRequirementID`. Present each to the user for approval.
   - Every requirement needs a parent. Each category has exactly one root. New categories need a root requirement under QMS clause (REQ 98) or System root (REQ 1).
   - Default to `unapproved`: run `submit <id>` after `create`. Only stay in `draft` if the user explicitly asks. If a parent is already approved, the API may auto-approve — `unapprove <id>` if needed.
   - Key category roots: Engineering Masters (265), Work Instructions (266), Work Orders (267), Barcode (149), Inventory (123), Parts (152), Tools (174), Authentication (155), Authorization (156), Planning (161), Harness (163), Design Requirements (165), Orders (167), File Management (80).
2. **Tests second.** Backend (Jest), frontend (Karma), E2E (Playwright). Should fail.
3. **Link tests to requirements.** `update <id>` to add test file refs to `verification`.
4. **Implement.** Make tests pass.
5. **Verify.** `list --project <id>` to confirm coverage.

## Behavioral Rules

### Think before coding
State assumptions explicitly. If multiple interpretations exist, present them. If a simpler approach exists, push back. Stop and ask if anything is unclear.

### Simplicity first
Minimum code that solves the problem. No speculative features, no abstractions for single-use code, no error handling for impossible scenarios. Every changed line should trace directly to the user's request.

### Useful error messages
Never pass raw database errors to the user. Catch specific failures (`SequelizeUniqueConstraintError`, FK violations, validation) and produce human messages naming the field/entity. Generic `"Validation error"` is never acceptable.

### Surgical changes
Touch only what you must. Don't refactor adjacent code, match existing style. Remove imports/variables YOUR changes orphaned; leave pre-existing dead code alone (mention it).

### Goal-driven execution
Transform tasks into verifiable goals: "Add validation" → "Write tests for invalid inputs, then make them pass". For multi-step tasks, state a brief plan with verification per step.

### Debugging discipline

**Instrument first, fix second.** First round of changes for a reported bug should be diagnostic logging, not fixes. For UI bugs, instrument all relevant events at once (mousedown + click + document-level listener; lifecycle hooks; data shape at each layer boundary).

**Match symptom to layer:**

| Symptom | Almost always | Almost never |
|---------|---------------|--------------|
| Mousedown fires but click does not | DOM element destroyed/replaced between events | CSS / pointer-events / z-index |
| Hover doesn't trigger | Element being recreated, or `mouseenter` missing | Tooltip CSS positioning |
| Image doesn't load | Wrong URL, missing auth, or `src` not bound | Image styling |
| Component doesn't re-render | Object reference unchanged (mutation vs replacement) | Change detection strategy |
| Data missing in template | Backend include / attributes / nested association | Frontend mapping |

When mousedown fires but click does not → DOM lifecycle. Common causes: template binding to a method (not memoized signal) returning new arrays each render → mat-table / `@for` recreates rows; missing `trackBy`; parent re-rendering on every event due to mutated input.

**Compare semantically when something works in one place but not another.** Look for differences that affect Angular semantics (method call vs computed signal, mutated vs new array, missing `trackBy`, change detection strategy) — not visual props.

**Trust confirmed layers.** Once a debug log proves a layer is correct, stop touching it. Move up the stack.

**Pick the most diagnostic symptom.** "Click event never fires" is more diagnostic than "image doesn't show" — chase that first.

**Don't anchor on the first plausible theory.** If the first fix didn't work, discard the theory entirely and start from the symptom again.

---

## Architecture Reference

### Stack
- **Backend:** Node.js/Express 5, Sequelize, PostgreSQL (SQLite in tests)
- **Frontend:** Angular 19 (standalone components, signals), Angular Material
- **Tests:** Jest backend, Karma frontend, Playwright E2E (port 4201, chromium, test-login → storageState)
- **Infra:** Docker, GitHub Actions, DockerHub deploy on `v*` tag

### Environment
- `.env.development` / `.env.production` selected by `NODE_ENV`
- Frontend env files swapped via `angular.json` `fileReplacements`; E2E uses `/api` via proxy

### API Structure
Auto-discovered via `backend/api/index.js`:
- `/api/auth/{google,user,api-key}/*` — OAuth, sessions, API keys
- `/api/inventory/{part,barcode,trace,location,box,equipment,order,order-item,bom}/*`
- `/api/parts/{connector,cable,component,wire,wire-end,harness}/*` — harness has revision endpoints
- `/api/planning/{task,tasklist,project,scheduled-task}/*`
- `/api/design/{requirement,requirement-category,feature}/*`
- `/api/manufacturing/{master,master-step,work-order}/*`
- `/api/tools/{tool,tool-category,tool-subcategory}/*`
- `/api/admin/{group,user,permission}/*` — RBAC + impersonation
- `/api/config/*` — push subscriptions, notification prefs, VAPID
- `/api/files/*` — read-only

### Permissions
- **Resources:** parts, inventory, equipment, tasks, projects, harness, requirements, admin, orders, tools, manufacturing_planning, manufacturing_execution, features
- **Actions:** read, write, delete + special: requirements.approve, admin.impersonate, admin.manage_tool_categories, features.approve
- **Enforcement:** `checkPermission(resource, action)` middleware; exempt: auth/*, config/*
- **Frontend:** `authService.hasPermission()` signal; UI buttons disabled with tooltips
- **Test helpers:** `authenticatedRequest` auto-grants all permissions; opt out with `{ grantPermissions: false }`
- **API keys:** scoped at creation (immutable); intersection with user perms at token exchange; `expiresAt` rejected on exchange

### Auth & Sessions
- Google OAuth → JWT access + refresh; multi-session (max 10, oldest deactivated); `userAgent` per RefreshToken; `session_id` cookie
- Sessions API: `GET/DELETE /sessions`, `DELETE /sessions/:id`
- Impersonation: `POST /api/admin/user/:id/impersonate` → 1-hour JWT with `impersonatedBy` claim, no refresh, orange toolbar, original token saved to `original_auth_token`

### Harness Editor
- Canvas: `harness-canvas.ts`. Data model: `HarnessData` (connectors, cables, components, connections, subHarnesses, schemaVersion)
- Pin 0 anchor (v2): position = pin 0's wire connection point. Connectors anchor at left wire circle (body draws right); components at right circle (body draws left); cables at wire 0 left endpoint
- Wire routing: `computeLeadPoint` (snaps to edge + 1 grid unit), `computeWirePath`, `offsetOverlappingSegments` (two-pass rendering spreads parallel segments)
- Undo/redo: `HarnessHistoryService` with per-harness `Map<id, HistoryStack>`; `setActiveHarness(id)`, `promoteNewToId(id)` after first save
- Release workflow: draft → review → released; released = read-only; editing creates new revision (A→B→...→Z→AA)
- View-only mode: `!hasPermission('harness', 'write')` extends `isLocked`
- Images: stripped from JSON via `stripImageData()`; re-fetched from parts DB via `syncPartsFromDatabase()` on load (also detects structural changes)

### Services
- **Scheduled tasks:** hourly cron-driven creation; custom `computeNextRun()` uses AND for DOM+DOW
- **Notifications:** per-minute due-date checks; web-push via VAPID; auto-cleanup of expired subscriptions
- **Print agent:** WebSocket via `printAgentService`
- **DigiKey lookup:** `backend/scripts/digikey-lookup.js` requires `--token <jwt>`

### Mobile
- Snap-scroll task columns ≤768px; long-press 500ms to drag; auto-scroll via rAF outside Angular zone; sidebar collapsed by default; scanner at `/mobile`

### Deployment
- CI runs backend tests + E2E on push; tag `v*` deploys to DockerHub
- `scripts/backup-db.sh` (daily pg_dump + Gmail SMTP), `scripts/pull-backup.sh` (ReadyNAS via SCP), `scripts/deploy-update.sh` (health check w/ retries)

### Key Design Decisions
- `tagColorHex` stored without `#` prefix
- Harness images transient (re-fetched from parts DB)
- Revision letters: A→B→...→Z→AA→AB
- Connector pins: wire=left, mating=right always
- Vertical wire labels read top-to-bottom
- `by-part` endpoints include nested `Part.imageFile`; transforms fall back to `part.imageFile.data`
- API key permissions immutable after creation
- 403 in frontend interceptor does NOT clear token (authenticated, just unauthorized)
- `minimumStockQuantity` nullable (null = no minimum)
- UoM `allowDecimal` (default false): integer-only quantity validation enforced on create/split/adjust/kit/unkit/delete trace + BOM qty
- Tool record soft-delete preserves dimension values (clearing subcategory sets `activeFlag=false` but keeps fields for reactivation)

### Requirements System
- CLI: `scripts/req.js` — create, update, delete, list, approve, unapprove, submit, history, categories, create-category, update-category, delete-category, tree, check
- Auth: test-login `claude@letwin.co`, JWT cached 55min in `/tmp`
- Hierarchy: REQ 1 root → QMS (98, regulated by 820.x / ISO 13485 clauses); G5 (147, infra) outside QMS
- ~36 categories, each with one root, zero cross-category parent links
- Three-state approval: draft → unapproved → approved. Edit auto-resets approved → unapproved (not draft). `req.js check` ignores drafts
- History: `RequirementHistory` records all mutations with `changedByUserID`, including `submitted` changeType
- Status filter: 5-status AND-based (approved/unapproved × not_implemented/implemented/validated)
- `/feature` slash command: `.claude/commands/feature.md`

### Major Database Tables
- Inventory: `Parts` (revision, revisionLocked, previousRevisionID; unique on (name, revision)), `Barcodes`, `Traces`, `Locations`, `Boxes`, `Equipment`, `Orders`, `OrderItems`, `BillOfMaterialItems`, `BarcodeHistoryActionTypes` (incl. ADJUSTED=7, KITTED=8, UNKITTED=9), `UnitOfMeasures.allowDecimal`, `PartRevisionHistory`
- Parts library: `WireEnds`, `WireHarness` (release fields), `HarnessRevisionHistory`
- Planning: `Tasks` (checklist JSONB, dueDateNotifiedAt), `Projects.keyboardShortcut`, `ScheduledTasks` (cron-parser v4.9.0)
- Design: `DesignRequirements.approvalStatus` (+ `designFeatureID` FK), `RequirementCategories`, `RequirementHistory`, `DesignFeatures` (4-state `reviewState` workflow + GitHub linkage), `DesignFeatureHistory`
- Manufacturing: `EngineeringMasters` (release workflow), `EngineeringMasterSteps` (stepNumber default 10), `EngineeringMasterStepItems` (isTool flag), `EngineeringMasterStepMarkers` (x, y), `EngineeringMasterOutputParts`, `EngineeringMasterHistory`, `WorkOrders`, `WorkOrderStepCompletions`
- Tools: `ToolCategories` (5 broad), `ToolSubcategories` (~36 leaves), `ToolCategorySubcategories` (M:N join), `Tools` (partID UNIQUE FK + dimension fields, mm)
- Auth: `RefreshTokens.userAgent`, `ApiKeys.expiresAt`, `ApiKeyPermissions`, `PushSubscriptions`, `NotificationPreferences`

### Frontend Routes
- Planning: `/tasks`, `/projects`, `/scheduled-tasks`
- Inventory: `/inventory`, `/parts`, `/parts/new`, `/parts/:id/edit`, `/equipment`
- Orders: `/orders`, `/orders/bulk-upload`, `/orders/:id`
- Harness: `/harness`, `/harness/editor`, `/harness/editor/:id`
- Design: `/requirements`, `/requirements/new`, `/requirements/:id/edit`, `/features`, `/features/new`, `/features/:id/edit`, `/design/masters`, `/design/masters/new`, `/design/masters/:id/edit`
- Build: `/build`, `/build/:barcodeId`, `/build/work-orders`, `/build/work-orders/:id`
- Tools: `/tools/outline`, `/tools/catalog`
- Admin: `/admin/groups`, `/admin/groups/:id`, `/admin/users`, `/admin/users/:id/permissions`, `/admin/users/new`
- Other: `/inventory/barcode-history/:id`, `/settings`, `/mobile`
- All non-`/home` routes use `authGuard`; admin routes also use `adminGuard`

---

## Session History

Past sessions appear in `git log`. Add a new section here only when a session decision will surprise a future reader (a non-obvious tradeoff, a workaround, an architectural pivot). File-level changes belong in commit messages, not here.

### 2026-05-04 — Feature Review system (REQ 300–313, parented under REQ 105 in Design Controls)

- **What it is:** `DesignFeatures` table replaces `docs/features/*.md`. Each feature owns a project, a 4-state review workflow (draft → in_review → approved → released), a markdown body, manual GitHub linkage (branch + PR + commitRefs JSON), and 1:N requirement ownership via a new `designFeatureID` FK on `DesignRequirements`.
- **Why a new permission resource (`features` + `features.approve`) instead of reusing `requirements`:** the user explicitly wanted the feature reviewer to be separable from the requirement approver. Mirrors how `manufacturing_*` resources split planning from execution.
- **Naming convention pivot:** new design-domain tables/models prefixed `Design*` (`DesignFeatures`, `DesignFeatureHistory`, FK `designFeatureID`). User course-corrected mid-plan; existing `RequirementHistory` stays unprefixed (we're not retroactively renaming).
- **Slug uniqueness uses a partial unique index** (`WHERE activeFlag = true`) so soft-deleted slugs can be re-used. Controller also does a manual active-slug check up front to produce the same human error on both PG and SQLite test backends, since SQLite's index validation message wording differs.
- **`docs/features/*.md` migration:** `scripts/migrate-feature-docs.js` reads each MD, derives slug/name, scans body for `REQ N` and `REQ N–M` ranges, links matching requirements, and submit→approve→releases the new feature so historical state reflects "shipped". Idempotent by slug. **The script must be run after the migration applies and before the MD files are deleted.**
- **`/feature` slash command rewritten:** step 1 now calls `node scripts/feature.js create` instead of writing an MD file, and `req.js create '<json>' --feature <id>` auto-links each new requirement.
- **Status:** REQ 300–313 created and `unapproved`. Implementation complete locally; migration not yet applied. Pending user actions: apply migration, run `node scripts/migrate-feature-docs.js --dry-run` to inspect plan, run for real, `git rm docs/features/*.md` once verified, then approve REQs.

### 2026-05-12 — Part CAD Modeler (DesignFeature 35; REQ 512–557 under Design Controls)

- **What it is:** browser-based parametric CAD module attached to each Part, mirroring WireHarness draft → review → released. `/design/cad` lists every part with CAD; `/parts/:id/cad/editor` is the editor with a Three.js viewer + SolidWorks-style action toolbar (Sketch / Extrude). Sketches nest under their extrude in the feature tree; Origin feature carries per-datum visibility.

- **Pure-TS solver is the production solver.** PlaneGCS WASM is in `package.json` and the Angular build config has the `externalDependencies` + `assets` mapping wired, but `solver.ts` is pure-TS numerical iteration. It satisfies every constraint case in the spec (incl. fully-constrained rectangle, conflicting-constraint rejection). PlaneGCS swap is a follow-up when sketches outgrow the iterative solver.

- **Pure-JS extrude is the default kernel.** Same story for `opencascade.js@2.0.0-beta.fdece36`: wired through `CadKernelService` with a lazy dynamic import, but not invoked at startup. Pure-JS extrude (ear-clipping caps + quad sides via `makePureJsKernel()`) handles every polygon profile. OCCT is required for curves, booleans, fillets — swap by calling `kernelService.load()` and reassigning `this.kernel` in `CadEditorComponent`.

- **Datum visibility persists on the Origin feature.** `OriginFeature.visibility?: Record<string, boolean>` for the seven datum ids (`origin` / `x_axis` / … / `xz_plane`). Missing keys default to visible. Stored inside the JSONB `featureTree` blob — no separate column. Visibility eyes in the tree mutate this map.

- **`tablesToClean` order in `backend/tests/setup.js`:** any model with a Part/User FK using `onDelete: RESTRICT` must be cleaned BEFORE Part/User. `DesignCADModelHistory` and `DesignCADModel` were added at the top of the list for this reason. Same pattern applies to future tables.

- **Hardcoded permission count in `backend/tests/__tests__/admin/user-permission.test.js`** was 45 → updated to 49 to account for `cad.{read,write,delete,approve}`. Future devs adding new permission resources need to bump this number.

- **Migration partial-state footgun.** Sequelize migrations in this repo aren't transactional; if a Docker hot-reload restarts mid-migration, partial state (created index, no `SequelizeMeta` row) traps re-runs with "relation already exists" errors. The CAD migration follows house style (non-transactional) but new migrations should wrap in `queryInterface.sequelize.transaction(...)` to roll back cleanly. The recovery is hand-written cleanup SQL — see the `DROP INDEX … DROP TABLE … DELETE FROM "Permissions" WHERE resource = 'cad'` pattern.

- **Action-driven UX pivot mid-implementation.** Initial draft was selection-first ("click plane → New Sketch button appears"). User course-corrected to a top-toolbar "Sketch / Extrude" pair that *prompts* for inputs ("Click a datum plane in the viewer"). The `mode` signal in `CadEditorComponent` (`'idle' | 'pick-plane' | 'pick-extrude-target'`) is the single source of truth for what the editor is waiting for; Esc cancels.

- **Three.js is now a project runtime dep** (`three@^0.165.0`, `@types/three`). First time. Datum picking uses a face-prefers-datum precedence rule (face hits win over datum hits at any distance) to avoid translucent datum planes intercepting clicks intended for solid faces.

- **Status:** DesignFeature 35 in `in_review`. 46 requirements all `unapproved`. Branch `cad` pushed, commit `9758a11` linked on feature record; `prURL` left null for the user to fill. Pending: apply migration, optionally swap to OCCT/PlaneGCS for non-polygon profiles, approve the 46 reqs.
