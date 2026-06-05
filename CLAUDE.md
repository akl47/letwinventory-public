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

- **Pure-TS solver was the initial production solver** (superseded 2026-05-14 — see entry below). At session close, PlaneGCS WASM was in `package.json` and the Angular build config had the `externalDependencies` + `assets` mapping wired, but `solver.ts` was pure-TS numerical iteration. It satisfied every constraint case in the spec (incl. fully-constrained rectangle, conflicting-constraint rejection). PlaneGCS swap was noted as a follow-up when sketches outgrew the iterative solver.

- **Pure-JS extrude is the default kernel.** Same story for `opencascade.js@2.0.0-beta.fdece36`: wired through `CadKernelService` with a lazy dynamic import, but not invoked at startup. Pure-JS extrude (ear-clipping caps + quad sides via `makePureJsKernel()`) handles every polygon profile. OCCT is required for curves, booleans, fillets — swap by calling `kernelService.load()` and reassigning `this.kernel` in `CadEditorComponent`.

- **Datum visibility persists on the Origin feature.** `OriginFeature.visibility?: Record<string, boolean>` for the seven datum ids (`origin` / `x_axis` / … / `xz_plane`). Missing keys default to visible. Stored inside the JSONB `featureTree` blob — no separate column. Visibility eyes in the tree mutate this map.

- **`tablesToClean` order in `backend/tests/setup.js`:** any model with a Part/User FK using `onDelete: RESTRICT` must be cleaned BEFORE Part/User. `DesignCADModelHistory` and `DesignCADModel` were added at the top of the list for this reason. Same pattern applies to future tables.

- **Hardcoded permission count in `backend/tests/__tests__/admin/user-permission.test.js`** was 45 → updated to 49 to account for `cad.{read,write,delete,approve}`. Future devs adding new permission resources need to bump this number.

- **Migration partial-state footgun.** Sequelize migrations in this repo aren't transactional; if a Docker hot-reload restarts mid-migration, partial state (created index, no `SequelizeMeta` row) traps re-runs with "relation already exists" errors. The CAD migration follows house style (non-transactional) but new migrations should wrap in `queryInterface.sequelize.transaction(...)` to roll back cleanly. The recovery is hand-written cleanup SQL — see the `DROP INDEX … DROP TABLE … DELETE FROM "Permissions" WHERE resource = 'cad'` pattern.

- **Action-driven UX pivot mid-implementation.** Initial draft was selection-first ("click plane → New Sketch button appears"). User course-corrected to a top-toolbar "Sketch / Extrude" pair that *prompts* for inputs ("Click a datum plane in the viewer"). The `mode` signal in `CadEditorComponent` (`'idle' | 'pick-plane' | 'pick-extrude-target'`) is the single source of truth for what the editor is waiting for; Esc cancels.

- **Three.js is now a project runtime dep** (`three@^0.165.0`, `@types/three`). First time. Datum picking uses a face-prefers-datum precedence rule (face hits win over datum hits at any distance) to avoid translucent datum planes intercepting clicks intended for solid faces.

- **Status:** DesignFeature 35 in `in_review`. 46 requirements all `unapproved`. Branch `cad` pushed, commit `9758a11` linked on feature record; `prURL` left null for the user to fill. Pending: apply migration, optionally swap to OCCT/PlaneGCS for non-polygon profiles, approve the 46 reqs.

### 2026-05-14 — Phase A foundation: PlaneGCS swap + entity-model refactor (REQs 558–565)

- **PlaneGCS swap landed sooner than May 12 predicted.** Trigger was adding Phase B reqs (566–606: perpendicular/parallel/tangent/equal/symmetric/concentric/collinear, dimension constraints, splines, conics, slots, polygons). The pure-TS iterative solver had no convergence guarantee for mixed systems involving these. Newton-Raphson + analytical Jacobians is what FreeCAD ships; that's the bar.

- **PlaneGCS is vendored under `frontend/src/app/cad/vendor/planegcs/`, not an npm dep.** Slow upstream cadence + single-maintainer footprint = vendoring insulates against takedown/unpublish/drift. LGPL-2.0-or-later honoured via the WASM substitution surface (users can drop in their own `planegcs.wasm`). See `PROVENANCE.md` in that dir for update procedure.

- **Sketch schema flipped to tagged-union `SketchEntity`** (kinds: point/line/circle/arc/ellipse/ellipticalArc/spline/conic). `reference` flag renamed to `construction`. Constraint targets become `{ entityId, sub? }` references. Legacy persisted JSONB docs auto-upgrade in memory via `migration.ts` wired into the editor bootstrap — no DB migration step.

