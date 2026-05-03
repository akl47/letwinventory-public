# Tool Catalog

## Context

The system already supports **Parts** as the inventory primitive. There is no first-class concept of a workshop *tool* — i.e. a Part with workshop-specific properties such as cutting geometry, flute count, or hand-tool / cutter classification. (The existing `/tools/outline` route is an unrelated SVG/DXF generator and shares no data with this feature; both pages just live under the same `Tools` nav group.)

This feature introduces a `Tools` table that links 1:1 to a `Part` and stores tool-specific metadata (category, cutting dimensions, material, coating). Hand tools and machine tools are unified by the same row shape; machine-tool fields are nullable so a hand tool simply leaves them empty.

Tool data is captured on the existing **Part edit page** under a new "Tool Properties" section. A separate **Tool Catalog** browse page is added at `/tools/catalog`. All length values are stored in **millimetres** with a minimum of **0.001 mm** on numeric inputs.

Tool categories are seeded from a 26-entry list (Hand tool plus 25 cutter types) and are extensible through an admin-only endpoint gated behind a new `admin.manage_tool_categories` permission.

## Requirements

### REQ T1 — Tools table linked 1:1 to Part

**Description.** The system shall persist a `Tools` table where each row links uniquely to a `Parts.id` via `partID UNIQUE NOT NULL FK`. A Part can have at most one Tool record (active or inactive).

**Rationale.** Co-locates tool metadata with the existing inventory primitive without duplicating Part fields. Soft-delete semantics rely on the row persisting even when deactivated, so the unique constraint is on partID alone (not partID + activeFlag).

**Verification.** Backend test: creating two Tool rows for the same partID fails with a humanized 409 message.

**Validation.** From the Part edit page, selecting a Tool Category and saving creates one `Tools` row referencing the Part. Subsequent saves update the same row.

### REQ T2 — Tool categories lookup table, seeded with 26 entries

**Description.** The system shall persist a `ToolCategories` table with `id`, `name UNIQUE`, `description`, and `activeFlag`. Each Tool references exactly one ToolCategory via `toolCategoryID NOT NULL FK`. The migration seeds these 26 categories (preserving exact spelling):

`Hand tool`, `Square end mill`, `Ball end mill`, `Bull nose end mill`, `Chamfer mill`, `Tapered end mill`, `Roughing end mill`, `Lollipop mill`, `Dovetail cutter`, `T-slot cutter`, `Woodruff cutter`, `Thread mill`, `V-bit`, `Face mill`, `Fly cutter`, `Drill Bit`, `Spot drill`, `Center drill`, `Step drill`, `Core drill`, `Counterbore`, `Countersink`, `Reamer`, `Boring bar / boring head`, `Tap`, `Slitting saw`.

**Rationale.** Covers the workshop's current taxonomy; new entries can be added later through the admin endpoint without code changes.

**Verification.** Backend test: migration seeds exactly 26 categories with the expected names; foreign-key violation on Tool insert with a non-existent categoryID returns a humanized 400.

**Validation.** Tool Category dropdown on the Part edit page lists all 26 seeded names.

### REQ T3 — Tool dimension fields (all in mm, decimals to 0.001)

**Description.** The Tools table persists these nullable fields:
- `diameter` DECIMAL(10,3) — cutting diameter (mm)
- `overallLength` DECIMAL(10,3) — total length (mm)
- `fluteLength` DECIMAL(10,3) — cutting flute length (mm)
- `shankDiameter` DECIMAL(10,3) — shank diameter (mm)
- `numberOfFlutes` INTEGER
- `tipAngle` DECIMAL(5,2) — degrees
- `toolMaterial` STRING(64) — e.g. HSS, Carbide
- `coating` STRING(64) — e.g. TiN, AlTiN, uncoated
- `notes` TEXT

All fields are nullable so a hand tool can leave every machine-tool field empty. Numeric inputs on the frontend enforce `min="0.001"` and `step="any"`.

**Rationale.** Captures the geometry that distinguishes drill bits, end mills, taps, etc., while letting non-cutting tools share the same row shape.

**Verification.** Backend test: creating a Tool with only `partID` and `toolCategoryID` succeeds; creating one with all numeric fields populated round-trips correctly. Frontend test: `min="0.001"` is set on every numeric input.

**Validation.** Edit a drill bit on the Part edit page → enter diameter, flute length, overall length, point angle → save → reopen → values reload.

### REQ T4 — Soft-delete preserves Tool field values

