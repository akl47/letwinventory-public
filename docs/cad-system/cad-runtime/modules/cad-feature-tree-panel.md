# cad-feature-tree-panel

> **System** ▸ [Overview](../../00-overview.md) ▸ [CAD Modeler](../../10-cad-modeler.md) ▸ [Feature tree](../../cad-modeler/feature-tree.md) ▸ **cad-feature-tree-panel**
> Related: [cad-editor](./cad-editor.md) · [feature-tree](../../cad-modeler/feature-tree.md) · [multi-body](../../cad-modeler/multi-body.md)

---

## Requirements

| REQ | Status | Summary |
|-----|--------|---------|
| 545 | unapproved | Ordered feature list displayed in the panel |
| 607–611 | unapproved | Feature/sketch delete, edit, visibility toggle, context menu |
| 622 | unapproved | Origin feature group collapsed by default |
| 626 | unapproved | Multi-select with shift/ctrl modifier keys |

### REQ 611 — Context menu on feature and sketch rows

- **Description:** Feature tree rows (both feature rows and sketch rows) shall expose a right-click context menu containing the actions appropriate to their type.
- **Rationale:** Matches SolidWorks / OnShape pattern where right-clicking a tree row reveals edit, delete, rename, visibility, and rollback actions.
- **Verification:** Right-click each row kind; confirm appropriate menu items appear and fire the correct outputs.
- **Validation:** A designer can delete a feature, hide a sketch, or roll back the tree without touching the main toolbar.

---

## Succinct description

The left-panel component that renders the SolidWorks-style feature tree (top half) and bodies list (bottom half), with context menus, rollback bar, and per-row visibility toggles.

## How it works — for everyone (non-technical)

The feature tree panel is the recipe list on the left side of the editor. Every step of building your part — sketches, extrudes, fillets, holes — shows up here in the order it was created. You can right-click any step to edit, delete, or hide it. Drag the yellow rollback bar up to preview the part as it looked before a given step was applied. The "Bodies" section below shows each separate solid body with its own show/hide eye.

## How it works — in detail (technical)

**Selector:** `app-cad-feature-tree-panel`

### TreeNode computation

The `nodes = computed<TreeNode[]>(...)` signal walks `features` (ordered) and `doc.sketches` (unordered), merges them into a chronological `topLevel` array (sorted by `createdAt`), then appends rollback bar and cosmetic-threads group rows. Each feature type maps to a distinct `TreeNode` with `kind`, `label`, `iconName`, `iconClass`, `depth`, `expandable`, `visible`, and the raw `feature` reference.

Sketch rows are rendered as children of the feature that consumes them (depth 1) when the feature is expanded, or at top level when `selectableSketches=true` (pick-extrude-target mode — all sketches become clickable targets).

### Rollback bar

A draggable "Rolled back to here" bar is inserted before the feature at `rollbackBeforeIndex`. `onRollbackDragStart` captures `document.mousemove` + `document.mouseup` so the drag survives leaving the bar row. `_hitTestRollbackTarget` walks the DOM's `li[data-feature-index]` rows to find the drop target. On `mouseup`, `rollbackChanged` emits the new index.

### Context menu positioning

A zero-size `div.menu-anchor` is positioned `fixed` at `(menuX(), menuY())`. `queueMicrotask(() => trigger.openMenu())` defers opening so MatMenu reads the correct anchor `getBoundingClientRect()`. Separate `bodyMenuTriggerEl` and `bodyCtxMenu` exist for body rows.

### Inputs and outputs

```
Inputs:  features, doc, selectableSketches, featureErrors,
         selectedFeatures, selectedSketches,
         bodyList, hiddenBodyIds, rollbackBeforeIndex,
         cosmeticThreadsCount, cosmeticThreadsVisible

Outputs: sketchSelected, sketchSelect, visibilityToggled,
         actionRequested, featureSelect,
         bodyVisibilityToggled, bodyIsolated, bodyDeleted,
         rollbackChanged
```

`FeatureTreeAction` is a tagged union: `edit-feature | delete-feature | toggle-feature-visibility | toggle-feature-suppression | rename-feature | edit-sketch | delete-sketch | toggle-sketch-visibility | rename-sketch | toggle-cosmetic-threads-visibility`.

## Key files

- `frontend/src/app/components/cad/cad-feature-tree-panel/cad-feature-tree-panel.component.ts`
- `frontend/src/app/cad/lib/featureTree.ts` — `defaultDatumVisibility`
- `frontend/src/app/cad/lib/holeSpecs.ts` — `holeSpec` (resolves hole size label for tree display)
