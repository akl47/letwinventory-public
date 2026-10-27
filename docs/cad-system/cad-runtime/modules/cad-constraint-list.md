# cad-constraint-list

> **System** ▸ [Overview](../../00-overview.md) ▸ [CAD Modeler](../../10-cad-modeler.md) ▸ [Constraints](../../cad-modeler/constraints.md) ▸ **cad-constraint-list**
> Related: [cad-sketch-editor](./cad-sketch-editor.md) · [cad-editor](./cad-editor.md) · [constraints](../../cad-modeler/constraints.md)

---

## Requirements

Requirements governed by [constraints group](../../cad-modeler/constraints.md).

| REQ | Status | Summary |
|-----|--------|---------|
| 524 | unapproved | Constraint types: coincident, fixed, horizontal, vertical, perpendicular, parallel, tangent, equal, symmetric, midpoint, concentric, collinear |
| 532 | unapproved | User-visible rejection message when constraint system is inconsistent |

---

## Succinct description

A read-only sidebar panel that lists every constraint in the active sketch, with per-row remove and value-edit affordances.

## How it works — for everyone (non-technical)

While a sketch is open, the constraints panel on the right side of the screen shows every rule that's been applied — things like "these two lines are parallel" or "this distance is 10 mm." Each row has a small icon for the constraint type, the entities it affects, and an × button to remove it. If the constraint has a numeric value (like a radius or a distance) you can double-click the value chip to change it.

## How it works — in detail (technical)

**Selector:** `app-cad-constraint-list`

### Inputs and outputs

```
Inputs:  constraints (SketchConstraint[]), entities (SketchEntity[]),
         defaultUnit (Unit, default 'mm'), selectedId (string | null)

Outputs: remove (constraint id), edit ({ id, value, unit }), select (id)
```

### Row computation

`rows = computed<ConstraintRow[]>(...)` builds a display row per constraint. Chain-internal duplicates are filtered: dimensional constraints in a chain that lack `placement` are hidden (the offset tool emits multiple solver-constraint records with a shared `chainId`; only the one with a `placement` is user-visible). `labelForEntity` resolves each `target.entityId` to a short human label (`pt(x, y)`, `line`, `circle r=…`).

### Value editing

`onEditValue(r)` uses `window.prompt` for the value. Angle values are shown and parsed in degrees (internally stored as radians); length values use `parseUserValue` (accepts `mm`, `um`, `in` suffixes). On confirmation, `edit.emit({ id, valueMm, unit })` is sent to the parent for solver re-run.

### Icon and label maps

`ICON: Record<ConstraintType, string>` and `LABEL: Record<ConstraintType, string>` are module-level maps covering all 24 constraint types, including `on-edge` (used by Convert Entities to mark projected edges).

## Key files

- `frontend/src/app/components/cad/cad-constraint-list/cad-constraint-list.component.ts`
- `frontend/src/app/cad/lib/types.ts` — `SketchConstraint`, `ConstraintType`
- `frontend/src/app/cad/lib/units.ts` — `parseUserValue`, `formatNumber`, `fromMm`
