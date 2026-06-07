# sketch-delete-warning-dialog

> **System** ▸ [Overview](../../00-overview.md) ▸ [CAD Modeler](../../10-cad-modeler.md) ▸ [Feature tree](../../cad-modeler/feature-tree.md) ▸ **sketch-delete-warning-dialog**
> Related: [cad-editor](./cad-editor.md) · [cad-feature-tree-panel](./cad-feature-tree-panel.md) · [feature-tree](../../cad-modeler/feature-tree.md)

---

## Requirements

Requirements governed by [feature-tree group](../../cad-modeler/feature-tree.md).

| REQ | Status | Summary |
|-----|--------|---------|
| 608 | unapproved | Deleting a sketch referenced by extrude features offers Cascade / Break references / Cancel |

### REQ 608 — Sketch deletion with dependent features

- **Description:** The user shall be able to delete a sketch from the active CAD document. If one or more Extrude features reference the sketch as their source, the system shall warn the user and offer three options: Cascade (delete the sketch and all referencing features), Break references (delete only the sketch, leaving the features with an invalid reference that produces a regen error), or Cancel.
- **Rationale:** Silently deleting a sketch that drives an extrude would corrupt the model without warning.
- **Verification:** Create a sketch, extrude it, attempt to delete the sketch; confirm the dialog appears with the correct options and each option produces the stated outcome.
- **Validation:** A designer can either clean up the whole chain or deliberately break a reference when redesigning.

---

## Succinct description

A three-button MatDialog warning that appears when a sketch is about to be deleted and it is the source of one or more Extrude features.

## How it works — for everyone (non-technical)

If you try to delete a sketch that's being used by an Extrude step, this warning appears first. It names the affected Extrude steps and offers three choices: delete both the sketch and the extrudes (Cascade), delete only the sketch (Break references — the extrudes will show errors until fixed), or cancel.

## How it works — in detail (technical)

**Selector:** `app-sketch-delete-warning-dialog`

Opened by `cad-editor` when `deleteSketchAction` detects that `doc.sketches[sketchId]` is referenced by at least one feature in `featureTree.features`.

**Injected data:**
```typescript
interface SketchDeleteWarningData {
  sketchId: string;
  dependentFeatureIds: string[];
}
```

**Return type:** `SketchDeleteAction = 'cascade' | 'break' | 'cancel'`

The three buttons call `choose(action)` which calls `ref.close(action)`. The cad-editor's `applySketchDelete` handler then:
- `'cascade'` → calls `removeFeaturesReferencingSketch(featureTree, sketchId)` + `deleteSketch(doc, sketchId)`
- `'break'` → calls only `deleteSketch(doc, sketchId)` (features left with stale `sketchId`)
- `'cancel'` → no-op

## Key files

- `frontend/src/app/components/cad/sketch-delete-warning-dialog/sketch-delete-warning-dialog.component.ts`
- `frontend/src/app/cad/lib/featureTree.ts` — `removeFeaturesReferencingSketch`
- `frontend/src/app/cad/lib/document.ts` — `deleteSketch`
