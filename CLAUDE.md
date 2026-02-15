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

**New feature workflow (strictly follow this order):**

1. **Requirements first.** Before writing any implementation code, generate requirements in `docs/requirements.md` following the existing format (REQ-XXX-NNN). Present each requirement to the user for approval. If anything is ambiguous or uncertain, ask — do not guess.
2. **Tests second.** Write tests for the approved requirements: backend (Jest), frontend (Karma spec), and E2E (Playwright) where applicable. Tests should fail at this point (they validate unimplemented behavior).
3. **Link tests to requirements.** Update the requirements in `docs/requirements.md` to reference the test file(s) that verify each requirement (e.g., "Verified by: `backend/tests/__tests__/planning/task.test.js`, `frontend/e2e/tasks.spec.ts`").
4. **Implement the feature.** Write the code to make the tests pass.
5. **Verify requirements are met.** After implementation, review each requirement against the code and test results. Confirm all are satisfied before declaring the feature complete. If any requirement is partially met or missed, flag it.

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
