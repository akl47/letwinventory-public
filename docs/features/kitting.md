# Kitting & Assemblies Feature Spec

## Context

Manufacturing workflows require grouping individual parts into kits (collections of loose parts) and assemblies (built units). Currently, letwinventory tracks individual parts and traces but has no way to define a bill of materials (BOM) for a composite item, track which traces were consumed to build it, or manage kit fulfillment status.

This feature adds two new part categories — **Kit** and **Assembly** — that behave identically for now but are distinct types for future divergence. Each defines a BOM (list of required parts with quantities), can have traces (barcodes), and supports a kitting workflow where source traces are consumed into a kit/assembly trace.

## Requirements

### R1: Kit Part Category (REQ 193)
- **Description:** Add "Kit" as a new part category in the database.
- **Rationale:** A distinct category type enables kit-specific UI sections and future behavioral divergence from assemblies.
- **Verification:** Migration seeds the Kit category; it appears in the part category dropdown.
- **Validation:** User can select Kit when creating a new part.

### R2: Assembly Part Category (REQ 194)
- **Description:** Add "Assembly" as a new part category in the database.
- **Rationale:** A distinct category type enables assembly-specific UI sections and future behavioral divergence from kits.
- **Verification:** Migration seeds the Assembly category; it appears in the part category dropdown.
- **Validation:** User can select Assembly when creating a new part.

### R3: Kit Bill of Materials (BOM) Model (REQ 195)
- **Description:** A kit part defines a BOM — a list of required items, each referencing a part and a required quantity. Nesting is allowed (a BOM line can reference another kit or assembly part). Circular references must be rejected.
- **Rationale:** The BOM defines what goes into a kit and drives the kitting workflow.
- **Verification:** API rejects circular BOM references. BOM items persist and load correctly for kit parts.
- **Validation:** User can add/remove BOM lines on a kit part edit page and see them on reload.

### R4: Assembly Bill of Materials (BOM) Model (REQ 196)
- **Description:** An assembly part defines a BOM — a list of required items, each referencing a part and a required quantity. Nesting is allowed (a BOM line can reference another kit or assembly part). Circular references must be rejected.
- **Rationale:** The BOM defines what goes into an assembly and drives the kitting workflow.
- **Verification:** API rejects circular BOM references. BOM items persist and load correctly for assembly parts.
- **Validation:** User can add/remove BOM lines on an assembly part edit page and see them on reload.

### R5: Kit BOM UI on Part Edit Page (REQ 197)
- **Description:** When the selected part category is Kit, show a BOM editor section. Each line has a part selector (autocomplete) and quantity input. Lines can be added/removed. The BOM is saved alongside the part.
- **Rationale:** Users need a visual way to define kit composition.
- **Verification:** BOM section appears only for Kit category. Part autocomplete works. Lines save and reload.
- **Validation:** User creates a kit with 3 BOM lines, saves, reloads, and sees them.

### R6: Assembly BOM UI on Part Edit Page (REQ 198)
- **Description:** When the selected part category is Assembly, show a BOM editor section. Each line has a part selector (autocomplete) and quantity input. Lines can be added/removed. The BOM is saved alongside the part.
- **Rationale:** Users need a visual way to define assembly composition.
- **Verification:** BOM section appears only for Assembly category. Part autocomplete works. Lines save and reload.
- **Validation:** User creates an assembly with 3 BOM lines, saves, reloads, and sees them.

### R7: KITTED & UNKITTED Barcode History Action Types (REQ 200)
- **Description:** Add two new BarcodeHistoryActionTypes: KITTED (id: 8) and UNKITTED (id: 9).
- **Rationale:** Kitting and un-kitting are distinct inventory operations that need audit trail entries.
- **Verification:** Migration seeds both action types. They appear in barcode history displays.
- **Validation:** After a kitting operation, both source and kit/assembly traces show the correct action in history.

### R8: Kit Trace — Kit a Trace (REQ 201)
- **Description:** `POST /api/inventory/trace/kit/:barcodeId` — kits a source trace (identified by barcodeId) to a target kit trace. Request body: `{ targetBarcodeId, quantity }`. Deducts quantity from source trace, records KITTED history on both source and target traces (source fromID→target toID, target fromID←source). If source quantity reaches 0, deactivate the source trace.
- **Rationale:** Core kitting operation that moves inventory from individual traces into kit traces.
- **Verification:** Source quantity decreases. Target kit history shows inbound. Source history shows outbound. Zero-quantity traces are deactivated.
- **Validation:** User kits 5 units from a trace of 20 into a kit; source shows 15, kit history shows +5.

