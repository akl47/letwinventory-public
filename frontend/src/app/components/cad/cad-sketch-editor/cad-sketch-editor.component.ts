import { Component, inject, input, output, signal, computed, effect, untracked, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { DomSanitizer } from '@angular/platform-browser';
import { registerCadIcons } from '../cad-icons';
import type {
  SketchDocument, SketchState, PointEntity, LineEntity, CircleEntity, ArcEntity, SketchEntity,
  ConstraintType, ConstraintTarget, ReferenceCandidate, ExternalRef,
} from '../../../cad/lib/types';
import { pointsOf, linesOf, findPoint, onEdgeLookupKey, isCenterExternalRef } from '../../../cad/lib/types';
import { nearestCandidateHit, externalRefForCandidate, parseCandidateId, closestPointOnSegment, closestPointOnPolyline } from '../../../cad/lib/externalSnap';
import { angleQuadrant } from '../../../cad/lib/geometry';
import {
  addPoint, addLine, addCircle, addCircleByPoint, addArc, addArcByPoints, addConstraint, movePoint, deletePrimitive, emptySketchState,
  addRectangleCorners, addRectangleCenter, addRectangle3PtCorner, addRectangle3PtCenter, addParallelogram,
  addPolygon, addSlotStraight, addSlotStraightCenterpoint, addSlotArc3Pt, addSlotArcCenterpoint,
  addCircle3Points, addArc3Points, addEllipse, addEllipticalArc, addSpline,
  addParabolaByPoints, addEquationCurve, addText, addTextBoxByCorners, addPicture,
  setConstructionFlag, setConstraintDriven, mergePoints, ORIGIN_POINT_ID,
} from '../../../cad/lib/store';
import { solveSketch } from '../../../cad/lib/solver';
import { extractClosedLoops } from '../../../cad/lib/profile';
import { pickEntity, distanceToEntity, entityTouchesRect } from '../../../cad/lib/picking';
import { inferLineEnd, inferAlignment, type InferenceResult, type PendingConstraint, type AlignmentRef } from '../../../cad/lib/inference';
import { findEntity, isProjectedEntity } from '../../../cad/lib/types';
import { previewDimension, previewPointToEdgeDimension, chooseTwoPointDimType, twoPointDimValue, type DimensionRender } from '../../../cad/lib/dimensions';
import { analyzeDeterminacy } from '../../../cad/lib/determinacy';
import {
  trimAt, extendLine, splitLineAt, offsetCurve, offsetChain, propagateOffsetSides, mirrorEntities, filletLines, filletLineArc, chamferLines, jogLineAt,
  moveEntities, copyEntities, rotateEntities, scaleEntities,
  linearPatternEntities, circularPatternEntities, stretchEntities,
  findChainedEntities, flipSidePoint,
  previewTrimLine, previewTrimCircle, previewTrimArc, previewExtendLine,
  addRoundedRectangleCorners, addRoundedRectangleCenter,
  type ChamferMode,
} from '../../../cad/lib/sketchEditOps';

type Tool =
  | 'select' | 'point' | 'line' | 'centerline' | 'midpoint-line' | 'circle' | 'arc'
  | 'rect-corner' | 'rect-center' | 'rect-3pt-corner' | 'rect-3pt-center'
  | 'rect-rounded-corner' | 'rect-rounded-center'
  | 'parallelogram' | 'polygon'
  | 'slot' | 'slot-centerpoint' | 'slot-arc-3pt' | 'slot-arc-centerpoint'
  | 'circle-3pt' | 'arc-3pt' | 'ellipse' | 'partial-ellipse' | 'spline' | 'style-spline'
  | 'parabola' | 'equation-curve' | 'text' | 'picture'
  | 'circle-perimeter' | 'tangent-arc'
  | 'smart-dim'
  | 'trim' | 'extend' | 'split' | 'offset' | 'mirror' | 'dynamic-mirror' | 'fillet' | 'chamfer' | 'jog'
  | 'move' | 'copy' | 'rotate' | 'scale' | 'stretch'
  | 'pattern-linear' | 'pattern-circular'
  | 'convert-entities';
type PendingPoint = {
  x: number;
  y: number;
  /** When the user's click landed on an existing point entity, the
   * tools commit the entity using that point's id (via addCircleByPoint
   * / addArcByPoints) instead of synthesizing a fresh coincident
   * point. Saves the user from having to add a coincident constraint
   * afterwards and keeps the sketch dependency graph clean. */
  pointId?: string;
  /** Set when the click landed ON an existing line / arc / circle
   * (including a converted on-edge entity). The tool commits a fresh
   * point at the projected location and adds a `coincident` constraint
   * tying it to that curve — SolidWorks-style "click on a line with a
   * tool drops a coincident-on-curve point". */
  onCurveId?: string;
  /** Set when the click snapped to a LINE's MIDPOINT. The placing tool emits a
   * `midpoint` constraint (point pinned to the line's center) instead of the
   * plain coincident-on-curve, so the point tracks the midpoint as the line
   * moves. Carries the line id. */
  midpointOf?: string;
  /** Set when the click snapped onto a MODEL vertex / straight-edge
   * projection (a ReferenceCandidate). The placing tool attaches an
   * `on-edge` constraint carrying this ref to the point it creates, so the
   * point references the model geometry without Convert Entities. Mutually
   * exclusive with `pointId` / `onCurveId` (a real-geometry snap wins). */
  externalRef?: ExternalRef;
  /** Set when the click, landing in open space (no concrete-geometry snap),
   * inferred horizontal/vertical alignment to one or two ARMED reference
   * points (the origin, or a hovered point). The placing tool emits a real
   * horizontal/vertical constraint between the fresh point and each ref via
   * `_applyAlignTo`. Empty/absent when nothing aligned. */
  alignTo?: AlignmentRef[];
  /** Set when the click landed on a circle/arc QUADRANT (top/bottom/left/right).
   * A quadrant point is one that's vertical (top/bottom — shares X) or
   * horizontal (left/right — shares Y) with the curve's center, so on top of
   * the coincident-on-curve the placing tool emits that relation to the center
   * (via `_applyQuadrant`), locking the point to the quadrant. */
  quadrant?: { centerId: string; axis: 'horizontal' | 'vertical' };
};

interface ConstraintSpec {
  type: ConstraintType;
  label: string;
  icon: string;
  // Predicate over an ordered selection — must return true for the constraint
  // button to enable. The order of selection is preserved into the targets array
  // unless the constraint type explicitly re-orders in `apply`.
  predicate: (entities: SketchEntity[]) => boolean;
  requiresValue?: boolean;
  /** When set, applyConstraint uses this value verbatim instead of prompting.
   * Used by "Equal X" / "Equal Y" which fire `horizontal-distance` /
   * `vertical-distance` with value 0 — same underlying constraint type,
   * different button affordance. */
  implicitValue?: number;
  /** Optional one-shot action: when set, applyConstraint dispatches
   * to a special handler instead of adding a persisted constraint
   * record. Used by Merge Points, which mutates the entity graph
   * (collapses two ids into one) rather than emitting a constraint. */
  action?: 'merge-points';
}

const CURVE_KINDS = new Set<SketchEntity['kind']>(['circle', 'arc', 'ellipse', 'ellipticalArc']);
/** Tolerance for "line endpoint sits at this point's position" matching.
 * Used by Fillet/Chamfer's corner detector — generous enough to forgive
 * floating-point drift and visually-identical-but-topologically-distinct
 * vertices, tight enough not to collapse genuinely-separate corners that
 * happen to be close. */
const LINES_INCIDENT_TOL = 0.5;
const isLineEntity = (e: SketchEntity) => e.kind === 'line';
const isPointEntity = (e: SketchEntity) => e.kind === 'point';
const isCurveEntity = (e: SketchEntity) => CURVE_KINDS.has(e.kind);

const CONSTRAINT_SPECS: ConstraintSpec[] = [
  { type: 'fixed', label: 'Fix', icon: 'cad-fixed',
    predicate: es => es.length === 1 && isPointEntity(es[0]) },
  // Coincident is the unified "this is on that" constraint: two points,
  // or a point and any line/curve. The solver dispatches on target kinds.
  { type: 'coincident', label: 'Coincident', icon: 'cad-coincident',
    predicate: es => {
      if (es.length !== 2) return false;
      if (es.every(isPointEntity)) return true;
      const hasPoint = es.some(isPointEntity);
      const hasLineOrCurve = es.some(e => isLineEntity(e) || isCurveEntity(e));
      return hasPoint && hasLineOrCurve;
    } },
  // A single line (the line is horizontal) OR two points (the points share a
  // y — SolidWorks-style point-pair horizontal alignment).
  { type: 'horizontal', label: 'Horizontal', icon: 'cad-horizontal',
    predicate: es => (es.length === 1 && isLineEntity(es[0])) || (es.length === 2 && es.every(isPointEntity)) },
  { type: 'vertical', label: 'Vertical', icon: 'cad-vertical',
    predicate: es => (es.length === 1 && isLineEntity(es[0])) || (es.length === 2 && es.every(isPointEntity)) },
  // Distance has moved exclusively to Smart Dim — point↔point distance is
  // its primary case (single click → place → type). Leaving a duplicate
  // button on the constraint toolbar caused users to pick the wrong path.
  // `point-on-line` / `point-on-curve` are also gone: both are now expressed
  // as `coincident` and handled above.
  { type: 'perpendicular', label: 'Perpendicular', icon: 'cad-perpendicular',
    predicate: es => es.length === 2 && es.every(isLineEntity) },
  { type: 'parallel', label: 'Parallel', icon: 'cad-parallel',
    predicate: es => es.length === 2 && es.every(isLineEntity) },
  { type: 'tangent', label: 'Tangent', icon: 'cad-tangent',
    predicate: es => {
      if (es.length !== 2) return false;
      const lines = es.filter(isLineEntity).length;
      const curves = es.filter(isCurveEntity).length;
      return (lines === 1 && curves === 1) || (lines === 0 && curves === 2);
    } },
  { type: 'equal', label: 'Equal', icon: 'cad-equal',
    predicate: es => {
      if (es.length !== 2) return false;
      const allLines = es.every(isLineEntity);
      const allCurves = es.every(e => e.kind === 'circle' || e.kind === 'arc');
      return allLines || allCurves;
    } },
  { type: 'midpoint', label: 'Midpoint', icon: 'cad-midpoint',
    predicate: es => es.length === 2 && es.some(isPointEntity) && es.some(isLineEntity) },
  { type: 'symmetric', label: 'Symmetric', icon: 'cad-symmetric',
    predicate: es => es.length === 3 &&
      es.filter(isPointEntity).length === 2 && es.filter(isLineEntity).length === 1 },
  { type: 'concentric', label: 'Concentric', icon: 'cad-concentric',
    predicate: es => es.length === 2 && es.every(e => e.kind === 'circle' || e.kind === 'arc') },
  { type: 'coradial', label: 'Coradial', icon: 'cad-coradial',
    predicate: es => es.length === 2 && es.every(e => e.kind === 'circle' || e.kind === 'arc') },
  { type: 'collinear', label: 'Collinear', icon: 'cad-collinear',
    predicate: es => es.length === 2 && es.every(isLineEntity) },
  // Dimensional constraints — drive a numeric value rather than relate
  // geometry symbolically. Radius/diameter take one circle or arc; angle
  // takes two lines and stores the value in radians.
  { type: 'radius', label: 'Radius', icon: 'cad-radius', requiresValue: true,
    predicate: es => es.length === 1 && (es[0].kind === 'circle' || es[0].kind === 'arc') },
  { type: 'diameter', label: 'Diameter', icon: 'cad-diameter', requiresValue: true,
    predicate: es => es.length === 1 && (es[0].kind === 'circle' || es[0].kind === 'arc') },
  { type: 'angle', label: 'Angle', icon: 'cad-angle', requiresValue: true,
    predicate: es => es.length === 2 && es.every(isLineEntity) },
  { type: 'horizontal-distance', label: 'Horizontal distance', icon: 'cad-horizontal-distance', requiresValue: true,
    predicate: es => es.length === 2 && es.every(isPointEntity) },
  { type: 'vertical-distance', label: 'Vertical distance', icon: 'cad-vertical-distance', requiresValue: true,
    predicate: es => es.length === 2 && es.every(isPointEntity) },
  // Equal-X / Equal-Y: shortcuts that fire horizontal-distance /
  // vertical-distance with value 0. Same underlying constraint type as the
  // dimensional variants; the implicitValue option suppresses the prompt
  // so the click commits in one shot.
  //   Equal X (same x-coord) ⇒ Δx = 0 ⇒ horizontal-distance(0)
  //   Equal Y (same y-coord) ⇒ Δy = 0 ⇒ vertical-distance(0)
  { type: 'horizontal-distance', label: 'Equal X', icon: 'cad-equal-x', implicitValue: 0,
    predicate: es => es.length === 2 && es.every(isPointEntity) },
  { type: 'vertical-distance', label: 'Equal Y', icon: 'cad-equal-y', implicitValue: 0,
    predicate: es => es.length === 2 && es.every(isPointEntity) },
  { type: 'point-line-distance', label: 'Point-line distance', icon: 'cad-point-line-distance', requiresValue: true,
    predicate: es => es.length === 2 && es.some(isPointEntity) && es.some(isLineEntity) },
  { type: 'arc-length', label: 'Arc length', icon: 'cad-arc-length', requiresValue: true,
    predicate: es => es.length === 1 && es[0].kind === 'arc' },
  { type: 'chord-distance', label: 'Chord distance', icon: 'cad-chord-distance', requiresValue: true,
    predicate: es => es.length === 1 && es[0].kind === 'arc' },
  // Merge Points: collapse two coincident-by-position points into a
  // single identity. NOT a persisted constraint — applyConstraint
  // dispatches to mergePoints(...) in store.ts. SolidWorks lists this
  // in the Relations dialog so we keep the same UI surface.
  { type: 'coincident', label: 'Merge Points', icon: 'cad-merge-points', action: 'merge-points',
    predicate: es => es.length === 2 && es.every(isPointEntity) },
];

// ────────────────────────────────────────────────────────────────────────────
// Tool groups — SolidWorks-style split-button dropdowns. Each entry is one
// variant in the group; the toolbar renders a single main button per group
// (showing the last-used variant) plus a chevron that opens a menu of all
// variants. Tests target individual variants via `data-testid`.
// ────────────────────────────────────────────────────────────────────────────

interface ToolSpec { tool: Tool; icon: string; label: string; tooltip: string; }

const PRIMITIVE_TOOLS: readonly ToolSpec[] = [
  { tool: 'point',          icon: 'cad-point',          label: 'Point',          tooltip: 'Point' },
  { tool: 'line',           icon: 'cad-line',           label: 'Line',           tooltip: 'Line' },
  { tool: 'centerline',     icon: 'cad-centerline',     label: 'Centerline',     tooltip: 'Centerline — draws a construction line (dashed, reference-only)' },
  { tool: 'midpoint-line',  icon: 'cad-midpoint-line',  label: 'Midpoint Line',  tooltip: 'Midpoint Line — draws a line and auto-pins a point to its midpoint' },
  { tool: 'spline',         icon: 'cad-spline',         label: 'Spline',         tooltip: 'Spline (degree 3, click control points, Enter to commit)' },
  { tool: 'style-spline',   icon: 'cad-style-spline',   label: 'Style Spline',   tooltip: 'Style Spline (variable degree — prompts for degree at start of gesture)' },
];

const CIRCLE_TOOLS: readonly ToolSpec[] = [
  { tool: 'circle',           icon: 'cad-circle',            label: 'Circle',          tooltip: 'Circle (center + radius)' },
  { tool: 'circle-perimeter', icon: 'cad-circle-perimeter',  label: 'Perim. Circle',   tooltip: 'Perimeter circle (two clicks define the diameter)' },
  { tool: 'arc',              icon: 'cad-arc',               label: 'Center Arc',      tooltip: 'Center Arc — click 1: center, click 2: start, click 3: end (3 clicks define a circular arc starting from the center)' },
  { tool: 'circle-3pt',       icon: 'cad-circle-3pt',        label: '3-pt Circle',     tooltip: 'Circle through 3 points' },
  { tool: 'arc-3pt',          icon: 'cad-arc-3pt',           label: '3-pt Arc',        tooltip: 'Arc through 3 points' },
  { tool: 'tangent-arc',      icon: 'cad-tangent-arc',       label: 'Tangent Arc',     tooltip: 'Tangent arc — click an existing endpoint, then the arc end. Arc is tangent to the entity at the picked endpoint' },
  { tool: 'ellipse',          icon: 'cad-ellipse',           label: 'Ellipse',         tooltip: 'Ellipse (center + major + minor)' },
  { tool: 'partial-ellipse',  icon: 'cad-partial-ellipse',   label: 'Partial Ellipse', tooltip: 'Partial ellipse (center + major + minor + start angle + end angle)' },
  { tool: 'parabola',         icon: 'cad-arc',               label: 'Parabola',        tooltip: 'Parabola — click vertex, then focus, then a sample point on the curve (3 clicks)' },
  { tool: 'equation-curve',   icon: 'cad-spline',            label: 'Equation Curve',  tooltip: 'Equation-driven curve — click to anchor, then enter parametric x(t)/y(t) expressions + [tMin..tMax]' },
];

const SHAPE_TOOLS: readonly ToolSpec[] = [
  { tool: 'rect-corner',           icon: 'cad-rect-corner',           label: 'Rect',             tooltip: 'Rectangle (corner + corner)' },
  { tool: 'rect-center',           icon: 'cad-rect-center',           label: 'Center Rect',      tooltip: 'Rectangle (center + corner)' },
  { tool: 'rect-rounded-corner',   icon: 'cad-rect-rounded-corner',   label: 'Rounded Rect',     tooltip: 'Rounded rectangle (corner + corner). Prompts for the fillet radius on the first click of each gesture; the radius persists across draws.' },
  { tool: 'rect-rounded-center',   icon: 'cad-rect-rounded-center',   label: 'Center Rounded Rect', tooltip: 'Center-anchored rounded rectangle. Construction diagonal runs from fillet center to fillet center.' },
  { tool: 'rect-3pt-corner',       icon: 'cad-rect-3pt-corner',       label: '3-pt Rect',        tooltip: '3-point rectangle: 1st corner, 2nd corner along edge, 3rd point picks the opposite-side offset' },
  { tool: 'rect-3pt-center',       icon: 'cad-rect-3pt-center',       label: '3-pt Center Rect', tooltip: '3-point center rectangle: center, side midpoint, opposite-side offset' },
  { tool: 'parallelogram',         icon: 'cad-parallelogram',         label: 'Parallelogram',    tooltip: 'Parallelogram (3 corners — 4th derived from closure)' },
  { tool: 'polygon',               icon: 'cad-polygon',               label: 'Polygon',          tooltip: 'Regular polygon (prompts for N)' },
  { tool: 'slot',                  icon: 'cad-slot',                  label: 'Slot',             tooltip: 'Straight slot (endpoint, endpoint, width)' },
  { tool: 'slot-centerpoint',      icon: 'cad-slot-centerpoint',      label: 'C-pt Slot',        tooltip: 'Straight slot from center + one cap + width' },
  { tool: 'slot-arc-3pt',          icon: 'cad-slot-arc-3pt',          label: '3-pt Arc Slot',    tooltip: 'Arc slot through 3 centerline points + width' },
  { tool: 'slot-arc-centerpoint',  icon: 'cad-slot-arc-centerpoint',  label: 'C-pt Arc Slot',    tooltip: 'Arc slot: arc center, start, end + width' },
  { tool: 'text',                  icon: 'cad-point',                 label: 'Text',             tooltip: 'Sketch Text — click to anchor, then enter the string + height (mm)' },
  { tool: 'picture',               icon: 'cad-point',                 label: 'Picture',          tooltip: 'Sketch Picture — pick an image file, then click to anchor (lower-left). Use Properties to resize / rotate.' },
];

const EDIT_TOOLS: readonly ToolSpec[] = [
  { tool: 'trim',             icon: 'cad-trim',             label: 'Trim',         tooltip: 'Trim — click a curve to remove a segment between intersections' },
  { tool: 'extend',           icon: 'cad-extend',           label: 'Extend',       tooltip: 'Extend — click a line near the endpoint to extend to the next boundary' },
  { tool: 'fillet',           icon: 'cad-fillet',           label: 'Fillet',       tooltip: 'Fillet — prompts for radius; click two lines to round their corner' },
  { tool: 'chamfer',          icon: 'cad-chamfer',          label: 'Chamfer',      tooltip: 'Chamfer — prompts for distance; click two lines to cut a straight chamfer' },
  { tool: 'split',            icon: 'cad-split',            label: 'Split',        tooltip: 'Split — click a line to break it at the click point' },
  { tool: 'jog',              icon: 'cad-jog',              label: 'Jog',          tooltip: 'Jog Line — click the line, then click the jog start (perpendicular offset = distance from line), then click the jog end along the line' },
  { tool: 'offset',           icon: 'cad-offset',           label: 'Offset',       tooltip: 'Offset — prompts for distance; click side of curve to offset toward' },
  { tool: 'mirror',           icon: 'cad-mirror',           label: 'Mirror',       tooltip: 'Mirror — select entities first, then click an axis line' },
  { tool: 'dynamic-mirror',   icon: 'cad-dynamic-mirror',   label: 'Dyn. Mirror',  tooltip: 'Dynamic Mirror — pick an axis line, then everything you draw is mirrored across it. Click the tool again to turn off.' },
  { tool: 'convert-entities', icon: 'cad-convert',          label: 'Convert',      tooltip: 'Convert Entities — click an edge of the existing body to project it onto the sketch plane as a new sketch entity' },
];

const TRANSFORM_TOOLS: readonly ToolSpec[] = [
  { tool: 'move',             icon: 'cad-move',             label: 'Move',             tooltip: 'Move — pre-select entities, then click a reference point and a destination' },
  { tool: 'copy',             icon: 'cad-copy',             label: 'Copy',             tooltip: 'Copy — pre-select entities, then click a reference and destination to place a duplicate' },
  { tool: 'rotate',           icon: 'cad-rotate',           label: 'Rotate',           tooltip: 'Rotate — pre-select entities, click a pivot, enter angle (degrees)' },
  { tool: 'scale',            icon: 'cad-scale',            label: 'Scale',            tooltip: 'Scale — pre-select entities, click a pivot, enter scale factor' },
  { tool: 'stretch',          icon: 'cad-stretch',          label: 'Stretch',          tooltip: 'Stretch — pre-select POINTS only. Click a reference and destination; selected points move, attached lines stretch.' },
  { tool: 'pattern-linear',   icon: 'cad-pattern-linear',   label: 'Linear Pattern',   tooltip: 'Linear Sketch Pattern — pre-select entities, click direction-from then direction-to, prompts for count' },
  { tool: 'pattern-circular', icon: 'cad-pattern-circular', label: 'Circular Pattern', tooltip: 'Circular Sketch Pattern — pre-select entities, click center; prompts for count + total angle' },
];

const PRIMITIVE_TOOL_SET = new Set<Tool>(PRIMITIVE_TOOLS.map(t => t.tool));
const CIRCLE_TOOL_SET = new Set<Tool>(CIRCLE_TOOLS.map(t => t.tool));
const SHAPE_TOOL_SET = new Set<Tool>(SHAPE_TOOLS.map(t => t.tool));
const EDIT_TOOL_SET = new Set<Tool>(EDIT_TOOLS.map(t => t.tool));
const TRANSFORM_TOOL_SET = new Set<Tool>(TRANSFORM_TOOLS.map(t => t.tool));

// Some constraints need a specific target order regardless of click order.
function orderTargetsForConstraint(type: ConstraintType, entities: SketchEntity[]): string[] {
  const pointFirst = (a: SketchEntity, b: SketchEntity) =>
    (isPointEntity(a) ? -1 : 1) - (isPointEntity(b) ? -1 : 1);
  switch (type) {
    case 'coincident':
    case 'midpoint':
    case 'point-line-distance':
      // [point, other] — solver dispatches on the second target's kind.
      return [...entities].sort(pointFirst).map(e => e.id);
    case 'symmetric':
      // [point, point, line]
      return [...entities].sort(pointFirst).map(e => e.id);
    default:
      return entities.map(e => e.id);
  }
}

@Component({
  selector: 'app-cad-sketch-editor',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatTooltipModule, MatMenuModule],
  template: `
    <div class="sketch-toolbar" data-testid="sketch-toolbar">
      <button class="ribbon-button" data-testid="tool-select" [class.active]="tool() === 'select'" (click)="setTool('select')" matTooltip="Select">
        <mat-icon svgIcon="cad-select"></mat-icon>
        <span class="ribbon-label">Select</span>
      </button>

      <span class="ribbon-divider"></span>

      <!-- Primitives split-button: click main = activate last-used variant;
           click chevron = open the full menu. -->
      <div class="split-button" [class.active]="isInGroup('primitive')" data-testid="group-primitives">
        <button class="ribbon-button split-main"
                [class.active]="isInGroup('primitive')"
                [matTooltip]="primitiveCurrent().tooltip"
                (click)="setTool(lastPrimitiveTool())"
                [disabled]="readonly()">
          <mat-icon [svgIcon]="primitiveCurrent().icon"></mat-icon>
          <span class="ribbon-label">{{ primitiveCurrent().label }}</span>
        </button>
        <button class="split-chevron"
                [matMenuTriggerFor]="primitivesMenu"
                matTooltip="More sketch primitives"
                [disabled]="readonly()"
                data-testid="group-primitives-chevron">
          <mat-icon>arrow_drop_down</mat-icon>
        </button>
      </div>
      <mat-menu #primitivesMenu="matMenu">
        <button *ngFor="let spec of primitiveTools" mat-menu-item
                [attr.data-testid]="'tool-' + spec.tool"
                [class.menu-active]="tool() === spec.tool"
                (click)="setTool(spec.tool)">
          <mat-icon [svgIcon]="spec.icon"></mat-icon>
          <span>{{ spec.label }}</span>
        </button>
      </mat-menu>

      <!-- Circles: circle/arc family (center, 3-pt, ellipse). -->
      <div class="split-button" [class.active]="isInGroup('circle')" data-testid="group-circles">
        <button class="ribbon-button split-main"
                [class.active]="isInGroup('circle')"
                [matTooltip]="circleCurrent().tooltip"
                (click)="setTool(lastCircleTool())"
                [disabled]="readonly()">
          <mat-icon [svgIcon]="circleCurrent().icon"></mat-icon>
          <span class="ribbon-label">{{ circleCurrent().label }}</span>
        </button>
        <button class="split-chevron"
                [matMenuTriggerFor]="circlesMenu"
                matTooltip="More circle &amp; arc tools"
                [disabled]="readonly()"
                data-testid="group-circles-chevron">
          <mat-icon>arrow_drop_down</mat-icon>
        </button>
      </div>
      <mat-menu #circlesMenu="matMenu">
        <button *ngFor="let spec of circleTools" mat-menu-item
                [attr.data-testid]="'tool-' + spec.tool"
                [class.menu-active]="tool() === spec.tool"
                (click)="setTool(spec.tool)">
          <mat-icon [svgIcon]="spec.icon"></mat-icon>
          <span>{{ spec.label }}</span>
        </button>
      </mat-menu>

      <!-- Shapes -->
      <div class="split-button" [class.active]="isInGroup('shape')" data-testid="group-shapes">
        <button class="ribbon-button split-main"
                [class.active]="isInGroup('shape')"
                [matTooltip]="shapeCurrent().tooltip"
                (click)="setTool(lastShapeTool())"
                [disabled]="readonly()">
          <mat-icon [svgIcon]="shapeCurrent().icon"></mat-icon>
          <span class="ribbon-label">{{ shapeCurrent().label }}</span>
        </button>
        <button class="split-chevron"
                [matMenuTriggerFor]="shapesMenu"
                matTooltip="More composite shapes"
                [disabled]="readonly()"
                data-testid="group-shapes-chevron">
          <mat-icon>arrow_drop_down</mat-icon>
        </button>
      </div>
      <mat-menu #shapesMenu="matMenu">
        <button *ngFor="let spec of shapeTools" mat-menu-item
                [attr.data-testid]="'tool-' + spec.tool"
                [class.menu-active]="tool() === spec.tool"
                (click)="setTool(spec.tool)">
          <mat-icon [svgIcon]="spec.icon"></mat-icon>
          <span>{{ spec.label }}</span>
        </button>
      </mat-menu>

      <!-- Edit -->
      <div class="split-button" [class.active]="isInGroup('edit')" data-testid="group-edit">
        <button class="ribbon-button split-main"
                [class.active]="isInGroup('edit')"
                [matTooltip]="editCurrent().tooltip"
                (click)="setTool(lastEditTool())"
                [disabled]="readonly()">
          <mat-icon [svgIcon]="editCurrent().icon"></mat-icon>
          <span class="ribbon-label">{{ editCurrent().label }}</span>
        </button>
        <button class="split-chevron"
                [matMenuTriggerFor]="editMenu"
                matTooltip="More edit tools"
                [disabled]="readonly()"
                data-testid="group-edit-chevron">
          <mat-icon>arrow_drop_down</mat-icon>
        </button>
      </div>
      <mat-menu #editMenu="matMenu">
        <button *ngFor="let spec of editTools" mat-menu-item
                [attr.data-testid]="'tool-' + spec.tool"
                [class.menu-active]="tool() === spec.tool"
                (click)="setTool(spec.tool)">
          <mat-icon [svgIcon]="spec.icon"></mat-icon>
          <span>{{ spec.label }}</span>
        </button>
      </mat-menu>

      <!-- Transform group: Move, Copy, Rotate, Scale. All require entities
           selected before the tool's click is meaningful. -->
      <div class="split-button" [class.active]="isInGroup('transform')" data-testid="group-transform">
        <button class="ribbon-button split-main"
                [class.active]="isInGroup('transform')"
                [matTooltip]="transformCurrent().tooltip"
                (click)="setTool(lastTransformTool())"
                [disabled]="readonly()">
          <mat-icon [svgIcon]="transformCurrent().icon"></mat-icon>
          <span class="ribbon-label">{{ transformCurrent().label }}</span>
        </button>
        <button class="split-chevron"
                [matMenuTriggerFor]="transformMenu"
                matTooltip="More transform tools"
                [disabled]="readonly()"
                data-testid="group-transform-chevron">
          <mat-icon>arrow_drop_down</mat-icon>
        </button>
      </div>
      <mat-menu #transformMenu="matMenu">
        <button *ngFor="let spec of transformTools" mat-menu-item
                [attr.data-testid]="'tool-' + spec.tool"
                [class.menu-active]="tool() === spec.tool"
                (click)="setTool(spec.tool)">
          <mat-icon [svgIcon]="spec.icon"></mat-icon>
          <span>{{ spec.label }}</span>
        </button>
      </mat-menu>

      <span class="ribbon-divider"></span>

      <button class="ribbon-button"
              data-testid="tool-smart-dim"
              [class.active]="tool() === 'smart-dim'"
              (click)="setTool('smart-dim')"
              matTooltip="Smart Dimension — click entities; constraint inferred from selection"
              [disabled]="readonly()">
        <mat-icon svgIcon="cad-smart-dim"></mat-icon>
        <span class="ribbon-label">Smart Dim</span>
      </button>

      <span class="ribbon-divider"></span>

      <!-- Construction: two related buttons.
           1. Toggle the construction flag on the current selection.
           2. Mode toggle — when on, every newly-drawn entity becomes
              construction without a follow-up click. -->
      <button class="ribbon-button"
              data-testid="toggle-construction"
              [disabled]="readonly() || selectedEntities().length === 0"
              (click)="toggleConstruction()"
              [matTooltip]="constructionTooltip()">
        <mat-icon [svgIcon]="constructionIcon()"></mat-icon>
        <span class="ribbon-label">{{ constructionLabel() }}</span>
      </button>
      <button class="ribbon-button"
              data-testid="toggle-draw-construction"
              [class.active]="drawConstruction()"
              (click)="drawConstruction.set(!drawConstruction())"
              matTooltip="Draw as Construction — when on, new geometry comes in as construction (dashed reference)"
              [disabled]="readonly()">
        <mat-icon svgIcon="cad-construction"></mat-icon>
        <span class="ribbon-label">Draw Cons.</span>
      </button>
      <button class="ribbon-button"
              data-testid="break-projection-link"
              [disabled]="readonly() || !hasProjectedSelection()"
              (click)="breakProjectionLink()"
              matTooltip="Break Link — selected projected entity stops tracking its source edge and becomes editable like any other sketch entity">
        <mat-icon svgIcon="cad-break-link"></mat-icon>
        <span class="ribbon-label">Break Link</span>
      </button>
      <!-- REQ 865 — per-user sketch settings (persisted locally). -->
      <button class="ribbon-button"
              data-testid="sketch-settings"
              [matMenuTriggerFor]="sketchSettingsMenu"
              matTooltip="Sketch settings">
        <mat-icon>tune</mat-icon>
        <span class="ribbon-label">Settings</span>
      </button>
      <mat-menu #sketchSettingsMenu="matMenu">
        <button mat-menu-item data-testid="setting-grid-snap"
                (click)="setGridSnap(!gridSnap()); $event.stopPropagation()">
          <mat-icon>{{ gridSnap() ? 'check_box' : 'check_box_outline_blank' }}</mat-icon>
          Grid snap (1 mm)
        </button>
        <button mat-menu-item data-testid="setting-rim-drag-resize"
                (click)="setRimDragResize(!rimDragResize()); $event.stopPropagation()">
          <mat-icon>{{ rimDragResize() ? 'check_box' : 'check_box_outline_blank' }}</mat-icon>
          Rim-drag resizes circles/arcs
        </button>
      </mat-menu>

      <span class="ribbon-divider"></span>

      <button *ngFor="let spec of constraintSpecs"
              class="ribbon-button compact"
              [attr.data-testid]="'constraint-' + spec.type"
              [disabled]="readonly() || !constraintEnabled(spec)"
              (click)="applyConstraint(spec)"
              [matTooltip]="spec.label">
        <mat-icon [svgIcon]="spec.icon"></mat-icon>
      </button>

      <span class="ribbon-divider"></span>

      <!-- REQ 862 — contextual tool parameters, replacing window.prompt.
           Visible while the matching tool is armed; the gesture clicks
           read these signals at commit time. -->
      @switch (tool()) {
        @case ('rotate') {
          <label class="tool-param" data-testid="param-rotate-angle">Angle°
            <input type="number" step="any" [value]="rotateAngleDeg()"
                   (change)="rotateAngleDeg.set(+$any($event.target).value)" /></label>
        }
        @case ('scale') {
          <label class="tool-param" data-testid="param-scale-factor">Factor
            <input type="number" step="any" [value]="scaleFactor()"
                   (change)="scaleFactor.set(+$any($event.target).value)" /></label>
        }
        @case ('pattern-linear') {
          <label class="tool-param" data-testid="param-pattern-count">Count
            <input type="number" min="2" step="1" [value]="patternLinearCount()"
                   (change)="patternLinearCount.set(+$any($event.target).value)" /></label>
        }
        @case ('pattern-circular') {
          <label class="tool-param" data-testid="param-pattern-circ-count">Count
            <input type="number" min="2" step="1" [value]="patternCircCount()"
                   (change)="patternCircCount.set(+$any($event.target).value)" /></label>
          <label class="tool-param" data-testid="param-pattern-circ-sweep">Sweep°
            <input type="number" step="any" [value]="patternCircSweepDeg()"
                   (change)="patternCircSweepDeg.set(+$any($event.target).value)" /></label>
        }
        @case ('polygon') {
          <label class="tool-param" data-testid="param-polygon-sides">Sides
            <input type="number" min="3" step="1" [value]="polygonSides()"
                   (change)="setPolygonSides(+$any($event.target).value)" /></label>
        }
      }

      <span class="status">
        {{ pointCount() }} pts · {{ lineCount() }} lns · DOF {{ dof() }}
        · ({{ cursor().x | number:'1.1-1' }}, {{ cursor().y | number:'1.1-1' }})
      </span>
      <span class="spacer"></span>
      <button class="ribbon-button"
              data-testid="extrude-button"
              *ngIf="canExtrude()"
              [disabled]="readonly()"
              (click)="extrudeRequested.emit()">
        <mat-icon>vertical_align_top</mat-icon>
        <span class="ribbon-label">Extrude</span>
      </button>
      <button class="ribbon-button"
              data-testid="cut-extrude-button"
              *ngIf="canExtrude()"
              [disabled]="readonly()"
              (click)="cutExtrudeRequested.emit()"
              matTooltip="Cut Extrude — subtract the sketched profile from the existing body">
        <mat-icon>vertical_align_bottom</mat-icon>
        <span class="ribbon-label">Cut</span>
      </button>
      <button class="ribbon-button"
              data-testid="revolve-button"
              *ngIf="canExtrude()"
              [disabled]="readonly()"
              (click)="revolveRequested.emit()"
              matTooltip="Revolve — rotate the profile around a sketched line">
        <mat-icon>360</mat-icon>
        <span class="ribbon-label">Revolve</span>
      </button>
    </div>
    <!-- Mirror PropertyManager-style sidebar lives in cad-editor.component
         (it occupies the same column as the constraint list and swaps with
         it when Mirror is active). State + commit/cancel methods live on
         this component and are wired through the #sketchEditor template
         ref. -->
    @if (debugVisible()) {
      <div class="pick-debug">
        <div class="pick-debug-row build">build <b>{{ frontendBuild() }}</b> · kernel <b>{{ kernelBuild() || '—' }}</b></div>
        <div class="pick-debug-row toggle" (click)="toggleInfluence.emit()">[{{ showInfluence() ? '×' : ' ' }}] influence areas</div>
        <div class="pick-debug-row sel">selection: <b>{{ debugSelectionLabel() }}</b></div>
        @if (debugPick(); as dp) {
          <div class="pick-debug-row">cursor ({{ dp.raw.x | number:'1.2-2' }}, {{ dp.raw.y | number:'1.2-2' }}) → round ({{ dp.rounded.x }}, {{ dp.rounded.y }})</div>
          <div class="pick-debug-row">tol curve={{ dp.tol | number:'1.2-2' }} · point={{ dp.ptol | number:'1.2-2' }}</div>
          <div class="pick-debug-row">raw pick: <b>{{ dp.rawWinner }}</b></div>
          <div class="pick-debug-row" [class.mismatch]="dp.rawWinner !== dp.roundWinner">click pick: <b>{{ dp.roundWinner }}</b></div>
          <div class="pick-debug-row">ext pick: <b>{{ dp.extWinner }}</b></div>
          <div class="pick-debug-sep">in range ({{ dp.items.length }}):</div>
          @for (it of dp.items; track it.id) {
            <div class="pick-debug-item" [class.out]="!it.within" [class.ext]="it.kind.startsWith('ext-')">
              {{ it.kind }} {{ it.id.slice(0,12) }} — d={{ it.d | number:'1.2-2' }}{{ it.within ? '' : ' (out)' }}
            </div>
          }
        }
      </div>
    }
  `,
  styles: [`
    /* Sketch toolbar lives inside the parent ribbon's ribbon-pane — the
       parent supplies the 76px fixed height. Styles below mirror the parent's
       ribbon-button class because component view encapsulation prevents shared
       CSS from reaching this template. */
    .sketch-toolbar { display: flex; align-items: stretch; gap: 4px; width: 100%; min-width: max-content; }
    /* DEBUG pick-radius overlay — fixed bottom-right of the viewport,
       raised clear of the editor footer. */
    .pick-debug {
      position: fixed; bottom: 64px; right: 12px; z-index: 1000;
      background: rgba(15, 18, 24, 0.92); color: #cfd8dc;
      font: 11px/1.45 monospace; padding: 8px 10px; border-radius: 6px;
      border: 1px solid #37474f; max-width: 320px; pointer-events: none;
      box-shadow: 0 2px 12px rgba(0,0,0,0.5);
    }
    .pick-debug-row { white-space: nowrap; }
    .pick-debug-row.build { color: #ffd54f; border-bottom: 1px solid #37474f; padding-bottom: 3px; margin-bottom: 3px; }
    .pick-debug-row.toggle { color: #ff80ab; cursor: pointer; pointer-events: auto; user-select: none; font-family: monospace; }
    .pick-debug-row.toggle:hover { color: #ff4081; }
    .pick-debug-row.sel { color: #80cbc4; white-space: normal; }
    .pick-debug-row b { color: #fff; }
    .pick-debug-row.mismatch b { color: #ff7043; }   /* raw vs click pick differ */
    .pick-debug-sep { margin-top: 4px; opacity: 0.6; }
    .pick-debug-item { white-space: nowrap; color: #80cbc4; }
    .pick-debug-item.ext { color: #ffd54f; }          /* projected model geometry */
    .pick-debug-item.out { color: #78909c; opacity: 0.7; }
    .ribbon-divider { width: 1px; align-self: stretch; background: #444; margin: 8px 6px; flex-shrink: 0; }
    .status { font-size: 11px; opacity: 0.7; font-family: monospace; align-self: center; padding: 0 6px; white-space: nowrap; }
    /* REQ 862 — contextual tool-parameter inputs in the ribbon. */
    .tool-param { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; align-self: center; padding: 0 4px; white-space: nowrap; color: #ccc; }
    .tool-param input { width: 56px; background: rgba(255,255,255,0.08); color: #eee; border: 1px solid rgba(255,255,255,0.2); border-radius: 3px; padding: 2px 4px; font-size: 11px; }
    .spacer { flex: 1; }
    .ribbon-button {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 56px;
      height: 64px;
      padding: 4px 2px;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 4px;
      color: #ddd;
      cursor: pointer;
      gap: 2px;
      font-family: inherit;
      flex-shrink: 0;
    }
    .ribbon-button.compact { width: 40px; }
    .ribbon-button mat-icon { font-size: 24px; width: 24px; height: 24px; }
    .ribbon-button.compact mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .ribbon-button .ribbon-label { font-size: 10px; line-height: 1.1; text-align: center; opacity: 0.9; }
    .ribbon-button:hover:not([disabled]) { background: rgba(255,255,255,0.08); }
    .ribbon-button.active { background: rgba(66, 165, 245, 0.22); border-color: #42a5f5; }
    .ribbon-button[disabled] { opacity: 0.35; cursor: not-allowed; }

    /* Split button — primary action on the left, chevron menu trigger on the
       right. Two separate <button> elements share a visual frame via the
       wrapper's border + the children's transparent borders. The :hover and
       .active states flow from the inner buttons. */
    .split-button {
      display: inline-flex;
      align-items: stretch;
      border-radius: 4px;
      border: 1px solid transparent;
      flex-shrink: 0;
    }
    .split-button.active { border-color: #42a5f5; background: rgba(66, 165, 245, 0.22); }
    .split-button .split-main {
      width: 56px;
      height: 64px;
      border-radius: 4px 0 0 4px;
      border-right: 1px solid rgba(255,255,255,0.12);
    }
    .split-button.active .split-main { background: transparent; border-color: transparent; border-right-color: rgba(0,0,0,0.25); }
    .split-button .split-chevron {
      width: 18px;
      height: 64px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: none;
      border-radius: 0 4px 4px 0;
      color: #ddd;
      cursor: pointer;
      padding: 0;
    }
    .split-button .split-chevron:hover:not([disabled]) { background: rgba(255,255,255,0.08); }
    .split-button .split-chevron[disabled] { opacity: 0.35; cursor: not-allowed; }
    .split-button .split-chevron mat-icon { font-size: 20px; width: 20px; height: 20px; }

    /* Highlight the menu item matching the currently-active tool so users
       can see at a glance which variant the split button will activate next. */
    ::ng-deep .mat-mdc-menu-item.menu-active { background: rgba(66, 165, 245, 0.18); }
  `],
})
export class CadSketchEditorComponent implements OnDestroy {
  // Defaults (not `input.required`) so the parent's computeds that read this
  // component's derived signals — e.g. `state()` → `doc()` — don't throw NG0950
  // during the first change-detection pass before the inputs are bound. The
  // editor always binds real values; these are just init-time placeholders.
  sketchId = input<string>('');
  doc = input<SketchDocument>({ sketches: {}, nextSketchSeq: 1 });
  readonly = input<boolean>(false);
  /** Live 2D projections of model vertices/straight edges onto the active
   * sketch plane (computed by cad-editor from the current topology). Used as
   * implicit snap targets so a placed point can reference model geometry
   * without Convert Entities (SolidWorks-style inference). */
  candidates = input<ReferenceCandidate[]>([]);
  /** Debug overlay visibility + build markers (owned by the editor; the
   * pick-debug panel and the build/kernel marker row render only when on). */
  debugVisible = input<boolean>(false);
  /** Whether the pick-influence overlay is shown (sub-toggle in the debug
   * window). Owned by cad-editor; this component just renders the checkbox row
   * and emits toggleInfluence on click. */
  showInfluence = input<boolean>(false);
  toggleInfluence = output<void>();
  frontendBuild = input<string>('');
  kernelBuild = input<string | null>(null);
  sketchChanged = output<SketchState>();
  exitSketch = output<void>();
  extrudeRequested = output<void>();
  /** Cut Extrude shortcut — same gesture as Extrude but the resulting
   * feature is a CutExtrudeFeature. Editor handles via onCutExtrudeRequested. */
  cutExtrudeRequested = output<void>();
  /** Revolve shortcut — opens the Revolve sidebar in cad-editor. */
  revolveRequested = output<void>();
  /** Emitted right after Smart Dim adds a dimensional constraint, carrying
   * the new constraint's id. The parent (cad-editor) sets it as the active
   * dimension to edit so the user can immediately type a different value
   * without a separate click — matches SolidWorks' "place dimension then
   * type number" flow. */
  dimensionCreated = output<string>();

