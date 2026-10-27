# cad-checkin-dialog

> **System** ▸ [Overview](../../00-overview.md) ▸ [VCS](../../30-vcs.md) ▸ **cad-checkin-dialog**
> Related: [cad-editor](./cad-editor.md) · [VCS](../../30-vcs.md)

---

## Requirements

Requirements governed by [VCS group](../../30-vcs.md).

| REQ | Status | Summary |
|-----|--------|---------|
| 680 | unapproved | Check-in requires lock + commit message; serializes working copy as a commit |

---

## Succinct description

A MatDialog that shows the uncommitted diff (working copy vs last check-in) and collects a commit message before calling check-in.

## How it works — for everyone (non-technical)

Before saving a version to the history, the check-in dialog appears and shows a summary of what changed since the last save — features added or removed, parameters edited. You type a short note describing what you did ("added fillet on top edge") and click Check in. This locks the design into a permanent snapshot in the history.

## How it works — in detail (technical)

**Selector:** `app-cad-checkin-dialog`

Opened by `cad-editor` via `MatDialog.open(CadCheckinDialogComponent, { data: { modelId } })`. Returns `CadCheckinResult | null` (`null` = cancelled).

### Diff fetch

`constructor()` immediately calls `cadApi.workingDiff(modelId)` (`GET /api/design/cad-model/:id/working-diff`). The diff response contains `entries: CadDiffEntry[]`. Entries with `status === 'unchanged'` are filtered out; the rest are formatted by `formatDiffEntry` from `cad/lib/diffFormat.ts` into `FormattedDiff[]` with `{ sign, text, cls, sublines }` (sign is `+`/`~`/`-`; cls maps to CSS `add`/`mod`/`del`).

### Layout

```
[ Changes since last check-in ]
  + Extrude · 15
  ~ Sketch sketch-1 — 2 changes
      ~ line: length 10 → 20
[ Check-in message input ]
[ Cancel ]  [ Check in ]
```

`message` is a plain string field; Enter in the input calls `confirm()`. The dialog is intentionally simple — no auto-message generation, no diff navigation.

## Key files

- `frontend/src/app/components/cad/cad-checkin-dialog/cad-checkin-dialog.component.ts`
- `frontend/src/app/cad/lib/diffFormat.ts` — `formatDiffEntry`
- `frontend/src/app/services/cad-model.service.ts` — `workingDiff`