### R9: Assembly Trace — Kit a Trace (REQ 202)
- **Description:** `POST /api/inventory/trace/kit/:barcodeId` — kits a source trace (identified by barcodeId) to a target assembly trace. Request body: `{ targetBarcodeId, quantity }`. Deducts quantity from source trace, records KITTED history on both source and target traces. If source quantity reaches 0, deactivate the source trace.
- **Rationale:** Core kitting operation that moves inventory from individual traces into assembly traces.
- **Verification:** Source quantity decreases. Target assembly history shows inbound. Source history shows outbound. Zero-quantity traces are deactivated.
- **Validation:** User kits 5 units from a trace of 20 into an assembly; source shows 15, assembly history shows +5.

### R10: Kit Trace — Unkit a Trace (REQ 203)
- **Description:** `POST /api/inventory/trace/unkit/:barcodeId` — reverses a kitting operation on a kit trace. Request body: `{ targetBarcodeId, quantity }`. The barcodeId is the kit trace; targetBarcodeId is the original source trace to return quantity to. Adds quantity back to the source trace, records UNKITTED history on both. If source trace was deactivated, reactivate it.
- **Rationale:** Users need to reverse kitting mistakes or disassemble kits.
- **Verification:** Source quantity increases. Kit history shows outbound. Deactivated traces are reactivated.
- **Validation:** User unkits 5 units from a kit back to the source trace; source quantity restored.

### R11: Assembly Trace — Unkit a Trace (REQ 204)
- **Description:** `POST /api/inventory/trace/unkit/:barcodeId` — reverses a kitting operation on an assembly trace. Request body: `{ targetBarcodeId, quantity }`. The barcodeId is the assembly trace; targetBarcodeId is the original source trace to return quantity to. Adds quantity back to the source trace, records UNKITTED history on both. If source trace was deactivated, reactivate it.
- **Rationale:** Users need to reverse kitting mistakes or disassemble assemblies.
- **Verification:** Source quantity increases. Assembly history shows outbound. Deactivated traces are reactivated.
- **Validation:** User unkits 5 units from an assembly back to the source trace; source quantity restored.

### R12: Kit Fulfillment Status (REQ 205)
- **Description:** A kit trace has a computed fulfillment status: **complete** (all BOM lines fully satisfied) or **partial** (one or more BOM lines not fully satisfied). This is derived from the kitting history against the BOM. Expose via `GET /api/inventory/trace/kit-status/:barcodeId`.
- **Rationale:** Users need to see at a glance whether a kit is ready.
- **Verification:** Status endpoint returns correct status based on kitted quantities vs. BOM requirements.
- **Validation:** Partially kitted kit shows "partial"; fully kitted kit shows "complete".

### R13: Assembly Fulfillment Status (REQ 206)
- **Description:** An assembly trace has a computed fulfillment status: **complete** (all BOM lines fully satisfied) or **partial** (one or more BOM lines not fully satisfied). This is derived from the kitting history against the BOM. Expose via `GET /api/inventory/trace/kit-status/:barcodeId`.
- **Rationale:** Users need to see at a glance whether an assembly is ready.
- **Verification:** Status endpoint returns correct status based on kitted quantities vs. BOM requirements.
- **Validation:** Partially kitted assembly shows "partial"; fully kitted assembly shows "complete".

### R14: Kit Status Display in UI (REQ 207)
- **Description:** Show kit fulfillment status on the part edit page trace table for kit parts. Partial kits show a warning badge; complete kits show a success badge. The BOM section shows per-line fulfillment (kitted qty / required qty).
- **Rationale:** Visual feedback for kit assembly progress.
- **Verification:** Badges render correctly for kit traces. Per-line quantities update after kitting.
- **Validation:** User sees partial badge on a kit, kits remaining items, badge changes to complete.

### R15: Assembly Status Display in UI (REQ 208)
- **Description:** Show assembly fulfillment status on the part edit page trace table for assembly parts. Partial assemblies show a warning badge; complete assemblies show a success badge. The BOM section shows per-line fulfillment (kitted qty / required qty).
- **Rationale:** Visual feedback for assembly progress.
- **Verification:** Badges render correctly for assembly traces. Per-line quantities update after kitting.
- **Validation:** User sees partial badge on an assembly, kits remaining items, badge changes to complete.

