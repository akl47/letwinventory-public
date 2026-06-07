# cad-equations-panel

> **System** ▸ [Overview](../../00-overview.md) ▸ [CAD Modeler](../../10-cad-modeler.md) ▸ [Equations](../../cad-modeler/equations.md) ▸ **cad-equations-panel**
> Related: [cad-editor](./cad-editor.md) · [dim-input](./dim-input.md) · [equations](../../cad-modeler/equations.md)

---

## Requirements

Requirements governed by [equations group](../../cad-modeler/equations.md). The defining requirement for this panel is:

| REQ | Status | Summary |
|-----|--------|---------|
| 640 | unapproved | Equations panel listing globals, feature/sketch bindings with live validation |

### REQ 640 — Equations panel

- **Description:** The CAD editor shall provide an Equations panel (toolbar button "Σ Equations") that lists every entry in the model's equations document and allows the user to add, edit, delete, and rename variable entries, and to edit the expression of any feature- or sketch-bound entry.
- **Rationale:** SolidWorks-style equations let a designer express intent ("flange_width = housing_width / 2") so that changing one variable propagates consistently through the model.
- **Verification:** Open the panel, add a variable, bind a feature dimension to it via `=varName`, confirm the dimension updates when the variable changes.
- **Validation:** A designer can modify a single equation and have all dependent features regenerate to the new value.

---

## Succinct description

The MatDialog-hosted equations editor: two sections (globals and feature/sketch bindings), live value preview, always-present draft row for zero-click entry, and read-only mode when the model is not checked out.

## How it works — for everyone (non-technical)

The Equations panel is like a spreadsheet for the model's named numbers. You type a name (like `bolt_pitch`) and an expression (like `1.25`) in the bottom empty row, and it immediately appears in the list with its value. Any dimension in the model that was set to `=bolt_pitch` now reflects the new number. The panel also shows a separate section for dimensions that are already bound to equations so you can change those expressions in one place.

## How it works — in detail (technical)

**Selector:** `app-cad-equations-panel` — opened as a `MatDialog` by the cad-editor.

**Injected data shape:**
```typescript
{
  doc: EquationDoc;
  defaultVariables?: { name: string; value: string }[];  // part identity vars (read-only)
  readonly?: boolean;
  onChange?: (doc: EquationDoc) => void;  // called on every stable mutation
}
```

### Three-section layout

1. **Variables** — globals whose keys do not contain `.`. Rendered as editable rows; the bottom draft row auto-promotes when both name and expression are non-empty.
2. **Default variables** — built-in read-only part identity values (`partName`, `partRevision`, etc.). Shown so users know what they can reference in sketch text via `#{name}`. Not editable.
3. **Used in** — entries whose keys contain `.` (e.g., `feature.f20.distance`, `sketch.s5.c2.radius`). Expression column is editable; Delete unlinks the equation (keeps the current numeric value).

### Live preview

`resolved = computed(() => resolveEquations(this.doc()))` runs the dependency-graph resolver on every doc change. `liveExpressions` signal holds the in-progress (uncommitted) text so the value column updates on every keystroke without writing to the doc.

### Draft row promotion

`commitDraft()` is called on blur from either draft input. It checks: name non-empty, expression non-empty, name not already in `doc.entries`, `draftError()` is null. On success it calls `setEquation(doc(), name, expr)` and resets both draft signals.

### Change propagation

All mutations call `this.data.onChange?.(this.doc())` immediately. The parent cad-editor debounces this into an autosave + regen cycle.

## Key files

- `frontend/src/app/components/cad/cad-equations-panel/cad-equations-panel.component.ts`
- `frontend/src/app/cad/lib/equations.ts` — `resolveEquations`, `setEquation`, `removeEquation`, `evalExpression`, `RESERVED_EQUATION_NAMES`