**Description.** Setting Tool Category to `(None)` on the Part edit page and saving sets `activeFlag = false` on the Tool record but **preserves every other field value** (diameter, flute length, notes, etc.). Re-selecting any Tool Category later reactivates the same row (`activeFlag = true`) with all preserved values intact. Hard-delete is not exposed through the UI; only the API DELETE route performs activeFlag=false (same effect, no data loss).

**Rationale.** Users frequently toggle parts between "tool" and "non-tool" classifications. Preserving the data avoids re-entering dimension specs after an accidental category clear.

**Verification.** Backend test: PUT with `activeFlag=false` then PUT with `activeFlag=true` round-trips with all dimension values unchanged. Frontend test: clearing the category in the form and saving sends a PUT that toggles `activeFlag` without zeroing dimensions.

**Validation.** Set a part as End mill with diameter=6 mm, flute length=20 mm, save. Change Category to (None), save. Reopen the page — Category shows (None) but the form still shows 6 / 20 in the (now-hidden) fields. Pick End mill again, save — the row reactivates with the same values.

### REQ T5 — Tool fields on Part edit page

**Description.** The Part edit page shall render a "Tool Properties" expansion panel containing the Tool Category dropdown and dimension fields. The panel:
- Is closed by default if the part has no Tool record (or only an inactive one with no category previously assigned), open if it has an active Tool record.
- Shows the dimension fields only when a category is selected; (None) hides them.
- Loads existing field values via `GET /api/tools/tool/by-part/:partID` regardless of `activeFlag` so soft-deleted data round-trips on reopen.
- Save behavior is part of the existing form save flow:
  - If no Tool record exists and Category is set → POST a new Tool.
  - If a Tool record exists → PUT the Tool with the form values; `activeFlag = (category !== null)`.
  - On (None), the dimension form values are sent unchanged; only `toolCategoryID = null` triggers `activeFlag = false`. *(Edit: see REQ T4 — `toolCategoryID` is non-nullable in the table; the implementation sets `activeFlag = false` and leaves `toolCategoryID` at its last value so the next reactivation has a sensible default.)*
- The whole section is read-only when the page is in view mode; editing requires `parts.write`.

**Rationale.** User explicitly chose to keep Tool data on the Part edit page rather than introduce a separate Tool edit page. Hiding fields when no category is chosen reduces visual noise.

**Verification.** Karma spec for `part-edit-page` covering: section hidden vs shown, save calls correct service method, reactivation flow, `parts.write` gating.

**Validation.** Edit a part → expand Tool Properties → pick `End mill` → fill fields → save → reload → fields persist and panel is open by default.

### REQ T6 — Tool Catalog browse page

**Description.** A new page at `/tools/catalog` lists all Parts with an active Tool record. Columns: Part Number, Description, Tool Category (badge), Diameter (mm), # Flutes, Material. The page provides a category filter dropdown and a search field that matches against Part name/description. Rows link to the Part edit page (`/parts/:partID/edit`). Read access requires `tools.read`.

**Rationale.** Surfacing tools in their own filterable view is the primary use of the catalog — finding the right cutter without scrolling the whole parts list.

**Verification.** Karma spec for `tool-catalog-view`: filter by category, search by name, empty state, row click navigation.

**Validation.** Create three tools across two categories. Open `/tools/catalog`. Filter by `End mill` → only end mills appear. Type a name fragment → only matching rows appear.

### REQ T7 — Tool Catalog nav entry

**Description.** The Tools nav-rail group shall include a "Tool Catalog" entry (icon `build`) routing to `/tools/catalog`, sibling to the existing Tool Outline entry. Visibility gated on `tools.read`.

**Rationale.** Consistent with how the Tools nav group surfaces the unrelated Tool Outline page.

**Verification.** `nav.component.spec.ts` updated to assert the Tool Catalog entry exists and routes correctly.

**Validation.** Click Tools in the rail → flyout shows Tool Outline and Tool Catalog → click Tool Catalog → navigates to `/tools/catalog`.

### REQ T8 — Permissions: Tool CRUD uses parts.write

**Description.** Tool create/update/delete endpoints (`POST /api/tools/tool`, `PUT /api/tools/tool/:id`, `DELETE /api/tools/tool/:id`) require `parts.write` and `parts.delete` respectively. Read endpoints (`GET /api/tools/tool`, `GET /api/tools/tool/:id`, `GET /api/tools/tool/by-part/:partID`) require `tools.read`. ToolCategory read (`GET /api/tools/tool-category`) also requires `tools.read`.

**Rationale.** User directed that Tool record editing is scoped to part-edit permission so a single permission grant covers both Part and Tool fields on the same form.

