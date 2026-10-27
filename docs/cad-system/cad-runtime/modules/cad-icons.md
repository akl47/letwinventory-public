# cad-icons

> **System** ▸ [Overview](../../00-overview.md) ▸ [CAD Modeler](../../10-cad-modeler.md) ▸ [Editor UI](../editor-ui.md) ▸ **cad-icons**
> Related: [cad-editor](./cad-editor.md) · [cad-sketch-editor](./cad-sketch-editor.md) · [editor-ui](../editor-ui.md)

---

## Requirements

This module is pure infrastructure — no direct requirement. It exists to support REQ 616 (tabbed ribbon) and the sketch toolbar which reference icons by `svgIcon="cad-*"` names.

---

## Succinct description

The CAD icon registration module: defines every custom `cad-*` SVG icon used across the ribbon, sketch toolbar, and constraint list, and provides a one-shot `registerCadIcons` function.

## How it works — for everyone (non-technical)

Angular Material's icon system normally uses Google's Material Symbols font. For CAD-specific tools (extrude, circle, trim, fillet, etc.) those standard icons don't exist, so this file defines custom SVG drawings for each tool and registers them under names like `cad-extrude` and `cad-circle`. Once registered, any component can reference them like a normal Material icon.

## How it works — in detail (technical)

**File:** `frontend/src/app/components/cad/cad-icons.ts` (not a component — a plain module).

### Registration

`registerCadIcons(iconRegistry: MatIconRegistry, sanitizer: DomSanitizer): void`

Called in `constructor()` of any component that needs these icons (cad-editor, cad-sketch-editor, cad-constraint-list). The function is idempotent — MatIconRegistry silently ignores duplicate registrations.

Each icon is registered via:
```typescript
iconRegistry.addSvgIconLiteral(
  name,
  sanitizer.bypassSecurityTrustHtml(SVG_OPEN + body + SVG_CLOSE)
);
```

`SVG_OPEN` is the standard `<svg xmlns="..." viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ...>` wrapper.

### Icon categories

| Prefix | Description |
|--------|-------------|
| `cad-extrude`, `cad-cut-extrude` | Extrude boss/cut (shared `EXTRUDE` body + `MINUS` badge) |
| `cad-revolve`, `cad-cut-revolve` | Revolve boss/cut |
| `cad-sweep`, `cad-cut-sweep` | Sweep boss/cut |
| `cad-loft`, `cad-fillet`, `cad-chamfer`, `cad-hole`, `cad-shell`, `cad-pattern-linear`, etc. | 3D feature icons |
| `cad-line`, `cad-circle`, `cad-arc`, `cad-rect-*`, `cad-polygon`, `cad-spline`, etc. | Sketch primitive tools |
| `cad-trim`, `cad-extend`, `cad-offset`, `cad-mirror`, `cad-convert`, etc. | Sketch edit tools |
| `cad-move`, `cad-copy`, `cad-rotate`, `cad-scale`, `cad-stretch`, `cad-pattern-*` | Transform tools |
| `cad-smart-dim`, `cad-coincident`, `cad-fixed`, `cad-horizontal`, `cad-perpendicular`, etc. | Constraint icons |

### Style conventions

- `viewBox 0 0 24 24`, ~2 px padding from edges
- `stroke="currentColor"` → inherits the button's text color (selected/disabled states apply automatically)
- `stroke-width 1.6`, round caps and joins
- `fill="none"` by default; `fill="currentColor"` only for solid dots (`dot()` helper) and arrowheads
- Cut variants append `MINUS` (a bold `<line>` in the top-right corner) to the boss-feature body

## Key files

- `frontend/src/app/components/cad/cad-icons.ts`
