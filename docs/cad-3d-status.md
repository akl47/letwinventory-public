# CAD 3D modeling — SolidWorks feature parity status

Reference checklist mapping SolidWorks's Part Design tab against this project's implementation under `frontend/src/app/cad/`, `frontend/src/app/components/cad/`, and `cad-kernel/`. Use the **Implemented** column to decide what to build next; use the **Tested by user** column as a manual smoke-test checklist.

All **Tested by user** cells start as ✗ on purpose — they get flipped to ✓ only after the project owner has manually exercised the feature in the running app.

Companion doc: [`docs/cad-sketch-status.md`](./cad-sketch-status.md) covers 2D sketcher parity. Fillet/chamfer have their own deep-dive at [`docs/cad-fillet-chamfer-parity.md`](./cad-fillet-chamfer-parity.md); this doc summarizes the same data in one row.

_Last reviewed against commit:_ `a712898` (working tree)

## Legend

- **✓** — Implemented and shippable. Data type, kernel op (where applicable), and UI wiring all present.
- **✗** — Not implemented at all.
- **▲** — Partial. Use when any of: type exists in `types.ts` but no UI tool surfaces it; kernel op exists but UI blocked; UI exists but only covers the common case; achievable via composition of existing tools but no dedicated one-click feature.
- **N/A** — Column doesn't apply (e.g. UI-only rows have no automated test column meaning; sheet-metal/surface rows are out-of-scope for this iteration).

## Counting rules

These are judgement calls — recorded here so they can be challenged:

1. **Extrude end conditions** — each kind (`blind`, `midPlane`, `throughAll`, `upToVertex`, `upToSurface`, `offsetFromSurface`, `upToBody`) gets its own row. The `ExtrudeEndCondition` union (`types.ts:323`) declares all seven and UI + kernel dispatch ALL of them — `upToBody` is wired through `cadRegenService.js` (`untilBrep`/`untilBreps`) to the kernel `build_up_to_body`.
2. **Direction 2** counts as one row, not duplicated per end-condition kind — UI offers the same end-condition picker on both directions.
3. **Sweep** = ✓ at the basic level (profile sketch + path sketch with `merge` toggle). Twist / orientation control / multi-section loft are tracked separately as ✗.
4. **Fillet — constant radius** ✓ even when multi-edge with mixed per-edge values (the `EdgeRef3D.value?` override on `types.ts:574`); variable-radius (per-vertex profile) ✗ because no UI surfaces opencascade-rs's `variable_fillet_edges` wrapper.
5. **Mirror feature ≠ Mirror body**. Mirror feature replicates one or more features about a plane; Mirror body copies an entire body. Tracked as separate rows in the Patterns + Body operations sections.
6. **Datum axes / points** — the origin row gives x/y/z axes and the origin point for free, but a **user-defined** axis or point feature ✗. Don't conflate "we have axes" with "user can create axes".
7. **Combine** — the `merge: false` toggle on extrude/revolve/sweep already produces a second body. Combine-Add as a stand-alone feature ✗; Combine-Subtract is effectively cut-extrude on an existing body but no Combine UI exists.
8. **Export** — `serialize_brep` round-trips BRep bytes through the cache, but no user-facing download path exists. So STEP export is ✗ even though OCCT supplies the writer.
9. **Coordinate systems** — the origin behaves as one, but a user-defined LCS feature ✗.
10. **Sheet metal + Surface modeling** — both whole categories are N/A by scope (no plan to ship in 2026). Rows still listed so they can be re-classified later.
11. **Auto kernel rebuild on regen** counts as one row under Cross-cutting, not duplicated per kernel op.
12. **Edit-time auto-rollback** (REQ session 2026-05-27) is its own Cross-cutting row — when the user opens an Edit sidebar, the rollback bar auto-drops so downstream features hide.

## Features — boss / cut

