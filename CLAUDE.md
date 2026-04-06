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
- **Tests:** Jest (backend, ~34 suites/374 tests), Karma (frontend, ~74 spec files), Playwright (E2E, 41 tests)
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
- `/requirements`, `/requirements/new`, `/requirements/:id/edit` — design requirements
- `/admin/groups`, `/admin/groups/:id`, `/admin/users`, `/admin/users/:id/permissions`, `/admin/users/new` — admin
- `/tools/outline` — tools
- `/inventory/barcode-history/:id`, `/settings`, `/mobile` — other
- All routes (except `/home`) use `authGuard`; admin routes also use `adminGuard`

### API Structure (backend)
APIs auto-discovered via `backend/api/index.js` directory scanner:
- `/api/auth/google/*` — OAuth login, test-login, token refresh
- `/api/auth/user/*` — checkToken, getUser, updateUser, getSessions, revokeSession
- `/api/auth/api-key/*` — API key CRUD, token exchange, scoped permissions
- `/api/inventory/part/*`, `/api/inventory/barcode/*`, `/api/inventory/trace/*`
- `/api/inventory/location/*`, `/api/inventory/box/*`, `/api/inventory/equipment/*`
- `/api/inventory/order/*`, `/api/inventory/order-item/*`
- `/api/parts/connector/*`, `/api/parts/cable/*`, `/api/parts/component/*`, `/api/parts/wire/*`, `/api/parts/wire-end/*`
- `/api/parts/harness/*` — includes revision control endpoints (`submit-review`, `reject`, `release`, `history`, `revisions`, `revert`)
- `/api/planning/task/*`, `/api/planning/tasklist/*`, `/api/planning/project/*`, `/api/planning/scheduled-task/*`
- `/api/design/requirement/*`, `/api/design/requirement-category/*` — requirements CRUD + approval + history
- `/api/admin/group/*`, `/api/admin/user/*`, `/api/admin/permission/*` — RBAC management + impersonation
- `/api/config/push-subscription/*`, `/api/config/notification-preference/*`, `/api/config/vapid-public-key`
- `/api/files/*` — read-only file access (upload moved to `/api/inventory/part/upload`)