**Verification.** Backend tests cover 200/403 across each endpoint with and without each permission.

**Validation.** Strip `parts.write` from a test user → editing tool fields on the Part edit page is blocked; viewing the Tool Catalog still works.

### REQ T9 — New permission `admin.manage_tool_categories`

**Description.** A new permission with resource `admin` and action `manage_tool_categories` is seeded by the migration and bound to the Admin group. ToolCategory create / update / delete endpoints require this permission.

**Rationale.** Separates managing the taxonomy (rare, admin-only operation) from day-to-day tool editing.

**Verification.** Backend tests: a user with `parts.write` but without `admin.manage_tool_categories` cannot create a ToolCategory; a user with the new permission can.

**Validation.** From the admin UI (existing or future), a non-admin user cannot add a category; an admin can.

## API Contracts

All routes are auto-discovered from `backend/api/tools/tool/` and `backend/api/tools/tool-category/`.

### `GET /api/tools/tool`
- Auth: `tools.read`
- Query: `categoryID` (optional), `q` (optional, matches Part name/description), `includeInactive` (default false)
- Response: `200 [{ id, partID, part, toolCategoryID, toolCategory, diameter, overallLength, fluteLength, shankDiameter, numberOfFlutes, tipAngle, toolMaterial, coating, notes, activeFlag }]`

### `GET /api/tools/tool/:id`
- Auth: `tools.read`
- Response: `200 { ... }` or `404`. Includes inactive rows.

### `GET /api/tools/tool/by-part/:partID`
- Auth: `tools.read`
- Response: `200 { ... }` (active OR inactive — used by the Part edit page so soft-deleted values reload), or `404` if no row exists at all.

### `POST /api/tools/tool`
- Auth: `parts.write`
- Body: `{ partID, toolCategoryID, diameter?, overallLength?, fluteLength?, shankDiameter?, numberOfFlutes?, tipAngle?, toolMaterial?, coating?, notes? }`
- Response: `201 { ... }` or `409` on duplicate partID, `400` on invalid FK or missing required field.

### `PUT /api/tools/tool/:id`
- Auth: `parts.write`
- Body: any subset of POST plus `activeFlag` (boolean). `partID` in the body is **ignored** — partID is immutable post-create.
- Response: `200 { ... }`

### `DELETE /api/tools/tool/:id`
- Auth: `parts.delete`
- Response: `200 { message }`. Sets `activeFlag = false`; does not modify dimension fields.

### `GET /api/tools/tool-category`
- Auth: `tools.read`
- Response: `200 [{ id, name, description, activeFlag }]`

### `POST /api/tools/tool-category`
- Auth: `admin.manage_tool_categories`
- Body: `{ name, description? }`
- Response: `201 { ... }` or `409` on duplicate name.

### `PUT /api/tools/tool-category/:id`
- Auth: `admin.manage_tool_categories`
- Body: `{ name?, description? }`
- Response: `200 { ... }`

### `DELETE /api/tools/tool-category/:id`
- Auth: `admin.manage_tool_categories`
- Response: `200 { message }`. Refuses (`400`) if any active Tool references it.

## UI Design

### Part edit page — Tool Properties section

A `<mat-expansion-panel>` titled "Tool Properties" placed after Inventory Settings, before harness-specific sections.

- Closed by default if no active Tool record; open if there is one.
- On expand, fetches `GET /api/tools/tool/by-part/:partID` to load any existing values (active or inactive).
- Inside (in edit mode):
  - Tool Category `<mat-select>` — options: `(None)` + each ToolCategory.
  - Numeric grid (2 columns, all `type="number"` `min="0.001"` `step="any"`):
    - Diameter (mm) | Number of Flutes
    - Overall Length (mm) | Flute Length (mm)
    - Shank Diameter (mm) | Tip Angle (°)
    - Tool Material | Coating
  - Notes (full width, textarea)
- Numeric grid is rendered only when a category is selected; selecting `(None)` collapses the grid.
- Save behavior is part of the existing `save()`:
  - No Tool row exists yet, category set → POST.
  - Row exists, category set → PUT with `activeFlag=true` and current field values.
  - Row exists, category cleared → PUT with `activeFlag=false`, leaving dimension values untouched.
- View mode: read-only summary card with Category, Diameter, Flute Length, Material, etc., or hidden if no active Tool.

### Tool Catalog list view (`/tools/catalog`)

Mirrors the existing Parts table view layout:

- Page header: title "Tool Catalog", search input, category filter `<mat-select>`.
- Table columns: Part #, Description, Tool Category (badge), Diameter, # Flutes, Material.
- Empty state: "No tools yet — add tool properties from a Part's edit page."
- Click row → `/parts/:partID/edit`.
- Loading state: centred spinner.