| Feature | Implemented | Automated test | Tested by user | Notes / source |
|---|---|---|---|---|
| Extrude — blind | ✓ | ✓ | ✗ | `types.ts:393` ExtrudeFeature + end-condition `blind` in `types.ts:323` |
| Extrude — mid-plane | ✓ | ✓ | ✗ | `types.ts:323` `kind: 'midPlane'` |
| Extrude — through all | ✓ | ✓ | ✗ | `types.ts:323` `kind: 'throughAll'` |
| Extrude — up to vertex | ✓ | ✓ | ✗ | `types.ts:323` `kind: 'upToVertex'` + viewer vertex picker |
| Extrude — up to surface | ✓ | ✓ | ✗ | `types.ts:323` `kind: 'upToSurface'` with `fallbackPlane` snapshot for renumber survival |
| Extrude — offset from surface | ✓ | ✓ | ✗ | `types.ts:323` `kind: 'offsetFromSurface'` (distance + face ref) |
| Extrude — up to body | ✓ | ✓ | ✗ | `types.ts:323` `kind: 'upToBody'`; `cadRegenService.js` resolves the target body BRep(s) (`untilBrep`/`untilBreps`) and the kernel `build_up_to_body` caps the prism (UnifySameDomain heal + empty-BRep guard) |
| Extrude — start condition (offset / up-to-vertex / up-to-surface / offset-from-surface) | ✓ | ✓ | ✗ | `ExtrudeStartCondition` in `types.ts:362`; UI mirrors end-condition picker |
| Extrude — direction 2 | ✓ | ✓ | ✗ | `ExtrudeDirection` in `types.ts:388`; same end-condition union per direction |
| Extrude — merge toggle (multi-body) | ✓ | ✓ | ✗ | `merge?: boolean` on `ExtrudeFeature` in `types.ts:393`; falsy = floating body |
| Extrude — region selection | ✓ | ✓ | ✗ | `regionIndices?: number[]` on `ExtrudeFeature`; multi-region sketch supported |
| Cut Extrude | ✓ | ✓ | ✗ | `types.ts:454` CutExtrudeFeature; shares start/end conditions with Extrude |
| Revolve | ✓ | ✓ | ✗ | `types.ts:478` RevolveFeature; axis = sketched line, angle + flip + merge |
| Cut Revolve | ✓ | ✓ | ✗ | `types.ts:510` CutRevolveFeature |
| Sweep — profile + path | ✓ | ✓ | ✗ | `types.ts:530` SweepFeature; profile and path on separate sketches; `merge` toggle |
| Sweep — twist | ✗ | ✗ | ✗ | — |
| Sweep — orientation control (follow path / keep normal / etc.) | ✗ | ✗ | ✗ | — |
| Cut Sweep | ✓ | ✓ | ✗ | `types.ts:556` CutSweepFeature |
| Loft | ✓ | ✓ | ✗ | `types.ts:1202` LoftFeature; kernel `build_loft` (`extrude.rs:276`); profile sketches lofted in section order |
| Cut Loft | ✗ | ✗ | ✗ | — |
| Boundary | ✗ | ✗ | ✗ | — |
| Thicken | ✗ | ✗ | ✗ | — |
| Hole Wizard — Simple Drill | ✓ | ✓ | ✗ | `HoleFeature` in `types.ts`; sketch-of-points placement; `_dispatchHole` in `cadRegenService.js` chains buildExtrude + buildBoolean cuts |
| Hole Wizard — Counterbore | ✓ | ✓ | ✗ | Drill + coaxial cbore cylinder at entry; spec from `holeSpecs.ts` |
| Hole Wizard — Countersink | ✓ | ✓ | ✗ | Drill + cone (revolved right triangle) at entry; ISO 90° / ANSI 82° |
| Hole Wizard — Tapped | ✓ | ✓ | ✗ | Tap-drill cylinder + cosmetic thread sidecar (REQ 665) |
| Hole Wizard — ISO M2–M12 | ✓ | ✓ | ✗ | `holeSpecs.ts` ISO_TABLE — 9 sizes |
| Hole Wizard — ANSI #4–1/2″ | ✓ | ✓ | ✗ | `holeSpecs.ts` ANSI_TABLE — 9 sizes, dimensions stored in mm |
| Dome | ✗ | ✗ | ✗ | — |
| Wrap (sketch-to-face) | ✗ | ✗ | ✗ | — |

