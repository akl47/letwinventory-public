# Feature: Parts Management

## Context
The parts catalog is the foundation of inventory — every trace, order item, and harness element references a part. Parts support categories with color-coded tags, image uploads with hover preview, manufacturer traceability for vendor parts, electrical subtypes (connectors, cables, components), minimum stock quantity thresholds, and file management for associated images. The parts table provides search, filtering, sorting, pagination, and URL query parameter persistence.

## Requirements

### Requirements Coverage

| DB ID | Description | Status |
|-------|-------------|--------|
| 31 | Part CRUD with categories | Met |
| 32 | Manufacturer required for vendor parts | Met |
| 33 | Part categories with color tags | Met |
| 34 | Part image upload and hover preview | Met |
| 35 | Body validator middleware | Met |
| 36 | Parts table search/sort/pagination/URL sync | Met |
| 37 | Stay on part after save | Met |
| 80 | File upload/storage/retrieval | Met |
| 139 | Configuration management (parts) | Met |
| 172 | Minimum stock quantity | Met |
| 173 | Low stock filter toggle | Met |

### Part CRUD (Req #31)
- Full CRUD operations for parts with categories, vendor info, manufacturer details
- Unique part name constraint (STRING 32)
- Body validator middleware enforces field types and required fields

### Manufacturer Traceability (Req #32)
- Non-internal (vendor) parts require `manufacturer` and `manufacturerPN`
- Controller validates `!internalPart → manufacturer && manufacturerPN required`
- Returns 400 if missing

### File Management (Req #80)
- UploadedFile model: filename, mimeType, fileSize, data (TEXT, base64), uploadedBy
- Part has `imageFileID` FK to UploadedFile
- Part image upload via `/api/inventory/part/upload` endpoint

## API Contracts

### Parts — `/api/inventory/part/*`
| Method | Path | Auth | Permission | Description |
|--------|------|------|------------|-------------|
| GET | `/api/inventory/part` | Yes | parts.read | List all active parts |
| GET | `/api/inventory/part/categories` | Yes | parts.read | List part categories |
| GET | `/api/inventory/part/:id` | Yes | parts.read | Get part by ID with associations |
| POST | `/api/inventory/part` | Yes | parts.write | Create part (body validated) |
| PUT | `/api/inventory/part/:id` | Yes | parts.write | Update part (body validated) |
| DELETE | `/api/inventory/part/:id` | Yes | parts.delete | Soft delete part |
| POST | `/api/inventory/part/upload` | Yes | parts.write | Upload part image |

### Files — `/api/files/*`
| Method | Path | Auth | Permission | Description |
|--------|------|------|------------|-------------|
| GET | `/api/files` | Yes | parts.read | List uploaded files |
| GET | `/api/files/:id` | Yes | parts.read | Get file metadata |
| GET | `/api/files/:id/data` | Yes | parts.read | Get file data (base64) |

## UI Design

### Parts Table (`/parts`)
- **Columns:** image icon, name, description, vendor, SKU, category (color chip), type (internal/vendor), quantity, actions
- **Search:** across name, description, vendor, SKU
- **Filters:** category (multi-select), type (internal/vendor), "Show Inactive" toggle, "Low Stock Only" toggle
- **Sorting:** sortable columns including createdAt
- **Pagination:** configurable page size
- **URL sync:** search, inactive, sort, dir, page, pageSize
- **Image hover:** fixed-position tooltip with image preview on image icon column
- **Middle-click:** opens part edit page in new tab

### Part Edit Page (`/parts/new`, `/parts/:id/edit`)
- **Create mode:** form with all fields, category dropdown, UoM dropdown
- **Edit mode:** read-only view first with Edit button, then editable form
- **Fields:** name (required), description, internal part toggle, vendor, SKU, link, minimum order quantity, category (required), serial number required, lot number required, default UoM, manufacturer, manufacturer PN, minimum stock quantity, image upload
- **Pin groups:** for electrical connector/cable/component parts
- **Save behavior:** stays on current part after save (does not navigate away)
- **Delete:** soft delete with confirmation

## Database Changes

