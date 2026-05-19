import { Component, input, output, signal, computed, effect, untracked, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import type {
  SketchDocument, SketchState, PointEntity, LineEntity, CircleEntity, ArcEntity, SketchEntity,
  ConstraintType,
} from '../../../cad/lib/types';
import { pointsOf, linesOf, findPoint } from '../../../cad/lib/types';
import {
  addPoint, addLine, addCircle, addArc, addConstraint, movePoint, deletePrimitive, emptySketchState,
  addRectangleCorners, addRectangleCenter, addPolygon, addSlotStraight,
  addCircle3Points, addArc3Points, addEllipse, addSpline,
  setConstructionFlag,
} from '../../../cad/lib/store';
import { solveSketch, solveSketchAfterAdd } from '../../../cad/lib/solver';
import { extractClosedLoops } from '../../../cad/lib/profile';
import { pickEntity } from '../../../cad/lib/picking';
import { inferLineEnd, type InferenceResult, type PendingConstraint } from '../../../cad/lib/inference';
import { findEntity } from '../../../cad/lib/types';
import { previewDimension, chooseTwoPointDimType, twoPointDimValue, type DimensionRender } from '../../../cad/lib/dimensions';
import { analyzeDeterminacy } from '../../../cad/lib/determinacy';
import {
  trimAt, extendLine, splitLineAt, offsetCurve, mirrorEntities, filletLines, chamferLines,
  moveEntities, copyEntities, rotateEntities, scaleEntities,
  previewTrimLine, previewExtendLine,
  type ChamferMode,
} from '../../../cad/lib/sketchEditOps';

type Tool =
  | 'select' | 'point' | 'line' | 'circle' | 'arc'
  | 'rect-corner' | 'rect-center' | 'polygon' | 'slot'
  | 'circle-3pt' | 'arc-3pt' | 'ellipse' | 'spline'
  | 'circle-perimeter' | 'tangent-arc'
  | 'smart-dim'
  | 'trim' | 'extend' | 'split' | 'offset' | 'mirror' | 'fillet' | 'chamfer'
  | 'move' | 'copy' | 'rotate' | 'scale';
type PendingPoint = { x: number; y: number };

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
  { type: 'fixed', label: 'Fix', icon: 'lock',
    predicate: es => es.length === 1 && isPointEntity(es[0]) },
  // Coincident is the unified "this is on that" constraint: two points,
  // or a point and any line/curve. The solver dispatches on target kinds.
  { type: 'coincident', label: 'Coincident', icon: 'merge_type',
    predicate: es => {
      if (es.length !== 2) return false;
      if (es.every(isPointEntity)) return true;
      const hasPoint = es.some(isPointEntity);
      const hasLineOrCurve = es.some(e => isLineEntity(e) || isCurveEntity(e));
      return hasPoint && hasLineOrCurve;
    } },
  { type: 'horizontal', label: 'Horizontal', icon: 'horizontal_rule',
    predicate: es => es.length === 1 && isLineEntity(es[0]) },
  { type: 'vertical', label: 'Vertical', icon: 'unfold_more',
    predicate: es => es.length === 1 && isLineEntity(es[0]) },
  // Distance has moved exclusively to Smart Dim — point↔point distance is
  // its primary case (single click → place → type). Leaving a duplicate
  // button on the constraint toolbar caused users to pick the wrong path.
  // `point-on-line` / `point-on-curve` are also gone: both are now expressed
  // as `coincident` and handled above.
  { type: 'perpendicular', label: 'Perpendicular', icon: 'turn_right',
    predicate: es => es.length === 2 && es.every(isLineEntity) },
  { type: 'parallel', label: 'Parallel', icon: 'drag_handle',
    predicate: es => es.length === 2 && es.every(isLineEntity) },
  { type: 'tangent', label: 'Tangent', icon: 'timeline',
    predicate: es => {
      if (es.length !== 2) return false;
      const lines = es.filter(isLineEntity).length;
      const curves = es.filter(isCurveEntity).length;
      return (lines === 1 && curves === 1) || (lines === 0 && curves === 2);
    } },
  { type: 'equal', label: 'Equal', icon: 'compare_arrows',
    predicate: es => {
      if (es.length !== 2) return false;
      const allLines = es.every(isLineEntity);
      const allCurves = es.every(e => e.kind === 'circle' || e.kind === 'arc');
      return allLines || allCurves;
    } },
  { type: 'midpoint', label: 'Midpoint', icon: 'vertical_align_center',
    predicate: es => es.length === 2 && es.some(isPointEntity) && es.some(isLineEntity) },
  { type: 'symmetric', label: 'Symmetric', icon: 'flip',
    predicate: es => es.length === 3 &&
      es.filter(isPointEntity).length === 2 && es.filter(isLineEntity).length === 1 },
  { type: 'concentric', label: 'Concentric', icon: 'adjust',
    predicate: es => es.length === 2 && es.every(e => e.kind === 'circle' || e.kind === 'arc') },
  { type: 'coradial', label: 'Coradial', icon: 'donut_large',
    predicate: es => es.length === 2 && es.every(e => e.kind === 'circle' || e.kind === 'arc') },
  { type: 'collinear', label: 'Collinear', icon: 'linear_scale',
    predicate: es => es.length === 2 && es.every(isLineEntity) },
  // Dimensional constraints — drive a numeric value rather than relate
  // geometry symbolically. Radius/diameter take one circle or arc; angle
  // takes two lines and stores the value in radians.
  { type: 'radius', label: 'Radius', icon: 'radio_button_unchecked', requiresValue: true,
    predicate: es => es.length === 1 && (es[0].kind === 'circle' || es[0].kind === 'arc') },
  { type: 'diameter', label: 'Diameter', icon: 'all_out', requiresValue: true,
    predicate: es => es.length === 1 && (es[0].kind === 'circle' || es[0].kind === 'arc') },
  { type: 'angle', label: 'Angle', icon: 'rotate_right', requiresValue: true,
    predicate: es => es.length === 2 && es.every(isLineEntity) },
  { type: 'horizontal-distance', label: 'Horizontal distance', icon: 'swap_horiz', requiresValue: true,
    predicate: es => es.length === 2 && es.every(isPointEntity) },
  { type: 'vertical-distance', label: 'Vertical distance', icon: 'swap_vert', requiresValue: true,
    predicate: es => es.length === 2 && es.every(isPointEntity) },
  // Equal-X / Equal-Y: shortcuts that fire horizontal-distance /
  // vertical-distance with value 0. Same underlying constraint type as the
  // dimensional variants; the implicitValue option suppresses the prompt
  // so the click commits in one shot.
  //   Equal X (same x-coord) ⇒ Δx = 0 ⇒ horizontal-distance(0)
  //   Equal Y (same y-coord) ⇒ Δy = 0 ⇒ vertical-distance(0)
  { type: 'horizontal-distance', label: 'Equal X', icon: 'align_vertical_center', implicitValue: 0,
    predicate: es => es.length === 2 && es.every(isPointEntity) },
  { type: 'vertical-distance', label: 'Equal Y', icon: 'align_horizontal_center', implicitValue: 0,
    predicate: es => es.length === 2 && es.every(isPointEntity) },
  { type: 'point-line-distance', label: 'Point-line distance', icon: 'straighten', requiresValue: true,
    predicate: es => es.length === 2 && es.some(isPointEntity) && es.some(isLineEntity) },
  { type: 'arc-length', label: 'Arc length', icon: 'timeline', requiresValue: true,
    predicate: es => es.length === 1 && es[0].kind === 'arc' },
];

