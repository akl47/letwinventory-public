# cadEquations — Equation Resolver

> **System** ▸ [Overview](../../00-overview.md) ▸ [CAD Modeler](../../10-cad-modeler.md) ▸ [Regeneration Pipeline](../regen-pipeline.md) ▸ **cadEquations**
> Related: [cadRegenService](./cadRegenService.md)

---

## Requirements

| REQ | Status | Summary |
|-----|--------|---------|
| 634 | unapproved | Named global scalar variables (equations) driving feature parameters |
| 636 | unapproved | Parse and evaluate expressions via expr-eval |
| 637 | unapproved | Dependency-graph topological sort; cycle detection |
| 638 | unapproved | Resolve all equations before feature dispatch; hash cache keys over resolved values |
| 639 | unapproved | All numeric feature params (distance, angle, etc.) drivable by equation target keys |

### REQ 638 — Equation resolution before dispatch

- **Description:** During regeneration, the backend shall resolve all equations BEFORE feature dispatch and overwrite every feature parameter that has a matching equation target key with the resolved value.
- **Rationale:** Ensuring resolved values are what the kernel sees prevents stale cached parameter hashes from masking equation-driven updates.
- **Verification:** Test — `backend/tests/__tests__/design/cad-equations.test.js` asserts that resolved values are written into the returned featureTree.
- **Validation:** A designer changing an equation value sees the driven feature parameters update on the next regen without manual edits to the feature.

---

## Succinct description

`cadEquations.js` is the server-side mirror of `frontend/src/app/cad/lib/equations.ts`. It resolves the model's `EquationDoc` (a flat map of named entries with `expr-eval` expressions) into numeric values via topological sort + cycle detection, then rewrites every matching parameter in the feature tree and sketch constraint values before the regen walk begins.

## How it works — for everyone (non-technical)

The equations panel lets a designer write things like `Depth = 10` and `WallThickness = Depth / 4`. This module is a mini spreadsheet engine: it figures out which variable depends on which, evaluates them in the right order, and stamps the resulting numbers into the feature parameters — so the kernel always sees concrete numeric values, never formula strings.

## How it works — in detail (technical)

### Exports

```javascript
module.exports = { resolveEquations, applyEquationsToModel };
```

### `resolveEquations(doc) → { values, errors, order }`

`doc` has shape `{ entries: Record<key, { expression: string }> }`.

Steps:

1. **Shadow built-ins.** User-defined entry names that clash with `expr-eval`'s built-in unary/binary operators (e.g. `length`, `sin`, `abs`, `min`, `max`) are temporarily removed from `parser.functions`, `parser.unaryOps`, and `parser.binaryOps` for the full duration of the parse + eval call, then restored in a `finally` block. Without this, `length = 5; myVar = length / 2` would fail to parse because `length` tokenises as a built-in operator.
2. **Parse.** Each entry's expression is parsed to an AST via `parser.parse(entry.expression)`. `ast.variables()` yields the dependency list. Parse errors are recorded immediately.
3. **DFS topological sort + cycle detection.** Standard white/gray/black coloring. Any back-edge (gray → gray) extracts the cycle path and records a cycle error for every node in the cycle.
4. **Evaluate.** Entries are evaluated in `order` (topologically sorted). Non-finite results or runtime errors are recorded. Successfully evaluated values go into `values[key]`.

`parser.consts = {}` clears Euler's number and other built-in constants so user entries like `E = 100` are not silently shadowed.

### `applyEquationsToModel(model) → { featureTree, sketchDoc, equationErrors, resolvedValues }`

Calls `resolveEquations`, then walks:

- **Feature parameters.** For each non-origin feature: checks `feature.${id}.distance`, `feature.${id}.angle`, `feature.${id}.startCondition.distance`, `feature.${id}.direction2.distance` against `equations.entries`. A match with a resolved value overwrites the field on a shallow-cloned feature object. A match with an error surfaces in `equationErrors` with a human-readable path prefix.
- **Sketch constraint values.** For each constraint in each sketch with a numeric `value` and an `id`, checks `sketch.${sketchId}.constraint.${constraintId}`. Same overwrite/error logic.
- **Stale dotted keys** (entries targeting deleted features/constraints) are silently ignored.
- **Global errors** (top-level non-dotted keys with resolution errors) are surfaced directly as `equation ${key}: ${msg}`.

Target keys are only surfaced in `equationErrors` when they actually match a parameter — pure intermediate globals that only other equations reference are reported via the global-error path.

---

## Key files

- `backend/services/cadEquations.js` — this module
- `frontend/src/app/cad/lib/equations.ts` — frontend mirror (must stay in sync)
- `backend/tests/__tests__/design/cad-equations.test.js` — test coverage shared with frontend fixture