- **Curve rendering ≠ tessellation.** Sketch editor draws circles/arcs as analytic SVG (`<circle>`, `<path d="…A…"/>`), zoom-independent at the render layer with no re-tessellation. The chord-tolerance tessellator (`tessellator.ts`) is for a different consumer: profile extraction feeds polylines to the extrude kernel.

- **Picker is parametric, not tessellation-based** (`picking.ts`). Coarse render tessellation doesn't degrade pick accuracy — `distanceToEntity` hit-tests against each entity's analytic definition.

- **`sub` on ConstraintTarget is declared but not consumed yet** — Phase B work. Solver translator currently reads `entityId` only; wires up when subelement-targeting constraints (e.g., tangent-at-endpoint) are added.

- **Phase B reqs 566–606 exist but unimplemented.** Data model supports them: entity kinds declared in `types.ts`, store cascading delete handles all kinds, tessellator/picker fall through to `Infinity` for the unsupported kinds. Outstanding: UI tools (circle/arc/rect/poly/ellipse/slot/spline/conic/text/image/equation), additional constraint solver mappings (perpendicular/parallel/tangent/equal/symmetric/midpoint/concentric/collinear + dimensions: radius/diameter/angle/distance), and per-kind tessellation/picking handlers.

- **Three commits this session:** `b647e16` (entity model + PlaneGCS + curve UI), `72161bd` (schema migration), `48f9b7a` (tessellator + picker). All in branch `cad`.

- **Status:** REQs 558–565 created and `unapproved`; user gates approval. DesignFeature 35 still `in_review`. Tests: 100/100 passing across 10 CAD spec files (vitest). DesignCADModels migration from May 12 still not applied.

### 2026-05-14 (cont.) — Phase B.1+B.2: circle/arc tools + 14 constraints with selection UI (REQs 566, 569, 582–589)

- **Construction flag now also pins curve dimensions, not just point positions.** Phase A established `construction: true` pins points (PlaneGCS `fixed`). Phase B extends this to circles (emits `circle_radius` driving constraint) and arcs (emits `arc_radius`). Rationale: under-constrained tangent solves were splitting constraint error between line movement and radius shrinkage — pinning radius makes "construction = locked reference geometry" semantically complete. REQ 560's wording allows this extension; the renderer-only "dashed style" reading was incomplete.

- **`translateConstraint` is now multi-return.** Some constraints emit a single PlaneGCS primitive (perpendicular, parallel), some dispatch by entity kind (tangent: 6 PlaneGCS variants by (line/circle/arc/ellipse) pairs; equal: 4 variants), some synthesize two primitives from one user-facing constraint (midpoint = point-on-line + point-on-perp-bisector; symmetric = midpoint-on-line + perpendicular; concentric = coincident on centers; collinear = parallel + point-on-line). Synthesized primitive IDs use `${constraint.id}-suffix` to avoid clashing with entity IDs.

- **arc_rules is required for every arc primitive.** PlaneGCS does NOT auto-emit it. Without arc_rules, the arc's center/start/end/angles/radius drift independently during solve. Emitted automatically in `buildPrimitives` as `arcrules-${arc.id}`.

- **`addArc` snaps the end click onto the radius.** The arc data model carries a scalar `radius`; renderer/picker/tessellator all assume `|center→start| == |center→end| == radius`. The store helper enforces this on creation by projecting the raw end click onto the circle of `|center→start|`. A user-facing implication: clicking three random points produces a *valid* arc, not the literal three points.

- **Constraint UI lives entirely in the sketch editor template.** `CONSTRAINT_SPECS` is a module-level array of `{type, label, icon, predicate, requiresValue}` records. The toolbar renders one icon button per spec; buttons are disabled when the current selection (in click order) doesn't satisfy the predicate. `orderTargetsForConstraint` re-orders selection into the canonical target shape for type-asymmetric constraints (point-on-line, midpoint, symmetric). Future refactor: extract to `cad/lib/constraintSpecs.ts` for unit testing.

- **Selection model is `Set<string>` in a signal.** Sets in signals require *replacement* (`set(new Set(...))`) not mutation — Angular signals use reference equality. Click in select mode pickEntity-dispatches (tolerance 3 SVG units, parametric from picking.ts so curves are pickable at the analytic boundary), then either toggle (shift-click) or set-to-one. Click on empty canvas clears selection (unless shift-held).

