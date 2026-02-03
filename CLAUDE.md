# Claude Code Change Log

This file tracks changes made to the codebase during Claude Code sessions.

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

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.


## Session: 2026-01-06

### Files Modified
- `.env.development` (created)
- `.env.production` (created)
- `backend/index.js`
- `backend/models/index.js`
- `backend/config/config.json` (converted to `config.js`)
- `backend/Dockerfile.prod`
- `backend/api/auth/google/controller.js`
- `docker-compose.prod.yml`
- `frontend/angular.json`

### Changes Made

1. **Created environment-specific configuration files**
   - Created `.env.development` with development database host (`letwinventory-postgres`)
   - Created `.env.production` with production database host (`10.50.10.98`)

2. **Updated backend to use environment-specific .env files**
   - Modified `backend/index.js` to load `.env.production` when `NODE_ENV=production`, otherwise `.env.development`
   - Modified `backend/models/index.js` to use the same environment-specific .env loading logic

3. **Simplified docker-compose.prod.yml**
   - Changed to use `env_file: .env.production` instead of individual environment variables
   - Kept `NODE_ENV: production` in the environment section to ensure correct .env file is loaded

4. **Converted Sequelize config to use environment variables**
   - Renamed `backend/config/config.json` to `backend/config/config.js`
   - Updated to read from `.env.development` or `.env.production` based on `NODE_ENV`
   - Eliminates hardcoded database credentials in config file
   - Sequelize CLI now uses the same environment-specific configuration as the application

5. **Fixed Docker production build context**
   - Changed `docker-compose.prod.yml` build context from `./backend` to `.` (project root)
   - Updated `backend/Dockerfile.prod` to use correct paths relative to project root
   - Changed `../frontend` to `frontend` and `./package.json` to `backend/package.json`
   - Fixes Docker build error: "failed to compute cache key: '/frontend' not found"

6. **Increased Angular production build budgets**
   - Updated `frontend/angular.json` to increase budget limits
   - Initial bundle: increased from 1MB to 2MB error limit
   - Component styles: increased from 8kB to 16kB error limit
   - Fixes build failure due to `task-card-dialog.css` exceeding 8kB limit (was 11.47 kB)

7. **Fixed Google OAuth redirect and callback URL**
   - Updated redirect after authentication to use `FRONTEND_URL` environment variable
   - Development redirects to `http://localhost:4200` (Angular dev server)
   - Production redirects to `https://letwinventory.letwin.co`
   - Updated callback URL to use environment variable instead of hardcoded URL
   - Fixed `.env.development` callback URL: `http://localhost:3000/api/auth/google/callback` (was missing `/api`)
   - Updated `.env.production` callback URL: `https://letwinventory.letwin.co/api/auth/google/callback`
   - Added console.log to display OAuth configuration on startup for debugging
   - **Note:** Both callback URLs must be added to Google Cloud Console OAuth credentials

### Notes
- Production PostgreSQL server is now configured at `10.50.10.98`
- Development environment continues to use the Docker container `letwinventory-postgres`
- The application automatically selects the correct .env file based on NODE_ENV
- All database configuration now comes from environment files (no hardcoded values)
- Current branch: master

---

## Session: 2026-01-07

### Files Modified
- `frontend/src/environments/environment.ts` (created)
- `frontend/src/environments/environment.prod.ts` (created)
- `frontend/angular.json`
- `frontend/src/app/services/auth.service.ts`
- `frontend/src/app/services/task.service.ts`
- `frontend/src/app/services/inventory.service.ts`
- `frontend/src/app/services/project.service.ts`
- `frontend/src/app/services/history.service.ts`
- `frontend/src/app/components/common/nav/nav.component.ts`
- `frontend/src/app/components/inventory/barcode-dialog/barcode-dialog.ts`
- `backend/api/auth/google/controller.js`

### Changes Made

1. **Created Angular environment configuration files**
   - Created `frontend/src/environments/environment.ts` for development with `apiUrl: 'http://localhost:3000/api'`
   - Created `frontend/src/environments/environment.prod.ts` for production with `apiUrl: 'https://letwinventory.letwin.co/api'`

2. **Configured Angular build for environment file replacement**
   - Added `fileReplacements` to `angular.json` production configuration
   - Production builds automatically swap `environment.ts` with `environment.prod.ts`

