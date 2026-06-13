# Assembly Feature Gap Analysis

A survey of assembly-level capabilities across the four mainstream parametric CAD
systems — SolidWorks (**SW**), Siemens NX (**NX**), Onshape, and Autodesk Fusion —
mapped against what this app's CAD/assembly module currently implements.

**Legend**

| Mark | Tool columns (SW/NX/Onshape/Fusion) | This-app column |
|---|---|---|
| ✓ | full first-class support | implemented |
| ◐ | partial / workaround / add-on | partial — see note |
| ✗ | — | not yet implemented |
| – | not applicable / not offered | – |

The this-app column reflects what is actually reachable through the **frontend UI**,
verified against `cad-editor.component.ts` and `assembly-edit.controller.ts` — not merely
what `frontend/src/app/cad/lib/assembly.types.ts` declares. Several mate/feature types are
present in the data model and solver but have no working UI affordance; those are marked ◐
or ✗ with the reason, not ✓.

---

## At a glance

Solid on the **static assembly core** — component insert/replace/ground, linear/circular/
mirror patterns, explode, display states, STEP/STL export, interference, and mass
properties (volume + centroid). Plus a first cut of in-context cross-part references.

**Reality check on mates:** only **coincident, distance, angle, lock** have a confirmed
end-to-end UI path (button → pick two faces → type chip → create, solver-tested). The other
four declared types — **concentric, parallel, perpendicular, tangent** — have solver math
but their chips only surface when the backend tags faces with `surface.kind`
(`plane`/`cylinder`), which is unverified and mostly untested. They are *not* reliably
creatable today.

The clusters still missing:

- **Advanced / coupling mates** — gear, cam, screw, path (coupled DOF).
- **Kinematics** — interactive free-drag, motion study, DOF visualization.
- **Content & appearance** — standard-hardware library, per-instance color, configurations.
- **2D documentation** — assembly drawings, balloons, BOM tables on sheets.

Cheapest high-impact wins: harden the **concentric/parallel/perpendicular/tangent** mates
(make `surface.kind` reliable + test them), the **width / limit / symmetric mate** batch,
**SmartMate-on-insert**, **per-instance appearance**, and **clearance / min-distance** check.

---

## Mates & relationships

| Feature | SW | NX | Onshape | Fusion | This app | Note |
|---|---|---|---|---|---|---|
| Coincident | ✓ | ✓ | ✓ | ✓ | ✓ | UI + solver test |
| Distance | ✓ | ✓ | ✓ | ✓ | ✓ | UI (value field) + solver test |
| Angle | ✓ | ✓ | ✓ | ✓ | ✓ | UI (value field) + solver |
| Lock / fixed | ✓ | ✓ | ✓ | ✓ | ✓ | UI (always offered) + solver test |
| Concentric | ✓ | ✓ | ✓ | ✓ | ◐ | solver coded+tested; chip only shows if backend tags cylinder faces — unverified |
| Parallel | ✓ | ✓ | ✓ | ✓ | ◐ | solver coded, untested; chip needs `surface.kind='plane'` — unverified |
| Perpendicular | ✓ | ✓ | ✓ | ✓ | ◐ | solver coded, untested; chip needs `surface.kind='plane'` — unverified |
| Tangent | ✓ | ✓ | ✓ | ✓ | ◐ | solver coded, untested; chip needs cylinder+plane faces — unverified |
| Width / center mate | ✓ | ✓ | ✓ | ✓ | ✗ | easy residual, high use |
| Symmetric mate | ✓ | ✓ | ✓ | ◐ | ✗ | easy |
| Limit mates (min–max range) | ✓ | ✓ | ✓ | ✓ | ✗ | easy, big UX win |
| Slot mate (pin-in-slot) | ✓ | ✓ | ✓ | ✓ | ✗ | moderate |
| Profile-center mate | ✓ | ✓ | ✓ | ◐ | ✗ | moderate |
| Path mate (follow curve) | ✓ | ✓ | ✓ | ◐ | ✗ | hard (path param) |
| Gear mate | ✓ | ✓ | ✓ | ✓ | ✗ | hard (coupled DOF) |
| Rack & pinion | ✓ | ✓ | ✓ | ✓ | ✗ | hard |
| Screw / helical | ✓ | ✓ | ✓ | ✓ | ✗ | hard |
| Cam / cam-follower | ✓ | ✓ | ◐ | ◐ | ✗ | hard |
| Hinge / universal / coupler | ✓ | ✓ | ◐ | ◐ | ✗ | moderate (combos) |
| Mate references / SmartMates (auto-mate on insert) | ✓ | ✓ | ✓ | ✓ | ✗ | moderate, high UX |
| Suppress mate | ✓ | ✓ | ✓ | ✓ | ◐ | data model has `suppressed`; UI TBD |

## Component patterns

| Feature | SW | NX | Onshape | Fusion | This app | Note |
|---|---|---|---|---|---|---|
| Linear pattern | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Circular pattern | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Mirror component | ✓ | ✓ | ✓ | ✓ | ◐ | mesh mirrored; export carries un-reflected BRep |
| Pattern-driven (follow a feature pattern) | ✓ | ✓ | ✓ | ✓ | ✗ | moderate |
| Sketch-driven (place at sketch points) | ✓ | ✓ | ✓ | ✓ | ✗ | moderate |
| Curve-driven / chain / table-driven | ✓ | ◐ | ◐ | ◐ | ✗ | niche |

## Component management

