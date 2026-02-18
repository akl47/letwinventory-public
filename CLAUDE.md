# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## Project-Specific Rules

**Do NOT run builds or migrations:**
- Do not build the frontend (`ng build`, `npm run build`, etc.)
- Do not build the backend
- Do not run database migrations (`sequelize db:migrate`, etc.)
- Do not run TypeScript compilation checks (`tsc --noEmit`, etc.)

The webapp runs in a Docker container that automatically builds on file changes. The user will report any build errors or issues.

**Always ask before running tests.** Do not run backend tests (`jest`), frontend specs (`karma`), E2E tests (`playwright`), or the test runner script (`scripts/run-tests.sh`) without asking the user first. The user often wants to make additional changes before tests are run.

**NEVER skip generating requirements.** If `req.js` fails or the API is unreachable, STOP and tell the user. Do not proceed to tests or implementation without requirements in the database.

**New feature workflow (strictly follow this order):**

1. **Requirements first.** Use `node scripts/req.js` to create requirements in the database. List existing categories with `node scripts/req.js categories`. Create each requirement with `node scripts/req.js create '<json>'`, presenting each to the user for approval before moving on. All requirements must include `description`, `rationale`, `verification`, and `validation`. If anything is ambiguous or uncertain, ask — do not guess.
2. **Tests second.** Write tests for the approved requirements: backend (Jest), frontend (Karma spec), and E2E (Playwright) where applicable. Tests should fail at this point (they validate unimplemented behavior).
3. **Link tests to requirements.** Update requirements via `node scripts/req.js update <id> '<json>'` to add test file references to the `verification` field.
4. **Implement the feature.** Write the code to make the tests pass.
5. **Verify requirements are met.** Use `node scripts/req.js list --project <id>` to review all requirements and confirm coverage. If any requirement is partially met or missed, flag it.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

---

## Architecture Reference

### Stack
- **Backend:** Node.js/Express 5, Sequelize ORM, PostgreSQL (SQLite in tests)
- **Frontend:** Angular 19 (standalone components, signals), Angular Material
- **Tests:** Jest (backend, 27 suites/255 tests), Karma (frontend specs), Playwright (E2E, 41 tests)
- **Infra:** Docker, GitHub Actions CI/CD, DockerHub deploy on `v*` tag

### Environment Configuration
- `.env.development` / `.env.production` loaded based on `NODE_ENV`
- Backend: `backend/config/config.js` reads from env files (no hardcoded creds)
- Frontend: `environment.ts` (dev: `http://localhost:3000/api`), `environment.prod.ts` (prod: `https://letwinventory.letwin.co/api`), `environment.e2e.ts` (E2E: `/api` via proxy)
- Angular `fileReplacements` in `angular.json` swaps env files per build config
- E2E uses port 4201 with proxy to backend on 3000

### Routes (frontend `app.routes.ts`)
- `/tasks`, `/projects`, `/scheduled-tasks` — planning
- `/inventory`, `/parts`, `/parts/new`, `/parts/:id/edit`, `/equipment` — inventory
- `/orders`, `/orders/bulk-upload`, `/orders/:id` — orders
- `/harness`, `/harness/editor`, `/harness/editor/:id` — wire harness
- `/inventory/barcode-history/:id`, `/settings`, `/mobile` — other
- All routes (except `/home`) use `authGuard`

### API Structure (backend)
APIs auto-discovered via `backend/api/index.js` directory scanner:
- `/api/auth/google/*` — OAuth login, test-login, token refresh
- `/api/auth/user/*` — checkToken, getUser, updateUser
- `/api/inventory/part/*`, `/api/inventory/barcode/*`, `/api/inventory/trace/*`
- `/api/inventory/location/*`, `/api/inventory/box/*`, `/api/inventory/equipment/*`
- `/api/inventory/order/*`, `/api/inventory/order-item/*`
- `/api/parts/connector/*`, `/api/parts/cable/*`, `/api/parts/component/*`, `/api/parts/wire/*`, `/api/parts/wire-end/*`
- `/api/parts/harness/*` — includes revision control endpoints (`submit-review`, `reject`, `release`, `history`, `revisions`, `revert`)
- `/api/planning/task/*`, `/api/planning/tasklist/*`, `/api/planning/project/*`, `/api/planning/scheduled-task/*`
- `/api/config/push-subscription/*`, `/api/config/notification-preference/*`, `/api/config/vapid-public-key`
- `/api/files/*` — file uploads

### Key Database Tables & Migrations
Migrations in `backend/migrations/` — run via `npx sequelize-cli db:migrate`:
- `WireEnds` — termination types (f-pin, m-pin, f-spade, etc.)
- `Projects.keyboardShortcut` — digits 1-9, unique nullable, for task card hotkeys
- `WireHarness` release fields — `releaseState` (draft/review/released), `releasedAt`, `releasedBy`, `previousRevisionID`
- `HarnessRevisionHistory` — tracks changes, snapshots, changeType includes `production_release`
- `ScheduledTasks` — cron-based task generation (cron-parser v4.9.0)
- `Tasks.checklist` — JSONB array of `{text, checked}`
- `Tasks.dueDateNotifiedAt` — prevents duplicate notification sends
- `PushSubscriptions` — web push endpoints per user
- `NotificationPreferences` — per-user notification settings