## Fillet and chamfer

(See [`cad-fillet-chamfer-parity.md`](./cad-fillet-chamfer-parity.md) for the full breakdown.)

| Feature | Implemented | Automated test | Tested by user | Notes / source |
|---|---|---|---|---|
| Fillet — constant radius, single edge | ✓ | ✓ | ✗ | `types.ts:598` FilletFeature + kernel `body.fillet_edges` |
| Fillet — constant radius, multiple edges | ✓ | ✓ | ✗ | Same call, edge list |
| Fillet — per-edge radius (multi-radius in one feature) | ✓ | ✓ | ✗ | `EdgeRef3D.value?` on `types.ts:574`; vendored `fillet_edges_per` wrapper |
| Fillet — tangent edge propagation | ✓ | ✓ | ✗ | Sidebar toggle (default on); `propagateTangentEdges` in `tangentPropagation.ts` |
| Fillet — face-to-all-edges expansion | ✓ | ✓ | ✗ | Click a face in fillet sidebar → all boundary edges. `addEdgeBlendFace` |
| Fillet — variable radius (per-vertex profile) | ✗ | ✗ | ✗ | Kernel op exists (`variable_fillet_edges`); no UI |
| Fillet — face fillet | ✗ | ✗ | ✗ | Needs new opencascade-rs wrapper |
| Fillet — full round | ✗ | ✗ | ✗ | Needs new opencascade-rs wrapper |
| Fillet — setback at vertex | ✗ | ✗ | ✗ | — |
| Fillet — conic / elliptical cross-section | ✗ | ✗ | ✗ | — |
| Fillet — hold line | ✗ | ✗ | ✗ | — |
| Chamfer — equal distance (45°) | ✓ | ✓ | ✗ | `ChamferFeature.mode = 'equal'` (`types.ts:619`) |
| Chamfer — two distances (asymmetric) | ✓ | ✓ | ✗ | `mode: 'twoDistance'` + `distance2` field; vendored `chamfer_edges_two_distance` |
| Chamfer — distance + angle | ✓ | ✓ | ✗ | `mode: 'distanceAngle'` + `angle` field; vendored `chamfer_edges_distance_angle` |
| Chamfer — per-edge value override | ✓ | ✓ | ✗ | Same `EdgeRef3D.value?` mechanism as fillet |
| Chamfer — vertex chamfer (3 distances at a vertex) | ✗ | ✗ | ✗ | OCCT MakeChamfer doesn't support; would need a different op |
| Chamfer — offset face | ✗ | ✗ | ✗ | — |
| Chamfer — face-to-face | ✗ | ✗ | ✗ | — |

## Patterns

| Feature | Implemented | Automated test | Tested by user | Notes / source |
|---|---|---|---|---|
| Linear pattern (3D feature) | ✓ | ✓ | ✗ | `types.ts:1016` LinearPatternFeature; kernel `feature_pattern.rs`; 1–2 directions with count/spacing (REQ 822) |
| Circular pattern (3D feature) | ✓ | ✓ | ✗ | `types.ts:1033` CircularPatternFeature; axis + count + angle via `feature_pattern.rs` |
| Mirror feature (replicate a feature about a plane) | ✓ | ✓ | ✗ | `types.ts:974` MirrorFeatureFeature; mirrors selected features across a datum/face plane |
| Sketch-driven pattern (anchor instances at sketch points) | ✗ | ✗ | ✗ | — |
| Curve-driven pattern | ✗ | ✗ | ✗ | — |
| Table-driven pattern | ✗ | ✗ | ✗ | — |
| Fill pattern (cover an area) | ✗ | ✗ | ✗ | — |