| Feature | SW | NX | Onshape | Fusion | This app | Note |
|---|---|---|---|---|---|---|
| Insert / replace component | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Ground / fix component | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Hide / show component | ✓ | ✓ | ✓ | ✓ | ✓ | eye toggle wired to `visible` flag |
| Suppress component | ✓ | ✓ | ✓ | ✓ | ✗ | `suppressed` flag in model has no UI; only the visible toggle is wired |
| Subassemblies (nesting) | ✓ | ✓ | ✓ | ✓ | ◐ | model has `ref.kind:'assembly'`; no UI to nest or indicate one |
| Flexible subassemblies | ✓ | ✓ | ✓ | ✓ | ✗ | nesting itself isn't surfaced yet — moderate |
| Per-instance appearance / color / transparency | ✓ | ✓ | ✓ | ✓ | ✗ | deferred — easy–moderate |
| Standard-hardware library (Toolbox / Fastener) | ✓ | ✓ | ✓ | ✓ | ✗ | high value, ties to parts DB |
| Configurations / arrangements / positional states | ✓ | ✓ | ✓ | ◐ | ✗ | moderate |
| Envelope / reference / virtual components | ✓ | ✓ | ◐ | ◐ | ✗ | niche |
| Lightweight / large-assembly mode | ✓ | ✓ | ✓ | ◐ | ✗ | not needed at current scale |

## Top-down & assembly features

| Feature | SW | NX | Onshape | Fusion | This app | Note |
|---|---|---|---|---|---|---|
| In-context cross-part references | ✓ | ✓ | ✓ | ✓ | ◐ | sketch projection built; holes/datums/dims next |
| Assembly-level features (cut/hole across components) | ✓ | ✓ | ✓ | ✓ | ✗ | moderate |
| Layout sketch / block-based top-down | ✓ | ✓ | ◐ | ◐ | ✗ | moderate |
| Form / dissolve subassembly, promote/demote | ✓ | ✓ | ✓ | ✓ | ✗ | easy–moderate (tree ops) |

## Kinematics / motion

| Feature | SW | NX | Onshape | Fusion | This app | Note |
|---|---|---|---|---|---|---|
| Solve mates to position components | ✓ | ✓ | ✓ | ✓ | ✓ | LM solver on save |
| Constraint status (under/fully/over + DOF) | ✓ | ✓ | ✓ | ◐ | ✓ | |
| Interactive free-drag with live solve | ✓ | ✓ | ✓ | ✓ | ◐ | warm-start exists, not wired to drag |
| DOF visualization (handles / arrows) | ✓ | ✓ | ✓ | ✓ | ✗ | moderate |
| Collision detection while dragging | ✓ | ✓ | ✓ | ✓ | ✗ | hard |
| Motion study / animation | ✓ | ✓ | ✓ | ✓ | ✗ | large |
| Dynamics sim (motors / springs / forces) | ✓ | ✓ | ◐ | ✓ | ✗ | likely out of scope |

## Visualization & documentation

| Feature | SW | NX | Onshape | Fusion | This app | Note |
|---|---|---|---|---|---|---|
| Exploded view | ✓ | ✓ | ✓ | ✓ | ✓ | auto-explode + offsets |
| Display states (saved show/hide) | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Section view | ✓ | ✓ | ✓ | ✓ | ◐ | axis/position controls wired; viewer-side clipping unconfirmed |
| Bill of materials | ✓ | ✓ | ✓ | ✓ | ◐ | computed + `Sync BOM` to inventory works; no BOM panel in the editor |
| STEP / STL export | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Explode-line sketch (3D route lines) | ✓ | ✓ | ✓ | ✓ | ✗ | moderate |
| Auto-balloon / 3D balloons | ✓ | ✓ | ✓ | ✓ | ✗ | moderate |
| 2D assembly drawings (views + BOM + balloons) | ✓ | ✓ | ✓ | ✓ | ✗ | large, separate subsystem |
| Materials / render appearances | ✓ | ✓ | ✓ | ✓ | ✗ | low priority |

## Analysis & diagnostics

| Feature | SW | NX | Onshape | Fusion | This app | Note |
|---|---|---|---|---|---|---|
| Interference detection | ✓ | ✓ | ✓ | ✓ | ✓ | AABB + boolean common |
| Mass properties | ✓ | ✓ | ✓ | ✓ | ◐ | volume + centroid; no inertia tensor |
| Center-of-gravity marker | ✓ | ✓ | ✓ | ✓ | ◐ | computed, not displayed |
| Over-defined diagnosis (which mate conflicts) | ✓ | ✓ | ✓ | ◐ | ◐ | global state only, no per-mate isolation |
| Clearance / minimum-distance check | ✓ | ✓ | ✓ | ✓ | ✗ | needs a kernel `BRepExtrema` op |
| Hole-alignment check | ✓ | ◐ | – | – | ✗ | niche |
| Motion collision detection | ✓ | ✓ | ✓ | ✓ | ✗ | depends on interactive drag |

---

## Suggested next batch (by value / effort)

1. **Harden the four declared-but-shaky mates** — make `surface.kind` reliably populated by
   regen (plane/cylinder), add solver tests, and confirm the chips appear so
   concentric/parallel/perpendicular/tangent are actually usable. Cheapest path to "8 mates".
2. **Width / limit / symmetric mates** — small solver additions, common in real assemblies.
3. **SmartMate-on-insert** (mate references) — large UX win, moderate effort.
4. **Per-instance appearance** — color/transparency per instance, easy–moderate.
5. **Clearance / minimum-distance check** — needs a `BRepExtrema` kernel op; pairs with interference.
6. **Finish the partials** — assembly-level suppress UI, subassembly nesting UI, a BOM panel,
   confirm/wire section clipping in the viewer, mirror-component BRep reflection, CoG 3D marker,
   inertia tensor, per-mate over-defined isolation, drag-wired warm-start.