### Permission System
- **Tables:** Permissions, UserGroups, UserGroupMembers, GroupPermissions, UserPermissions, ApiKeyPermissions
- **Resources (9):** parts, inventory, equipment, tasks, projects, harness, requirements, admin, orders
- **Actions (3+2):** read, write, delete (base); requirements.approve, admin.impersonate (special)
- **Total permissions:** 29 (9×3 + 2 special)
- **Enforcement:** `checkPermission(resource, action)` middleware on all routes; exempt: auth/*, config/*
- **Frontend:** `authService.hasPermission()` signal; permission-gated UI buttons with tooltips
- **Test helpers:** `authenticatedRequest` auto-grants all permissions by default; opt out with `{ grantPermissions: false }`
- **API keys:** scoped permissions at creation (immutable after); token exchange returns intersection of key + user permissions

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
- `DesignRequirements` — hierarchical requirements with category FK, project FK, approval workflow
- `RequirementCategories` — lookup table for requirement categories
- `RequirementHistory` — immutable audit trail with `changedByUserID` FK, field-level diffs
- `RefreshTokens.userAgent` — device tracking for session management
- `ApiKeys.expiresAt` — nullable DATE for key expiration

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
- **View-only mode:** `isViewOnly` computed from `!hasPermission('harness', 'write')`; extends `isLocked`; View Only badge shown
- **Image handling:** Images stripped from JSON before save/export via `stripImageData()`; re-fetched from parts DB on load via `syncPartsFromDatabase()`
- **Parts sync on load:** Compares harness elements against DB for structural changes (pinCount, type, etc.); opens sync dialog if differences found; images always silently refreshed

### Authentication & Sessions
- **OAuth:** Google login → JWT access token + refresh token
- **Multi-session:** Up to 10 concurrent sessions per user; oldest deactivated when exceeded
- **Session tracking:** `userAgent` stored on RefreshToken; `session_id` cookie set on login
- **Session management:** `GET /sessions` lists active; `DELETE /sessions/:id` revokes
- **Impersonation:** `POST /api/admin/user/:id/impersonate` → 1-hour JWT with `impersonatedBy` claim; no refresh; toolbar turns orange; auto-stops on 401
- **API keys:** scoped permissions at creation (immutable); optional `expiresAt`; exchangeToken rejects expired keys

### Services & Background Processes
- **Scheduled task service:** Runs hourly, creates tasks from cron expressions; uses AND logic for DOM+DOW (custom `computeNextRun()`, not cron-parser's OR behavior)
- **Notification service:** Checks due-date reminders every minute; web-push via VAPID keys; cleans expired subscriptions
- **Print agent:** WebSocket-based remote printing via `printAgentService`
- **DigiKey lookup:** `backend/scripts/digikey-lookup.js` — API-based (not direct DB), requires `--token <jwt>`

### Testing
- **Backend tests:** Jest with SQLite, `--runInBand --silent`
- **Frontend specs:** Karma, ~74 spec files covering all components/services/guards/interceptors
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
- API key permissions are immutable after creation (set at create time only)
- 403 in frontend interceptor does NOT clear token (user is authenticated but lacks permission)
- Impersonation token: 1-hour JWT, no refresh, original admin token saved to `original_auth_token` localStorage key
- `minimumStockQuantity` is nullable (null = no minimum set)

### Requirements System
- **CLI:** `scripts/req.js` — create, update, delete, list, approve, history, categories, create-category, update-category, delete-category
- **Auth:** test-login with `claude@letwin.co`, JWT cached 55min in `/tmp`
- **Hierarchy:** req 1 is root → QMS (98) contains ~149 quality-affecting reqs organized by regulatory clause (820.x / ISO 13485); G5 (147, System Infrastructure) stays outside QMS
- **Categories:** ~30 categories; each has exactly 1 root requirement; zero cross-category parent links
- **History:** immutable RequirementHistory table with changedByUserID FK, auto-recorded on all mutations
- **Status filter:** 5-status AND-based filter (approved/unapproved × not_implemented/implemented/validated)
- **Custom command:** `.claude/commands/feature.md` — `/feature` slash command for guided workflow

## Instructions for Future Sessions

Each session should:
1. Add a new section with the date below this line
2. List all files modified
3. Describe changes made and reasoning
4. Note any important decisions or context

---

## Session History (condensed)

### 2026-02-15
- Removed ~24 debug `console.log` statements from backend; added `--silent` to Jest
- Fixed harness E2E tests (route path + export selector)
- **Design Requirements feature** — full-stack: RequirementCategories + DesignRequirements tables, hierarchical CRUD + approval, tree table list view, create/edit pages, category dialog; API under `/api/design/requirement*`
- **Requirement History** — immutable audit trail table with `changedByUserID` FK; auto-records on all 5 mutation types; collapsible timeline on edit page
- **Requirements CLI** — `scripts/req.js` for DB-based requirement management (replaced `docs/requirements.md`)
- **Permissions & User Groups** — 5 tables (UserGroups, UserGroupMembers, Permissions, GroupPermissions, UserPermissions); `checkPermission` middleware on all 25 route files; admin API + UI; 45 backend tests

### 2026-02-16
- **API Key Scoped Permissions** — ApiKeyPermissions junction table; scoped create, intersection-based token exchange
- **Settings page redesign** — full-width layout, accordion panels, API key create dialog with name/expiration/permission grid
- **Immutable key permissions** — removed PUT endpoint; permissions set at creation only
- **Key expiration** — `expiresAt` column; exchangeToken rejects expired keys; expired badge in UI

### 2026-02-17
- **Permission restructure** — merged create+update→write; split inventory→parts/inventory/equipment; split planning→tasks/projects; total 29 permissions (9×3 + 2 special)
- **Admin impersonation** — `admin.impersonate` permission; 1-hour JWT with `impersonatedBy`; orange toolbar indicator
- **Permission-gated UI** — buttons disabled with tooltip when lacking write permission; harness view-only mode
- **Migration consolidation** — 13 pre-production migrations → 3 clean files
- **Frontend specs** — 14 new spec files for admin, design, and settings components

### 2026-02-18
- **Requirements DB refactor** — fixed hierarchy, created category parents, eliminated cross-category links; added `create-category`/`update-category`/`delete-category` to req.js

### 2026-02-24
- **Multi-session support** — removed single-session enforcement; max 10 concurrent; `userAgent` tracking on RefreshTokens; session management API + settings UI with "This device" badge

### 2026-03-03
- **Requirements hierarchy refactoring** — created group requirements (G1-G5), category roots, 15 feature requirements; zero cross-category links; 167 total reqs
- **QMS alignment** — re-parented regulated processes under QMS clause nodes (820.x/ISO); soft-deleted empty group nodes; ~149 reqs now trace through QMS

### 2026-03-06
- **Requirements status filter** — 5-status AND-based multi-select replacing boolean toggle; tree traversal preserves children of filtered-out parents
- **Part minimum stock quantity** — added to part edit page (form + view mode); nullable field
- **Low stock toggle** — "Low Stock Only" toggle in parts table; filters by `minimumStockQuantity` threshold
- **Custom `/feature` slash command** — `.claude/commands/feature.md` for guided new feature workflow

### 2026-03-11
- **Mobile scanner UX improvements:**
  - Fixed scan-again button text color (#b0b0b0 → #e0e0e0)
  - Persisted scan mode preference (continuous/manual) to localStorage key `scannerContinuousMode`
  - Added manual barcode input button (keyboard icon) with text input overlay in scanning states
  - Added "Back to Barcode" button in result state — re-fetches tag data and returns to display state
  - Added "Adjust" action button for traces — direct quantity adjustment with confirmation UI
- **Quantity adjustment feature (full stack):**
  - Migration `20260311000000-add-adjusted-action-type.js` — adds ADJUSTED (id: 7) to BarcodeHistoryActionTypes
  - `PUT /api/inventory/trace/adjust-quantity/:barcodeId` — validates, updates quantity, records BarcodeHistory with ADJUSTED action
  - Frontend: `adjustTraceQuantity()` in inventory.service.ts, adjust action in mobile-scanner + barcode-movement-dialog + barcode-history
- **Inactive barcodes in order view:**
  - Removed `activeFlag: true` filter from Trace include in `getOrderById()` — shows all traces (active and inactive)
  - Added `activeFlag` to Barcode attributes in Trace include
  - Frontend: inactive traces shown with strikethrough + red "inactive" badge in order-view barcode column
- **ZPL watermarks:**
  - DEV watermark (`NODE_ENV !== 'production'`): large "DEV" text on labels
  - INACTIVE watermark (`barcode.activeFlag === false`): large "INACTIVE" text on labels
  - Relaxed `activeFlag` filters in `findBarcodeForLabel()`, `getZPLDetails()`, `displayBarcode()`, `printBarcodeByID()` to allow generating/printing labels for inactive barcodes
- **Files modified:**
  - `frontend/src/app/components/mobile/mobile-scanner/mobile-scanner.ts` — manual input, scan mode persistence, adjust, back to barcode
  - `frontend/src/app/components/mobile/mobile-scanner/mobile-scanner.html` — manual input overlay, adjust UI, back to barcode button
  - `frontend/src/app/components/mobile/mobile-scanner/mobile-scanner.css` — button colors, manual input styles, adjust button
  - `frontend/src/app/services/inventory.service.ts` — `adjustTraceQuantity()` method
  - `frontend/src/app/components/orders/order-view/order-view.html` — inactive trace indicator
  - `frontend/src/app/components/orders/order-view/order-view.css` — inactive trace styles
  - `frontend/src/app/components/inventory/barcode-history/barcode-history.ts` — ADJUSTED action label/icon, onAdjust()
  - `frontend/src/app/components/inventory/barcode-history/barcode-history.html` — adjust button
  - `frontend/src/app/components/inventory/barcode-movement-dialog/barcode-movement-dialog.ts` — adjust action type + executeAdjust()
  - `frontend/src/app/components/inventory/barcode-movement-dialog/barcode-movement-dialog.html` — adjust form
  - `backend/api/inventory/trace/controller.js` — `adjustQuantity()` handler
  - `backend/api/inventory/trace/routes.js` — adjust-quantity route
  - `backend/api/inventory/order/controller.js` — removed activeFlag filter from Trace include
  - `backend/api/inventory/barcode/controller.js` — `findBarcodeForLabel()`, `generateWatermark()`, relaxed activeFlag filters
  - `backend/migrations/20260311000000-add-adjusted-action-type.js` — new migration

### 2026-03-14
- **Tool Outline Generator feature** — frontend-only, ported standalone HTML/JS app into Angular component
  - Created "Tools" top-level navigation group in sidebar (construction icon) with "Tool Outline" child page (straighten icon)
  - Full image processing pipeline using OpenCV.js WASM loaded dynamically from CDN
  - Controls: scale method (plate size/DPI/manual), smoothing, blur, threshold, morphology, fill holes, margin, radii, centerlines
  - Interactive preview canvas with zoom/pan, overlay rendering of contours and centerlines
  - Draggable centerline control points on preview canvas
  - Per-part SVG/DXF output with download (individual + ZIP bulk download via JSZip)
  - Pipeline debug steps (8-step collapsible panel)
  - Info bar showing image/plate/SVG dimensions, contour count, scale
  - SVG sanitize pipe for safe innerHTML rendering
  - 10 requirements created (REQ 174-183) in new "Tools" category (id=31)
- **Files created:**
  - `frontend/src/app/components/tools/tool-outline/tool-outline.ts` — ~700 line standalone component with signals
  - `frontend/src/app/components/tools/tool-outline/tool-outline.html` — Angular Material template
  - `frontend/src/app/components/tools/tool-outline/tool-outline.css` — responsive styles
  - `frontend/src/app/components/tools/tool-outline/svg-sanitize.pipe.ts` — DomSanitizer pipe
  - `frontend/src/app/components/tools/tool-outline/tool-outline.spec.ts` — component tests
  - `docs/features/tool-outline.md` — feature spec
- **Files modified:**
  - `frontend/src/app/components/common/nav/nav.component.ts` — added 'tools' NavGroup, toolsPrefixes
  - `frontend/src/app/components/common/nav/nav.component.html` — added Tools rail item + flyout section
  - `frontend/src/app/components/common/nav/nav.component.spec.ts` — added Tools navigation group tests
  - `frontend/src/app/app.routes.ts` — added /tools/outline route with authGuard only

### 2026-03-29
- **Wire Harness Canvas Refactor** — three core changes to fix canvas behavior
- **Per-harness undo/redo history:**
  - `HarnessHistoryService` refactored from single global stack to `Map<string, HistoryStack>` keyed by harness ID
  - `setActiveHarness(id)` switches stacks (preserves history across navigation), `promoteNewToId(id)` transfers 'new' stack after first save
  - `harness-page.ts` uses `setActiveHarness()` instead of `clear()` when switching harnesses
- **Pin 0 rotation anchor (position = pin 0's wire connection point):**
  - Connectors: position = pin 0 wire circle (left side), body draws to the right
  - Components: position = pin 0 circle (right side), body draws to the left
  - Cables: position = wire 0 left endpoint, body draws to the right
  - All pins at local `(0, i * ROW_HEIGHT)` — grid-aligned at any rotation
  - `schemaVersion` field added to `HarnessData`; `migration.ts` converts v1 positions to v2 on load
  - Updated: connector.ts, component.ts, cable.ts, block-renderer.ts, endpoint-resolver.ts, harness-canvas.ts (getWireObstacles)
- **Wire routing fixes:**
  - `computeLeadPoint()` replaces `getLeadPoint()` + `adjustWaypointForObstacles()` — snaps to element edge + 1 grid unit, consistent results
  - `computeWirePath()` exported for two-pass rendering
  - `offsetOverlappingSegments()` detects parallel wire segments on same grid line with overlapping ranges, spreads them by gridSize
  - Canvas uses two-pass rendering: compute all paths → offset overlaps → draw with adjusted paths
  - Manual waypoint paths excluded from overlap detection
- **Files created:**
  - `frontend/src/app/utils/harness/migration.ts` — v1→v2 position data migration
- **Files modified:**
  - `frontend/src/app/services/harness-history.service.ts` — Map-based per-harness stacks
  - `frontend/src/app/services/harness-history.service.spec.ts` — per-harness + promoteNewToId tests
  - `frontend/src/app/components/harness/harness-page/harness-page.ts` — setActiveHarness, promoteNewToId, migration on load
  - `frontend/src/app/utils/harness/elements/connector.ts` — pin 0 anchor origin
  - `frontend/src/app/utils/harness/elements/component.ts` — pin 0 anchor origin (right side)
  - `frontend/src/app/utils/harness/elements/cable.ts` — wire 0 left endpoint anchor
  - `frontend/src/app/utils/harness/elements/block-renderer.ts` — unified block renderer updated for new origins
  - `frontend/src/app/utils/harness/endpoint-resolver.ts` — updated bounds calculations
  - `frontend/src/app/utils/harness/wire.ts` — computeLeadPoint, computeWirePath, offsetOverlappingSegments, precomputedPath param
  - `frontend/src/app/utils/harness/canvas-renderer.ts` — re-exports for new functions
  - `frontend/src/app/components/harness/harness-canvas/harness-canvas.ts` — two-pass wire rendering, updated obstacle bounds
  - `frontend/src/app/models/harness.model.ts` — schemaVersion field
  - `docs/features/wire-harness-editor.md` — updated spec with new behavior

### 2026-03-30
- **Kitting & Assemblies feature** — full-stack support for Kit and Assembly part categories with bill of materials (BOM) and trace kitting workflow
  - Two new part categories: Kit (green) and Assembly (blue), seeded via migration
  - `BillOfMaterialItems` table — links kit/assembly parts to component parts with quantities; unique index on (partID, componentPartID)
  - BOM API: `GET/PUT /api/inventory/bom/:partId` with DFS cycle detection (direct, indirect, cross-type, self-reference)
  - Kit/Unkit trace endpoints: `POST /api/inventory/trace/kit/:barcodeId`, `POST /api/inventory/trace/unkit/:barcodeId`
  - Kit status endpoint: `GET /api/inventory/trace/kit-status/:barcodeId` — computes partial/complete from kitting history vs BOM
  - KITTED (id: 8) and UNKITTED (id: 9) barcode history action types
  - Kitting deducts source trace quantity; deactivates trace at 0; unkitting restores and reactivates
  - Frontend: BOM editor on part-edit-page for Kit/Assembly categories (search, add, remove, quantity editing)
  - Frontend: Kit action in barcode-movement-dialog (target barcode + quantity)
  - Frontend: KITTED/UNKITTED labels and icons in barcode-history
  - Frontend: Kit button on barcode-history action bar for trace barcodes
  - Frontend: `getBom()`, `updateBom()`, `kitTrace()`, `unkitTrace()`, `getKitStatus()` in inventory.service.ts
  - 20 requirements created (REQ 193-213) in Inventory category
- **Files created:**
  - `backend/models/inventory/billOfMaterialItem.js` — Sequelize model
  - `backend/api/inventory/bom/controller.js` — BOM CRUD + cycle detection
  - `backend/api/inventory/bom/routes.js` — Express routes
  - `backend/migrations/20260330000000-add-kitting-support.js` — table + category/action type seeds
  - `backend/tests/__tests__/inventory/bom.test.js` — BOM API tests (CRUD, cycle detection)
  - `backend/tests/__tests__/inventory/kitting.test.js` — kit/unkit/status tests
  - `docs/features/kitting.md` — feature spec
- **Files modified:**
  - `backend/models/inventory/part.js` — added bomItems/usedInBoms associations
  - `backend/api/inventory/trace/controller.js` — kitTrace, unkitTrace, getKitStatus handlers
  - `backend/api/inventory/trace/routes.js` — kit/unkit/kit-status routes
  - `backend/tests/setup.js` — Kit/Assembly categories, KITTED/UNKITTED action types, BillOfMaterialItem cleanup
  - `frontend/src/app/services/inventory.service.ts` — BOM + kitting methods
  - `frontend/src/app/services/inventory.service.spec.ts` — BOM + kitting service tests
  - `frontend/src/app/components/inventory/part-edit-page/part-edit-page.ts` — BOM state, isKitOrAssembly(), loadBomData, saveBomData, search/add/remove BOM items
  - `frontend/src/app/components/inventory/part-edit-page/part-edit-page.html` — BOM editor section
  - `frontend/src/app/components/inventory/part-edit-page/part-edit-page.css` — BOM styles
  - `frontend/src/app/components/inventory/barcode-movement-dialog/barcode-movement-dialog.ts` — kit action type + executeKit
  - `frontend/src/app/components/inventory/barcode-movement-dialog/barcode-movement-dialog.html` — kit form
  - `frontend/src/app/components/inventory/barcode-movement-dialog/barcode-movement-dialog.spec.ts` — kit action tests
  - `frontend/src/app/components/inventory/barcode-history/barcode-history.ts` — KITTED/UNKITTED labels/icons, onKit()
  - `frontend/src/app/components/inventory/barcode-history/barcode-history.html` — Kit button
  - `frontend/src/app/components/inventory/barcode-history/barcode-history.spec.ts` — KITTED/UNKITTED + onKit tests

### 2026-03-31
- **UoM integer-only quantity validation:**
  - `allowDecimal` BOOLEAN on UnitOfMeasures (default false); migration updates continuous UoMs (gal, g, kg, in, ft, m, mm)
  - `validateQuantityForUoM()` helper in trace controller; validation in createNewTrace, splitTrace, adjustQuantity, kitTrace, unkitTrace, deleteTrace
  - BOM API validates component part quantities against their UoM
  - `buildTag` extended to include `unitOfMeasureID` and `allowDecimal` on Trace tags
  - Frontend: dynamic `[step]`/`[min]` on all quantity inputs (barcode-movement-dialog, mobile-scanner, inventory-item-dialog, BOM)
  - UoM API returns `allowDecimal` field
- **BOM UI improvements:**
  - Table uses `locations-table` CSS classes (consistent with Stock Locations)
  - Part autocomplete (mat-autocomplete) replacing custom search, searches name/description/vendor/SKU
  - Category badge column with colored pill
  - UoM label in qty column
  - Part names as links to part edit page
  - BOM qty inputs respect component part's UoM `allowDecimal`
- **Build feature** — top-level Build page for assembling kits/assemblies
  - New nav rail item "Build" with `build_circle` icon, gated by inventory access
  - Routes: `/build` (list view), `/build/:barcodeId` (detail view)
  - `GET /api/inventory/trace/in-progress-builds` endpoint — returns partial kit/assembly traces with BOM progress
  - Build list view: table of in-progress builds with barcode, part name, category badge, progress (N/M), created date; searchable
  - New build dialog: autocomplete filtered to Kit/Assembly parts, creates trace, navigates to detail view
  - Build detail view: part info card, BOM fulfillment table (required/kitted/status per line), barcode scan input
  - Barcode scan workflow: scan → lookup → match BOM line → quantity prompt → kit → refresh status
  - Complete builds show "Complete" badge and are excluded from the list
  - 6 requirements created (REQ 214-219) in Inventory category
- **Files created:**
  - `backend/migrations/20260331000000-add-allow-decimal-to-uom.js`
  - `backend/tests/__tests__/inventory/build.test.js`
  - `frontend/src/app/components/build/build-list-view/build-list-view.ts` + `.html` + `.css` + `.spec.ts`
  - `frontend/src/app/components/build/build-view/build-view.ts` + `.html` + `.css` + `.spec.ts`
  - `frontend/src/app/components/build/new-build-dialog/new-build-dialog.ts` + `.html` + `.css` + `.spec.ts`
  - `docs/features/build.md`
- **Files modified:**
  - `backend/models/inventory/unitOfMeasure.js` — added `allowDecimal` field
  - `backend/api/inventory/unitofmeasure/controller.js` — added `allowDecimal` to attributes
  - `backend/api/inventory/trace/controller.js` — `validateQuantityForUoM` helper + calls in 6 methods, `getInProgressBuilds` handler
  - `backend/api/inventory/trace/routes.js` — in-progress-builds route (before /:id to avoid param conflict)
  - `backend/api/inventory/bom/controller.js` — BOM qty UoM validation, `defaultUnitOfMeasureID` in component part attributes
  - `backend/api/inventory/barcode/controller.js` — `buildTag` includes UoM data for traces
  - `backend/tests/setup.js` — UoM seeds with `allowDecimal`
  - `backend/tests/__tests__/inventory/trace.test.js` — UoM quantity validation tests
  - `backend/tests/__tests__/inventory/kitting.test.js` — decimal qty validation tests
  - `frontend/src/app/app.routes.ts` — `/build` and `/build/:barcodeId` routes
  - `frontend/src/app/components/common/nav/nav.component.ts` — build NavGroup, prefixes
  - `frontend/src/app/components/common/nav/nav.component.html` — build rail item + flyout
  - `frontend/src/app/models/trace.model.ts` — `allowDecimal` on UnitOfMeasure
  - `frontend/src/app/models/inventory-tag.model.ts` — `unitOfMeasureID`, `allowDecimal`
  - `frontend/src/app/services/inventory.service.ts` — `getInProgressBuilds()`
  - `frontend/src/app/services/inventory.service.spec.ts` — build service test
  - `frontend/src/app/components/inventory/inventory-item-dialog/inventory-item-dialog.ts` + `.html` — `allowDecimal` computed, dynamic step/min
  - `frontend/src/app/components/inventory/barcode-movement-dialog/barcode-movement-dialog.ts` + `.html` — `allowDecimal` in dialog data, dynamic step/min
  - `frontend/src/app/components/inventory/barcode-history/barcode-history.ts` — passes `allowDecimal` to dialog
  - `frontend/src/app/components/mobile/mobile-scanner/mobile-scanner.html` — dynamic step/min on 3 qty inputs
  - `frontend/src/app/components/inventory/part-edit-page/part-edit-page.ts` — BOM autocomplete, category helpers, UoM helpers, `MatAutocompleteModule`
  - `frontend/src/app/components/inventory/part-edit-page/part-edit-page.html` — BOM table rewrite (locations-table, autocomplete, category badge, UoM, part links)
  - `frontend/src/app/components/inventory/part-edit-page/part-edit-page.css` — part-link, category-badge, BOM qty styles

### 2026-03-31 (continued)
- **Kitting/Build UI improvements:**
  - Fixed `searchText().toLowerCase()` TypeError in BOM autocomplete and new-build-dialog (mat-autocomplete writing object to string signal)
  - New build dialog: location selector (required), uses `getLocationBarcodes()` API
  - Build detail page: part links with hover image preview, barcode tags, kit dialog per BOM line, created at/by info
  - Build list page: reformatted to match parts table layout, "Show Completed" toggle, status column, barcode tags
  - Status chips use translucent backgrounds with primary color text
- **Barcode dialog replaced with embedded mobile scanner:**
  - `BarcodeDialog` is now a thin wrapper embedding `MobileScanner` component
  - `MobileScanner` gains `@Input() initialBarcode`, `@Input() embedded`, `@Output() closed`
  - In embedded mode: back button closes dialog, "History" button navigates to barcode history, camera-dependent features use manual input
  - Global `scanner-dialog-panel` CSS class for dialog styling
  - All barcode tag openers updated with new dialog config
  - Barcode preview moved above action buttons, "History" button added to action grid
  - Barcode in barcode-history header is now a clickable `<app-barcode-tag>`
- **Part Revisions feature** (REQ 220-227) — full-stack revision tracking for parts
  - `revision` STRING(8), `revisionLocked` BOOLEAN, `previousRevisionID` INTEGER FK added to Parts table
  - Unique constraint changed from `name` to `(name, revision)` composite
  - `PartRevisionHistory` table for audit trail (changeType: created/updated/locked/unlocked/new_revision/production_release)
  - Revision scheme: external parts default `0`, internal parts start at `01` (dev numeric), letters `A, B, C...` for production
  - New API endpoints: `POST /:id/new-revision`, `POST /:id/release`, `PUT /:id/lock`, `PUT /:id/unlock`, `GET /:id/revision-history`, `GET /revisions/:name`
  - Part edit page: revision badge in header, lock/unlock toggle, "New Rev" and "Release" buttons, revision history timeline, all revisions section
  - Parts table: new "Rev" column
  - 8 requirements created (REQ 220-227) in Parts category
- **Files created:**
  - `backend/migrations/20260331100000-add-part-revisions.js`
  - `backend/models/inventory/partRevisionHistory.js`
  - `backend/tests/__tests__/inventory/partRevision.test.js`
  - `frontend/src/app/components/build/kit-line-dialog/kit-line-dialog.ts` + `.html` + `.css`
  - `frontend/src/app/components/build/build-list-view/` — reformatted
  - `docs/features/part-rev.md`
- **Files modified:**
  - `backend/models/inventory/part.js` — revision, revisionLocked, previousRevisionID fields + associations
  - `backend/api/inventory/part/controller.js` — revision endpoints, default revision in create, lock check in update, history recording
  - `backend/api/inventory/part/routes.js` — 6 new routes
  - `backend/api/inventory/trace/controller.js` — includeCompleted param, buildTag createdAt
  - `backend/api/inventory/barcode/controller.js` — buildTag includes createdAt
  - `backend/tests/setup.js` — PartRevisionHistory cleanup
  - `backend/tests/helpers.js` — createTestPart includes revision default
  - `frontend/src/app/models/part.model.ts` — revision, revisionLocked, previousRevisionID
  - `frontend/src/app/models/inventory-tag.model.ts` — createdAt
  - `frontend/src/app/services/inventory.service.ts` — revision API methods, getInProgressBuilds includeCompleted
  - `frontend/src/app/components/inventory/part-edit-page/` — revision controls, history, all revisions
  - `frontend/src/app/components/inventory/parts-table-view/` — revision column
  - `frontend/src/app/components/inventory/barcode-dialog/barcode-dialog.ts` — replaced with MobileScanner wrapper
  - `frontend/src/app/components/inventory/barcode-tag/barcode-tag.ts` — scanner dialog panel config
  - `frontend/src/app/components/inventory/barcode-history/barcode-history.html` — barcode tag
  - `frontend/src/app/components/inventory/inventory-higherarchy-item/inventory-higherarchy-item.ts` — dialog config
  - `frontend/src/app/components/orders/order-view/order-view.ts` — dialog config
  - `frontend/src/app/components/mobile/mobile-scanner/` — embedded mode, history button, layout reorder
  - `frontend/src/app/components/build/build-view/` — part links, barcode tags, kit dialog, revision display
  - `frontend/src/app/components/build/build-list-view/` — reformatted, status column, show completed
  - `frontend/src/app/components/build/new-build-dialog/` — location selector
  - `frontend/src/styles.css` — scanner-dialog-panel class
