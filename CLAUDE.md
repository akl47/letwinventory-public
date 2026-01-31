# Claude Code Change Log

This file tracks changes made to the codebase during Claude Code sessions.

# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

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

### Notes
- Wire ends API follows same pattern as other parts APIs (connector, wire, cable, component)
- Migration needs to be run: `npx sequelize-cli db:migrate`
- Termination types are now database-driven, allowing future additions without code changes
- Current branch: minor_fixes

---

## Instructions for Future Sessions

Each session should:
1. Add a new section with the date
2. List all files modified
3. Describe changes made and reasoning
4. Note any important decisions or context

