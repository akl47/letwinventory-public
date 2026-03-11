# Feature: Inventory Management

## Context
Inventory is organized in a hierarchical structure of Locations, Boxes, Traces (parts with quantity), and Equipment, each identified by a unique barcode. The tree view provides expand/collapse navigation with search, deep linking, and equipment filtering. Traces support split, merge, and partial deletion operations. Equipment tracks individual items with serial numbers and commission dates. Units of measure are maintained as reference data.

## Requirements

### Requirements Coverage

| DB ID | Description | Status |
|-------|-------------|--------|
| 11 | Hierarchical inventory structure | Met |
| 12 | Tree view with expand/collapse | Met |
| 13 | Location CRUD | Met |
| 14 | Box CRUD | Met |
| 15 | Trace CRUD with quantity tracking | Met |
| 16 | Split trace | Met |
| 17 | Merge traces | Met |
| 18 | Partial/full trace deletion | Met |
| 19 | Equipment CRUD | Met |
| 20 | Units of Measure reference data | Met |
| 170 | Unique barcode identification | Met |
| 171 | Complete audit trail | Met |

### Hierarchy (Req #11)
- Locations contain Boxes, Traces, and Equipment
- Each entity has a `barcodeID` linking to a unique Barcode record
- Parent-child relationships via `parentBarcodeID` on Barcode

### Trace Operations (Req #15, #16, #17, #18)
- **Split:** `POST /trace/split/:barcodeId` — creates new barcode and trace with split quantity
- **Merge:** `POST /trace/merge/:barcodeId` — combines two traces of same part, deactivates source
- **Delete:** `DELETE /trace/barcode/:barcodeId` — partial (reduce quantity) or full (deactivate)
- All operations recorded in barcode history

## API Contracts

### Locations — `/api/inventory/location/*`
| Method | Path | Auth | Permission | Description |
|--------|------|------|------------|-------------|
| GET | `/api/inventory/location` | Yes | inventory.read | List locations |
| GET | `/api/inventory/location/higherarchy` | Yes | inventory.read | Get tree data |
| GET | `/api/inventory/location/:id` | Yes | inventory.read | Get location by ID |
| POST | `/api/inventory/location` | Yes | inventory.write | Create location (auto-generates LOC barcode) |
| PUT | `/api/inventory/location/:id` | Yes | inventory.write | Update location |

### Boxes — `/api/inventory/box/*`
| Method | Path | Auth | Permission | Description |
|--------|------|------|------------|-------------|
| GET | `/api/inventory/box/:id` | Yes | inventory.read | Get box by ID |
| POST | `/api/inventory/box` | Yes | inventory.write | Create box (auto-generates BOX barcode) |
| PUT | `/api/inventory/box/:id` | Yes | inventory.write | Update box |

### Traces — `/api/inventory/trace/*`
| Method | Path | Auth | Permission | Description |
|--------|------|------|------------|-------------|
| GET | `/api/inventory/trace/part/:partId` | Yes | inventory.read | Get traces by part |
| GET | `/api/inventory/trace/:id` | Yes | inventory.read | Get trace by ID |
| POST | `/api/inventory/trace` | Yes | inventory.write | Create trace (auto-generates AKL barcode) |
| PUT | `/api/inventory/trace/:id` | Yes | inventory.write | Update trace |
| DELETE | `/api/inventory/trace/barcode/:barcodeId` | Yes | inventory.delete | Delete trace (partial or full) |
| POST | `/api/inventory/trace/split/:barcodeId` | Yes | inventory.write | Split trace `{splitQuantity}` |
| POST | `/api/inventory/trace/merge/:barcodeId` | Yes | inventory.write | Merge trace `{mergeBarcodeId}` |

### Equipment — `/api/inventory/equipment/*`
| Method | Path | Auth | Permission | Description |
|--------|------|------|------------|-------------|
| GET | `/api/inventory/equipment` | Yes | equipment.read | List equipment |
| GET | `/api/inventory/equipment/:id` | Yes | equipment.read | Get equipment by ID |
| POST | `/api/inventory/equipment` | Yes | equipment.write | Create equipment |
| POST | `/api/inventory/equipment/receive` | Yes | equipment.write | Receive from order |
| PUT | `/api/inventory/equipment/:id` | Yes | equipment.write | Update equipment |
| DELETE | `/api/inventory/equipment/:id` | Yes | equipment.delete | Delete equipment |

### Unit of Measure — `/api/inventory/unitofmeasure/*`
| Method | Path | Auth | Permission | Description |
|--------|------|------|------------|-------------|
| GET | `/api/inventory/unitofmeasure` | Yes | inventory.read | List all UoMs |

## UI Design