### Parts Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| name | STRING(32) | NOT NULL, UNIQUE |
| description | STRING(62) | nullable |
| internalPart | BOOLEAN | NOT NULL |
| vendor | STRING | NOT NULL |
| sku | STRING | nullable |
| link | STRING | nullable |
| minimumOrderQuantity | INTEGER | NOT NULL |
| partCategoryID | INTEGER | FK → PartCategories, NOT NULL |
| serialNumberRequired | BOOLEAN | NOT NULL, default false |
| lotNumberRequired | BOOLEAN | NOT NULL, default false |
| defaultUnitOfMeasureID | INTEGER | FK → UnitOfMeasure, default 1 |
| manufacturer | STRING | nullable |
| manufacturerPN | STRING | nullable |
| imageFileID | INTEGER | FK → UploadedFiles, nullable |
| minimumStockQuantity | INTEGER | nullable, default null |
| activeFlag | BOOLEAN | NOT NULL, default true |
| createdAt | DATE | NOT NULL |
| updatedAt | DATE | NOT NULL |

### PartCategories Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| name | STRING | NOT NULL, UNIQUE |
| tagColorHex | STRING(7) | default #808080 |
| activeFlag | BOOLEAN | NOT NULL, default true |

### UploadedFiles Table
| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK, auto-increment |
| filename | STRING(255) | NOT NULL |
| mimeType | STRING(100) | NOT NULL |
| fileSize | INTEGER | NOT NULL |
| data | TEXT | NOT NULL (base64) |
| uploadedBy | INTEGER | FK → Users |
| activeFlag | BOOLEAN | NOT NULL, default true |

### Relevant Migrations
- `20260112000000-initial.js` — Parts, PartCategories
- `20260112000002-create-uploaded-files.js` — UploadedFiles
- `20260306000000-add-minimum-stock-quantity.js` — minimumStockQuantity column

## Test Scenarios

### Backend (Jest)
- `backend/tests/__tests__/inventory/part.test.js` — list, categories, get by ID, create, update, delete, manufacturer validation
- `backend/tests/__tests__/files.test.js` — upload, list, get by ID, get data, update, delete

### Frontend (Karma)
- `frontend/src/app/components/inventory/parts-table-view/parts-table-view.spec.ts` — data loading, filtering, pagination, sorting, navigation, color utilities, middle-click
- `frontend/src/app/components/inventory/part-edit-page/part-edit-page.spec.ts` — form validation, category detection, pin groups, image management
- `frontend/src/app/components/inventory/part-edit-dialog/part-edit-dialog.spec.ts` — create/edit modes, validation, image

### E2E (Playwright)
- `frontend/e2e/inventory.spec.ts` — inventory-related flows including parts

## Implementation Notes

### Key Files
- `backend/api/inventory/part/controller.js` — part CRUD, categories, upload
- `backend/api/inventory/part/routes.js` — route definitions with bodyValidator.part
- `backend/models/inventory/part.js` — Part model with associations
- `backend/models/inventory/partCategory.js` — PartCategory model
- `backend/models/common/uploadedFile.js` — UploadedFile model
- `frontend/src/app/components/inventory/parts-table-view/parts-table-view.ts` — parts list
- `frontend/src/app/components/inventory/part-edit-page/part-edit-page.ts` — part create/edit
- `frontend/src/app/services/inventory.service.ts` — API calls

### Patterns Followed
- `bodyValidator.part` middleware for request validation
- `tagColorHex` stored WITHOUT `#` prefix in database
- Part associations: hasMany Trace, belongsTo PartCategory, belongsTo UnitOfMeasure, belongsTo UploadedFile
- Electrical subtypes: hasOne ElectricalConnector, hasOne Cable, hasOne ElectricalComponent
- `minimumStockQuantity` is nullable (null = no minimum set)

### Edge Cases
- Part name is unique and limited to 32 characters
- `by-part` endpoints (connector, cable, component) include nested `Part.imageFile`
- Frontend transform functions fall back to `part.imageFile.data` when specific image file is null
- File upload moved from `/api/files` to `/api/inventory/part/upload`
