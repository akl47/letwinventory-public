# Feature: Order Management

## Context
Order management handles the full procurement lifecycle from order creation through receiving. Orders track vendor, status progression, and line items with pricing. The system supports bulk CSV import with dry-run preview for large vendor orders. Receiving order items creates inventory traces or equipment with barcode history. Order status auto-recalculates when all items are fully received.

## Requirements

### Requirements Coverage

| DB ID | Description | Status |
|-------|-------------|--------|
| 38 | Order CRUD with status workflow | Met |
| 39 | Order statuses with workflow progression | Met |
| 40 | Order line items with quantity and price | Met |
| 41 | Auto-recalculate status on receiving | Met |
| 42 | Bulk CSV import with dry-run preview | Met |
| 43 | Receive items into inventory | Met |
| 44 | Orders list search/filter/sort/URL sync | Met |

### Order Status Workflow (Req #39)
- Status progression: Draft → Pending → Placed → Shipped → Received
- `nextStatusID` self-reference on OrderStatus table
- Status auto-advances when all items fully received (Req #41)

### Bulk CSV Import (Req #42)
- `POST /api/inventory/order/bulk-import` with `{csvContent, vendor}`
- `?dryRun=true` returns preview without creating records
- CSV columns: name, vendor, qty, price
- Matches existing parts by name, creates new parts for unmatched names
- Returns: partsToCreate, partsExisting, partsSkipped, orderItems, orderTotal

### Receiving (Req #43)
- Creates Trace (for parts) or Equipment (for equipment items)
- Records RECEIVED barcode history action
- Assigns location via barcode scan
- Supports full or partial receipt

## API Contracts

### Orders — `/api/inventory/order/*`
| Method | Path | Auth | Permission | Description |
|--------|------|------|------------|-------------|
| GET | `/api/inventory/order` | Yes | orders.read | List orders with status filter |
| GET | `/api/inventory/order/statuses` | Yes | orders.read | List order statuses |
| GET | `/api/inventory/order/linetypes` | Yes | orders.read | List line types |
| GET | `/api/inventory/order/:id` | Yes | orders.read | Get order with items |
| POST | `/api/inventory/order` | Yes | orders.write | Create order |
| PUT | `/api/inventory/order/:id` | Yes | orders.write | Update order |
| DELETE | `/api/inventory/order/:id` | Yes | orders.delete | Soft delete order |
| POST | `/api/inventory/order/bulk-import` | Yes | orders.write | Bulk CSV import |

### Order Items — `/api/inventory/order-item/*`
| Method | Path | Auth | Permission | Description |
|--------|------|------|------------|-------------|
| GET | `/api/inventory/order-item/order/:orderId` | Yes | orders.read | List items by order |
| POST | `/api/inventory/order-item` | Yes | orders.write | Create line item |
| PUT | `/api/inventory/order-item/:id` | Yes | orders.write | Update line item (partial allowed) |
| DELETE | `/api/inventory/order-item/:id` | Yes | orders.delete | Delete line item |

## UI Design

### Orders List (`/orders`)
- **Columns:** description, vendor, status (color chip), placed date, item count, total price, actions
- **Status filter:** multi-select toggle chips
- **Search:** across order fields
- **Sorting:** default placedDate descending
- **Pagination:** configurable page size
- **URL sync:** search, inactive, statuses (comma-separated IDs), sort, dir, page, pageSize
- **Middle-click:** opens order detail in new tab
- **Status chips:** styled with `tagColor` and contrast text

### Order Detail (`/orders/:id`)
- **Header:** order description, vendor, tracking, link, notes
- **Status navigation:** advance to next status button
- **Line items table:** part, quantity, price, received quantity, line total
- **Receive mode:** per-line-item receiving with location assignment
- **Edit:** inline line item editing
- **Date formatting:** placed date, received date

### Bulk Upload (`/orders/bulk-upload`)
- **CSV paste/upload area**
- **Dry-run preview:** shows parts to create, existing parts, skipped parts
- **Inline row editing:** quantity, price with save/cancel
- **Remove items** from import
- **Execute:** creates order with all items

### Receive Line Item Dialog
- **Part receiving:** full/partial receipt type, quantity input, location barcode scan, barcode size selection
- **Equipment receiving:** pre-fills name from part, quantity 1, serial number input
- **Validation:** requires location and valid quantity

## Database Changes

### Orders Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| description | TEXT | nullable |
| vendor | STRING | nullable |
| trackingNumber | STRING | nullable |
| link | STRING | nullable |
| notes | TEXT | nullable |
| placedDate | DATE | nullable |
| receivedDate | DATE | nullable |
| orderStatusID | INTEGER | FK → OrderStatuses, default 1 |
| activeFlag | BOOLEAN | NOT NULL, default true |

### OrderItems Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| orderID | INTEGER | FK → Orders, NOT NULL |
| partID | INTEGER | FK → Parts, nullable |
| orderLineTypeID | INTEGER | FK → OrderLineTypes, default 1 |
| lineNumber | INTEGER | default 1 |
| quantity | INTEGER | default 1 |
| price | DECIMAL(10,5) | default 0 |
| receivedQuantity | INTEGER | default 0 |
| activeFlag | BOOLEAN | NOT NULL, default true |

### OrderStatuses Table
Seeded: Draft, Pending, Placed, Shipped, Received (with nextStatusID chain and tagColor)

### OrderLineTypes Table
Seeded: Part, Equipment, Service, Other

### Relevant Migrations
- `20260112000000-initial.js` — Orders, OrderItems, OrderStatuses, OrderLineTypes

## Test Scenarios

### Backend (Jest)
- `backend/tests/__tests__/inventory/order.test.js` — list, statuses, line types, get by ID, create, update, delete, bulk import (dry run, execute, part matching)
- `backend/tests/__tests__/inventory/orderItem.test.js` — list by order, create, update, delete

### Frontend (Karma)
- `frontend/src/app/components/orders/orders-list-view/orders-list-view.spec.ts` — status loading, filtering, search, pagination, sorting, status chips, pricing
- `frontend/src/app/components/orders/order-view/order-view.spec.ts` — status navigation, receive mode, line items, pricing, dates
- `frontend/src/app/components/orders/order-edit-dialog/order-edit-dialog.spec.ts` — create/edit modes
- `frontend/src/app/components/orders/order-item-dialog/order-item-dialog.spec.ts` — part selection, line total
- `frontend/src/app/components/orders/bulk-upload/bulk-upload.spec.ts` — computed totals, dry-run, inline editing
- `frontend/src/app/components/orders/receive-line-item-dialog/receive-line-item-dialog.spec.ts` — part/equipment receiving, validation

### E2E (Playwright)
- `frontend/e2e/orders.spec.ts` — order workflows

## Implementation Notes

### Key Files
- `backend/api/inventory/order/controller.js` — order CRUD, bulk import
- `backend/api/inventory/order-item/controller.js` — line item CRUD with status recalculation
- `backend/models/inventory/order.js` — Order model
- `backend/models/inventory/orderItem.js` — OrderItem model
- `backend/models/inventory/orderStatus.js` — OrderStatus with nextStatusID
- `frontend/src/app/components/orders/` — all order UI components
- `frontend/src/app/services/inventory.service.ts` — order API calls

### Patterns Followed
- Status progression via `nextStatusID` self-reference
- `recalculateOrderStatus()` called on orderItem update
- Body validator with POST/PUT distinction (PUT allows partial updates)
- Bulk import dry-run pattern for preview before commit
- `tagColorHex` stored WITHOUT `#` prefix

### Edge Cases
- Bulk import matches parts by name (case-sensitive)
- Bulk import creates new parts with default category for unmatched names
- Status auto-advance only when ALL items have `receivedQuantity >= quantity`
- Order status progression not enforced at API level (can skip statuses) — noted as partial
