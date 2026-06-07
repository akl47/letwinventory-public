# extrude-dialog

> **System** ▸ [Overview](../../00-overview.md) ▸ [CAD Modeler](../../10-cad-modeler.md) ▸ [Extrude / Revolve / Sweep](../../cad-modeler/extrude-revolve-sweep.md) ▸ **extrude-dialog**
> Related: [cad-editor](./cad-editor.md) · [extrude-revolve-sweep](../../cad-modeler/extrude-revolve-sweep.md)

---

## Requirements

Requirements governed by [extrude-revolve-sweep group](../../cad-modeler/extrude-revolve-sweep.md).

| REQ | Status | Summary |
|-----|--------|---------|
| 549 | unapproved | Extrude feature from sketch profile + positive distance |
| 618 | unapproved | Extrude carries an optional flipped boolean; dialog exposes flip toggle |

---

## Succinct description

A minimal MatDialog for collecting an extrude's distance, flip direction, and (for multi-region sketches) which profile loops to include.

## How it works — for everyone (non-technical)

When you click Extrude after drawing a sketch, this small dialog appears asking how far to extrude and in which direction. If your sketch has more than one closed region (e.g., a circle inside a square), checkboxes let you pick which regions to include.

## How it works — in detail (technical)

**Selector:** `app-extrude-dialog`

Opened by `cad-editor` with:
```typescript
{
  defaultDistance: number;
  defaultFlipped?: boolean;
  loopCount?: number;
  defaultLoopIndices?: number[];
}
```

Returns `ExtrudeDialogResult | null`:
```typescript
interface ExtrudeDialogResult {
  distance: number;
  flipped: boolean;
  loopIndices: number[];
}
```

### Multi-region loop picker

When `loopCount > 1`, a checkbox list appears: "Region 1", "Region 2", … Each checkbox index maps directly to the `regionIndices` field on the `ExtrudeFeature` document node. `selectedLoops` is a plain `Set<number>`. `isValid()` returns true only when `selectedLoops.size > 0`.

Note: this dialog is the legacy flow. The current primary extrude flow uses an inline sidebar in `cad-editor` with the `profileFills` overlay (click-to-select loops directly in the viewer). The `ExtrudeDialogComponent` is no longer imported by any parent component; it is kept as a code reference only.

## Key files

- `frontend/src/app/components/cad/extrude-dialog/extrude-dialog.component.ts`