- **Distance constraint uses `window.prompt` for the value.** Quick and dirty; future replacement is a MatDialog. The user can cancel by pressing Esc or clicking cancel, which aborts the constraint application cleanly.

- **REQs 566/569 cover Circle (center+radius) and Arc (center+endpoints) only.** The other Phase B circle/arc variants (3-point, tangent, etc. — REQs 567/568/570/571) and rectangles/polygons/slots (REQs 572–581) are still unimplemented. The user-facing tool buttons are only for the two implemented variants.

- **Status:** REQs 566, 569, 582–589 (10 reqs) `unapproved`. Tests: 114/114 passing (14 new). Two commits: `8d3cf21` (data layer), `b1d9314` (UI). UI verified by tests at the data layer + needs manual smoke test in the browser (Docker dev server with hot reload — user owns this verification per project rules).

### 2026-05-14 (cont.) — Feature tree edit/delete/visibility + sketch delete (REQs 607–611)

- **Sketch deletion is a three-way choice, not yes/no.** When a sketch is referenced by Extrude features, the warning dialog offers Cascade / Break references / Cancel. "Break references" deliberately leaves the dependent Extrudes with a now-invalid sketchId — `regenerateModel` already emits an error for missing sketches, so the user sees the consequences in the feature tree without needing a new "broken feature" state. No type changes required.

- **`visible` flag lives only on ExtrudeFeature (and future non-Origin kinds).** Origin is exempt — datum visibility is already per-datum on `OriginFeature.visibility`. Hiding the Origin would be redundant with the existing per-datum controls. The flag is optional (missing == visible); `regenerateModel` short-circuits with `if (feature.visible === false) continue` before the kernel call.

- **Sketches don't get a visibility toggle.** They're 2D and only visible when actively being edited. Adding a Hide/Show on sketches would be UX noise. Sketches get only Edit and Delete in their context menu.

- **Origin row has no context menu at all.** The `onRowContextMenu` handler early-returns for `feature.type === 'origin'` and datum rows, falling through to the native browser menu. Avoids exposing a single-action menu (e.g., just Edit) that adds friction.

- **MatMenu positioning uses a floating anchor.** `<div class="menu-anchor" [style.left.px]="menuX()" [style.top.px]="menuY()" [matMenuTriggerFor]="menu">` is a zero-size element positioned `fixed` at the cursor. MatMenu reads the anchor's `getBoundingClientRect()` to place itself, so we `queueMicrotask(() => trigger.openMenu())` after setting position — opening synchronously would read stale coords. Same pattern is reusable for any other "context menu at cursor" need.

- **Editing the active sketch while in sketch mode auto-exits sketch mode if that sketch is being deleted.** `applySketchDelete` checks `activeSketchId() === sketchId` and clears the signal before applying the deletion — otherwise the editor would render against a missing sketch.

- **`FeatureTreeAction` is a tagged union on the action name**, not a method call. The tree panel emits `{action, featureId | sketchId}` so the cad-editor stays the single source of truth for dialog/state side effects; the tree stays pure UI.

- **Status:** REQs 607–611 created and `unapproved`. Tests: 124/124 passing (10 new — 4 deleteSketch, 4 removeFeaturesReferencingSketch, 2 regenerateModel visibility). Two commits: `0ed6d00` (data layer), `b665fd4` (UI). UI needs manual smoke test in the browser.

### 2026-05-14 (cont.) — UX refinements: circle extrude + point drag + sketch visibility + 3D-always sketching (REQs 612–616)

- **Single-circle extrude profile is a special-cased shortcut, not a general curve-loop extractor.** REQ 612: `extractClosedLoop` recognises the "exactly one non-construction circle and zero non-construction lines" case before the line-walking algorithm and returns the tessellated circle. Mixed line+arc loops (and multi-circle profiles) still error. The clean way to fix that is a general curve-aware loop walker — out of scope here.

- **Drag-to-move uses a "drag candidate" pattern, not "drag immediately on mousedown".** REQ 613: mousedown over a non-construction point stores a candidate; drag mode engages only after the cursor moves > 1 sketch unit. Under threshold, mouseup falls through to the existing click handler for selection toggling. `didDrag` flag suppresses the synthetic click event that fires after a drag completes. mousemove emits preview state without solving (fast); mouseup runs the solver via `commit()` so constraint-pinned points snap back.