## Body operations

| Feature | Implemented | Automated test | Tested by user | Notes / source |
|---|---|---|---|---|
| Multi-body (`merge: false` toggle on additive features) | ✓ | ✓ | ✗ | `merge?: boolean` on ExtrudeFeature/RevolveFeature/SweepFeature; bodies tracked in `cadRegenService.js` body roster |
| Combine — add | ✓ | ✓ | ✗ | `CombineFeature.operation: 'add'` (body-vs-body ∪); `_dispatchCombine` → `buildBoolean` fuse |
| Combine — subtract (between existing bodies) | ✓ | ✓ | ✗ | `operation: 'subtract'` (target − tools) |
| Combine — common (intersect) | ✓ | ✓ | ✗ | `operation: 'common'` (target ∩ tools) |
| Split body | ✗ | ✗ | ✗ | — |
| Move / copy body | ✓ | ✓ | ✗ | `MoveCopyBodyFeature` in `types.ts`; `_dispatchMoveCopyBody` chains buildPattern(translate) then buildPattern(rotate) with `mergeWithSource:false` |
| Mirror body | ✓ | ✓ | ✗ | `MirrorBodyFeature` in `types.ts`; `_dispatchMirrorBody` calls buildPattern(mirror) per body with `mergeWithSource:false`; keepOriginals toggle |
| Scale body | ✗ | ✗ | ✗ | — |
| Delete body (explicit feature) | ▲ | N/A | ✗ | Body row in tree has Hide/Show; deletion via feature delete from the tree, not a dedicated Delete Body feature |

## Modifications

| Feature | Implemented | Automated test | Tested by user | Notes / source |
|---|---|---|---|---|
| Shell | ✓ | ✓ | ✗ | `types.ts:1076` ShellFeature; kernel `shell.rs` (conforming-punch pipeline); `_dispatchShell` in `cadRegenService.js`, picked faces removed at a wall thickness |
| Draft (face draft angle) | ✗ | ✗ | ✗ | Needs OCCT `BRepOffsetAPI_DraftAngle` wrapper |
| Dome | ✗ | ✗ | ✗ | — |
| Wrap | ✗ | ✗ | ✗ | — |
| Indent | ✗ | ✗ | ✗ | — |
| Flex | ✗ | ✗ | ✗ | — |
| Deform | ✗ | ✗ | ✗ | — |
| Freeform | ✗ | ✗ | ✗ | — |

## Reference geometry

