# Claude Code Change Log

This file tracks changes made to the codebase during Claude Code sessions.

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

## Instructions for Future Sessions

Each session should:
1. Add a new section with the date
2. List all files modified
3. Describe changes made and reasoning
4. Note any important decisions or context