### Nav

Inside the Tools nav-group flyout (after the existing Tool Outline entry):

- Tool Catalog (`build` icon) — visible if `tools.read`.

## Database Changes

New migration `<date>-create-tools.js`:

```js
queryInterface.createTable('ToolCategories', {
  id: { type: INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: STRING(64), allowNull: false, unique: true },
  description: { type: STRING(255) },
  activeFlag: { type: BOOLEAN, allowNull: false, defaultValue: true },
  createdAt: { type: DATE, allowNull: false, defaultValue: NOW },
  updatedAt: { type: DATE, allowNull: false, defaultValue: NOW },
});

queryInterface.bulkInsert('ToolCategories', [
  { name: 'Hand tool',                description: 'Manual workshop tools' },
  { name: 'Square end mill',          description: '' },
  { name: 'Ball end mill',            description: '' },
  { name: 'Bull nose end mill',       description: '' },
  { name: 'Chamfer mill',             description: '' },
  { name: 'Tapered end mill',         description: '' },
  { name: 'Roughing end mill',        description: '' },
  { name: 'Lollipop mill',            description: '' },
  { name: 'Dovetail cutter',          description: '' },
  { name: 'T-slot cutter',            description: '' },
  { name: 'Woodruff cutter',          description: '' },
  { name: 'Thread mill',              description: '' },
  { name: 'V-bit',                    description: '' },
  { name: 'Face mill',                description: '' },
  { name: 'Fly cutter',               description: '' },
  { name: 'Drill Bit',                description: '' },
  { name: 'Spot drill',               description: '' },
  { name: 'Center drill',             description: '' },
  { name: 'Step drill',               description: '' },
  { name: 'Core drill',               description: '' },
  { name: 'Counterbore',              description: '' },
  { name: 'Countersink',              description: '' },
  { name: 'Reamer',                   description: '' },
  { name: 'Boring bar / boring head', description: '' },
  { name: 'Tap',                      description: '' },
  { name: 'Slitting saw',             description: '' },
]);

queryInterface.createTable('Tools', {
  id: { type: INTEGER, primaryKey: true, autoIncrement: true },
  partID: { type: INTEGER, allowNull: false, unique: true,
            references: { model: 'Parts', key: 'id' } },
  toolCategoryID: { type: INTEGER, allowNull: false,
                    references: { model: 'ToolCategories', key: 'id' } },
  diameter:        { type: DECIMAL(10,3) },
  overallLength:   { type: DECIMAL(10,3) },
  fluteLength:     { type: DECIMAL(10,3) },
  shankDiameter:   { type: DECIMAL(10,3) },
  numberOfFlutes:  { type: INTEGER },
  tipAngle:        { type: DECIMAL(5,2) },
  toolMaterial:    { type: STRING(64) },
  coating:         { type: STRING(64) },
  notes:           { type: TEXT },
  activeFlag: { type: BOOLEAN, allowNull: false, defaultValue: true },
  createdAt: { type: DATE, allowNull: false, defaultValue: NOW },
  updatedAt: { type: DATE, allowNull: false, defaultValue: NOW },
});

// Permission seeding
queryInterface.bulkInsert('Permissions', [
  { resource: 'admin', action: 'manage_tool_categories' }
]);
// Bind to Admin group (lookup admin group id, attach permission)
```

## Test Scenarios

### Backend (Jest)
- `tools/tool.test.js`:
  - CRUD round-trip; partial-fields create.
  - Two creates for the same partID → 409.
  - Invalid `toolCategoryID` → 400 humanized message.
  - List filter by `categoryID` and search `q` work.
  - `GET /by-part/:partID` returns inactive rows; 404 only if no row at all.
  - Soft-delete: PUT `activeFlag=false` preserves dimension fields, then PUT `activeFlag=true` brings them back unchanged.
  - DELETE soft-deletes; subsequent GET still finds via `/by-part`.
  - PUT body with `partID` is ignored.
- `tools/tool-category.test.js`:
  - Migration seeds 26 categories.
  - Cannot delete a category referenced by an active Tool (400).
  - `admin.manage_tool_categories` enforcement on POST/PUT/DELETE; `tools.read` enforcement on GET.

### Frontend (Vitest)
- `part-edit-page.spec.ts`:
  - Tool Properties hidden when category is `(None)`, shown otherwise.
  - Category change calls correct service method (POST first time, PUT thereafter).
  - Selecting `(None)` while a row exists sends PUT with `activeFlag=false` and unchanged dimensions.
  - Numeric inputs use `min="0.001" step="any"`.
  - Edit gated on `parts.write`.