| Feature | Implemented | Automated test | Tested by user | Notes / source |
|---|---|---|---|---|
| Origin point | ✓ | ✓ | ✗ | `OriginFeature` (`types.ts:294`); `buildOriginDatums` in `datum.ts` |
| Origin XYZ axes | ✓ | ✓ | ✗ | `buildOriginDatums` — `x_axis`, `y_axis`, `z_axis` |
| Origin XY/YZ/XZ planes | ✓ | ✓ | ✗ | `buildOriginDatums` — three planes |
| Datum plane — offset from plane/face | ✓ | ✓ | ✗ | `DatumPlaneFeature` `method.kind: 'offset'` (`types.ts:656`); `computeDatumPlane` in `datum.ts` |
| Datum plane — parallel through point | ✓ | ✓ | ✗ | `method.kind: 'parallelThroughPoint'` |
| Datum plane — at angle through edge | ✓ | ✓ | ✗ | `method.kind: 'angleThroughEdge'` |
| Datum plane — three points | ✓ | ✓ | ✗ | `method.kind: 'threePoints'` |
| Datum plane — mid-plane | ✓ | ✓ | ✗ | `method.kind: 'midPlane'` |
| Datum plane — through edge perpendicular to face | ✓ | ✓ | ✗ | `method.kind: 'lineAndPerpFace'` |
| Datum plane — through point perpendicular to edge | ✓ | ✓ | ✗ | `method.kind: 'pointAndPerpEdge'` |
| Datum plane — tangent to cylinder | ✓ | ✓ | ✗ | `method.kind: 'tangentCylinder'` (with `flipped?` side toggle) |
| Datum axis — through two points | ✓ | ✓ | ✗ | `DatumAxisFeature` `method.kind: 'twoPoints'` (`types.ts:927`) |
| Datum axis — along edge | ✓ | ✓ | ✗ | `method.kind: 'alongEdge'` |
| Datum axis — intersection of two planes | ✓ | ✓ | ✗ | `method.kind: 'twoPlanesIntersection'` |
| Datum axis — cylindrical-face axis | ✓ | ✓ | ✗ | `method.kind: 'cylindricalFaceAxis'` (+ `fallbackAxis` for renumber survival) |
| Datum axis — through point perpendicular to face | ✓ | ✓ | ✗ | `method.kind: 'pointAndPerpFace'` |
| Datum point — on vertex | ✓ | ✓ | ✗ | `DatumPointFeature` `method.kind: 'onVertex'` (`types.ts`) |
| Datum point — center of circular edge | ✓ | ✓ | ✗ | `method.kind: 'centerOfCircularEdge'` |
| Datum point — center of face | ✓ | ✓ | ✗ | `method.kind: 'centerOfFace'` (+ `fallbackPosition`) |
| Datum point — center of mass of body | ✓ | ✓ | ✗ | `method.kind: 'centerOfMass'` (uses `body.centroid`) |
| Datum point — intersection of axis with plane | ✗ | ✗ | ✗ | Not a `DatumPointFeature` method |
| Datum point — on curve at parameter | ✓ | ✓ | ✗ | `method.kind: 'alongEdge'` with parameter `t` |
| Coordinate system (user-defined LCS) | ✗ | ✗ | ✗ | Origin behaves as one; no user feature |

## Display and utilities

| Feature | Implemented | Automated test | Tested by user | Notes / source |
|---|---|---|---|---|
| Measure — distance / angle / radius / diameter / area | ✓ | ✓ | ✗ | `cad/lib/measure.ts` `computeMeasure`; sidebar in `cad-editor.component.ts` |
| Measure — handles vertex/edge/face/datum picks | ✓ | ✓ | ✗ | Cascade hover + occlusion depth-cap in `cad-viewer.component.ts` |
| Mass properties — volume | ✓ | N/A | ✗ | Footer chip; `totalVolumeMm3` computed via divergence theorem in `cad-editor.component.ts` |
| Mass properties — mass / centroid / moments / surface area | ✗ | ✗ | ✗ | Volume only |
| Section view (clip plane) | ✗ | ✗ | ✗ | — |
| Feature visibility (hide/show) | ✓ | ✓ | ✗ | `visible?: boolean` on every feature type; toggled from feature tree |
| Sketch visibility (hide/show) | ✓ | ✓ | ✗ | `Sketch.visible?` (`types.ts:266`) with save/restore-around-edit (`onExitSketch` / `editSketch`) |
| Body visibility (hide/show) | ✓ | N/A | ✗ | Bodies panel in feature tree; `hiddenBodies` signal |
| Datum visibility (per-datum) | ✓ | ✓ | ✗ | `OriginFeature.visibility?` map + per-feature `visible?` for user datums |
| Face / body color | ✗ | ✗ | ✗ | All faces use the same shaded material |
| Materials (density / appearance) | ✗ | ✗ | ✗ | — |
| Tangent edges visible (display option) | ✓ | N/A | ✗ | Kernel `is_tangent` flag; viewer renders dashed-light (`cad-viewer.component.ts`) |
| Display modes — shaded / shaded-with-edges / wireframe / hidden-lines | ✓ | N/A | ✗ | `displayMode` input on the viewer |

## Export / interop