### Inventory Tree View (`/inventory`)
- **Recursive tree** with `InventoryHierarchyItem` nodes
- **Expand/collapse** toggle for each node with children
- **Search:** filters by name, barcode, part number
- **Equipment toggle:** show/hide equipment in tree
- **Deep linking:** `?barcode=<id>` auto-expands path to item
- **Actions per node:** barcode dialog, edit dialog, add child

### Equipment Table (`/equipment`)
- **Columns:** name, description, serial number, commission date, part, location, actions
- **Search, pagination, sorting**
- **Create/edit:** via dialog with validation
- **Delete:** with confirmation

## Database Changes

### Locations Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| name | STRING(16) | NOT NULL |
| description | STRING(62) | nullable |
| barcodeID | INTEGER | FK → Barcodes, UNIQUE |
| activeFlag | BOOLEAN | NOT NULL, default true |

### Boxes Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| name | STRING(16) | NOT NULL |
| description | STRING(62) | nullable |
| barcodeID | INTEGER | FK → Barcodes, UNIQUE |
| activeFlag | BOOLEAN | NOT NULL, default true |

### Traces Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| partID | INTEGER | FK → Parts, NOT NULL |
| quantity | FLOAT | NOT NULL |
| unitOfMeasureID | INTEGER | FK → UnitOfMeasure, nullable |
| serialNumber | STRING | nullable |
| lotNumber | STRING | nullable |
| barcodeID | INTEGER | FK → Barcodes, UNIQUE |
| activeFlag | BOOLEAN | NOT NULL, default true |

### Equipment Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| name | STRING | NOT NULL |
| description | STRING | nullable |
| serialNumber | STRING | nullable |
| commissionDate | DATEONLY | nullable |
| barcodeID | INTEGER | FK → Barcodes, UNIQUE |
| partID | INTEGER | FK → Parts, nullable |
| orderItemID | INTEGER | FK → OrderItems, nullable |
| activeFlag | BOOLEAN | NOT NULL, default true |

### UnitOfMeasure Table
Seeded: ea (Each), gal (Gallon), g (Gram), kg (Kilogram)

### Relevant Migrations
- `20260112000000-initial.js` — Locations, Boxes, Traces, Equipment, UnitOfMeasure

## Test Scenarios

### Backend (Jest)
- `backend/tests/__tests__/inventory/location.test.js` — get by ID, update
- `backend/tests/__tests__/inventory/box.test.js` — get by ID, update
- `backend/tests/__tests__/inventory/trace.test.js` — get by part, get by ID, update, delete
- `backend/tests/__tests__/inventory/equipment.test.js` — list, get by ID, update, delete
- `backend/tests/__tests__/inventory/unitOfMeasure.test.js` — list seeded values

### Frontend (Karma)
- `frontend/src/app/components/inventory/inventory-higherarchy-view/inventory-higherarchy-view.spec.ts` — tree building, search, equipment filter, barcode selection
- `frontend/src/app/components/inventory/inventory-higherarchy-item/inventory-higherarchy-item.spec.ts` — toggle expand, dialog integrations
- `frontend/src/app/components/inventory/inventory-item-dialog/inventory-item-dialog.spec.ts` — create/edit modes, validators
- `frontend/src/app/components/inventory/equipment-table-view/equipment-table-view.spec.ts` — loading, filtering, pagination, sorting
- `frontend/src/app/components/inventory/equipment-edit-dialog/equipment-edit-dialog.spec.ts` — create/edit, validation, delete

### E2E (Playwright)
- `frontend/e2e/inventory.spec.ts` — inventory tree and operations

## Implementation Notes

### Key Files
- `backend/api/inventory/location/controller.js` — location CRUD + hierarchy
- `backend/api/inventory/box/controller.js` — box CRUD
- `backend/api/inventory/trace/controller.js` — trace CRUD + split/merge
- `backend/api/inventory/equipment/controller.js` — equipment CRUD + receive
- `backend/models/inventory/` — Location, Box, Trace, Equipment models
- `frontend/src/app/components/inventory/inventory-higherarchy-view/` — tree view
- `frontend/src/app/components/inventory/equipment-table-view/` — equipment table

### Patterns Followed
- Auto-generated barcodes with category-specific prefixes
- Hierarchy via `parentBarcodeID` on Barcode model
- All mutations create barcode history entries
- Body validator on POST/PUT routes
- Soft deletion across all inventory entities

### Edge Cases
- Hierarchy endpoint uses PostgreSQL-specific raw SQL (not testable in SQLite)
- Split/merge use PostgreSQL barcode generation (not testable in SQLite)
- Merge validates same `partID` on both traces
- Partial delete reduces quantity; full delete deactivates trace and barcode
- Equipment receive creates from order item with RECEIVED barcode history
