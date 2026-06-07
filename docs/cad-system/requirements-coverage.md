# Requirements Coverage Matrix

> **System** ▸ [Overview](./00-overview.md) ▸ **Requirements Coverage**
> Master index: [README](./README.md)

Every CAD/Assembly/VCS requirement (REQ 512–769, category 37, all currently `unapproved`) and the documentation page(s) that cover it. Source of truth: `node scripts/req.js tree /tmp/reqtree.json 37`. Rows marked *(prose)* are described narratively in the listed page even though the page's requirement table uses range notation. Full Description / Rationale / Verification / Validation for each defining requirement live on its owning feature page.


## CAD Modeler (512–667)

| REQ | Status | Summary | Primary doc(s) |
|-----|--------|---------|----------------|
| 512 | unapproved | The system shall provide a parametric 3D CAD modeling capability attached to each Part rec | `10-cad-modeler.md`<br>`README.md` |
| 513 | unapproved | When a CAD model is loaded into the active editor session, the CAD module shall render the | `cad-runtime/viewer-rendering.md`<br>`cad-runtime/modules/cad-viewer.md` |
| 514 | unapproved | The CAD module shall rotate the view camera around a focal point on the displayed model in | `cad-runtime/viewer-rendering.md`<br>`cad-runtime/modules/cad-viewer.md` |
| 515 | unapproved | The CAD module shall translate the view camera in the plane perpendicular to its current v | `cad-runtime/viewer-rendering.md`<br>`cad-runtime/modules/cad-viewer.md` |
| 516 | unapproved | The CAD module shall increase or decrease the view camera's distance to the displayed mode | `cad-runtime/viewer-rendering.md`<br>`cad-runtime/modules/cad-viewer.md` |
| 517 | unapproved | The CAD module shall assign each face of a rendered solid a unique identifier that remains | `20-kernel.md`<br>`kernel/modules/naming.md` |
| 518 | unapproved | The CAD module shall visually distinguish the face under the pointer from all other faces  | `10-cad-modeler.md`<br>`cad-runtime/viewer-rendering.md` |
| 519 | unapproved | When the user activates the primary pointer button while the pointer is over a face, the C | `10-cad-modeler.md`<br>`cad-runtime/viewer-rendering.md` |
| 520 | unapproved | The CAD module shall render the selected face with a visual style that is distinguishable  | `10-cad-modeler.md`<br>`cad-runtime/viewer-rendering.md` |
| 521 | unapproved | The CAD module shall provide a 2D sketching environment in which the user can place geomet | `10-cad-modeler.md`<br>`cad-modeler/sketching.md` |
| 522 | unapproved | The CAD module shall create a sketch point at a 2D location specified by the user. | `cad-modeler/sketching.md`<br>`cad-modeler/modules/store.md` |
| 523 | unapproved | The CAD module shall create a sketch line segment between two 2D endpoint locations specif | `cad-modeler/sketching.md`<br>`cad-modeler/modules/store.md` |
| 524 | unapproved | The CAD module shall support the following constraint types between sketch primitives: coi | `10-cad-modeler.md`<br>`cad-modeler/constraints.md` |
| 525 | unapproved | When a sketch primitive's position or a constraint parameter is updated, the CAD module sh | `cad-modeler/constraints.md`<br>`cad-modeler/modules/solver.md` |
| 526 | unapproved | When the user attempts to apply a constraint that yields an inconsistent constraint system | `cad-modeler/constraints.md`<br>`cad-modeler/modules/solver.md` |
| 527 | unapproved | When the user activates the primary pointer button while the pointer is over a sketch prim | `cad-modeler/modules/picking.md` |
| 528 | unapproved | The CAD module shall render the selected sketch primitive with a visual style that is dist | `cad-modeler/sketching.md` *(prose)* |
| 529 | unapproved | While a selected sketch primitive has at least one degree of freedom, the CAD module shall | `cad-modeler/sketching.md` *(prose)* |
| 530 | unapproved | When the user invokes a delete action on a selected sketch entity, the CAD module shall re | `cad-modeler/modules/store.md` |
| 531 | unapproved | The CAD module shall reposition the sketch view in response to user-issued pan and zoom co | `cad-runtime/viewer-rendering.md` *(prose)* |
| 532 | unapproved | When the CAD module rejects a constraint due to an inconsistent constraint system, it shal | `cad-modeler/constraints.md`<br>`cad-modeler/modules/errorMessages.md` |
| 533 | unapproved | The CAD module shall render under-constrained sketch primitives in a visual style distingu | `10-cad-modeler.md`<br>`cad-modeler/constraints.md` |
| 534 | unapproved | The CAD module shall associate each sketch with a planar host (a planar face of a 3D solid | `cad-modeler/datums-planes.md`<br>`cad-modeler/modules/document.md` |
| 535 | unapproved | When the user invokes the create-sketch action while exactly one planar host (a planar fac | `cad-modeler/datums-planes.md`<br>`cad-modeler/modules/document.md` |
| 536 | unapproved | When the user invokes the create-sketch action against a non-planar face, the CAD module s | `cad-modeler/datums-planes.md`<br>`cad-modeler/00-overview.md` |
| 537 | unapproved | While a sketch is active, the CAD module shall orient the view camera to view the sketch's | `cad-runtime/viewer-rendering.md` *(prose)* |
| 538 | unapproved | The CAD module shall maintain at most one active sketch at any time, and when the user exi | `cad-modeler/sketching.md` *(prose)* |
| 539 | unapproved | When the user is not in active sketching mode, the CAD module shall render the geometric p | `cad-runtime/viewer-rendering.md` *(prose)* |
| 540 | unapproved | When the user invokes the create-sketch action while a host that already carries a sketch  | `cad-modeler/sketching.md` *(prose)* |
| 541 | unapproved | While a sketch is active, the CAD module shall render the host solid's geometry in the ske | `cad-runtime/viewer-rendering.md` *(prose)* |
| 542 | unapproved | When a sketch is created on a host attached to a 3D solid, the CAD module shall compute an | `cad-modeler/modules/document.md` |
| 543 | unapproved | During point placement or line-endpoint placement, when the pointer is within snap toleran | `cad-modeler/modules/document.md`<br>`cad-modeler/modules/inference.md` |
| 544 | unapproved | The CAD module shall prevent the user from dragging, moving, or deleting a reference primi | `cad-modeler/sketching.md` *(prose)* |
| 545 | unapproved | The CAD module shall maintain an ordered list of features that produces the model's 3D geo | `10-cad-modeler.md`<br>`cad-modeler/feature-tree.md` |
| 546 | unapproved | When a CAD model is created with no features, the CAD module shall initialize it with exac | `cad-modeler/feature-tree.md`<br>`cad-modeler/modules/featureTree.md` |
| 547 | unapproved | When a feature is added, removed, or has any of its parameters modified, the CAD module sh | `cad-modeler/feature-tree.md`<br>`cad-runtime/regen-pipeline.md` |
| 548 | unapproved | Given a sketch, the CAD module shall extract a single closed loop of connected line segmen | `cad-modeler/modules/profile.md`<br>`cad-runtime/modules/cadProfile.md` |
| 549 | unapproved | The CAD module shall provide an extrude feature that takes a sketch reference and a positi | `20-kernel.md`<br>`10-cad-modeler.md` |
| 550 | unapproved | While a sketch is active and contains a valid extractable profile, the user may invoke an  | `cad-modeler/extrude-revolve-sweep.md`<br>`cad-modeler/00-overview.md` |
| 551 | unapproved | The CAD module shall persist a CAD model's feature tree and sketch document to the server  | `architecture/modules/designCADModelHistory.md` |
| 552 | unapproved | Each CAD model shall be associated with exactly one Part record by a part identifier, and  | `architecture/data-model.md`<br>`architecture/modules/designCADModel.md` |
| 553 | unapproved | When the user requests a new revision of a released CAD model, the system shall create a n | `vcs/release-revisions.md` *(prose)* |
| 554 | unapproved | Each CAD model shall progress through a releaseState lifecycle of draft → review → release | `vcs/release-revisions.md` *(prose)* |
| 555 | unapproved | When a CAD model's releaseState is not 'draft', the CAD module shall reject any modificati | `vcs/working-copy-checkout-checkin.md` *(prose)* |
| 556 | unapproved | The CAD module shall gate access to CAD model data and operations by a 'cad' permission re | `50-architecture.md`<br>`architecture/api-and-routes.md` |
| 557 | unapproved | The system shall allow soft deletion (activeFlag=false) of a CAD model only while its rele | `vcs/release-revisions.md` *(prose)* |
| 558 | unapproved | The CAD module shall solve sketch constraint systems using a Newton-Raphson 2D geometric c | `10-cad-modeler.md`<br>`cad-modeler/constraints.md` |
| 559 | unapproved | The CAD module shall represent every sketch primitive — point, line, circle, arc, ellipse, | `10-cad-modeler.md`<br>`cad-modeler/sketching.md` |
| 560 | unapproved | Every SketchEntity shall carry an optional construction boolean flag. Entities with constr | `10-cad-modeler.md`<br>`cad-modeler/sketching.md` |
| 561 | unapproved | Sketch constraint targets shall be entity references of the form { entityId: string; sub?: | `10-cad-modeler.md`<br>`cad-modeler/sketching.md` |
| 562 | unapproved | The CAD module shall convert curved sketch entities into polyline approximations using a c | `cad-modeler/sketching.md`<br>`cad-modeler/modules/units.md` |
| 563 | unapproved | The sketch renderer shall draw curved entities (circles, arcs, ellipses, elliptical arcs,  | `cad-modeler/sketching.md`<br>`cad-modeler/00-overview.md` |
| 564 | unapproved | The sketch picker shall hit-test curved entities against their parametric definition (clos | `cad-modeler/sketching.md`<br>`cad-modeler/modules/picking.md` |
| 565 | unapproved | When the CAD module loads a sketch document persisted under the prior { points, lines, con | `cad-modeler/sketching.md`<br>`cad-modeler/modules/migration.md` |
| 566 | unapproved | The sketcher shall provide a Circle (center + radius) tool: the user picks a center point  | `cad-modeler/sketching.md`<br>`cad-modeler/modules/store.md` |
| 567 | unapproved | The sketcher shall provide a Circle (3-point) tool: the user picks three points and the re | `cad-modeler/sketching.md`<br>`cad-runtime/modules/cad-sketch-editor.md` |
| 568 | unapproved | The sketcher shall provide a Circle (tangent) tool: the user picks two existing entities ( | `cad-modeler/sketching.md`<br>`cad-runtime/modules/cad-sketch-editor.md` |
| 569 | unapproved | The sketcher shall provide an Arc (center + endpoints) tool: the user picks a center, then | `cad-modeler/sketching.md`<br>`cad-modeler/modules/store.md` |
| 570 | unapproved | The sketcher shall provide an Arc (3-point) tool: the user picks a start point, an end poi | `cad-modeler/sketching.md`<br>`cad-runtime/modules/cad-sketch-editor.md` |
| 571 | unapproved | The sketcher shall provide an Arc (tangent) tool: with one existing edge selected, the use | `cad-modeler/sketching.md`<br>`cad-runtime/modules/cad-sketch-editor.md` |
| 572 | unapproved | The sketcher shall provide a Rectangle (corner-corner) tool: the user picks two opposite c | `cad-modeler/sketching.md`<br>`cad-runtime/modules/cad-sketch-editor.md` |
| 573 | unapproved | The sketcher shall provide a Rectangle (center-corner) tool: the user picks a center point | `cad-modeler/sketching.md`<br>`cad-runtime/modules/cad-sketch-editor.md` |
| 574 | unapproved | The sketcher shall provide a Rectangle (3-point) tool: the user picks two points defining  | `cad-modeler/sketching.md`<br>`cad-runtime/modules/cad-sketch-editor.md` |
| 575 | unapproved | The sketcher shall provide a Regular Polygon tool: the user specifies the number of sides  | `cad-modeler/sketching.md`<br>`cad-runtime/modules/cad-sketch-editor.md` |
| 576 | unapproved | The sketcher shall provide an Ellipse tool: the user picks the center, a major-axis endpoi | `cad-modeler/sketching.md`<br>`cad-runtime/modules/cad-sketch-editor.md` |
| 577 | unapproved | The sketcher shall provide an Elliptical Arc tool: the user picks the center, major-axis e | `cad-modeler/sketching.md`<br>`cad-runtime/modules/cad-sketch-editor.md` |
| 578 | unapproved | The sketcher shall provide a Straight Slot tool: the user picks two endpoint centers defin | `cad-modeler/sketching.md`<br>`cad-runtime/modules/cad-sketch-editor.md` |
| 579 | unapproved | The sketcher shall provide an Arc Slot tool: the user picks an arc center, two arc endpoin | `cad-modeler/sketching.md`<br>`cad-runtime/modules/cad-sketch-editor.md` |
| 580 | unapproved | The sketcher shall provide a Center-Point Slot tool: the user picks a center, an endpoint  | `cad-modeler/sketching.md`<br>`cad-runtime/modules/cad-sketch-editor.md` |
| 581 | unapproved | The sketcher shall provide a 3-Point Slot tool: the user picks two endpoint centers and a  | `cad-modeler/sketching.md`<br>`cad-runtime/modules/cad-sketch-editor.md` |
| 582 | unapproved | The sketcher shall support a Perpendicular constraint between two line entities (or betwee | `cad-modeler/constraints.md`<br>`cad-modeler/modules/constraintIcons.md` |
| 583 | unapproved | The sketcher shall support a Parallel constraint between two line entities (or between a l | `cad-modeler/constraints.md`<br>`cad-modeler/modules/constraintIcons.md` |
| 584 | unapproved | The sketcher shall support a Tangent constraint between any two entities where tangency is | `cad-modeler/constraints.md`<br>`cad-modeler/modules/constraintIcons.md` |
| 585 | unapproved | The sketcher shall support an Equal constraint that equates a measurable scalar between tw | `cad-modeler/constraints.md`<br>`cad-modeler/modules/constraintIcons.md` |
| 586 | unapproved | The sketcher shall support a Symmetric constraint between two points (or two like entities | `cad-modeler/constraints.md`<br>`cad-modeler/modules/constraintIcons.md` |
| 587 | unapproved | The sketcher shall support a Midpoint constraint that places a point coincident with the m | `cad-modeler/constraints.md`<br>`cad-modeler/modules/constraintIcons.md` |
| 588 | unapproved | The sketcher shall support a Concentric constraint between two entities with a defined cen | `cad-modeler/constraints.md`<br>`cad-modeler/modules/constraintIcons.md` |
| 589 | unapproved | The sketcher shall support a Collinear constraint between two line entities, enforcing tha | `cad-modeler/constraints.md`<br>`cad-modeler/modules/constraintIcons.md` |
| 590 | unapproved | The sketcher shall support a Radius dimension constraint on a circle or arc entity, with a | `cad-modeler/constraints.md`<br>`cad-modeler/modules/dimensions.md` |
| 591 | unapproved | The sketcher shall support a Diameter dimension constraint on a circle or arc entity, with | `cad-modeler/constraints.md`<br>`cad-modeler/modules/dimensions.md` |
| 592 | unapproved | The sketcher shall support an Angle dimension constraint between two line entities (or bet | `cad-modeler/constraints.md`<br>`cad-modeler/modules/dimensions.md` |
| 593 | unapproved | The sketcher shall support a Horizontal Distance dimension constraint between two points,  | `cad-modeler/constraints.md`<br>`cad-modeler/modules/dimensions.md` |
| 594 | unapproved | The sketcher shall support a Vertical Distance dimension constraint between two points, dr | `cad-modeler/constraints.md`<br>`cad-modeler/modules/dimensions.md` |
| 595 | unapproved | The sketcher shall support a Point-on-Curve constraint that constrains a point to lie on t | `cad-modeler/constraints.md`<br>`cad-runtime/modules/cad-sketch-editor.md` |
| 596 | unapproved | The sketcher shall support a Block constraint that groups multiple entities into a rigid u | `cad-modeler/constraints.md`<br>`cad-runtime/modules/cad-sketch-editor.md` |
| 597 | unapproved | The sketcher shall support a Merge operation that fuses two distinct sketch points into a  | `cad-modeler/constraints.md`<br>`cad-runtime/modules/cad-sketch-editor.md` |
| 598 | unapproved | The sketcher shall provide a B-Spline tool: the user picks a sequence of control points, p | `cad-modeler/sketching.md`<br>`cad-runtime/modules/cad-sketch-editor.md` |
| 599 | unapproved | The sketcher shall provide a Fit Spline tool: the user picks a sequence of interpolation p | `cad-modeler/sketching.md`<br>`cad-runtime/modules/cad-sketch-editor.md` |
| 600 | unapproved | The sketcher shall provide a Parabola tool: the user picks a focus, a vertex, and an endpo | `cad-modeler/sketching.md`<br>`cad-runtime/modules/cad-sketch-editor.md` |
| 601 | unapproved | The sketcher shall provide a Hyperbola tool: the user picks two foci, a vertex, and an end | `cad-modeler/sketching.md`<br>`cad-runtime/modules/cad-sketch-editor.md` |
| 602 | unapproved | The sketcher shall provide a Text tool: the user picks an anchor point, types a text strin | `cad-modeler/sketching.md`<br>`cad-modeler/modules/textGlyphs.md` |
| 603 | unapproved | The sketcher shall provide an Image (sketch picture) tool: the user picks an anchor point  | `cad-modeler/sketching.md`<br>`cad-runtime/modules/cad-sketch-editor.md` |
| 604 | unapproved | The sketcher shall provide an Equation Curve tool: the user supplies parametric equations  | `cad-modeler/sketching.md`<br>`cad-runtime/modules/cad-sketch-editor.md` |
| 605 | unapproved | The sketcher shall support a Pierce constraint that constrains a point in the active sketc | `cad-modeler/sketching.md`<br>`cad-runtime/modules/cad-sketch-editor.md` |
| 606 | unapproved | The sketcher shall support a Curvature Continuity constraint between two curve entities sh | `cad-modeler/sketching.md`<br>`cad-runtime/modules/cad-sketch-editor.md` |
| 607 | unapproved | The user shall be able to delete an existing Extrude feature from the feature tree via a c | `cad-modeler/feature-tree.md`<br>`cad-modeler/modules/featureTree.md` |
| 608 | unapproved | The user shall be able to delete a sketch from the active CAD document. If one or more Ext | `cad-modeler/modules/featureTree.md`<br>`cad-runtime/modules/cad-feature-tree-panel.md` |
| 609 | unapproved | The user shall be able to edit the distance parameter of an existing Extrude feature via a | `cad-modeler/feature-tree.md`<br>`cad-modeler/extrude-revolve-sweep.md` |
| 610 | unapproved | Every non-Origin Feature shall carry an optional visible boolean flag (default true). When | `cad-modeler/feature-tree.md`<br>`cad-modeler/modules/featureTree.md` |
| 611 | unapproved | Feature tree rows (both feature rows and sketch rows) shall expose a right-click context m | `cad-modeler/feature-tree.md`<br>`cad-runtime/modules/cad-feature-tree-panel.md` |
| 612 | unapproved | The profile-extraction algorithm shall produce a valid extrude profile when the sketch con | `kernel/operations.md`<br>`kernel/modules/protocol.md` |
| 613 | unapproved | While the sketcher Select tool is active, the user shall be able to press and drag the pri | `cad-modeler/sketching.md` *(prose)* |
| 614 | unapproved | Every Sketch shall carry an optional visible boolean flag (default true). The flag persist | `cad-modeler/modules/document.md` |
| 615 | unapproved | The 3D viewer shall render every sketch whose visible flag is not false as a 2D overlay on | `cad-runtime/viewer-rendering.md` |
| 616 | unapproved | The top of the CAD editor shall present a tabbed toolbar (ribbon) similar to SolidWorks an | `10-cad-modeler.md`<br>`cad-modeler/sketching.md` |
| 617 | unapproved | The profile-extraction algorithm shall produce a typed ProfileLoop preserving curve identi | `10-cad-modeler.md`<br>`kernel/modules/ops-extrude.md` |
| 618 | unapproved | The Extrude feature shall carry an optional flipped boolean (default false). The extrude d | `kernel/modules/ops-extrude.md`<br>`cad-modeler/modules/preview.md` |
| 619 | unapproved | When an Extrude feature is created from a sketch, the system shall automatically set that  | `cad-modeler/extrude-revolve-sweep.md` |
| 620 | unapproved | The 3D viewer shall provide six display modes the user can toggle: (1) Wireframe — all edg | `10-cad-modeler.md`<br>`cad-runtime/viewer-rendering.md` |
| 621 | unapproved | Sketches may contain multiple independent closed loops (e.g., a separate circle and triang | `cad-modeler/multi-body.md`<br>`kernel/modules/ops-extrude.md` |
| 622 | unapproved | The feature-tree panel shall collapse the Origin feature group by default so the datum-ele | `cad-modeler/feature-tree.md`<br>`cad-runtime/modules/cad-feature-tree-panel.md` |
| 623 | unapproved | The 3D viewer shall report feature-level click events. The cad-editor shall maintain a set | `cad-runtime/viewer-rendering.md` *(prose)* |
| 624 | unapproved | ExtrudeFeature and Sketch shall each carry an optional name string. The feature-tree row l | `cad-modeler/feature-tree.md`<br>`cad-modeler/modules/document.md` |
| 625 | unapproved | The user shall be able to host a sketch on a flat face of an existing extrude (in addition | `cad-modeler/datums-planes.md` *(prose)* |
| 626 | unapproved | The feature tree shall support multi-select via left-click with modifier keys: bare click  | `cad-modeler/feature-tree.md`<br>`cad-runtime/modules/cad-feature-tree-panel.md` |
| 627 | unapproved | When a new sketch is created on an existing face (REQ 625), the sketch's plane origin shal | `cad-modeler/datums-planes.md` *(prose)* |
| 628 | unapproved | Sketch points (explicit point entities AND the endpoints of line/circle/arc entities) shal | `cad-runtime/viewer-rendering.md` |
| 629 | unapproved | While a drawing tool is active in a sketch (Line, Circle, Arc), the 3D viewer shall render | `cad-modeler/modules/preview.md`<br>`cad-runtime/viewer-rendering.md` |
| 630 | unapproved | In addition to existing sketch point entities, the sketch origin (the 2D coordinate (0, 0) | `cad-runtime/viewer-rendering.md` |
| 631 | unapproved | Selected sketch entities (line, circle, arc) shall render with a visibly thicker stroke th | `cad-runtime/viewer-rendering.md` |
| 632 | unapproved | While the sketcher is active and one or more sketch entities are selected, pressing Delete | `cad-modeler/sketching.md` *(prose)* |
| 633 | unapproved | Pressing Esc while the sketcher is active shall cancel any in-flight tool gesture (placed  | `cad-modeler/sketching.md` *(prose)* |
| 634 | unapproved | The system shall provide a SolidWorks-style equations capability that lets a user define n | `10-cad-modeler.md`<br>`cad-modeler/equations.md` |
| 635 | unapproved | Each DesignCADModel shall persist an equations document as a JSONB column whose shape is { | `10-cad-modeler.md`<br>`cad-modeler/equations.md` |
| 636 | unapproved | The system shall parse and evaluate equation expressions using the expr-eval library, supp | `10-cad-modeler.md`<br>`cad-modeler/equations.md` |
| 637 | unapproved | The equations resolver shall build a dependency graph over the equation entries (using exp | `10-cad-modeler.md`<br>`cad-modeler/equations.md` |
| 638 | unapproved | During regeneration, the backend shall resolve all equations BEFORE feature dispatch and o | `10-cad-modeler.md`<br>`cad-modeler/equations.md` |
| 639 | unapproved | All numeric feature parameters (ExtrudeFeature.distance, CutExtrudeFeature.distance, Extru | `10-cad-modeler.md`<br>`cad-modeler/equations.md` |
| 640 | unapproved | The CAD editor shall provide an Equations panel (toolbar button "Σ Equations") that lists  | `cad-modeler/equations.md`<br>`cad-runtime/editor-ui.md` |
| 641 | unapproved | Every numeric input in the CAD editor (extrude distance, direction-2 distance, start-condi | `cad-modeler/equations.md`<br>`cad-runtime/modules/dim-input.md` |
| 642 | unapproved | The CAD editor shall provide a Fillet (Round) action that, when invoked, opens a sidebar f | `20-kernel.md`<br>`kernel/operations.md` |
| 643 | unapproved | The CAD editor shall provide a Chamfer (Bevel) action with three SolidWorks-style modes: ( | `20-kernel.md`<br>`kernel/operations.md` |
| 644 | unapproved | Picked edges in a Fillet or Chamfer feature shall be persisted by their two 3D world-space | `kernel/modules/ops-edge_blend.md`<br>`cad-modeler/fillet-chamfer-shell-pattern.md` |
| 645 | unapproved | While a Fillet or Chamfer sidebar is open and one or more edges are picked, the 3D viewer  | `cad-modeler/fillet-chamfer-shell-pattern.md`<br>`cad-modeler/00-overview.md` |
| 646 | unapproved | The Fillet and Chamfer sidebars shall provide a Tangent Propagation toggle (default ON). W | `cad-modeler/modules/tangentPropagation.md`<br>`cad-modeler/fillet-chamfer-shell-pattern.md` |
| 647 | unapproved | Per-edge value override capability is reserved in the data model (EdgeRef3D.value optional | `kernel/modules/ops-edge_blend.md`<br>`cad-modeler/fillet-chamfer-shell-pattern.md` |
| 648 | unapproved | The chamfer sidebar shall show a three-option mode selector (Equal distance / Two distance | `cad-modeler/fillet-chamfer-shell-pattern.md`<br>`cad-modeler/00-overview.md` |
| 649 | unapproved | All rows in the CAD feature-tree panel (datums, features, sketches, and bodies) shall rese | `cad-modeler/feature-tree.md` |
| 650 | unapproved | When the user opens the Fillet or Chamfer sidebar for a NEW feature (not editing an existi | `cad-modeler/fillet-chamfer-shell-pattern.md` *(prose)* |
| 651 | unapproved | While the Fillet or Chamfer sidebar is open and the user is in edge-pick mode, clicking a  | `cad-modeler/fillet-chamfer-shell-pattern.md` *(prose)* |
| 652 | unapproved | The CAD editor shall provide a Measure tool that, when activated, opens a sidebar acceptin | `10-cad-modeler.md`<br>`cad-modeler/measurement.md` |
| 653 | unapproved | The Measure sidebar shall compute a distance result for the following pick combinations: ( | `10-cad-modeler.md`<br>`cad-modeler/measurement.md` |
| 654 | unapproved | The Measure sidebar shall compute an angle result when two straight edges are picked: the  | `10-cad-modeler.md`<br>`cad-modeler/measurement.md` |
| 655 | unapproved | The Measure sidebar shall support face picks as first-class measurement entities. For a si | `10-cad-modeler.md`<br>`cad-modeler/measurement.md` |
| 656 | unapproved | The Measure tool shall recognize circular curves (arcs and full circles) on picked edges a | `10-cad-modeler.md`<br>`cad-modeler/measurement.md` |
| 657 | unapproved | The CAD editor shall provide a Datum Plane feature with eight SolidWorks-style constructio | `10-cad-modeler.md`<br>`cad-modeler/datums-planes.md` |
| 658 | unapproved | The CAD editor shall provide three pattern features that replicate one or more existing fe | `20-kernel.md`<br>`10-cad-modeler.md` |
| 659 | unapproved | The CAD editor shall provide a Shell feature that hollows a solid by removing one or more  | `20-kernel.md`<br>`kernel/operations.md` |
| 660 | unapproved | The CAD editor shall provide a Datum Axis feature with five construction methods, mirrorin | `cad-modeler/datums-planes.md`<br>`cad-modeler/modules/datum.md` |
| 661 | unapproved | The CAD editor shall provide a Datum Point feature with five construction methods: (1) On  | `cad-modeler/datums-planes.md`<br>`cad-modeler/modules/datum.md` |
| 662 | unapproved | The CAD editor shall provide a Combine feature that performs a boolean operation between t | `20-kernel.md`<br>`kernel/operations.md` |
| 663 | unapproved | The CAD editor shall provide a Hole Wizard feature that drops one or more standardized hol | `10-cad-modeler.md`<br>`cad-modeler/holes.md` |
| 664 | unapproved | The Hole Wizard feature shall include a static hardware specification table covering ISO m | `cad-modeler/holes.md`<br>`cad-modeler/modules/holeSpecs.md` |
| 665 | unapproved | The Tapped hole type in the Hole Wizard shall render a cosmetic thread display around each | `cad-modeler/holes.md`<br>`README.md` |
| 666 | unapproved | The CAD editor shall provide a Mirror Body feature that reflects one or more existing bodi | `cad-modeler/multi-body.md`<br>`cad-modeler/fillet-chamfer-shell-pattern.md` |
| 667 | unapproved | The CAD editor shall provide a Move/Copy Body feature that applies a rigid-body transform  | `cad-modeler/multi-body.md`<br>`cad-modeler/fillet-chamfer-shell-pattern.md` |

## Version Control (668–747)

| REQ | Status | Summary | Primary doc(s) |
|-----|--------|---------|----------------|
| 668 | unapproved | The CAD module shall maintain the version history of each part's CAD model in a content-ad | `30-vcs.md`<br>`vcs/content-addressed-store.md` |
| 669 | unapproved | The version-control store shall identify every stored object by a SHA-256 hash of its cano | `30-vcs.md`<br>`vcs/modules/vcsService.md` |
| 670 | unapproved | The version-control store shall serialize object content canonically such that two objects | `30-vcs.md`<br>`vcs/modules/vcsService.md` |
| 671 | unapproved | The version-control store shall represent model state using three core object kinds: blob  | `30-vcs.md`<br>`vcs/modules/vcsService.md` |
| 672 | unapproved | A commit object shall reference its tree, zero or more parent commits, an author, a messag | `vcs/modules/vcsService.md`<br>`vcs/content-addressed-store.md` |
| 673 | unapproved | The version-control store shall provide named references scoped to a repository identified | `30-vcs.md`<br>`50-architecture.md` |
| 674 | unapproved | The version-control store shall traverse commit ancestry (log/walk) starting from any bran | `vcs/history-graph.md`<br>`vcs/modules/vcsService.md` |
| 675 | unapproved | The version-control store shall persist binary objects (such as frozen geometry) addressed | `vcs/modules/vcsFreeze.md`<br>`vcs/modules/vcsService.md` |
| 676 | unapproved | The version-control store shall support a component object kind whose content references a | `vcs/content-addressed-store.md`<br>`architecture/modules/vcsUsage.md` |
| 677 | unapproved | The CAD editor's working copy shall bind to a checked-out branch of the part's version-con | `30-vcs.md`<br>`vcs/modules/cadVcsService.md` |
| 678 | unapproved | Checkout shall acquire an exclusive lock on the branch for the requesting user. While anot | `30-vcs.md`<br>`vcs/modules/vcsWorkingCopy.md` |
| 679 | unapproved | A lock shall expire after a configured timeout, shall be releasable by the user who holds  | `30-vcs.md`<br>`vcs/modules/cadVcsService.md` |
| 680 | unapproved | Check-in shall require the lock and a commit message, serialize the working copy into the  | `30-vcs.md`<br>`vcs/modules/vcsWorkingCopy.md` |
| 681 | unapproved | Autosave shall continue to persist working-copy edits without creating commits; commits sh | `30-vcs.md`<br>`vcs/modules/vcsWorkingCopy.md` |
| 682 | unapproved | The system shall serialize a CAD model document into the object store as a tree composed o | `vcs/modules/cadSerializer.md`<br>`vcs/modules/assemblySerializer.md` |
| 683 | unapproved | Every commit shall record the geometry kernel version and the naming-schema version in eff | `kernel/persistent-naming.md`<br>`vcs/modules/cadVcsService.md` |
| 684 | unapproved | On release, the system shall regenerate the model and store each resulting body's geometry | `30-vcs.md`<br>`vcs/freeze-geometry.md` |
| 685 | unapproved | Checking out a released commit shall load its frozen geometry directly without a kernel re | `30-vcs.md`<br>`vcs/freeze-geometry.md` |
| 686 | unapproved | A released CAD commit shall correspond to a Part revision: releasing shall tag the commit  | `30-vcs.md`<br>`vcs/release-revisions.md` |
| 687 | unapproved | The system shall not maintain a CAD-specific revision identifier separate from the manufac | `vcs/release-revisions.md`<br>`README.md` |
| 688 | unapproved | Each part lineage shall have exactly one version-control repository whose commit history i | `30-vcs.md`<br>`50-architecture.md` |
| 689 | unapproved | The system shall migrate every existing active CAD model into its version-control reposito | `README.md` |
| 690 | unapproved | Checkout and check-in shall be gated by CAD permissions, including a checkout capability;  | `vcs/working-copy-checkout-checkin.md`<br>`README.md` |
| 691 | unapproved | The CAD editor shall display the current lock holder and dirty state, provide actions to c | `cad-runtime/editor-ui.md`<br>`cad-runtime/modules/cad-editor.md` |
| 692 | unapproved | The system shall create a named variant branch in a model's version-control repository, po | `30-vcs.md`<br>`vcs/branches.md` |
| 693 | unapproved | The system shall list the branches of a model's repository. | `30-vcs.md`<br>`vcs/branches.md` |
| 694 | unapproved | Switching the working copy to another branch shall load that branch's head state (featureT | `30-vcs.md`<br>`vcs/branches.md` |
| 695 | unapproved | The system shall archive (remove) a branch reference; the current branch and the default b | `30-vcs.md`<br>`vcs/branches.md` |
| 696 | unapproved | The system shall cherry-pick a single feature from a source commit into the working copy — | `30-vcs.md`<br>`vcs/branches.md` |
| 697 | unapproved | The system shall not provide any automatic merge of branches; cherry-pick shall be the onl | `30-vcs.md`<br>`vcs/branches.md` |
| 698 | unapproved | The CAD editor shall provide a branch picker showing the current branch and the available  | `30-vcs.md`<br>`vcs/branches.md` |
| 699 | unapproved | The system shall compute a structural diff between two commits, classifying each feature,  | `30-vcs.md`<br>`vcs/diff-compare.md` |
| 700 | unapproved | For a modified feature or equations set, the diff shall report which parameters or fields  | `30-vcs.md`<br>`vcs/diff-compare.md` |
| 701 | unapproved | The system shall compute a body-level 3D diff between two commits by regenerating each com | `30-vcs.md`<br>`vcs/diff-compare.md` |
| 702 | unapproved | The CAD editor shall provide a Compare view between two commits that shows the structural  | `30-vcs.md`<br>`vcs/diff-compare.md` |
| 703 | unapproved | The system shall provide a generic, declarative workflow engine that drives permission-gua | `30-vcs.md`<br>`50-architecture.md` |
| 704 | unapproved | A CAD model shall follow a review workflow with states draft, in_review, and approved and  | `30-vcs.md`<br>`vcs/workflow-review.md` |
| 705 | unapproved | Releasing a CAD revision shall require the workflow state to be 'approved'; on release the | `30-vcs.md`<br>`vcs/workflow-review.md` |
| 706 | unapproved | A workflow transition shall fire a notification event on a best-effort basis (for example, | `30-vcs.md`<br>`vcs/workflow-review.md` |
| 707 | unapproved | The CAD editor shall display the current workflow state and offer the transition actions t | `30-vcs.md`<br>`vcs/workflow-review.md` |
| 708 | unapproved | The CAD viewer shall provide a "Default view" control beneath the orientation cube that re | `cad-runtime/viewer-rendering.md`<br>`cad-runtime/modules/cad-viewer.md` |
| 709 | unapproved | The CAD viewer shall provide a "Save as default view" control that persists the current ca | `cad-runtime/viewer-rendering.md`<br>`cad-runtime/modules/cad-viewer.md` |
| 710 | unapproved | On check-in, the CAD module shall capture a low-resolution raster image of the model rende | `vcs/freeze-geometry.md`<br>`vcs/modules/cadVcsService.md` |
| 711 | unapproved | The CAD version-history 3D preview shall display the stored low-resolution commit image im | `vcs/history-graph.md`<br>`vcs/freeze-geometry.md` |
| 712 | unapproved | The CAD version-history 3D preview shall support interactive camera rotation, zoom, and po | `cad-runtime/modules/cad-preview-3d.md`<br>`cad-runtime/modules/cad-revision-list.md` |
| 713 | unapproved | The CAD version-history Compare view shall colour each commit's faces by a persistent-name | `30-vcs.md`<br>`vcs/diff-compare.md` |
| 714 | unapproved | For a modified sketch, the CAD diff shall list the specific entity and constraint changes  | `30-vcs.md`<br>`vcs/diff-compare.md` |
| 715 | unapproved | A CAD design must be checked in (dirty=false and a base commit exists) before it can be re | `30-vcs.md`<br>`vcs/release-revisions.md` |
| 716 | unapproved | A development release shall be self-service, requiring only cad.write (no approval). | `30-vcs.md`<br>`vcs/release-revisions.md` |
| 717 | unapproved | A development release shall commit and freeze the working copy and fix the current numeric | `30-vcs.md`<br>`vcs/release-revisions.md` |
| 718 | unapproved | After a development release the CAD design and its Part revision shall be locked read-only | `30-vcs.md`<br>`vcs/release-revisions.md` |
| 719 | unapproved | A development release shall produce downloadable STL and STEP files reproduced from the fr | `30-vcs.md`<br>`vcs/release-revisions.md` |
| 720 | unapproved | Editing a development-released design shall be done by creating a new revision, which assi | `30-vcs.md`<br>`vcs/release-revisions.md` |
| 721 | unapproved | A production release may be created only from a development-released design and shall requ | `30-vcs.md`<br>`vcs/release-revisions.md` |
| 722 | unapproved | A production release shall assign the next alphabetic (letter) revision, carry the same ge | `30-vcs.md`<br>`vcs/release-revisions.md` |
| 723 | unapproved | STL export shall use the OCCT kernel exportStl operation; STEP export shall use exportStep | `30-vcs.md`<br>`20-kernel.md` |
| 724 | unapproved | CAD version history shall remain continuous across development and production revisions (t | `30-vcs.md`<br>`vcs/release-revisions.md` |
| 725 | unapproved | The CAD editor shall provide an Undo Checkout (discard) action that abandons all uncommitt | `vcs/modules/vcsWorkingCopy.md`<br>`vcs/working-copy-checkout-checkin.md` |
| 726 | unapproved | The CAD version-history Compare view shall provide a camera-lock toggle that, when enabled | `vcs/diff-compare.md`<br>`cad-runtime/modules/cad-preview-3d.md` |
| 727 | unapproved | When the user enters (creates or re-opens) a sketch, the CAD module shall orient the view  | `cad-runtime/modules/cad-viewer.md` |
| 728 | unapproved | The CAD viewer shall provide rotate-90-clockwise and rotate-90-counter-clockwise controls  | `cad-runtime/viewer-rendering.md` |
| 729 | unapproved | While a datum plane is visible in the 3D viewer, the CAD module shall display a small text | `10-cad-modeler.md`<br>`cad-runtime/viewer-rendering.md` |
| 730 | unapproved | Checking out a released (locked) CAD revision shall not modify that revision; instead the  | `vcs/branches.md`<br>`vcs/release-revisions.md` |
| 731 | unapproved | Creating a CAD branch shall immediately switch the working copy to the new branch and chec | `vcs/branches.md`<br>`README.md` |
| 732 | unapproved | The CAD version-history view shall provide a Branches management tab that lists every bran | `vcs/branches.md`<br>`vcs/history-graph.md` |
| 733 | unapproved | The read-only lock applied to a released CAD revision shall apply only on its released mai | `vcs/branches.md`<br>`README.md` |
| 734 | unapproved | The CAD module shall protect the main branch from direct editing: checkout, check-in, and  | `30-vcs.md`<br>`vcs/branches.md` |
| 735 | unapproved | A draft branch displayed revision shall be derived as the highest released numeric revisio | `vcs/branches.md`<br>`vcs/modules/cadVcsService.md` |
| 736 | unapproved | Creating a CAD model shall seed an initial commit on main and auto-create and switch the w | `30-vcs.md`<br>`vcs/branches.md` |
| 737 | unapproved | A draft branch shall be released onto main self-service (requiring only cad.write, no revi | `30-vcs.md`<br>`vcs/release-revisions.md` |
| 738 | unapproved | When main has advanced past a draft branch (another branch was released), the branch shall | `vcs/branches.md`<br>`vcs/modules/cadBranchService.md` |
| 739 | unapproved | CAD review workflow state shall be tracked per branch (keyed by lineage root and branch na | `30-vcs.md`<br>`vcs/branches.md` |
| 740 | unapproved | After a numeric revision is released onto main, a separate production release shall remain | `vcs/release-revisions.md`<br>`README.md` |
| 741 | unapproved | The CAD history shall provide a feature-level merge (reconciliation) of main into a behind | `30-vcs.md`<br>`vcs/merge-reconcile.md` |
| 742 | unapproved | New CAD feature and sketch identifiers shall be globally unique (random), not sequential p | `vcs/branches.md`<br>`cad-modeler/modules/ids.md` |
| 743 | unapproved | The CAD version-history view shall provide an "Open version" action on a selected commit t | `vcs/history-graph.md`<br>`README.md` |
| 744 | unapproved | The CAD editor shall determine CAD-kernel availability via a dedicated health probe (a lig | `20-kernel.md`<br>`kernel/modules/server.md` |
| 745 | unapproved | The CAD editor shall allow the user to show or hide bodies and sketches without checking t | `vcs/branches.md`<br>`README.md` |
| 746 | unapproved | When a draft branch is released onto main, its commit history shall be preserved as ancest | `vcs/release-revisions.md`<br>`vcs/modules/vcsRelease.md` |
| 747 | unapproved | The CAD branch merge tool shall list every feature AND sketch that differs between main an | `30-vcs.md`<br>`vcs/merge-reconcile.md` |

## Assembly (748–769)

| REQ | Status | Summary | Primary doc(s) |
|-----|--------|---------|----------------|
| 748 | unapproved | The CAD module shall provide a 3D assembly mate solver that positions rigid component inst | `40-assembly.md`<br>`assembly/mates-solver.md` |
| 749 | unapproved | For each planar or cylindrical face it emits, the CAD kernel shall include a surface class | `20-kernel.md`<br>`40-assembly.md` |
| 750 | unapproved | The CAD module shall provide an Assembly that positions multiple component instances toget | `40-assembly.md`<br>`50-architecture.md` |
| 751 | unapproved | The CAD module shall allow inserting a component instance into an assembly by referencing  | `40-assembly.md`<br>`assembly/modules/controller.md` |
| 752 | unapproved | When regenerating an assembly, the CAD module shall resolve each non-suppressed component  | `40-assembly.md`<br>`assembly/modules/controller.md` |
| 753 | unapproved | The CAD module shall produce a bill of materials for an assembly by aggregating its compon | `40-assembly.md`<br>`assembly/bom-sync.md` |
| 754 | unapproved | The CAD module shall export the whole assembly as a STEP or STL file by applying each comp | `40-assembly.md`<br>`assembly/export.md` |
| 755 | unapproved | When regenerating an assembly, the CAD module shall solve the assembly geometric mate cons | `40-assembly.md`<br>`assembly/mates-solver.md` |
| 756 | unapproved | The CAD module shall support the assembly mate types coincident, concentric, parallel, per | `40-assembly.md`<br>`assembly/mates-solver.md` |
| 757 | unapproved | The CAD module shall report whether an assembly is under-, fully-, or over-constrained by  | `40-assembly.md`<br>`assembly/mates-solver.md` |
| 758 | unapproved | The CAD module shall allow adding and removing a mate, where a mate references a face on e | `40-assembly.md`<br>`assembly/mates-solver.md` |
| 759 | unapproved | The assembly editor shall provide a mate-creation flow in which the user selects a face on | `40-assembly.md`<br>`assembly/mates-solver.md` |
| 760 | unapproved | The CAD module shall support a linear component pattern that creates a specified number of | `40-assembly.md`<br>`assembly/modules/controller.md` |
| 761 | unapproved | The CAD module shall support mirroring a seed component instance across a plane, producing | `40-assembly.md`<br>`assembly/modules/controller.md` |
| 762 | unapproved | The CAD module shall allow replacing the part referenced by a component instance with anot | `40-assembly.md`<br>`assembly/modules/controller.md` |
| 763 | unapproved | The CAD module shall support nesting one assembly inside another: a component instance may | `40-assembly.md`<br>`assembly/modules/controller.md` |
| 764 | unapproved | The CAD module shall provide an exploded view of an assembly in which each component insta | `40-assembly.md`<br>`assembly/visualization.md` |
| 765 | unapproved | The CAD module shall support named display states for an assembly that capture which compo | `40-assembly.md`<br>`assembly/visualization.md` |
| 766 | unapproved | The assembly viewer shall support a section view that clips the displayed geometry against | `40-assembly.md`<br>`assembly/visualization.md` |
| 767 | unapproved | The CAD module shall detect interference between component instances in an assembly. It sh | `40-assembly.md`<br>`assembly/analysis.md` |
| 768 | unapproved | The CAD module shall compute assembly mass properties: the total volume as the sum of the  | `40-assembly.md`<br>`assembly/analysis.md` |
| 769 | unapproved | The CAD module shall synchronize an assembly bill of materials to the inventory bill-of-ma | `40-assembly.md`<br>`assembly/bom-sync.md` |

---

**Coverage:** 258/258 requirements mapped — complete.