3. **Updated all frontend services to use environment configuration**
   - `auth.service.ts`: Updated `checkAuthStatus` API URL
   - `task.service.ts`: Updated all task-related API URLs, fixed single quotes to backticks
   - `inventory.service.ts`: Updated inventory API base URL, added `getAllBarcodes()` and `getBarcodeZPL()` methods
   - `project.service.ts`: Updated project API base URL
   - `history.service.ts`: Updated task history API base URL
   - `barcode-dialog.ts`: Refactored to use InventoryService instead of direct HTTP calls

4. **Updated nav component login URL**
   - Changed Google OAuth login redirect to use `environment.apiUrl`

5. **Removed OAuth debugging code from backend**
   - Removed console.log statements for OAuth configuration in `backend/api/auth/google/controller.js`
   - Removed redirect URL debugging logs

6. **Refactored barcode-dialog component**
   - Removed direct HttpClient usage, now uses InventoryService
   - Removed all console.log debugging statements
   - Cleaner separation of concerns

### Notes
- Development builds use `http://localhost:3000/api`
- Production builds use `https://letwinventory.letwin.co/api`
- All hardcoded `localhost:3000` URLs have been replaced with environment variables
- Frontend now aligns with backend environment-specific configuration

---

## Session: 2026-01-08

### Files Modified
- `frontend/src/app/components/inventory/barcode-dialog/barcode-dialog.html`
- `frontend/src/app/components/inventory/barcode-dialog/barcode-dialog.ts`
- `frontend/src/app/components/inventory/barcode-dialog/barcode-dialog.css`
- `frontend/src/app/services/inventory.service.ts`
- `backend/api/inventory/barcode/controller.js`

### Changes Made

1. **Added barcode preview size toggle in barcode dialog**
   - Added separate "Preview Size" dropdown in barcode dialog to control preview rendering
   - Added "Print Label Size" dropdown to specify the size for actual printing
   - Both dropdowns support 3"x1" and 1.5"x1" label sizes
   - Preview updates dynamically when the preview size is changed

2. **Updated frontend barcode dialog component**
   - Added `selectedPreviewSize` signal to track preview size selection (defaults to 3x1)
   - Added `onPreviewSizeChange()` method that refetches and re-renders barcode preview when size changes
   - Updated `fetchZPL()` method to accept optional `labelSize` parameter
   - Updated `renderBarcodeImage()` method to use the selected label size in Labelary API URL
   - Kept `selectedLabelSize` separate for print operations

3. **Updated inventory service**
   - Modified `getBarcodeZPL()` method to accept optional `labelSize` parameter
   - Passes label size as query parameter to backend: `/api/inventory/barcode/display/:id?labelSize=3x1`
   - Maintains backward compatibility by making the parameter optional

4. **Updated backend barcode display endpoint**
   - Modified `displayBarcode` controller to read `labelSize` from query parameters
   - Defaults to '3x1' if no label size is specified
   - Routes to appropriate ZPL generation functions based on label size:
     - `generateZPLHeader_1_5x1()` and size-specific detail functions for 1.5x1 labels
     - `generateZPLHeader()` and standard detail functions for 3x1 labels
   - Supports LOC, BOX, and AKL (part) barcode types for both sizes

5. **Implemented collapsible print options UI**
   - Print options are now hidden by default to reduce visual clutter
   - Added `showPrintOptions` signal to control visibility of print options
   - Added `togglePrintOptions()` method to show/hide print options
   - "Print Label" button now shows the print options panel instead of immediately printing
   - When print options are visible, button changes to "Confirm Print" and a "Cancel" button appears
   - Preview options (preview size selector) remain always visible
   - Added CSS styling for both `.preview-options` and `.print-options` sections

### Notes
- Preview and print sizes are now independently selectable
- Users can preview a small barcode but print a large one, or vice versa
- Barcode preview refreshes automatically when preview size selection changes
- Print options are hidden by default until user clicks "Print Label" button
- Improved UX with two-step print confirmation workflow
- Current branch: print_barcode

---

## Session: 2026-01-28