  readonly constraintSpecs = CONSTRAINT_SPECS;
  readonly primitiveTools = PRIMITIVE_TOOLS;
  readonly circleTools = CIRCLE_TOOLS;
  readonly shapeTools = SHAPE_TOOLS;
  readonly editTools = EDIT_TOOLS;
  readonly transformTools = TRANSFORM_TOOLS;

  tool = signal<Tool>('select');
  /** DEBUG: what the cursor's pick "sphere of influence" contains. Shows every
   * sketch entity within the pick tolerance (with its distance), plus what
   * pickEntity returns at the RAW cursor coords (what drag/hover uses) vs the
   * ROUNDED integer coords (what a Select click uses) — so a divergence between
   * the two is visible directly. */
  debugPick = signal<{
    raw: { x: number; y: number };
    rounded: { x: number; y: number };
    tol: number; ptol: number;
    rawWinner: string | null;
    roundWinner: string | null;
    extWinner: string | null;
    items: Array<{ id: string; kind: string; d: number; within: boolean }>;
  } | null>(null);
  /** True when the active tool DRAWS geometry (places points): primitives,
   * circles/arcs, shapes. Used to gate the external-edge snap inference so it
   * only appears while drawing — in Select mode the user picks model edges to
   * relate to instead. */
  isDrawingTool = computed<boolean>(() => {
    const t = this.tool();
    return PRIMITIVE_TOOL_SET.has(t) || CIRCLE_TOOL_SET.has(t) || SHAPE_TOOL_SET.has(t);
  });
  /** True for any tool whose click PLACES a point in the sketch plane — every
   * drawing tool, plus the transform tools (move / copy / rotate / scale /
   * stretch / pattern), whose reference / pivot / destination clicks benefit
   * from snapping. Pure pick / select tools are excluded. Drives whether
   * virtual snaps like line midpoints are offered (they're noise otherwise). */
  placesPoint = computed<boolean>(() => this.isDrawingTool() || TRANSFORM_TOOL_SET.has(this.tool()));
  /** SolidWorks/OnShape-style: a MODEL edge picked in the viewer while in
   * Select mode, held as a relation target alongside the sketch `selected`
   * set. With a single sketch point also selected, Coincident makes that point
   * ride the edge (an on-edge external reference). The id is the topology
   * edgeId. */
  selectedExternalEdgeId = signal<string | null>(null);
  /** Sketch entity under the cursor (pick-tools only), computed with the same
   * pickEntity used for click-selection so the viewer's cyan hover highlight
   * matches exactly what a click would pick. Cleared for drawing tools. */
  hoveredEntityId = signal<string | null>(null);
  /** True when a sketch entity is the closest hoverable thing under the cursor
   * (closer than any projected model edge) — cad-editor reads this to clear the
   * viewer's edge + face-boundary hover so only the sketch entity highlights. */
  sketchHoverWins = signal<boolean>(false);
  /** The single projected model edge the cursor is nearest (when it beats any
   * sketch entity) — cad-editor hands this to the viewer so only that ONE edge
   * highlights, instead of the hovered face's whole boundary loop. */
  hoveredProjectedEdgeId = signal<string | null>(null);
  /** Projected-edge hover buffer (sketch units) handed over by the viewer on
   * each pointer move, so the sketch-vs-edge distance comparison uses the same
   * reach the viewer uses to highlight the edge. */
  private lastEdgeTolerance = 0;
  /** Debug-window readout of the current selection: each picked sketch entity
   * (kind:id) plus any selected model edge. */
  debugSelectionLabel = computed<string>(() => {
    const parts = this.selectedEntities().map(e => `${e.kind}:${e.id.slice(0, 8)}`);
    const ext = this.selectedExternalEdgeId();
    if (ext) parts.push(`ext-edge:${ext.slice(0, 12)}`);
    return parts.length ? parts.join(', ') : '(none)';
  });
  /** Last-used tool per group. The split-button shows this variant's icon /
   * label and clicking the main button activates it. Updated by `setTool`
   * whenever a group member is activated (whether via the main button or
   * the chevron menu). Defaults pick the most common variant. */
  lastPrimitiveTool = signal<Tool>('line');
  lastCircleTool = signal<Tool>('circle');
  lastShapeTool = signal<Tool>('rect-corner');
  lastEditTool = signal<Tool>('trim');
  lastTransformTool = signal<Tool>('move');
  /** Mode toggle — when on, every newly-drawn entity is marked construction
   * on commit. The commit() helper inspects this and applies setConstruction
   * to entities that didn't exist before the commit. */
  drawConstruction = signal<boolean>(false);
  cursor = signal<{ x: number; y: number }>({ x: 0, y: 0 });
  /** Points "armed" as horizontal/vertical inference references during the
   * active drawing-tool gesture (OnShape-style hover-to-arm). A point is armed
   * when the cursor passes over it while a point-placing tool is active; the
   * synthetic origin is implicitly always armed (added by `inferAlignment`).
   * Reset on every tool change. cad-editor reads this to render the inference
   * hint badges + dashed guide lines in the 3D overlay preview. */
  armedRefs = signal<Set<string>>(new Set());
  draftLineStart = signal<string | null>(null);
  draftCircleCenter = signal<PendingPoint | null>(null);
  draftArcCenter = signal<PendingPoint | null>(null);
  draftArcStart = signal<PendingPoint | null>(null);
  // Composite-shape drafts. Each holds the points clicked so far for the
  // current gesture; `clearAllDrafts` resets them all.
  draftRectCorner = signal<PendingPoint | null>(null);          // rect-corner: first corner
  draftRectCenter = signal<PendingPoint | null>(null);          // rect-center: center
  // Rounded rect variants. First click stores the anchor (corner or
  // center); on first use, a prompt collects the corner radius. The
  // radius value persists across draws so the user can chain rounded
  // rects of the same size without re-prompting.
  draftRectRoundedCorner = signal<PendingPoint | null>(null);
  draftRectRoundedCenter = signal<PendingPoint | null>(null);
  roundedRectRadius = signal<number>(5);
  draftPolygonCenter = signal<PendingPoint | null>(null);       // polygon: center
  polygonSides = signal<number>(6);                              // polygon: N (persisted across draws)
  // REQ 862 — contextual tool parameters (ribbon inputs replace window.prompt).
  rotateAngleDeg = signal<number>(90);
  scaleFactor = signal<number>(2);
  patternLinearCount = signal<number>(3);
  patternCircCount = signal<number>(6);
  patternCircSweepDeg = signal<number>(360);
  setPolygonSides(n: number) { this.polygonSides.set(Math.max(3, Math.round(n) || 3)); }
  draftSlotPath = signal<{ p1?: PendingPoint; p2?: PendingPoint }>({});  // slot: 2 centerline endpoints + 1 width click
  // 3-point rectangle (corner variant): 2 clicks define the first edge,
  // 3rd click picks the opposite-side offset.
  draftRect3Corner = signal<PendingPoint[]>([]);
  // 3-point center rectangle: center + side-midpoint + opposite-side-offset.
  draftRect3Center = signal<PendingPoint[]>([]);
  // Parallelogram: 3 corners; 4th derived.
  draftParallelogram = signal<PendingPoint[]>([]);
  // Centerpoint straight slot: 2 clicks define center + one cap, 3rd
  // click picks the perpendicular half-width.
  draftSlotCenterpoint = signal<{ center?: PendingPoint; cap?: PendingPoint }>({});
  // 3-point arc slot: 3 centerline points + 1 width click.
  draftSlotArc3 = signal<PendingPoint[]>([]);
  // Centerpoint arc slot: arc center + start + end + 1 width click.
  draftSlotArcCenterpoint = signal<PendingPoint[]>([]);
  draftCircle3 = signal<PendingPoint[]>([]);                     // circle-3pt: up to 3 points
  draftArc3 = signal<PendingPoint[]>([]);                        // arc-3pt: up to 3 points
  draftEllipse = signal<{ center?: PendingPoint; majorEnd?: PendingPoint }>({});  // ellipse: 2 anchors + 1 minor click
  // Partial ellipse: same first 3 clicks as ellipse (center, major
  // end, minor radius click), then 2 angle clicks (start, end).
  draftPartialEllipse = signal<{ center?: PendingPoint; majorEnd?: PendingPoint; minorRadius?: number; startAngle?: number }>({});
  draftSpline = signal<PendingPoint[]>([]);                     // spline: control points so far
  /** Batch 6 — parabola gesture state. Three clicks: vertex, focus,
   * sample point on the curve. Resets after commit / tool change. */
  draftParabola = signal<{ vertex?: PendingPoint; focus?: PendingPoint }>({});
  /** Batch 6 — text-tool first-corner state for drag-out rectangle. */
  draftTextRect = signal<PendingPoint | null>(null);
  /** Batch 6 — picture-tool pending image (loaded ahead of the
   * anchor click). When set, the next click anchors the image at
   * (x, y). */
  pendingPictureSrc = signal<{ src: string; pxW: number; pxH: number } | null>(null);
  /** Style Spline shares draftSpline but also tracks the chosen
   * degree for the current gesture. Persists across draws so the
   * user keeps the last-picked degree without re-typing. */
  styleSplineDegree = signal<number>(3);
  draftCirclePerimeter = signal<PendingPoint | null>(null);     // perimeter circle: first diameter endpoint
  draftTangentArc = signal<{ tangentPointId: string } | null>(null);  // tangent arc: the picked endpoint
  selected = signal<Set<string>>(new Set());

  // Drag-to-move state. Set on pointer-down over any draggable entity.
  // Stores the ORIGINAL position of every point the dragged entity controls
  // (a line controls both endpoints; a circle/arc controls its center+
  // endpoints; etc.) so move = translate each by the same cursor delta.
  // `isDragging` stays false until the cursor moves more than DRAG_THRESHOLD
  // sketch units — a stationary press-release still resolves as a click.
  private dragState = signal<{
    /** Captured at pointer-down — used to compute each frame's drag-point
     * position as `origPos + cursorDelta`. The non-dragged points warm-
     * start from the previous frame's solver result via `this.state()`,
     * which keeps the solver in the same convergence basin across frames
     * (cold-starting from a snapshot each frame causes visible jitter on
     * under-determined systems like a free-floating equal-sided square). */
    points: Array<{ id: string; origX: number; origY: number }>;
    startCursor: { x: number; y: number };
    isDragging: boolean;
  } | null>(null);
  // Rubber-band selection rectangle. Set on pointer-down over empty space.
  rubberBand = signal<{ start: { x: number; y: number }; current: { x: number; y: number } } | null>(null);

  // ── REQ 865 — per-user sketch settings (localStorage-persisted) ──────────
  /** Grid snap (default ON): drawing tools + drag commits round new
   * coordinates to integer mm. Off = continuous coordinates (SW/Onshape). */
  gridSnap = signal<boolean>(typeof localStorage === 'undefined' || localStorage.getItem('sketchGridSnap') !== 'off');
  /** Rim-drag resize (default OFF): dragging a circle/arc rim resizes its
   * radius about a fixed center instead of translating the whole curve. */
  rimDragResize = signal<boolean>(typeof localStorage !== 'undefined' && localStorage.getItem('sketchRimDragResize') === 'on');
  setGridSnap(on: boolean) {
    this.gridSnap.set(on);
    try { localStorage.setItem('sketchGridSnap', on ? 'on' : 'off'); } catch { /* private mode */ }
  }
  setRimDragResize(on: boolean) {
    this.rimDragResize.set(on);
    try { localStorage.setItem('sketchRimDragResize', on ? 'on' : 'off'); } catch { /* private mode */ }
  }
  /** Drawing-tool coordinate snap — integer grid when enabled (REQ 865). */
  private _snap(n: number): number { return this.gridSnap() ? Math.round(n) : n; }
  /** Active rim-resize gesture (REQ 865, rimDragResize on). */
  private radiusDrag = signal<{ entityId: string; isDragging: boolean; start: { x: number; y: number } } | null>(null);
  // Async-solver generation counter for live drag solves. Each pointermove
  // bumps it; only the latest solve's result is applied (race-free).
  private dragSolveGen = 0;
  // Set true on mouseup at the end of a drag (point drag or rubber-band) so
  // the subsequent (click) event is suppressed.
  private didDrag = false;

  // REQ 629 — parent inspects this to decide whether to apply snap to incoming
  // pointer-move events. Snap during drag would yank the dragged point onto
  // every nearby vertex, which is more noise than help.
  isDragging(): boolean {
    return !!this.dragState()?.isDragging;
  }

  state = computed<SketchState>(() => this.doc().sketches[this.sketchId()]?.state ?? emptySketchState());

  points = computed<PointEntity[]>(() => pointsOf(this.state()));
  lines = computed<LineEntity[]>(() => linesOf(this.state()));
  circles = computed<CircleEntity[]>(() =>
    this.state().entities.filter((e): e is CircleEntity => e.kind === 'circle'),
  );
  arcs = computed<ArcEntity[]>(() =>
    this.state().entities.filter((e): e is ArcEntity => e.kind === 'arc'),
  );
  pointCount = computed(() => this.points().filter(p => !p.construction).length);
  lineCount = computed(() => this.lines().filter(l => !l.construction).length);
  /** Last DOF reported by the solver. The naive `points*2 − constraints`
   * count we used before was wildly wrong — some constraints consume 0 or
   * 2 DOFs, arcs carry their own radius DOF, etc. — so the DOF readout
   * (and the green "fully constrained" stroke) lied for many real sketches.
   * The PlaneGCS solver tracks this correctly via its constraint graph; we
   * just plumb its number through. `null` before the first solve runs. */
  private solverDof = signal<number | null>(null);
  dof = computed(() => {
    const sd = this.solverDof();
    if (sd !== null) return sd;
    // Fallback for the brief window before the first solve completes.
    return Math.max(0, this.pointCount() * 2 - this.state().constraints.length);
  });
  /** Last solver outcome. 'ok' as long as the solver converges; flips to
   * 'inconsistent' when the most recent commit() couldn't satisfy all
   * constraints (over-constrained or contradictory). */
  solveStatus = signal<'ok' | 'inconsistent'>('ok');
  /** REQ 860: constraint ids named by the last failed solve (PlaneGCS
   * conflicting-constraint diagnostics). Empty while the solve is ok or
   * when the solver couldn't name specific constraints. */
  conflictingConstraints = signal<Set<string>>(new Set());
  /** Record a solve outcome: status + DOF + conflicting-constraint ids. */
  private _recordSolve(r: { status: 'ok' | 'inconsistent'; dof: number; conflicting?: string[] }): void {
    this.solveStatus.set(r.status);
    this.solverDof.set(r.dof);
    this.conflictingConstraints.set(new Set(r.status === 'inconsistent' ? (r.conflicting ?? []) : []));
  }
  /** 'under' = remaining DOF, 'fixed' = sketch is fully constrained,
   * 'over' = solver reported inconsistency. The renderer swaps the sketch
   * stroke color based on this (blue / green / red). */
  dofState = computed<'under' | 'fixed' | 'over'>(() => {
    if (this.solveStatus() === 'inconsistent') return 'over';
    return this.dof() === 0 ? 'fixed' : 'under';
  });

  /** Per-entity determinacy. Drives the viewer's green/blue coloring on
   * an entity-by-entity basis (SW-style) instead of one monolithic flag
   * for the whole sketch. */
  determinedEntities = computed<Set<string>>(() => analyzeDeterminacy(this.state(), this._externalEdgeLines()));

  // Selected entities resolved in click order. Constraint predicates run on this.
  selectedEntities = computed<SketchEntity[]>(() => {
    const ids = Array.from(this.selected());
    const map = new Map(this.state().entities.map(e => [e.id, e]));
    return ids.map(id => map.get(id)).filter((e): e is SketchEntity => !!e);
  });

  draftArcRadius = computed<number | null>(() => {
    const c = this.draftArcCenter(), s = this.draftArcStart();
    return c && s ? Math.hypot(s.x - c.x, s.y - c.y) : null;
  });

  canExtrude = computed(() => {
    return extractClosedLoops(this.state()).loops.length > 0;
  });

  private latestCommitId = 0;
  // Tracks insertion order for the selection Set (Sets preserve insertion order
  // when entries aren't deleted-and-readded, which is what `setSelection` does).
  //
  // Each entry clears every OTHER tool's draft state so an in-flight gesture
  // doesn't leak across tool switches. Default fallthrough (no entry for the
  // tool) clears nothing — used by polygon/spline where multi-step state is
  // managed inside the handler.
  private readonly clearDraftsForTool = new Map<Tool, () => void>([
    ['select', () => { this.clearAllDrafts(); }],
    ['point', () => { this.clearAllDrafts(); }],
    ['line', () => { this.clearAllDraftsExcept(['line']); }],
    // Centerline + Midpoint Line share `draftLineStart` with the plain
    // Line tool; the `mode` arg in handleLineClick controls what gets
    // emitted on commit. Keeping the draft alive across the variants
    // lets the user switch tools mid-chain without losing their start.
    ['centerline',     () => { this.clearAllDraftsExcept(['centerline']); }],
    ['midpoint-line',  () => { this.clearAllDraftsExcept(['midpoint-line']); }],
    ['circle', () => { this.clearAllDraftsExcept(['circle']); }],
    ['arc', () => { this.clearAllDraftsExcept(['arc']); }],
    ['rect-corner', () => { this.clearAllDraftsExcept(['rect-corner']); }],
    ['rect-center', () => { this.clearAllDraftsExcept(['rect-center']); }],
    ['rect-3pt-corner', () => { this.clearAllDraftsExcept(['rect-3pt-corner']); }],
    ['rect-3pt-center', () => { this.clearAllDraftsExcept(['rect-3pt-center']); }],
    ['parallelogram',   () => { this.clearAllDraftsExcept(['parallelogram']); }],
    ['polygon', () => { this.clearAllDraftsExcept(['polygon']); }],
    ['slot', () => { this.clearAllDraftsExcept(['slot']); }],
    ['slot-centerpoint',     () => { this.clearAllDraftsExcept(['slot-centerpoint']); }],
    ['slot-arc-3pt',         () => { this.clearAllDraftsExcept(['slot-arc-3pt']); }],
    ['slot-arc-centerpoint', () => { this.clearAllDraftsExcept(['slot-arc-centerpoint']); }],
    ['circle-3pt', () => { this.clearAllDraftsExcept(['circle-3pt']); }],
    ['arc-3pt', () => { this.clearAllDraftsExcept(['arc-3pt']); }],
    ['ellipse', () => { this.clearAllDraftsExcept(['ellipse']); }],
    ['partial-ellipse', () => { this.clearAllDraftsExcept(['partial-ellipse']); }],
    ['spline', () => { this.clearAllDraftsExcept(['spline']); }],
    ['style-spline', () => { this.clearAllDraftsExcept(['style-spline']); }],
    ['circle-perimeter', () => { this.clearAllDraftsExcept(['circle-perimeter']); }],
    ['tangent-arc', () => { this.clearAllDraftsExcept(['tangent-arc']); }],
    // Smart-dim accumulates into the selection signal rather than a tool-
    // specific draft, so just clear other tools' drafts.
    ['smart-dim', () => { this.clearAllDraftsExcept([]); }],
    // Edit tools have no draft state — each click commits immediately. Just
    // wipe other tools' in-flight drafts on entry.
    ['trim',    () => { this.clearAllDraftsExcept([]); }],
    ['extend',  () => { this.clearAllDraftsExcept([]); }],
    ['fillet',  () => { this.clearAllDraftsExcept([]); }],
    ['chamfer', () => { this.clearAllDraftsExcept([]); }],
    ['split',   () => { this.clearAllDraftsExcept([]); }],
    ['offset',  () => { this.clearAllDraftsExcept([]); }],
    ['mirror',  () => { this.clearAllDraftsExcept([]); }],
    ['move',    () => { this.clearAllDraftsExcept([]); }],
    ['copy',    () => { this.clearAllDraftsExcept([]); }],
    ['rotate',  () => { this.clearAllDraftsExcept([]); }],
    ['scale',   () => { this.clearAllDraftsExcept([]); }],
  ]);

  /** Offset sidebar state — distance, the curves queued for the batch
   * commit (each with the cursor position that picked it, used as the
   * sidePoint when computing which side to offset toward), and
   * toggles for chain auto-selection and keep-original-as-construction.
   *
   * Public so the cad-editor template can bind to them — same pattern
   * as fillet / chamfer / mirror. */
  offsetDistance = signal<number>(5);
  offsetSelections = signal<Map<string, { sidePoint: { x: number; y: number } }>>(new Map());
  /** When true, clicking one curve auto-extends the selection through
   * every chain-connected curve via shared endpoints. Lets the user
   * offset a whole polyline / closed loop in one click. Defaults ON
   * — matches SolidWorks' "Select chain" default. */
  offsetChainMode = signal<boolean>(true);
  /** Optional: flag the original curves as construction after the
   * offset commits — useful when the offset is the working geometry
   * and the user wants to keep the original as a dashed reference. */
  offsetKeepConstruction = signal<boolean>(false);
  /** When true, the commit produces an offset on BOTH sides of every
   * queued curve. SolidWorks "Bi-directional" option. */
  offsetBothDirections = signal<boolean>(false);
  /** When true, convex chain corners get an arc filler (radius =
   * offset distance, centered at the original vertex). When false,
   * convex corners get a sharp extension to the line-line
   * intersection. SW default = on. */
  offsetFillCorners = signal<boolean>(true);
  /** Fillet sidebar state — radius value (mm), the set of corner-point
   * ids queued for the batch commit, and the "keep removed as
   * construction" toggle. Public so the sidebar template (rendered up in
   * cad-editor) can read + write them directly. */
  filletRadius = signal<number | null>(null);
  filletCorners = signal<Set<string>>(new Set());
  /** Default OFF for fillet — the rounded arc usually replaces the
   * original corner cleanly and users don't want dashed clutter. */
  filletKeepConstruction = signal<boolean>(false);
  /** Chamfer is the same shape — distance + corner set + toggle. */
  chamferDistance = signal<number | null>(null);
  chamferCorners = signal<Set<string>>(new Set());
  /** Default ON for chamfer — manufacturing-wise the original corner
   * geometry is still meaningful as a reference (e.g., to dimension the
   * leg length from the corner), so keeping it dashed is the common
   * SW default. */
  chamferKeepConstruction = signal<boolean>(true);
  /** Chamfer mode — 'equal' (same leg distance on each side), 'dist-dist'
   * (independent leg distances per line), 'dist-angle' (one leg distance
   * + an angle measured from one of the lines). */
  chamferModeKind = signal<'equal' | 'dist-dist' | 'dist-angle'>('equal');
  /** Second distance for 'dist-dist' mode. Defaults to the same value as
   * the primary distance on tool entry. */
  chamferDistance2 = signal<number | null>(null);
  /** Angle (degrees) for 'dist-angle' mode. */
  chamferAngleDeg = signal<number | null>(null);
  /** Which line is the reference ("primary") for 'dist-angle' mode. The
   * Flip button toggles this between 1 and 2. */
  chamferPrimaryLine = signal<1 | 2>(1);