### R16: Kitting Action in Barcode Movement Dialog (REQ 209)
- **Description:** Add a "Kit" action to the barcode movement dialog (alongside existing Move, Split, Merge, Adjust). The Kit action shows a target kit/assembly trace selector and quantity input. Only kit/assembly traces appear as valid targets.
- **Rationale:** Kitting should be accessible from the same UI patterns as other trace operations.
- **Verification:** Kit action appears in dialog. Target selector filters to kit/assembly traces only.
- **Validation:** User selects Kit action, picks a target kit or assembly, enters quantity, and the operation completes.

### R17: Order Line Items Support Kits (REQ 210)
- **Description:** Order line items can reference kit parts. The order UI's part selector includes the Kit category and the order view renders kit line items correctly.
- **Rationale:** Kits need to be orderable.
- **Verification:** Kit parts appear in order item part selector. Order view displays kit line items.
- **Validation:** User creates an order with a kit line item and sees it in the order view.

### R18: Order Line Items Support Assemblies (REQ 211)
- **Description:** Order line items can reference assembly parts. The order UI's part selector includes the Assembly category and the order view renders assembly line items correctly.
- **Rationale:** Assemblies need to be orderable.
- **Verification:** Assembly parts appear in order item part selector. Order view displays assembly line items.
- **Validation:** User creates an order with an assembly line item and sees it in the order view.

### R19: Cycle Detection for Nested Kits (REQ 212)
- **Description:** When saving a BOM for a kit, validate that no circular references exist (Kit A contains Kit B which contains Kit A). Use depth-first traversal to detect cycles before saving.
- **Rationale:** Circular BOMs would cause infinite loops in fulfillment calculations and display.
- **Verification:** API returns 400 with descriptive error when a cycle is detected.
- **Validation:** User tries to add Kit A to Kit B's BOM when Kit B is already in Kit A's BOM; sees error.

### R20: Cycle Detection for Nested Assemblies (REQ 213)
- **Description:** When saving a BOM for an assembly, validate that no circular references exist (Assembly A contains Assembly B which contains Assembly A). Use depth-first traversal to detect cycles before saving. Also detects cross-type cycles (Assembly A contains Kit B which contains Assembly A).
- **Rationale:** Circular BOMs would cause infinite loops in fulfillment calculations and display.
- **Verification:** API returns 400 with descriptive error when a cycle is detected.
- **Validation:** User tries to create a circular reference involving assemblies; sees error.

## API Contracts

### BOM Endpoints (new)

**GET /api/inventory/part/:id/bom**
```json
// Response 200
{
  "bomItems": [
    { "id": 1, "partID": 42, "quantity": 3, "part": { "id": 42, "name": "M3 Bolt", "sku": "...", "partCategory": { "name": "..." } } },
    { "id": 2, "partID": 15, "quantity": 1, "part": { "id": 15, "name": "Bracket", ... } }
  ]
}
```

**PUT /api/inventory/part/:id/bom**
```json
// Request
{
  "bomItems": [
    { "partID": 42, "quantity": 3 },
    { "partID": 15, "quantity": 1 }
  ]
}
// Response 200: updated BOM (same shape as GET)
// Response 400: { "error": "Circular BOM reference detected: Kit A → Kit B → Kit A" }
// Response 400: { "error": "Part is not a Kit or Assembly" }
```

### Kitting Endpoints (new)

**POST /api/inventory/trace/kit/:barcodeId**
```json
// Request
{ "targetBarcodeId": 456, "quantity": 5 }
// Response 200
{
  "sourceTrace": { "id": 1, "quantity": 15, "barcodeID": 123, ... },
  "targetTrace": { "id": 2, "quantity": 5, "barcodeID": 456, ... },
  "sourceHistory": { "id": 100, "actionID": 8, ... },
  "targetHistory": { "id": 101, "actionID": 8, ... }
}
// Response 400: { "error": "Target trace is not a Kit or Assembly" }
// Response 400: { "error": "Insufficient quantity" }
```

**POST /api/inventory/trace/unkit/:barcodeId**
```json
// Request
{ "targetBarcodeId": 123, "quantity": 5 }
// Response 200
{
  "kitTrace": { ... },
  "sourceTrace": { ... },
  "kitHistory": { ... },
  "sourceHistory": { ... }
}
```

**GET /api/inventory/trace/kit-status/:barcodeId**
```json
// Response 200
{
  "status": "partial",  // or "complete"
  "bomLines": [
    { "partID": 42, "partName": "M3 Bolt", "requiredQty": 3, "kittedQty": 2 },
    { "partID": 15, "partName": "Bracket", "requiredQty": 1, "kittedQty": 1 }
  ]
}
```

## UI Design

