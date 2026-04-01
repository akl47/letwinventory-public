# Build Feature Spec

## Context

The kitting system allows traces to be kitted to kit/assembly traces, but there's no dedicated workflow for building kits and assemblies. Users currently need to manually create a trace for the kit, then navigate to individual source traces to kit them. The Build page provides a streamlined workflow: view in-progress builds, start new ones, and scan barcodes to fulfill BOM lines — all from a single page.

## Requirements

### R1: Build Navigation (REQ 214)
- **Description:** Add "Build" as a top-level navigation rail item with a route at `/build`. Gated by `inventory` read permission.
- **Rationale:** Build is a primary workflow that should be quickly accessible, not buried under inventory.
- **Verification:** Build rail item appears in nav. Clicking it navigates to `/build`. Users without inventory read permission do not see it.
- **Validation:** User sees Build in the nav and can navigate to the page.

### R2: Build List View (REQ 215)
- **Description:** The `/build` page shows a table of all in-progress (partial status) kit/assembly traces. Columns: barcode, part name, category (Kit/Assembly), BOM progress (e.g., "3/5 items"), date created. Table is searchable.
- **Rationale:** Users need to see and resume existing in-progress builds.
- **Verification:** Table loads and displays partial kit/assembly traces. Search filters results. Empty state shown when no builds exist.
- **Validation:** User sees their in-progress builds and can search by part name.

### R3: New Build Dialog (REQ 216)
- **Description:** A "New Build" button opens a dialog where the user selects a kit or assembly part (autocomplete search), then creates a new trace for it. After creation, navigates to the build detail view.
- **Rationale:** Starting a build requires creating a kit/assembly trace — this streamlines it.
- **Verification:** Dialog opens with part autocomplete filtered to Kit/Assembly categories. Creating a build creates a trace and navigates to `/build/:barcodeId`.
- **Validation:** User clicks New Build, selects a kit part, and lands on the build detail view with a new trace.

### R4: Build Detail View (REQ 217)
- **Description:** The `/build/:barcodeId` page shows the kit/assembly trace's BOM with per-line fulfillment status (kitted qty / required qty). Shows the kit barcode, part name, and overall status (partial/complete). Includes a barcode scan input for kitting.
- **Rationale:** Users need to see what's needed and track progress while building.
- **Verification:** BOM lines display with correct quantities. Status updates after kitting.
- **Validation:** User sees the BOM, current fulfillment, and overall status.

### R5: Barcode Scan to Kit (REQ 218)
- **Description:** On the build detail view, a barcode scan input allows the user to scan a source trace barcode. The system looks up the scanned barcode, determines if it matches a BOM line, and prompts for quantity. After confirming, it executes the kit operation and refreshes the status.
- **Rationale:** Scanning is the fastest way to kit parts in a warehouse/lab environment.
- **Verification:** Scanning a valid barcode that matches a BOM line shows a quantity prompt. Confirming kits the trace and updates the BOM line's kitted quantity. Scanning a barcode that doesn't match any BOM line shows an error.
- **Validation:** User scans a barcode, enters quantity, and sees the BOM line update.

### R6: Build Completion Indicator (REQ 219)
- **Description:** When all BOM lines are fully satisfied, the build detail view shows a "Complete" status badge. The build no longer appears in the in-progress builds list.
- **Rationale:** Users need clear feedback when a build is done.
- **Verification:** Completing the last BOM line changes status to complete. The build disappears from the list view.
- **Validation:** User fulfills all BOM lines and sees the complete badge.

## API Contracts

No new backend APIs needed. The build page uses existing endpoints:

- `GET /api/inventory/part/categories` — to identify Kit/Assembly categories
- `GET /api/inventory/part?category=Kit|Assembly` — to list kit/assembly parts
- `POST /api/inventory/trace` — to create a new kit/assembly trace
- `GET /api/inventory/trace?partID=X` — to get traces for a part
- `GET /api/inventory/bom/:partId` — to get BOM for a kit/assembly
- `GET /api/inventory/trace/kit-status/:barcodeId` — to get fulfillment status
- `GET /api/inventory/barcode/lookup/:barcode` — to look up scanned barcode
- `POST /api/inventory/trace/kit/:barcodeId` — to kit a source trace
- `GET /api/inventory/part` — to get all parts (for filtering kit/assembly traces)

**One new endpoint needed** to list in-progress builds efficiently:

**GET /api/inventory/trace/in-progress-builds**
```json
// Response 200
[
  {
    "id": 1,
    "barcodeID": 123,
    "barcode": "AKL-000045",
    "partID": 10,
    "partName": "Motor Assembly Kit",
    "categoryName": "Kit",
    "categoryColor": "#4CAF50",
    "status": "partial",
    "bomTotal": 5,
    "bomFulfilled": 3,
    "createdAt": "2026-03-30T..."
  }
]
```

## UI Design

### Build List View (`/build`)
- Page header: "Builds" with "New Build" button (primary, icon: add)
- Search bar (same pattern as parts table)
- Material table with columns: Barcode, Part, Category (badge), Progress (e.g., "3/5"), Created
- Clicking a row navigates to `/build/:barcodeId`
- Empty state: "No builds in progress. Click New Build to start."

### New Build Dialog
- Part autocomplete (filtered to Kit/Assembly categories only)
- Location barcode input (where to create the trace)
- "Start Build" button
- On success: navigate to build detail

### Build Detail View (`/build/:barcodeId`)
- Header: part name, barcode tag, status badge (partial/complete)
- BOM table: Part name, Category badge, Qty Required, Qty Kitted, Status (fulfilled/remaining)
- Scan input: mat-form-field with barcode scanner icon, autofocus
- After scan: quantity input + confirm button
- Back button to return to build list

## Database Changes

None — uses existing tables (Traces, BillOfMaterialItems, BarcodeHistory, Parts, PartCategories).

## Test Scenarios

### Backend (Jest)
- `GET /api/inventory/trace/in-progress-builds` returns only partial kit/assembly traces
- Complete builds are excluded from the list

### Frontend (Vitest)
- Build list view: renders table, search filters, empty state
- New build dialog: part autocomplete filters to Kit/Assembly, creates trace
- Build detail view: renders BOM lines with fulfillment, scan input triggers kit

### E2E (Playwright)
- Navigate to build page, start new build, scan barcode, verify BOM updates

## Implementation Notes

### Files to Create
- `frontend/src/app/components/build/build-list-view/build-list-view.ts` — list page component
- `frontend/src/app/components/build/build-list-view/build-list-view.html` — template
- `frontend/src/app/components/build/build-list-view/build-list-view.css` — styles
- `frontend/src/app/components/build/build-view/build-view.ts` — detail page component
- `frontend/src/app/components/build/build-view/build-view.html` — template
- `frontend/src/app/components/build/build-view/build-view.css` — styles
- `frontend/src/app/components/build/new-build-dialog/new-build-dialog.ts` — new build dialog
- `frontend/src/app/components/build/new-build-dialog/new-build-dialog.html` — template

### Files to Modify
- `frontend/src/app/app.routes.ts` — add `/build` and `/build/:barcodeId` routes
- `frontend/src/app/components/common/nav/nav.component.ts` — add build nav group
- `frontend/src/app/components/common/nav/nav.component.html` — add build rail item + flyout
- `backend/api/inventory/trace/controller.js` — add `getInProgressBuilds` handler
- `backend/api/inventory/trace/routes.js` — add route

### Existing Patterns to Follow
- Nav: same pattern as Tools group (top-level, single child link)
- List view: parts-table-view pattern (search, Material table, signals)
- Detail view: part-edit-page pattern (card layout, data loading)
- Dialog: inventory-item-dialog pattern (autocomplete + form)
- Barcode scan: mobile-scanner pattern (input + lookup)