- **`construction` continues to expand in meaning, deliberately.** Phase A pinned points; Phase B.1 added curve-radius pinning; in this session, REQ 614 added `Sketch.visible`. The TreeNode/feature-tree code unified its visibility-toggle button across datums, features, and sketches by dispatching at the click site (datum → `visibilityToggled` event, sketch → `actionRequested` with `toggle-sketch-visibility`, feature → context-menu-only). No grand abstraction; each kind owns its own state slot (`OriginFeature.visibility` map / `ExtrudeFeature.visible` / `Sketch.visible`).

- **The full SolidWorks-style restructure (REQ 616) replaces the entire 2D SVG sketch canvas with 3D overlay rendering + ray-plane projection.** `cad-sketch-editor` is now a toolbar-only component (SVG gone). `cad-viewer.toSketchCoords()` is the central piece: screen pixels → `Raycaster.setFromCamera()` → `Plane.intersectPlane()` → 2D coords via dot product against the sketch's xAxis/yAxis basis. Returns null when the camera is edge-on to the sketch plane. All sketch picking, dragging, and tool clicks go through this single conversion.

- **Mouse input map is conditional on `activeSketchId`.** Outside sketch mode: left=orbit, shift+left=pan, wheel=zoom (existing). In sketch mode: left=sketch, right=orbit, middle=pan, wheel=zoom. The viewer suppresses the native context menu so right-drag can orbit. Standard CAD convention; users coming from SolidWorks/OnShape will feel at home.

- **Tabbed ribbon uses `[hidden]`, not `*ngIf`.** State preservation: switching tabs doesn't recreate the sketch-editor component, so half-finished tool gestures (e.g., placed center for an arc, awaiting the second click) survive a tab switch. Effect on `activeSketchId` transitions auto-switches the tab on first change but a user-initiated `setActiveTab` stays sticky for the rest of that state.