  /** Resolve the sidebar's mode-related signals into a single ChamferMode
   * object for `chamferLines` and `computeChamferGeometry`. */
  currentChamferMode(): ChamferMode {
    const d1 = this.chamferDistance() ?? 5;
    const d2 = this.chamferDistance2() ?? d1;
    const ang = ((this.chamferAngleDeg() ?? 45) * Math.PI) / 180;
    switch (this.chamferModeKind()) {
      case 'equal':       return { kind: 'equal-distance', distance: d1 };
      case 'dist-dist':   return { kind: 'distance-distance', distance1: d1, distance2: d2 };
      case 'dist-angle':  return { kind: 'distance-angle', distance: d1, angleRad: ang, primary: this.chamferPrimaryLine() };
    }
  }
  /** Reference-point pick for the Move / Copy two-click gesture. After the
   * first click stores a point here, the second click computes delta and
   * commits. */
  private draftMoveRef = signal<{ x: number; y: number } | null>(null);
  private draftCopyRef = signal<{ x: number; y: number } | null>(null);
  /** Stretch: same two-click gesture as move, but only translates the
   * POINTS in the selection (so attached lines stretch). */
  private draftStretchRef = signal<{ x: number; y: number } | null>(null);
  /** Jog Line: three-click gesture — click 1 picks the line, clicks 2
   * and 3 pick the jog start (with perpendicular offset baked in) and
   * jog end (along the line). */
  private draftJog = signal<{ lineId?: string; start?: { x: number; y: number } }>({});
  /** Linear pattern: stores the first click (direction-from) of the
   * direction vector; the second click sets direction-to + spacing. */
  private draftPatternRef = signal<{ x: number; y: number } | null>(null);
  /** Dynamic mirror axis line id. Null means dynamic mirror is OFF;
   * set means every subsequent draw commit gets mirrored across the
   * named line. The tool button toggles this on/off. */
  dynamicMirrorAxisId = signal<string | null>(null);

  /** Mirror tool state machine. The Mirror panel exposes two fields that
   * accept different clicks based on which stage is active:
   *   'pick-entities' — each click toggles an entity in `selected()`.
   *   'pick-axis'     — the next click sets `mirrorAxisId` to a line.
   * 'idle' is unused at runtime but kept as a guard for code paths that
   * read the signal outside the Mirror tool. */
  mirrorStage = signal<'pick-entities' | 'pick-axis'>('pick-entities');
  mirrorAxisId = signal<string | null>(null);
  /** Selected entities filtered down to those still eligible to mirror —
   * excludes whatever the user picked as the axis. Drives the entity-row
   * list in the Mirror panel. */
  mirrorEntitiesToShow = computed<SketchEntity[]>(() => {
    const axisId = this.mirrorAxisId();
    return this.selectedEntities().filter(e => e.id !== axisId);
  });
  /** Resolved axis entity for the panel's axis row, or null when the user
   * hasn't picked yet. */
  mirrorAxisEntity = computed<SketchEntity | null>(() => {
    const id = this.mirrorAxisId();
    if (!id) return null;
    return findEntity(this.state(), id) ?? null;
  });

  private clearAllDraftsExcept(keep: Tool[]) {
    const k = new Set<Tool>(keep);
    // Line, centerline, and midpoint-line all share `draftLineStart`
    // so the user can switch between them mid-chain without dropping
    // their pending start point.
    if (!k.has('line') && !k.has('centerline') && !k.has('midpoint-line')) this.draftLineStart.set(null);
    if (!k.has('circle')) this.draftCircleCenter.set(null);
    if (!k.has('arc')) { this.draftArcCenter.set(null); this.draftArcStart.set(null); }
    if (!k.has('rect-corner')) this.draftRectCorner.set(null);
    if (!k.has('rect-center')) this.draftRectCenter.set(null);
    if (!k.has('rect-rounded-corner')) this.draftRectRoundedCorner.set(null);
    if (!k.has('rect-rounded-center')) this.draftRectRoundedCenter.set(null);
    if (!k.has('rect-3pt-corner')) this.draftRect3Corner.set([]);
    if (!k.has('rect-3pt-center')) this.draftRect3Center.set([]);
    if (!k.has('parallelogram')) this.draftParallelogram.set([]);
    if (!k.has('polygon')) this.draftPolygonCenter.set(null);
    if (!k.has('slot')) this.draftSlotPath.set({});
    if (!k.has('slot-centerpoint')) this.draftSlotCenterpoint.set({});
    if (!k.has('slot-arc-3pt')) this.draftSlotArc3.set([]);
    if (!k.has('slot-arc-centerpoint')) this.draftSlotArcCenterpoint.set([]);
    if (!k.has('circle-3pt')) this.draftCircle3.set([]);
    if (!k.has('arc-3pt')) this.draftArc3.set([]);
    if (!k.has('ellipse')) this.draftEllipse.set({});
    if (!k.has('partial-ellipse')) this.draftPartialEllipse.set({});
    // Spline and style-spline share `draftSpline` so switching between
    // them mid-gesture preserves the placed control points.
    if (!k.has('spline') && !k.has('style-spline')) this.draftSpline.set([]);
    if (!k.has('circle-perimeter')) this.draftCirclePerimeter.set(null);
    if (!k.has('tangent-arc')) this.draftTangentArc.set(null);
    if (!k.has('parabola')) this.draftParabola.set({});
    if (!k.has('text')) this.draftTextRect.set(null);
    if (!k.has('picture')) this.pendingPictureSrc.set(null);
  }

  constructor() {
    // Register custom CAD icons once for the whole component tree.
    // Idempotent — safe across HMR + test setup.
    registerCadIcons(inject(MatIconRegistry), inject(DomSanitizer));
    // Refresh the solver DOF when the projected edge geometry for edge-ride
    // points becomes available (candidates load on regen) or changes. Without
    // this, a sketch whose on-edge points were last solved before its
    // candidates loaded keeps a stale, over-pinned DOF — e.g. falsely reads
    // "fully constrained" when its endpoints can still slide along their edges.
    // Only re-solves when there are edge-ref points whose edge is now known.
    effect(() => {
      const edges = this._externalEdgeLines();  // dep: re-fire when candidates change
      untracked(() => {
        const st = this.state();
        const hasEdgeRide = st.constraints.some(c =>
          c.type === 'on-edge' && c.externalRef && c.externalRef.scope !== 'cross-part'
          && !!c.externalRef.edgeId && edges.has(c.externalRef.edgeId)
          && c.targets.some(t => st.entities.find(e => e.id === t.entityId)?.kind === 'point'));
        if (!hasEdgeRide) return;
        const gen = this.latestCommitId;  // a real commit during the probe supersedes us
        solveSketch(st, { externalEdges: edges }).then(r => {
          if (this.latestCommitId !== gen) return;
          this._recordSolve(r);
        });
      });
    });
    effect(() => {
      const tool = this.tool();
      // Everything inside `untracked` runs without registering the read
      // signals as dependencies of this effect. We only want this whole
      // block to re-fire when the TOOL itself changes — not when sidebar
      // signals like `filletRadius` change (the bug being fixed: editing
      // the radius input wiped the corner list because the effect kept
      // re-running and re-seeding the corners from the now-empty
      // selection).
      untracked(() => {
      this.clearDraftsForTool.get(tool)?.();
      // Drop hover-armed H/V inference references — arming is scoped to a
      // single tool gesture (REQ 826), so switching tools starts fresh.
      this.armedRefs.set(new Set());
      // Selection persists in tools that consume it: 'select' (obvious),
      // 'smart-dim' (accumulates entities until the selection matches a
      // recognized dimension pattern), 'mirror' (entities pre-selected in
      // Select are what gets mirrored), 'fillet' (pre-selected corner
      // points get batch-filleted with the same radius), and the
      // Transform tools (move / copy / rotate / scale all operate on
      // pre-selection).
      const preservesSelection = tool === 'select' || tool === 'smart-dim' || tool === 'mirror'
        || tool === 'fillet' || tool === 'chamfer' || TRANSFORM_TOOL_SET.has(tool);
      if (!preservesSelection) this.selected.set(new Set());
      // Offset sidebar: seed defaults on entry, clear queue on exit.
      // Distance persists across re-entry (common dim value during a
      // session); the curve queue resets so each entry starts clean.
      if (tool === 'offset') {
        if (this.offsetDistance() <= 0) this.offsetDistance.set(5);
      } else {
        this.offsetSelections.set(new Map());
        this.offsetChainMode.set(true);  // reset to SW-default ON
        this.offsetKeepConstruction.set(false);
        this.offsetBothDirections.set(false);
        // Don't reset offsetFillCorners — SW-style corner fill is
        // the user's preference, persists across tool entries.
      }
      // Fillet & Chamfer: PropertyManager-style sidebars (see Mirror for
      // the pattern). On entry, default the dimension value if unset and
      // seed the corner list from any pre-selection of corner points. On
      // exit, drop the corner list so a fresh entry starts clean.
      if (tool === 'fillet') {
        if (this.filletRadius() === null) this.filletRadius.set(5);
        this.filletCorners.set(new Set(this.cornersInSelection()));
      } else {
        this.filletRadius.set(null);
        this.filletCorners.set(new Set());
      }
      if (tool === 'chamfer') {
        if (this.chamferDistance() === null) this.chamferDistance.set(5);
        if (this.chamferDistance2() === null) this.chamferDistance2.set(this.chamferDistance() ?? 5);
        if (this.chamferAngleDeg() === null) this.chamferAngleDeg.set(45);
        this.chamferCorners.set(new Set(this.cornersInSelection()));
      } else {
        this.chamferDistance.set(null);
        this.chamferDistance2.set(null);
        this.chamferAngleDeg.set(null);
        this.chamferModeKind.set('equal');
        this.chamferPrimaryLine.set(1);
        this.chamferCorners.set(new Set());
      }
      // Move/Copy reset their in-flight reference-point pick on tool exit.
      if (tool !== 'move') this.draftMoveRef.set(null);
      if (tool !== 'copy') this.draftCopyRef.set(null);
      if (tool !== 'stretch') this.draftStretchRef.set(null);
      if (tool !== 'pattern-linear') this.draftPatternRef.set(null);
      if (tool !== 'jog') this.draftJog.set({});
      // Mirror's two-stage panel resets each time the user re-enters it.
      // Leaving Mirror also clears the axis selection so a stray previous
      // pick doesn't carry over to a new gesture.
      if (tool === 'mirror') {
        this.mirrorStage.set('pick-entities');
        this.mirrorAxisId.set(null);
      } else {
        this.mirrorAxisId.set(null);
      }
      });  // end untracked
    });
  }

  ngOnDestroy() { this.clearAllDrafts(); this.selected.set(new Set()); }

  setTool(t: Tool) {
    this.tool.set(t);
    // A selected model edge is a Select-mode relation target; leaving Select
    // drops it so it can't linger into a drawing gesture.
    if (t !== 'select') this.selectedExternalEdgeId.set(null);
    // Update last-used so the corresponding split-button main shows the
    // freshly-activated variant the next time the user opens that group.
    if (PRIMITIVE_TOOL_SET.has(t)) this.lastPrimitiveTool.set(t);
    else if (CIRCLE_TOOL_SET.has(t)) this.lastCircleTool.set(t);
    else if (SHAPE_TOOL_SET.has(t)) this.lastShapeTool.set(t);
    else if (EDIT_TOOL_SET.has(t)) this.lastEditTool.set(t);
    else if (TRANSFORM_TOOL_SET.has(t)) this.lastTransformTool.set(t);
  }

  /** Toggle a model edge as the Select-mode relation target (called by
   * cad-editor when an edge is picked in the viewer while sketching in Select
   * mode). Clicking the same edge again clears it. */
  toggleExternalEdge(edgeId: string): void {
    this.selectedExternalEdgeId.set(this.selectedExternalEdgeId() === edgeId ? null : edgeId);
  }

  /** Externally toggle an entity in the selection set. The cad-editor calls
   * this when a clicked 3D body edge auto-converts into a projected sketch
   * entity in select mode — joining the selection ADDITIVELY (like
   * shift-click) so circle + projected edge → Concentric works without
   * keyboard gymnastics. Re-clicking the same edge deselects it. Sets in
   * signals need replacement, not mutation. */
  selectEntityExternal(id: string): void {
    const next = new Set(this.selected());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selected.set(next);
  }

  /** True when the currently-active tool belongs to the given split-button
   * group. Drives the active-state highlight on the group's frame. */
  isInGroup(group: 'primitive' | 'circle' | 'shape' | 'edit' | 'transform'): boolean {
    const t = this.tool();
    if (group === 'primitive') return PRIMITIVE_TOOL_SET.has(t);
    if (group === 'circle') return CIRCLE_TOOL_SET.has(t);
    if (group === 'shape') return SHAPE_TOOL_SET.has(t);
    if (group === 'edit') return EDIT_TOOL_SET.has(t);
    return TRANSFORM_TOOL_SET.has(t);
  }

  primitiveCurrent = computed(() =>
    PRIMITIVE_TOOLS.find(s => s.tool === this.lastPrimitiveTool()) ?? PRIMITIVE_TOOLS[1],
  );
  circleCurrent = computed(() =>
    CIRCLE_TOOLS.find(s => s.tool === this.lastCircleTool()) ?? CIRCLE_TOOLS[0],
  );
  shapeCurrent = computed(() =>
    SHAPE_TOOLS.find(s => s.tool === this.lastShapeTool()) ?? SHAPE_TOOLS[0],
  );
  editCurrent = computed(() =>
    EDIT_TOOLS.find(s => s.tool === this.lastEditTool()) ?? EDIT_TOOLS[0],
  );
  transformCurrent = computed(() =>
    TRANSFORM_TOOLS.find(s => s.tool === this.lastTransformTool()) ?? TRANSFORM_TOOLS[0],
  );

  // REQ 632 / 633 — single document-level keydown listener so we can both
  // (a) ignore the keystroke when the user is typing in a text input and
  // (b) suppress the browser's Backspace-back navigation when the sketcher
  // consumes the key.
  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(ev: KeyboardEvent) {
    const target = ev.target as HTMLElement | null;
    if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return;

    if (ev.key === 'Escape') {
      // REQ 633 — Esc cancels any in-flight tool gesture, CLEARS THE SELECTION
      // (entities + tool-specific queues), and returns to the Select tool. It
      // does NOT exit the sketch.
      this.clearAllDrafts();
      this.filletCorners.set(new Set());
      this.chamferCorners.set(new Set());
      this.offsetSelections.set(new Map());
      this.mirrorAxisId.set(null);
      this.selected.set(new Set());
      this.dragState.set(null);
      this.rubberBand.set(null);
      this.tool.set('select');
      return;
    }

    if (ev.key === 'Enter' && this.tool() === 'spline') {
      this.commitSplineIfReady();
      return;
    }

    if ((ev.key === 'Delete' || ev.key === 'Backspace') && this.selected().size > 0) {
      // REQ 632 — Delete / Backspace removes every selected sketch entity.
      if (this.readonly()) return;
      ev.preventDefault();  // also stops Backspace from triggering browser-back
      this.deleteSelected();
      return;
    }

    if (ev.key === 'Tab' && !ev.shiftKey && !ev.altKey && !ev.metaKey) {
      // Cycle between variants of the current tool (corner ↔ center
      // rectangle, center-end ↔ 3-point arc, etc.). Mirrors the
      // SolidWorks "Sketch > Variants" muscle memory and matches the
      // panel-tab key on the desktop.
      const cycled = this.cycleToolVariant();
      if (cycled) { ev.preventDefault(); return; }
    }

    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey && ev.key.toLowerCase() === 'a') {
      // Ctrl/⌘+A — select every entity in the current sketch. Skips
      // ephemeral draft entities (those have non-stored ids and don't
      // belong in the selection set). Same handler runs for both keys
      // so Mac users get the platform-native shortcut.
      ev.preventDefault();
      this.selected.set(new Set(this.state().entities.map(e => e.id)));
      return;
    }