### Files Modified
- `backend/models/common/uploadedFile.js`
- `backend/api/files/controller.js`
- `frontend/src/app/services/harness-parts.service.ts`
- `frontend/src/app/components/inventory/part-edit-dialog/part-edit-dialog.ts`
- `frontend/src/app/components/tasks/task-card/task-card.scss`
- `frontend/src/app/components/harness/harness-list-view/harness-list-view.css`

### Changes Made

1. **Removed category and description fields from file uploads**
   - Removed `category` and `description` field definitions from `uploadedFile.js` model
   - Updated `controller.js` to not accept or return category/description
   - Updated `harness-parts.service.ts`:
     - Removed `category` and `description` from `UploadedFileResponse` interface
     - Simplified `uploadFile()` method to only accept `file` parameter
   - Updated `part-edit-dialog.ts` to call `uploadFile()` with only the file argument (5 call sites updated)

2. **Fixed task card time estimate icon size**
   - Increased `.icon-xs` class from 10px to 14px in `task-card.scss`
   - Added explicit `width: 14px` and `height: 14px` for proper sizing
   - Timer icon in time estimate badges is now readable

3. **Fixed harness list empty state button icon**
   - Changed `.no-data mat-icon` to `.no-data > mat-icon` to only target direct children (decorative icons)
   - Added `.no-data button mat-icon` rule with 24px sizing for proper button icon display
   - The + icon in "Create Harness" button no longer inherits the 72px decorative icon size

### Notes
- File uploads are now simpler without category/description metadata
- The migration file already didn't have category/description columns, so no migration changes needed
- UI fixes improve readability and visual consistency
- Current branch: wire_harness

---

## Session: 2026-01-31

### Files Created
- `backend/migrations/20260130000001-create-wire-ends-table.js`
- `backend/models/parts/wireEnd.js`
- `backend/api/parts/wire-end/controller.js`
- `backend/api/parts/wire-end/routes.js`
- `backend/migrations/20260131000001-add-keyboard-shortcut-to-projects.js`
- `frontend/src/app/components/projects/projects-list-view/projects-list-view.ts`
- `frontend/src/app/components/projects/projects-list-view/projects-list-view.html`
- `frontend/src/app/components/projects/projects-list-view/projects-list-view.css`
- `frontend/src/app/components/projects/project-edit-dialog/project-edit-dialog.ts`
- `frontend/src/app/components/projects/project-edit-dialog/project-edit-dialog.html`
- `frontend/src/app/components/projects/project-edit-dialog/project-edit-dialog.css`

### Files Modified
- `frontend/src/app/components/tasks/task-card/task-card.ts`
- `frontend/src/app/components/tasks/task-card/task-card.html`
- `frontend/src/app/components/inventory/parts-table-view/parts-table-view.ts`
- `frontend/src/app/components/inventory/parts-table-view/parts-table-view.html`
- `frontend/src/app/components/tasks/task-card-dialog/task-card-dialog.ts`
- `frontend/src/app/models/harness.model.ts`
- `frontend/src/app/services/harness-parts.service.ts`
- `frontend/src/app/utils/harness/wire.ts`
- `frontend/src/app/components/harness/harness-property-panel/harness-property-panel.ts`
- `frontend/src/app/components/harness/harness-property-panel/harness-property-panel.html`
- `frontend/src/app/models/project.model.ts`
- `frontend/src/app/services/project.service.ts`
- `frontend/src/app/app.routes.ts`
- `frontend/src/app/components/tasks/sub-toolbar/sub-toolbar.ts`
- `frontend/src/app/components/tasks/sub-toolbar/sub-toolbar.html`
- `backend/models/planning/project.js`

### Changes Made

1. **Task card keyboard shortcut (1-9 assigns project)**
   - Added `isHovered` signal to track mouse hover state
   - Added `sortedProjects` computed to sort projects alphabetically
   - Added `@HostListener` for document keydown events
   - When card is hovered and number key 1-9 is pressed, assigns corresponding project
   - Key 0 clears the project assignment
   - Added `onMouseEnter()` and `onMouseLeave()` handlers to template

2. **Added createdAt column to parts table view**
   - Added `'createdAt'` to `displayedColumns` array
   - Added column template with date pipe formatting (`MMM d, y`)
   - Column is sortable via mat-sort-header