### Harness Editor Architecture
- **Canvas:** `harness-canvas.ts` — HTML5 Canvas rendering, mouse/touch interaction, hit testing
- **Data model:** `HarnessData` in `harness.model.ts` — connectors, cables, components, connections, subHarnesses
- **Sub-harnesses:** stored in `harnessData.subHarnesses[]`, rendered via `sub-harness.ts`
- **Connector pins:** wire point (left/circle) + mating point (right/square), standardized regardless of connector type
- **Wire routing:** `wire.ts` has `calculateOrthogonalPath()` (legacy) and `calculateOrthogonalPathV2()` with lead-out direction and obstacle avoidance
- **Wire drawing state:** `WireDrawingManager` class in `wire-drawing-manager.ts` (Phase 1 — created but not fully integrated; canvas still uses old state vars)
- **Endpoint resolution:** `endpoint-resolver.ts` resolves connection endpoints by type
- **Undo/redo:** `HarnessHistoryService` with past/future stacks (max 50), transaction pattern for drags
- **Release workflow:** Draft → Review → Released; released harnesses are read-only; editing creates new revision (A→B→C...)
- **Image handling:** Images stripped from JSON before save/export via `stripImageData()`; re-fetched from parts DB on load via `syncPartsFromDatabase()`
- **Parts sync on load:** Compares harness elements against DB for structural changes (pinCount, type, etc.); opens sync dialog if differences found; images always silently refreshed