| Feature | Implemented | Automated test | Tested by user | Notes / source |
|---|---|---|---|---|
| STEP export | ✓ | ✓ | ✗ | Kernel `export.rs` `STEPControl_Writer`; `cad-model/controller.js` `exportStep` route + `cad-export-dialog` UI |
| STL export | ✓ | ✓ | ✗ | Kernel `export.rs` `write_stl_with_tolerance` (binary STL); same export dialog / download path |
| IGES export | ✗ | ✗ | ✗ | — |
| DXF export | ✗ | ✗ | ✗ | — |
| OBJ export | ✗ | ✗ | ✗ | — |
| 3MF export | ✗ | ✗ | ✗ | — |
| STEP / IGES import | ✗ | ✗ | ✗ | — |
| BRep persistence (internal) | ✓ | N/A | ✗ | `shape_io.rs` `serialize_brep` / `deserialize_brep_from_base64` round-trip through cache |

## Sheet metal (out of scope)

| Feature | Implemented | Automated test | Tested by user | Notes / source |
|---|---|---|---|---|
| Base flange | ✗ | N/A | ✗ | Sheet metal category not in 2026 plan |
| Edge flange | ✗ | N/A | ✗ | — |
| Miter flange | ✗ | N/A | ✗ | — |
| Hem | ✗ | N/A | ✗ | — |
| Jog | ✗ | N/A | ✗ | — |
| Sketched bend | ✗ | N/A | ✗ | — |
| Cross-break | ✗ | N/A | ✗ | — |
| Vent | ✗ | N/A | ✗ | — |
| Gusset | ✗ | N/A | ✗ | — |
| Forming tool | ✗ | N/A | ✗ | — |
| Unfold / fold | ✗ | N/A | ✗ | — |

## Surface modeling (out of scope)

| Feature | Implemented | Automated test | Tested by user | Notes / source |
|---|---|---|---|---|
| Extruded surface | ✗ | N/A | ✗ | Surface category not in 2026 plan |
| Revolved surface | ✗ | N/A | ✗ | — |
| Swept surface | ✗ | N/A | ✗ | — |
| Lofted surface | ✗ | N/A | ✗ | — |
| Boundary surface | ✗ | N/A | ✗ | — |
| Planar surface | ✗ | N/A | ✗ | — |
| Offset surface | ✗ | N/A | ✗ | — |
| Ruled surface | ✗ | N/A | ✗ | — |
| Fill surface | ✗ | N/A | ✗ | — |
| Knit surfaces | ✗ | N/A | ✗ | — |
| Untrim / extend | ✗ | N/A | ✗ | — |

## Assemblies and drawings (out of scope)

| Feature | Implemented | Automated test | Tested by user | Notes / source |
|---|---|---|---|---|
| Assembly (multi-part with mates) | ✓ | ✓ | ✗ | Shipped as a separate module (`DesignAssembly` + mate solver) — out of scope for THIS part-design doc; see `cad-system/assembly-feature-gap-analysis.md` |
| 2D drawing views | ✗ | N/A | ✗ | — |

## Special and cross-cutting