3. **Fixed sorting on parts table view**
   - Added `getSortValue()` helper method for proper sort value extraction
   - Handles nested properties (`PartCategory.name` for category column)
   - Handles date strings (converts to timestamp for numeric comparison)
   - Handles null/undefined values (sorted last)
   - Case-insensitive string comparison

4. **Created Wire Ends database table and API**
   - Created migration with `WireEnds` table (id, code, name, description, activeFlag)
   - Seeds 9 existing termination types: f-pin, m-pin, f-spade, m-spade, ring, fork, ferrule, soldered, bare
   - Created Sequelize model `WireEnd`
   - Created REST API with CRUD operations at `/api/parts/wire-end`
   - Added `WireEnd` interface to frontend harness model
   - Added service methods: `getWireEnds()`, `getWireEndByCode()`, `createWireEnd()`, `updateWireEnd()`, `deleteWireEnd()`
   - Updated `wire.ts` with `setTerminationLabels()` and `getTerminationLabel()` functions
   - Updated harness property panel to load termination types from API instead of hardcoded array

5. **Calendar start time 15-minute rounding**
   - Added `roundToNearest15Minutes()` helper method
   - When opening date picker with no existing due date, default time is now current time rounded down to nearest 15-minute interval
   - Previously hardcoded to `12:00`

6. **Created Projects List View component**
   - New standalone component at `frontend/src/app/components/projects/projects-list-view/`
   - Material table with pagination, sorting, and search filtering
   - Columns: Tag (shortName as colored chip), Name, Description, Keyboard Shortcut, Created Date
   - Clickable rows open project edit dialog
   - "Show Inactive" toggle to include archived projects
   - Back button using Location service for browser navigation
   - Added route `/projects` in `app.routes.ts`