- **The active sketch renders as a 3D overlay even during edits — but tool drafts (half-finished line/arc/circle) do not yet have 3D previews.** The overlay shows committed entities only. Live drafts of the in-progress shape would require rendering signal-state into Three.js objects per-frame; the SVG canvas got that for free. Worth a follow-up REQ if users notice. For now, click-by-click placement still works (the user just doesn't see the rubber-band preview until the click commits).

- **REQ 612 is `unapproved` but the bug-fix value is independent of the REQ approval workflow.** Same story for REQs 613, 614, 615, 616 — they describe shipping behaviour. User gates approval.

- **Status:** REQs 612–616 (5 reqs) `unapproved`. Tests: 131/131 passing (7 new — 3 circle profile, 4 setSketchVisibility). Five commits: `40c43eb` (circle extrude + drag), `952c0e5` (sketch visibility + 3D overlay), `e308150` (tabs + 3D-always sketching). All UI changes need manual smoke test in the browser.

### 2026-06-03 — CAD versioning redesign: protected main + branch-as-draft-revision + submit→approve→release (REQs 734–740)

- **Trunk-based model replaces the old self-service two-tier dev/prod flow.** `main` is now **protected** — `isLockedForEdit(model)` (controller) returns true whenever `branchName === 'main'` (independent of `releaseLocked`); checkout/update/checkin on main → 423. All work happens on **draft branches**; main advances only via release.
- **Branch revision is DERIVED, not a per-branch Part row.** `cadVcsService.derivedDraftRev` = `highestReleasedNumeric(lineage) + 1` (max numeric *tag* on the repo + 1). All concurrent draft branches show the **same** draft number — you can't mint a `Parts` row per branch (unique `(name,revision)`). The actual `Parts` row is created **at release** via `partRevisionService.createNewRevision`. `withReleaseFlag` now returns `displayRevision` / `draftRevision` / `behindMain`; the footer/editor read those, NOT `part.revision`.
- **Auto first branch:** `createForPart` calls `cadVcsService.seedMain` (initial empty commit on `main`) then creates + switches to `draft/01`. Idempotent: if the lineage repo already has the draft ref (re-create after soft-delete) it switches to it instead of erroring.
- **Release-to-main is SELF-SERVICE (no review/approval).** `POST /:id/release` is gated only by `cad.write`; on a draft branch it calls `releaseBranchToMain` directly: mint the numeric Part rev, **squash**-release the branch doc onto main (reuse `release()` with `model.branchName='main'` → new release commit + freeze + write-once tag), lock the Part, and **archive** the draft ref. The **review/approval workflow (submit→approve) gates only the production-letter release on `main`**, not the numeric release. On `main`, `/release` falls back to the legacy in-place (approval-gated) release. (History: first cut chained release into the `approve` transition; second made it a two-step approve-then-release on `cad.approve`; user then asked for fully self-service — current state. The editor shows the **Release** button on any checked-in draft branch (`cad.write`); the submit/approve workflow buttons appear only on `main`.)
- **FOOTGUN: workflow state is now keyed PER BRANCH.** `workflowRepo(model)` composes `repoId = "<lineageRoot>:<branchName>"` for all CAD `getState/setState/transition/canRelease`. No migration (`VcsWorkflowState` is free-form string keys). Multiple draft branches can be in review at once; `main` keeps its own production-approval cycle. Anything calling the engine with the bare lineage-root repo is wrong now.
- **Behind-main reconciliation — MERGE (feature-level), not rebase, in the UI (REQ 741):** when `main` advanced past a branch's base (`behindMain` = main head not in the branch's ancestry via `vcs.walk`), release is blocked (409) until reconciled. The supported tool is **`cadBranchService.reconcileBranch(model, featureIds)` + `POST /:id/reconcile`**: start from main's CURRENT doc, splice in the SELECTED branch features (add/replace + their sketches; a selected id absent from the branch = a branch deletion → removed), commit onto the branch with `parents=[mainHead]`. So the branch gets **main's latest + the chosen branch changes** (a 3-way per-feature merge; no auto whole-tree merge). The feature picker lives in the history **Branches tab → Merge**; the editor's behind-main button is **Merge** → opens that tool. `rebaseBranch` + `POST /:id/rebase` still exist (whole-branch-tree, last-writer-wins) but are **superseded in the UI by merge** — the user explicitly wanted "main's latest + specific branch changes", not last-writer-wins.
- **Production letter tier retained, off main** — `productionRelease` unchanged except its workflow calls now use `workflowRepo` (the `:main` key). Runs from the released main line; mints A/B tagging the same frozen commit.
- **The old `/dev-release` and `/new-revision` endpoints still exist but are vestigial** (superseded by create-branch + submit→approve→release). The editor no longer wires them (dead handlers `onDevRelease`/`onNewRevision`/`checkoutAsNewRevision` remain as dead code). Editor "Check out" on main → `onCreateBranch`; ribbon shows workflow Submit/Approve on draft branches, a **Release** button when approved, **Rebase** when behind, **Production** on main, **New branch** on main.
- **Status:** REQs 734–740 `unapproved`. Backend: 33 CAD suites / 244 tests green; `cad-release-workflow.test.js` fully rewritten to the branch model (6 tests), plus expectation updates in cad-vcs-routes/cad-branch-routes/cad-model-landing and an idempotency fix in cad-model-crud. Frontend (editor) compiled clean (`text-54`). Pending: cad-revision-list Branches-tab Submit/Rebase actions (editor already drives the full flow); browser smoke test; a one-time check on existing dev data (model 5 / repo 568 — its `draft/01`-less state predates auto-branch). All uncommitted.

### 2026-05-30 — CAD version control (content-addressed VCS) + two-tier release workflow (REQs 668–729)

- **The VCS is content-addressed and keyed to the part *lineage*, not a `DesignCADModel` row.** `cadVcsService.repoForModel` walks `previousRevisionID` to the lineage-root part id; that id is the `repoId`. So history stays continuous as manufacturing cuts new `Parts` rows. `DesignCADModel` was repurposed into the **working copy** (gained `branchName`, `baseCommitHash`, `lockedByUserID`/`lockedAt`/`lockExpiresAt`, `dirty`, `releaseLocked`). Backing tables: `VcsObject` (blob/tree/commit/component/geometry, content + bytes columns), `VcsRef` (branches mutable, tags write-once). Canonical JSON hashing (`canonicalJson.js`) is the linchpin — same content ⇒ same SHA-256 ⇒ stored once.

- **There is no separate "CAD revision."** A released CAD commit **is** `Parts.revision`; release tags the commit with the revision string. CAD-specific revision lettering was removed — revision identity belongs to the parts workflow.

- **Two-tier release reuses the existing Part revision system.** `partRevisionService` (extracted from `api/inventory/part/controller.js`) already had both halves: `createNewRevision` = next **numeric** rev (`'01'`, `'02'`, …), `releaseToProduction` = next **letter** rev (`A…Y` excl. I/O/Q/S/X/Z → `AA…`). Dev release = self-service (`cad.write`), freezes + write-once-tags the numeric rev, sets `releaseLocked` + `Parts.revisionLocked`. Production release = `cad.approve`-gated (workflow must be `approved`), assigns the next letter rev, and **tags the SAME frozen dev commit** with the letter — identical geometry guaranteed, no re-freeze.