### Services & Background Processes
- **Scheduled task service:** Runs hourly, creates tasks from cron expressions; uses AND logic for DOM+DOW (custom `computeNextRun()`, not cron-parser's OR behavior)
- **Notification service:** Checks due-date reminders every minute; web-push via VAPID keys; cleans expired subscriptions
- **Print agent:** WebSocket-based remote printing via `printAgentService`
- **DigiKey lookup:** `backend/scripts/digikey-lookup.js` — API-based (not direct DB), requires `--token <jwt>`

### Testing
- **Backend tests:** Jest with SQLite, `--runInBand --silent`, 242 pass / 13 skipped (PostgreSQL-specific)
- **Frontend specs:** Karma, 60 spec files covering all components/services/guards/interceptors
- **E2E:** Playwright on port 4201, chromium only, auth via test-login endpoint → storageState
- **Test runner:** `scripts/run-tests.sh` runs all suites
- **Skipped tests:** PostgreSQL sequences, `Op.iLike`, raw SQL unions, network-dependent (printer)

### Mobile
- Snap-scroll task board columns at `≤768px`
- Long-press (500ms) to drag task cards on touch
- Auto-scroll during drag (rAF loop, runs outside Angular zone)
- Sidebar collapsed by default on mobile
- Scanner page at `/mobile` with back button

### Deployment & Backup
- GitHub Actions: CI on push (backend tests + E2E), deploy on `v*` tag → DockerHub
- `scripts/backup-db.sh` — daily pg_dump with change detection, Gmail SMTP notifications
- `scripts/pull-backup.sh` — ReadyNAS pulls backups from VPS via SCP
- `scripts/deploy-update.sh` — health check with retries

### Key Design Decisions
- `tagColorHex` stored WITHOUT `#` prefix in database
- Harness images are transient (not persisted in JSON, re-fetched from parts DB on load)
- Revision letters: A→B→...→Z→AA→AB
- Sub-harness image toggle state is cache-only (not persisted to parent harness)
- Connector pin sides: always wire=left, mating=right (regardless of connector type)
- Vertical wire labels always read top-to-bottom
- `by-part` endpoints (connector, cable, component) include nested `Part.imageFile`
- Frontend transform functions fall back to `part.imageFile.data` when specific image file is null

## Instructions for Future Sessions

Each session should:
1. Add a new section with the date below this line
2. List all files modified
3. Describe changes made and reasoning
4. Note any important decisions or context

---

## Session: 2026-02-15

### Files Modified
- `backend/middleware/bodyValidator.js` — removed 12 debug console.log statements (6 `req.body` + 6 `UNCAUGHT TYPE`)
- `backend/api/inventory/trace/controller.js` — removed 4 debug console.log statements
- `backend/api/auth/user/controller.js` — removed 4 debug console.log statements (including credential leak)
- `backend/api/inventory/barcode/controller.js` — removed 3 debug console.log statements
- `backend/middleware/checkToken.js` — removed 1 redundant error dump
- `backend/package.json` — added `--silent` to jest command
- `frontend/e2e/harness.spec.ts` — fixed editor route (`/#/harness/editor/:id` not `/#/harness/:id`), fixed export button selector (`download` icon not `more_vert`)

### Changes Made
1. **Cleaned up debug logging in backend** — removed ~24 debug `console.log` statements from production code; kept intentional prefixed logs (`[AUTH]`, `[REFRESH]`, `[ScheduledTasks]`) and `console.error` in catch blocks; added `--silent` to Jest to suppress remaining console output during tests
2. **Fixed harness E2E tests** — corrected route path to `/#/harness/editor/${id}` (matching `app.routes.ts`), rewrote export test to use correct `download` icon selector and proper `waitForEvent` ordering

## Session: 2026-02-15 (Design Requirements Feature)

### Files Created
- `backend/migrations/20260215120000-create-requirement-categories.js` — RequirementCategories table migration
- `backend/migrations/20260215120001-create-design-requirements.js` — DesignRequirements table migration with FK indexes
- `backend/models/design/requirementCategory.js` — RequirementCategory model with hasMany association
- `backend/models/design/designRequirement.js` — DesignRequirement model with self-referencing hierarchy, User, Project, Category associations
- `backend/api/design/requirement-category/controller.js` — CRUD controller for categories
- `backend/api/design/requirement-category/routes.js` — Routes with checkToken
- `backend/api/design/requirement/controller.js` — CRUD + approve/unapprove controller
- `backend/api/design/requirement/routes.js` — Routes with checkToken
- `backend/tests/__tests__/design/requirement-category.test.js` — 12 tests for category CRUD
- `backend/tests/__tests__/design/design-requirement.test.js` — 19 tests for requirement CRUD + hierarchy + approval
- `frontend/src/app/models/design-requirement.model.ts` — DesignRequirement and RequirementCategory interfaces
- `frontend/src/app/services/design-requirement.service.ts` — CRUD + approve/unapprove service with cache
- `frontend/src/app/services/requirement-category.service.ts` — CRUD service with cache
- `frontend/src/app/components/design/requirements-list-view/` — Tree table list view (ts, html, css)
- `frontend/src/app/components/design/requirement-edit-page/` — Create/edit page (ts, html, css)
- `frontend/src/app/components/design/category-manage-dialog/` — Category management dialog (ts, html, css)

### Files Modified
- `frontend/src/app/app.routes.ts` — added 3 routes: `/requirements`, `/requirements/new`, `/requirements/:id/edit`
- `frontend/src/app/components/common/nav/nav.component.html` — added "Requirements" nav link with checklist icon
- `backend/tests/setup.js` — added DesignRequirement and RequirementCategory to tablesToClean
- `docs/requirements.md` — added section 14 (REQ-DES-001 through REQ-DES-007) with test file references

### Changes Made
1. **Design Requirements feature** — full-stack implementation following CLAUDE.md workflow (requirements → tests → implementation)
2. **Backend** — new `design/` API category auto-discovered by existing route scanner; RequirementCategories lookup table + DesignRequirements table with hierarchical parent-child, project FK, category FK, approval workflow
3. **Frontend** — tree table list view with expand/collapse, project filter, search; separate create/edit pages with view-first pattern; category management dialog
4. **Tests** — 31 new backend tests (29 suites / 273 tests total, all passing)

### Decisions
- API lives under `/api/design/requirement` and `/api/design/requirement-category` (new `design/` group)
- Sidebar link placed between "Wire Harness" and "Scanner" using `checklist` material icon
- Tree table uses flat data source with indentation rather than nested mat-tree (matches existing mat-table patterns)
- Categories managed via dialog opened from edit page (not a separate route)

## Session: 2026-02-15 (Requirement History / QMS Audit Trail)

### Files Created
- `backend/migrations/20260215120002-create-requirement-history.js` — RequirementHistory table migration with FK indexes
- `backend/models/design/requirementHistory.js` — RequirementHistory model (immutable, no updatedAt, User FK)
- `backend/tests/__tests__/design/requirement-history.test.js` — 15 tests for history on create/update/approve/unapprove/delete + GET endpoint + lifecycle

### Files Modified
- `backend/api/design/requirement/controller.js` — added `recordHistory` helper, history recording on all 5 mutation types, `getHistory` endpoint
- `backend/api/design/requirement/routes.js` — added `GET /:id/history` route
- `backend/tests/setup.js` — added `RequirementHistory` to tablesToClean
- `frontend/src/app/models/design-requirement.model.ts` — added `RequirementHistoryEntry` interface
- `frontend/src/app/services/design-requirement.service.ts` — added `getHistory()` method
- `frontend/src/app/components/design/requirement-edit-page/requirement-edit-page.ts` — added history signal, toggle, load, helper methods
- `frontend/src/app/components/design/requirement-edit-page/requirement-edit-page.html` — added collapsible history timeline section
- `frontend/src/app/components/design/requirement-edit-page/requirement-edit-page.css` — added history timeline styles
- `docs/requirements.md` — added REQ-DES-008 through REQ-DES-011, updated REQ-DES-001 derived reqs

### Changes Made
1. **Requirement History audit trail** — immutable `RequirementHistory` table following HarnessRevisionHistory pattern with User FK improvement
2. **Auto-recording** — all 5 mutation types (create/update/approve/unapprove/delete) automatically log history with field-level diffs
3. **History API** — `GET /api/design/requirement/:id/history` returns entries DESC with changedBy user association
4. **Frontend timeline** — collapsible history section on edit page with change type icons, user, timestamp, notes, and field diffs
5. **Tests** — 15 new tests (30 suites / 285 tests total, all passing)

### Decisions
- Follows HarnessRevisionHistory pattern: `timestamps: false`, `freezeTableName: true`, hardcoded enum validation
- Improvement over HarnessRevisionHistory: uses `changedByUserID` FK to Users instead of string `changedBy`
- Update diffs only tracked for content fields (not approved/activeFlag which have dedicated change types)
- No history record created when update has no actual field changes
- `changeNotes` supported on update for optional user-provided change reasons

## Session: 2026-02-15 (Requirements CLI Script)

### Files Created
- `scripts/req.js` — CLI script for managing design requirements via API

### Files Modified
- `CLAUDE.md` — updated "New feature workflow" step 1 to use `scripts/req.js` instead of `docs/requirements.md`, updated steps 3 and 5 accordingly

### Changes Made
1. **Requirements CLI script** — Node.js CLI (`scripts/req.js`) that authenticates via test-login endpoint, caches JWT in `/tmp`, and provides subcommands for all requirement CRUD operations, approval workflow, history, and categories
2. **CLAUDE.md workflow update** — new requirements now go into the database via the CLI script instead of `docs/requirements.md`

### Decisions
- CLI script over MCP server (simpler, no background process, no extra deps)
- CLI script over raw curl (handles auth caching, JSON formatting, error handling)
- Auth via test-login with `claude@letwin.co` identity, token cached for 55min in `/tmp`
- `docs/requirements.md` kept as static archive; new requirements go to database only

## Session: 2026-02-15 (Permissions & User Groups Feature)

### Files Created
- `backend/migrations/20260216000000-create-user-groups.js` — UserGroups table
- `backend/migrations/20260216000001-create-user-group-members.js` — UserGroupMembers junction table
- `backend/migrations/20260216000002-create-permissions.js` — Permissions table
- `backend/migrations/20260216000003-create-group-permissions.js` — GroupPermissions junction table
- `backend/migrations/20260216000004-create-user-permissions.js` — UserPermissions junction table
- `backend/migrations/20260216000005-seed-permissions-and-admin-group.js` — 28 permissions + Admin group seed
- `backend/models/admin/userGroup.js` — UserGroup model with belongsToMany User, Permission
- `backend/models/admin/userGroupMember.js` — Junction model (User ↔ UserGroup)
- `backend/models/admin/permission.js` — Permission model (resource + action)
- `backend/models/admin/groupPermission.js` — Junction model (UserGroup ↔ Permission)
- `backend/models/admin/userPermission.js` — Junction model (User ↔ Permission)
- `backend/middleware/checkPermission.js` — Permission enforcement middleware + loadEffectivePermissions helper
- `backend/api/admin/group/controller.js` — Group CRUD + membership controller
- `backend/api/admin/group/routes.js` — Group API routes with checkPermission
- `backend/api/admin/user/controller.js` — User list + permission management controller
- `backend/api/admin/user/routes.js` — User API routes with checkPermission
- `backend/api/admin/permission/controller.js` — Permission list controller
- `backend/api/admin/permission/routes.js` — Permission API routes
- `backend/tests/__tests__/admin/permission-enforcement.test.js` — 20 tests for permission enforcement
- `backend/tests/__tests__/admin/user-group.test.js` — 15 tests for group API
- `backend/tests/__tests__/admin/user-permission.test.js` — 10 tests for user permission API
- `frontend/src/app/models/permission.model.ts` — Permission, UserGroup, AdminUser interfaces
- `frontend/src/app/services/admin.service.ts` — Admin API service
- `frontend/src/app/guards/admin.guard.ts` — Admin route guard
- `frontend/src/app/components/admin/groups-list/` — Group list page (ts, html, css)
- `frontend/src/app/components/admin/group-edit/` — Group edit page with members + permissions grid (ts, html, css)
- `frontend/src/app/components/admin/users-list/` — User list page (ts, html, css)
- `frontend/src/app/components/admin/user-permissions/` — User permission edit page (ts, html, css)

### Files Modified
- `backend/models/common/user.js` — added belongsToMany associations for groups and directPermissions
- `backend/api/auth/user/controller.js` — checkToken and refreshToken now return permissions array
- `backend/tests/setup.js` — added 5 new tables to tablesToClean, seed permissions in seedReferenceData
- `backend/tests/helpers.js` — added createTestGroup, addUserToGroup, assignGroupPermission, assignUserPermission, assignAllPermissions helpers; authenticatedRequest auto-grants all permissions by default
- All 25 existing route files — added `checkPermission(resource, action)` middleware after checkToken
- `frontend/src/app/services/auth.service.ts` — added _permissions signal, hasPermission(), hasAnyPermission(), permissions computed; updated checkAuthStatus/refreshAccessToken/clearToken
- `frontend/src/app/interceptors/auth.interceptor.ts` — 403 no longer clears token or redirects (user is authenticated but lacks permission)
- `frontend/src/app/interceptors/auth.interceptor.spec.ts` — updated 403 test to expect no token clearing
- `frontend/src/app/app.routes.ts` — added 5 admin routes with authGuard + adminGuard
- `frontend/src/app/components/common/nav/nav.component.ts` — added admin NavGroup type, hasAdminAccess computed, adminPrefixes
- `frontend/src/app/components/common/nav/nav.component.html` — added conditional admin rail item + flyout
- `docs/requirements.md` — added Section 15 (REQ-PERM-001–010), Appendix C §15, Appendix D.12, updated revision history/summary

### Changes Made
1. **Permissions model** — 5 new tables (UserGroups, UserGroupMembers, Permissions, GroupPermissions, UserPermissions) with 28 seed permissions across 7 resources
2. **Permission enforcement** — checkPermission middleware applied to all 25 existing route files; zero-trust default (no implicit access)
3. **Admin API** — group CRUD + membership, user permission management, permission reference list
4. **Auth integration** — checkToken/refreshToken return effective permissions array; frontend stores in signal
5. **Frontend admin UI** — 4 admin components (groups-list, group-edit, users-list, user-permissions) with adminGuard
6. **Conditional nav** — Admin sidebar group shown only to users with admin.read permission
7. **Tests** — 45 new backend tests (33 suites / 334 tests total, all passing); authenticatedRequest auto-grants permissions for backward compatibility

### Decisions
- Resource mapping: inventory/* → `inventory`, order/orderitem → `orders`, parts/* → `harness`, planning/* → `planning`, design/* → `design`, files → `files`, admin/* → `admin`
- Exempt endpoints: auth/google/*, auth/user/*, config/* (no permission check needed)
- authenticatedRequest in test helpers auto-grants all permissions by default; opt out with `{ grantPermissions: false }` for enforcement tests
- Permission caching per request via `req._effectivePermissions` avoids redundant DB queries
- 403 handler in frontend interceptor does NOT clear token — user is authenticated but lacks permission
- Admin group seeded with all 28 permissions; first admin bootstrapped via manual DB insert

## Session: 2026-02-16 (API Key Scoped Permissions)

### Files Created
- `backend/migrations/20260216300000-create-api-key-permissions.js` — ApiKeyPermissions junction table (apiKeyID FK→ApiKeys, permissionID FK→Permissions, unique index, CASCADE delete)
- `backend/models/auth/apiKeyPermission.js` — ApiKeyPermission model (immutable, no updatedAt)

### Files Modified
- `backend/models/auth/apiKey.js` — added belongsToMany Permission through ApiKeyPermission
- `backend/api/auth/api-key/controller.js` — scoped create (optional permissionIds), intersection-based exchangeToken, getPermissions, setPermissions endpoints
- `backend/api/auth/api-key/routes.js` — added GET /:id/permissions, PUT /:id/permissions
- `backend/tests/__tests__/auth/api-key.test.js` — added 9 permission tests (27 total in suite)
- `backend/tests/setup.js` — added ApiKeyPermission to tablesToClean (before ApiKey for FK order)
- `frontend/src/app/services/auth.service.ts` — updated ApiKey interface with permissions, added getApiKeyPermissions/setApiKeyPermissions methods, updated createApiKey to accept optional permissionIds
- `frontend/src/app/components/settings/settings-page/settings-page.ts` — added permission grid state (allPermissions, editingKeyId, selectedPermissionIds, permissionsByResource computed), permission editing methods
- `frontend/src/app/components/settings/settings-page/settings-page.html` — added permission count per key, tune icon button, inline permission grid editor with save/cancel
- `frontend/src/app/components/settings/settings-page/settings-page.css` — added perm-table, key-perm-editor, permissions-grid styles (reused from admin group-edit pattern)

### Changes Made
1. **ApiKeyPermissions table** — junction table following UserPermission pattern; immutable (no updatedAt), CASCADE on both FKs
2. **Scoped create** — create accepts optional `permissionIds`; if provided, validates against user's effective permissions (400 if exceeded); if omitted, grants all user permissions (backward compatible)
3. **Intersection exchange** — token exchange loads key permissions AND user's current effective permissions, returns intersection; if user lost a permission since key creation, the key can't use it
4. **Permission management endpoints** — GET/PUT /:id/permissions for viewing and replacing key permissions; only own active keys (404 otherwise); PUT validates against user's effective set
5. **Frontend permission grid** — settings page shows permission count per key; "tune" icon opens inline permission grid (same checkbox table pattern as admin group-edit); save/cancel controls
6. **Tests** — 9 new tests covering: scoped create, backward-compat create, over-scope rejection, scoped exchange, intersection behavior, set/get permissions, validation, cross-user isolation (34 suites / 374 total, all passing)

### Decisions
- Key permissions stored in dedicated junction table (not embedded in ApiKey row) — matches existing permission patterns
- Token exchange returns `resource.action` strings (same format as existing permission flow) after intersection
- List endpoint includes permissions association for frontend to display counts without extra requests
- No checkPermission middleware on api-key routes (they use checkToken only, same as auth/* pattern — keys are user-scoped, not admin-managed)

## Session: 2026-02-16 (Settings Page Redesign + Immutable Key Permissions)

### Files Modified
- `CLAUDE.md` — added "Always ask before running tests" rule to Project-Specific Rules
- `frontend/src/app/components/settings/settings-page/settings-page.ts` — full-width layout; permission grid moved to create flow (collapsible, all pre-selected); removed edit-after-creation methods (editKeyPermissions, saveKeyPermissions, cancelEditPermissions, editingKeyId); added showCreatePerms signal
- `frontend/src/app/components/settings/settings-page/settings-page.html` — orders-page header style (icon + title); permission grid in create area with expand/collapse; removed tune button and inline editor from key list
- `frontend/src/app/components/settings/settings-page/settings-page.css` — `:host` absolute positioning matching orders page; full-width container; create-perm-section collapsible panel styles; removed key-perm-editor and key-actions styles
- `frontend/src/app/services/auth.service.ts` — removed setApiKeyPermissions method
- `backend/api/auth/api-key/controller.js` — removed setPermissions export
- `backend/api/auth/api-key/routes.js` — removed PUT /:id/permissions route
- `backend/tests/__tests__/auth/api-key.test.js` — removed 2 setPermissions tests, updated cross-user test to GET-only (25 tests in suite)

### Changes Made
1. **Settings page full-width** — matches orders page layout (`:host` absolute, full-width container, 28px header with icon)
2. **Permissions at creation time** — collapsible permission grid in create form, all pre-selected by default, user unchecks before generating
3. **Immutable after creation** — removed PUT endpoint, frontend edit UI, and setApiKeyPermissions service method; keys show permission count but can't be modified
4. **CLAUDE.md rule** — added instruction to always ask user before running tests

## Session: 2026-02-16 (Settings Accordion + API Key Dialog + Expiration)

### Files Created
- `backend/migrations/20260216400000-add-api-key-expiration.js` — adds nullable `expiresAt` DATE column to ApiKeys
- `frontend/src/app/components/settings/api-key-create-dialog/api-key-create-dialog.ts` — dialog with name, expiration (never/date), permission grid
- `frontend/src/app/components/settings/api-key-create-dialog/api-key-create-dialog.html` — two-state dialog (form → key display)
- `frontend/src/app/components/settings/api-key-create-dialog/api-key-create-dialog.css` — dialog styles

### Files Modified
- `backend/models/auth/apiKey.js` — added `expiresAt` field (DATE, nullable)
- `backend/api/auth/api-key/controller.js` — create accepts `expiresAt`, list returns it, exchangeToken rejects expired keys
- `backend/tests/__tests__/auth/api-key.test.js` — added 5 expiration tests (30 total in suite)
- `frontend/src/app/services/auth.service.ts` — added `expiresAt` to ApiKey interface, changed `createApiKey` to accept data object with optional expiresAt
- `frontend/src/app/components/settings/settings-page/settings-page.ts` — replaced inline create form with dialog, replaced sections with MatExpansionModule accordion, removed permission grid state (moved to dialog)
- `frontend/src/app/components/settings/settings-page/settings-page.html` — accordion panels for Notifications/Devices/API Keys, "Generate New Key" opens dialog, shows expiration info per key
- `frontend/src/app/components/settings/settings-page/settings-page.css` — accordion styles, removed inline create/permission grid styles, added expired key visual states

### Changes Made
1. **Accordion cards** — each settings section (Notifications, Devices, API Keys) in a `mat-expansion-panel`; Notifications and API Keys expanded by default
2. **Notification button width** — constrained with `align-self: flex-start` via `.action-btn` class
3. **API key create dialog** — name field, expiration radio (never/date) with datepicker, collapsible permission grid; two-state UI (form → copy key); closes and refreshes key list
4. **Key expiration backend** — `expiresAt` column, exchangeToken rejects expired keys (401), list includes expiresAt
5. **Expired key UI** — keys show "Expires MMM d, y" or "Never expires" or red "Expired" badge with strikethrough name

## Session: 2026-02-17 (Permission System Restructure)

### Files Created
- `backend/migrations/20260216600000-restructure-permissions.js` — maps old permissions to new ones, deletes old rows (CASCADE cleans junction tables)

### Files Modified
- `backend/migrations/20260216000005-seed-permissions-and-admin-group.js` — updated Resources/Actions to new model (9 resources × 3 actions + approve)
- `backend/seeders/20260216000000-seed-permissions-and-admin-group.js` — same update
- `backend/tests/setup.js` — updated permission seeding to new model
- `backend/tests/__tests__/admin/permission-enforcement.test.js` — updated resource/action names, added resource mapping tests for parts, equipment, projects
- `backend/api/files/routes.js` — stripped to read-only (GET /:id, GET /:id/data with checkToken only)
- `backend/api/inventory/part/routes.js` — resource inventory→parts, create/update→write, added upload/delete routes
- `backend/api/inventory/barcode/routes.js` — update→write
- `backend/api/inventory/box/routes.js` — create/update→write
- `backend/api/inventory/location/routes.js` — create/update→write
- `backend/api/inventory/trace/routes.js` — create/update→write
- `backend/api/inventory/equipment/routes.js` — resource inventory→equipment, create/update→write
- `backend/api/inventory/unitofmeasure/routes.js` — resource inventory→admin
- `backend/api/inventory/order/routes.js` — create/update→write
- `backend/api/inventory/orderitem/routes.js` — create/update→write
- `backend/api/parts/connector/routes.js` — resource harness→parts, create/update→write
- `backend/api/parts/cable/routes.js` — resource harness→parts, create/update→write
- `backend/api/parts/component/routes.js` — resource harness→parts, create/update→write
- `backend/api/parts/wire/routes.js` — resource harness→parts, create/update→write
- `backend/api/parts/wire-end/routes.js` — resource harness→admin, create/update→write
- `backend/api/parts/harness/routes.js` — create/update→write
- `backend/api/design/requirement/routes.js` — create/update→write
- `backend/api/design/requirement-category/routes.js` — create/update→write
- `backend/api/admin/group/routes.js` — create/update→write
- `backend/api/admin/user/routes.js` — create/update→write
- `frontend/src/app/app.routes.ts` — updated route guard resources (planning→tasks/projects, inventory→parts/equipment)
- `frontend/src/app/components/common/nav/nav.component.ts` — replaced hasPlanningAccess with hasTasksAccess/hasProjectsAccess/hasPartsAccess/hasEquipmentAccess; updated hasInventoryGroupAccess
- `frontend/src/app/components/common/nav/nav.component.html` — split inventory flyout per-item permission checks; Tasks uses hasTasksAccess
- `frontend/src/app/components/admin/permission-grid/permission-grid.ts` — base actions: create/read/update/delete → read/write/delete
- `frontend/src/app/services/harness-parts.service.ts` — upload URL /files → /inventory/part/upload

### Changes Made
1. **Merged create+update→write** — all route files use `write` instead of separate `create`/`update` actions
2. **Split broad resources** — `inventory` split into `parts`+`inventory`+`equipment`; `planning` split into `tasks`+`projects`; `harness` parts routes moved to `parts` resource
3. **Moved wire-ends and UoM under admin** — wire-end routes use `admin` resource; unit-of-measure uses `admin` resource
4. **File upload moved to part routes** — upload/delete routes added to `/api/inventory/part/upload`; `/api/files` stripped to read-only
5. **Migration preserves existing assignments** — maps old junction table rows to new permissions before deleting old ones
6. **Frontend updated** — route guards, nav visibility, permission grid, file upload URLs all reflect new model

### Decisions
- Resource mapping: inventory/part → `parts`, inventory/barcode+trace+location+box → `inventory`, inventory/equipment → `equipment`, planning/task+tasklist+taskhistory+scheduled-task+time-tracking → `tasks`, planning/project → `projects`, parts/connector+cable+component+wire → `parts`, parts/wire-end → `admin`, parts/harness → `harness`
- File routes kept as read-only (GET /:id, GET /:id/data) with checkToken only — file IDs are opaque references used by parts
- Total permissions: 9×3 + 1 (requirements.approve) = 28

## Session: 2026-02-17 (Admin User Impersonation)

### Files Created
- `backend/migrations/20260217000000-add-impersonate-permission.js` — adds `admin.impersonate` permission and assigns to Admin group
- `backend/tests/__tests__/admin/impersonation.test.js` — 8 tests for impersonation endpoint

### Files Modified
- `backend/seeders/20260216000000-seed-permissions-and-admin-group.js` — added `admin.impersonate` to extraPermissions
- `backend/tests/setup.js` — added `admin.impersonate` to permission seed data
- `backend/api/admin/user/controller.js` — added `impersonate` export (JWT with impersonatedBy claim, target permissions)
- `backend/api/admin/user/routes.js` — added `POST /:id/impersonate` route with `checkPermission('admin', 'impersonate')`
- `backend/middleware/checkToken.js` — propagates `impersonatedBy` from JWT to `req.impersonatedBy`
- `backend/api/auth/user/controller.js` — checkToken endpoint returns `impersonatedBy` field from decoded JWT
- `frontend/src/app/services/auth.service.ts` — added `_isImpersonating` signal, `isImpersonating` computed, `startImpersonation()`, `stopImpersonating()`; `checkAuthStatus` detects impersonation; `clearToken` cleans up original token
- `frontend/src/app/services/admin.service.ts` — added `impersonateUser()` method
- `frontend/src/app/interceptors/auth.interceptor.ts` — 401 during impersonation stops impersonation instead of refreshing
- `frontend/src/app/components/admin/user-permissions/user-permissions.ts` — added `canImpersonate` computed, `impersonate()` method
- `frontend/src/app/components/admin/user-permissions/user-permissions.html` — added Impersonate button in view-mode header
- `frontend/src/app/components/common/nav/nav.component.ts` — added `isImpersonating` computed, `stopImpersonating()` method
- `frontend/src/app/components/common/nav/nav.component.html` — added `[class.impersonating]` on toolbar, impersonation label + stop button
- `frontend/src/app/components/common/nav/nav.component.scss` — added `.impersonating`, `.impersonation-label`, `.stop-impersonating-btn` styles

### Changes Made
1. **New permission** — `admin.impersonate` added via migration and seed data; assigned to Admin group
2. **Impersonate endpoint** — `POST /api/admin/user/:id/impersonate` issues 1-hour JWT with target's identity + `impersonatedBy` admin ID; returns target's effective permissions
3. **Middleware propagation** — checkToken middleware sets `req.impersonatedBy` for audit trail; auth/user checkToken returns it in response
4. **Frontend impersonation flow** — admin's original token saved to localStorage; impersonation token swapped in; user/permission signals updated; navigates to /tasks
5. **Stop impersonation** — restores original token, reloads admin identity via checkAuthStatus, navigates to /admin/users
6. **Interceptor handling** — 401 during impersonation auto-stops instead of attempting refresh (impersonation tokens have no refresh token)
7. **Visual indicator** — toolbar turns orange (#e65100) during impersonation with "Impersonating [Name]" label and Stop button
8. **Tests** — 8 new backend tests covering permission enforcement, happy path, JWT claims, edge cases, and token acceptance

### Decisions
- Token strategy: 1-hour JWT with `impersonatedBy` claim (no refresh token for impersonation sessions)
- Original admin token preserved in `original_auth_token` localStorage key
- Impersonation auto-stops on 401 (expired token) instead of attempting refresh
- Cannot impersonate self (400) or inactive users (400)
- Total permissions: 9×3 + 2 (requirements.approve + admin.impersonate) = 29

## Session: 2026-02-17 (Permission-Gated UI + Harness View-Only + Review & Cleanup)

### Files Created
- `frontend/src/app/components/admin/groups-list/groups-list.spec.ts` — 6 tests for group list component
- `frontend/src/app/components/admin/group-edit/group-edit.spec.ts` — 13 tests for group edit component
- `frontend/src/app/components/admin/permission-grid/permission-grid.spec.ts` — 20 tests for permission grid component
- `frontend/src/app/components/admin/users-list/users-list.spec.ts` — 10 tests for users list component
- `frontend/src/app/components/admin/user-permissions/user-permissions.spec.ts` — 6 tests for user permissions component
- `frontend/src/app/components/admin/user-create-dialog/user-create-dialog.spec.ts` — 8 tests for user create dialog
- `frontend/src/app/components/settings/api-key-create-dialog/api-key-create-dialog.spec.ts` — 10 tests for API key create dialog
- `frontend/src/app/guards/permission.guard.spec.ts` — 3 tests for permission guard
- `frontend/src/app/components/design/requirements-list-view/requirements-list-view.spec.ts` — spec for requirements list
- `frontend/src/app/components/design/requirement-edit-page/requirement-edit-page.spec.ts` — spec for requirement edit page
- `frontend/src/app/components/design/category-manage-dialog/category-manage-dialog.spec.ts` — spec for category dialog
- `frontend/src/app/services/admin.service.spec.ts` — spec for admin service
- `frontend/src/app/services/design-requirement.service.spec.ts` — spec for design requirement service
- `frontend/src/app/services/requirement-category.service.spec.ts` — spec for requirement category service
- `backend/migrations/20260216000000-create-permission-tables.js` — consolidated from 10 old migrations
- `backend/migrations/20260216000001-create-api-keys.js` — consolidated from 3 old migrations

### Files Modified
- `frontend/src/app/components/harness/harness-page/harness-page.ts` — added `isViewOnly` computed, `MatIconModule`; extended `isLocked` with `!canWrite()`; guarded keyboard shortcuts with `isLocked()` checks
- `frontend/src/app/components/harness/harness-page/harness-page.html` — added View Only badge overlay, passed `[isViewOnly]` to property panel
- `frontend/src/app/components/harness/harness-page/harness-page.scss` — added `.view-only-badge` styles (amber text, semi-transparent dark background)
- `frontend/src/app/components/harness/harness-property-panel/harness-property-panel.ts` — added `isViewOnly` input, `MatTooltipModule`
- `frontend/src/app/components/harness/harness-property-panel/harness-property-panel.html` — wrapped release buttons in tooltip span, disabled when `isViewOnly()`
- `frontend/src/app/components/admin/groups-list/groups-list.ts` — replaced `console.error` with `MatSnackBar` notifications
- `backend/seeders/20260216000000-seed-permissions-and-admin-group.js` — added Default group creation (idempotent)

### Files Deleted
- 12 old migration files consolidated into 2 (20260216000000–20260216000005, 20260216100000, 20260216300000, 20260216400000, 20260216500000, 20260216600000, 20260217000000)

### Changes Made
1. **Permission-gated UI** — "New" and "Edit" buttons disabled with tooltip when user lacks write permission (across all list/edit pages)
2. **Harness view-only mode** — `isViewOnly` computed based on `!hasPermission('harness', 'write')`; `isLocked` extended to include view-only; keyboard shortcuts, auto-save, and release buttons all gated; View Only badge shown in top-left corner
3. **Migration consolidation** — 13 new migrations (none deployed to production) consolidated into 3 clean migrations; restructure migration folded into initial seed (seeds final permission state directly)
4. **Code quality** — replaced `console.error` with MatSnackBar in admin components
5. **Requirements coverage** — created 6 new requirements (298–303) for impersonation, permission-gated UI, harness view-only, API key expiration; updated 2 existing requirements (279, 296)
6. **Frontend spec coverage** — created 14 new spec files covering all admin components, permission guard, API key dialog, design components, and 3 services

### Decisions
- View Only badge uses amber (#ffb74d) text on semi-transparent black background, positioned top-left with `pointer-events: none`
- Release buttons (To Review, Release, Return to Draft, New Revision) all disabled with "You do not have permission" tooltip in view-only mode
- Migration consolidation safe because none had been deployed to production
- `admin.impersonate` permission included in initial seed (no separate migration needed)

## Session: 2026-02-18 (Requirements Refactor)

### Files Modified
- `scripts/req.js` — added `create-category`, `update-category`, `delete-category` CLI commands

### Changes Made (database only — no code changes beyond req.js)
1. **Fixed stale requirements** — req 296: removed stale PUT reference from validation; req 297: rewritten to reflect create-time permission selection (not post-creation editing)
2. **Created 3 new categories** — Authorization (id=60), API Keys (id=61), Quality & Compliance (id=62)
3. **Deleted 6 emptied sparse QMS categories** — Counterfeit Parts Prevention (42), Product Safety (41), Nonconforming Product (45), Configuration Management (40), Production Process Verification (44), Labeling Controls (37)
4. **Created 26 category parent requirements** (one per category) — each gives a brief abstract overview of why that system exists; all other requirements in the category are children (directly or via sub-hierarchy)
5. **Fixed all cross-category parent links** — old hierarchy had 137 (System) and 234 (QMS) parenting children across many categories; all broken and re-linked to correct category parents
6. **Moved cross-category orphans** — 162 (UX, was under Barcode), 165 (Configuration, was under Barcode), 202 (UX, was under Harness), 257 (External Providers, was under Purchasing), 263 (Quality & Compliance, was under Production), 268 (Development, was under Records) — all re-parented to their own category root
7. **Linked all parentless requirements** — 298 (Authorization), 282/283/299/300/301 (UX), 302 (Wire Harness) — all linked to their category parent

### Category Parent Requirements (ID → Category)
| ID | Category | ID | Category |
|----|----------|----|----------|
| 304 | API Keys | 318 | Notifications |
| 305 | Authorization | 319 | Development |
| 306 | Wire Harness | 320 | QMS |
| 307 | Mobile | 321 | Design Controls |
| 308 | Barcode | 322 | Design Requirements |
| 309 | Orders | 323 | Purchasing Controls |
| 310 | Planning | 324 | External Providers |
| 311 | System | 325 | Identification & Traceability |
| 312 | Authentication | 326 | Production & Process Controls |
| 313 | Inventory | 327 | Quality & Compliance |
| 314 | Parts | 328 | Records & Data Integrity |
| 315 | Configuration | 329 | Operational Risk Management |
| 316 | File Management | | |
| 317 | UX | | |

### Hierarchy Rules (enforced)
- Every category has exactly 1 root requirement (parentRequirementID=null)
- Every non-root requirement traces up to its category root with zero cross-category links
- Within-category sub-hierarchies preserved (e.g. 139→140, 147→151→152, 243→250→251)
- Total requirements: 192 (166 original + 26 category parents)

### Decisions
- Authentication category (46) kept for OAuth/JWT requirements (139-146) — no longer overloaded
- UX category (56) collects cross-cutting UI requirements: admin nav (282), admin pages (283), impersonation UI (299), permission-gated buttons (300-301), barcode dialog (162), harness shortcuts (202), list view patterns (223-224), sidebar (225), notifications (226)
- Sparse QMS categories deleted after requirements moved (rather than left empty)
- Category parent descriptions are abstract ("why this system exists"); children are concrete ("what it does")