- `tool-catalog-view.spec.ts`: filter, search, row click, empty state, gated on `tools.read`.
- `nav.component.spec.ts`: Tool Catalog rail entry exists and routes.
- `tools.service.spec.ts`: every endpoint method tested with HttpClientTestingModule.

### E2E (Playwright, optional this iteration)
- Create a Part → fill Tool Properties as End mill → save → open `/tools/catalog` → see the row → click → returns to the same Part edit page.

## Implementation Notes

**Files to create:**
- `backend/migrations/<date>-create-tools.js`
- `backend/models/tools/tool.js`
- `backend/models/tools/toolCategory.js`
- `backend/api/tools/tool/{controller,routes}.js`
- `backend/api/tools/tool-category/{controller,routes}.js`
- `backend/tests/__tests__/tools/{tool,tool-category}.test.js`
- `frontend/src/app/models/tool.model.ts`
- `frontend/src/app/services/tools.service.ts` + `.spec.ts`
- `frontend/src/app/components/tools/tool-catalog-view/{tool-catalog-view.ts,html,css,spec.ts}`

**Files to modify:**
- `backend/api/index.js` (auto-discovery should pick up new dirs — verify)
- `backend/tests/setup.js` — seed ToolCategories + new permission
- `frontend/src/app/app.routes.ts` — add `/tools/catalog` (auth-only; `tools.read` enforced server-side)
- `frontend/src/app/components/common/nav/nav.component.{ts,html,spec.ts}` — Tool Catalog entry
- `frontend/src/app/components/inventory/part-edit-page/part-edit-page.{ts,html,css,spec.ts}` — Tool Properties section, load/save logic, category-change handler
- `CLAUDE.md` — session entry

**Patterns to follow:**
- `BillOfMaterialItems` model + `bom/controller.js` shows the partID-FK + soft-delete pattern.
- `humanizeError` already wired into the global error handler — controllers just `next(humanizeError(error, '...'))`.
- The Part edit page already has a kit/assembly BOM section that conditionally shows fields; mirror that for Tool Properties.
- `admin.impersonate` shows the special-action permission seed pattern; mirror for `admin.manage_tool_categories`.

## Created Requirement IDs

- **REQ 290** — Tool Catalog group (parent: 184)
- **REQ 291** — T1: Tools table linked 1:1 to Part, references `toolSubcategoryID`
- **REQ 292** — T2: ToolCategories (5 seeded) + ToolSubcategories (36 seeded) + M:N join
- **REQ 293** — T3: Tool dimension fields (mm, 0.001 minimum)
- **REQ 294** — T4: Soft-delete preserves field values
- **REQ 295** — T5: Tool Subcategory autocomplete on Part edit page
- **REQ 296** — T6: Tool Catalog browse page with Category + Subcategory filters
- **REQ 297** — T7: Tool Catalog nav entry
- **REQ 298** — T8: Permissions — Tool CRUD uses parts.write, reads use tools.read
- **REQ 299** — T9: New permission admin.manage_tool_categories

## Revision: 2026-05-01 — M:N category/subcategory hierarchy

Replaced the original flat 26-entry `ToolCategories` table with two tables and a join:

- **ToolCategories** (5 broad groupings, seeded): `Hand Tools`, `Power Tools`, `Mill Tools`, `Lathe Tools`, `General Purpose`
- **ToolSubcategories** (36 leaves, seeded): the original 25 cutter types + 7 hand-tool entries (Hammer, Screwdriver, Wrench, Pliers, Hand Saw, File, Chisel) + 4 power-tool entries (Cordless Drill, Angle Grinder, Circular Saw, Sander)
- **ToolCategorySubcategories** (composite-key M:N): subcategories like `Drill Bit`, `Reamer`, `Tap` link to multiple categories (Mill/Lathe/General Purpose); `Boring Bar / Boring Head` to Lathe only; etc.
- **Tools.toolSubcategoryID** replaces the prior `toolCategoryID` — a Tool references one subcategory; its categories are derived via the join.

New endpoints under `/api/tools/tool-subcategory` mirror the category endpoints; both gated on `admin.manage_tool_categories` for write, `tools.read` for read.

Frontend updates:
- Part edit page: subcategory autocomplete (showing categories as a suffix per option).
- Tool Catalog list: two filters (Category, Subcategory). The Subcategory dropdown narrows to options under the selected Category and clears itself when the selection no longer fits.
