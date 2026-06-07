# units.ts

> **System** ▸ [Overview](../../00-overview.md) ▸ [CAD Modeler](../../10-cad-modeler.md) ▸ [Units / IDs / Migration](../units-ids-migration.md) ▸ **units.ts**
> Related: [ids.ts](./ids.md) · [migration.ts](./migration.md) · [Units / IDs / Migration group page](../units-ids-migration.md)

---

## Requirements

Governed by [Units / IDs / Migration](../units-ids-migration.md). No single requirement maps exclusively to this module; the unit-handling contract is embedded in REQ 562 (tessellation chord-height in mm), REQ 639 (numeric parameters all in mm), and the sketching requirements generally.

---

## Succinct description

`units.ts` is a zero-dependency conversion and formatting library. All sketch coordinates and constraint values are stored in millimeters; this module converts between mm and the three supported display units (mm, µm, in), parses user-typed strings with optional unit suffixes, and formats values for display.

---

## How it works — for everyone (non-technical)

The system always stores dimensions in millimeters internally, but lets you type and read values in millimeters, microns, or inches. This module handles the conversion — typing `0.5in` gets stored as `12.7`, and when the display unit is inches, `12.7` shows back as `0.5`.

---

## How it works — in detail (technical)

### Exported types

- `Unit` — `'mm' | 'um' | 'in'`
- `UNITS` — `Unit[]` ordered array for UI pickers.
- `ParsedValue` — `{ valueMm: number; unit: Unit | null }` — `unit` is `null` when the input was a bare number (caller falls back to the model default).

### Exported functions

| Function | Signature | Purpose |
|----------|-----------|---------|
| `fromMm` | `(valueMm, unit) → number` | Stored mm → display magnitude. |
| `toMm` | `(displayValue, unit) → number` | Display magnitude → stored mm. |
| `formatNumber` | `(n, maxDecimals=3) → string` | Fixed-decimal, trailing zeros stripped. |
| `formatWithUnit` | `(valueMm, unit, showSuffix) → string` | Full display string; suffix appended only when `showSuffix` is true. |
| `unitSymbol` | `(unit) → string` | `'um'` → `'µm'`; others return themselves. |
| `parseUserValue` | `(raw, defaultUnit) → ParsedValue \| null` | Parse `"10"`, `"10mm"`, `"0.5in"`, `"0.5\""`, `"200µm"`. Returns `null` on garbage input. |

### Conversion factors

```
mm → mm :  × 1
mm → um :  × 1000    (equivalently ÷ 0.001)
mm → in :  ÷ 25.4
```

`parseUserValue` accepts `mm`, `um`, `µm`, `in`, and `"` as unit suffixes (case-insensitive, optional whitespace before). Bare numbers inherit `defaultUnit`; the returned `unit` field is `null` in that case so the caller knows whether the user explicitly specified a unit.

### `formatWithUnit` convention

The display convention for dimension labels: show the unit suffix only when the dimension's unit differs from the model's default unit (`FeatureTree.defaultUnit`). This keeps labels clean in all-mm models while surfacing the unit when the user explicitly set a non-default for a particular dimension.

### No cross-module dependencies

`units.ts` imports nothing from the rest of `cad/lib/` — this is explicit (see the comment in `formatNumber`). That keeps it safe to import from any layer (store, solver, tessellator, backend-shared code) without import cycles.

---

## Key files

- `frontend/src/app/cad/lib/units.ts` — this module
- `frontend/src/app/cad/lib/units.spec.ts` — unit tests