    if (this.readonly()) return;
    if (this.applySketchShortcut(ev)) ev.preventDefault();
  }

  /** Maps single-key (and a few Shift+key) presses to sketch tools.
   * Returns true when the key was handled — caller preventDefault()s.
   * Keys roughly match the SolidWorks community convention; if a tool
   * has no obvious letter it's omitted (use the toolbar). */
  private applySketchShortcut(ev: KeyboardEvent): boolean {
    if (ev.ctrlKey || ev.altKey || ev.metaKey) return false;
    const k = ev.key.toLowerCase();
    if (ev.shiftKey) {
      // Shift+letter holds the modifier-bearing transforms so they don't
      // collide with the more frequently used Copy/Rotate/Scale primaries.
      switch (k) {
        case 'c': this.tool.set('copy');   return true;
        case 'r': this.tool.set('rotate'); return true;
        case 's': this.tool.set('scale');  return true;
        default:  return false;
      }
    }
    switch (k) {
      case 'l': this.tool.set('line');         return true;
      case 'c': this.tool.set('circle');       return true;
      case 'r': this.tool.set('rect-corner');  return true;
      case 'a': this.tool.set('arc');          return true;
      case 'p': this.tool.set('point');        return true;
      case 'e': this.tool.set('ellipse');      return true;
      case 's': this.tool.set('spline');       return true;
      case 'y': this.tool.set('polygon');      return true;
      case 't': this.tool.set('trim');         return true;
      case 'x': this.tool.set('extend');       return true;
      case 'f': this.tool.set('fillet');       return true;
      case 'h': this.tool.set('chamfer');      return true;
      case 'm': this.tool.set('mirror');       return true;
      case 'o': this.tool.set('offset');       return true;
      case 'd': this.tool.set('smart-dim');    return true;
      case 'v': this.tool.set('move');         return true;
      default:  return false;
    }
  }

  /** Tab while a tool with multiple variants is active flips to the next
   * one in the cycle. Returns true when something changed (so the caller
   * can preventDefault the tab key from moving focus). */
  private cycleToolVariant(): boolean {
    const cycles: Record<string, Tool> = {
      'rect-corner': 'rect-center',
      'rect-center': 'rect-corner',
      'arc':         'arc-3pt',
      'arc-3pt':     'tangent-arc',
      'tangent-arc': 'arc',
      'circle':            'circle-3pt',
      'circle-3pt':        'circle-perimeter',
      'circle-perimeter':  'circle',
    };
    const next = cycles[this.tool()];
    if (!next) return false;
    this.tool.set(next);
    return true;
  }

  private deleteSelected() {
    let state = this.state();
    for (const id of this.selected()) {
      state = deletePrimitive(state, id);
    }
    this.selected.set(new Set());
    this.dragState.set(null);
    this.rubberBand.set(null);
    this.commit(state);
  }

  private clearAllDrafts() {
    this.draftLineStart.set(null);
    this.draftCircleCenter.set(null);
    this.draftArcCenter.set(null);
    this.draftArcStart.set(null);
    this.draftRectCorner.set(null);
    this.draftRectCenter.set(null);
    this.draftRectRoundedCorner.set(null);
    this.draftRectRoundedCenter.set(null);
    this.draftRect3Corner.set([]);
    this.draftRect3Center.set([]);
    this.draftParallelogram.set([]);
    this.draftPolygonCenter.set(null);
    this.draftSlotPath.set({});
    this.draftSlotCenterpoint.set({});
    this.draftSlotArc3.set([]);
    this.draftSlotArcCenterpoint.set([]);
    this.draftCircle3.set([]);
    this.draftArc3.set([]);
    this.draftEllipse.set({});
    this.draftPartialEllipse.set({});
    this.draftSpline.set([]);
    this.draftCirclePerimeter.set(null);
    this.draftTangentArc.set(null);
    this.draftParabola.set({});
    this.draftTextRect.set(null);
    this.pendingPictureSrc.set(null);
  }

  strokeFor(e: SketchEntity): string {
    if (this.selected().has(e.id)) return '#ffb74d';
    if (e.construction) return '#888';
    return '#42a5f5';
  }

  ptX(id: string): number { return findPoint(this.state(), id)?.x ?? 0; }
  ptY(id: string): number { return findPoint(this.state(), id)?.y ?? 0; }

  arcPath(a: ArcEntity): string {
    const s = findPoint(this.state(), a.startId);
    const e = findPoint(this.state(), a.endId);
    if (!s || !e) return '';
    // SVG sweep flag is in *screen* coords. Our display flips Y, so a CCW arc in
    // sketch space (ccw=true) draws with sweep-flag=0 in screen space.
    const sweepFlag = a.ccw ? 0 : 1;
    const largeArc = this.isLargeArc(a) ? 1 : 0;
    return `M ${s.x} ${-s.y} A ${a.radius} ${a.radius} 0 ${largeArc} ${sweepFlag} ${e.x} ${-e.y}`;
  }

  private isLargeArc(a: ArcEntity): boolean {
    const c = findPoint(this.state(), a.centerId);
    const s = findPoint(this.state(), a.startId);
    const e = findPoint(this.state(), a.endId);
    if (!c || !s || !e) return false;
    const startAngle = Math.atan2(s.y - c.y, s.x - c.x);
    const endAngle = Math.atan2(e.y - c.y, e.x - c.x);
    let sweep = endAngle - startAngle;
    if (a.ccw) {
      while (sweep <= 0) sweep += Math.PI * 2;
    } else {
      while (sweep >= 0) sweep -= Math.PI * 2;
    }
    return Math.abs(sweep) > Math.PI;
  }

  // REQ 616 — pointer events now arrive from the 3D viewer with pre-projected
  // 2D plane coords. The parent component (cad-editor) wires the viewer's
  // sketchClick / sketchPointerDown / sketchPointerMove / sketchPointerUp
  // outputs into these public methods.

  /** Most recent zoom-derived pick tolerances supplied by the viewer with
   * the current pointer event. Used by tool handlers that pick entities
   * (Select, Smart Dim, drag-pickdown) so the pick radius stays fixed in
   * screen pixels regardless of camera zoom. */
  private lastPickTolerance = 3;
  private lastPointPickTolerance = 5;
  /** Raw (un-rounded) coords of the most recent sketch click, set by
   * handleSketchClick. Used by `_snapClickToPoint` for H/V alignment
   * detection so it matches the raw-cursor hint preview instead of testing
   * the integer-rounded click point. */
  private _lastRawClick: { x: number; y: number } | null = null;

  /** Phase 2: map of edge lookup key → its current 2D projection on the sketch
   * plane, built from the live `candidates`. The key is the topology edgeId for
   * a local model edge, or the cross-part stable id for ANOTHER component's
   * edge (in-context). Passed to the solver so a point riding an edge is
   * constrained ON the projected line (slides) instead of pinned. Empty → the
   * solver falls back to v1 pin behavior. */
  private _externalEdgeLines(): Map<string, [{ x: number; y: number }, { x: number; y: number }]> {
    const out = new Map<string, [{ x: number; y: number }, { x: number; y: number }]>();
    for (const c of this.candidates()) {
      if (c.kind !== 'edge' || c.points.length < 2) continue;
      const key = c.crossPart ? c.crossPart.stableId : parseCandidateId(c.id)?.topoId;
      if (key) out.set(key, [c.points[0], c.points[1]]);
    }
    return out;
  }

  /** The projected edge line a point rides (phase 2), or null. Handles both
   * local model edges and cross-part edges via `onEdgeLookupKey`. */
  private _edgeRideLine(state: SketchState, id: string): [{ x: number; y: number }, { x: number; y: number }] | null {
    const edgeLines = this._externalEdgeLines();
    if (edgeLines.size === 0) return null;
    for (const c of state.constraints) {
      if (c.type !== 'on-edge' || !c.externalRef) continue;
      if (!c.targets.some(t => t.entityId === id)) continue;
      const key = onEdgeLookupKey(c.externalRef);
      const line = key ? edgeLines.get(key) : undefined;
      if (line) return line;
    }
    return null;
  }

  /** If `id` rides a model edge, clamp (x,y) onto that edge's projection so a
   * drag slides ALONG the edge and stays consistent with the solver's
   * point_on_line. Otherwise returns (x,y) unchanged. */
  private _slideToEdge(state: SketchState, id: string, x: number, y: number): { x: number; y: number } {
    const line = this._edgeRideLine(state, id);
    return line ? closestPointOnSegment(line[0], line[1], { x, y }) : { x, y };
  }

  /** Project a dragged point's target position onto its own point-to-point
   * horizontal/vertical constraints, so a point locked to a FIXED anchor (e.g.
   * horizontal to the origin) slides ALONG the constraint instead of off it.
   *
   * The live-drag solver pins the dragged point, so a constraint between it and
   * a fixed reference (origin, or a `fixed` point) has no free variable left for
   * the solver to satisfy — PlaneGCS then reports success on the violated
   * fixed-vs-fixed relation and the point drags freely. Clamping the locked axis
   * to the reference's coordinate here keeps the point on its constraint
   * manifold (SolidWorks behaviour). A point with both an H and a V lock can't
   * move at all — correct for a fully-located point. */
  private _slideToConstraints(state: SketchState, pointId: string, x: number, y: number): { x: number; y: number } {
    let rx = x, ry = y;
    for (const c of state.constraints) {
      if (c.type !== 'horizontal' && c.type !== 'vertical') continue;
      // Two-point form only — a line-horizontal/vertical doesn't pin a single
      // point's coordinate (the line's two endpoints share it between them).
      if (c.targets.length !== 2) continue;
      const a = c.targets[0].entityId, b = c.targets[1].entityId;
      if (a !== pointId && b !== pointId) continue;
      const otherId = a === pointId ? b : a;
      const other = findPoint(state, otherId);
      if (!other) continue;
      // Only clamp against an EFFECTIVELY-FIXED reference. Locking against a
      // free point would wrongly stop a plain horizontal line from translating
      // when the user drags an endpoint (the other endpoint should follow).
      if (c.type === 'horizontal') {
        if (this._pointAxisFixed(state, otherId, 'y')) ry = other.y;  // shared Y
      } else {
        if (this._pointAxisFixed(state, otherId, 'x')) rx = other.x;  // shared X
      }
    }
    return { x: rx, y: ry };
  }

  /** Is `pointId`'s coordinate on `axis` effectively immovable — pinned by the
   * origin, a `fixed` constraint, or transitively by an H/V constraint to
   * another immovable point? `seen` guards against constraint cycles (e.g. two
   * points horizontal to each other, neither anchored → both free). */
  private _pointAxisFixed(state: SketchState, pointId: string, axis: 'x' | 'y', seen = new Set<string>()): boolean {
    if (pointId === ORIGIN_POINT_ID) return true;
    if (seen.has(pointId)) return false;
    seen.add(pointId);
    for (const c of state.constraints) {
      if (c.type === 'fixed' && c.targets[0]?.entityId === pointId) return true;
      if (c.targets.length !== 2) continue;
      const a = c.targets[0].entityId, b = c.targets[1].entityId;
      if (a !== pointId && b !== pointId) continue;
      const otherId = a === pointId ? b : a;
      // A horizontal lock fixes THIS point's y to the other's y (vertical → x).
      if (c.type === 'horizontal' && axis === 'y' && this._pointAxisFixed(state, otherId, 'y', seen)) return true;
      if (c.type === 'vertical' && axis === 'x' && this._pointAxisFixed(state, otherId, 'x', seen)) return true;
    }
    return false;
  }

  /** Set the hovered sketch entity (the viewer renders it cyan). Pick tools
   * only — drawing tools place geometry, so highlighting existing entities
   * would be noise. Uses the same pickEntity + tolerances as click-selection.
   *
   * Also arbitrates against the projected MODEL edge the viewer highlights: a
   * sketch entity and a model edge can both be under the cursor, but only the
   * CLOSEST should light up. We compare both in sketch units (the viewer passes
   * its projected-edge buffer as `lastEdgeTolerance`). When the sketch entity
   * wins, `sketchHoverWins` tells cad-editor to clear the viewer's edge +
   * face-boundary hover; when the edge wins, we drop our own sketch highlight. */
  private _updateHoverEntity(p: { x: number; y: number }) {
    // Trim/Extend render their OWN partial hover (`editHoverPreview` — the red
    // segment that would be removed/added); a full-entity cyan highlight on top
    // would read as "the entire entity is affected", so suppress hover for them.
    const t = this.tool();
    if (t === 'trim' || t === 'extend') {
      if (this.hoveredEntityId() !== null) this.hoveredEntityId.set(null);
      if (this.sketchHoverWins()) this.sketchHoverWins.set(false);
      if (this.hoveredProjectedEdgeId() !== null) this.hoveredProjectedEdgeId.set(null);
      return;
    }
    // Every other tool (Select, drawing, transform) highlights the nearest
    // thing under the cursor — a SKETCH ENTITY or a projected MODEL edge,
    // whichever is closer — so the user sees their snap target. Drawing tools
    // included: hovering an existing sketch line/curve while drawing must
    // highlight it (it's a snap/connect target), not just projected edges.
    const hit = pickEntity(this.state(), p, this.lastPickTolerance, this.lastPointPickTolerance);
    const sketchDist = hit ? distanceToEntity(this.state(), hit, p) : Infinity;
    const { key: edgeKey, dist: edgeDist } = this._nearestProjectedEdge(p);
    // Sketch entity wins ties — it's the user's own (selectable) geometry, and
    // a sketch line drawn ON a projected edge should highlight as the line, not
    // the (longer, non-selectable) reference edge. A small tolerance absorbs the
    // float gap between the two distance formulas: a sketch line exactly
    // collinear with a projected edge computes the SAME distance mathematically,
    // but `distanceToLine` vs `closestPointOnSegment` can differ by ~1e-9, which
    // a strict `<=` would (wrongly) decide in the edge's favour.
    const TIE = Math.max(1e-3, this.lastEdgeTolerance * 0.1);
    const sketchWins = !!hit && sketchDist <= edgeDist + TIE;
    const id = sketchWins ? hit!.id : null;
    if (this.hoveredEntityId() !== id) this.hoveredEntityId.set(id);
    if (this.sketchHoverWins() !== sketchWins) this.sketchHoverWins.set(sketchWins);
    // The single projected edge to highlight: the nearest one, but only when a
    // sketch entity didn't win the tie.
    const projEdge = !sketchWins && edgeDist < Infinity ? edgeKey : null;
    if (this.hoveredProjectedEdgeId() !== projEdge) this.hoveredProjectedEdgeId.set(projEdge);
  }

  /** Nearest projected MODEL edge under the cursor (within the viewer's
   * projected-edge buffer), as a `{ key, dist }` pair. Key is the topology
   * edgeId (or cross-part stable id) used to highlight that single edge; dist
   * is Infinity when none is in range. Shared by the drawing-tool and pick-tool
   * hover paths so both light up ONE edge, not the hovered face's whole loop. */
  private _nearestProjectedEdge(p: { x: number; y: number }): { key: string | null; dist: number } {
    // Overlapping edges (within TIE of the same distance) → prefer the SHORTER
    // one, matching the sketch-entity pick rule.
    const TIE = Math.max(0.01, this.lastEdgeTolerance * 0.2);
    let edgeDist = Infinity;
    let edgeKey: string | null = null;
    let edgeSpan = Infinity;
    for (const c of this.candidates()) {
      if (c.kind !== 'edge' || c.points.length < 2) continue;
      const d = closestPointOnPolyline(c.points, p).dist;
      if (d > this.lastEdgeTolerance) continue;
      const key = c.crossPart ? c.crossPart.stableId : (parseCandidateId(c.id)?.topoId ?? null);
      // Span = total polyline length so the shorter-edge tie-break still works
      // for curved edges (an arc's chord would understate its length).
      let span = 0;
      for (let i = 0; i + 1 < c.points.length; i++) {
        span += Math.hypot(c.points[i + 1].x - c.points[i].x, c.points[i + 1].y - c.points[i].y);
      }
      if (edgeKey === null) { edgeDist = d; edgeKey = key; edgeSpan = span; continue; }
      if (Math.abs(d - edgeDist) <= TIE) {
        if (span < edgeSpan - 1e-9) { edgeDist = d; edgeKey = key; edgeSpan = span; }
      } else if (d < edgeDist) {
        edgeDist = d; edgeKey = key; edgeSpan = span;
      }
    }
    return { key: edgeKey, dist: edgeDist };
  }

  /** OnShape-style hover-to-arm (REQ 826): while a point-placing drawing tool
   * is active, passing the cursor over an existing sketch point arms it as a
   * horizontal/vertical inference reference for the rest of the gesture. The
   * origin is always armed (handled inside `inferAlignment`), so it's never
   * added here. */
  private _armHoveredRef(p: { x: number; y: number }) {
    if (!this.isDrawingTool()) return;
    const hit = pickEntity(this.state(), p, this.lastPickTolerance, this.lastPointPickTolerance);
    if (hit?.kind !== 'point' || hit.id === ORIGIN_POINT_ID) return;
    const cur = this.armedRefs();
    if (cur.has(hit.id)) return;
    const next = new Set(cur);
    next.add(hit.id);
    this.armedRefs.set(next);
  }

  /** DEBUG (bottom-right overlay): compute what's in the cursor's pick radius —
   * sketch entities AND the projected model geometry the cursor can snap to
   * (external-reference edge/vertex candidates). Faces aren't included: in a
   * sketch a face is picked by the viewer's 3D raycaster (to project its
   * boundary), not by this 2D plane pick, so it has no in-plane distance. */
  private _updateDebugPick(p: { x: number; y: number }) {
    const state = this.state();
    const tol = this.lastPickTolerance;
    const ptol = this.lastPointPickTolerance;
    const maxTol = Math.max(tol, ptol);
    type DbgItem = { id: string; kind: string; d: number; within: boolean };
    const entityItems: DbgItem[] = state.entities
      .map(e => ({ id: e.id, kind: e.kind as string, d: distanceToEntity(state, e, p) }))
      .filter(it => Number.isFinite(it.d) && it.d <= maxTol + 0.5)
      .map(it => ({ ...it, within: it.kind === 'point' ? it.d <= ptol : it.d <= tol }));
    // Projected model geometry: external-ref edges (distance to segment) and
    // vertices (distance to point). Both pick at `tol`.
    const candItems: DbgItem[] = [];
    for (const c of this.candidates()) {
      const a = c.points[0];
      if (!a) continue;
      const key = (c.crossPart ? c.crossPart.stableId : parseCandidateId(c.id)?.topoId) ?? c.id;
      if (c.kind === 'vertex') {
        const d = Math.hypot(a.x - p.x, a.y - p.y);
        if (d <= maxTol + 0.5) candItems.push({ id: key, kind: 'ext-vertex', d, within: d <= tol });
      } else if (c.kind === 'edge' && c.points.length >= 2) {
        const d = closestPointOnPolyline(c.points, p).dist;
        if (d <= maxTol + 0.5) candItems.push({ id: key, kind: 'ext-edge', d, within: d <= tol });
      }
    }
    const items = [...entityItems, ...candItems]
      .sort((a, b) => a.d - b.d)
      .slice(0, 10);
    const rounded = { x: Math.round(p.x), y: Math.round(p.y) };
    const rawWin = pickEntity(state, p, tol, ptol);
    const roundWin = pickEntity(state, rounded, tol, ptol);
    const extWin = nearestCandidateHit(this.candidates(), p, tol);
    this.debugPick.set({
      raw: { x: p.x, y: p.y }, rounded, tol, ptol,
      rawWinner: rawWin ? `${rawWin.kind}:${rawWin.id.slice(0, 10)}` : 'none',
      roundWinner: roundWin ? `${roundWin.kind}:${roundWin.id.slice(0, 10)}` : 'none',
      extWinner: extWin ? `${extWin.kind}:${extWin.candidateId.slice(0, 12)} d=${extWin.dist.toFixed(2)}` : 'none',
      items,
    });
  }

  handleSketchClick(p: { x: number; y: number; shiftKey: boolean; tolerance?: number; pointTolerance?: number }) {
    if (this.readonly()) return;
    if (this.didDrag) { this.didDrag = false; return; }
    if (p.tolerance !== undefined) this.lastPickTolerance = p.tolerance;
    if (p.pointTolerance !== undefined) this.lastPointPickTolerance = p.pointTolerance;
    // Drawing tools snap NEW geometry to integer coords (x, y). Tools that
    // PICK existing geometry must use the RAW cursor (rx, ry) — rounding the
    // pick point makes entities at non-integer coords (e.g. a line at y=13.5)
    // unselectable, because every rounded click lands ≥0.5 units off them.
    const x = this._snap(p.x);
    const y = this._snap(p.y);
    const rx = p.x, ry = p.y;
    // Raw (un-rounded) click position for H/V alignment detection. The hint
    // preview tests alignment against the raw cursor; `_snapClickToPoint`
    // otherwise receives integer-rounded coords, and at high zoom the rounding
    // error (up to ~0.7 units) dwarfs the point-marker-sized snap tolerance —
    // which would let the hint show but the constraint silently drop.
    this._lastRawClick = { x: rx, y: ry };
    const tool = this.tool();
    switch (tool) {
      case 'select':      this.handleSelectClick(rx, ry, p.shiftKey); break;
      case 'point': {
        const snap = this._snapClickToPoint(x, y);
        const r = addPoint(this.state(), snap.x, snap.y);
        let s = r.state;
        s = this._anchorPointToCurve(s, r.id, snap);
        if (snap.externalRef) {
          // Standalone point on a projected arc/circle center → coincident-to-
          // center (REQ 831); any other model ref → the existing on-edge link.
          s = isCenterExternalRef(snap.externalRef)
            ? this._addCenterRelation(s, r.id, snap.externalRef, 'coincident')
            : this._addOnEdge(s, r.id, snap.externalRef);
        }
        s = this._applyAlignTo(s, r.id, snap.alignTo);
        s = this._applyQuadrant(s, r.id, snap);
        this.commit(s);
        break;
      }
      case 'line':           this.handleLineClick(x, y, 'normal'); break;
      case 'centerline':     this.handleLineClick(x, y, 'construction'); break;
      case 'midpoint-line':  this.handleLineClick(x, y, 'midpoint'); break;
      case 'circle':      this.handleCircleClick(x, y); break;
      case 'arc':         this.handleArcClick(x, y); break;
      case 'rect-corner':         this.handleRectCornerClick(x, y); break;
      case 'rect-center':         this.handleRectCenterClick(x, y); break;
      case 'rect-rounded-corner': this.handleRectRoundedCornerClick(x, y); break;
      case 'rect-rounded-center': this.handleRectRoundedCenterClick(x, y); break;
      case 'rect-3pt-corner':     this.handleRect3PtCornerClick(x, y); break;
      case 'rect-3pt-center':     this.handleRect3PtCenterClick(x, y); break;
      case 'parallelogram':       this.handleParallelogramClick(x, y); break;
      case 'polygon':             this.handlePolygonClick(x, y); break;
      case 'slot':                this.handleSlotClick(x, y); break;
      case 'slot-centerpoint':    this.handleSlotCenterpointClick(x, y); break;
      case 'slot-arc-3pt':        this.handleSlotArc3Click(x, y); break;
      case 'slot-arc-centerpoint': this.handleSlotArcCenterpointClick(x, y); break;
      case 'circle-3pt':  this.handleCircle3Click(x, y); break;
      case 'arc-3pt':     this.handleArc3Click(x, y); break;
      case 'ellipse':         this.handleEllipseClick(x, y); break;
      case 'partial-ellipse': this.handlePartialEllipseClick(x, y); break;
      case 'spline':          this.handleSplineClick(x, y, 3); break;
      case 'style-spline':    this.handleSplineClick(x, y, this.styleSplineDegree()); break;
      case 'parabola':        this.handleParabolaClick(x, y); break;
      case 'equation-curve':  this.handleEquationCurveClick(x, y); break;
      case 'text':            this.handleTextClick(x, y); break;
      case 'picture':         this.handlePictureClick(x, y); break;
      case 'circle-perimeter': this.handleCirclePerimeterClick(x, y); break;
      case 'tangent-arc': this.handleTangentArcClick(x, y); break;
      // Pick-existing-geometry tools: RAW cursor (see note above).
      case 'smart-dim':   this.handleSmartDimClick(rx, ry, p.shiftKey); break;
      case 'trim':        this.handleTrimClick(rx, ry); break;
      case 'extend':      this.handleExtendClick(rx, ry); break;
      case 'split':       this.handleSplitClick(rx, ry); break;
      case 'jog':         this.handleJogClick(rx, ry); break;
      case 'offset':      this.handleOffsetClick(rx, ry); break;
      case 'mirror':      this.handleMirrorClick(rx, ry); break;
      case 'fillet':      this.handleFilletClick(rx, ry); break;
      case 'chamfer':     this.handleChamferClick(rx, ry); break;
      case 'move':              this.handleMoveClick(x, y); break;
      case 'copy':              this.handleCopyClick(x, y); break;
      case 'rotate':            this.handleRotateClick(x, y); break;
      case 'stretch':           this.handleStretchClick(x, y); break;
      case 'pattern-linear':    this.handlePatternLinearClick(x, y); break;
      case 'pattern-circular':  this.handlePatternCircularClick(x, y); break;
      case 'dynamic-mirror':    this.handleDynamicMirrorClick(x, y); break;
      case 'scale':       this.handleScaleClick(x, y); break;
    }
  }

  // Pointer-down in Select mode: either pick an entity to drag (any kind,
  // not just points — a line drag translates both endpoints) OR if nothing
  // is under the cursor, start a rubber-band selection rectangle. `isDragging`
  // gate keeps stationary press-release resolving as a click for selection.
  handleSketchPointerDown(p: { x: number; y: number; tolerance?: number; pointTolerance?: number }) {
    if (this.readonly()) return;
    if (this.tool() !== 'select') return;
    if (p.tolerance !== undefined) this.lastPickTolerance = p.tolerance;
    if (p.pointTolerance !== undefined) this.lastPointPickTolerance = p.pointTolerance;
    const picked = pickEntity(this.state(), p, this.lastPickTolerance, this.lastPointPickTolerance);
    // REQ 865 (rim-drag resize ON): a circle/arc pick is by analytic boundary
    // distance, i.e. a RIM grab — arm a radius drag instead of a translate.
    // Moving the curve still works by dragging its center point.
    if (this.rimDragResize() && picked && (picked.kind === 'circle' || picked.kind === 'arc')
      && !isProjectedEntity(this.state(), picked.id)) {
      this.radiusDrag.set({ entityId: picked.id, isDragging: false, start: p });
      return;
    }
    const pointIds = picked ? pointsControlledBy(picked) : [];
    if (pointIds.length === 0) {
      // Empty space (or unpickable kind) → rubber-band selection.
      this.rubberBand.set({ start: p, current: p });
      return;
    }
    const state = this.state();
    // Refuse drag when ANY entity referencing the captured points is
    // a Convert-Entities projected entity. Their coordinates are
    // derived from the source body edge and get overwritten on every
    // regen, so a drag would just snap back. The user has to Break
    // Link first if they want to edit it freely.
    if (this._pointsBelongToProjectedEntity(state, pointIds)) {
      // Fall through to rubber-band (no drag, but click still selects).
      this.rubberBand.set({ start: p, current: p });
      return;
    }
    // Expand the drag set through point↔point coincident constraints so the
    // tied "rigid group" translates as one block. Without this, a circle
    // center dragged while a line is coincident to it would let the line's
    // tied endpoint snap to the new center on each frame — visually fine,
    // but if the line's OTHER endpoint is free, the solver can also pick a
    // slightly different position for it, which the user sees as the line
    // changing size. Translating all coincident-linked points uniformly
    // sidesteps that.
    const expanded = this.expandToCoincidentGroup(state, new Set(pointIds));
    // Strip projected-entity anchors from the drag set. Convert
    // Entities lines are fixed in place — coincident-tied free points
    // should orbit around them, not be towed along when the user
    // drags an attached entity. The solver re-runs after the drag and
    // re-satisfies the coincident constraint relative to the fixed
    // projected anchor.
    const projectedAnchors = this._projectedAnchorPoints(state);
    for (const a of projectedAnchors) expanded.delete(a);
    const points: Array<{ id: string; origX: number; origY: number }> = [];
    for (const id of expanded) {
      const pt = findPoint(state, id);
      if (pt) points.push({ id, origX: pt.x, origY: pt.y });
    }
    if (points.length === 0) {
      // Every point in the expanded group was a projected anchor —
      // nothing left to drag. Fall through to rubber-band so the
      // click still selects.
      this.rubberBand.set({ start: p, current: p });
      return;
    }
    this.dragState.set({ points, startCursor: p, isDragging: false });
  }

  /** Collect every point id that anchors a projected entity. Used to
   * subtract from a drag's coincident-group expansion so projected
   * geometry stays put even when free entities tied to it get
   * dragged. Source is the on-edge constraint list. */
  private _projectedAnchorPoints(state: SketchState): Set<string> {
    const out = new Set<string>();
    const entityById = new Map(state.entities.map(en => [en.id, en] as const));
    const edgeLines = this._externalEdgeLines();
    for (const c of state.constraints) {
      if (c.type !== 'on-edge') continue;
      for (const t of c.targets) {
        const e = entityById.get(t.entityId);
        if (!e) continue;
        if (e.kind === 'line') { out.add(e.startId); out.add(e.endId); }
        else if (e.kind === 'circle') { out.add(e.centerId); }
        else if (e.kind === 'arc') { out.add(e.centerId); out.add(e.startId); out.add(e.endId); }
        else if (e.kind === 'point') {
          // Phase 2: a point riding a model edge (edgeId with a live projection)
          // SLIDES along it — keep it draggable. A vertex-pinned point, or an
          // edge ref with no current projection, stays a fixed anchor.
          const ref = c.externalRef && c.externalRef.scope !== 'cross-part' ? c.externalRef : null;
          const slides = !!(ref && ref.edgeId && edgeLines.has(ref.edgeId));
          if (!slides) out.add(e.id);
        }
      }
    }
    return out;
  }

  /** True when any of the given point ids is referenced by an entity
   * locked to a body edge (on-edge constraint). Used to refuse drags
   * on projected geometry — they snap back on the next regen and
   * confuse the user. */
  private _pointsBelongToProjectedEntity(state: SketchState, pointIds: string[]): boolean {
    const anchors = this._projectedAnchorPoints(state);
    for (const id of pointIds) if (anchors.has(id)) return true;
    return false;
  }

  /** Walk the point↔point coincident graph from a seed set and return the
   * full connected component. Skips coincident-to-line / coincident-to-
   * curve since those don't merge two points into a single rigid vertex. */
  private expandToCoincidentGroup(state: SketchState, seeds: Set<string>): Set<string> {
    const group = new Set<string>(seeds);
    let changed = true;
    while (changed) {
      changed = false;
      for (const c of state.constraints) {
        if (c.type !== 'coincident' || c.targets.length < 2) continue;
        const t0 = c.targets[0].entityId;
        const t1 = c.targets[1].entityId;
        const e0 = findEntity(state, t0);
        const e1 = findEntity(state, t1);
        if (e0?.kind !== 'point' || e1?.kind !== 'point') continue;
        if (group.has(t0) && !group.has(t1)) { group.add(t1); changed = true; }
        if (group.has(t1) && !group.has(t0)) { group.add(t0); changed = true; }
      }
    }
    return group;
  }

  handleSketchPointerMove(p: { x: number; y: number; tolerance?: number; pointTolerance?: number; edgeTolerance?: number }) {
    // Update the live cursor signal for the coordinate readout in the
    // status bar. We use the (already-snapped) `p` so the readout matches
    // what the user perceives as their cursor position, not the raw mouse.
    // Refresh the zoom-adaptive pick tolerances so HOVER picks at the current
    // zoom (otherwise a stale fixed value highlights points far outside their
    // drawn influence disk).
    if (p.tolerance !== undefined) this.lastPickTolerance = p.tolerance;
    if (p.pointTolerance !== undefined) this.lastPointPickTolerance = p.pointTolerance;
    if (p.edgeTolerance !== undefined) this.lastEdgeTolerance = p.edgeTolerance;
    this.cursor.set(p);
    this._updateDebugPick(p);
    this._updateHoverEntity(p);
    this._armHoveredRef(p);
    // REQ 865 — rim-resize gesture: radius follows |cursor − center| live.
    const rdrag = this.radiusDrag();
    if (rdrag) {
      const e0 = findEntity(this.state(), rdrag.entityId);
      const center = e0 && (e0.kind === 'circle' || e0.kind === 'arc')
        ? findPoint(this.state(), e0.centerId) : null;
      if (!e0 || !center) { this.radiusDrag.set(null); return; }
      if (!rdrag.isDragging) {
        if (Math.hypot(p.x - rdrag.start.x, p.y - rdrag.start.y) < 1) return;
        this.radiusDrag.set({ ...rdrag, isDragging: true });
        this.didDrag = true;
      }
      const newR = Math.max(0.01, Math.hypot(p.x - center.x, p.y - center.y));
      this.sketchChanged.emit(this._withRadius(this.state(), e0.id, newR));
      return;
    }
    const drag = this.dragState();
    if (drag) {
      const dx = p.x - drag.startCursor.x;
      const dy = p.y - drag.startCursor.y;
      const DRAG_THRESHOLD = 1;
      if (!drag.isDragging) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        this.dragState.set({ ...drag, isDragging: true });
      }
      // Warm-start the solver from the CURRENT state (which carries the
      // previous frame's solver result) and only reset the dragged points
      // to snapshot+delta. Cold-starting from the snapshot each frame
      // worked for predictability but made under-determined systems jitter
      // — the solver chooses among many valid solutions and picks a
      // different one each frame. Warm-starting keeps it in the same
      // basin frame-to-frame. The dragged points are still pinned to
      // origPos+delta so the cursor delta stays canonical even as the
      // rest of the sketch slowly migrates around them.
      let next = this.state();
      for (const { id, origX, origY } of drag.points) {
        let q = this._slideToEdge(next, id, origX + dx, origY + dy);
        q = this._slideToConstraints(next, id, q.x, q.y);
        next = movePoint(next, id, q.x, q.y);
      }
      this.liveSolveDuringDrag(next);
      return;
    }
    const rb = this.rubberBand();
    if (rb) {
      this.rubberBand.set({ ...rb, current: p });
      return;
    }
  }

  handleSketchPointerUp(p: { x: number; y: number }) {
    // REQ 865 — commit a rim resize: snap the final radius to the grid (when
    // grid snap is on) and run the full solve so constraints re-satisfy.
    const rdrag = this.radiusDrag();
    if (rdrag) {
      this.radiusDrag.set(null);
      if (!rdrag.isDragging) return;  // press-release → click falls through next frame
      this.didDrag = true;
      const e0 = findEntity(this.state(), rdrag.entityId);
      const center = e0 && (e0.kind === 'circle' || e0.kind === 'arc')
        ? findPoint(this.state(), e0.centerId) : null;
      if (!e0 || !center) return;
      const raw = Math.hypot(p.x - center.x, p.y - center.y);
      const newR = Math.max(this.gridSnap() ? 1 : 0.01, this._snap(raw));
      void this.commit(this._withRadius(this.state(), e0.id, newR));
      return;
    }
    const drag = this.dragState();
    if (drag) {
      this.dragState.set(null);
      // Invalidate any in-flight live-drag solver so a late async result
      // can't clobber the freshly-committed state below.
      this.dragSolveGen++;
      if (!drag.isDragging) return;
      this.didDrag = true;
      const dx = p.x - drag.startCursor.x;
      const dy = p.y - drag.startCursor.y;
      // Commit uses the current state (which has the previous frame's
      // solver adjustments) as the base, same rule as pointermove. Round
      // only the dragged points' final positions so the saved state has
      // clean integer coordinates.
      let next = this.state();
      for (const { id, origX, origY } of drag.points) {
        // Edge-ride points commit at their projected position (no rounding —
        // rounding would nudge them off the edge); others snap to integers.
        const line = this._edgeRideLine(next, id);
        if (line) {
          const q = closestPointOnSegment(line[0], line[1], { x: origX + dx, y: origY + dy });
          next = movePoint(next, id, q.x, q.y);
        } else {
          // Round to the integer grid, then clamp any H/V-locked axis back to
          // its reference coordinate so a point tied to a fixed anchor commits
          // ON its constraint rather than off it.
          const q = this._slideToConstraints(next, id, this._snap(origX + dx), this._snap(origY + dy));
          next = movePoint(next, id, q.x, q.y);
        }
      }
      this.commit(next);
      return;
    }
    const rb = this.rubberBand();
    if (rb) {
      this.rubberBand.set(null);
      this.applyRubberBandSelection(rb);
      return;
    }
  }

  /** Run solver against the in-progress drag state asynchronously. Multiple
   * concurrent solves can overlap; only the latest one's result is applied
   * via the generation counter.
   *
   * Pin the dragged points during the solve via `movablePoints`. Without
   * this, attached geometry (a line whose endpoint is coincident with a
   * dragged circle's center, a tangent line, etc.) gives the solver
   * freedom to nudge BOTH the attached point AND the dragged point each
   * frame — producing visible oscillation as the solver picks slightly
   * different valid configurations. With the drag points pinned, the
   * solver can only move OTHER points to satisfy constraints, so the
   * cursor anchor stays put and attached geometry follows it smoothly.
   *
   * If the solve fails ('inconsistent'), we still emit the unsolved state
   * so the dragged geometry follows the cursor visibly — the user gets
   * "this won't satisfy the constraints" feedback and can keep dragging.
   */
  private async liveSolveDuringDrag(state: SketchState) {
    const id = ++this.dragSolveGen;
    const dragged = new Set(this.dragState()?.points.map(p => p.id) ?? []);
    let result;
    if (dragged.size > 0) {
      // Projected-entity anchors are FIXED (their coords come from
      // the body's source edge each regen). Exclude them from
      // movable so the solver can't slide them around to satisfy a
      // coincident-with-projected constraint while the user is
      // dragging a free entity tied to them.
      const projectedAnchors = this._projectedAnchorPoints(state);
      const movable = new Set<string>();
      for (const e of state.entities) {
        if (e.kind !== 'point') continue;
        if (dragged.has(e.id)) continue;
        if (projectedAnchors.has(e.id)) continue;
        movable.add(e.id);
      }
      // Pin curve radii so circles / arcs can't grow or shrink to satisfy
      // constraints during the drag. The user is just translating the
      // anchor; resizing should require an explicit dimension edit.
      result = await solveSketch(state, { movablePoints: movable, pinAllRadii: true, externalEdges: this._externalEdgeLines() });
    } else {
      result = await solveSketch(state, { externalEdges: this._externalEdgeLines() });
    }
    if (id !== this.dragSolveGen) return;
    // Only emit when the solver accepted the drag. When it fails (e.g.,
    // the sketch is fully constrained and the cursor pulls a point against
    // a rigid constraint), DON'T emit the requested state — the previous
    // frame's accepted state already shows on screen, so the dragged
    // points visually stick where the constraints allow them. Without
    // this gate the dragged points would slide with the cursor regardless
    // of constraint violations.
    if (result.status === 'ok' && !this._solveCollapsed(state, result.state)) this.sketchChanged.emit(result.state);
  }

  /** Apply a rubber-band rectangle as a selection (REQ 863, SW convention):
   *  - left→right (window): only entities FULLY ENCLOSED by the rect — a
   *    point inside it, a curve whose every controlling point is inside.
   *  - right→left (crossing): additionally, anything the rect TOUCHES —
   *    a segment crossing the rect edge counts even with endpoints outside. */
  private applyRubberBandSelection(rb: { start: { x: number; y: number }; current: { x: number; y: number } }) {
    const minX = Math.min(rb.start.x, rb.current.x);
    const maxX = Math.max(rb.start.x, rb.current.x);
    const minY = Math.min(rb.start.y, rb.current.y);
    const maxY = Math.max(rb.start.y, rb.current.y);
    // Below-threshold rect → treat as a plain click (selection stays empty).
    if ((maxX - minX) < 1 && (maxY - minY) < 1) return;
    this.didDrag = true;  // suppress the follow-up click event
    const crossing = rb.current.x < rb.start.x;
    const rect = { minX, minY, maxX, maxY };
    const inRect = (x: number, y: number) =>
      x >= minX && x <= maxX && y >= minY && y <= maxY;
    const state = this.state();
    const next = new Set<string>();
    for (const e of state.entities) {
      const ids = pointsControlledBy(e);
      if (ids.length === 0) continue;
      if (crossing) {
        if (entityTouchesRect(state, e, rect)) next.add(e.id);
        continue;
      }
      const allInside = ids.every(id => {
        const pt = findPoint(state, id);
        return pt && inRect(pt.x, pt.y);
      });
      if (allInside) next.add(e.id);
    }
    this.selected.set(next);
  }

  private handleSelectClick(x: number, y: number, additive: boolean) {
    const picked = pickEntity(this.state(), { x, y }, this.lastPickTolerance, this.lastPointPickTolerance);
    if (!picked) {
      // Empty-space click clears the whole selection, including any model-edge
      // relation target (unless shift-extending).
      if (!additive) { this.selected.set(new Set()); this.selectedExternalEdgeId.set(null); }
      return;
    }
    const next = new Set(additive ? this.selected() : []);
    if (next.has(picked.id)) next.delete(picked.id);
    else next.add(picked.id);
    this.selected.set(next);
  }

  /** Shared handler for Line, Centerline, and Midpoint Line. The three
   * tools draw the same way — first click sets the start, second click
   * commits the line — but differ in what they emit:
   *   - `normal`       → plain line entity.
   *   - `construction` → line entity with `construction: true` (dashed
   *     reference geometry, doesn't participate in profile loops).
   *   - `midpoint`     → plain line plus a fresh point pinned via
   *     `midpoint(point, line)` so the user can reference / dimension
   *     the line's midpoint without manually building it.
   */
  private handleLineClick(x: number, y: number, mode: 'normal' | 'construction' | 'midpoint' = 'normal') {
    const start = this.draftLineStart();
    if (!start) {
      // First click of a chain. Always create a fresh endpoint for the
      // new line, but if the click lands on an existing point OR an
      // existing curve (sketched or converted), pin the new endpoint
      // with a coincident — SW-style: each entity owns its endpoints,
      // shared positions / on-curve placement are enforced by
      // constraints rather than reused entity ids.
      let s = this.state();
      const nearby = this.findNearbyPoint(x, y);
      if (nearby) {
        const r = addPoint(s, nearby.x, nearby.y); s = r.state;
        s = addConstraint(s, 'coincident', [r.id, nearby.id]).state;
        this.commit(s);
        this.draftLineStart.set(r.id);
        return;
      }
      const snap = this._snapClickToPoint(x, y);
      const r = addPoint(s, snap.x, snap.y); s = r.state;
      s = this._anchorPointToCurve(s, r.id, snap);
      if (snap.externalRef) {
        // A line endpoint dropped on a projected arc/circle center → coincident-
        // to-center (REQ 831); any other model ref → the on-edge link.
        s = isCenterExternalRef(snap.externalRef)
          ? this._addCenterRelation(s, r.id, snap.externalRef, 'coincident')
          : this._addOnEdge(s, r.id, snap.externalRef);
      }
      s = this._applyAlignTo(s, r.id, snap.alignTo);
      s = this._applyQuadrant(s, r.id, snap);
      this.commit(s);
      this.draftLineStart.set(r.id);
      return;
    }

    // Concrete-geometry snap (existing point / curve / MODEL edge·vertex) wins
    // over inference, which only matters in open space. `_snapClickToPoint`
    // resolves all three uniformly; only when it finds nothing do we infer
    // horizontal / vertical / polar / alignment from the start point.
    const startPt = findPoint(this.state(), start);
    const snap = this._snapClickToPoint(x, y);
    let snapped = { x: snap.x, y: snap.y };
    let pendings: PendingConstraint[] = [];
    const snappedToGeometry = !!(snap.pointId || snap.onCurveId || snap.externalRef);
    // Armed-ref alignment (origin / hovered point) snaps the endpoint and adds
    // its own H/V constraint via `snap.alignTo`; when it fires it takes
    // precedence over inferLineEnd's orient-to-start so the two don't fight
    // over the endpoint coords.
    const hasAlign = !!(snap.alignTo && snap.alignTo.length);
    if (!snappedToGeometry && !hasAlign && startPt) {
      const inf = inferLineEnd(this.state(), startPt, { x, y });
      snapped = inf.snapped;
      // Apply EVERY inference constraint the hover fired — e.g. when
      // hovering on a vertical converted line whose snap point also
      // happens to be horizontal-from-start, we'll add both
      // coincident-on-line AND horizontal so the new line is fully
      // constrained on commit. Falls back to the legacy single-
      // constraint shape for back-compat.
      pendings = inf.constraints ?? (inf.constraint ? [inf.constraint] : []);
    }

    // Zero-length self-line guard: if the snapped endpoint sits at the
    // start point's position, terminate the chain without committing.
    // Position-based check now (we no longer compare ids — endpoints
    // get unique fresh ids every time).
    if (startPt && Math.hypot(snapped.x - startPt.x, snapped.y - startPt.y) < 0.5) {
      this.draftLineStart.set(null);
      return;
    }

    let s = this.state();
    // Always create a fresh endpoint. When the snap landed on an existing
    // point / curve, pin it via coincident; on a model edge·vertex, attach
    // the on-edge external reference; otherwise just place it.
    const endRes = addPoint(s, snapped.x, snapped.y);
    s = endRes.state;
    const endId = endRes.id;
    if (snap.pointId) s = addConstraint(s, 'coincident', [endId, snap.pointId]).state;
    else s = this._anchorPointToCurve(s, endId, snap);
    if (snap.externalRef) {
      // Line endpoint on a projected arc/circle center → coincident-to-center
      // (REQ 831); any other model ref → the on-edge link.
      s = isCenterExternalRef(snap.externalRef)
        ? this._addCenterRelation(s, endId, snap.externalRef, 'coincident')
        : this._addOnEdge(s, endId, snap.externalRef);
    }
    s = this._applyAlignTo(s, endId, snap.alignTo);
    s = this._applyQuadrant(s, endId, snap);
    const ln = addLine(s, start, endId, { construction: mode === 'construction' });
    s = ln.state;
    for (const p of pendings) s = applyPendingConstraint(s, ln.id, p);
    if (mode === 'midpoint') {
      // Midpoint Line: emit a fresh point at the visual midpoint of the
      // line and constrain it via `midpoint(point, line)`. The solver
      // keeps it pinned even as the line's endpoints move.
      const startCoords = findPoint(s, start);
      const endCoords = findPoint(s, endId);
      if (startCoords && endCoords) {
        const mid = addPoint(s, (startCoords.x + endCoords.x) / 2, (startCoords.y + endCoords.y) / 2);
        s = mid.state;
        s = addConstraint(s, 'midpoint', [mid.id, ln.id]).state;
      }
    }
    this.commit(s);
    // Click landed on an existing point (closing the chain or branching) →
    // end the chain. Otherwise continue from the just-placed endpoint so
    // the user can keep walking a polyline. Midpoint Line is a single-
    // segment tool (chains don't add useful midpoint geometry).
    this.draftLineStart.set(snap.pointId || mode === 'midpoint' ? null : endId);
  }

  private handleCircleClick(x: number, y: number) {
    const center = this.draftCircleCenter();
    if (!center) {
      this.draftCircleCenter.set(this._snapClickToPoint(x, y));
      return;
    }
    // Snap the second (radius-defining) click to an existing point too
    // so the circumference can be locked via a coincident constraint —
    // SolidWorks-style "click center, click point on circumference."
    const onCircum = this._snapClickToPoint(x, y);
    const radius = Math.hypot(onCircum.x - center.x, onCircum.y - center.y);
    if (radius < 0.5) return;  // ignore second click on top of first
    let s = this.state();
    let circleId: string;
    if (center.pointId) {
      // Reuse the existing point as the center — no synthetic
      // coincident-with-original-point pair.
      const r = addCircleByPoint(s, center.pointId, radius);
      s = r.state; circleId = r.id;
    } else {
      const r = addCircle(s, center.x, center.y, radius);
      s = r.state; circleId = r.id;
      // SW-style: clicking ON a curve drops the center as a point and
      // pins it with coincident-on-curve, or — when snapped to a model
      // edge·vertex — an on-edge external reference, or — in open space —
      // a horizontal/vertical alignment to an armed reference. We need the
      // center point's id, which addCircle synthesised; find it via the new
      // circle entity's centerId.
      const newCircle = s.entities.find(e => e.id === circleId);
      if (newCircle && newCircle.kind === 'circle') {
        s = this._anchorPointToCurve(s, newCircle.centerId, center);
        if (center.externalRef) {
          // Snap onto a projected arc/circle center → concentric (REQ 831);
          // any other model ref → the existing on-edge link.
          s = isCenterExternalRef(center.externalRef)
            ? this._addCenterRelation(s, newCircle.centerId, center.externalRef, 'concentric')
            : this._addOnEdge(s, newCircle.centerId, center.externalRef);
        }
        s = this._applyAlignTo(s, newCircle.centerId, center.alignTo);
        s = this._applyQuadrant(s, newCircle.centerId, center);
      }
    }
    if (onCircum.pointId) {
      // Lock the radius: with the center pinned and a point on the
      // circumference, |P - C| = R locks R via the existing
      // pointCurveResid residual. Adds a green-friendly DOF.
      s = addConstraint(s, 'coincident', [onCircum.pointId, circleId]).state;
    } else if (onCircum.onCurveId) {
      // Second click landed on another curve — synthesise a point on
      // the circumference of the new circle that's ALSO coincident
      // with that curve. Locks the intersection between circles /
      // arcs / lines without the user adding it explicitly.
      const pp = addPoint(s, onCircum.x, onCircum.y); s = pp.state;
      s = addConstraint(s, 'coincident', [pp.id, circleId]).state;
      s = addConstraint(s, 'coincident', [pp.id, onCircum.onCurveId]).state;
      s = this._applyQuadrant(s, pp.id, onCircum);
    }
    this.commit(s);
    this.draftCircleCenter.set(null);
  }

  private handleArcClick(x: number, y: number) {
    const center = this.draftArcCenter();
    if (!center) {
      this.draftArcCenter.set(this._snapClickToPoint(x, y));
      return;
    }
    const start = this.draftArcStart();
    if (!start) {
      if (Math.hypot(x - center.x, y - center.y) < 0.5) return;
      this.draftArcStart.set(this._snapClickToPoint(x, y));
      return;
    }
    // Choose ccw=true when the (start → end) sweep around the center is positive.
    const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
    const endAngle = Math.atan2(y - center.y, x - center.x);
    let delta = endAngle - startAngle;
    while (delta <= -Math.PI) delta += 2 * Math.PI;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    const ccw = delta >= 0;
    const end = this._snapClickToPoint(x, y);
    // Any of center / start / end snapping to an existing point OR
    // curve: use addArcByPoints so existing point ids are reused and
    // on-curve clicks pick up a coincident-with-curve constraint.
    // arc_rules in the solver reconciles the radius if the snapped
    // end isn't exactly |start - center| away from the center.
    if (center.pointId || start.pointId || end.pointId
        || center.onCurveId || start.onCurveId || end.onCurveId
        || center.externalRef || start.externalRef || end.externalRef
        || center.alignTo?.length || start.alignTo?.length || end.alignTo?.length
        || center.quadrant || start.quadrant || end.quadrant
        || center.midpointOf || start.midpointOf || end.midpointOf) {
      let s = this.state();
      const ensurePointId = (pp: PendingPoint): string => {
        if (pp.pointId) return pp.pointId;
        const r = addPoint(s, pp.x, pp.y);
        s = r.state;
        // SW-style: clicking ON a curve drops a coincident-on-curve anchor;
        // on a model edge·vertex, an on-edge external reference; in open
        // space, a horizontal/vertical alignment to an armed reference.
        s = this._anchorPointToCurve(s, r.id, pp);
        // Center refs (sub:'center') are attached AFTER the arc exists (the
        // center → concentric, an endpoint → coincident); any other model ref
        // is the existing on-edge link.
        if (pp.externalRef && !isCenterExternalRef(pp.externalRef)) s = this._addOnEdge(s, r.id, pp.externalRef);
        s = this._applyAlignTo(s, r.id, pp.alignTo);
        s = this._applyQuadrant(s, r.id, pp);
        return r.id;
      };
      const centerId = ensurePointId(center);
      const startId = ensurePointId(start);
      const endId = ensurePointId(end);
      const ar = addArcByPoints(s, centerId, startId, endId, ccw);
      s = ar.state;
      // Concentric for the arc center on a projected center; coincident-to-center
      // for a start/end snapped onto one (REQ 831).
      const addCenterRel = (pid: string, pp: PendingPoint, kind: 'concentric' | 'coincident') => {
        if (pp.externalRef && isCenterExternalRef(pp.externalRef)) s = this._addCenterRelation(s, pid, pp.externalRef, kind);
      };
      addCenterRel(centerId, center, 'concentric');
      addCenterRel(startId, start, 'coincident');
      addCenterRel(endId, end, 'coincident');
      this.commit(s);
    } else {
      this.commit(addArc(this.state(), center.x, center.y, start.x, start.y, x, y, ccw).state);
    }
    this.draftArcCenter.set(null);
    this.draftArcStart.set(null);
  }

  /** Convert a raw click into a PendingPoint, snapping onto an existing
   * point entity if the click landed on one (within the standard point-
   * pick tolerance). Used by every click in the circle/arc tools so a
   * snapped click either reuses the point id directly (center / start)
   * or anchors the curve via a coincident constraint (circle
   * circumference / arc end). */
  private _snapClickToPoint(x: number, y: number, opts?: { skipAlign?: boolean }): PendingPoint {
    const picked = pickEntity(this.state(), { x, y }, this.lastPickTolerance, this.lastPointPickTolerance);
    if (picked?.kind === 'point') {
      // Use the existing point's authoritative coords so the new
      // entity lands precisely on it rather than at the cursor's
      // sub-pixel offset.
      return { x: picked.x, y: picked.y, pointId: picked.id };
    }
    // Implicit external reference (SolidWorks inference): snap onto the
    // projection of a model vertex / straight edge. A vertex outranks an
    // existing sketch curve (snapping to an endpoint is usually intended);
    // an edge ranks below a sketch curve. The snapped point carries the
    // externalRef so the placing tool attaches the on-edge constraint to the
    // point it creates — uniform across every tool/click, no commit-time map.
    const cands = this.candidates();
    const candHit = cands.length
      ? nearestCandidateHit(cands, { x, y }, this.lastPointPickTolerance)
      : null;
    const takeCandidate = (): PendingPoint => {
      const ref = externalRefForCandidate(candHit!.candidate) ?? undefined;
      return { x: candHit!.x, y: candHit!.y, externalRef: ref };
    };
    // A model vertex or a projected arc/circle CENTER (REQ 830) is a real-point
    // snap — take it above sketch-curve hits so concentric/coincident-to-center
    // intent wins. The center ref carries sub:'center' (see externalRefForCandidate).
    if (candHit?.kind === 'vertex' || candHit?.kind === 'center') return takeCandidate();
    // Curve hit (sketched or converted line/arc/circle) — project the
    // click onto the curve and remember which curve we hit. The
    // entity commit then anchors the new point to it via coincident.
    const onCurve = this._projectClickOntoCurve(picked, x, y);
    if (onCurve) return onCurve;
    if (candHit) return takeCandidate();  // edge candidate (below sketch curves)
    // Open space — nothing concrete to snap to. Infer horizontal/vertical
    // alignment to armed reference points (origin + hovered, REQ 825/826).
    // Skipped for tools where snapping a click to align with another point
    // would distort the shape — notably RECTANGLE corners, whose two opposite
    // corners aligning to a shared X or Y collapses the box to a line.
    // Detect on the RAW click cursor (not the integer-rounded x/y) so it
    // matches what the hint preview showed; the influence band matches the
    // point pick zone (zoom-adaptive, constant on-screen) so the snap area is
    // the same size as the hint marker.
    if (opts?.skipAlign) return { x, y };
    const rawCursor = this._lastRawClick ?? { x, y };
    const align = inferAlignment(this.state(), rawCursor, this.armedRefs(), { tol: this.lastPointPickTolerance });
    if (align.refs.length) {
      // Snap each aligned axis to the reference's exact coordinate; keep the
      // free axis on the integer grid (the drawing-tool default).
      let sx = x, sy = y;
      for (const r of align.refs) {
        if (r.type === 'vertical') sx = align.snapped.x;    // shared X = ref.x
        if (r.type === 'horizontal') sy = align.snapped.y;  // shared Y = ref.y
      }
      return { x: sx, y: sy, alignTo: align.refs };
    }
    return { x, y };
  }

  /** Emit a real horizontal/vertical constraint between a freshly-placed point
   * and each armed reference it aligned to (REQ 825). No-op when `alignTo` is
   * empty. A point is never constrained to itself. */
  private _applyAlignTo(state: SketchState, pointId: string, alignTo?: AlignmentRef[]): SketchState {
    let s = state;
    for (const a of alignTo ?? []) {
      if (a.refId === pointId) continue;
      s = addConstraint(s, a.type, [pointId, a.refId]).state;
    }
    return s;
  }

  /** Anchor a freshly-placed point to the curve it snapped onto: a `midpoint`
   * constraint when the snap was a line's midpoint, otherwise a plain
   * coincident-on-curve. No-op when the snap carried neither. */
  private _anchorPointToCurve(state: SketchState, pointId: string, snap: PendingPoint): SketchState {
    if (snap.midpointOf) return addConstraint(state, 'midpoint', [pointId, snap.midpointOf]).state;
    if (snap.onCurveId) return addConstraint(state, 'coincident', [pointId, snap.onCurveId]).state;
    return state;
  }

  /** Append an `on-edge` constraint tying a sketch entity (a placed point, or
   * a line being related to a model edge) to a model edge/vertex. The single
   * place external references are created from snapping or Select-mode picks. */
  private _addOnEdge(state: SketchState, entityId: string, externalRef: ExternalRef): SketchState {
    const id = `on-edge-${entityId}-${this.latestCommitId}`;
    return { ...state, constraints: [...state.constraints, { id, type: 'on-edge', targets: [{ entityId }], externalRef }] };
  }

  /** Append the relation for a snap onto a projected arc/circle CENTER (REQ
   * 831): `concentric` when the pinned point is a circle/arc center, `coincident`
   * when it's a standalone point. Both carry the live center externalRef
   * (sub:'center') and pin the point to the projected center each regen. Routed
   * here instead of `_addOnEdge` so the relation reads/behaves as concentric/
   * coincident (badge + relations list), not as a Convert-Entities on-edge link. */
  private _addCenterRelation(
    state: SketchState, pointId: string, externalRef: ExternalRef, kind: 'concentric' | 'coincident',
  ): SketchState {
    const id = `center-${kind}-${pointId}-${this.latestCommitId}`;
    return { ...state, constraints: [...state.constraints, { id, type: kind, targets: [{ entityId: pointId }], externalRef }] };
  }

  /** Project a click onto a picked curve and return a PendingPoint
   * carrying the projected coords plus `onCurveId`. Returns null when
   * the picked entity isn't a curve (or when its support points are
   * missing). Used by every "click to drop a point" tool so they all
   * snap onto sketched and converted curves identically. */
  private _projectClickOntoCurve(
    picked: SketchEntity | null | undefined, x: number, y: number,
  ): PendingPoint | null {
    if (!picked) return null;
    const state = this.state();
    if (picked.kind === 'line') {
      const a = findPoint(state, picked.startId);
      const b = findPoint(state, picked.endId);
      if (!a || !b) return null;
      const dx = b.x - a.x, dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-12) return null;
      // Midpoint snap → emit a midpoint constraint (pins the point to the
      // line's centre) rather than coincident-on-line. Detect against the
      // un-rounded snapped click so it matches the midpoint hint exactly.
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const raw = this._lastRawClick ?? { x, y };
      if (Math.hypot(raw.x - mid.x, raw.y - mid.y) <= Math.max(this.lastPointPickTolerance, 0.01)) {
        return { x: mid.x, y: mid.y, midpointOf: picked.id };
      }
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
      return { x: a.x + dx * t, y: a.y + dy * t, onCurveId: picked.id };
    }
    if (picked.kind === 'circle') {
      const c = findPoint(state, picked.centerId);
      if (!c) return null;
      const quad = this._quadrantAxis(c);
      if (quad) return { x: this._lastRawClick!.x, y: this._lastRawClick!.y, onCurveId: picked.id, quadrant: { centerId: picked.centerId, axis: quad } };
      const ddx = x - c.x, ddy = y - c.y;
      const len = Math.hypot(ddx, ddy) || 1;
      return { x: c.x + picked.radius * ddx / len, y: c.y + picked.radius * ddy / len, onCurveId: picked.id };
    }
    if (picked.kind === 'arc') {
      const c = findPoint(state, picked.centerId);
      if (!c) return null;
      const quad = this._quadrantAxis(c);
      if (quad) return { x: this._lastRawClick!.x, y: this._lastRawClick!.y, onCurveId: picked.id, quadrant: { centerId: picked.centerId, axis: quad } };
      const ddx = x - c.x, ddy = y - c.y;
      const len = Math.hypot(ddx, ddy) || 1;
      // Project onto the arc's circle. Coincident-with-arc will pull
      // the point onto the sweep at solve time if it landed off-sweep;
      // pickEntity won't return an arc unless the click was already
      // near the arc's actual extent, so this is rarely an issue.
      return { x: c.x + picked.radius * ddx / len, y: c.y + picked.radius * ddy / len, onCurveId: picked.id };
    }
    return null;
  }

  /** When the click snapped to a circle/arc QUADRANT, classify which cardinal
   * axis it lies on relative to the curve center. The viewer snaps the click
   * exactly onto the quadrant point (cx, cy±r) or (cx±r, cy), so the raw click
   * shares one coordinate with the center: same X ⇒ top/bottom ⇒ a VERTICAL
   * relation to the center; same Y ⇒ left/right ⇒ a HORIZONTAL relation.
   * Returns null when the click isn't on a quadrant. */
  private _quadrantAxis(center: { x: number; y: number }): 'horizontal' | 'vertical' | null {
    const raw = this._lastRawClick;
    if (!raw) return null;
    const EPS = 1e-6;
    const sameX = Math.abs(raw.x - center.x) < EPS;
    const sameY = Math.abs(raw.y - center.y) < EPS;
    if (sameX && !sameY) return 'vertical';
    if (sameY && !sameX) return 'horizontal';
    return null;
  }

  /** Emit the quadrant's horizontal/vertical relation to the curve center, so a
   * point snapped to a circle/arc quadrant stays locked to that quadrant (in
   * addition to the coincident-on-curve). No-op when not a quadrant snap. */
  private _applyQuadrant(state: SketchState, pointId: string, pp: PendingPoint): SketchState {
    if (!pp.quadrant || pp.quadrant.centerId === pointId) return state;
    return addConstraint(state, pp.quadrant.axis, [pointId, pp.quadrant.centerId]).state;
  }

  // ─── construction toggle ──────────────────────────────────────────────

  /** True if every currently-selected entity has `construction = true`. The
   * toggle flips to the opposite of this — i.e. selecting a mix of
   * construction + normal flips them all to construction. */
  private allSelectedAreConstruction(): boolean {
    const sel = this.selectedEntities();
    if (sel.length === 0) return false;
    return sel.every(e => e.construction === true);
  }

  constructionIcon = computed(() => this.allSelectedConstructionForIcon() ? 'cad-construction' : 'cad-line');
  constructionLabel = computed(() => this.allSelectedConstructionForIcon() ? 'Make Normal' : 'Make Cons.');
  constructionTooltip = computed(() => {
    const sel = this.selectedEntities();
    if (sel.length === 0) return 'Toggle construction — select entities first, then click to flip between normal and construction (dashed reference) geometry';
    return this.allSelectedConstructionForIcon()
      ? 'Make selected geometry normal (solid)'
      : 'Make selected geometry construction (dashed reference)';
  });

  // Computed wrapper so the template can call it without re-evaluating
  // selectedEntities multiple times — Angular signals memoize computeds.
  private allSelectedConstructionForIcon = computed(() => {
    const sel = this.selectedEntities();
    return sel.length > 0 && sel.every(e => e.construction === true);
  });

  toggleConstruction() {
    if (this.readonly()) return;
    const ids = Array.from(this.selected());
    if (ids.length === 0) return;
    const nextValue = !this.allSelectedAreConstruction();
    const next = setConstructionFlag(this.state(), ids, nextValue);
    this.commit(next);
    this.selected.set(new Set());
  }

  /** Selection contains at least one entity locked by an on-edge
   * constraint (Convert Entities link) — Break Link button is enabled. */
  hasProjectedSelection = computed<boolean>(() => {
    const state = this.state();
    return this.selectedEntities().some(e => isProjectedEntity(state, e.id));
  });

  /** Drop every on-edge constraint that targets a selected entity.
   * After break, the entity stays in place but stops auto-updating
   * when the source feature changes — and the user can edit it freely. */
  breakProjectionLink(): void {
    if (this.readonly()) return;
    const state = this.state();
    const projectedIds = new Set(
      this.selectedEntities().filter(e => isProjectedEntity(state, e.id)).map(e => e.id),
    );
    if (projectedIds.size === 0) return;
    const next: SketchState = {
      ...state,
      constraints: state.constraints.filter(c => {
        if (c.type !== 'on-edge') return true;
        return !c.targets.some(t => projectedIds.has(t.entityId));
      }),
    };
    this.commit(next);
  }

  // ─── smart dimension ──────────────────────────────────────────────────

  /**
   * Smart Dim click handler — SolidWorks-style multi-click flow:
   *   pick 1 → pick 2 (validates combo) → placement click (commits)
   *
   * Selection accumulates incompletely-valid picks; once we have a valid
   * combo (e.g. point+point, line+line, single line, single curve), the
   * NEXT click is treated as the placement and commits the dimension.
   * The live preview between picks/placement is computed by the cad-
   * editor's sketchPreview computed via `currentSmartDimPreview`.
   */
  private handleSmartDimClick(x: number, y: number, _shiftKey: boolean) {
    const sel = this.selectedEntities();
    let picked = pickEntity(this.state(), { x, y }, this.lastPickTolerance, this.lastPointPickTolerance);
    // Smart-dim TO a projected model edge: with no sketch entity under the
    // cursor, convert the nearest projected (straight) edge into an on-edge
    // sketch line and dimension to that — SolidWorks-style. Reuses an
    // already-converted line for the same edge so repeated dims don't spawn
    // duplicates. Placement clicks land in empty space (away from body edges),
    // so this doesn't hijack them.
    // Distance from a sketch POINT to a model EDGE, referencing the edge
    // DIRECTLY (no converted sketch line). Works in BOTH click orders:
    //   • point selected, then click the edge  → commit
    //   • edge selected, then click the point   → commit
    // The edge is selected (not converted) when clicked with nothing
    // dimensionable already chosen. Convert is the LAST resort, only for
    // selections the direct path can't handle (line→edge, etc.).
    // Edge dimension (point/line ↔ projected edge), SolidWorks 3-click flow:
    //   pick the sketch entity + the edge (either order) → PLACEMENT click commits.
    // A single selected POINT or LINE is the sketch-side operand.
    const selEntity = sel.length === 1 && (sel[0].kind === 'point' || sel[0].kind === 'line') ? sel[0] : null;
    const pendingEdge = this.selectedExternalEdgeId();
    // Both operands chosen → this click is the placement; commit there.
    if (selEntity && pendingEdge) {
      const cand = this._candidateForEdgeId(pendingEdge);
      if (cand && this._commitEntityToEdge(selEntity, cand, { x, y })) return;
    }
    if (!picked) {
      // Nearest projected EDGE (ignoring vertices — `nearestCandidateHit`
      // prefers a vertex, which near an edge endpoint would block edge
      // selection). Wider hover buffer so the click grabs the edge the user saw
      // highlighted. Selecting the edge KEEPS an already-picked sketch entity so
      // the pair forms and the next click places the dim.
      const edgeCand = this._nearestEdgeCandidate({ x, y });
      if (edgeCand) {
        const key = this._candidateEdgeKey(edgeCand);
        if (key) {
          this.selectedExternalEdgeId.set(key);
          if (!selEntity) this.selected.set(new Set());
          return;
        }
      }
      const conv = this._convertCandidateEdgeForDim(x, y);
      if (conv) picked = conv;
    }
    // Edge already selected, now clicking the point/line operand → hold it and
    // wait for a placement click (don't commit yet).
    if (pendingEdge && !selEntity && picked && (picked.kind === 'point' || picked.kind === 'line')) {
      this.selected.set(new Set([picked.id]));
      return;
    }

    // If we already have a valid pick set, this click is the placement —
    // unless the click landed on an entity that EXTENDS the existing
    // selection (e.g. switching from "single line" to "line + line").
    if (canPlaceDimension(sel) && !(picked && extendsSmartDim(picked, sel))) {
      this.commitSmartDimAtPlacement(sel, { x, y });
      return;
    }

    if (!picked) {
      // Clicking empty space when we don't yet have a valid pick set
      // resets the in-progress selection.
      this.selected.set(new Set());
      return;
    }

    if (sel.length === 0) {
      this.selected.set(new Set([picked.id]));
      return;
    }
    if (extendsSmartDim(picked, sel)) {
      const next = new Set(sel.map(e => e.id));
      next.add(picked.id);
      this.selected.set(next);
      return;
    }
    // Picked entity doesn't compose with the current pick — restart with it.
    this.selected.set(new Set([picked.id]));
  }

  /** Tolerance for picking a projected model edge: the wider hover buffer (so a
   * click grabs the edge the user saw highlighted), falling back to the curve
   * tolerance if no pointer move has set the buffer yet. */
  private _edgePickTol(): number {
    return Math.max(this.lastEdgeTolerance, this.lastPickTolerance);
  }

  /** Smart-dim helper: convert the projected (straight) model edge nearest the
   * cursor into a sketch line tied to it by an `on-edge` constraint, so it can
   * be dimensioned like any other line. Returns the converted line entity (or
   * the already-converted one — repeated dims to the same edge reuse it), or
   * null when no edge candidate is in range. Commits the new geometry. */
  private _convertCandidateEdgeForDim(x: number, y: number): SketchEntity | null {
    const cands = this.candidates();
    if (!cands.length) return null;
    const hit = nearestCandidateHit(cands, { x, y }, this._edgePickTol());
    if (!hit || hit.kind !== 'edge') return null;
    const ref = externalRefForCandidate(hit.candidate);
    if (!ref) return null;
    const existing = this._existingOnEdgeLine(this.state(), ref);
    if (existing) return existing;
    const a = hit.candidate.points[0];
    const b = hit.candidate.points[1];
    if (!a || !b) return null;
    let s = this.state();
    const pa = addPoint(s, a.x, a.y); s = pa.state;
    const pb = addPoint(s, b.x, b.y); s = pb.state;
    const ln = addLine(s, pa.id, pb.id); s = ln.state;
    s = this._addOnEdge(s, ln.id, ref);
    // Read the entity from the state we built — commit() emits to the parent
    // and the new doc round-trips back through the `state` input only on the
    // next change-detection pass, so this.state() isn't updated yet.
    const entity = findEntity(s, ln.id) ?? null;
    this.commit(s);
    return entity;
  }

  /** The reference-edge candidate whose external-ref key matches `edgeId`
   * (local topoId or cross-part stableId) — used to resolve an edge that was
   * selected first into its live 2D projection. */
  private _candidateForEdgeId(edgeId: string): ReferenceCandidate | undefined {
    return this.candidates().find(
      c => c.kind === 'edge'
        && (c.crossPart ? c.crossPart.stableId : parseCandidateId(c.id)?.topoId) === edgeId,
    );
  }

  /** The external-ref key (local topoId / cross-part stableId) for an edge
   * candidate — what we store in `selectedExternalEdgeId`. */
  private _candidateEdgeKey(c: ReferenceCandidate): string | null {
    return c.crossPart ? c.crossPart.stableId : (parseCandidateId(c.id)?.topoId ?? null);
  }

  /** Nearest projected model EDGE candidate to the cursor (within the edge
   * pick buffer). Unlike `nearestCandidateHit`, vertices are ignored — a
   * projected vertex sitting on an edge endpoint would otherwise win and make
   * the edge unselectable for dimensioning. */
  private _nearestEdgeCandidate(p: { x: number; y: number }): ReferenceCandidate | null {
    const tol = this._edgePickTol();
    let best: ReferenceCandidate | null = null;
    let bestD = Infinity;
    for (const c of this.candidates()) {
      // Straight edges only for dimensioning — an arc's chord endpoints would
      // give a wrong driven distance. Curved-edge dimensions are REQ 830–832.
      if (c.kind !== 'edge' || c.points.length !== 2) continue;
      const q = closestPointOnSegment(c.points[0], c.points[1], p);
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d <= tol && d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  /** Live preview for an in-progress edge dimension: a sketch point/line plus a
   * selected projected edge, with the dim line following `cursor` (placement).
   * Null until both operands are chosen. */
  private _edgeDimPreview(cursor: { x: number; y: number }): DimensionRender | null {
    const pendingEdge = this.selectedExternalEdgeId();
    const sel = this.selectedEntities();
    const selEntity = sel.length === 1 && (sel[0].kind === 'point' || sel[0].kind === 'line') ? sel[0] : null;
    if (!pendingEdge || !selEntity) return null;
    const cand = this._candidateForEdgeId(pendingEdge);
    const a = cand?.points[0];
    const b = cand?.points[1];
    if (!a || !b) return null;
    const pointId = selEntity.kind === 'point' ? selEntity.id : selEntity.startId;
    return previewPointToEdgeDimension(this.state(), pointId, [a, b], cursor);
  }

  /** Dimension a sketch POINT or LINE to a projected model edge. A point uses
   * its perpendicular distance to the edge; a line uses its START endpoint's
   * perpendicular distance (the offset for the common parallel case). Returns
   * true if a dimension was added. */
  private _commitEntityToEdge(
    entity: SketchEntity, candidate: ReferenceCandidate, placement: { x: number; y: number },
  ): boolean {
    if (entity.kind === 'point') return this._commitPointToEdge(entity.id, candidate, placement);
    if (entity.kind === 'line') return this._commitPointToEdge(entity.startId, candidate, placement);
    return false;
  }

  /** Distance from a sketch POINT to a model EDGE, referencing the edge
   * DIRECTLY — a point-line-distance constraint with an externalRef. The solver
   * builds invisible fixed reference geometry for it (no converted sketch line
   * is created). `placement` is where the dimension text/line sits. Returns
   * true if it added the dimension. */
  private _commitPointToEdge(
    pointId: string, candidate: ReferenceCandidate, placement: { x: number; y: number },
  ): boolean {
    const ref = externalRefForCandidate(candidate);
    if (!ref) return false;
    const a = candidate.points[0];
    const b = candidate.points[1];
    if (!a || !b) return false;
    const pt = findPoint(this.state(), pointId);
    if (!pt) return false;
    // Perpendicular distance from the point to the edge's projected line.
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const value = Math.abs(((pt.x - a.x) * dy - (pt.y - a.y) * dx) / len);
    // A point that's already fully constrained → reference (driven) dimension.
    const driven = this.determinedEntities().has(pointId);
    const { state: next, constraint } = addConstraint(
      this.state(), 'point-line-distance', [pointId], value, placement, driven, ref,
    );
    this.commitAfterAdd(next, constraint.id);
    this.selected.set(new Set());
    this.selectedExternalEdgeId.set(null);
    // A DRIVEN (reference) dimension is read-only — don't pop the value editor;
    // only a DRIVING dimension opens for the user to type a value.
    if (!driven) this.dimensionCreated.emit(constraint.id);
    return true;
  }

  /** Find an existing sketch line already converted from the same model edge
   * (an `on-edge` constraint pointing at the same local edge id), so smart-dim
   * doesn't create a duplicate line each time it dimensions that edge. */
  private _existingOnEdgeLine(state: SketchState, ref: ExternalRef): SketchEntity | null {
    if (ref.scope === 'cross-part' || !ref.edgeId) return null;
    for (const c of state.constraints) {
      if (c.type !== 'on-edge') continue;
      const r = c.externalRef;
      if (r && r.scope !== 'cross-part' && r.edgeId === ref.edgeId) {
        const e = findEntity(state, c.targets[0]?.entityId ?? '');
        if (e && e.kind === 'line') return e;
      }
    }
    return null;
  }

  // ─── edit tools (Trim / Extend / Split / Offset) ─────────────────────
  //
  // Each is a single-click gesture: the algorithm lives in `sketchEditOps.ts`
  // as a pure function over SketchState; the handler picks the curve under
  // the click, hands it to the op, and commits the result. The op's
  // `error` field surfaces as a console warning for now — once we have a
  // toast surface in the editor those'll be wired through.

  private handleTrimClick(x: number, y: number) {
    const picked = pickEntity(this.state(), { x, y }, this.lastPickTolerance, this.lastPointPickTolerance);
    if (!picked) return;
    const result = trimAt(this.state(), picked.id, { x, y });
    if (result.error) { console.warn('Trim:', result.error); return; }
    this.commit(result.state);
    this.selected.set(new Set());
  }

  private handleExtendClick(x: number, y: number) {
    const picked = pickEntity(this.state(), { x, y }, this.lastPickTolerance, this.lastPointPickTolerance);
    if (!picked) return;
    if (picked.kind !== 'line') { console.warn('Extend: not a line'); return; }
    const result = extendLine(this.state(), picked.id, { x, y });
    if (result.error) { console.warn('Extend:', result.error); return; }
    this.commit(result.state);
    this.selected.set(new Set());
  }

  private handleSplitClick(x: number, y: number) {
    const picked = pickEntity(this.state(), { x, y }, this.lastPickTolerance, this.lastPointPickTolerance);
    if (!picked) return;
    if (picked.kind !== 'line') { console.warn('Split: only lines supported'); return; }
    const result = splitLineAt(this.state(), picked.id, { x, y });
    if (result.error) { console.warn('Split:', result.error); return; }
    this.commit(result.state);
    this.selected.set(new Set());
  }

  /** Offset click: PropertyManager-style — each click toggles a curve
   * in the queue rather than applying immediately. The cursor position
   * is remembered as the offset's `sidePoint` (used by `offsetCurve`
   * to figure out which side of the curve to offset toward). The
   * sidebar's OK button commits every queued curve in one batch.
   *
   * Chain mode (`offsetChainMode`): clicking one curve also pulls in
   * every curve connected to it through shared endpoints — handy for
   * offsetting a whole polyline / closed loop without clicking each
   * segment. Each chained curve uses the original click's cursor
   * position as its sidePoint; for tightly-curved chains the result
   * may need a flip pass, but the common case (gently-curved chains)
   * comes out consistent. */
  private handleOffsetClick(x: number, y: number) {
    const picked = pickEntity(this.state(), { x, y }, this.lastPickTolerance, this.lastPointPickTolerance);
    if (!picked) return;
    if (picked.kind !== 'line' && picked.kind !== 'circle' && picked.kind !== 'arc') {
      console.warn('Offset: only lines, circles, and arcs can be offset');
      return;
    }
    // Construction geometry is allowed — SW behavior. The pure-op
    // (offsetCurve / offsetChain) accepts it, and a construction-line
    // offset is useful for building reference geometry without
    // affecting profile extraction.
    const next = new Map(this.offsetSelections());
    if (next.has(picked.id)) {
      // Toggle off — and if we're in chain mode, drop the chain
      // group around this pick so the user can clear a whole chain
      // by re-clicking any member.
      if (this.offsetChainMode()) {
        for (const id of findChainedEntities(this.state(), picked.id)) next.delete(id);
      } else {
        next.delete(picked.id);
      }
    } else {
      const seedSidePoint = { x, y };
      next.set(picked.id, { sidePoint: seedSidePoint });
      if (this.offsetChainMode()) {
        // Delegate to the chain-aware propagation helper. It walks
        // the chain in traversal order so each curve's sidePoint is
        // computed in the same direction relative to the chain
        // (open chain) or the same in/out region of the loop
        // (closed chain). Without this, segments stored with mixed
        // directions ended up on opposite sides of the chain.
        const chainIds = findChainedEntities(this.state(), picked.id);
        const propagated = propagateOffsetSides(this.state(), picked.id, seedSidePoint, chainIds);
        for (const [id, sp] of propagated) {
          if (!next.has(id)) next.set(id, { sidePoint: sp });
        }
      }
    }
    this.offsetSelections.set(next);
  }

  /** Compute the offset RESULT state without committing it. Used by
   * both the commit path (run it, then commit + tool-exit) and the
   * preview path (run it, then tessellate the new entities so the
   * viewer can render dashed ghosts). Centralizing the computation
   * keeps preview ⇔ commit visually identical. */
  private computeOffsetResult(): { state: SketchState; newIds: string[] } | null {
    const dist = this.offsetDistance();
    const queue = this.offsetSelections();
    if (queue.size === 0 || dist <= 0) return null;
    const items = [...queue].map(([id, v]) => ({ entityId: id, sidePoint: v.sidePoint }));
    const r = offsetChain(this.state(), items, dist, {
      bothDirections: this.offsetBothDirections(),
      fillCorners: this.offsetFillCorners(),
      // Linking adds constraints (parallel / concentric +
      // dimensional dim). Skipped for bothDirections because the
      // two passes would conflict over the same dim value.
      linkToOriginals: !this.offsetBothDirections(),
    });
    if (r.error) {
      console.warn('Offset:', r.error);
      return null;
    }
    // window.__cadDebug dump — captures the inputs (sources +
    // sidePoints) and outputs (newIds + their geometry) so we can
    // tell where the corner reconciliation is misfiring.
    if (typeof globalThis !== 'undefined' && (globalThis as { __cadDebug?: boolean }).__cadDebug) {
      const itemDump = items.map(it => {
        const ent = this.state().entities.find(e => e.id === it.entityId);
        const span = ent && ent.kind === 'line'
          ? (() => {
              const a = findPoint(this.state(), ent.startId);
              const b = findPoint(this.state(), ent.endId);
              return a && b ? `(${a.x.toFixed(2)},${a.y.toFixed(2)}) → (${b.x.toFixed(2)},${b.y.toFixed(2)})` : null;
            })()
          : null;
        return { id: it.entityId, kind: ent?.kind, span, sidePoint: it.sidePoint };
      });
      const outDump = (r.affectedIds ?? []).map(id => {
        const ent = r.state.entities.find(e => e.id === id);
        if (!ent) return { id, kind: null };
        if (ent.kind === 'line') {
          const a = findPoint(r.state, ent.startId);
          const b = findPoint(r.state, ent.endId);
          return { id, kind: 'line', start: a ? { x: a.x, y: a.y } : null, end: b ? { x: b.x, y: b.y } : null };
        }
        if (ent.kind === 'arc') {
          const c = findPoint(r.state, ent.centerId);
          const a = findPoint(r.state, ent.startId);
          const b = findPoint(r.state, ent.endId);
          return { id, kind: 'arc', center: c, start: a, end: b, radius: ent.radius, ccw: ent.ccw };
        }
        return { id, kind: ent.kind };
      });
      // eslint-disable-next-line no-console
      console.log('[cad-offset]\n' + JSON.stringify({
        distance: dist,
        bothDirections: this.offsetBothDirections(),
        fillCorners: this.offsetFillCorners(),
        keepConstruction: this.offsetKeepConstruction(),
        chainMode: this.offsetChainMode(),
        inputs: itemDump,
        outputs: outDump,
        opError: r.error,
      }, null, 2));
    }
    let s = r.state;
    if (this.offsetKeepConstruction()) {
      s = setConstructionFlag(s, [...queue.keys()], true);
    }
    return { state: s, newIds: r.affectedIds ?? [] };
  }

  /** Commit the queued offsets in one batch via `offsetChain`. The
   * chain op handles corner reconciliation (arc filler at convex
   * corners, intersect-trim at concave corners) and the both-
   * directions flag for free. */
  commitOffset() {
    const r = this.computeOffsetResult();
    if (!r) return;
    this.commit(r.state);
    this.offsetSelections.set(new Map());
    this.tool.set('select');
  }

  /** Reactive preview state derived from the offset queue + settings.
   * Returns the IDs of new entities that would be created on commit,
   * AND the SketchState that contains them (so the viewer can read
   * their geometry to tessellate the ghost). Null when the queue is
   * empty or the result is invalid. The cad-viewer reads these via
   * a parent computed and renders them as dashed orange polylines. */
  offsetPreviewState = computed<{ state: SketchState; newIds: string[] } | null>(() => {
    if (this.tool() !== 'offset') return null;
    // Touch the inputs so this computed invalidates when any of them
    // change — distance, queue contents, both-directions, fill-
    // corners.
    void this.offsetSelections();
    void this.offsetDistance();
    void this.offsetBothDirections();
    void this.offsetFillCorners();
    void this.state();
    return this.computeOffsetResult();
  });

  /** Sidebar Cancel — drop the queue and go back to Select. */
  cancelOffset() {
    this.offsetSelections.set(new Map());
    this.tool.set('select');
  }

  /** Sidebar entity-row × button — drop a single curve from the
   * queue. Used when the user picked something wrong without
   * needing to re-click in the canvas. */
  removeOffsetSelection(id: string) {
    const next = new Map(this.offsetSelections());
    next.delete(id);
    this.offsetSelections.set(next);
  }

  /** Sidebar "Flip side" button — toggles which side of every
   * queued curve the offset lands on. Mirrors each entity's
   * sidePoint across its own geometry, so the next preview /
   * commit goes the opposite direction. */
  flipOffsetSide() {
    const s = this.state();
    const next = new Map<string, { sidePoint: { x: number; y: number } }>();
    for (const [id, { sidePoint }] of this.offsetSelections()) {
      next.set(id, { sidePoint: flipSidePoint(s, id, sidePoint) });
    }
    this.offsetSelections.set(next);
  }

  /** Per-row flip — toggles the side for ONLY the one queued curve
   * rather than all of them. Lets the user mix in/out offsets in
   * the same batch (e.g., offset two chain segments outward and one
   * inward without separating into two commits). */
  flipOffsetSelectionSide(id: string) {
    const entry = this.offsetSelections().get(id);
    if (!entry) return;
    const next = new Map(this.offsetSelections());
    next.set(id, { sidePoint: flipSidePoint(this.state(), id, entry.sidePoint) });
    this.offsetSelections.set(next);
  }

  /** Fillet — prompts for radius on first entry, then either:
   *   - Pre-selection batch: if the user pre-selected corner points
   *     (in Select mode), the radius confirmation fillets all of them in
   *     one commit. SW-style "Fillet multiple corners" workflow.
   *   - Single-shortcut: click a corner point → fillet the two adjacent
   *     lines at that vertex.
   *   - Two-line pick: click line 1, click line 2 → fillet at their
   *     (real or virtual) intersection. */
  /** Fillet click handler — sidebar workflow.
   *   Click a corner point in the canvas → toggle it in the filletCorners
   *   set. The sidebar's OK button (in cad-editor) commits the batch with
   *   the radius value the sidebar's input field maintains.
   *
   * Two-line picks (for filleting at a virtual intersection) are no longer
   * supported via the toolbar — the sidebar's corner-list paradigm doesn't
   * fit them. Users who need it can add a constraint to coerce the
   * intersection first, then fillet the resulting corner. */
  private handleFilletClick(x: number, y: number) {
    const picked = pickEntity(this.state(), { x, y }, this.lastPickTolerance, this.lastPointPickTolerance);
    if (!picked) return;
    if (picked.kind !== 'point') {
      console.warn('Fillet: click a corner point (a vertex shared by two curves)');
      return;
    }
    // Allow corners shared by ANY two non-construction curves (line
    // or arc) — supports line+line, line+arc, and arc+arc fillets.
    const curves = this.curvesIncidentTo(this.state(), picked.id);
    if (curves.length !== 2) {
      console.warn('Fillet: clicked point is not shared by exactly two curves');
      return;
    }
    const next = new Set(this.filletCorners());
    if (next.has(picked.id)) next.delete(picked.id);
    else next.add(picked.id);
    this.filletCorners.set(next);
  }

  /** Remove a corner from the Fillet sidebar's list (X button). */
  removeFilletCorner(pointId: string) {
    const next = new Set(this.filletCorners());
    next.delete(pointId);
    this.filletCorners.set(next);
  }

  /** Commit the batch Fillet — iterate every corner in the list and apply
   * the current radius. Skips corners that error (radius too large, etc.)
   * with a warning so partial commits still land. After the batch, adds
   * a `radius` dimension to the FIRST created arc so the user has a
   * single live value they can edit; subsequent fillets stay un-dimed to
   * avoid auto-littering the sketch with N identical radius labels.
   * Returns to Select after. */
  commitFillet() {
    const r = this.filletRadius();
    if (r === null || r <= 0) { console.warn('Fillet: enter a positive radius first'); return; }
    const corners = [...this.filletCorners()];
    if (corners.length === 0) return;
    let s = this.state();
    const newArcIds: string[] = [];
    for (const id of corners) {
      const curves = this.curvesIncidentTo(s, id);
      if (curves.length !== 2) continue;
      const [c1, c2] = curves;
      // Dispatch by kind pair: line+line uses the existing fillet,
      // mixed line+arc uses the new filletLineArc, arc+arc is not
      // yet supported.
      let result: ReturnType<typeof filletLines> | null = null;
      if (c1.kind === 'line' && c2.kind === 'line') {
        result = filletLines(s, c1.id, c2.id, r, {
          keepRemovedAsConstruction: this.filletKeepConstruction(),
        });
      } else if (c1.kind === 'line' && c2.kind === 'arc') {
        result = filletLineArc(s, c1.id, c2.id, r, {
          keepRemovedAsConstruction: this.filletKeepConstruction(),
        });
      } else if (c1.kind === 'arc' && c2.kind === 'line') {
        result = filletLineArc(s, c2.id, c1.id, r, {
          keepRemovedAsConstruction: this.filletKeepConstruction(),
        });
      } else {
        console.warn(`Fillet at ${id}: arc+arc not yet supported`);
        continue;
      }
      if (result.error) { console.warn(`Fillet at ${id}:`, result.error); continue; }
      s = result.state;
      if (result.affectedIds) {
        const arcId = result.affectedIds.find(aid => findEntity(s, aid)?.kind === 'arc');
        if (arcId) newArcIds.push(arcId);
      }
    }
    // Equal-radius across every arc in the batch — so edits to the
    // dimensioned arc below propagate to the rest. We chain everything
    // to the first arc (rather than pairwise) for the smallest count.
    for (let i = 1; i < newArcIds.length; i++) {
      s = addConstraint(s, 'equal', [newArcIds[0], newArcIds[i]]).state;
    }
    // Single radius dim on the first arc — the equal chain propagates
    // the value to the rest.
    if (newArcIds.length > 0) {
      const arc = findEntity(s, newArcIds[0]);
      if (arc?.kind === 'arc') {
        const c = findPoint(s, arc.centerId);
        const placement = c ? { x: c.x + arc.radius * 0.7, y: c.y + arc.radius * 0.7 } : undefined;
        s = addConstraint(s, 'radius', [newArcIds[0]], r, placement).state;
      }
    }
    this.commit(s);
    this.filletCorners.set(new Set());
    this.tool.set('select');
  }

  cancelFillet() {
    this.filletCorners.set(new Set());
    this.tool.set('select');
  }

  /** Pre-selected corners eligible for batch fillet — points whose
   * coincident-group has exactly two incident curves (line or arc). */
  private cornersInSelection(): string[] {
    const out: string[] = [];
    for (const e of this.selectedEntities()) {
      if (e.kind !== 'point') continue;
      const curves = this.curvesIncidentTo(this.state(), e.id);
      if (curves.length === 2) out.push(e.id);
    }
    return out;
  }

  /** Apply Fillet to every supplied corner with the same radius. Any
   * corner that errors (radius too large, degenerate, etc.) is skipped
   * with a warning — partial commit beats refusing to do anything. */
  private batchFilletCorners(cornerIds: string[], radius: number) {
    let s = this.state();
    for (const id of cornerIds) {
      const curves = this.curvesIncidentTo(s, id);
      if (curves.length !== 2) continue;
      const [c1, c2] = curves;
      let result: ReturnType<typeof filletLines> | null = null;
      if (c1.kind === 'line' && c2.kind === 'line') {
        result = filletLines(s, c1.id, c2.id, radius);
      } else if (c1.kind === 'line' && c2.kind === 'arc') {
        result = filletLineArc(s, c1.id, c2.id, radius);
      } else if (c1.kind === 'arc' && c2.kind === 'line') {
        result = filletLineArc(s, c2.id, c1.id, radius);
      } else {
        continue;
      }
      if (result.error) {
        console.warn(`Fillet at ${id}:`, result.error);
        continue;
      }
      s = result.state;
    }
    this.commit(s);
  }

  /** Public so external callers (cad-editor's sketchPreview computed
   * needs it for the fillet/chamfer preview overlay) can ask "which lines
   * meet at this corner?" without duplicating the position-tolerance
   * logic.
   *
   * Lines whose endpoints sit at the same POSITION as `pointId`'s
   * coordinates (within `LINES_INCIDENT_TOL` sketch units). Position
   * matching is more permissive than ID matching:
   *   - direct ID match (shared point — Rectangle tool corners) ✓
   *   - coincident-linked separate points (polygon closure, line-draw
   *     coincident-on-snap) ✓
   *   - separate points that just happen to be in the same spot
   *     (user manually clicked the same coords with no snap) ✓
   *
   * The last case is the one the previous coincident-graph traversal
   * missed — a manually drawn polyline where each segment was started
   * by clicking into open space at a corner location, not by snapping
   * to an existing point. Position matching catches all three.
   */
  /** Lines (excluding construction) ending at or coincident with the
   * given point. Used by Fillet + Chamfer to identify a corner — both
   * tools only operate on real geometry, so a construction line passing
   * through the same vertex is intentionally ignored. This lets the
   * user fillet two normal lines that share a corner even when a
   * construction diagonal also meets there (REQ 642). */
  linesIncidentTo(state: SketchState, pointId: string): LineEntity[] {
    const pt = findPoint(state, pointId);
    if (!pt) return [];
    const out: LineEntity[] = [];
    for (const e of state.entities) {
      if (e.kind !== 'line') continue;
      if (e.construction) continue;
      const a = findPoint(state, e.startId);
      const b = findPoint(state, e.endId);
      const aAt = a && Math.hypot(a.x - pt.x, a.y - pt.y) < LINES_INCIDENT_TOL;
      const bAt = b && Math.hypot(b.x - pt.x, b.y - pt.y) < LINES_INCIDENT_TOL;
      if (aAt || bAt) out.push(e);
    }
    return out;
  }

  /** Same as `linesIncidentTo` but also matches arcs whose start or
   * end endpoint sits at `pointId`. Used by Fillet so line+arc and
   * arc+arc corners can be picked alongside line+line ones. */
  curvesIncidentTo(state: SketchState, pointId: string): Array<LineEntity | ArcEntity> {
    const pt = findPoint(state, pointId);
    if (!pt) return [];
    const out: Array<LineEntity | ArcEntity> = [];
    for (const e of state.entities) {
      if (e.construction) continue;
      if (e.kind !== 'line' && e.kind !== 'arc') continue;
      const a = findPoint(state, e.startId);
      const b = findPoint(state, e.endId);
      const aAt = a && Math.hypot(a.x - pt.x, a.y - pt.y) < LINES_INCIDENT_TOL;
      const bAt = b && Math.hypot(b.x - pt.x, b.y - pt.y) < LINES_INCIDENT_TOL;
      if (aAt || bAt) out.push(e);
    }
    return out;
  }

  /** Chamfer click handler — sidebar workflow (mirror of Fillet). Each
   * click toggles a corner in the chamferCorners set; the sidebar's OK
   * button commits the batch with the distance value. */
  private handleChamferClick(x: number, y: number) {
    const picked = pickEntity(this.state(), { x, y }, this.lastPickTolerance, this.lastPointPickTolerance);
    if (!picked) return;
    if (picked.kind !== 'point') {
      console.warn('Chamfer: click a corner point (a vertex shared by two lines)');
      return;
    }
    const lines = this.linesIncidentTo(this.state(), picked.id);
    if (lines.length !== 2) {
      console.warn('Chamfer: clicked point is not shared by exactly two lines');
      return;
    }
    const next = new Set(this.chamferCorners());
    if (next.has(picked.id)) next.delete(picked.id);
    else next.add(picked.id);
    this.chamferCorners.set(next);
  }

  removeChamferCorner(pointId: string) {
    const next = new Set(this.chamferCorners());
    next.delete(pointId);
    this.chamferCorners.set(next);
  }

  commitChamfer() {
    const d = this.chamferDistance();
    if (d === null || d <= 0) { console.warn('Chamfer: enter a positive distance first'); return; }
    const corners = [...this.chamferCorners()];
    if (corners.length === 0) return;
    const mode = this.currentChamferMode();
    let s = this.state();
    // Track each new cut line paired with the original corner position (V)
    // so dim emission can push labels OUTSIDE the cut-off corner instead of
    // mirror-imaging them across the cut line. Also track the construction
    // lines this chamfer added so we can chain them across the batch.
    const newCutEntries: Array<{
      cutLineId: string;
      V: { x: number; y: number };
      cornerId: string;
      constructionLineIds: string[];
    }> = [];
    for (const id of corners) {
      const lines = this.linesIncidentTo(s, id);
      if (lines.length !== 2) continue;
      const cornerPt = findPoint(s, id);
      const V = cornerPt ? { x: cornerPt.x, y: cornerPt.y } : null;
      // computeChamferGeometry handles the more-vertical-first swap for
      // distance-distance mode internally, so we just pass the lines in
      // their natural incident order. Same swap applies in the preview,
      // keeping preview ≡ commit geometry.
      const result = chamferLines(s, lines[0].id, lines[1].id, mode, {
        keepRemovedAsConstruction: this.chamferKeepConstruction(),
      });
      if (result.error) { console.warn(`Chamfer at ${id}:`, result.error); continue; }
      s = result.state;
      if (result.affectedIds) {
        const cutId = result.affectedIds.find(aid => aid !== lines[0].id && aid !== lines[1].id);
        if (cutId && V) {
          newCutEntries.push({
            cutLineId: cutId, V, cornerId: id,
            constructionLineIds: result.constructionLineIds ?? [],
          });
        }
      }
    }
    const newCutLineIds = newCutEntries.map(e => e.cutLineId);
    // Dimensioning strategy by mode:
    //   - equal-distance / distance-distance: per-chamfer vertical-
    //     distance + horizontal-distance dims between T1 and T2. The two
    //     dims together pin the cut endpoints. For axis-aligned right-
    //     angle corners, equal-distance gives Δx = Δy; distance-distance
    //     gives the user's input "Vertical" + "Horizontal" directly.
    //     Initial values across the batch are equal, so the user's
    //     intent "vertical parts equal, horizontal parts equal" holds at
    //     creation. (Live propagation when editing one dim would need
    //     equation support, which we don't have.)
    //   - distance-angle: the natural dim is the cut LENGTH along the
    //     diagonal. Keep the single distance dim + equal-cutline chain
    //     so radius edits propagate.
    if (mode.kind === 'distance-angle') {
      for (let i = 1; i < newCutLineIds.length; i++) {
        s = addConstraint(s, 'equal', [newCutLineIds[0], newCutLineIds[i]]).state;
      }
      if (newCutLineIds.length > 0) {
        const cutLine = findEntity(s, newCutLineIds[0]);
        if (cutLine?.kind === 'line') {
          const a = findPoint(s, cutLine.startId);
          const b = findPoint(s, cutLine.endId);
          if (a && b) {
            const cutLen = Math.hypot(b.x - a.x, b.y - a.y);
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const dx = b.x - a.x, dy = b.y - a.y;
            const len = Math.hypot(dx, dy) || 1;
            const placement = { x: mid.x - dy / len * 5, y: mid.y + dx / len * 5 };
            s = addConstraint(s, 'distance', [cutLine.startId, cutLine.endId], cutLen, placement).state;
          }
        }
      }
    } else if (this.chamferKeepConstruction()) {
      // equal-distance / distance-distance with construction lines ON:
      // dimension the construction lines themselves, not the cut endpoints.
      // For each chamfer, two construction lines are added — one along the
      // more-vertical original line, one along the more-horizontal. Across
      // the batch, chain all "vertical" construction lines with `equal`
      // (and same for horizontal) so a single edit to the dim propagates
      // to every chamfer. Emit ONE distance dim per group (on the first
      // line in each group) instead of two dims per chamfer.
      const vCtors: string[] = [];
      const hCtors: string[] = [];
      for (const entry of newCutEntries) {
        for (const cId of entry.constructionLineIds) {
          const ce = findEntity(s, cId);
          if (ce?.kind !== 'line') continue;
          const ap = findPoint(s, ce.startId);
          const bp = findPoint(s, ce.endId);
          if (!ap || !bp) continue;
          if (Math.abs(bp.y - ap.y) > Math.abs(bp.x - ap.x)) vCtors.push(cId);
          else hCtors.push(cId);
        }
      }
      const dimGroup = (group: string[]) => {
        if (group.length === 0) return;
        // Chain every line in the group equal to the first — a single dim
        // on group[0] then propagates to the rest.
        for (let i = 1; i < group.length; i++) {
          s = addConstraint(s, 'equal', [group[0], group[i]]).state;
        }
        const ln = findEntity(s, group[0]);
        if (ln?.kind !== 'line') return;
        const ap = findPoint(s, ln.startId);
        const bp = findPoint(s, ln.endId);
        if (!ap || !bp) return;
        const len = Math.hypot(bp.x - ap.x, bp.y - ap.y);
        const mid = { x: (ap.x + bp.x) / 2, y: (ap.y + bp.y) / 2 };
        const dx = bp.x - ap.x, dy = bp.y - ap.y;
        const lineLen = Math.hypot(dx, dy) || 1;
        // Place the label perpendicular to the construction line, on the
        // side AWAY from the cut (i.e., away from the cut line). The cut
        // line endpoints aren't local here, so use a fixed perpendicular
        // offset — the user can drag the label after if they want.
        const placement = { x: mid.x - dy / lineLen * 6, y: mid.y + dx / lineLen * 6 };
        s = addConstraint(s, 'distance', [ln.startId, ln.endId], len, placement).state;
      };
      dimGroup(vCtors);
      dimGroup(hCtors);
    } else {
      // equal-distance / distance-distance with construction lines OFF:
      // fall back to per-chamfer v-dist/h-dist on the cut endpoints since
      // there are no construction lines to dimension. No chaining.
      for (const { cutLineId, V } of newCutEntries) {
        const cutLine = findEntity(s, cutLineId);
        if (cutLine?.kind !== 'line') continue;
        const a = findPoint(s, cutLine.startId);
        const b = findPoint(s, cutLine.endId);
        if (!a || !b) continue;
        const vExt = Math.abs(b.y - a.y);
        const hExt = Math.abs(b.x - a.x);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const outX = V.x - mid.x, outY = V.y - mid.y;
        const outLen = Math.hypot(outX, outY) || 1;
        const ux = outX / outLen, uy = outY / outLen;
        const placement = { x: mid.x + ux * 6, y: mid.y + uy * 6 };
        s = addConstraint(s, 'vertical-distance', [cutLine.startId, cutLine.endId], vExt, placement).state;
        s = addConstraint(s, 'horizontal-distance', [cutLine.startId, cutLine.endId], hExt, placement).state;
      }
    }
    // Pin pt1/pt2 to their initial T1/T2 positions for THIS commit solve,
    // and pin every other point too. Only the orphan corner V is movable
    // (it needs to settle at the L7∩L8 intersection via the collinear
    // construction-line constraints). PlaneGCS detects the rectangle's
    // auto-constraints + chamfer collinears as redundant with the h-dist/
    // v-dist dims and was dropping the dims, letting the cut endpoints
    // drift to the mirror configuration. Pinning pt1/pt2 sidesteps that
    // ambiguity entirely — the cut endpoints stay where chamferLines put
    // them. Future re-solves (e.g., when the user edits a dim value via
    // the global solver) get a fresh movable set, so the chamfer remains
    // editable; this pinning is local to the chamfer-commit pass.
    const movablePoints = new Set<string>();
    for (const entry of newCutEntries) {
      movablePoints.add(entry.cornerId); // V only
    }
    this.commitWithMovable(s, movablePoints);
    this.chamferCorners.set(new Set());
    this.tool.set('select');
  }

  /** Variant of commit() that pins every point not in `movablePoints` so
   * the solver settles only the requested geometry. Mirrors the structure
   * of commit() — emit unsolved state, run pinned solve, emit solved state. */
  private async commitWithMovable(next: SketchState, movablePoints: Set<string>) {
    if (this.drawConstruction()) {
      const prevIds = new Set(this.state().entities.map(e => e.id));
      const addedIds = next.entities.filter(e => !prevIds.has(e.id)).map(e => e.id);
      if (addedIds.length > 0) {
        next = setConstructionFlag(next, addedIds, true);
      }
    }
    const id = ++this.latestCommitId;
    this.sketchChanged.emit(next);
    const result = await solveSketch(next, { movablePoints, externalEdges: this._externalEdgeLines() });
    if (id !== this.latestCommitId) return;
    this._recordSolve(result);
    if (result.status === 'ok') {
      this.sketchChanged.emit(result.state);
    } else {
      // Fallback: retry without pinning. Some constraint sets genuinely
      // need pre-existing geometry to move (rare for chamfer).
      const fallback = await solveSketch(next, { externalEdges: this._externalEdgeLines() });
      if (id !== this.latestCommitId) return;
      this._recordSolve(fallback);
      this.solverDof.set(fallback.dof);
      if (fallback.status === 'ok') this.sketchChanged.emit(fallback.state);
    }
  }


  cancelChamfer() {
    this.chamferCorners.set(new Set());
    this.tool.set('select');
  }

  /** Move — two clicks (reference point, destination). Pre-selection
   * decides what gets moved. The reference click can land anywhere in the
   * sketch; the destination click sets the translation delta. Selection
   * survives the commit so the user can move again with a fresh pair. */
  private handleMoveClick(x: number, y: number) {
    if (this.selected().size === 0) {
      console.warn('Move: select entities first');
      return;
    }
    const ref = this.draftMoveRef();
    if (!ref) { this.draftMoveRef.set({ x, y }); return; }
    const dx = x - ref.x, dy = y - ref.y;
    const result = moveEntities(this.state(), Array.from(this.selected()), dx, dy);
    if (result.error) { console.warn('Move:', result.error); this.draftMoveRef.set(null); return; }
    this.commit(result.state);
    this.draftMoveRef.set(null);
  }

  /** Copy — same two-click gesture as Move, but `copyEntities` clones
   * everything (new entity ids, new point ids) instead of mutating. The
   * selection switches to the new copies so the user can chain another
   * Copy or Move on them. */
  private handleCopyClick(x: number, y: number) {
    if (this.selected().size === 0) {
      console.warn('Copy: select entities first');
      return;
    }
    const ref = this.draftCopyRef();
    if (!ref) { this.draftCopyRef.set({ x, y }); return; }
    const dx = x - ref.x, dy = y - ref.y;
    const result = copyEntities(this.state(), Array.from(this.selected()), dx, dy);
    if (result.error) { console.warn('Copy:', result.error); this.draftCopyRef.set(null); return; }
    this.commit(result.state);
    this.selected.set(new Set(result.affectedIds ?? []));
    this.draftCopyRef.set(null);
  }

  /** Rotate — click a pivot point, prompt for angle in degrees, rotate. */
  private handleRotateClick(x: number, y: number) {
    if (this.selected().size === 0) {
      console.warn('Rotate: select entities first');
      return;
    }
    // REQ 862: angle comes from the ribbon's contextual input, not a prompt.
    const deg = this.rotateAngleDeg();
    if (!isFinite(deg) || Math.abs(deg) < 1e-9) { console.warn('Rotate: invalid angle'); return; }
    const result = rotateEntities(
      this.state(), Array.from(this.selected()), { x, y }, deg * Math.PI / 180,
    );
    if (result.error) { console.warn('Rotate:', result.error); return; }
    this.commit(result.state);
  }

  /** Scale — click a pivot point, prompt for a scale factor. Negative
   * factors mirror across the pivot; the radius parameter on circles /
   * arcs / ellipses uses |factor|. */
  private handleScaleClick(x: number, y: number) {
    if (this.selected().size === 0) {
      console.warn('Scale: select entities first');
      return;
    }
    // REQ 862: factor comes from the ribbon's contextual input, not a prompt.
    const f = this.scaleFactor();
    if (!isFinite(f) || Math.abs(f) < 1e-9) { console.warn('Scale: invalid factor'); return; }
    const result = scaleEntities(this.state(), Array.from(this.selected()), { x, y }, f);
    if (result.error) { console.warn('Scale:', result.error); return; }
    this.commit(result.state);
  }

  /** Jog Line — three clicks:
   *   1. Pick the line.
   *   2. Click the jog START: along position is the click's projection
   *      onto the line; perpendicular offset is the click's distance
   *      from the line.
   *   3. Click the jog END: along position is the click's projection.
   * Calls `jogLineAt(line, t1, t2, perpOffset)` which replaces the
   * line with a 5-segment Z-jog.
   */
  private handleJogClick(x: number, y: number) {
    const draft = this.draftJog();
    if (!draft.lineId) {
      const picked = pickEntity(this.state(), { x, y }, this.lastPickTolerance, this.lastPointPickTolerance);
      if (!picked || picked.kind !== 'line') return;
      this.draftJog.set({ lineId: picked.id });
      return;
    }
    const ln = findEntity<LineEntity>(this.state(), draft.lineId);
    if (!ln) { this.draftJog.set({}); return; }
    const a = findPoint(this.state(), ln.startId);
    const b = findPoint(this.state(), ln.endId);
    if (!a || !b) { this.draftJog.set({}); return; }
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) { this.draftJog.set({}); return; }
    const ux = dx / len, uy = dy / len;
    const nx = -uy, ny = ux;
    const along = (px: number, py: number) => ((px - a.x) * ux + (py - a.y) * uy) / len;
    const perp = (px: number, py: number) => (px - a.x) * nx + (py - a.y) * ny;
    if (!draft.start) {
      this.draftJog.set({ lineId: draft.lineId, start: { x, y } });
      return;
    }
    const t1 = along(draft.start.x, draft.start.y);
    const perpOffset = perp(draft.start.x, draft.start.y);
    const t2 = along(x, y);
    const result = jogLineAt(this.state(), draft.lineId, t1, t2, perpOffset);
    if (result.error) {
      console.warn('Jog:', result.error);
      this.draftJog.set({});
      return;
    }
    this.commit(result.state);
    this.draftJog.set({});
  }

  /** Stretch — same two-click gesture as Move, but only translates the
   * POINTS in the selection (lines stretch as their endpoints move).
   * Pre-select via rubber-band; bare line selections won't move
   * anything since stretchEntities ignores non-point ids. */
  private handleStretchClick(x: number, y: number) {
    if (this.selected().size === 0) {
      console.warn('Stretch: select points (and any entities you want to drag) first');
      return;
    }
    const ref = this.draftStretchRef();
    if (!ref) { this.draftStretchRef.set({ x, y }); return; }
    const dx = x - ref.x, dy = y - ref.y;
    const result = stretchEntities(this.state(), Array.from(this.selected()), dx, dy);
    if (result.error) { console.warn('Stretch:', result.error); this.draftStretchRef.set(null); return; }
    this.commit(result.state);
    this.draftStretchRef.set(null);
  }

  /** Linear pattern — pre-select entities, then two clicks define the
   * spacing vector. Prompt asks for instance count (>= 2). The first
   * click pins the "from" point; the second click's delta becomes the
   * step vector. */
  private handlePatternLinearClick(x: number, y: number) {
    if (this.selected().size === 0) {
      console.warn('Linear pattern: select entities first');
      return;
    }
    const ref = this.draftPatternRef();
    if (!ref) { this.draftPatternRef.set({ x, y }); return; }
    const dx = x - ref.x, dy = y - ref.y;
    if (Math.hypot(dx, dy) < 1) { this.draftPatternRef.set(null); return; }
    // REQ 862: count comes from the ribbon's contextual input, not a prompt.
    const n = Math.round(this.patternLinearCount());
    if (!isFinite(n) || n < 2) { console.warn('Linear pattern: count must be >= 2'); this.draftPatternRef.set(null); return; }
    const result = linearPatternEntities(this.state(), Array.from(this.selected()), dx, dy, n);
    if (result.error) { console.warn('Linear pattern:', result.error); this.draftPatternRef.set(null); return; }
    this.commit(result.state);
    this.draftPatternRef.set(null);
  }

  /** Circular pattern — pre-select entities, click center, prompt for
   * count + total sweep angle (degrees). */
  private handlePatternCircularClick(x: number, y: number) {
    if (this.selected().size === 0) {
      console.warn('Circular pattern: select entities first');
      return;
    }
    // REQ 862: count + sweep come from the ribbon's contextual inputs.
    const n = Math.round(this.patternCircCount());
    if (!isFinite(n) || n < 2) { console.warn('Circular pattern: count must be >= 2'); return; }
    const totalDeg = this.patternCircSweepDeg();
    if (!isFinite(totalDeg) || Math.abs(totalDeg) < 1) { console.warn('Circular pattern: invalid angle'); return; }
    const result = circularPatternEntities(
      this.state(), Array.from(this.selected()), { x, y }, totalDeg * Math.PI / 180, n,
    );
    if (result.error) { console.warn('Circular pattern:', result.error); return; }
    this.commit(result.state);
  }

  /** Dynamic mirror — click a line to set as the live mirror axis.
   * Every subsequent draw commit gets mirrored across it (see the
   * dynamic-mirror branch in `commit`). Clicking the tool again with
   * an axis already set turns it OFF instead of waiting for another
   * line click; cleaner than a separate disable button. */
  private handleDynamicMirrorClick(x: number, y: number) {
    if (this.dynamicMirrorAxisId() !== null) {
      // Axis already set → tool click toggles off.
      this.dynamicMirrorAxisId.set(null);
      this.tool.set('select');
      return;
    }
    const picked = pickEntity(this.state(), { x, y }, this.lastPickTolerance, this.lastPointPickTolerance);
    if (!picked || picked.kind !== 'line') {
      console.warn('Dynamic mirror: click on a line to use as the axis');
      return;
    }
    this.dynamicMirrorAxisId.set(picked.id);
    this.tool.set('select');
  }

  /** Mirror — two-stage gesture driven by the PropertyManager-style sidebar.
   *   Stage 1 ('pick-entities'): each click toggles an entity in the
   *       selection set. The sidebar's first field shows the count.
   *   Stage 2 ('pick-axis'): the click sets `mirrorAxisId` to the picked
   *       line. The sidebar's second field shows it.
   * The mirror operation itself doesn't run until the user clicks OK in
   * the panel (`commitMirror`), so they can refine the selection without
   * accidentally triggering the op. Auto-advance: when the user picks
   * any line during 'pick-entities', the sidebar field for the axis
   * lights up but stage doesn't auto-advance — they need to click into
   * the axis field. Lower friction than auto-advancing on every line. */
  private handleMirrorClick(x: number, y: number) {
    const picked = pickEntity(this.state(), { x, y }, this.lastPickTolerance, this.lastPointPickTolerance);
    if (!picked) return;
    if (this.mirrorStage() === 'pick-entities') {
      // Toggle in selection — same UX as multi-select in the Select tool.
      const next = new Set(this.selected());
      if (next.has(picked.id)) next.delete(picked.id);
      else next.add(picked.id);
      this.selected.set(next);
      return;
    }
    // 'pick-axis' — only lines are valid axes.
    if (picked.kind !== 'line') {
      console.warn('Mirror axis must be a line');
      return;
    }
    this.mirrorAxisId.set(picked.id);
  }

  commitMirror() {
    const axisId = this.mirrorAxisId();
    if (!axisId) return;
    const ids = Array.from(this.selected()).filter(id => id !== axisId);
    if (ids.length === 0) return;
    const result = mirrorEntities(this.state(), ids, axisId);
    if (result.error) { console.warn('Mirror:', result.error); return; }
    this.commit(result.state);
    this.selected.set(new Set());
    this.mirrorAxisId.set(null);
    this.mirrorStage.set('pick-entities');
    // After a successful mirror, return to Select so the user can interact
    // with the new geometry. Matches SolidWorks's "OK closes the tool".
    this.tool.set('select');
  }

  cancelMirror() {
    this.selected.set(new Set());
    this.mirrorAxisId.set(null);
    this.mirrorStage.set('pick-entities');
    this.tool.set('select');
  }

  /** Remove a single entity from the selection — wired to the X button on
   * each row in the Mirror panel's entities list. Replacement (not mutation)
   * because Sets compare by reference in signals. */
  deselectEntity(id: string) {
    const next = new Set(this.selected());
    next.delete(id);
    this.selected.set(next);
  }

  clearMirrorAxis() {
    this.mirrorAxisId.set(null);
  }

  /** Short kind label + Material icon + coordinate hint for entity rows
   * rendered in the Mirror panel. Pure functions so the template can call
   * them in *ngFor without churning signals. */
  entityShortLabel(e: SketchEntity): string {
    switch (e.kind) {
      case 'point':            return 'Point';
      case 'line':             return 'Line';
      case 'circle':           return 'Circle';
      case 'arc':              return 'Arc';
      case 'ellipse':          return 'Ellipse';
      case 'ellipticalArc':    return 'Elliptical arc';
      case 'spline':           return 'Spline';
      case 'conic':            return 'Parabola';
      case 'text':             return 'Text';
      case 'picture':          return 'Picture';
      case 'equation':         return 'Equation curve';
      case 'intersection':     return 'Intersection curve';
      case 'splineOnSurface':  return 'Spline on surface';
    }
  }

  entityIcon(e: SketchEntity): string {
    switch (e.kind) {
      case 'point':            return 'radio_button_unchecked';
      case 'line':             return 'show_chart';
      case 'circle':           return 'circle';
      case 'arc':              return 'roundabout_right';
      case 'ellipse':          return 'panorama_fish_eye';
      case 'ellipticalArc':    return 'line_curve';
      case 'spline':           return 'gesture';
      case 'conic':            return 'all_inclusive';
      case 'text':             return 'text_fields';
      case 'picture':          return 'image';
      case 'equation':         return 'functions';
      case 'intersection':     return 'merge_type';
      case 'splineOnSurface':  return 'waves';
    }
  }

  entityShortDescription(e: SketchEntity): string {
    const s = this.state();
    const r = (n: number) => Math.round(n * 10) / 10;
    switch (e.kind) {
      case 'point':
        return `(${r(e.x)}, ${r(e.y)})`;
      case 'line': {
        const a = findPoint(s, e.startId);
        const b = findPoint(s, e.endId);
        if (!a || !b) return '';
        return `(${r(a.x)},${r(a.y)}) → (${r(b.x)},${r(b.y)})`;
      }
      case 'circle':
      case 'arc': {
        const c = findPoint(s, e.centerId);
        if (!c) return `r=${r(e.radius)}`;
        return `r=${r(e.radius)} @ (${r(c.x)},${r(c.y)})`;
      }
      case 'ellipse': {
        const c = findPoint(s, e.centerId);
        if (!c) return '';
        return `@ (${r(c.x)},${r(c.y)})`;
      }
      default: return '';
    }
  }

  /** Resolve a complete pick set into (type, targets, value), then add the
   * constraint with the user's placement and open the inline editor.
   * Uses the "after-add" solve path so existing geometry doesn't jump —
   * only points referenced by the new constraint are allowed to move. */
  private commitSmartDimAtPlacement(sel: SketchEntity[], placement: { x: number; y: number }) {
    // Pass the placement to the resolver so the 2-point case picks the
    // right dim type (horizontal-/vertical-distance / minimum distance)
    // based on where the user clicked.
    const resolved = resolveSmartDim(this.state(), sel, placement);
    if (!resolved) return;
    const { type, targets, value, angleRays } = resolved;
    // REQ 861: if every entity this dimension references is ALREADY fully
    // constrained, the dimension is redundant — ask the user (driven vs
    // cancel) instead of silently converting to a reference dim.
    const driven = this._dimensionWouldBeRedundant(targets);
    if (driven) {
      const ok = window.confirm(
        'This dimension would over-define the sketch — its geometry is already fully constrained.\n\n'
        + 'Add it as a DRIVEN (reference) dimension instead?');
      if (!ok) { this.selected.set(new Set()); return; }
    }
    const { state: next, constraint } = addConstraint(
      this.state(), type, targets, value, placement, driven, undefined, angleRays,
    );
    this.commitAfterAdd(next, constraint.id);
    this.selected.set(new Set());
    this.dimensionCreated.emit(constraint.id);
  }

  /** REQ 865: replace an entity's radius, keeping arc endpoints ON the new
   * radius (scaled radially about the center — the arc invariant
   * |center→start| == |center→end| == radius must hold). */
  private _withRadius(state: SketchState, entityId: string, radius: number): SketchState {
    const e = findEntity(state, entityId);
    if (!e || (e.kind !== 'circle' && e.kind !== 'arc')) return state;
    let s: SketchState = {
      ...state,
      entities: state.entities.map(en => en.id === entityId ? ({ ...en, radius } as SketchEntity) : en),
    };
    if (e.kind === 'arc') {
      const c = findPoint(s, e.centerId);
      if (c) {
        for (const pid of [e.startId, e.endId]) {
          const pt = findPoint(s, pid);
          if (!pt) continue;
          const d = Math.hypot(pt.x - c.x, pt.y - c.y) || 1;
          s = movePoint(s, pid, c.x + (pt.x - c.x) * radius / d, c.y + (pt.y - c.y) * radius / d);
        }
      }
    }
    return s;
  }

  /** REQ 855: flip a dimension between driven (reference) and driving.
   * Driving → driven always succeeds (loosening). Driven → driving is
   * pre-flighted through the solver: if the re-driven system is
   * inconsistent (or collapses), the toggle is REJECTED with the state
   * untouched so a reference dim can never over-define the sketch. */
  async toggleConstraintDriven(constraintId: string): Promise<'ok' | 'over-defined' | 'not-found'> {
    const c = this.state().constraints.find(cc => cc.id === constraintId);
    if (!c) return 'not-found';
    const nextDriven = c.driven !== true;
    const candidate = setConstraintDriven(this.state(), constraintId, nextDriven);
    if (nextDriven) {
      void this.commit(candidate);
      return 'ok';
    }
    const result = await solveSketch(candidate, { externalEdges: this._externalEdgeLines() });
    if (result.status !== 'ok' || this._solveCollapsed(candidate, result.state)) {
      return 'over-defined';
    }
    this._recordSolve(result);
    this.sketchChanged.emit(result.state);
    return 'ok';
  }

  /** Commit-and-solve variant for the case where a NEW constraint was just
   * added. Warm-started full re-solve (same path that editing a dimension
   * value uses), guarded against degenerate collapse. */
  private async commitAfterAdd(state: SketchState, newConstraintId: string) {
    const id = ++this.latestCommitId;
    this.sketchChanged.emit(state);
    // Solve the full system (same path as editing a dimension value, which
    // resizes correctly). The older `solveSketchAfterAdd` pinned-then-fallback
    // wandered into a degenerate collapse on under-determined dimension adds
    // (a rectangle flattened to a line); a plain warm-started full solve does
    // not. The collapse guard below is a belt-and-suspenders against any
    // remaining degenerate result.
    const result = await solveSketch(state, { externalEdges: this._externalEdgeLines() });
    if (id !== this.latestCommitId) return;
    const collapsed = this._solveCollapsed(state, result.state);
    this._recordSolve(result);
    if (result.status === 'ok' && !collapsed) {
      this.sketchChanged.emit(result.state);
    }
  }

  /** True when `after` flattened a non-construction line that had real length
   * in `before` (length > TOL → ≤ TOL) — i.e. the solver wandered into a
   * degenerate collapse (e.g. a rectangle flattened onto a line). Used to
   * reject such solves so a dimension can never destroy the sketch. */
  private _solveCollapsed(before: SketchState, after: SketchState): boolean {
    const TOL = 1e-3;
    const len = (st: SketchState, l: { startId: string; endId: string }) => {
      const a = findPoint(st, l.startId), b = findPoint(st, l.endId);
      return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
    };
    const afterById = new Map(after.entities.map(e => [e.id, e]));
    for (const e of before.entities) {
      if (e.kind !== 'line' || e.construction) continue;
      const ae = afterById.get(e.id);
      if (ae?.kind !== 'line') continue;
      if (len(before, e) > TOL && len(after, ae) <= TOL) return true;
    }
    return false;
  }

  private findSpec(type: ConstraintType): ConstraintSpec | null {
    // Prefer the regular (non-action) spec when multiple share a type.
    // Merge Points reuses type='coincident' but is an action button —
    // it should never be returned as "the spec for `coincident`".
    return CONSTRAINT_SPECS.find(s => s.type === type && !s.action)
      ?? CONSTRAINT_SPECS.find(s => s.type === type)
      ?? null;
  }

  /** Hover preview for the Trim / Extend tools. Parent's `sketchPreview`
   * computed calls this with the snapped cursor; if the cursor sits on a
   * line and the active tool is Trim or Extend, we return an `edit-hover`
   * SketchPreview item describing the segment that the click would
   * affect. Circles/arcs are not previewed yet — common case is lines.
   *
   * Returning the SketchPreview shape (rather than raw geometry) keeps
   * the parent dumb: it just folds the result into the existing array.
   */
  editHoverPreview(cursor: { x: number; y: number } | null): {
    kind: 'edit-hover'; start: { x: number; y: number }; end: { x: number; y: number };
    mode: 'remove' | 'add'; points?: { x: number; y: number }[];
  } | null {
    if (!cursor) return null;
    const t = this.tool();
    if (t !== 'trim' && t !== 'extend') return null;
    const picked = pickEntity(this.state(), cursor, this.lastPickTolerance, this.lastPointPickTolerance);
    if (!picked) return null;
    if (t === 'trim') {
      if (picked.kind === 'line') {
        const seg = previewTrimLine(this.state(), picked.id, cursor);
        if (!seg) return null;
        return { kind: 'edit-hover', start: seg.start, end: seg.end, mode: 'remove' };
      }
      if (picked.kind === 'circle' || picked.kind === 'arc') {
        const pts = picked.kind === 'circle'
          ? previewTrimCircle(this.state(), picked.id, cursor)
          : previewTrimArc(this.state(), picked.id, cursor);
        if (!pts || pts.length < 2) return null;
        return {
          kind: 'edit-hover',
          start: pts[0],
          end: pts[pts.length - 1],
          mode: 'remove',
          points: pts,
        };
      }
      return null;
    }
    // Extend tool — lines only (matches the operation).
    if (picked.kind !== 'line') return null;
    const seg = previewExtendLine(this.state(), picked.id, cursor);
    if (!seg) return null;
    return { kind: 'edit-hover', start: seg.start, end: seg.end, mode: 'add' };
  }

  /** Live preview render of the in-progress Smart Dim — read by the parent
   * to draw the dimension and extension lines at the cursor position
   * before the user clicks to place. Null when not in smart-dim mode or
   * when the current pick set isn't yet a valid combo. */
  smartDimPreview(cursor: { x: number; y: number } | null): DimensionRender | null {
    if (this.tool() !== 'smart-dim' || !cursor) return null;
    // Edge dimension preview (point/line + projected edge both chosen) — drives
    // the same placement-follows-cursor behaviour as a normal dim.
    const edgePreview = this._edgeDimPreview(cursor);
    if (edgePreview) return edgePreview;
    const sel = this.selectedEntities();
    if (!canPlaceDimension(sel)) return null;
    // Pass cursor — drives the 2-point dim type choice (horizontal-distance
    // / vertical-distance / minimum distance) live as the user moves the
    // cursor, so the preview shows what `commit` will create.
    const resolved = resolveSmartDim(this.state(), sel, cursor);
    if (!resolved) return null;
    return previewDimension(this.state(), resolved.type, resolved.targets, resolved.value, cursor);
  }

  applyConstraint(spec: ConstraintSpec) {
    if (this.readonly()) return;
    const entities = this.selectedEntities();
    // SolidWorks/OnShape: Coincident with a selected MODEL edge makes the
    // chosen sketch point ride that edge — an on-edge external reference,
    // not a normal sketch coincident. Handled before the entity predicate
    // since the second operand (the edge) isn't a sketch entity.
    // Concentric / Coincident / Coradial: sketch circle·arc + circular MODEL
    // edge → pin the sketch circle's center to the edge's projected center
    // (REQ 830-832). Coradial also sets the radius to the model edge's radius.
    if ((spec.type === 'concentric' || spec.type === 'coincident' || spec.type === 'coradial') && this.selectedExternalEdgeId()
        && entities.length === 1 && (entities[0].kind === 'circle' || entities[0].kind === 'arc')) {
      const edgeId = this.selectedExternalEdgeId()!;
      const ref = this._centerRefForEdge(edgeId);
      if (ref) {
        let s: SketchState;
        if (spec.type === 'coradial') {
          // Coradial-to-model-edge: ONE constraint targeting the CIRCLE/ARC with
          // a center ref. Snap the entity's center + radius onto the model edge
          // NOW so the relation is satisfied immediately; _reprojectAllSketches
          // re-derives both each regen so the radius keeps tracking the edge's
          // size. The solver then pins center (center-ref pass) and radius
          // (coradial-ext pass) at those synced values.
          const id = `coradial-ext-${entities[0].id}-${this.latestCommitId}`;
          let base = this.state();
          const geom = this._circleGeomForEdge(edgeId);
          if (geom) base = this._snapCurveToCircle(base, entities[0], geom);
          s = { ...base, constraints: [...base.constraints,
            { id, type: 'coradial', targets: [{ entityId: entities[0].id }], externalRef: ref }] };
        } else {
          const centerId = (entities[0] as { centerId: string }).centerId;
          s = this._addCenterRelation(this.state(), centerId, ref, spec.type === 'coincident' ? 'coincident' : 'concentric');
        }
        this.commitAfterAdd(s, s.constraints[s.constraints.length - 1].id);
        this.selected.set(new Set());
        this.selectedExternalEdgeId.set(null);
      }
      return;
    }
    if (spec.type === 'coincident' && this.selectedExternalEdgeId() && this._applyCoincidentToEdge(entities)) {
      return;
    }
    // Point-line distance to a selected MODEL edge — references the edge
    // directly (no converted sketch line), same as the smart-dim point→edge dim.
    if (spec.type === 'point-line-distance' && this.selectedExternalEdgeId() && this._applyDistanceToEdge(entities)) {
      return;
    }
    // Parallel / perpendicular between a sketch line and a selected MODEL edge
    // (or projected reference line). The edge isn't a sketch entity, so this is
    // handled via an externalRef + the solver's synthetic-line orientation pass.
    if ((spec.type === 'parallel' || spec.type === 'perpendicular')
        && this.selectedExternalEdgeId() && this._applyOrientationToEdge(entities, spec.type)) {
      return;
    }
    if (!spec.predicate(entities)) return;
    // One-shot actions short-circuit the persisted-constraint path.
    // Merge Points collapses the second-picked point into the first;
    // no constraint record gets created.
    if (spec.action === 'merge-points') {
      const [keep, drop] = entities;
      if (keep?.kind === 'point' && drop?.kind === 'point') {
        this.commit(mergePoints(this.state(), keep.id, drop.id));
        this.selected.set(new Set());
      }
      return;
    }
    let value: number | undefined;
    if (spec.implicitValue !== undefined) {
      // Skip value entry entirely — the spec hard-codes the value (e.g.,
      // Equal X / Equal Y use horizontal/vertical-distance with value 0).
      value = spec.implicitValue;
    } else if (spec.requiresValue) {
      // REQ 862: seed the dimension with the MEASURED value from the current
      // geometry (no blocking window.prompt); the inline dimension editor
      // opens on it below so the user can immediately type the target value.
      value = this._measuredValueFor(spec.type, entities)
        ?? (spec.type === 'angle' ? Math.PI / 4 : 10);
    }
    const ordered = orderTargetsForConstraint(spec.type, entities);
    // REQ 861: a value-bearing dimension whose entities are all already fully
    // constrained is redundant. Ask (driven vs cancel) instead of silently
    // converting — the user may not have wanted a reference dim at all.
    const redundant = !!spec.requiresValue && this._dimensionWouldBeRedundant(ordered);
    if (redundant) {
      const ok = window.confirm(
        'This dimension would over-define the sketch — its geometry is already fully constrained.\n\n'
        + 'Add it as a DRIVEN (reference) dimension instead?');
      if (!ok) { this.selected.set(new Set()); return; }
    }
    const { state: next, constraint } = addConstraint(this.state(), spec.type, ordered, value, undefined, redundant);
    this.commitAfterAdd(next, constraint.id);
    this.selected.set(new Set());
    // Open the inline value editor for driving dims (matches the smart-dim
    // flow) — driven reference dims just display, no edit prompt.
    if (spec.requiresValue && spec.implicitValue === undefined && !redundant) {
      this.dimensionCreated.emit(constraint.id);
    }
  }

  /** REQ 862: the as-drawn value a new dimension would measure — seeds the
   * inline editor so toolbar dims start at the current geometry instead of a
   * hardcoded default. Null when the selection shape is unexpected. */
  private _measuredValueFor(type: ConstraintSpec['type'], entities: SketchEntity[]): number | null {
    const st = this.state();
    const pt = (id: string) => findPoint(st, id);
    const lineDir = (l: SketchEntity): { x: number; y: number } | null => {
      if (l.kind !== 'line') return null;
      const a = pt(l.startId), b = pt(l.endId);
      return a && b ? { x: b.x - a.x, y: b.y - a.y } : null;
    };
    switch (type) {
      case 'radius':
        return entities[0]?.kind === 'circle' || entities[0]?.kind === 'arc' ? entities[0].radius : null;
      case 'diameter':
        return entities[0]?.kind === 'circle' || entities[0]?.kind === 'arc' ? entities[0].radius * 2 : null;
      case 'angle': {
        const d1 = entities[0] ? lineDir(entities[0]) : null;
        const d2 = entities[1] ? lineDir(entities[1]) : null;
        if (!d1 || !d2) return null;
        const dot = d1.x * d2.x + d1.y * d2.y;
        const cross = d1.x * d2.y - d1.y * d2.x;
        return Math.abs(Math.atan2(cross, dot));
      }
      case 'distance': {
        const [a, b] = entities;
        if (a?.kind === 'point' && b?.kind === 'point') return Math.hypot(b.x - a.x, b.y - a.y);
        return null;
      }
      case 'horizontal-distance': {
        const [a, b] = entities;
        return a?.kind === 'point' && b?.kind === 'point' ? Math.abs(b.x - a.x) : null;
      }
      case 'vertical-distance': {
        const [a, b] = entities;
        return a?.kind === 'point' && b?.kind === 'point' ? Math.abs(b.y - a.y) : null;
      }
      case 'point-line-distance': {
        const p = entities.find((e): e is PointEntity => e.kind === 'point');
        const l = entities.find(e => e.kind === 'line');
        const d = l ? lineDir(l) : null;
        const a = l && l.kind === 'line' ? pt(l.startId) : null;
        if (!p || !d || !a) return null;
        const len = Math.hypot(d.x, d.y) || 1;
        return Math.abs(((p.x - a.x) * d.y - (p.y - a.y) * d.x) / len);
      }
      case 'arc-length': {
        const e = entities[0];
        if (e?.kind !== 'arc') return null;
        const c = pt(e.centerId), s0 = pt(e.startId), s1 = pt(e.endId);
        if (!c || !s0 || !s1) return null;
        const a0 = Math.atan2(s0.y - c.y, s0.x - c.x);
        const a1 = Math.atan2(s1.y - c.y, s1.x - c.x);
        let sweep = e.ccw ? a1 - a0 : a0 - a1;
        while (sweep <= 0) sweep += 2 * Math.PI;
        return e.radius * sweep;
      }
      case 'chord-distance': {
        const e = entities[0];
        if (e?.kind !== 'arc') return null;
        const s0 = pt(e.startId), s1 = pt(e.endId);
        return s0 && s1 ? Math.hypot(s1.x - s0.x, s1.y - s0.y) : null;
      }
      default:
        return null;
    }
  }

  /** True when every entity a new dimension would reference is ALREADY fully
   * determined — i.e. the dimension can't reduce any DOF, so it should be a
   * driven (reference) dimension rather than an over-constraint. */
  private _dimensionWouldBeRedundant(targets: Array<string | ConstraintTarget>): boolean {
    const det = this.determinedEntities();
    const ids = targets.map((t) => (typeof t === 'string' ? t : t.entityId));
    return ids.length > 0 && ids.every((id) => det.has(id));
  }

  /** Whether the current selection can take the given constraint. Mirrors the
   * spec predicate, plus the Coincident-to-model-edge case (one sketch point or
   * line + a selected model edge) which the entity-only predicate can't see. */
  constraintEnabled(spec: ConstraintSpec): boolean {
    const entities = this.selectedEntities();
    if (spec.predicate(entities)) return true;
    const edge = this.selectedExternalEdgeId();
    // Concentric / Coincident / Coradial between a sketch circle·arc and a
    // CIRCULAR model edge → tie the sketch circle's center to the model edge's
    // projected center (REQ 830-832). Coradial additionally matches the radius.
    if ((spec.type === 'concentric' || spec.type === 'coincident' || spec.type === 'coradial') && edge
        && entities.length === 1 && (entities[0].kind === 'circle' || entities[0].kind === 'arc')) {
      return !!this._centerRefForEdge(edge);
    }
    if (spec.type === 'coincident' && edge) {
      return entities.length === 1 && (entities[0].kind === 'point' || entities[0].kind === 'line');
    }
    // Point-line distance TO a selected model edge: one sketch point + the
    // edge (which isn't a sketch entity, so the predicate can't see it).
    if (spec.type === 'point-line-distance' && edge) {
      return entities.length === 1 && entities[0].kind === 'point';
    }
    // Parallel / perpendicular between one sketch line and a selected model edge.
    if ((spec.type === 'parallel' || spec.type === 'perpendicular') && edge) {
      return entities.length === 1 && entities[0].kind === 'line';
    }
    return false;
  }

  /** Constrain a single selected sketch LINE parallel/perpendicular to the
   * selected model edge (or projected reference line) via an externalRef. The
   * solver resolves it against the edge's live 2D projection (synthetic fixed
   * line) — no converted sketch geometry. */
  private _applyOrientationToEdge(entities: SketchEntity[], type: 'parallel' | 'perpendicular'): boolean {
    const edgeId = this.selectedExternalEdgeId();
    if (!edgeId) return false;
    if (entities.length !== 1 || entities[0].kind !== 'line') return false;
    const cand = this._candidateForEdgeId(edgeId);
    const ref = cand ? externalRefForCandidate(cand) : null;
    if (!ref) return false;
    const { state: next, constraint } = addConstraint(
      this.state(), type, [entities[0].id], undefined, undefined, false, ref,
    );
    this.commitAfterAdd(next, constraint.id);
    this.selected.set(new Set());
    this.selectedExternalEdgeId.set(null);
    return true;
  }

  /** The center external-ref for a selected circular model edge, or null when
   * the edge isn't circular (no projected center candidate). Lets a sketch
   * circle be made concentric/coincident with a model circular edge. */
  private _centerRefForEdge(edgeId: string): ExternalRef | null {
    const center = this.candidates().find(
      c => c.kind === 'center'
        && (c.crossPart ? c.crossPart.stableId : parseCandidateId(c.id)?.topoId) === edgeId,
    );
    return center ? externalRefForCandidate(center) : null;
  }

  /** Projected center + radius of a circular model edge, read from the live
   * candidates: the `center` candidate gives the center point, the `edge`
   * candidate's projected samples give the radius (mean distance to center).
   * Null when the edge isn't present as both (non-circular / no projection). */
  private _circleGeomForEdge(edgeId: string): { cx: number; cy: number; radius: number } | null {
    const matches = (c: ReferenceCandidate) =>
      (c.crossPart ? c.crossPart.stableId : parseCandidateId(c.id)?.topoId) === edgeId;
    const cands = this.candidates();
    const center = cands.find(c => c.kind === 'center' && matches(c));
    const edge = cands.find(c => c.kind === 'edge' && matches(c));
    const ctr = center?.points[0];
    if (!ctr || !edge || edge.points.length === 0) return null;
    let sum = 0;
    for (const p of edge.points) sum += Math.hypot(p.x - ctr.x, p.y - ctr.y);
    const radius = sum / edge.points.length;
    if (!(radius > 1e-6)) return null;
    return { cx: ctr.x, cy: ctr.y, radius };
  }

  /** Move a sketch circle/arc onto the circle defined by (cx, cy, radius):
   * center point → (cx,cy), radius → radius. For an arc, start/end points are
   * re-placed at the new radius preserving their current angular positions so
   * the `|center→start| == |center→end| == radius` invariant holds. */
  private _snapCurveToCircle(
    state: SketchState, entity: SketchEntity, geom: { cx: number; cy: number; radius: number },
  ): SketchState {
    const pts = new Map(
      state.entities.filter((e): e is PointEntity => e.kind === 'point').map(p => [p.id, p]),
    );
    const setPt = new Map<string, { x: number; y: number }>();
    if (entity.kind === 'circle') {
      setPt.set(entity.centerId, { x: geom.cx, y: geom.cy });
    } else if (entity.kind === 'arc') {
      const c = pts.get(entity.centerId);
      const sp = pts.get(entity.startId);
      const ep = pts.get(entity.endId);
      if (c && sp && ep) {
        const a0 = Math.atan2(sp.y - c.y, sp.x - c.x);
        const a1 = Math.atan2(ep.y - c.y, ep.x - c.x);
        setPt.set(entity.centerId, { x: geom.cx, y: geom.cy });
        setPt.set(entity.startId, { x: geom.cx + geom.radius * Math.cos(a0), y: geom.cy + geom.radius * Math.sin(a0) });
        setPt.set(entity.endId, { x: geom.cx + geom.radius * Math.cos(a1), y: geom.cy + geom.radius * Math.sin(a1) });
      }
    } else {
      return state;
    }
    const entities = state.entities.map(e => {
      if (e.kind === 'point' && setPt.has(e.id)) return { ...e, ...setPt.get(e.id)! };
      if (e.id === entity.id && (e.kind === 'circle' || e.kind === 'arc')) return { ...e, radius: geom.radius };
      return e;
    });
    return { ...state, entities };
  }

  /** Create an on-edge constraint tying the single selected sketch entity to
   * the selected model edge. A point then rides the edge (phase 2); a line is
   * projected onto the edge (collinear, like Convert Entities applied
   * retroactively). Returns false when the selection isn't exactly one point or
   * line. */
  private _applyCoincidentToEdge(entities: SketchEntity[]): boolean {
    const edgeId = this.selectedExternalEdgeId();
    if (!edgeId) return false;
    if (entities.length !== 1) return false;
    const e = entities[0];
    if (e.kind !== 'point' && e.kind !== 'line') return false;
    const featureId = edgeId.split('/')[0] ?? '';
    const next = this._addOnEdge(this.state(), e.id, { scope: 'local', featureId, edgeId });
    const id = next.constraints[next.constraints.length - 1].id;
    this.commitAfterAdd(next, id);
    this.selected.set(new Set());
    this.selectedExternalEdgeId.set(null);
    return true;
  }

  /** Distance from the single selected sketch POINT to the selected model EDGE,
   * referencing the edge directly via a point-line-distance externalRef (no
   * converted sketch line). Prompts for the driving value, defaulting to the
   * measured perpendicular distance; a point that's already fully constrained
   * gets a driven (reference) dim at the measured value instead. */
  private _applyDistanceToEdge(entities: SketchEntity[]): boolean {
    const edgeId = this.selectedExternalEdgeId();
    if (!edgeId) return false;
    if (entities.length !== 1 || entities[0].kind !== 'point') return false;
    const cand = this._candidateForEdgeId(edgeId);
    if (!cand) return false;
    const ref = externalRefForCandidate(cand);
    const a = cand.points[0];
    const b = cand.points[1];
    if (!ref || !a || !b) return false;
    const pt = findPoint(this.state(), entities[0].id);
    if (!pt) return false;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const measured = Math.abs(((pt.x - a.x) * dy - (pt.y - a.y) * dx) / len);
    const driven = this.determinedEntities().has(entities[0].id);
    // REQ 862: seed with the measured value — the dimensionCreated emit below
    // opens the inline editor so the user types the target value in place.
    const value = measured;
    const { state: next, constraint } = addConstraint(
      this.state(), 'point-line-distance', [entities[0].id], value, undefined, driven, ref,
    );
    this.commitAfterAdd(next, constraint.id);
    this.selected.set(new Set());
    this.selectedExternalEdgeId.set(null);
    this.dimensionCreated.emit(constraint.id);
    return true;
  }

  private findNearbyPoint(x: number, y: number): PointEntity | undefined {
    // Only reuse an existing point that's essentially AT the click. The cursor
    // was already snap-resolved (snapToPoint), so the click sits exactly on the
    // intended target — a loose reach here would grab a DIFFERENT nearby point
    // (e.g. a corner one unit from a line's midpoint the user actually snapped
    // to), overriding the snap hint. Test against the un-rounded snapped click
    // (`_lastRawClick`) within the zoom-adaptive point tolerance.
    const c = this._lastRawClick ?? { x, y };
    const tol = Math.max(this.lastPointPickTolerance, 0.01);
    return this.points().find(p => Math.hypot(p.x - c.x, p.y - c.y) < tol);
  }

  // ─── composite shape gestures ─────────────────────────────────────────

  private handleRectCornerClick(x: number, y: number) {
    const first = this.draftRectCorner();
    // Snap each clicked corner so a click landing on a model edge/vertex
    // carries an externalRef — the two CLICKED corners then ride that edge.
    // skipAlign: do NOT apply H/V alignment to armed refs here — aligning the
    // two opposite corners to a shared X or Y would collapse the rectangle.
    if (!first) { this.draftRectCorner.set(this._snapClickToPoint(x, y, { skipAlign: true })); return; }
    if (Math.hypot(x - first.x, y - first.y) < 1) return;
    const second = this._snapClickToPoint(x, y, { skipAlign: true });
    const rect = addRectangleCorners(this.state(), first.x, first.y, second.x, second.y);
    let s = rect.state;
    // Pin the two CLICKED corners to the edge they snapped onto (if any). The
    // other two derived corners are positioned by the rectangle's own
    // perpendicular/parallel constraints and aren't independently on-edge.
    s = this._pinRectCornerToEdge(s, rect.corners, first.x, first.y, first.externalRef);
    s = this._pinRectCornerToEdge(s, rect.corners, second.x, second.y, second.externalRef);
    this.commit(s);
    this.draftRectCorner.set(null);
  }

  /** Attach an on-edge external reference to the rectangle corner that sits at
   * (cx, cy), so a corner clicked on a model edge rides that edge. No-op when
   * the click didn't snap to an edge. */
  private _pinRectCornerToEdge(
    s: SketchState, corners: Array<{ id: string; x: number; y: number }>,
    cx: number, cy: number, externalRef?: ExternalRef,
  ): SketchState {
    if (!externalRef) return s;
    const corner = corners.find(c => Math.abs(c.x - cx) < 1e-9 && Math.abs(c.y - cy) < 1e-9);
    return corner ? this._addOnEdge(s, corner.id, externalRef) : s;
  }

  private handleRectCenterClick(x: number, y: number) {
    const center = this.draftRectCenter();
    if (!center) {
      // First click defines the center — snap to an existing point if
      // the user clicked one (origin or any earlier sketch point). When
      // snapped, the diagonal's midpoint constraint will target that
      // existing point at commit, pinning the rectangle to it.
      this.draftRectCenter.set(this._snapClickToPoint(x, y));
      return;
    }
    if (Math.hypot(x - center.x, y - center.y) < 1) return;
    this.commit(addRectangleCenter(
      this.state(), center.x, center.y, x, y, center.pointId,
    ).state);
    this.draftRectCenter.set(null);
  }

  /** Default rounded-rect corner radius — 10% of the rectangle's
   * shorter side, with a 1mm floor so degenerate near-square clicks
   * still produce a usable fillet. Matches SW's "Slot Through Hole"
   * default of "a fraction of the bounding dimension". */
  private _defaultRoundedRadius(width: number, height: number): number {
    return Math.max(1, 0.1 * Math.min(Math.abs(width), Math.abs(height)));
  }

  /** Rounded corner-anchored rectangle. Two-click gesture: 1st corner,
   * 2nd corner. The fillet radius defaults to 10% of the shorter side
   * — no prompt. Users can dimension or drag to change the radius
   * after commit. */
  private handleRectRoundedCornerClick(x: number, y: number) {
    const first = this.draftRectRoundedCorner();
    if (!first) { this.draftRectRoundedCorner.set({ x, y }); return; }
    if (Math.hypot(x - first.x, y - first.y) < 1) return;
    const r = this._defaultRoundedRadius(x - first.x, y - first.y);
    this.commit(addRoundedRectangleCorners(this.state(), first.x, first.y, x, y, r).state);
    this.draftRectRoundedCorner.set(null);
  }

  /** Rounded center-anchored rectangle. First click is the center
   * (snaps to an existing point if available — same as plain Center
   * Rectangle). The fillet radius defaults to 10% of the shorter side
   * and the diagonal construction line runs fillet-center to fillet-
   * center. */
  private handleRectRoundedCenterClick(x: number, y: number) {
    const center = this.draftRectRoundedCenter();
    if (!center) {
      this.draftRectRoundedCenter.set(this._snapClickToPoint(x, y));
      return;
    }
    if (Math.hypot(x - center.x, y - center.y) < 1) return;
    const width = 2 * (x - center.x);
    const height = 2 * (y - center.y);
    const r = this._defaultRoundedRadius(width, height);
    this.commit(addRoundedRectangleCenter(
      this.state(), center.x, center.y, x, y, r, center.pointId,
    ).state);
    this.draftRectRoundedCenter.set(null);
  }

  private handlePolygonClick(x: number, y: number) {
    const center = this.draftPolygonCenter();
    if (!center) {
      // REQ 862: side count comes from the ribbon's contextual input (shown
      // while the polygon tool is active) — the first click places the center.
      this.draftPolygonCenter.set({ x, y });
      return;
    }
    if (Math.hypot(x - center.x, y - center.y) < 1) return;
    this.commit(addPolygon(this.state(), center.x, center.y, x, y, this.polygonSides()).state);
    this.draftPolygonCenter.set(null);
  }

  private handleSlotClick(x: number, y: number) {
    const path = this.draftSlotPath();
    if (!path.p1) { this.draftSlotPath.set({ p1: { x, y } }); return; }
    if (!path.p2) {
      if (Math.hypot(x - path.p1.x, y - path.p1.y) < 1) return;
      this.draftSlotPath.set({ p1: path.p1, p2: { x, y } }); return;
    }
    // Third click defines the half-width (perpendicular distance from the
    // centerline to the click point).
    const dx = path.p2.x - path.p1.x, dy = path.p2.y - path.p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) { this.draftSlotPath.set({}); return; }
    const px = -dy / len, py = dx / len;
    const halfWidth = Math.abs(px * (x - path.p1.x) + py * (y - path.p1.y));
    if (halfWidth < 0.5) return;  // ignore click on the centerline
    this.commit(addSlotStraight(this.state(), path.p1.x, path.p1.y, path.p2.x, path.p2.y, halfWidth).state);
    this.draftSlotPath.set({});
  }

  /** 3-point corner rectangle: click 1 sets corner A, click 2 sets corner
   * B along one edge, click 3 picks the offset to the opposite side. */
  private handleRect3PtCornerClick(x: number, y: number) {
    const pts = [...this.draftRect3Corner(), { x, y }];
    if (pts.length < 3) { this.draftRect3Corner.set(pts); return; }
    const r = addRectangle3PtCorner(this.state(),
      pts[0].x, pts[0].y, pts[1].x, pts[1].y, pts[2].x, pts[2].y);
    if (r.ids.length > 0) this.commit(r.state);
    this.draftRect3Corner.set([]);
  }

  /** 3-point center rectangle: click 1 = center, click 2 = side midpoint
   * (defines orientation + half-length), click 3 = opposite-side
   * offset (defines half-width). */
  private handleRect3PtCenterClick(x: number, y: number) {
    const pts = [...this.draftRect3Center(), { x, y }];
    if (pts.length < 3) { this.draftRect3Center.set(pts); return; }
    const r = addRectangle3PtCenter(this.state(),
      pts[0].x, pts[0].y, pts[1].x, pts[1].y, pts[2].x, pts[2].y);
    if (r.ids.length > 0) this.commit(r.state);
    this.draftRect3Center.set([]);
  }

  /** Parallelogram: 3 corners (4th derived from closure rule). */
  private handleParallelogramClick(x: number, y: number) {
    const pts = [...this.draftParallelogram(), { x, y }];
    if (pts.length < 3) { this.draftParallelogram.set(pts); return; }
    const r = addParallelogram(this.state(),
      pts[0].x, pts[0].y, pts[1].x, pts[1].y, pts[2].x, pts[2].y);
    if (r.ids.length > 0) this.commit(r.state);
    this.draftParallelogram.set([]);
  }

  /** Centerpoint straight slot: click 1 = slot center, click 2 = one
   * cap center, click 3 = width (perp distance from centerline). */
  private handleSlotCenterpointClick(x: number, y: number) {
    const draft = this.draftSlotCenterpoint();
    if (!draft.center) { this.draftSlotCenterpoint.set({ center: { x, y } }); return; }
    if (!draft.cap) {
      if (Math.hypot(x - draft.center.x, y - draft.center.y) < 1) return;
      this.draftSlotCenterpoint.set({ center: draft.center, cap: { x, y } }); return;
    }
    const dx = draft.cap.x - draft.center.x, dy = draft.cap.y - draft.center.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) { this.draftSlotCenterpoint.set({}); return; }
    const nx = -dy / len, ny = dx / len;
    const halfWidth = Math.abs(nx * (x - draft.center.x) + ny * (y - draft.center.y));
    if (halfWidth < 0.5) return;
    this.commit(addSlotStraightCenterpoint(
      this.state(), draft.center.x, draft.center.y, draft.cap.x, draft.cap.y, halfWidth,
    ).state);
    this.draftSlotCenterpoint.set({});
  }

  /** 3-point arc slot: clicks 1-3 define the centerline arc through 3
   * points, click 4 = width. */
  private handleSlotArc3Click(x: number, y: number) {
    const pts = [...this.draftSlotArc3(), { x, y }];
    if (pts.length < 4) { this.draftSlotArc3.set(pts); return; }
    // Width = perpendicular distance from the 4th click to the closest
    // point on the centerline arc — approximated as |radius - distance
    // from arc center to click|.
    const r = addSlotArc3Pt(this.state(),
      pts[0].x, pts[0].y, pts[1].x, pts[1].y, pts[2].x, pts[2].y,
      this._widthFromArcWidthClick(pts[0], pts[1], pts[2], pts[3]));
    if (r.ids.length > 0) this.commit(r.state);
    this.draftSlotArc3.set([]);
  }

  /** Centerpoint arc slot: clicks 1 = arc center, 2 = start, 3 = end,
   * 4 = width. */
  private handleSlotArcCenterpointClick(x: number, y: number) {
    const pts = [...this.draftSlotArcCenterpoint(), { x, y }];
    if (pts.length < 4) { this.draftSlotArcCenterpoint.set(pts); return; }
    const [c, s, e, w] = pts;
    const r = Math.hypot(s.x - c.x, s.y - c.y);
    const halfWidth = Math.abs(r - Math.hypot(w.x - c.x, w.y - c.y));
    if (halfWidth < 0.5) return;
    const res = addSlotArcCenterpoint(this.state(),
      c.x, c.y, s.x, s.y, e.x, e.y, halfWidth);
    if (res.ids.length > 0) this.commit(res.state);
    this.draftSlotArcCenterpoint.set([]);
  }

  /** Helper: derive arc-slot width from a width-click. Computes the
   * 3-point arc's center analytically, then takes |R - |click - C|| as
   * the slot half-width. Same formula whether the click is inside or
   * outside the centerline arc. */
  private _widthFromArcWidthClick(p1: { x: number; y: number }, p2: { x: number; y: number }, p3: { x: number; y: number }, click: { x: number; y: number }): number {
    const ax = p2.x - p1.x, ay = p2.y - p1.y;
    const bx = p3.x - p1.x, by = p3.y - p1.y;
    const d = 2 * (ax * by - ay * bx);
    if (Math.abs(d) < 1e-9) return 0;
    const a2 = ax * ax + ay * ay;
    const b2 = bx * bx + by * by;
    const ux = (by * a2 - ay * b2) / d;
    const uy = (ax * b2 - bx * a2) / d;
    const cx = p1.x + ux, cy = p1.y + uy;
    const r = Math.hypot(ux, uy);
    return Math.abs(r - Math.hypot(click.x - cx, click.y - cy));
  }

  private handleCircle3Click(x: number, y: number) {
    const pts = [...this.draftCircle3(), { x, y }];
    if (pts.length < 3) { this.draftCircle3.set(pts); return; }
    const r = addCircle3Points(this.state(), pts[0].x, pts[0].y, pts[1].x, pts[1].y, pts[2].x, pts[2].y);
    if (r.id) this.commit(r.state);
    this.draftCircle3.set([]);
  }

  private handleArc3Click(x: number, y: number) {
    const pts = [...this.draftArc3(), { x, y }];
    if (pts.length < 3) { this.draftArc3.set(pts); return; }
    const r = addArc3Points(this.state(), pts[0].x, pts[0].y, pts[1].x, pts[1].y, pts[2].x, pts[2].y);
    if (r.id) this.commit(r.state);
    this.draftArc3.set([]);
  }

  private handleEllipseClick(x: number, y: number) {
    const draft = this.draftEllipse();
    if (!draft.center) { this.draftEllipse.set({ center: { x, y } }); return; }
    if (!draft.majorEnd) {
      if (Math.hypot(x - draft.center.x, y - draft.center.y) < 1) return;
      this.draftEllipse.set({ center: draft.center, majorEnd: { x, y } }); return;
    }
    // Third click: perpendicular distance from the major axis defines the
    // minor radius. Project (click - center) onto the perpendicular of the
    // major axis direction.
    const ux = draft.majorEnd.x - draft.center.x;
    const uy = draft.majorEnd.y - draft.center.y;
    const len = Math.hypot(ux, uy);
    if (len < 1e-6) { this.draftEllipse.set({}); return; }
    const px = -uy / len, py = ux / len;
    const minorRadius = Math.abs(px * (x - draft.center.x) + py * (y - draft.center.y));
    if (minorRadius < 0.5) return;
    this.commit(addEllipse(this.state(), draft.center.x, draft.center.y, draft.majorEnd.x, draft.majorEnd.y, minorRadius).state);
    this.draftEllipse.set({});
  }

  /** Shared handler for the standard Spline tool (fixed degree=3) and
   * Style Spline (variable degree). First click in a style-spline
   * gesture prompts for the degree. Subsequent clicks add control
   * points; double-click on the last point commits.
   *
   * `desiredDegree` carries the caller's intent — for `spline` it's
   * hard-coded 3; for `style-spline` it's whatever the user picked.
   * Either way the resulting entity needs (degree + 1) control
   * points minimum. */
  private handleSplineClick(x: number, y: number, desiredDegree: number = 3) {
    const pts = this.draftSpline();
    // Style-spline degree prompt on the very first click.
    if (pts.length === 0 && this.tool() === 'style-spline') {
      const raw = window.prompt(
        'Spline degree (1 = polyline, 2 = quadratic, 3 = cubic, 5 = quintic):',
        String(this.styleSplineDegree()),
      );
      if (raw === null) { this.tool.set('select'); return; }
      const n = parseInt(raw, 10);
      if (!isFinite(n) || n < 1 || n > 9) return;
      this.styleSplineDegree.set(n);
      desiredDegree = n;
    }
    const last = pts[pts.length - 1];
    const doubleClick = last && Math.hypot(x - last.x, y - last.y) < 1;
    const minCps = desiredDegree + 1;
    if (doubleClick && pts.length >= minCps) {
      const r = addSpline(this.state(), pts, desiredDegree);
      if (r.id) this.commit(r.state);
      this.draftSpline.set([]);
      return;
    }
    this.draftSpline.set([...pts, { x, y }]);
  }

  /** Partial ellipse: clicks 1-3 mirror the standard ellipse tool
   * (center, major-axis end, minor-radius), then clicks 4-5 pick the
   * start and end angles (cursor angle measured around the center). */
  private handlePartialEllipseClick(x: number, y: number) {
    const draft = this.draftPartialEllipse();
    if (!draft.center) { this.draftPartialEllipse.set({ center: { x, y } }); return; }
    if (!draft.majorEnd) {
      if (Math.hypot(x - draft.center.x, y - draft.center.y) < 1) return;
      this.draftPartialEllipse.set({ center: draft.center, majorEnd: { x, y } }); return;
    }
    if (draft.minorRadius === undefined) {
      const ux = draft.majorEnd.x - draft.center.x;
      const uy = draft.majorEnd.y - draft.center.y;
      const len = Math.hypot(ux, uy);
      if (len < 1e-6) { this.draftPartialEllipse.set({}); return; }
      const px = -uy / len, py = ux / len;
      const minor = Math.abs(px * (x - draft.center.x) + py * (y - draft.center.y));
      if (minor < 0.5) return;
      this.draftPartialEllipse.set({ ...draft, minorRadius: minor });
      return;
    }
    // Compute the cursor's angle in the ellipse's local frame (where
    // +x runs from center → majorEnd). That's the angle the
    // EllipticalArcEntity stores, NOT the world-frame atan2.
    const localAngle = (cx: number, cy: number, mx: number, my: number, qx: number, qy: number): number => {
      const ux = mx - cx, uy = my - cy;
      const len = Math.hypot(ux, uy);
      const uxN = ux / len, uyN = uy / len;
      const vxN = -uyN, vyN = uxN;
      const dx = qx - cx, dy = qy - cy;
      return Math.atan2(dx * vxN + dy * vyN, dx * uxN + dy * uyN);
    };
    if (draft.startAngle === undefined) {
      const sa = localAngle(draft.center.x, draft.center.y, draft.majorEnd.x, draft.majorEnd.y, x, y);
      this.draftPartialEllipse.set({ ...draft, startAngle: sa });
      return;
    }
    const ea = localAngle(draft.center.x, draft.center.y, draft.majorEnd.x, draft.majorEnd.y, x, y);
    if (Math.abs(ea - draft.startAngle) < 0.01) return;
    // The entity stores PARAMETRIC angles t (point = a·cos t, b·sin t — what the
    // tessellator sweeps), but the clicks give GEOMETRIC angles φ (the cursor's
    // direction in the local frame). For a non-circular ellipse these differ
    // (tan φ = (b/a)·tan t), so convert: t = atan2(a·sin φ, b·cos φ). Without
    // this the arc's endpoints drift away from the clicked directions as
    // eccentricity grows.
    const a = Math.hypot(draft.majorEnd.x - draft.center.x, draft.majorEnd.y - draft.center.y);
    const b = draft.minorRadius!;
    const toParametric = (phi: number) => Math.atan2(a * Math.sin(phi), b * Math.cos(phi));
    this.commit(addEllipticalArc(
      this.state(),
      draft.center.x, draft.center.y, draft.majorEnd.x, draft.majorEnd.y,
      draft.minorRadius!, toParametric(draft.startAngle), toParametric(ea), true,
    ).state);
    this.draftPartialEllipse.set({});
  }

  /** Perimeter circle — two clicks define the diameter (a "circle through
   * 2 points where the line between them is the diameter"). Center is the
   * midpoint of the two clicks; radius is half the distance. */
  private handleCirclePerimeterClick(x: number, y: number) {
    const first = this.draftCirclePerimeter();
    if (!first) { this.draftCirclePerimeter.set({ x, y }); return; }
    if (Math.hypot(x - first.x, y - first.y) < 0.5) return;  // ignore double-click
    const cx = (first.x + x) / 2;
    const cy = (first.y + y) / 2;
    const radius = Math.hypot(x - first.x, y - first.y) / 2;
    this.commit(addCircle(this.state(), cx, cy, radius).state);
    this.draftCirclePerimeter.set(null);
  }

  /** Batch 6 — Parabola tool. Three clicks: (1) vertex, (2) focus
   * (sets axis direction and focal distance), (3) sample point on
   * the curve (sets symmetric extent). Each click commits a real
   * sketch point so the user can drag them later. */
  private handleParabolaClick(x: number, y: number) {
    const d = this.draftParabola();
    if (!d.vertex) { this.draftParabola.set({ vertex: { x, y } }); return; }
    if (!d.focus) {
      if (Math.hypot(x - d.vertex.x, y - d.vertex.y) < 1e-3) return;
      this.draftParabola.set({ vertex: d.vertex, focus: { x, y } }); return;
    }
    // Third click — emit the three real points + the conic.
    let s = this.state();
    const v = addPoint(s, d.vertex.x, d.vertex.y); s = v.state;
    const f = addPoint(s, d.focus.x, d.focus.y); s = f.state;
    const p = addPoint(s, x, y); s = p.state;
    const r = addParabolaByPoints(s, v.id, f.id, p.id);
    this.commit(r.state);
    this.draftParabola.set({});
  }

  /** Batch 6 — Equation curve tool. One click anchors the curve
   * (purely a hint — the actual geometry comes from the expressions).
   * Then prompts for x(t), y(t), tMin, tMax, samples. */
  private handleEquationCurveClick(_x: number, _y: number) {
    const xExpr = window.prompt('x(t) — e.g. "5*Math.cos(t)":', '5*Math.cos(t)');
    if (xExpr === null) { this.tool.set('select'); return; }
    const yExpr = window.prompt('y(t) — e.g. "5*Math.sin(t)":', '5*Math.sin(t)');
    if (yExpr === null) { this.tool.set('select'); return; }
    const tMinStr = window.prompt('t min:', '0');
    if (tMinStr === null) { this.tool.set('select'); return; }
    const tMaxStr = window.prompt('t max:', String(Math.PI * 2));
    if (tMaxStr === null) { this.tool.set('select'); return; }
    const tMin = parseFloat(tMinStr), tMax = parseFloat(tMaxStr);
    if (!Number.isFinite(tMin) || !Number.isFinite(tMax) || tMin === tMax) return;
    const samplesStr = window.prompt('Samples (8..2000):', '100');
    const samples = Math.max(8, Math.min(2000, parseInt(samplesStr || '100', 10) || 100));
    const r = addEquationCurve(this.state(), xExpr, yExpr, tMin, tMax, samples);
    this.commit(r.state);
  }

  /** Batch 6 — Sketch Text tool. Two-click rectangle drag-out: the
   * first click sets one corner; the second click sets the opposite
   * corner. Between clicks the cursor live-previews the rect. The
   * resulting box has 4 real construction points + 4 lines (so the
   * user can dimension it via Smart Dim), and the text inside
   * stretches to fit the box's aspect — OnShape style.
   * No popup dialogs; sidebar handles all editing. */
  private handleTextClick(x: number, y: number) {
    const first = this.draftTextRect();
    if (!first) { this.draftTextRect.set({ x, y }); return; }
    if (Math.hypot(x - first.x, y - first.y) < 1e-3) return;
    const r = addTextBoxByCorners(this.state(), first.x, first.y, x, y, 'text-316');
    this.commit(r.state);
    this.selected.set(new Set([r.id]));
    this.draftTextRect.set(null);
    this.tool.set('select');
  }

  /** Batch 6 — Sketch Picture tool. Click 1 opens a file picker
   * (handled by the editor — the result is held in
   * `pendingPictureSrc`). Click 2 anchors the picture at (x, y),
   * using the loaded image's pixel aspect to derive width / height
   * in mm (heuristic: 1 mm ≈ 4 px, like ~100 dpi). */
  private handlePictureClick(x: number, y: number) {
    if (!this.pendingPictureSrc()) {
      this._openImagePickerForSketch();
      return;
    }
    const pi = this.pendingPictureSrc()!;
    const pxPerMm = 4;
    const widthMm = Math.max(1, pi.pxW / pxPerMm);
    const heightMm = Math.max(1, pi.pxH / pxPerMm);
    let s = this.state();
    const anchor = addPoint(s, x, y); s = anchor.state;
    const r = addPicture(s, anchor.id, pi.src, widthMm, heightMm, 0, 0.6);
    this.commit(r.state);
    this.pendingPictureSrc.set(null);
  }
  private _openImagePickerForSketch(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const src = String(reader.result || '');
        if (!src.startsWith('data:image/')) return;
        const img = new Image();
        img.onload = () => {
          this.pendingPictureSrc.set({ src, pxW: img.naturalWidth, pxH: img.naturalHeight });
        };
        img.src = src;
      };
      reader.readAsDataURL(file);
    });
    document.body.appendChild(input);
    input.click();
    setTimeout(() => input.remove(), 0);
  }

  /** Tangent arc — click an existing point (must be an endpoint of a line
   * or arc), then click the arc's other endpoint. The new arc is tangent
   * to the picked entity at the picked point.
   *
   * Construction:
   *   - tangent direction T at the picked point comes from the line or arc
   *     it's an endpoint of.
   *   - normal N is perpendicular to T.
   *   - the arc center sits on the line through the picked point along N,
   *     at the distance that makes both the picked point AND the end click
   *     equidistant: d = -|v|² / (2 v·N) where v = pickedPoint − end.
   *
   * A `tangent` constraint is added between the new arc and the original
   * entity so the tangency survives future edits.
   */
  private handleTangentArcClick(x: number, y: number) {
    const draft = this.draftTangentArc();
    if (!draft) {
      // First click: pick an existing point that's an endpoint of a line
      // or arc — we need an unambiguous tangent direction.
      const picked = pickEntity(this.state(), { x, y }, this.lastPickTolerance, this.lastPointPickTolerance);
      if (!picked || picked.kind !== 'point') {
        console.warn('Tangent arc: click an existing endpoint of a line or arc');
        return;
      }
      const tangentEntity = this.findTangentEntityAtPoint(picked.id);
      if (!tangentEntity) {
        console.warn('Tangent arc: picked point is not the endpoint of a line or arc');
        return;
      }
      this.draftTangentArc.set({ tangentPointId: picked.id });
      return;
    }
    // Second click: compute arc.
    const startPt = findPoint(this.state(), draft.tangentPointId);
    if (!startPt) { this.draftTangentArc.set(null); return; }
    const tangentEntity = this.findTangentEntityAtPoint(draft.tangentPointId);
    if (!tangentEntity) { this.draftTangentArc.set(null); return; }
    const T = this.tangentDirectionAt(tangentEntity, startPt);
    if (!T) { console.warn('Tangent arc: degenerate tangent direction'); this.draftTangentArc.set(null); return; }

    // Solve for the arc center along the normal: d = -|v|² / (2 v·N)
    const N = { x: -T.y, y: T.x };
    const vx = startPt.x - x, vy = startPt.y - y;
    const vDotN = vx * N.x + vy * N.y;
    if (Math.abs(vDotN) < 1e-6) {
      console.warn('Tangent arc: end point lies on the tangent line — no finite arc');
      this.draftTangentArc.set(null);
      return;
    }
    const d = -(vx * vx + vy * vy) / (2 * vDotN);
    const center = { x: startPt.x + N.x * d, y: startPt.y + N.y * d };
    // ccw flag: positive cross of (start−center)×(end−center) means CCW sweep.
    const c1x = startPt.x - center.x, c1y = startPt.y - center.y;
    const c2x = x - center.x, c2y = y - center.y;
    const ccw = (c1x * c2y - c1y * c2x) > 0;

    let s = this.state();
    const arc = addArc(s, center.x, center.y, startPt.x, startPt.y, x, y, ccw);
    s = arc.state;
    // Lock the tangency to the source entity so edits don't drift the arc.
    s = addConstraint(s, 'tangent', [arc.id, tangentEntity.id]).state;
    this.commit(s);
    this.draftTangentArc.set(null);
  }

  /** Find the line or arc that uses `pointId` as one of its endpoints. If
   * multiple do (e.g., a shared corner), the first is picked — ambiguity
   * resolution would be a follow-up. */
  private findTangentEntityAtPoint(pointId: string): LineEntity | ArcEntity | null {
    for (const e of this.state().entities) {
      if (e.kind === 'line' && (e.startId === pointId || e.endId === pointId)) return e;
      if (e.kind === 'arc' && (e.startId === pointId || e.endId === pointId)) return e;
    }
    return null;
  }

  /** Unit tangent direction at `pt` along `e`. For a line, that's the
   * line's direction (or its reverse, doesn't matter for the arc math).
   * For an arc, the tangent is perpendicular to the radius vector at pt
   * (90° CCW from radius → outward sweep direction). */
  private tangentDirectionAt(e: LineEntity | ArcEntity, pt: PointEntity): { x: number; y: number } | null {
    if (e.kind === 'line') {
      const a = findPoint(this.state(), e.startId);
      const b = findPoint(this.state(), e.endId);
      if (!a || !b) return null;
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) return null;
      return { x: dx / len, y: dy / len };
    }
    // Arc: perpendicular to (pt − center).
    const c = findPoint(this.state(), e.centerId);
    if (!c) return null;
    const rx = pt.x - c.x, ry = pt.y - c.y;
    const len = Math.hypot(rx, ry);
    if (len < 1e-6) return null;
    return { x: -ry / len, y: rx / len };
  }

  /** Public — called by document Enter key to commit an in-flight spline. */
  commitSplineIfReady() {
    const pts = this.draftSpline();
    // Use the tool's degree — style-spline carries the user's chosen
    // value; plain spline is always 3.
    const degree = this.tool() === 'style-spline' ? this.styleSplineDegree() : 3;
    if (pts.length < degree + 1) return;
    const r = addSpline(this.state(), pts, degree);
    if (r.id) this.commit(r.state);
    this.draftSpline.set([]);
  }

  /** Re-solve `next` and emit the solved result. Public entry point for state
   * changes that originate OUTSIDE the in-sketch tool flow — e.g. a dimension
   * value edited in the constraint-list panel. Without this, such edits write
   * the new value but never re-solve, so the geometry doesn't move to satisfy
   * it. */
  resolveAndEmit(next: SketchState) {
    void this.commit(next);
  }

  private async commit(next: SketchState) {
    // Compute the entity-id diff once — both draw-as-construction and
    // dynamic-mirror read it. Skip when the commit doesn't add any
    // entities (drag-only / state-replace commits).
    const prevIds = new Set(this.state().entities.map(e => e.id));
    const addedIds = next.entities.filter(e => !prevIds.has(e.id)).map(e => e.id);
    // Draw-as-construction mode: flag every newly-added entity as
    // construction. setConstructionFlag cascades to the supporting
    // points so the dashed-vs-solid rendering stays coherent.
    if (this.drawConstruction() && addedIds.length > 0) {
      next = setConstructionFlag(next, addedIds, true);
    }
    // Dynamic Mirror: when an axis is set, every freshly-added
    // non-axis entity gets a mirror copy via mirrorEntities. Skipped
    // when the current tool is itself a mirror / transform / pattern
    // op (those already manage their own copies and would otherwise
    // produce mirror-of-mirror duplicates).
    const dynAxis = this.dynamicMirrorAxisId();
    const skipForTool = this.tool() === 'mirror'
      || this.tool() === 'dynamic-mirror'
      || this.tool() === 'pattern-linear'
      || this.tool() === 'pattern-circular'
      || this.tool() === 'copy';
    if (dynAxis && addedIds.length > 0 && !skipForTool) {
      const mirrorable = addedIds.filter(id => id !== dynAxis);
      if (mirrorable.length > 0) {
        const m = mirrorEntities(next, mirrorable, dynAxis);
        if (!m.error) next = m.state;
      }
    }
    const id = ++this.latestCommitId;
    this.sketchChanged.emit(next);
    const result = await solveSketch(next, { externalEdges: this._externalEdgeLines() });
    if (id !== this.latestCommitId) return;
    this._recordSolve(result);
    const collapsedC = this._solveCollapsed(next, result.state);
    if (result.status === 'ok' && !collapsedC) {
      this.sketchChanged.emit(result.state);
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers for the inference engine. Resolves PendingConstraint targets
// (`self` and `pointIndex`) into concrete entity ids using the new entity's
// structural fields (start/end for a line, control points for a spline, etc).
// ────────────────────────────────────────────────────────────────────────────

/** Whether `picked` can be added to the existing Smart Dim selection to
 * form a (still-valid) longer pick set. Used to decide between extending
 * the pick set vs treating the click as a placement. */
function extendsSmartDim(picked: SketchEntity, sel: SketchEntity[]): boolean {
  if (sel.length === 0) {
    return picked.kind === 'point' || picked.kind === 'line'
        || picked.kind === 'circle' || picked.kind === 'arc';
  }
  if (sel.length === 1) {
    const e = sel[0];
    if (e.kind === 'point' && picked.kind === 'point') return true;
    if (e.kind === 'line'  && picked.kind === 'line')  return true;
    if (e.kind === 'point' && picked.kind === 'line')  return true;
    if (e.kind === 'line'  && picked.kind === 'point') return true;
    // A second CONCENTRIC circle/arc extends a curve pick into a
    // radial-distance dimension (the gap between the two radii).
    const isCurve = (x: SketchEntity) => x.kind === 'circle' || x.kind === 'arc';
    if (isCurve(e) && isCurve(picked) && e.id !== picked.id
        && (e as CircleEntity | ArcEntity).centerId === (picked as CircleEntity | ArcEntity).centerId) {
      return true;
    }
    return false;
  }
  return false;  // 2 picks already = full set
}

/** Is the current pick set a complete Smart Dim case (1- or 2-entity)? */
function canPlaceDimension(sel: SketchEntity[]): boolean {
  if (sel.length === 1) {
    return sel[0].kind === 'line' || sel[0].kind === 'circle' || sel[0].kind === 'arc';
  }
  if (sel.length === 2) {
    const points = sel.filter(e => e.kind === 'point').length;
    const lines = sel.filter(e => e.kind === 'line').length;
    if (points + lines === 2) return true;
    // Two concentric circles/arcs (radial-distance). resolveSmartDim
    // re-checks concentricity and returns null for non-concentric pairs.
    const curves = sel.filter(e => e.kind === 'circle' || e.kind === 'arc').length;
    return curves === 2;
  }
  return false;
}

/** Resolve a Smart Dim pick set into a concrete (type, targets, value).
 * Returns null if the picks don't form a recognized case. */
function resolveSmartDim(
  state: SketchState, sel: SketchEntity[], cursor: { x: number; y: number } | null = null,
): { type: ConstraintType; targets: string[]; value: number; angleRays?: [number, number] } | null {
  if (sel.length === 1 && sel[0].kind === 'line') {
    const line = sel[0] as LineEntity;
    const a = findPoint(state, line.startId);
    const b = findPoint(state, line.endId);
    if (!a || !b) return null;
    return { type: 'distance', targets: [line.startId, line.endId], value: Math.hypot(b.x - a.x, b.y - a.y) };
  }
  // A whole circle dimensions by DIAMETER (SolidWorks default); a partial arc
  // dimensions by RADIUS.
  if (sel.length === 1 && sel[0].kind === 'circle') {
    const e = sel[0] as CircleEntity;
    return { type: 'diameter', targets: [e.id], value: e.radius * 2 };
  }
  if (sel.length === 1 && sel[0].kind === 'arc') {
    const e = sel[0] as ArcEntity;
    return { type: 'radius', targets: [e.id], value: e.radius };
  }
  // Two CONCENTRIC circles/arcs → dimension the radial gap (r_outer −
  // r_inner). Targets are [inner, outer] so the driven difference is
  // positive. Non-concentric pairs aren't a Smart Dim case → null.
  if (sel.length === 2 && sel.every(e => e.kind === 'circle' || e.kind === 'arc')) {
    const [a, b] = sel as Array<CircleEntity | ArcEntity>;
    if (a.centerId !== b.centerId) return null;
    const inner = a.radius <= b.radius ? a : b;
    const outer = a.radius <= b.radius ? b : a;
    return { type: 'radial-distance', targets: [inner.id, outer.id], value: Math.abs(outer.radius - inner.radius) };
  }
  if (sel.length === 2 && sel.every(e => e.kind === 'point')) {
    const [p1, p2] = sel as PointEntity[];
    // SW-style cursor-driven dim type: above/below the bbox → horizontal-
    // distance (Δx); left/right of the bbox → vertical-distance (Δy);
    // inside or diagonally outside → minimum (Euclidean) distance.
    const type = chooseTwoPointDimType(p1, p2, cursor);
    return { type, targets: [p1.id, p2.id], value: twoPointDimValue(p1, p2, type) };
  }
  if (sel.length === 2 && sel.every(e => e.kind === 'line')) {
    const [l1, l2] = sel as LineEntity[];
    // Parallel-line case (Smart Dim convention): two near-parallel
    // lines get a perpendicular-distance constraint instead of an
    // angle constraint, since the angle would be 0 or 180 and the
    // distance is what the user actually wants. Pin one of l1's
    // endpoints against l2 — the perp distance from that point to
    // l2 equals the gap between the lines while they stay parallel.
    if (linesAreNearParallel(state, l1, l2)) {
      const a = findPoint(state, l1.startId);
      if (!a) return null;
      const v = measurePointLineDistance(state, a, l2);
      if (v === null) return null;
      return { type: 'point-line-distance', targets: [l1.startId, l2.id], value: v };
    }
    const m = measureAngleBetween(state, l1, l2, cursor);
    if (m === null) return null;
    return { type: 'angle', targets: [l1.id, l2.id], value: m.value, angleRays: m.rays };
  }
  if (sel.length === 2 && sel.some(e => e.kind === 'point') && sel.some(e => e.kind === 'line')) {
    const p = sel.find(e => e.kind === 'point') as PointEntity;
    const l = sel.find(e => e.kind === 'line') as LineEntity;
    const v = measurePointLineDistance(state, p, l);
    if (v === null) return null;
    return { type: 'point-line-distance', targets: [p.id, l.id], value: v };
  }
  return null;
}

/** Smart Dim measurement helper: angle (radians) between two lines.
 *
 * If the two lines share an endpoint, this returns the INTERIOR angle at
 * that vertex — the angle the user actually sees at the corner. Naive
 * "dot product of line directions" gives the angle between direction
 * VECTORS (endpoint - startpoint), which for two adjacent sides of a
 * triangle is the SUPPLEMENT of the interior angle (60° corner reports
 * as 120°). Reorienting both vectors away from the shared vertex fixes
 * that.
 *
 * For lines without a shared endpoint, the direction-vector angle is
 * what the user means (no "corner" to reference). */
function measureAngleBetween(
  state: SketchState, a: LineEntity, b: LineEntity,
  placement: { x: number; y: number } | null = null,
): { value: number; rays?: [number, number] } | null {
  const a1 = findPoint(state, a.startId), a2 = findPoint(state, a.endId);
  const b1 = findPoint(state, b.startId), b2 = findPoint(state, b.endId);
  if (!a1 || !a2 || !b1 || !b2) return null;
  // SolidWorks-style: the measured angle is the one in the quadrant the user
  // dropped the dimension in. Lock the ray orientation so interior vs exterior
  // is set by first placement (the solver + arc render reuse it).
  if (placement) {
    const q = angleQuadrant(a1, a2, b1, b2, placement);
    if (q) return { value: q.angle, rays: q.rays };
  }
  let ax: number, ay: number, bx: number, by: number;
  const shared = sharedEndpointId(a, b);
  if (shared) {
    // Vectors from shared vertex out to each line's other endpoint.
    const sharedPt = a.startId === shared ? a1 : a2;
    const aOther = a.startId === shared ? a2 : a1;
    const bOther = b.startId === shared ? b2 : b1;
    ax = aOther.x - sharedPt.x; ay = aOther.y - sharedPt.y;
    bx = bOther.x - sharedPt.x; by = bOther.y - sharedPt.y;
  } else {
    ax = a2.x - a1.x; ay = a2.y - a1.y;
    bx = b2.x - b1.x; by = b2.y - b1.y;
  }
  const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
  if (la < 1e-9 || lb < 1e-9) return null;
  const cos = (ax * bx + ay * by) / (la * lb);
  return { value: Math.acos(Math.max(-1, Math.min(1, cos))) };
}

function sharedEndpointId(a: LineEntity, b: LineEntity): string | null {
  if (a.startId === b.startId || a.startId === b.endId) return a.startId;
  if (a.endId === b.startId   || a.endId === b.endId)   return a.endId;
  return null;
}

/** True when two lines' direction vectors are within ~0.5° of parallel
 * or anti-parallel. Tolerance is generous on purpose — Smart Dim picks
 * the "distance between parallels" interpretation whenever a literal
 * angle reading would be meaningless (i.e. 0 or 180°). */
function linesAreNearParallel(state: SketchState, a: LineEntity, b: LineEntity): boolean {
  const a1 = findPoint(state, a.startId), a2 = findPoint(state, a.endId);
  const b1 = findPoint(state, b.startId), b2 = findPoint(state, b.endId);
  if (!a1 || !a2 || !b1 || !b2) return false;
  const ax = a2.x - a1.x, ay = a2.y - a1.y;
  const bx = b2.x - b1.x, by = b2.y - b1.y;
  const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
  if (la < 1e-9 || lb < 1e-9) return false;
  // |cross| / (|a||b|) == sin(angle); parallel ⇒ sin ≈ 0. 0.5° → sin ≈ 0.0087.
  const sinTheta = Math.abs(ax * by - ay * bx) / (la * lb);
  return sinTheta < 0.01;
}

/** Smart Dim measurement helper: perpendicular distance from a point to a
 * line. Returns null if endpoints can't be resolved or the line collapses. */
function measurePointLineDistance(state: SketchState, p: PointEntity, l: LineEntity): number | null {
  const a = findPoint(state, l.startId), b = findPoint(state, l.endId);
  if (!a || !b) return null;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return null;
  // |cross(p-a, b-a)| / |b-a|
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / Math.sqrt(len2);
}

/** Returns the ids of every point entity this sketch entity structurally
 * depends on — used by the drag handler to translate the whole entity by
 * cursor delta, and by the rubber-band selection's "fully enclosed" check. */
function pointsControlledBy(e: SketchEntity): string[] {
  switch (e.kind) {
    case 'point':  return [e.id];
    case 'line':   return [e.startId, e.endId];
    case 'circle': return [e.centerId];
    case 'arc':    return [e.centerId, e.startId, e.endId];
    case 'ellipse': return [e.centerId, e.majorAxisEndId];
    case 'spline': return [...e.controlPointIds];
    default: return [];
  }
}

function applyPendingConstraint(
  state: SketchState, newEntityId: string, pending: PendingConstraint,
): SketchState {
  const resolved = pending.targets
    .map(t => resolveTarget(state, newEntityId, t))
    .filter((id): id is string => !!id);
  if (resolved.length !== pending.targets.length) return state;  // resolution failed
  const { state: next } = addConstraint(state, pending.type, resolved);
  return next;
}

function resolveTarget(
  state: SketchState, newEntityId: string, t: PendingConstraint['targets'][number],
): string | null {
  if ('self' in t) return newEntityId;
  if ('entityId' in t) return t.entityId;
  // pointIndex — look up structural fields on the entity.
  const ent = findEntity(state, newEntityId);
  if (!ent) return null;
  if (ent.kind === 'line') {
    if (t.pointIndex === 0) return ent.startId;
    if (t.pointIndex === 1) return ent.endId;
  }
  if (ent.kind === 'arc') {
    if (t.pointIndex === 0) return ent.startId;
    if (t.pointIndex === 1) return ent.endId;
  }
  return null;
}
