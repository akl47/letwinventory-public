# cad-landing

> **System** ▸ [Overview](../../00-overview.md) ▸ [CAD Modeler](../../10-cad-modeler.md) ▸ **cad-landing**
> Related: [cad-editor](./cad-editor.md) · [editor-ui](../editor-ui.md)

---

## Requirements

Requirements governed by [editor-ui group](../editor-ui.md). This component has no direct requirement; it is the index view for `/design/cad`.

---

## Succinct description

The `/design/cad` index page: a filterable table of all parts that have CAD models, with quick-access "Open editor" links and release-state badges.

## How it works — for everyone (non-technical)

The CAD landing page is the front door to the CAD system. It shows a searchable list of every part that has a 3D model attached. Each row shows the part name, part number, the current revision, and whether the model is a draft or has been released. Click a row to open that part's CAD editor.

## How it works — in detail (technical)

**Selector:** `app-cad-landing`

Route: `/design/cad`.

### Data loading

`ngOnInit` calls `cadApi.listPartsWithCad()` (`GET /api/design/cad-model`) → `PartWithCadSummary[]`. Results are stored in `rows` signal; `filtered` is a computed over `rows` filtered by `filterBySearch(searchTerm, ['name', 'sku', 'manufacturerPN'])`.

### Table columns

Rendered as a `mat-table` with columns: part name (linked to `/parts/:id/cad/editor`), SKU/part number, manufacturer PN, CAD revision, workflow state badge, and a "Open editor" button.

### Empty states

- `rows().length === 0` — "No parts have CAD models yet" + hint to create a part first.
- `rows().length > 0 && filtered().length === 0` — "No parts match `searchTerm`".

Permission guard: the "Create CAD" button (shown on the part detail page, not here) requires `cad.write`. This page requires only `cad.read` (standard auth guard; all authenticated users can view the list).

## Key files

- `frontend/src/app/components/cad/cad-landing/cad-landing.component.ts`
- `frontend/src/app/services/cad-model.service.ts` — `listPartsWithCad`
- `frontend/src/app/models/cad-model.model.ts` — `PartWithCadSummary`