- **`releaseLocked` is a third, distinct lock.** Don't confuse the three: `lockedByUserID` = transient edit/checkout lock (PDM checkout); `Parts.revisionLocked` = manufacturing-side immutability; `DesignCADModel.releaseLocked` = CAD design read-only after dev release. `update`/`checkout` guard on `releaseLocked` with **423**; release/new-revision/production guards use **409**.

- **FOOTGUN: `fetchActiveModel` includes the Part with only `id, name, sku, manufacturerPN, revision`.** Revision-cloning (`createNewRevision`/`releaseToProduction`) needs the *full* Part row — cloning the included partial row nulls required columns (`internalPart`, `vendor`, `minimumOrderQuantity`, `partCategoryID`) and throws `notNull` violations inside the transaction → 500. Always `db.Part.findByPk(model.partID)` before cloning, never `model.part`. (This bit the new-revision/production-release handlers; fixed.)

- **FOOTGUN (fixed 2026-06-02): `release()` mutated the branch before the write-once tag check.** It created the `release N` commit and advanced `main` *first*, then checked whether the tag already existed and threw 409 — so a repeated/raced/double-clicked release (or the dead `/:id/release` workflow path, which unlike `dev-release` neither requires a clean check-in nor sets `releaseLocked`) left an orphan duplicate `release N` commit and marched `main` *past* the actually-tagged commit. The history graph then showed an untagged duplicate as HEAD while the released badge sat on a buried ancestor (`model.baseCommitHash` diverged from the `main` ref). Fix: check the tag up front, and `createTag` *before* `updateBranch` so a race leaves only a harmless unreachable commit object. Repairing an already-corrupted repo = reset the `main` `VcsRef` back to the tagged/base commit (the orphans become unreachable). Note `release()` *always* creates a dedicated `release N` commit even when the working copy is clean — that is intentional, it carries the `meta.frozen` geometry snapshot (you can't add frozen meta to an existing immutable commit without changing its hash).

- **FOOTGUN: regen scopes a kernel face `persistentName` per body.** The kernel returns e.g. `f2-f0`; `cadRegenService` rewrites it to `f2#0-f0` (body-scoped). `faceNameDiff` and any test asserting face names must expect the scoped form.

- **Freeze loads geometry with zero kernel calls.** `cadFreezeService.freezeGeometry` stores per-body BReps + a mesh snapshot as content-addressed objects on the released commit; `geometryForCommit`/`loadFrozenGeometry` reconstruct from those. Checking out / exporting a released commit never regenerates. `exportStl`/`exportStep` for a release resolve the *tagged* commit (always frozen) → frozen breps → kernel serialization only.

- **STL needs a kernel rebuild.** Added a `cad-kernel` `exportStl` op (OCCT `write_stl_with_tolerance`, binary → base64 over JSON-RPC, `protocol.rs` uses explicit `#[serde(rename = "stlBase64")]`). Until the user rebuilds the kernel, the STL download degrades to 503 (`KernelRpcError` → method not found); STEP works immediately.

- **Branches are variants with no auto-merge.** `cadBranchService`: create/list/switch (dirty-guarded)/archive (main + current protected) + `cherryPick` (splice one `feature:<id>` blob + its referenced sketch blobs into the working copy). Diff is structural (`treeDiff`, O(changed) via hash equality) + 3D body/face diff. `workflowEngine` (declarative `draft→in_review→approved`, permission-guarded, best-effort notify) is the production-approval gate.

- **Migration `20260602000000-add-release-locked-to-cad-models.js` NOT yet applied** (user applies in dev). Kernel rebuild also pending.

- **Status:** REQs 668–724 cover the VCS / branches / diff / workflow / freeze / dev+prod release / STL+STEP / version-history preview — but they are all still `draft` (should be normalised to `unapproved`; user gates). Code-review session 2026-05-30 added REQs 725–729 (`unapproved`): Undo Checkout, Compare-view camera-lock toggle, gravity-aligned canonical sketch orientation, 90° view-rotation controls, visible datum-plane labels — all shipped behaviour with no prior requirement. Tests: full backend suite green (749 passing); added `frontend/.../cad/lib/diffFormat.spec.ts` (new, formats version-history diff lines) + 2 backend release-workflow edge-case tests (re-release 409, numeric-revision progression 00→01→02). All uncommitted pending user signal.