| Feature | Implemented | Automated test | Tested by user | Notes / source |
|---|---|---|---|---|
| Rollback bar (in feature tree) | ✓ | ✓ | ✗ | `rollbackBeforeIndex` signal; bar drag + right-click "Roll back to here"/"Roll forward" |
| Edit-time auto-rollback | ✓ | N/A | ✗ | Opening an Edit sidebar auto-drops bar so downstream features hide; cache rebuild on close. `editRollbackTarget` computed in `cad-editor.component.ts` |
| Equations (drive 3D feature params by expression) | ✓ | ✓ | ✗ | `equations.ts` resolver feeds extrude/revolve distances etc. |
| Multi-body composition | ✓ | ✓ | ✗ | `merge: false` produces a free-floating body; `decompose_into_solids` splits split-cuts; body roster in feature tree |
| Persistent face / edge naming across regen | ✓ | ✓ | ✗ | OCCT-side via `PersistentName` JSON id; survives renumbering after booleans |
| Cache invalidation cascade (downstream features re-eval on upstream change) | ✓ | ✓ | ✗ | `compose paramHash` includes `upstream: body.paramHash` (`cadRegenService.js`) |
| Sketch on origin datum plane | ✓ | ✓ | ✗ | `startSketchOnDatum` in `cad-editor.component.ts` |
| Sketch on flat face of existing body | ✓ | ✓ | ✗ | REQ 625; `startSketchOnFace` |
| Sketch on user-defined datum plane | ✓ | ✓ | ✗ | `startSketchOnDatum` falls back to `geometry.datums` sidecar; REQ 657 |
| Sketch on curved face | ✗ | ✗ | ✗ | Would need projected sketch support |
| Roll-back / forward animation | ✗ | ✗ | ✗ | — |
| Per-feature error indicator (red icon in tree) | ✓ | ✓ | ✗ | `mergedFeatureErrors` computed signal; kernel + user-datum errors merged |
| Per-feature parameter expressions (driven dimensions) | ✓ | ✓ | ✗ | Same `equations.ts` machinery as sketch dims |
| Undo / redo (history) | ✓ | ✓ | ✗ | `pushSnapshot` / `applySnapshot`; debounced capture in `cad-editor.component.ts` |
| Suppress feature | ✓ | ✓ | ✗ | `suppressed?: boolean` on extrude/revolve/sweep; kernel skips suppressed features |
| Feature rename | ✓ | ✓ | ✗ | `name?` on every feature type; rename action in feature tree context menu |

## Summary counts

- **Features (boss / cut)**: 18 ✓ / 0 ▲ / 7 ✗ — **18 of 25 implemented** (~72%)
- **Fillet and chamfer**: 9 ✓ / 0 ▲ / 9 ✗ — **9 of 18 implemented** (~50%)
- **Patterns**: 3 ✓ / 0 ▲ / 4 ✗ — **3 of 7 implemented** (~43%)
- **Body operations**: 4 ✓ / 1 ▲ / 4 ✗ — **4 of 9 implemented** (~44%)
- **Modifications**: 1 ✓ / 0 ▲ / 7 ✗ — **1 of 8 implemented** (~13%)
- **Reference geometry**: 21 ✓ / 0 ▲ / 2 ✗ — **21 of 23 implemented** (~91%)
- **Display and utilities**: 9 ✓ / 0 ▲ / 4 ✗ — **9 of 13 implemented** (~69%)
- **Export / interop**: 3 ✓ / 0 ▲ / 5 ✗ — **3 of 8 implemented** (~38%)
- **Sheet metal**: 0 ✓ / 0 ▲ / 11 ✗ — **out of scope**
- **Surface modeling**: 0 ✓ / 0 ▲ / 11 ✗ — **out of scope**
- **Assemblies / drawings**: 0 ✓ / 0 ▲ / 2 ✗ — **out of scope**
- **Special / cross-cutting**: 13 ✓ / 0 ▲ / 2 ✗ — **13 of 15 implemented** (~87%)
- **Combined (in-scope only)**: 81 ✓ / 1 ▲ / 36 ✗ — **81 of 118 implemented** (~69%)

What's left:

- **Highest leverage (each = one to a few sessions)**: draft, section view, variable-radius fillet, face fillet, split body, scale body. (Linear/circular pattern, mirror feature, shell, loft, user datum axes + points, STEP/STL export, combine, and hole wizard are now shipped.)
- **Heavy lifts (each = multi-session)**: drawing views, sheet metal, surface modeling, configurations / design tables, simulation. (Assembly + mates ship in the separate assembly module — see `cad-system/assembly-feature-gap-analysis.md`.)
- **OCCT wrapper extensions needed**: variable-radius fillet, face fillet, full-round fillet, vertex chamfer, asymmetric face chamfer, draft.

_Tested-by-user counts deliberately start at 0 — flip cells to ✓ as the project owner manually exercises each feature in the running app._
