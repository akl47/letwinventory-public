# CAD / Assembly / VCS Documentation

Full documentation for the browser-based parametric CAD system: the **CAD modeler**, the **Rust/OCCT geometry kernel**, the content-addressed **version-control system**, and the **assembly** module — plus the architecture that unifies them.

The docs are layered in three tiers of increasing detail. Start at the [System Overview](./00-overview.md) and drill down. For requirement traceability, see the [Requirements Coverage Matrix](./requirements-coverage.md) — every REQ 512–769 mapped to its documentation page.

Every page follows one template: linked **requirements** (a table of all, full Description / Rationale / Verification / Validation for the defining ones), a **succinct** description, a **non-technical** "how it works," a **detailed technical** "how it works" (with Mermaid diagrams), and a **key files** list. All requirements are REQ 512–769 (CAD category 37, root REQ 512), currently `unapproved`.

---

## Tier 1 — Coarse (one doc per subsystem)

| Doc | What it covers |
|-----|----------------|
| [00 · System Overview](./00-overview.md) | The whole system and how the four subsystems fit together |
| [10 · CAD Modeler](./10-cad-modeler.md) | Sketching, 2D solver, feature tree, equations, measurement, editor/viewer |
| [20 · Geometry Kernel](./20-kernel.md) | Rust/OCCT kernel: ops, protocol, tessellation, naming, surface classification |
| [30 · Version Control](./30-vcs.md) | Content-addressed store, working copy, branches, workflow, freeze, release, diff, merge |
| [40 · Assembly](./40-assembly.md) | Instances, mate solver, patterns, visualization, analysis, BOM, export |
| [50 · Architecture](./50-architecture.md) | The "written once" VCS bindings, data model, API/route surface |

## Tier 2 — Feature groups

### [cad-modeler/](./cad-modeler/00-overview.md)
- [Sketching](./cad-modeler/sketching.md) · [Constraints](./cad-modeler/constraints.md) · [Datums & planes](./cad-modeler/datums-planes.md) · [Profiles & arrangement](./cad-modeler/profiles-arrangement.md) · [Feature tree](./cad-modeler/feature-tree.md) · [Extrude / Revolve / Sweep](./cad-modeler/extrude-revolve-sweep.md) · [Fillet / Chamfer / Shell / Pattern](./cad-modeler/fillet-chamfer-shell-pattern.md) · [Holes](./cad-modeler/holes.md) · [Equations](./cad-modeler/equations.md) · [Multi-body](./cad-modeler/multi-body.md) · [Measurement](./cad-modeler/measurement.md) · [Units / IDs / Migration](./cad-modeler/units-ids-migration.md)

### [kernel/](./kernel/00-overview.md)
- [RPC server & protocol](./kernel/rpc-server-protocol.md) · [Operations](./kernel/operations.md) · [Shape I/O & tessellation](./kernel/shape-io-tessellation.md) · [Surface classification](./kernel/surface-classification.md) · [Persistent naming](./kernel/persistent-naming.md) · [Export (STEP/IGES/STL)](./kernel/export-step-iges-stl.md)

### [cad-runtime/](./cad-runtime/00-overview.md)
- [Regen pipeline](./cad-runtime/regen-pipeline.md) · [Viewer & rendering](./cad-runtime/viewer-rendering.md) · [Editor UI](./cad-runtime/editor-ui.md)

### [vcs/](./vcs/00-overview.md)
- [Content-addressed store](./vcs/content-addressed-store.md) · [Working copy (checkout/checkin)](./vcs/working-copy-checkout-checkin.md) · [Branches](./vcs/branches.md) · [Workflow & review](./vcs/workflow-review.md) · [Freeze geometry](./vcs/freeze-geometry.md) · [Release & revisions](./vcs/release-revisions.md) · [Diff & compare](./vcs/diff-compare.md) · [Merge & reconcile](./vcs/merge-reconcile.md) · [History graph](./vcs/history-graph.md)

### [assembly/](./assembly/00-overview.md)
- [Instances & placement](./assembly/instances-placement.md) · [Mates & solver](./assembly/mates-solver.md) · [Patterns / mirror / subassemblies](./assembly/patterns-mirror-subassemblies.md) · [Visualization](./assembly/visualization.md) · [Analysis](./assembly/analysis.md) · [BOM & sync](./assembly/bom-sync.md) · [Export](./assembly/export.md)

### [architecture/](./architecture/00-overview.md)
- [Unified VCS bindings](./architecture/unified-vcs-bindings.md) · [Data model](./architecture/data-model.md) · [API & routes](./architecture/api-and-routes.md)

## Tier 3 — Per-module

One doc per implementing source module, filed under each group's `modules/` folder (e.g. `cad-modeler/modules/solver.md`, `vcs/modules/canonicalJson.md`, `assembly/modules/assemblyMateSolver.md`). Each Tier-2 group page links its modules at the bottom. The full module inventory is listed in the [build plan](../../.claude/plans/) and tracked per group page.

---

## Requirement map (subsystem → REQ range)

| Subsystem | REQ range | Notes |
|-----------|-----------|-------|
| CAD modeler | 512–667 | sketching/constraints 521–606; features/extrude 545–667; rendering 513–520, 620; equations 634–641; measure 652–656; datums/patterns/holes 657–667 |
| Version control | 668–747 | store 668–676; working copy 677–691; branches 692–698; diff 699–702, 713–714; workflow 703–707; freeze/release 715–724; trunk/branch model 730–747 |
| Assembly | 748–769 | solver 748, 755–757; surface 749; model/instances 750–754, 758–759; patterns/subassembly 760–763; visualization 764–766; analysis/BOM 767–769 |

Source of truth: `node scripts/req.js tree /tmp/reqtree.json 37`. DesignFeature linkage: DF 35 = CAD modeler, DF 38 = cad-vcs.
