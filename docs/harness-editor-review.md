# Harness Editor Review — wire ends, midpoints, and general health

_Reviewed 2026-11-13 on branch `harness-editor-review` (master @ `8119133`)._

## Scope and method

Code review only — nothing was run in a browser, so every finding is derived from reading the source and should be confirmed by reproducing it before a fix is written.

Read in full: `utils/harness/wire.ts`, `wire-endpoint.ts`, `wire-drawing-manager.ts`, `endpoint-resolver.ts`; the wire-related paths of `harness-canvas.ts` (render passes, mouse down/move/up, double-click, pen mode, node add/remove, group/multi move, connection normalize, keyboard); the keyboard, undo and data-change wiring in `harness-page.ts`.

Skimmed: property panel, toolbar, test inventory. Not reviewed: `block-renderer.ts` / `sub-harness.ts` drawing code, the dialogs, parts sync, backend, the sub-harness edit-mode handlers beyond confirming they duplicate the parent handlers.

Paths below are relative to `frontend/src/app/`. `canvas` = `components/harness/harness-canvas/harness-canvas.ts`, `page` = `components/harness/harness-page/harness-page.ts`, `wire.ts` = `utils/harness/wire.ts`.

## Summary

The clunkiness around wire ends and midpoints has one underlying cause and several consequences:

- **The wire path is computed in about eight places with slightly different inputs.** What is drawn, what is hit-tested, and what is edited are not always the same path. Node handles can be offset from their grab area, adding a node can land it on the wrong segment, and the label's drag area can sit away from the label.
- **Waypoints are raw absolute points with no routing rules.** Dragging a node makes diagonals, moving a connector leaves its wire stubs behind, and the first manual edit turns an auto-routed wire into a fixed polyline for good.
- **Wire ends are not editable objects.** An end cannot be moved to another pin, and terminations are labelled "Left/Right" from a positional guess.

Separately, there are three bugs outside the wire code that are worth fixing regardless (section D): a leaked document key listener, Backspace in pen mode also deleting the selection, and wire creation not being undoable.

---

## A. Midpoints (nodes / waypoints)

### A1. Adding a node to an auto-routed wire inserts it in the wrong place — bug
`canvas:4544 addWireControlPoint` → `wire.ts:1173 findWaypointInsertIndex`

`findWaypointInsertIndex` builds its path as `[from, ...connection.waypoints, to]`. For a wire with no stored waypoints that is the straight diagonal between the two pins, not the orthogonal route on screen. The click is projected onto that diagonal and the index is always 0. `addWireControlPoint` then converts the auto-route to waypoints and splices the new point in at index 0 — before the lead-out corner, at a position that isn't on the wire.

**Fix:** convert the auto path to waypoints first, then find the segment on that path. Same bug in the sub-harness copy (`canvas:4666`).

### A2. Node handles and their hit areas disagree — bug
`wire.ts:971 hitTestWireControlPoint`, called at `canvas:1415`, `:1700`, `:2547`

Handles are drawn from the cached render path, which is routed with element bounds and then shifted by `offsetOverlappingSegments`. `hitTestWireControlPoint` recomputes the route without bounds and without offsets. For an auto-routed wire whose path was offset or whose lead direction depends on bounds, the grab area is somewhere other than the dot, and the index it returns can refer to a different corner than the one under the cursor. The drag handler (`canvas:2003`) recomputes a third time, again without offsets.

**Fix:** hit-test and drag against `computedWirePaths` (already cached per render for `hitTestWire`).

### A3. Dragging a node breaks orthogonality — design
`canvas:2003–2045`

A drag replaces one point. Its neighbours don't move, so both adjacent segments become diagonal unless the user lands exactly on the neighbour's row or column. There is no segment drag.

**Suggestion:** make segment drag the primary gesture (drag a run perpendicular to itself; neighbours stretch to stay orthogonal), and constrain corner drags so adjacent segments stay axis-aligned.

### A4. First manual edit freezes auto-routing permanently — design
`canvas:4567`, `:4623`, `:2013`

Any add / remove / drag converts the entire auto path, including the lead-out stubs next to each pin, into stored waypoints. From then on the wire never re-routes, nothing shows that it is now manual, and there is no way back.

**Suggestion:** a "Reset routing" action (context menu + property panel) that clears `waypoints`; consider storing only interior waypoints and always recomputing the pin stubs.

### A5. Waypoints don't follow the elements they belong to — design/bug
`canvas:1915–1945` (single drag), `:3840 moveGroupBy`, `:3876 moveMultiSelectionBy`

Moves update block positions only. Waypoints are absolute, so after moving a connector the stub beside its pin goes diagonal, and a wire whose both ends are in a moved group or multi-selection is left behind in the middle.