// ────────────────────────────────────────────────────────────────────────────
// Tool groups — SolidWorks-style split-button dropdowns. Each entry is one
// variant in the group; the toolbar renders a single main button per group
// (showing the last-used variant) plus a chevron that opens a menu of all
// variants. Tests target individual variants via `data-testid`.
// ────────────────────────────────────────────────────────────────────────────

interface ToolSpec { tool: Tool; icon: string; label: string; tooltip: string; }

const PRIMITIVE_TOOLS: readonly ToolSpec[] = [
  { tool: 'point',  icon: 'radio_button_unchecked', label: 'Point',  tooltip: 'Point' },
  { tool: 'line',   icon: 'show_chart',             label: 'Line',   tooltip: 'Line' },
  { tool: 'spline', icon: 'gesture',                label: 'Spline', tooltip: 'Spline (click control points, Enter to commit)' },
];

const CIRCLE_TOOLS: readonly ToolSpec[] = [
  { tool: 'circle',           icon: 'circle',            label: 'Circle',      tooltip: 'Circle (center + radius)' },
  { tool: 'circle-perimeter', icon: 'radio_button_checked', label: 'Perim. Circle', tooltip: 'Perimeter circle (two clicks define the diameter)' },
  { tool: 'arc',              icon: 'roundabout_right',  label: 'Arc',         tooltip: 'Arc (center + endpoints)' },
  { tool: 'circle-3pt',       icon: 'data_usage',        label: '3-pt Circle', tooltip: 'Circle through 3 points' },
  { tool: 'arc-3pt',          icon: 'line_curve',        label: '3-pt Arc',    tooltip: 'Arc through 3 points' },
  { tool: 'tangent-arc',      icon: 'turn_slight_right', label: 'Tangent Arc', tooltip: 'Tangent arc — click an existing endpoint, then the arc end. Arc is tangent to the entity at the picked endpoint' },
  { tool: 'ellipse',          icon: 'panorama_fish_eye', label: 'Ellipse',     tooltip: 'Ellipse (center + major + minor)' },
];

const SHAPE_TOOLS: readonly ToolSpec[] = [
  { tool: 'rect-corner', icon: 'rectangle',       label: 'Rect',        tooltip: 'Rectangle (corner + corner)' },
  { tool: 'rect-center', icon: 'crop_landscape',  label: 'Center Rect', tooltip: 'Rectangle (center + corner)' },
  { tool: 'polygon',     icon: 'hexagon',         label: 'Polygon',     tooltip: 'Regular polygon (prompts for N)' },
  { tool: 'slot',        icon: 'view_stream',     label: 'Slot',        tooltip: 'Slot (endpoint, endpoint, width)' },
];