7. **Created Project Edit Dialog component**
   - New dialog at `frontend/src/app/components/projects/project-edit-dialog/`
   - Reactive form with fields: name, shortName, keyboardShortcut (1-9 dropdown), color picker, description, activeFlag
   - Color picker uses native `<input type="color">` outside mat-form-field for proper display
   - Handles `#` prefix stripping/adding for tagColorHex (stored without #)
   - Dropdown shows only available shortcuts (filters out already-used ones)
   - Supports create and edit modes based on dialog data

8. **Added keyboardShortcut field to Projects**
   - Created migration `backend/migrations/20260131000001-add-keyboard-shortcut-to-projects.js`
   - Added field to `backend/models/planning/project.js` with validation regex `/^[1-9]$/`
   - Field is unique but nullable (digits 1-9 only, 0 reserved for "no project")
   - Added to `frontend/src/app/models/project.model.ts` interface

9. **Updated Project Service with CRUD methods**
   - Added `getProjectById()`, `createProject()`, `updateProject()`, `deleteProject()`
   - Full REST operations for project management

10. **Updated task-card keyboard shortcuts to use project.keyboardShortcut**
    - Changed from hardcoded index-based assignment to using project's keyboardShortcut field
    - Key 0 clears project assignment
    - Keys 1-9 find project with matching keyboardShortcut value
    - Added toggle behavior: pressing same shortcut removes project assignment

11. **Added "Edit Projects" button in task sub-toolbar**
    - Added Router injection and `openEditProjects()` method to sub-toolbar component
    - Button appears when in edit mode, navigates to `/projects`

### Notes
- Wire ends API follows same pattern as other parts APIs (connector, wire, cable, component)
- Migration needs to be run: `npx sequelize-cli db:migrate`
- Termination types are now database-driven, allowing future additions without code changes
- Projects are managed via list view at `/projects` route
- Keyboard shortcuts 1-9 allow quick project assignment when hovering task cards
- tagColorHex is stored WITHOUT the # prefix in the database
- Current branch: minor_fixes

---

## Session: 2026-02-01

### Files Created
- `backend/migrations/20260201000001-add-harness-release-state.js`
- `backend/migrations/20260201000002-create-harness-revision-history.js`
- `backend/models/parts/HarnessRevisionHistory.js`
- `frontend/src/app/utils/harness/elements/sub-harness.ts`

### Files Modified
- `docs/harness-features-plan.md`
- `frontend/src/app/models/harness.model.ts`
- `frontend/src/app/services/harness.service.ts`
- `frontend/src/app/utils/harness/elements/index.ts`
- `frontend/src/app/utils/harness/elements/connector.ts`
- `backend/api/parts/harness/controller.js`
- `backend/api/parts/harness/routes.js`
- `backend/models/parts/WireHarness.js`

### Changes Made

1. **Feature 1: Harness Sub-Assemblies**
   - Added `SubHarnessRef` interface to harness.model.ts
   - Added `subHarnesses` array to `HarnessData` interface
   - Added sub-harness fields to `HarnessConnection` (fromSubHarness, toSubHarness, fromSubConnector, toSubConnector)
   - Backend: Added cycle detection (`wouldCreateCycle`) and reference validation in validateHarness
   - Backend: Added delete protection - cannot delete harness used as sub-harness elsewhere
   - Backend: Added `GET /sub-harness-data?ids=1,2,3` endpoint for batch fetching
   - Backend: Added `GET /:id/parents` endpoint to find parent harnesses
   - Frontend: Added `getSubHarnessData()` and `getParentHarnesses()` to harness.service.ts
   - Created `sub-harness.ts` with drawing and hit-testing functions for collapsed/expanded views

2. **Feature 2: Connector Mating Points**
   - Each connector pin now has two connection points:
     - Wire point (circle) - for wire connections (existing behavior)
     - Mating point (square) - on opposite side for direct connector-to-connector mating
   - Added `connectionType: 'wire' | 'mating'` to `HarnessConnection` interface
   - Updated `drawConnector()` to render mating points as small squares
   - Added `getConnectorPinPositionsWithSide()` returning positions with side info
   - Added `hitTestConnectorPinWithSide()` returning which side was hit
   - Backend validation: mating connections must be between two connectors only

3. **Feature 3: Revision Control & Release Cycle**
   - Added `ReleaseState` type ('draft' | 'review' | 'released')
   - Added release fields to `WireHarness`: releaseState, releasedAt, releasedBy, previousRevisionID
   - Created `HarnessRevisionHistory` table and model for tracking changes
   - Added revision control API endpoints:
     - `POST /:id/submit-review` - Draft → Review
     - `POST /:id/reject` - Review → Draft (with notes)
     - `POST /:id/release` - Review → Released
     - `GET /:id/history` - Get change history
     - `GET /:id/revisions` - Get all revisions (A, B, C...)
     - `POST /:id/revert/:historyId` - Revert to snapshot
   - `updateHarness` now auto-creates new revision when editing a released harness
   - `createHarness` logs initial 'created' history entry
   - Added frontend service methods: submitForReview, reject, release, getHistory, getAllRevisions, revertToSnapshot

### Notes
- Migrations need to be run: `npx sequelize-cli db:migrate`
- Sub-harnesses are stored in harnessData JSON, not a separate table
- Revision letters increment: A → B → C → ... → Z → AA → AB
- Released harnesses are immutable - edits create new revision
- Current branch: harness_subassemblies

---

## Session: 2026-02-02

### Files Modified
- `frontend/src/app/utils/harness/elements/sub-harness.ts`
- `frontend/src/app/components/harness/harness-canvas/harness-canvas.ts`
- `frontend/src/app/components/harness/harness-canvas/harness-canvas.html`
- `frontend/src/app/components/harness/harness-toolbar/harness-toolbar.ts`
- `frontend/src/app/components/harness/harness-toolbar/harness-toolbar.html`
- `frontend/src/app/components/harness/harness-page/harness-page.html`

### Changes Made

1. **Fixed cable bounds calculation in sub-harness rendering**
   - Added `CABLE_WIRE_SPACING` import to sub-harness.ts
   - Fixed `getCableVisualBounds()` to correctly calculate cable bounds
   - Cable position is at first wire, body extends upward (negative Y)
   - Calculates `topOffset` using header, part name row, info row heights

2. **Moved group/ungroup from toolbar to context menu**
   - Removed group/ungroup buttons from toolbar HTML
   - Added "Group Selected" option to context menu (shows when multiple items selected)
   - Added "Ungroup" option to context menu (shows when grouped item selected)
   - Added group/ungroup action handlers in `onContextMenuAction()`
   - Removed unused `hasMultipleSelected`, `hasGroupSelected` inputs from toolbar
   - Removed unused `groupSelected`, `ungroupSelected` outputs from toolbar
   - Cleaned up bindings in harness-page.html

3. **Fixed sub-harness edit mode selection highlighting and node editing**
   - Created `SubHarnessEditState` interface with selection and mode state
   - Created `drawSubHarnessEditMode()` function for edit mode rendering
   - Created `drawSubHarnessWiresEditMode()` function with selection and control point support
   - Edit mode now passes selection state to sub-harness drawing:
     - `selectedConnectorId`, `selectedCableId`, `selectedComponentId`, `selectedConnectionId`
     - `isNodeEditMode` flag when tool is 'nodeEdit'
   - Selected elements in sub-harness edit mode now highlight correctly
   - Wire control points now visible in nodeEdit mode when wire is selected

4. **Fixed shift-click to toggle selection**
   - Shift-clicking an already-selected item now deselects it
   - Added `removeFromSelection()` method to canvas component
   - Updated shift-click handlers for connector, cable, component, subHarness, and connection
   - All element types now support toggle selection with shift-click

### Notes
- TypeScript diagnostics may appear stale - the model has all required properties
- Sub-harness edit mode now functions like normal edit mode for selection/nodes
- Context menu group/ungroup provides cleaner toolbar
- Current branch: harness_subassemblies

---

## Session: 2026-02-02 (continued)

### Files Created
- `frontend/src/app/services/harness-history.service.ts`

### Files Modified
- `frontend/src/app/components/harness/harness-canvas/harness-canvas.ts`
- `frontend/src/app/components/harness/harness-toolbar/harness-toolbar.ts`
- `frontend/src/app/components/harness/harness-toolbar/harness-toolbar.html`
- `frontend/src/app/components/harness/harness-page/harness-page.ts`
- `frontend/src/app/components/harness/harness-page/harness-page.html`

### Changes Made

1. **Implemented Undo/Redo for Harness Canvas**
   - Created `HarnessHistoryService` with past/future stacks of HarnessData states
   - Maximum 50 history entries (configurable)
   - Signals `canUndo` and `canRedo` for UI binding
   - Methods:
     - `push(state)` - for instant operations (delete, rotate, flip, add element)
     - `beginTransaction(state)` / `commitTransaction(newState)` - for drag operations
     - `undo(currentState)` / `redo(currentState)` - returns restored state
     - `clear()` - clears all history

2. **Added drag lifecycle outputs to canvas**
   - `dragStart` output emitted when any drag operation begins
   - `dragEnd` output emitted when any drag operation ends
   - Added `emitDragStartOnce()` and `emitDragEndIfStarted()` helper methods
   - Drag events emitted for: connector, cable, component, sub-harness, control point, label dragging

3. **Added toolbar buttons for undo/redo**
   - Added `canUndo` and `canRedo` inputs to toolbar
   - Added `undo` and `redo` outputs
   - Buttons placed in edit operations toolbar group with tooltips

4. **Integrated undo/redo in harness-page**
   - Injected `HarnessHistoryService`
   - Added `onDragStart()` and `onDragEnd()` handlers for transaction pattern
   - Added `onUndo()` and `onRedo()` methods that restore state and trigger auto-save
   - Added keyboard shortcuts: Ctrl+Z (undo), Ctrl+Y / Ctrl+Shift+Z (redo)
   - History cleared when loading different harness or creating new harness
   - History push before: delete, rotate, flip, paste, add connector/cable/component/sub-harness, group/ungroup, bring to front/send to back/move forward/move backward, all property panel changes

### Notes
- Drag operations use transaction pattern: snapshot on mousedown, commit on mouseup only if data changed
- Property panel changes also push to history (metadata, connector properties, connection properties, pin labels, bulk wire changes)
- Undo/redo toolbar buttons are disabled when history stack is empty
- Current branch: harness_subassemblies

---

## Session: 2026-02-02 (part 3)

### Files Modified
- `frontend/src/app/components/harness/harness-toolbar/harness-toolbar.scss`
- `frontend/src/app/components/harness/harness-list-view/harness-list-view.ts`
- `frontend/src/app/components/harness/harness-list-view/harness-list-view.html`
- `frontend/src/app/components/harness/harness-list-view/harness-list-view.css`
- `frontend/src/app/components/harness/harness-property-panel/harness-property-panel.ts`
- `frontend/src/app/components/harness/harness-property-panel/harness-property-panel.html`
- `frontend/src/app/components/harness/harness-page/harness-page.ts`
- `frontend/src/app/components/harness/harness-page/harness-page.html`
- `frontend/src/app/models/harness.model.ts`

### Changes Made

1. **Styled disabled toolbar buttons darker**
   - Added `.toolbar-group button:disabled` rule with `color: #505050`
   - Disabled undo/redo buttons now appear more clearly disabled

2. **Added release status column to harness list view**
   - Added 'releaseState' to `displayedColumns` array
   - Added column template with status chip showing draft/review/released
   - Added CSS styling for status chips:
     - `.status-draft`: gray background (#424242)
     - `.status-review`: orange background (#f57c00)
     - `.status-released`: green background (#388e3c)

3. **Added release button to harness property panel**
   - Added `releaseHarness` output event
   - Added release button in harness-actions section
   - Button text changes based on current state:
     - Draft → "Release" (starts review workflow)
     - Review → "In Review" (proceeds to release)
     - Released → "Released" (disabled)

4. **Implemented release workflow in harness-page**
   - Added `onReleaseHarness()` method
   - Draft state: confirms and calls `submitForReview()`
   - Review state: confirms and calls `release()`
   - Updates local state after successful API calls
   - Wired up `(releaseHarness)` event in template

5. **Added releaseState to HarnessData interface**
   - Added `releaseState?: ReleaseState` field to `HarnessData`
   - Moved `ReleaseState` type definition before `HarnessData` for proper ordering
   - Updated `loadHarness()` to include `releaseState` when merging harness data

### Notes
- Release workflow: Draft → Review → Released
- Released harnesses are locked from further edits (button disabled)
- The backend was already implemented in a previous session (Feb 1)
- Current branch: harness_subassemblies

---

## Session: 2026-02-02 (part 4)

### Files Modified
- `frontend/src/app/components/harness/harness-toolbar/harness-toolbar.ts`
- `frontend/src/app/components/harness/harness-toolbar/harness-toolbar.html`
- `frontend/src/app/components/harness/harness-page/harness-page.ts`
- `frontend/src/app/components/harness/harness-page/harness-page.html`
- `frontend/src/app/components/harness/harness-canvas/harness-canvas.ts`
- `frontend/src/app/components/harness/harness-property-panel/harness-property-panel.ts`
- `frontend/src/app/components/harness/harness-property-panel/harness-property-panel.html`

### Changes Made

1. **Read-only mode for released harnesses - Toolbar**
   - Added `isReleased` input to toolbar component
   - Added `newRevision` output for creating new revisions
   - Disabled editing tools when released: wire tool, node edit, add elements, rotate, flip, delete, undo/redo, import
   - Kept enabled: select, pan, zoom, export, grid toggle
   - Added "New Revision" button that appears when harness is released

2. **Read-only mode for released harnesses - Canvas**
   - Added `isReleased` input to canvas component
   - Added early return in `onMouseMove` when released (prevents all dragging)
   - Prevented wire drawing in select mode when released
   - Prevented control point dragging in node edit mode when released
   - Prevented element dragging (connector, cable, component, sub-harness) when released
   - Selection still works (clicking selects elements without starting drag)

3. **Read-only mode for released harnesses - Property Panel**
   - Added `isReleased` input to property panel component
   - Disabled all form fields when released:
     - Name, description inputs
     - Wire properties (label, color, gauge, length, terminations)
     - Delete harness button
   - Hid bulk wire edit panel when released
   - Release button shows "Released" and is disabled

4. **New Revision functionality**
   - Added `isReleased` computed signal to harness-page
   - Added `onNewRevision()` method that calls `updateHarness()` on released harness
   - Backend auto-creates new revision when updating a released harness
   - Navigates to the new revision after creation
   - Added `getNextRevision()` helper for preview (A→B, Z→AA)

### Notes
- Selection still works in released mode - can click to view properties
- Double-click should still open dialogs (read-only)
- New Revision button appears in toolbar when harness is released
- Current branch: harness_subassemblies

---

## Instructions for Future Sessions

Each session should:
1. Add a new section with the date
2. List all files modified
3. Describe changes made and reasoning
4. Note any important decisions or context