### Part Edit Page — BOM Section
- Appears below existing fields when category is Kit or Assembly
- Material card with "Bill of Materials" header
- Table with columns: Part (autocomplete), Quantity (number input), Actions (delete button)
- "Add Item" button below table
- Part autocomplete searches all active parts (any category)
- On save, BOM is sent via `PUT /api/inventory/part/:id/bom`

### Part Edit Page — Trace Table (Kit/Assembly parts)
- Existing trace table gains a "Status" column for kit/assembly parts
- Shows chip: `partial` (orange) or `complete` (green)
- Clicking a kit trace row could expand to show per-BOM-line fulfillment

### Barcode Movement Dialog — Kit Action
- New action type in the action selector dropdown
- Shows: target kit/assembly trace selector (autocomplete filtering to kit/assembly traces), quantity input
- Validation: quantity <= source trace quantity, target must be a kit/assembly trace

### Barcode History
- KITTED entries show: "Kitted to [target barcode]" with quantity
- UNKITTED entries show: "Unkitted from [kit barcode]" with quantity
- Uses existing fromID/toID fields for linking

## Database Changes

### New Table: `BillOfMaterialItems`
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| partID | INTEGER | FK → Parts.id, NOT NULL (the kit/assembly part) |
| componentPartID | INTEGER | FK → Parts.id, NOT NULL (the required part) |
| quantity | FLOAT | NOT NULL |
| activeFlag | BOOLEAN | NOT NULL, default: true |
| createdAt | DATE | NOT NULL |
| updatedAt | DATE | NOT NULL |

**Indexes:** Unique on (partID, componentPartID) where activeFlag=true.

### Seed Data: PartCategories
- `{ name: 'Kit', tagColorHex: '#4CAF50' }` (green)
- `{ name: 'Assembly', tagColorHex: '#2196F3' }` (blue)

### Seed Data: BarcodeHistoryActionTypes
- `{ id: 8, code: 'KITTED', label: 'Kitted to Assembly' }`
- `{ id: 9, code: 'UNKITTED', label: 'Unkitted from Assembly' }`

## Test Scenarios

### Backend (Jest)
- BOM CRUD: create, read, update, delete BOM items
- Cycle detection: direct cycle (A→B→A), indirect cycle (A→B→C→A), self-reference
- Kit trace: quantity deduction, history creation on both sides, zero-quantity deactivation
- Unkit trace: quantity restoration, history creation, reactivation of deactivated trace
- Kit status: partial vs complete calculation
- Validation: non-kit target rejected, insufficient quantity rejected, invalid barcode rejected

### Frontend (Vitest spec)
- BOM editor component: add/remove lines, part autocomplete, save
- Kit status display: badges render for partial/complete
- Barcode movement dialog: kit action available, target filter works

### E2E (Playwright)
- Create a kit part with BOM → create traces → kit source traces → verify status changes to complete
- Unkit and verify quantities restored

## Implementation Notes

### Files to Create
- `backend/models/inventory/billOfMaterialItem.js` — Sequelize model
- `backend/api/inventory/bom/controller.js` — BOM CRUD + cycle detection
- `backend/api/inventory/bom/routes.js` — Express routes
- `backend/migrations/20260330000000-add-kitting-support.js` — table + seeds

### Files to Modify
- `backend/api/inventory/trace/controller.js` — add kit/unkit handlers
- `backend/api/inventory/trace/routes.js` — add kit/unkit/kit-status routes
- `backend/models/index.js` or model associations — add BillOfMaterialItem associations
- `frontend/src/app/components/inventory/part-edit-page/part-edit-page.ts` — BOM section, isKit() check
- `frontend/src/app/components/inventory/part-edit-page/part-edit-page.html` — BOM template
- `frontend/src/app/services/inventory.service.ts` — BOM and kitting API methods
- `frontend/src/app/components/inventory/barcode-movement-dialog/barcode-movement-dialog.ts` — kit action
- `frontend/src/app/components/inventory/barcode-movement-dialog/barcode-movement-dialog.html` — kit form
- `frontend/src/app/components/inventory/barcode-history/barcode-history.ts` — KITTED/UNKITTED labels/icons

### Existing Patterns to Follow
- Trace operations (split, merge, adjust) in `backend/api/inventory/trace/controller.js` — same transaction + history recording pattern
- Category-specific UI sections in `part-edit-page.ts` — `isConnector()` / `isKit()` pattern
- BarcodeHistory action type usage — fromID/toID for linking source and target
- Barcode movement dialog action types — extend existing enum/switch