const EDIT_TOOLS: readonly ToolSpec[] = [
  { tool: 'trim',    icon: 'content_cut',         label: 'Trim',    tooltip: 'Trim — click a curve to remove a segment between intersections' },
  { tool: 'extend',  icon: 'open_in_full',        label: 'Extend',  tooltip: 'Extend — click a line near the endpoint to extend to the next boundary' },
  { tool: 'fillet',  icon: 'rounded_corner',      label: 'Fillet',  tooltip: 'Fillet — prompts for radius; click two lines to round their corner' },
  { tool: 'chamfer', icon: 'crop_din',            label: 'Chamfer', tooltip: 'Chamfer — prompts for distance; click two lines to cut a straight chamfer' },
  { tool: 'split',   icon: 'call_split',          label: 'Split',   tooltip: 'Split — click a line to break it at the click point' },
  { tool: 'offset',  icon: 'auto_awesome_motion', label: 'Offset',  tooltip: 'Offset — prompts for distance; click side of curve to offset toward' },
  { tool: 'mirror',  icon: 'flip',                label: 'Mirror',  tooltip: 'Mirror — select entities first, then click an axis line' },
];

const TRANSFORM_TOOLS: readonly ToolSpec[] = [
  { tool: 'move',   icon: 'open_with',     label: 'Move',   tooltip: 'Move — pre-select entities, then click a reference point and a destination' },
  { tool: 'copy',   icon: 'content_copy',  label: 'Copy',   tooltip: 'Copy — pre-select entities, then click a reference and destination to place a duplicate' },
  { tool: 'rotate', icon: 'rotate_right',  label: 'Rotate', tooltip: 'Rotate — pre-select entities, click a pivot, enter angle (degrees)' },
  { tool: 'scale',  icon: 'aspect_ratio',  label: 'Scale',  tooltip: 'Scale — pre-select entities, click a pivot, enter scale factor' },
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
        <mat-icon>arrow_selector_tool</mat-icon>
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
          <mat-icon>{{ primitiveCurrent().icon }}</mat-icon>
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
          <mat-icon>{{ spec.icon }}</mat-icon>
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
          <mat-icon>{{ circleCurrent().icon }}</mat-icon>
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
          <mat-icon>{{ spec.icon }}</mat-icon>
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
          <mat-icon>{{ shapeCurrent().icon }}</mat-icon>
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
          <mat-icon>{{ spec.icon }}</mat-icon>
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
          <mat-icon>{{ editCurrent().icon }}</mat-icon>
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
          <mat-icon>{{ spec.icon }}</mat-icon>
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
          <mat-icon>{{ transformCurrent().icon }}</mat-icon>
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
          <mat-icon>{{ spec.icon }}</mat-icon>
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
        <mat-icon>straighten</mat-icon>
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
        <mat-icon>{{ constructionIcon() }}</mat-icon>
        <span class="ribbon-label">{{ constructionLabel() }}</span>
      </button>
      <button class="ribbon-button"
              data-testid="toggle-draw-construction"
              [class.active]="drawConstruction()"
              (click)="drawConstruction.set(!drawConstruction())"
              matTooltip="Draw as Construction — when on, new geometry comes in as construction (dashed reference)"
              [disabled]="readonly()">
        <mat-icon>border_style</mat-icon>
        <span class="ribbon-label">Draw Cons.</span>
      </button>

      <span class="ribbon-divider"></span>

      <button *ngFor="let spec of constraintSpecs"
              class="ribbon-button compact"
              [attr.data-testid]="'constraint-' + spec.type"
              [disabled]="readonly() || !spec.predicate(selectedEntities())"
              (click)="applyConstraint(spec)"
              [matTooltip]="spec.label">
        <mat-icon>{{ spec.icon }}</mat-icon>
      </button>

      <span class="ribbon-divider"></span>

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
    </div>
    <!-- Mirror PropertyManager-style sidebar lives in cad-editor.component
         (it occupies the same column as the constraint list and swaps with
         it when Mirror is active). State + commit/cancel methods live on
         this component and are wired through the #sketchEditor template
         ref. -->
  `,
  styles: [`
    /* Sketch toolbar lives inside the parent ribbon's ribbon-pane — the
       parent supplies the 76px fixed height. Styles below mirror the parent's
       ribbon-button class because component view encapsulation prevents shared
       CSS from reaching this template. */
    .sketch-toolbar { display: flex; align-items: stretch; gap: 4px; width: 100%; min-width: max-content; }
    .ribbon-divider { width: 1px; align-self: stretch; background: #444; margin: 8px 6px; flex-shrink: 0; }
    .status { font-size: 11px; opacity: 0.7; font-family: monospace; align-self: center; padding: 0 6px; white-space: nowrap; }
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
  sketchId = input.required<string>();
  doc = input.required<SketchDocument>();
  readonly = input<boolean>(false);
  sketchChanged = output<SketchState>();
  exitSketch = output<void>();
  extrudeRequested = output<void>();
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
  draftLineStart = signal<string | null>(null);
  draftCircleCenter = signal<PendingPoint | null>(null);
  draftArcCenter = signal<PendingPoint | null>(null);
  draftArcStart = signal<PendingPoint | null>(null);
  // Composite-shape drafts. Each holds the points clicked so far for the
  // current gesture; `clearAllDrafts` resets them all.
  draftRectCorner = signal<PendingPoint | null>(null);          // rect-corner: first corner
  draftRectCenter = signal<PendingPoint | null>(null);          // rect-center: center
  draftPolygonCenter = signal<PendingPoint | null>(null);       // polygon: center
  polygonSides = signal<number>(6);                              // polygon: N (persisted across draws)
  draftSlotPath = signal<{ p1?: PendingPoint; p2?: PendingPoint }>({});  // slot: 2 centerline endpoints + 1 width click
  draftCircle3 = signal<PendingPoint[]>([]);                     // circle-3pt: up to 3 points
  draftArc3 = signal<PendingPoint[]>([]);                        // arc-3pt: up to 3 points
  draftEllipse = signal<{ center?: PendingPoint; majorEnd?: PendingPoint }>({});  // ellipse: 2 anchors + 1 minor click
  draftSpline = signal<PendingPoint[]>([]);                     // spline: control points so far
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
  determinedEntities = computed<Set<string>>(() => analyzeDeterminacy(this.state()));

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
    ['circle', () => { this.clearAllDraftsExcept(['circle']); }],
    ['arc', () => { this.clearAllDraftsExcept(['arc']); }],
    ['rect-corner', () => { this.clearAllDraftsExcept(['rect-corner']); }],
    ['rect-center', () => { this.clearAllDraftsExcept(['rect-center']); }],
    ['polygon', () => { this.clearAllDraftsExcept(['polygon']); }],
    ['slot', () => { this.clearAllDraftsExcept(['slot']); }],
    ['circle-3pt', () => { this.clearAllDraftsExcept(['circle-3pt']); }],
    ['arc-3pt', () => { this.clearAllDraftsExcept(['arc-3pt']); }],
    ['ellipse', () => { this.clearAllDraftsExcept(['ellipse']); }],
    ['spline', () => { this.clearAllDraftsExcept(['spline']); }],
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

  /** Persisted offset distance for the Offset tool. Prompted on first use,
   * reused for subsequent clicks so the user can offset multiple curves
   * without re-typing. Re-prompted when re-entering the tool. */
  private offsetDistance = signal<number | null>(null);
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
    if (!k.has('line')) this.draftLineStart.set(null);
    if (!k.has('circle')) this.draftCircleCenter.set(null);
    if (!k.has('arc')) { this.draftArcCenter.set(null); this.draftArcStart.set(null); }
    if (!k.has('rect-corner')) this.draftRectCorner.set(null);
    if (!k.has('rect-center')) this.draftRectCenter.set(null);
    if (!k.has('polygon')) this.draftPolygonCenter.set(null);
    if (!k.has('slot')) this.draftSlotPath.set({});
    if (!k.has('circle-3pt')) this.draftCircle3.set([]);
    if (!k.has('arc-3pt')) this.draftArc3.set([]);
    if (!k.has('ellipse')) this.draftEllipse.set({});
    if (!k.has('spline')) this.draftSpline.set([]);
    if (!k.has('circle-perimeter')) this.draftCirclePerimeter.set(null);
    if (!k.has('tangent-arc')) this.draftTangentArc.set(null);
  }

  constructor() {
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
      // Re-prompt for offset distance each time the user re-enters Offset.
      if (tool !== 'offset') this.offsetDistance.set(null);
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
    // Update last-used so the corresponding split-button main shows the
    // freshly-activated variant the next time the user opens that group.
    if (PRIMITIVE_TOOL_SET.has(t)) this.lastPrimitiveTool.set(t);
    else if (CIRCLE_TOOL_SET.has(t)) this.lastCircleTool.set(t);
    else if (SHAPE_TOOL_SET.has(t)) this.lastShapeTool.set(t);
    else if (EDIT_TOOL_SET.has(t)) this.lastEditTool.set(t);
    else if (TRANSFORM_TOOL_SET.has(t)) this.lastTransformTool.set(t);
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
      // REQ 633 — Esc cancels any in-flight tool gesture, clears the
      // selection, and returns to the Select tool.
      this.clearAllDrafts();
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
    }
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
    this.draftPolygonCenter.set(null);
    this.draftSlotPath.set({});
    this.draftCircle3.set([]);
    this.draftArc3.set([]);
    this.draftEllipse.set({});
    this.draftSpline.set([]);
    this.draftCirclePerimeter.set(null);
    this.draftTangentArc.set(null);
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

  handleSketchClick(p: { x: number; y: number; shiftKey: boolean; tolerance?: number; pointTolerance?: number }) {
    if (this.readonly()) return;
    if (this.didDrag) { this.didDrag = false; return; }
    if (p.tolerance !== undefined) this.lastPickTolerance = p.tolerance;
    if (p.pointTolerance !== undefined) this.lastPointPickTolerance = p.pointTolerance;
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    const tool = this.tool();
    switch (tool) {
      case 'select':      this.handleSelectClick(x, y, p.shiftKey); break;
      case 'point':       this.commit(addPoint(this.state(), x, y).state); break;
      case 'line':        this.handleLineClick(x, y); break;
      case 'circle':      this.handleCircleClick(x, y); break;
      case 'arc':         this.handleArcClick(x, y); break;
      case 'rect-corner': this.handleRectCornerClick(x, y); break;
      case 'rect-center': this.handleRectCenterClick(x, y); break;
      case 'polygon':     this.handlePolygonClick(x, y); break;
      case 'slot':        this.handleSlotClick(x, y); break;
      case 'circle-3pt':  this.handleCircle3Click(x, y); break;
      case 'arc-3pt':     this.handleArc3Click(x, y); break;
      case 'ellipse':     this.handleEllipseClick(x, y); break;
      case 'spline':      this.handleSplineClick(x, y); break;
      case 'circle-perimeter': this.handleCirclePerimeterClick(x, y); break;
      case 'tangent-arc': this.handleTangentArcClick(x, y); break;
      case 'smart-dim':   this.handleSmartDimClick(x, y, p.shiftKey); break;
      case 'trim':        this.handleTrimClick(x, y); break;
      case 'extend':      this.handleExtendClick(x, y); break;
      case 'split':       this.handleSplitClick(x, y); break;
      case 'offset':      this.handleOffsetClick(x, y); break;
      case 'mirror':      this.handleMirrorClick(x, y); break;
      case 'fillet':      this.handleFilletClick(x, y); break;
      case 'chamfer':     this.handleChamferClick(x, y); break;
      case 'move':        this.handleMoveClick(x, y); break;
      case 'copy':        this.handleCopyClick(x, y); break;
      case 'rotate':      this.handleRotateClick(x, y); break;
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
    const pointIds = picked ? pointsControlledBy(picked) : [];
    if (pointIds.length === 0) {
      // Empty space (or unpickable kind) → rubber-band selection.
      this.rubberBand.set({ start: p, current: p });
      return;
    }
    const state = this.state();
    // Expand the drag set through point↔point coincident constraints so the
    // tied "rigid group" translates as one block. Without this, a circle
    // center dragged while a line is coincident to it would let the line's
    // tied endpoint snap to the new center on each frame — visually fine,
    // but if the line's OTHER endpoint is free, the solver can also pick a
    // slightly different position for it, which the user sees as the line
    // changing size. Translating all coincident-linked points uniformly
    // sidesteps that.
    const expanded = this.expandToCoincidentGroup(state, new Set(pointIds));
    const points: Array<{ id: string; origX: number; origY: number }> = [];
    for (const id of expanded) {
      const pt = findPoint(state, id);
      if (pt) points.push({ id, origX: pt.x, origY: pt.y });
    }
    this.dragState.set({ points, startCursor: p, isDragging: false });
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

  handleSketchPointerMove(p: { x: number; y: number }) {
    // Update the live cursor signal for the coordinate readout in the
    // status bar. We use the (already-snapped) `p` so the readout matches
    // what the user perceives as their cursor position, not the raw mouse.
    this.cursor.set(p);
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
        next = movePoint(next, id, origX + dx, origY + dy);
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
        next = movePoint(next, id, Math.round(origX + dx), Math.round(origY + dy));
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
      const movable = new Set<string>();
      for (const e of state.entities) {
        if (e.kind === 'point' && !dragged.has(e.id)) movable.add(e.id);
      }
      // Pin curve radii so circles / arcs can't grow or shrink to satisfy
      // constraints during the drag. The user is just translating the
      // anchor; resizing should require an explicit dimension edit.
      result = await solveSketch(state, { movablePoints: movable, pinAllRadii: true });
    } else {
      result = await solveSketch(state);
    }
    if (id !== this.dragSolveGen) return;
    this.sketchChanged.emit(result.status === 'ok' ? result.state : state);
  }

  /** Apply a rubber-band rectangle as a selection. Standard "fully enclosed"
   * rule: a point counts if it sits inside the rect; a line/circle/arc
   * counts if every controlling point sits inside (so partial overlaps
   * don't sweep things in). */
  private applyRubberBandSelection(rb: { start: { x: number; y: number }; current: { x: number; y: number } }) {
    const minX = Math.min(rb.start.x, rb.current.x);
    const maxX = Math.max(rb.start.x, rb.current.x);
    const minY = Math.min(rb.start.y, rb.current.y);
    const maxY = Math.max(rb.start.y, rb.current.y);
    // Below-threshold rect → treat as a plain click (selection stays empty).
    if ((maxX - minX) < 1 && (maxY - minY) < 1) return;
    this.didDrag = true;  // suppress the follow-up click event
    const inRect = (x: number, y: number) =>
      x >= minX && x <= maxX && y >= minY && y <= maxY;
    const state = this.state();
    const next = new Set<string>();
    for (const e of state.entities) {
      const ids = pointsControlledBy(e);
      if (ids.length === 0) continue;
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
      if (!additive) this.selected.set(new Set());
      return;
    }
    const next = new Set(additive ? this.selected() : []);
    if (next.has(picked.id)) next.delete(picked.id);
    else next.add(picked.id);
    this.selected.set(next);
  }

  private handleLineClick(x: number, y: number) {
    const start = this.draftLineStart();
    if (!start) {
      // First click of a chain. Always create a fresh endpoint for the new
      // line, but if the click lands on an existing point, also pin it
      // there via a `coincident` constraint — SW-style: each entity owns
      // its endpoints, shared positions are enforced by constraints
      // rather than reused entity ids.
      let s = this.state();
      const nearby = this.findNearbyPoint(x, y);
      const r = addPoint(s, nearby ? nearby.x : x, nearby ? nearby.y : y);
      s = r.state;
      if (nearby) s = addConstraint(s, 'coincident', [r.id, nearby.id]).state;
      this.commit(s);
      this.draftLineStart.set(r.id);
      return;
    }

    // Prefer snap-to-existing-point over inference: an exact point match
    // dominates any line/horizontal/on-curve inference (which only matter
    // when the cursor is in open space).
    const startPt = findPoint(this.state(), start);
    let snapped = { x, y };
    let pending: PendingConstraint | null = null;
    const nearby = this.findNearbyPoint(x, y);
    if (nearby) {
      snapped = { x: nearby.x, y: nearby.y };
    } else if (startPt) {
      const inf = inferLineEnd(this.state(), startPt, { x, y });
      snapped = inf.snapped;
      pending = inf.constraint;
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
    // point, pin the fresh endpoint to it via coincident; otherwise just
    // place it at the snapped position.
    const endRes = addPoint(s, snapped.x, snapped.y);
    s = endRes.state;
    const endId = endRes.id;
    if (nearby) {
      s = addConstraint(s, 'coincident', [endId, nearby.id]).state;
      // Snapping onto an existing point dominates inference (horizontal/
      // vertical/on-line) — drop the pending constraint so we don't
      // over-constrain.
      pending = null;
    }
    const ln = addLine(s, start, endId);
    s = ln.state;
    if (pending) s = applyPendingConstraint(s, ln.id, pending);
    this.commit(s);
    // Click landed on an existing point (closing the chain or branching) →
    // end the chain. Otherwise continue from the just-placed endpoint so
    // the user can keep walking a polyline.
    this.draftLineStart.set(nearby ? null : endId);
  }

  private handleCircleClick(x: number, y: number) {
    const center = this.draftCircleCenter();
    if (!center) {
      this.draftCircleCenter.set({ x, y });
      return;
    }
    const radius = Math.hypot(x - center.x, y - center.y);
    if (radius < 0.5) return;  // ignore second click on top of first
    this.commit(addCircle(this.state(), center.x, center.y, radius).state);
    this.draftCircleCenter.set(null);
  }

  private handleArcClick(x: number, y: number) {
    const center = this.draftArcCenter();
    if (!center) {
      this.draftArcCenter.set({ x, y });
      return;
    }
    const start = this.draftArcStart();
    if (!start) {
      if (Math.hypot(x - center.x, y - center.y) < 0.5) return;
      this.draftArcStart.set({ x, y });
      return;
    }
    // Choose ccw=true when the (start → end) sweep around the center is positive.
    const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
    const endAngle = Math.atan2(y - center.y, x - center.x);
    let delta = endAngle - startAngle;
    while (delta <= -Math.PI) delta += 2 * Math.PI;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    const ccw = delta >= 0;
    this.commit(addArc(this.state(), center.x, center.y, start.x, start.y, x, y, ccw).state);
    this.draftArcCenter.set(null);
    this.draftArcStart.set(null);
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

  constructionIcon = computed(() => this.allSelectedConstructionForIcon() ? 'edit' : 'edit_off');
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
    const picked = pickEntity(this.state(), { x, y }, this.lastPickTolerance, this.lastPointPickTolerance);

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

  private handleOffsetClick(x: number, y: number) {
    let d = this.offsetDistance();
    if (d === null) {
      // First click after entering Offset is consumed by the prompt only —
      // the user hasn't picked a curve yet (they're just answering "how
      // far?"). Subsequent clicks pick the curve and apply the offset.
      const raw = window.prompt('Offset distance:', '5');
      if (raw === null) { this.tool.set('select'); return; }
      const parsed = parseFloat(raw);
      if (!isFinite(parsed) || parsed <= 0) { this.tool.set('select'); return; }
      this.offsetDistance.set(parsed);
      return;
    }
    const picked = pickEntity(this.state(), { x, y }, this.lastPickTolerance, this.lastPointPickTolerance);
    if (!picked) return;
    const result = offsetCurve(this.state(), picked.id, d, { x, y });
    if (result.error) { console.warn('Offset:', result.error); return; }
    this.commit(result.state);
    this.selected.set(new Set());
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
      console.warn('Fillet: click a corner point (a vertex shared by two lines)');
      return;
    }
    const lines = this.linesIncidentTo(this.state(), picked.id);
    if (lines.length !== 2) {
      console.warn('Fillet: clicked point is not shared by exactly two lines');
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
      const lines = this.linesIncidentTo(s, id);
      if (lines.length !== 2) continue;
      const result = filletLines(s, lines[0].id, lines[1].id, r, {
        keepRemovedAsConstruction: this.filletKeepConstruction(),
      });
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
   * coincident-group has exactly two incident lines. */
  private cornersInSelection(): string[] {
    const out: string[] = [];
    for (const e of this.selectedEntities()) {
      if (e.kind !== 'point') continue;
      const lines = this.linesIncidentTo(this.state(), e.id);
      if (lines.length === 2) out.push(e.id);
    }
    return out;
  }

  /** Apply Fillet to every supplied corner with the same radius. Any
   * corner that errors (radius too large, degenerate, etc.) is skipped
   * with a warning — partial commit beats refusing to do anything. */
  private batchFilletCorners(cornerIds: string[], radius: number) {
    let s = this.state();
    for (const id of cornerIds) {
      const lines = this.linesIncidentTo(s, id);
      if (lines.length !== 2) continue;
      const result = filletLines(s, lines[0].id, lines[1].id, radius);
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
  linesIncidentTo(state: SketchState, pointId: string): LineEntity[] {
    const pt = findPoint(state, pointId);
    if (!pt) return [];
    const out: LineEntity[] = [];
    for (const e of state.entities) {
      if (e.kind !== 'line') continue;
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
    const result = await solveSketch(next, { movablePoints });
    if (id !== this.latestCommitId) return;
    this.solveStatus.set(result.status);
    this.solverDof.set(result.dof);
    if (result.status === 'ok') {
      this.sketchChanged.emit(result.state);
    } else {
      // Fallback: retry without pinning. Some constraint sets genuinely
      // need pre-existing geometry to move (rare for chamfer).
      const fallback = await solveSketch(next);
      if (id !== this.latestCommitId) return;
      this.solveStatus.set(fallback.status);
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
    const raw = window.prompt('Rotation angle (degrees, CCW positive):', '90');
    if (raw === null) return;
    const deg = parseFloat(raw);
    if (!isFinite(deg)) { console.warn('Rotate: invalid angle'); return; }
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
    const raw = window.prompt('Scale factor (e.g. 2 doubles size, 0.5 halves):', '2');
    if (raw === null) return;
    const f = parseFloat(raw);
    if (!isFinite(f) || Math.abs(f) < 1e-9) { console.warn('Scale: invalid factor'); return; }
    const result = scaleEntities(this.state(), Array.from(this.selected()), { x, y }, f);
    if (result.error) { console.warn('Scale:', result.error); return; }
    this.commit(result.state);
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
      case 'point':         return 'Point';
      case 'line':          return 'Line';
      case 'circle':        return 'Circle';
      case 'arc':           return 'Arc';
      case 'ellipse':       return 'Ellipse';
      case 'ellipticalArc': return 'Elliptical arc';
      case 'spline':        return 'Spline';
      case 'conic':         return 'Conic';
    }
  }

  entityIcon(e: SketchEntity): string {
    switch (e.kind) {
      case 'point':         return 'radio_button_unchecked';
      case 'line':          return 'show_chart';
      case 'circle':        return 'circle';
      case 'arc':           return 'roundabout_right';
      case 'ellipse':       return 'panorama_fish_eye';
      case 'ellipticalArc': return 'line_curve';
      case 'spline':        return 'gesture';
      case 'conic':         return 'all_inclusive';
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
    const { type, targets, value } = resolved;
    const { state: next, constraint } = addConstraint(
      this.state(), type, targets, value, placement,
    );
    this.commitAfterAdd(next, constraint.id);
    this.selected.set(new Set());
    this.dimensionCreated.emit(constraint.id);
  }

  /** Commit-and-solve variant for the case where a NEW constraint was
   * just added. Uses solveSketchAfterAdd which pins every point not
   * referenced by the new constraint, so unrelated geometry doesn't jump
   * to satisfy the system. Falls back to a full re-solve if the
   * pinned-pass can't find a valid configuration. */
  private async commitAfterAdd(state: SketchState, newConstraintId: string) {
    const id = ++this.latestCommitId;
    this.sketchChanged.emit(state);
    const result = await solveSketchAfterAdd(state, newConstraintId);
    if (id !== this.latestCommitId) return;
    this.solveStatus.set(result.status);
    if (result.status === 'ok') this.sketchChanged.emit(result.state);
    // `solveSketchAfterAdd` pins most points to keep unrelated geometry
    // stable while the new constraint settles in. That pinned solve's DOF
    // count is artificially low (nearly every point is a temporary `fixed`),
    // so we run a second UNPINNED solve purely to read out the true DOF —
    // otherwise the status bar / green-stroke flips to "fully constrained"
    // on almost any new constraint.
    const probe = await solveSketch(result.state);
    if (id !== this.latestCommitId) return;
    this.solverDof.set(probe.dof);
  }

  private findSpec(type: ConstraintType): ConstraintSpec | null {
    return CONSTRAINT_SPECS.find(s => s.type === type) ?? null;
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
    kind: 'edit-hover'; start: { x: number; y: number }; end: { x: number; y: number }; mode: 'remove' | 'add';
  } | null {
    if (!cursor) return null;
    const t = this.tool();
    if (t !== 'trim' && t !== 'extend') return null;
    const picked = pickEntity(this.state(), cursor, this.lastPickTolerance, this.lastPointPickTolerance);
    if (!picked || picked.kind !== 'line') return null;
    if (t === 'trim') {
      const seg = previewTrimLine(this.state(), picked.id, cursor);
      if (!seg) return null;
      return { kind: 'edit-hover', start: seg.start, end: seg.end, mode: 'remove' };
    }
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
    if (!spec.predicate(entities)) return;
    let value: number | undefined;
    if (spec.implicitValue !== undefined) {
      // Skip the prompt entirely — the spec hard-codes the value (e.g.,
      // Equal X / Equal Y use horizontal/vertical-distance with value 0).
      value = spec.implicitValue;
    } else if (spec.requiresValue) {
      // Angle is the only constraint that's user-facing in degrees but solver-
      // facing in radians; convert here so the constraint payload is in the
      // unit the solver expects.
      const isAngle = spec.type === 'angle';
      const promptDefault = isAngle ? '45' : '10';
      const promptLabel = isAngle ? `${spec.label} (degrees):` : `Enter value for ${spec.label}:`;
      const raw = window.prompt(promptLabel, promptDefault);
      if (raw === null) return;
      const parsed = parseFloat(raw);
      if (!isFinite(parsed)) return;
      value = isAngle ? parsed * Math.PI / 180 : parsed;
    }
    const ordered = orderTargetsForConstraint(spec.type, entities);
    const { state: next, constraint } = addConstraint(this.state(), spec.type, ordered, value);
    this.commitAfterAdd(next, constraint.id);
    this.selected.set(new Set());
  }

  private findNearbyPoint(x: number, y: number): PointEntity | undefined {
    return this.points().find(p => Math.hypot(p.x - x, p.y - y) < 4);
  }

  // ─── composite shape gestures ─────────────────────────────────────────

  private handleRectCornerClick(x: number, y: number) {
    const first = this.draftRectCorner();
    if (!first) { this.draftRectCorner.set({ x, y }); return; }
    if (Math.hypot(x - first.x, y - first.y) < 1) return;
    this.commit(addRectangleCorners(this.state(), first.x, first.y, x, y).state);
    this.draftRectCorner.set(null);
  }

  private handleRectCenterClick(x: number, y: number) {
    const center = this.draftRectCenter();
    if (!center) { this.draftRectCenter.set({ x, y }); return; }
    if (Math.hypot(x - center.x, y - center.y) < 1) return;
    this.commit(addRectangleCenter(this.state(), center.x, center.y, x, y).state);
    this.draftRectCenter.set(null);
  }

  private handlePolygonClick(x: number, y: number) {
    const center = this.draftPolygonCenter();
    if (!center) {
      // Prompt for N at the start of each polygon gesture so the user can
      // change side count without leaving the tool. Default to last value used.
      const raw = window.prompt('Number of sides:', String(this.polygonSides()));
      if (raw === null) { this.tool.set('select'); return; }
      const n = parseInt(raw, 10);
      if (!isFinite(n) || n < 3) return;
      this.polygonSides.set(n);
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

  private handleSplineClick(x: number, y: number) {
    // Spline accumulates control points; Enter / Escape / double-click on the
    // last point commits. Single-click adds a control point.
    const pts = this.draftSpline();
    const last = pts[pts.length - 1];
    const doubleClick = last && Math.hypot(x - last.x, y - last.y) < 1;
    if (doubleClick && pts.length >= 4) {
      const r = addSpline(this.state(), pts, 3);
      if (r.id) this.commit(r.state);
      this.draftSpline.set([]);
      return;
    }
    this.draftSpline.set([...pts, { x, y }]);
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
    if (pts.length < 4) return;
    const r = addSpline(this.state(), pts, 3);
    if (r.id) this.commit(r.state);
    this.draftSpline.set([]);
  }

  private async commit(next: SketchState) {
    // Draw-as-construction mode: flag every entity that didn't exist in the
    // previous state as construction. setConstructionFlag cascades to the
    // supporting points (line endpoints, circle center, etc.) so the
    // dashed-vs-solid rendering stays coherent. No-op when the flag is off
    // OR when the commit didn't add new entities (e.g., a drag commit just
    // moves existing points).
    if (this.drawConstruction()) {
      const prevIds = new Set(this.state().entities.map(e => e.id));
      const addedIds = next.entities.filter(e => !prevIds.has(e.id)).map(e => e.id);
      if (addedIds.length > 0) {
        next = setConstructionFlag(next, addedIds, true);
      }
    }
    const id = ++this.latestCommitId;
    this.sketchChanged.emit(next);
    const result = await solveSketch(next);
    if (id !== this.latestCommitId) return;
    this.solveStatus.set(result.status);
    this.solverDof.set(result.dof);
    if (result.status === 'ok') {
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
    // Curves are single-pick — adding more isn't a Smart Dim case we handle.
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
    return points + lines === 2;
  }
  return false;
}

/** Resolve a Smart Dim pick set into a concrete (type, targets, value).
 * Returns null if the picks don't form a recognized case. */
function resolveSmartDim(
  state: SketchState, sel: SketchEntity[], cursor: { x: number; y: number } | null = null,
): { type: ConstraintType; targets: string[]; value: number } | null {
  if (sel.length === 1 && sel[0].kind === 'line') {
    const line = sel[0] as LineEntity;
    const a = findPoint(state, line.startId);
    const b = findPoint(state, line.endId);
    if (!a || !b) return null;
    return { type: 'distance', targets: [line.startId, line.endId], value: Math.hypot(b.x - a.x, b.y - a.y) };
  }
  if (sel.length === 1 && (sel[0].kind === 'circle' || sel[0].kind === 'arc')) {
    const e = sel[0] as CircleEntity | ArcEntity;
    return { type: 'radius', targets: [e.id], value: e.radius };
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
    const v = measureAngleBetween(state, l1, l2);
    if (v === null) return null;
    return { type: 'angle', targets: [l1.id, l2.id], value: v };
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
function measureAngleBetween(state: SketchState, a: LineEntity, b: LineEntity): number | null {
  const a1 = findPoint(state, a.startId), a2 = findPoint(state, a.endId);
  const b1 = findPoint(state, b.startId), b2 = findPoint(state, b.endId);
  if (!a1 || !a2 || !b1 || !b2) return null;
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
  return Math.acos(Math.max(-1, Math.min(1, cos)));
}

function sharedEndpointId(a: LineEntity, b: LineEntity): string | null {
  if (a.startId === b.startId || a.startId === b.endId) return a.startId;
  if (a.endId === b.startId   || a.endId === b.endId)   return a.endId;
  return null;
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
