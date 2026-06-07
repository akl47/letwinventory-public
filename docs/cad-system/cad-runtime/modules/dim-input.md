# dim-input

> **System** ▸ [Overview](../../00-overview.md) ▸ [CAD Modeler](../../10-cad-modeler.md) ▸ [Equations](../../cad-modeler/equations.md) ▸ **dim-input**
> Related: [cad-equations-panel](./cad-equations-panel.md) · [cad-editor](./cad-editor.md) · [equations](../../cad-modeler/equations.md)

---

## Requirements

| REQ | Status | Summary |
|-----|--------|---------|
| 641 | unapproved | Every numeric input in the CAD editor accepts both a literal number and `=expression` syntax |

### REQ 641 — Equation-aware dimension input

- **Description:** Every numeric input in the CAD editor (extrude distance, direction-2 distance, start-condition offset, revolve angle, and so on) shall accept an `=<expression>` prefix. When the user types `=length * 2`, the system shall resolve the expression against the model's equations doc, display the resolved numeric value beneath the field, and persist both the expression and the resolved value so downstream consumers always see a number.
- **Rationale:** Driving feature parameters from named equations is fundamental to parametric modeling — the whole point of the equations feature.
- **Verification:** Set `length=50` in equations, type `=length*2` in extrude distance; confirm preview shows 100 and the extrude is 100 mm.
- **Validation:** Changing `length` to 60 causes the extrude to automatically regenerate to 120 mm.

---

## Succinct description

A drop-in replacement for `<input type="number">` that additionally accepts `=<expression>` syntax, resolves it live against the model's equation values, and emits both the numeric result and the expression text.

## How it works — for everyone (non-technical)

Wherever you see a number field in the CAD editor — extrude distance, revolve angle, fillet radius — you can type `=myVariable` instead of a plain number. A small sigma (Σ) badge appears in the corner to remind you it's driven by an equation, and the resolved number is shown below in grey. If you type a plain number instead, the equation binding is removed.

## How it works — in detail (technical)

**Selector:** `app-dim-input`

### Three states

| State | Condition | displayText | livePreview |
|-------|-----------|-------------|-------------|
| Number | `expression()` is null | `String(value())` | null |
| Expression | `expression()` is non-null | `=<expr>` | resolved value or error |
| Editing | `editText()` is non-null | edit buffer | live from buffer |

`editText` is a local `signal<string | null>` that decouples the keyboard buffer from the upstream inputs to avoid signal-update churn.

### Commit logic (`onCommit`)

1. If text starts with `=`: parse the expression via `evalExpression(expr, equationValues())`.
   - On success: `expressionChange.emit(expr)` + `valueChange.emit(resolvedValue)`.
   - On error: `expressionChange.emit(expr)` only (preserves expression text so user sees the error in preview; does not change numeric value).
   - Empty `=`: `expressionChange.emit(null)` (clears equation).
2. If text is a plain number: `parseFloat` → `valueChange.emit(num)`. If expression was non-null, `expressionChange.emit(null)` is emitted first to clear the binding.

### Sigma badge

`<span class="sigma-badge">Σ</span>` renders via `*ngIf="expression() !== null"` positioned `absolute right: 6px` inside the input wrapper. `pointer-events: none` prevents accidental clicks on the badge.

## Key files

- `frontend/src/app/components/cad/dim-input/dim-input.component.ts`
- `frontend/src/app/cad/lib/equations.ts` — `evalExpression`