**Fix:** when both endpoints move by the same delta, translate all waypoints; when one endpoint moves, translate (or recompute) the stub adjacent to it.

### A6. Pen-mode wires are literal polylines — design
`canvas:1332–1348`, `:3671 drawWirePenPreview`, `:4450 completeWirePenMode`

Each click becomes a raw waypoint and segments are straight lines between clicks. There is no lead-out from the start pin, no orthogonal constraint, and the first segment can cut through the source block. The result looks different from auto-routed wires unless the user places every corner by hand.

**Suggestion:** route each pen leg orthogonally (reuse `calculateOrthogonalPathV2` per leg), and always emit the pin stubs.

### A7. Hit sizes are fixed in world units — usability
`wire.ts:889` (threshold 8), `:982` (8), `:662` (handle radius 6)

Thresholds and handle radii don't scale with zoom, so nodes shrink and become hard to hit when zoomed out. The debug overlay already divides by zoom (`canvas:1203`); the real handles don't.

### A8. Node Edit drops back to Select on a miss — usability
`canvas:1450–1454`

Clicking empty canvas in Node Edit clears the selection and switches the tool to Select. Combined with A2 and A7, a near miss on a handle exits the mode.

### A9. Redundant-node cleanup runs inside an `effect` and only for the selected wire — minor
`canvas:299–316`, `:322`

`cleanupRedundantControlPoints` emits `dataChanged` from a tool-change effect, and only cleans the wire selected at that moment. Collinear nodes created on other wires stay.

---

## B. Wire ends

### B1. A wire end cannot be moved to a different pin — missing capability
`canvas:1524–1547`

In Select mode a pin hit is tested before anything else and always starts a new wire. Re-terminating a wire means deleting and redrawing it, which loses its label, colour, gauge, length, terminations and routing.

**Suggestion:** when a wire is selected, show end handles; dragging one onto a compatible pin rewrites that endpoint in place.

### B2. "Left End / Right End" terminations are a positional guess — correctness risk
`canvas:3395 normalizeConnection`; property panel termination fields

`normalizeConnection` makes `from` whichever endpoint has the smaller `x + y`, swapping terminations and reversing waypoints. It runs on wire creation and from a handful of page events (`page:351`, `:403`, `:1380`, `:1394`, `:1581`), not on every move path (group and multi-selection moves emit `dataChanged` directly). Between normalizations the panel's "Left End" can be the right-hand end. `x + y` is also not "left": an endpoint that is further right but higher can win.

`normalizeAllConnections` only detects a change by comparing four `from*` fields, so a swap between two sub-harness endpoints is not detected.

**Suggestion:** label terminations by what they connect to ("J1 pin 3 end"), and stop reordering endpoints.

### B3. Label drag uses a different path than the drawn label — bug
`wire.ts:1072 hitTestWireLabelHandle`, `:1114 getPositionFromPoint`

For wires without waypoints both functions fall back to the legacy V1 router (`calculateOrthogonalPath`), while the label is drawn on the V2 + offset path. The hit box is a fixed ±30 × ±10 regardless of the label's text width. `hitTestWireLabelHandle` also ignores a cable-derived label (`cableLabel`), which `drawWire` supports.

### B4. Mating connections are drawn on one path and hit-tested on another — bug
`canvas:742` vs `:1436`

`drawMatingConnection` is not given the offset-adjusted path, but mating connections take part in the overlap offsetting and are hit-tested against the adjusted cache.

### B5. Pin hit-testing ignores z-order — minor
`canvas:1524`

Pins are tested in block array order, not by `zIndex`, unlike body hits (`canvas:1570`). With overlapping blocks the wire can start from a covered pin.

### B6. Unresolvable connections are silently hidden — data integrity
`canvas:688` (`if (!fromEndpoint || !toEndpoint) return;`), `page:1058 onEditConnector`

Editing a connector/component so that a referenced pin no longer exists (or is hidden) leaves the connection in `harnessData`, but it is skipped at render time and cannot be selected or deleted. I did not find any cleanup or warning for these.

---

## C. Structure

### C1. One path source
The route is recomputed in `drawWire`, `drawMatingConnection`, `hitTestWire`, `getWireControlPoints`, the drag handler, node add, node remove, the debug overlay, and the two label functions. A1, A2, B3 and B4 are all the same defect. A single `getWirePath(connectionId)` backed by the per-render cache, used by every consumer, removes the class.

