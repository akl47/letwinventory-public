# cad-mini-preview

> **System** ▸ [Overview](../../00-overview.md) ▸ [VCS](../../30-vcs.md) ▸ **cad-mini-preview**
> Related: [cad-revision-list](./cad-revision-list.md) · [cad-preview-3d](./cad-preview-3d.md) · [VCS](../../30-vcs.md)

---

## Requirements

Requirements governed by [VCS group](../../30-vcs.md).

| REQ | Status | Summary |
|-----|--------|---------|
| 711 | unapproved | Version-history 3D preview shall display the stored low-res commit image immediately as a placeholder |

---

## Succinct description

A static thumbnail that shows the low-resolution poster image captured at check-in for a given commit hash — no live render, no kernel calls.

## How it works — for everyone (non-technical)

Whenever the version history shows a list of commits, each one gets a small thumbnail of what the part looked like at that save point. This component fetches and displays that thumbnail image. If no thumbnail was captured (older commits), it shows "no preview."

## How it works — in detail (technical)

**Selector:** `app-cad-mini-preview`

`@Input() modelId: number` and `@Input() hash: string` identify the commit. `@Input() w`, `@Input() h` control the size (default 320×200 px).

`ngOnChanges` calls `load()`, which calls `cadApi.getCommitThumbnail(modelId, hash)` (`GET /api/design/cad-model/:id/commits/:hash/thumbnail` → blob). The blob URL is created via `URL.createObjectURL` and revoked in `ngOnDestroy` + before each new load to prevent memory leaks.

`state` signal is `'loading' | 'ok' | 'empty'`. The `loading` state renders a spinner sized to the container; `empty` renders the text "no preview". `ok` renders an `<img>` with `object-fit: cover`.

A `lastKey` guard (`${modelId}:${hash}`) prevents stale responses from a previous (modelId, hash) pair from overwriting the current display.

## Key files

- `frontend/src/app/components/cad/cad-mini-preview/cad-mini-preview.component.ts`
- `frontend/src/app/services/cad-model.service.ts` — `getCommitThumbnail`
