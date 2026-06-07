# cad-sketch-editor

> **System** ▸ [Overview](../../00-overview.md) ▸ [CAD Modeler](../../10-cad-modeler.md) ▸ [Sketching](../../cad-modeler/sketching.md) ▸ **cad-sketch-editor**
> Related: [cad-editor](./cad-editor.md) · [cad-viewer](./cad-viewer.md) · [cad-constraint-list](./cad-constraint-list.md) · [sketching](../../cad-modeler/sketching.md)

---

## Requirements

| REQ | Status | Summary |
|-----|--------|---------|
| 521 | unapproved | 2D sketching environment: primitives, constraints, solver |
| 566–581 | unapproved | Circle, arc, rect, polygon, ellipse, slot, text, picture tools |
| 582–606 | unapproved | Perpendicular/parallel/tangent/equal/symmetric/midpoint/concentric/collinear + dimensional constraints |
| 616 | unapproved | Sketch tab in the tabbed ribbon |

### REQ 521 — 2D sketching environment

- **Description:** The CAD module shall provide a 2D sketching environment in which the user can place geometric primitives, apply geometric and dimensional constraints between them, solve the resulting constraint system, and render the primitives and their DOF state visually.
- **Rationale:** All solid features (extrude, revolve, sweep) originate from closed 2D profiles; the sketch is where dimensional intent is captured.
- **Verification:** Create a sketch, add a rectangle, add horizontal + vertical + dimension constraints, confirm solver result matches the dimensions.
- **Validation:** A designer can produce a fully-constrained sketch and extrude it to the specified depth.

---

## Succinct description

The toolbar-only sketch editor component: hosts all sketch tools, constraint buttons, and status bar; delegates pointer events from the 3D viewer into sketch-space mutations.

## How it works — for everyone (non-technical)

When you're sketching, the top toolbar switches to the "Sketch" tab, which is this component. It shows every drawing tool — line, circle, arc, rectangle, and many more — as buttons. When you click a tool and then click in the 3D viewer, this component handles the clicks, adds the geometry to the sketch, and asks the constraint solver to update all positions. It also shows the running count of points, lines, and degrees of freedom so you know when the sketch is fully constrained (turns green).

## How it works — in detail (technical)

**Selector:** `app-cad-sketch-editor`

### Tool taxonomy

Tools are grouped into five split-button families, each persisting the last-used variant across draws:

| Group | `lastXTool` signal | Representative tools |
|-------|--------------------|----------------------|
| Primitives | `lastPrimitiveTool` | line, centerline, midpoint-line, spline, style-spline |
| Circles | `lastCircleTool` | circle, arc, 3-pt circle/arc, tangent-arc, ellipse, parabola, equation-curve |
| Shapes | `lastShapeTool` | rect-corner, rect-center, rect-rounded-*, 3-pt rect, parallelogram, polygon, all slot variants, text, picture |
| Edit | `lastEditTool` | trim, extend, fillet, chamfer, split, jog, offset, mirror, dynamic-mirror, convert-entities |
| Transform | `lastTransformTool` | move, copy, rotate, scale, stretch, pattern-linear, pattern-circular |

Plus standalone: `select`, `smart-dim`.

### Inputs and outputs

```
Inputs:  sketchId, doc, readonly
Outputs: sketchChanged, exitSketch, extrudeRequested,
         cutExtrudeRequested, revolveRequested, dimensionCreated
```

All pointer events (`sketchClick`, `sketchPointerDown/Move/Up`) arrive from `cad-viewer` (already in sketch-plane 2D coords) and are dispatched by the parent `cad-editor` to the relevant `on*()` method on this component via a template reference `#sketchEditor`.

### Constraint toolbar

`CONSTRAINT_SPECS: ConstraintSpec[]` is a module-level array. Each entry has `type`, `label`, `icon`, a `predicate(entities: SketchEntity[]): boolean`, and an optional `requiresValue` or `implicitValue`. The toolbar renders one compact button per spec; buttons are disabled when the selection doesn't satisfy the predicate. `orderTargetsForConstraint` reorders the selection into the canonical order for type-asymmetric constraints (e.g., `coincident` puts the point first).

### Drag-to-move and rubber-band select

`dragState` signal holds `{ points, startCursor, isDragging }`. Drag mode engages only after the cursor moves more than 1 sketch unit from `startCursor` (`DRAG_THRESHOLD = 1`). `dragSolveGen` is a generation counter so only the most recent async solve result is applied (prevents solver race on rapid moves). `rubberBand` signal drives the selection rectangle overlay rendered in the viewer via `sketchPreview`.

### DOF status bar

```
{{ pointCount() }} pts · {{ lineCount() }} lns · DOF {{ dof() }}
· ({{ cursor().x }}, {{ cursor().y }})
```

`dof()` is derived from `analyzeDeterminacy(state)` from `cad/lib/determinacy.ts`. The viewer colors entities green (fully constrained) or blue (under-constrained) based on the `determinedEntities` input.

## Key files

- `frontend/src/app/components/cad/cad-sketch-editor/cad-sketch-editor.component.ts` — the full toolbar (4000+ lines)
- `frontend/src/app/cad/lib/store.ts` — `addLine`, `addCircle`, `addArc`, `addConstraint`, etc.
- `frontend/src/app/cad/lib/solver.ts` — `solveSketch`, `solveSketchAfterAdd`
- `frontend/src/app/cad/lib/sketchEditOps.ts` — `trimAt`, `extendLine`, `offsetCurve`, `mirrorEntities`, transform tools
- `frontend/src/app/cad/lib/inference.ts` — `inferLineEnd` (snap + polar inference)