### C2. `harness-canvas.ts` is 5,760 lines with interaction logic in triplicate
The pin-hit → start-wire block, the pen-click → waypoint-or-finish block, and the hover tracking exist once for the Wire tool (`canvas:1288–1397`), again for the Select tool (`:1460–1565`), and again in the sub-harness edit-mode handlers (`:5041–5760`). Node add/remove also has parent and child copies (`:4544`/`:4666`, `:4608`/`:4724`). Every wire fix has to be applied two or three times.

### C3. Dead and leftover code
- `WireDrawingManager` (`utils/harness/wire-drawing-manager.ts`, 485 lines) is instantiated at `canvas:217` and never called; the canvas keeps ~25 parallel `wireStart*` / `hovered*` fields instead.
- The drag-release wire creation branch (`canvas:2239`) looks unreachable: every place that sets `isDrawingWire` in the parent handlers also sets `isWirePenMode`.
- V1 `calculateOrthogonalPath` (`wire.ts:53`) survives only as a fallback and as the cause of B3; its `_obstacles` parameter is unused.
- `if (true)` / `true ? … : …` snap leftovers (`canvas:1961`, `:1997`, `:4556`, `:4683`, `:5464`…); `canvasSettings.snapToGrid` is stored but never read.
- Three `console.log` calls in `onDoubleClick` (`canvas:2440`, `:2444`, `:2593`).
- Element bounds are computed twice with separate code: `endpoint-resolver.ts` (`get*CenterAndBounds`) and `canvas:4000 getWireObstacles`.

### C4. No unit tests for `utils/harness/`
There are no spec files for routing, overlap offsetting, hit-testing or waypoint insertion — the pure functions where A1/A2/B3 live. `harness-canvas.spec.ts` is 321 lines; the e2e spec covers list, open and export only.

### C5. Per-event cost
Each mouse move during a drag emits a new `HarnessData`, which rebuilds all blocks and re-renders; hit-testing then resolves every connection's endpoints again (`data.connectors.find` per connection) and calls `getWireObstacles()` afresh, sometimes twice in one handler (`canvas:1408` and `:1429`). Fine for small harnesses; likely to show on large ones. Not measured.

### C6. Routing limits
`routeAroundObstacles` (`wire.ts:307`) tries two L-shapes, then detours around the first blocking obstacle only, without checking the detour against other obstacles. `offsetOverlappingSegments` spreads overlapping runs by a full grid unit each, which can push a run into a neighbouring block. Connection ids are `conn-${Date.now()}`.

---

## D. Bugs outside the wire code

### D1. Document key listener is never removed — bug
`page:177`

`document.addEventListener('keydown', (e) => this.handleKeydown(e))` uses an anonymous arrow and `ngOnDestroy` (`page:159`) does not remove it. Every visit to the editor adds another listener, and listeners from destroyed pages keep handling keys app-wide: `Ctrl+S` calls `onSave()` on a dead component, and bare `R`, `F`, `W`, `N`, `H`, `V` are handled on other screens whenever focus isn't in an input.

### D2. Backspace while drawing a wire also deletes the selection — bug
`canvas:4852` and `page:237`

The canvas (`@HostListener('document:keydown')`) pops the last pen waypoint on Backspace. The page's separate document listener also receives the event and calls `onDeleteSelected()`. If anything was selected before the wire was started, it is deleted.

### D3. Undo coverage is uneven — bug
`page:1351 onDataChanged`

`onDataChanged` stores the new data without touching history. Drags are covered by the `dragStart`/`dragEnd` transaction and panel edits push explicitly, but creating a wire (`canvas:4450`) and adding a node by double-clicking a wire emit `dataChanged` only, so they are not undoable. In the other direction, typing a wire label pushes one history entry per keystroke (`page:1641` via `(input)`).

### D4. Delete inside sub-harness edit mode is a TODO
`canvas:4868`

---

## Suggested order

| Batch | Contents | Size |
|---|---|---|
| 0 — tests first | Unit specs for `wire.ts` (routing, offsets, insert index, hit tests) pinning current behaviour | Small |
| 1 — correctness | C1 single path source (fixes A1, A2, B3, B4); A7 zoom-scaled hits; A8 stay in Node Edit; D1, D2, D3; C3 dead-code removal | Small–medium |
| 2 — feel | A3 segment drag; A5 waypoints follow elements; A4 reset routing; A6 orthogonal pen mode | Medium |
| 3 — wire ends | B1 drag an end to re-terminate; B2 endpoint-named terminations; B6 surface/clean dangling connections | Medium |
| 4 — structure | C2 extract wire interaction from the canvas and unify parent / sub-harness handlers | Large |

Batch 1 is the cheapest way to make nodes behave predictably; Batch 2 is what will change how the tool feels. Batch 4 is optional but makes 2 and 3 roughly half the work if done first for the wire paths only.
