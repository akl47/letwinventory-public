import { Component, inject, signal, computed, effect, untracked, OnInit, OnDestroy, HostListener, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { FormsModule } from '@angular/forms';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatDividerModule } from '@angular/material/divider';
import { MatSelectModule } from '@angular/material/select';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { CadModelService } from '../../../services/cad-model.service';
import { InventoryService } from '../../../services/inventory.service';
import { Part } from '../../../models/part.model';
import { CadModel, CadCommit, CadBranch } from '../../../models/cad-model.model';
import { AuthService } from '../../../services/auth.service';
import { ErrorNotificationService } from '../../../services/error-notification.service';
import { CadStreamService, type CadStreamEvent } from '../../../services/cad-stream.service';
import { CadUiStateService } from '../../../services/cad-ui-state.service';
import { CadViewerComponent, type DisplayMode, type SketchPreview, type ProfileFill, type HolePreview, type CosmeticThread } from '../cad-viewer/cad-viewer.component';
import { CadFeatureTreePanelComponent, type FeatureTreeAction, type FeatureSelectEvent, type SketchSelectEvent } from '../cad-feature-tree-panel/cad-feature-tree-panel.component';
import { CadSketchEditorComponent } from '../cad-sketch-editor/cad-sketch-editor.component';
import { CadConstraintListComponent } from '../cad-constraint-list/cad-constraint-list.component';
import { CategoryBadge } from '../../common/category-badge/category-badge';
import { SketchDeleteWarningDialogComponent, type SketchDeleteAction } from '../sketch-delete-warning-dialog/sketch-delete-warning-dialog.component';
import { projectTo3D, projectFrom3D } from '../../../cad/lib/plane';
import { extrudePreview, revolvePreview, sweepPreview } from '../../../cad/lib/preview';
import { propagateTangentEdges } from '../../../cad/lib/tangentPropagation';
import { CadSelectionListComponent, SelectionRow } from '../cad-selection-list/cad-selection-list.component';
import { computeMeasure, fitCircle, MeasureItem } from '../../../cad/lib/measure';
import type { FeatureTree, SketchDocument, SketchId, ModelGeometry, ModelTopology, SketchState, ExtrudeFeature, ExtrudeEndCondition, LineEntity, CircleEntity, PointEntity, ChamferFeature, DatumPlaneFeature, PlaneRef, VertexRef, EdgeRef3D, Plane3 } from '../../../cad/lib/types';
import {
  emptyFeatureTree, addFeature, defaultDatumVisibility,
  removeFeature, updateFeatureParam, removeFeaturesReferencingSketch,
} from '../../../cad/lib/featureTree';
import { emptyDocument, createSketch, updateSketchState, deleteSketch, setSketchVisibility, setSketchName } from '../../../cad/lib/document';
import { sizeOptions as holeSizeOptionsFor, defaultSizeFor as holeDefaultSizeFor, holeSpec, type HoleStandard, type HoleSizeKey } from '../../../cad/lib/holeSpecs';
import { removeConstraint, setConstraintValue, addPoint, addLine, addCircle, addCircleByPoint, addArc, addArcByPoints, updateTextEntity, updatePictureEntity, updateEquationCurveEntity, rotateTextBox } from '../../../cad/lib/store';
import { solveSketchAfterAdd, solveSketch } from '../../../cad/lib/solver';
import { parseUserValue, type Unit } from '../../../cad/lib/units';
import { migrateSketchDocument, migrateFeatureTree } from '../../../cad/lib/migration';
import { friendlyError } from '../../../cad/lib/errorMessages';
import { planeForDatum, buildOriginDatums, computeDatumPlane, computeDatumAxis, computeDatumPoint, resolvePlaneRef } from '../../../cad/lib/datum';
import { circularTransforms, linearTransforms } from '../../../cad/lib/pattern';
import { inferLineEnd, inferHoverOnCurve } from '../../../cad/lib/inference';
import { allCurveIntersections, angleInArcSweep } from '../../../cad/lib/geometry';
import { findPoint as findPt } from '../../../cad/lib/types';
import { computeFilletGeometry, computeFilletLineArcGeometry, computeChamferGeometry } from '../../../cad/lib/sketchEditOps';
import { chooseTwoPointDimType, twoPointDimValue } from '../../../cad/lib/dimensions';
import { type EquationDoc, resolveEquations, evalExpression, setEquation, removeEquation } from '../../../cad/lib/equations';
import { DimInputComponent } from '../dim-input/dim-input.component';
import { CadEquationsPanelComponent } from '../cad-equations-panel/cad-equations-panel.component';

/** Snap kinds. Drives the viewer's snap-indicator glyph: square for
 * endpoint (existing point), triangle for midpoint, X for intersection,
 * diamond for quadrant. */
type SnapKind = 'endpoint' | 'midpoint' | 'intersection' | 'quadrant';
import { extractRegions, tessellateProfileLoop, topLevelRegionIndices } from '../../../cad/lib/profile';
import { makeVarResolver, type TextResolver } from '../../../cad/lib/textGlyphs';
import { buildBinaryStl } from '../../../cad/lib/stlExport';
import { CadExportDialogComponent, resolveExportName, type ExportDialogResult } from '../cad-export-dialog/cad-export-dialog.component';
import JSZip from 'jszip';
import { environment } from '../../../../environments/environment';

type EditorMode =
  | 'idle' | 'pick-plane'
  | 'pick-extrude-target' | 'pick-cut-extrude-target'
  | 'pick-revolve-target' | 'pick-cut-revolve-target'
  | 'pick-sweep-target' | 'pick-cut-sweep-target';

interface HistorySnapshot {
  featureTree: FeatureTree;
  doc: SketchDocument;
}

@Component({
  selector: 'app-cad-editor',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatButtonModule, MatIconModule, MatTooltipModule,
    MatProgressSpinnerModule, MatDialogModule, MatInputModule, MatFormFieldModule, MatDividerModule,
    MatSelectModule, MatMenuModule,
    CadViewerComponent, CadFeatureTreePanelComponent, CadSketchEditorComponent, CadConstraintListComponent,
    CategoryBadge, DimInputComponent, CadSelectionListComponent,
  ],
  template: `
    <div class="cad-editor" [class.fullscreen]="fullscreen()" [attr.data-testid]="'cad-editor'">
      <!-- REQ 616 — tabbed ribbon. Toolbar content swaps with the active tab.
           Active tab follows the editor context (auto-switches to Sketch when a
           sketch is active) but the user can manually click tabs to override.
           OnShape/SolidWorks layout: content row on top, tab labels at the bottom. -->
      <div class="ribbon">
        <div class="ribbon-content">
          <div class="ribbon-pane" [hidden]="activeTab() !== 'features'">
            <!-- ── Sketch-based: Sketch + Extrude/Revolve/Sweep (each
                 with a Boss/Cut split-button). ────────────────────── -->
            <div class="ribbon-group">
              <div class="ribbon-group-row">
                <button class="ribbon-button"
                        data-testid="action-sketch"
                        [disabled]="readonly() || activeSketchId() !== null"
                        [class.active]="mode() === 'pick-plane'"
                        matTooltip="Start a new sketch on a datum plane"
                        (click)="onSketchAction()">
                  <mat-icon>draw</mat-icon>
                  <span class="ribbon-label">Sketch</span>
                </button>
                <!-- Extrude split-button -->
                <div class="ribbon-split">
                  <button class="ribbon-button"
                          data-testid="action-extrude"
                          [disabled]="readonly() || activeSketchId() !== null || (extrudeMode() === 'cut' && !hasAdditiveBody())"
                          [class.active]="mode() === 'pick-extrude-target' || mode() === 'pick-cut-extrude-target'"
                          [matTooltip]="extrudeMode() === 'cut' ? 'Cut Extrude — subtract the sketched profile from the existing body' : 'Extrude an existing sketch, or start a new one on a plane'"
                          (click)="invokeExtrude()">
                    <mat-icon>{{ extrudeMode() === 'cut' ? 'vertical_align_bottom' : 'vertical_align_top' }}</mat-icon>
                    <span class="ribbon-label">{{ extrudeMode() === 'cut' ? 'Cut Extrude' : 'Extrude' }}</span>
                  </button>
                  <button class="ribbon-split-chevron"
                          data-testid="action-extrude-menu"
                          [matMenuTriggerFor]="extrudeMenu"
                          matTooltip="Switch between Boss / Cut">
                    <mat-icon>arrow_drop_down</mat-icon>
                  </button>
                  <mat-menu #extrudeMenu>
                    <button mat-menu-item (click)="extrudeMode.set('boss'); onExtrudeAction()">
                      <mat-icon>vertical_align_top</mat-icon> Boss Extrude
                    </button>
                    <button mat-menu-item [disabled]="!hasAdditiveBody()" (click)="extrudeMode.set('cut'); onCutExtrudeAction()">
                      <mat-icon>vertical_align_bottom</mat-icon> Cut Extrude
                    </button>
                  </mat-menu>
                </div>
                <!-- Revolve split-button -->
                <div class="ribbon-split">
                  <button class="ribbon-button"
                          data-testid="action-revolve"
                          [disabled]="readonly() || activeSketchId() !== null || (revolveMode() === 'cut' && !hasAdditiveBody())"
                          [class.active]="mode() === 'pick-revolve-target' || mode() === 'pick-cut-revolve-target'"
                          [matTooltip]="revolveMode() === 'cut' ? 'Cut Revolve — subtract a revolved profile' : 'Revolve a sketch around a sketched axis line'"
                          (click)="invokeRevolve()">
                    <mat-icon>{{ revolveMode() === 'cut' ? 'remove_circle_outline' : '360' }}</mat-icon>
                    <span class="ribbon-label">{{ revolveMode() === 'cut' ? 'Cut Revolve' : 'Revolve' }}</span>
                  </button>
                  <button class="ribbon-split-chevron"
                          data-testid="action-revolve-menu"
                          [matMenuTriggerFor]="revolveMenu"
                          matTooltip="Switch between Boss / Cut">
                    <mat-icon>arrow_drop_down</mat-icon>
                  </button>
                  <mat-menu #revolveMenu>
                    <button mat-menu-item (click)="revolveMode.set('boss'); onRevolveAction()">
                      <mat-icon>360</mat-icon> Boss Revolve
                    </button>
                    <button mat-menu-item [disabled]="!hasAdditiveBody()" (click)="revolveMode.set('cut'); onCutRevolveAction()">
                      <mat-icon>remove_circle_outline</mat-icon> Cut Revolve
                    </button>
                  </mat-menu>
                </div>
                <!-- Sweep split-button -->
                <div class="ribbon-split">
                  <button class="ribbon-button"
                          data-testid="action-sweep"
                          [disabled]="readonly() || activeSketchId() !== null || doc().nextSketchSeq < 3 || (sweepMode() === 'cut' && !hasAdditiveBody())"
                          [class.active]="mode() === 'pick-sweep-target' || mode() === 'pick-cut-sweep-target'"
                          [matTooltip]="sweepMode() === 'cut' ? 'Cut Sweep — subtract a swept profile' : 'Sweep — drag a profile sketch along a path sketch'"
                          (click)="invokeSweep()">
                    <mat-icon>{{ sweepMode() === 'cut' ? 'turn_right' : 'route' }}</mat-icon>
                    <span class="ribbon-label">{{ sweepMode() === 'cut' ? 'Cut Sweep' : 'Sweep' }}</span>
                  </button>
                  <button class="ribbon-split-chevron"
                          data-testid="action-sweep-menu"
                          [matMenuTriggerFor]="sweepMenu"
                          matTooltip="Switch between Boss / Cut">
                    <mat-icon>arrow_drop_down</mat-icon>
                  </button>
                  <mat-menu #sweepMenu>
                    <button mat-menu-item (click)="sweepMode.set('boss'); onSweepAction()">
                      <mat-icon>route</mat-icon> Boss Sweep
                    </button>
                    <button mat-menu-item [disabled]="!hasAdditiveBody()" (click)="sweepMode.set('cut'); onCutSweepAction()">
                      <mat-icon>turn_right</mat-icon> Cut Sweep
                    </button>
                  </mat-menu>
                </div>
                <button class="ribbon-button"
                        data-testid="action-loft"
                        [disabled]="readonly() || activeSketchId() !== null || doc().nextSketchSeq < 3"
                        [class.active]="loftSidebar() !== null"
                        matTooltip="Loft — blend a solid through 2+ profile sketches"
                        (click)="onLoftAction()">
                  <mat-icon>layers</mat-icon>
                  <span class="ribbon-label">Loft</span>
                </button>
                <button class="ribbon-button"
                        data-testid="action-hole"
                        [disabled]="readonly() || activeSketchId() !== null || !hasAdditiveBody()"
                        [class.active]="holeSidebar() !== null"
                        matTooltip="Hole Wizard — click faces to drop standardized hardware holes"
                        (click)="onHoleAction()">
                  <mat-icon>radio_button_unchecked</mat-icon>
                  <span class="ribbon-label">Hole</span>
                </button>
              </div>
              <div class="ribbon-group-label">Sketch-based</div>
            </div>

            <div class="ribbon-divider"></div>

            <!-- ── Body modifiers ──────────────────────────────────── -->
            <div class="ribbon-group">
              <div class="ribbon-group-row">
                <button class="ribbon-button"
                        data-testid="action-fillet"
                        [disabled]="readonly() || activeSketchId() !== null || !hasAdditiveBody()"
                        [class.active]="edgeBlendSidebar()?.kind === 'fillet'"
                        matTooltip="Fillet — round edges of the existing body"
                        (click)="onFilletAction()">
                  <mat-icon>rounded_corner</mat-icon>
                  <span class="ribbon-label">Fillet</span>
                </button>
                <button class="ribbon-button"
                        data-testid="action-chamfer"
                        [disabled]="readonly() || activeSketchId() !== null || !hasAdditiveBody()"
                        [class.active]="edgeBlendSidebar()?.kind === 'chamfer'"
                        matTooltip="Chamfer — bevel edges of the existing body"
                        (click)="onChamferAction()">
                  <mat-icon>format_shapes</mat-icon>
                  <span class="ribbon-label">Chamfer</span>
                </button>
                <button class="ribbon-button"
                        data-testid="action-shell"
                        [disabled]="readonly() || activeSketchId() !== null || !hasAdditiveBody()"
                        [class.active]="shellSidebar() !== null"
                        matTooltip="Shell — hollow the body by removing faces"
                        (click)="onShellAction()">
                  <mat-icon>view_in_ar</mat-icon>
                  <span class="ribbon-label">Shell</span>
                </button>
                <button class="ribbon-button"
                        data-testid="action-combine"
                        [disabled]="readonly() || activeSketchId() !== null || bodies().length < 2"
                        [class.active]="combineSidebar() !== null"
                        matTooltip="Combine — boolean operation between bodies (add / subtract / common)"
                        (click)="onCombineAction()">
                  <mat-icon>merge_type</mat-icon>
                  <span class="ribbon-label">Combine</span>
                </button>
                <button class="ribbon-button"
                        data-testid="action-mirror-body"
                        [disabled]="readonly() || activeSketchId() !== null || !hasAdditiveBody()"
                        [class.active]="mirrorBodySidebar() !== null"
                        matTooltip="Mirror Body — reflect bodies across a plane"
                        (click)="onMirrorBodyAction()">
                  <mat-icon>flip</mat-icon>
                  <span class="ribbon-label">Mirror Body</span>
                </button>
                <button class="ribbon-button"
                        data-testid="action-move-copy-body"
                        [disabled]="readonly() || activeSketchId() !== null || !hasAdditiveBody()"
                        [class.active]="moveCopyBodySidebar() !== null"
                        matTooltip="Move/Copy Body — translate and/or rotate selected bodies"
                        (click)="onMoveCopyBodyAction()">
                  <mat-icon>open_with</mat-icon>
                  <span class="ribbon-label">Move/Copy</span>
                </button>
              </div>
              <div class="ribbon-group-label">Body</div>
            </div>

            <div class="ribbon-divider"></div>

            <!-- ── Reference geometry ──────────────────────────────── -->
            <div class="ribbon-group">
              <div class="ribbon-group-row">
                <button class="ribbon-button"
                        data-testid="action-datum-plane"
                        [disabled]="readonly() || activeSketchId() !== null"
                        [class.active]="datumPlaneSidebar() !== null"
                        matTooltip="Plane — create a user-defined reference plane (offset, three-point, angled, etc.)"
                        (click)="onDatumPlaneAction()">
                  <mat-icon>crop_din</mat-icon>
                  <span class="ribbon-label">Plane</span>
                </button>
                <button class="ribbon-button"
                        data-testid="action-datum-axis"
                        [disabled]="readonly() || activeSketchId() !== null"
                        [class.active]="datumAxisSidebar() !== null"
                        matTooltip="Axis — create a user-defined reference axis"
                        (click)="onDatumAxisAction()">
                  <mat-icon>show_chart</mat-icon>
                  <span class="ribbon-label">Axis</span>
                </button>
                <button class="ribbon-button"
                        data-testid="action-datum-point"
                        [disabled]="readonly() || activeSketchId() !== null"
                        [class.active]="datumPointSidebar() !== null"
                        matTooltip="Point — create a user-defined reference point"
                        (click)="onDatumPointAction()">
                  <mat-icon>place</mat-icon>
                  <span class="ribbon-label">Point</span>
                </button>
              </div>
              <div class="ribbon-group-label">Reference</div>
            </div>

            <div class="ribbon-divider"></div>

            <!-- ── Replication ─────────────────────────────────────── -->
            <div class="ribbon-group">
              <div class="ribbon-group-row">
                <button class="ribbon-button"
                        data-testid="action-mirror"
                        [disabled]="readonly() || activeSketchId() !== null || !hasAdditiveBody()"
                        [class.active]="patternSidebar()?.kind === 'mirror'"
                        matTooltip="Mirror — reflect the body across a plane"
                        (click)="onMirrorAction()">
                  <mat-icon>flip</mat-icon>
                  <span class="ribbon-label">Mirror</span>
                </button>
                <button class="ribbon-button"
                        data-testid="action-linear-pattern"
                        [disabled]="readonly() || activeSketchId() !== null || !hasAdditiveBody()"
                        [class.active]="patternSidebar()?.kind === 'linearPattern'"
                        matTooltip="Linear Pattern — copy the body along one or two directions"
                        (click)="onLinearPatternAction()">
                  <mat-icon>grid_on</mat-icon>
                  <span class="ribbon-label">Linear</span>
                </button>
                <button class="ribbon-button"
                        data-testid="action-circular-pattern"
                        [disabled]="readonly() || activeSketchId() !== null || !hasAdditiveBody()"
                        [class.active]="patternSidebar()?.kind === 'circularPattern'"
                        matTooltip="Circular Pattern — rotate copies of the body around an axis"
                        (click)="onCircularPatternAction()">
                  <mat-icon>rotate_right</mat-icon>
                  <span class="ribbon-label">Circular</span>
                </button>
              </div>
              <div class="ribbon-group-label">Pattern</div>
            </div>

            <div class="ribbon-divider"></div>

            <!-- ── Tools ──────────────────────────────────────────── -->
            <div class="ribbon-group">
              <div class="ribbon-group-row">
                <button class="ribbon-button"
                        data-testid="action-measure"
                        [disabled]="activeSketchId() !== null"
                        [class.active]="measureSidebar()"
                        matTooltip="Measure — distance / angle between vertices, edges, or faces"
                        (click)="onMeasureAction()">
                  <mat-icon>straighten</mat-icon>
                  <span class="ribbon-label">Measure</span>
                </button>
                <button class="ribbon-button"
                        data-testid="action-equations"
                        [disabled]="readonly()"
                        matTooltip="Equations — define global variables and drive dimensions by expression"
                        (click)="openEquationsPanel()">
                  <mat-icon>functions</mat-icon>
                  <span class="ribbon-label">Equations</span>
                </button>
              </div>
              <div class="ribbon-group-label">Tools</div>
            </div>

            <!-- Cancel (Esc) — sits outside any group; only shows
                 while a pick-mode is active. -->
            <button class="ribbon-button"
                    *ngIf="mode() !== 'idle' && activeSketchId() === null"
                    matTooltip="Cancel (Esc)"
                    (click)="setMode('idle')">
              <mat-icon>close</mat-icon>
              <span class="ribbon-label">Cancel</span>
            </button>
          </div>
          <div class="ribbon-pane" [hidden]="activeTab() !== 'sketch'">
            <!-- Sketch-editor renders the sketch toolbar (tools + constraints
                 + DOF readout). Pointer events come from the 3D viewer via
                 onViewerSketchX() handlers below. -->
            <app-cad-sketch-editor #sketchEditor
              [sketchId]="activeSketchId() ?? ''"
              [doc]="doc()"
              [readonly]="readonly() || activeSketchId() === null"
              (sketchChanged)="onSketchChanged($event)"
              (exitSketch)="onExitSketch()"
              (extrudeRequested)="onExtrudeRequested()"
              (cutExtrudeRequested)="onCutExtrudeRequested()"
              (revolveRequested)="onRevolveRequested()"
              (dimensionCreated)="onDimensionCreated($event)">
            </app-cad-sketch-editor>
            <span class="ribbon-hint" *ngIf="activeSketchId() === null">
              Pick or create a sketch first — switch to Features → Sketch.
            </span>
          </div>
        </div>
        <div class="tab-strip">
          <button class="tab" data-testid="tab-features"
                  [class.active]="activeTab() === 'features'"
                  (click)="setActiveTab('features')">
            Features
          </button>
          <button class="tab" data-testid="tab-sketch"
                  [class.active]="activeTab() === 'sketch'"
                  (click)="setActiveTab('sketch')">
            Sketch
          </button>
        </div>
      </div>

      <div class="editor-body">
        <app-cad-feature-tree-panel
          [features]="featureTree().features"
          [doc]="doc()"
          [selectableSketches]="mode() === 'pick-extrude-target' || mode() === 'pick-revolve-target' || mode() === 'pick-cut-extrude-target' || mode() === 'pick-cut-revolve-target'"
          [selectedFeatures]="selectedFeatures()"
          [featureErrors]="mergedFeatureErrors()"
          [selectedSketches]="selectedSketches()"
          [bodyList]="bodies()"
          [hiddenBodyIds]="hiddenBodies()"
          [rollbackBeforeIndex]="rollbackBeforeIndex()"
          [cosmeticThreadsCount]="cosmeticThreadsTotalCount()"
          [cosmeticThreadsVisible]="cosmeticThreadsVisible()"
          (rollbackChanged)="setRollbackBeforeIndex($event)"
          (sketchSelected)="onTreeSketchSelected($event)"
          (sketchSelect)="onTreeSketchSelect($event)"
          (visibilityToggled)="onDatumVisibilityToggled($event)"
          (actionRequested)="onTreeAction($event)"
          (featureSelect)="onFeatureTreeSelect($event)"
          (bodyVisibilityToggled)="toggleBodyVisibility($event)"
          (bodyIsolated)="onIsolateBody($event)"
          (bodyDeleted)="onDeleteBody($event)"
          class="feature-tree">
        </app-cad-feature-tree-panel>

        <!-- Constraint list panel — only shown while editing a sketch and
             when no PropertyManager-style tool panel (Mirror, etc.) is
             active. Tool panels swap into this column so the user has one
             place to look for context. -->
        <app-cad-constraint-list
          *ngIf="activeSketchId() as sid; else nothing"
          [constraints]="activeSketchConstraints()"
          [entities]="activeSketchEntities()"
          [defaultUnit]="defaultUnit()"
          [selectedId]="selectedConstraintId()"
          (remove)="onRemoveConstraint(sid, $event)"
          (edit)="onEditConstraint(sid, $event)"
          (select)="onConstraintListSelect($event)"
          class="constraint-list"
          [hidden]="sketchEditor.tool() === 'mirror' || sketchEditor.tool() === 'fillet' || sketchEditor.tool() === 'chamfer' || sketchEntityProps() !== null">
        </app-cad-constraint-list>
        <ng-template #nothing></ng-template>

        <!-- REQ Batch 6 — Sketch entity properties panel. Shows
             editable fields for the selected text / picture /
             equation entity. Lives in the same column as the
             constraint list and replaces it while editing. -->
        <ng-container *ngIf="sketchEntityProps() as props">
          <div class="tool-panel" data-testid="sketch-entity-props">
            <h3 class="panel-title">
              <mat-icon>{{ props.kind === 'text' ? 'text_fields' : props.kind === 'picture' ? 'image' : 'functions' }}</mat-icon>
              {{ props.kind === 'text' ? 'Text' : props.kind === 'picture' ? 'Picture' : 'Equation Curve' }}
            </h3>

            <ng-container *ngIf="props.kind === 'text'">
              <div class="panel-field active">
                <div class="field-header">
                  <mat-icon class="field-icon">title</mat-icon>
                  <span class="field-label">Text</span>
                </div>
                <input class="panel-input"
                       data-testid="text-prop-text"
                       [value]="props.text"
                       (input)="onSketchTextEdit(props.id, 'text', $any($event.target).value)" />
                <p class="panel-hint" style="margin: 4px 0 0;">
                  Use <code>{{ '#{name}' }}</code> for equations. Live: <em>{{ resolveTextPreview(props.text) }}</em>
                </p>
                <p class="panel-hint" style="margin: 4px 0 0;">
                  Size is set by the construction box — dimension a side via Smart Dim to fix the text size.
                </p>
              </div>
              <div class="panel-field">
                <div class="field-header">
                  <mat-icon class="field-icon">format_align_left</mat-icon>
                  <span class="field-label">Alignment</span>
                </div>
                <div style="display: flex; gap: 4px;">
                  <button class="btn"
                          data-testid="text-prop-justify-left"
                          [class.active]="(props.justify ?? 'left') === 'left'"
                          (click)="onSketchTextEdit(props.id, 'justify', 'left')">
                    <mat-icon>format_align_left</mat-icon>
                  </button>
                  <button class="btn"
                          data-testid="text-prop-justify-center"
                          [class.active]="props.justify === 'center'"
                          (click)="onSketchTextEdit(props.id, 'justify', 'center')">
                    <mat-icon>format_align_center</mat-icon>
                  </button>
                  <button class="btn"
                          data-testid="text-prop-justify-right"
                          [class.active]="props.justify === 'right'"
                          (click)="onSketchTextEdit(props.id, 'justify', 'right')">
                    <mat-icon>format_align_right</mat-icon>
                  </button>
                </div>
              </div>
              <div class="panel-field">
                <div class="field-header">
                  <mat-icon class="field-icon">font_download</mat-icon>
                  <span class="field-label">Font</span>
                </div>
                <select class="text-input" style="width: 100%;"
                        data-testid="text-prop-font"
                        [value]="props.font ?? 'outline'"
                        (change)="onSketchTextEdit(props.id, 'font', $any($event.target).value)">
                  <option value="outline">Outline (extrudable)</option>
                  <option value="singleLine">Single line (engraving)</option>
                </select>
                <p class="panel-hint" *ngIf="props.font === 'singleLine'" style="margin: 4px 0 0;">
                  Single-stroke engraving font — open strokes for V-carve / engraving. Not a closed region, so it won't extrude into a solid.
                </p>
              </div>
              <div class="panel-field">
                <div class="field-header">
                  <mat-icon class="field-icon">flip</mat-icon>
                  <span class="field-label">Orientation</span>
                </div>
                <div style="display: flex; gap: 4px; align-items: center;">
                  <button class="btn"
                          data-testid="text-prop-mirror"
                          [class.active]="!!props.mirror"
                          matTooltip="Mirror horizontally"
                          (click)="onSketchTextEdit(props.id, 'mirror', props.mirror ? 0 : 1)">
                    <mat-icon>flip</mat-icon>
                  </button>
                  <button class="btn"
                          data-testid="text-prop-rotate"
                          matTooltip="Rotate 90°"
                          (click)="onSketchTextEdit(props.id, 'rotation', (((props.rotation ?? 0) + 90) % 360))">
                    <mat-icon>rotate_right</mat-icon>
                  </button>
                  <input type="number" class="text-input" step="15" style="width: 70px;"
                         data-testid="text-prop-rotation"
                         [value]="props.rotation ?? 0"
                         (input)="onSketchTextEdit(props.id, 'rotation', $any($event.target).valueAsNumber)" />
                  <span class="panel-hint" style="margin: 0;">deg</span>
                </div>
              </div>
              <div class="panel-field">
                <div class="field-header">
                  <mat-icon class="field-icon">key</mat-icon>
                  <span class="field-label">Available variables</span>
                </div>
                <p class="panel-hint" style="margin: 0; font-family: monospace; line-height: 1.5;">
                  <span *ngFor="let kv of textVariableEntries(); last as last">{{ '#{' + kv.name + '}' }} = {{ kv.value || '—' }}<span *ngIf="!last">, </span></span>
                </p>
              </div>
            </ng-container>

            <ng-container *ngIf="props.kind === 'picture'">
              <div class="panel-field active">
                <div class="field-header">
                  <mat-icon class="field-icon">straighten</mat-icon>
                  <span class="field-label">Width (mm)</span>
                </div>
                <input type="number" min="0.1" step="0.5" class="panel-input"
                       data-testid="picture-prop-width"
                       [value]="props.width"
                       (input)="onSketchPictureEdit(props.id, 'width', +$any($event.target).value)" />
              </div>
              <div class="panel-field">
                <div class="field-header">
                  <mat-icon class="field-icon">height</mat-icon>
                  <span class="field-label">Height (mm)</span>
                </div>
                <input type="number" min="0.1" step="0.5" class="panel-input"
                       data-testid="picture-prop-height"
                       [value]="props.height"
                       (input)="onSketchPictureEdit(props.id, 'height', +$any($event.target).value)" />
              </div>
              <div class="panel-field">
                <div class="field-header">
                  <mat-icon class="field-icon">rotate_right</mat-icon>
                  <span class="field-label">Rotation (deg)</span>
                </div>
                <input type="number" step="1" class="panel-input"
                       data-testid="picture-prop-rotation"
                       [value]="props.rotation * 180 / 3.141592653589793"
                       (input)="onSketchPictureEdit(props.id, 'rotation', (+$any($event.target).value) * 3.141592653589793 / 180)" />
              </div>
              <div class="panel-field">
                <div class="field-header">
                  <mat-icon class="field-icon">opacity</mat-icon>
                  <span class="field-label">Opacity</span>
                </div>
                <input type="number" min="0" max="1" step="0.05" class="panel-input"
                       data-testid="picture-prop-opacity"
                       [value]="props.opacity"
                       (input)="onSketchPictureEdit(props.id, 'opacity', +$any($event.target).value)" />
              </div>
            </ng-container>

            <ng-container *ngIf="props.kind === 'equation'">
              <div class="panel-field active">
                <div class="field-header">
                  <mat-icon class="field-icon">functions</mat-icon>
                  <span class="field-label">x(t)</span>
                </div>
                <input class="panel-input"
                       data-testid="eq-prop-xexpr"
                       [value]="props.xExpr"
                       (input)="onSketchEquationEdit(props.id, 'xExpr', $any($event.target).value)" />
              </div>
              <div class="panel-field">
                <div class="field-header">
                  <mat-icon class="field-icon">functions</mat-icon>
                  <span class="field-label">y(t)</span>
                </div>
                <input class="panel-input"
                       data-testid="eq-prop-yexpr"
                       [value]="props.yExpr"
                       (input)="onSketchEquationEdit(props.id, 'yExpr', $any($event.target).value)" />
              </div>
              <div class="panel-field">
                <div class="field-header">
                  <mat-icon class="field-icon">first_page</mat-icon>
                  <span class="field-label">t min</span>
                </div>
                <input type="number" step="0.1" class="panel-input"
                       data-testid="eq-prop-tmin"
                       [value]="props.tMin"
                       (input)="onSketchEquationEdit(props.id, 'tMin', +$any($event.target).value)" />
              </div>
              <div class="panel-field">
                <div class="field-header">
                  <mat-icon class="field-icon">last_page</mat-icon>
                  <span class="field-label">t max</span>
                </div>
                <input type="number" step="0.1" class="panel-input"
                       data-testid="eq-prop-tmax"
                       [value]="props.tMax"
                       (input)="onSketchEquationEdit(props.id, 'tMax', +$any($event.target).value)" />
              </div>
              <div class="panel-field">
                <div class="field-header">
                  <mat-icon class="field-icon">density_medium</mat-icon>
                  <span class="field-label">Samples</span>
                </div>
                <input type="number" min="8" max="2000" step="10" class="panel-input"
                       data-testid="eq-prop-samples"
                       [value]="props.samples"
                       (input)="onSketchEquationEdit(props.id, 'samples', +$any($event.target).value)" />
              </div>
            </ng-container>
          </div>
        </ng-container>

        <!-- Mirror PropertyManager — same column as the constraint list,
             rendered only while the Mirror tool is active. State + commit/
             cancel methods live on the sketch-editor, wired in via the
             #sketchEditor template ref. -->
        <ng-container *ngIf="activeSketchId() && sketchEditor.tool() === 'mirror'">
          <div class="tool-panel" data-testid="mirror-sidebar">
            <h3 class="panel-title">
              <mat-icon>flip</mat-icon> Mirror Entities
            </h3>
            <p class="panel-hint">
              {{ sketchEditor.mirrorStage() === 'pick-entities'
                 ? 'Click each entity in the canvas to add it. Then click the Axis field below and pick a line.'
                 : 'Click any line in the canvas to set the mirror axis.' }}
            </p>

            <div class="panel-field"
                 [class.active]="sketchEditor.mirrorStage() === 'pick-entities'"
                 data-testid="mirror-field-entities"
                 (click)="sketchEditor.mirrorStage.set('pick-entities')">
              <div class="field-header">
                <mat-icon class="field-icon">layers</mat-icon>
                <span class="field-label">Entities to mirror</span>
                <span class="field-count">{{ sketchEditor.mirrorEntitiesToShow().length }}</span>
              </div>
              <div class="field-empty"
                   *ngIf="sketchEditor.mirrorEntitiesToShow().length === 0">
                Click entities in the canvas
              </div>
              <ul class="entity-list" *ngIf="sketchEditor.mirrorEntitiesToShow().length > 0">
                <li class="entity-row"
                    *ngFor="let e of sketchEditor.mirrorEntitiesToShow(); trackBy: trackEntityById"
                    [attr.data-testid]="'mirror-entity-' + e.id">
                  <mat-icon class="entity-icon">{{ sketchEditor.entityIcon(e) }}</mat-icon>
                  <div class="entity-info">
                    <div class="entity-label">{{ sketchEditor.entityShortLabel(e) }}</div>
                    <div class="entity-detail">{{ sketchEditor.entityShortDescription(e) }}</div>
                  </div>
                  <button class="icon-btn entity-remove"
                          matTooltip="Remove from selection"
                          (click)="sketchEditor.deselectEntity(e.id); $event.stopPropagation()">
                    <mat-icon>close</mat-icon>
                  </button>
                </li>
              </ul>
            </div>

            <div class="panel-field"
                 [class.active]="sketchEditor.mirrorStage() === 'pick-axis'"
                 data-testid="mirror-field-axis"
                 (click)="sketchEditor.mirrorStage.set('pick-axis')">
              <div class="field-header">
                <mat-icon class="field-icon">straighten</mat-icon>
                <span class="field-label">Mirror axis</span>
              </div>
              <ng-container *ngIf="sketchEditor.mirrorAxisEntity() as axis; else noAxis">
                <div class="entity-row single">
                  <mat-icon class="entity-icon">{{ sketchEditor.entityIcon(axis) }}</mat-icon>
                  <div class="entity-info">
                    <div class="entity-label">{{ sketchEditor.entityShortLabel(axis) }}</div>
                    <div class="entity-detail">{{ sketchEditor.entityShortDescription(axis) }}</div>
                  </div>
                  <button class="icon-btn entity-remove"
                          matTooltip="Clear axis"
                          (click)="sketchEditor.clearMirrorAxis(); $event.stopPropagation()">
                    <mat-icon>close</mat-icon>
                  </button>
                </div>
              </ng-container>
              <ng-template #noAxis>
                <div class="field-empty">Click a line in the canvas</div>
              </ng-template>
            </div>

            <div class="panel-actions">
              <button class="btn btn-primary"
                      [disabled]="sketchEditor.selected().size === 0 || !sketchEditor.mirrorAxisId()"
                      (click)="sketchEditor.commitMirror()"
                      data-testid="mirror-ok">
                <mat-icon>check</mat-icon> OK
              </button>
              <button class="btn"
                      (click)="sketchEditor.cancelMirror()"
                      data-testid="mirror-cancel">
                <mat-icon>close</mat-icon> Cancel
              </button>
            </div>
          </div>
        </ng-container>

        <!-- Fillet PropertyManager — radius input + corner list. Each click
             on a corner toggles it in the list; OK runs filletLines on every
             corner with the current radius. -->
        <ng-container *ngIf="activeSketchId() && sketchEditor.tool() === 'fillet'">
          <div class="tool-panel" data-testid="fillet-sidebar">
            <h3 class="panel-title">
              <mat-icon>rounded_corner</mat-icon> Fillet
            </h3>
            <p class="panel-hint">
              Set the radius below, then click each corner in the canvas to add it. Click X to remove. OK applies the fillet to every corner with the same radius.
            </p>

            <div class="panel-field active">
              <div class="field-header">
                <mat-icon class="field-icon">straighten</mat-icon>
                <span class="field-label">Radius</span>
              </div>
              <input class="panel-input"
                     type="number" min="0.01" step="0.5"
                     data-testid="fillet-radius-input"
                     [value]="sketchEditor.filletRadius() ?? 5"
                     (input)="sketchEditor.filletRadius.set(+($any($event.target).value))" />
            </div>

            <div class="panel-field active">
              <div class="field-header">
                <mat-icon class="field-icon">layers</mat-icon>
                <span class="field-label">Corners to fillet</span>
                <span class="field-count">{{ filletCornersArray().length }}</span>
              </div>
              <div class="field-empty" *ngIf="filletCornersArray().length === 0">
                Click corner points in the canvas
              </div>
              <ul class="entity-list" *ngIf="filletCornersArray().length > 0">
                <li class="entity-row"
                    *ngFor="let id of filletCornersArray(); trackBy: trackString"
                    [attr.data-testid]="'fillet-corner-' + id">
                  <mat-icon class="entity-icon">radio_button_checked</mat-icon>
                  <div class="entity-info">
                    <div class="entity-label">Corner</div>
                    <div class="entity-detail">{{ cornerCoordsLabel(id) }}</div>
                  </div>
                  <button class="icon-btn entity-remove"
                          matTooltip="Remove from selection"
                          (click)="sketchEditor.removeFilletCorner(id); $event.stopPropagation()">
                    <mat-icon>close</mat-icon>
                  </button>
                </li>
              </ul>
            </div>

            <label class="panel-toggle" data-testid="fillet-keep-construction">
              <input type="checkbox"
                     [checked]="sketchEditor.filletKeepConstruction()"
                     (change)="sketchEditor.filletKeepConstruction.set($any($event.target).checked)" />
              <span>Keep removed segments as construction</span>
            </label>

            <div class="panel-actions">
              <button class="btn btn-primary"
                      [disabled]="filletCornersArray().length === 0"
                      (click)="sketchEditor.commitFillet()"
                      data-testid="fillet-ok">
                <mat-icon>check</mat-icon> OK
              </button>
              <button class="btn"
                      (click)="sketchEditor.cancelFillet()"
                      data-testid="fillet-cancel">
                <mat-icon>close</mat-icon> Cancel
              </button>
            </div>
          </div>
        </ng-container>

        <!-- Chamfer PropertyManager — same shape as Fillet but with a
             distance input. OK runs chamferLines on every queued corner. -->
        <ng-container *ngIf="activeSketchId() && sketchEditor.tool() === 'chamfer'">
          <div class="tool-panel" data-testid="chamfer-sidebar">
            <h3 class="panel-title">
              <mat-icon>crop_din</mat-icon> Chamfer
            </h3>
            <p class="panel-hint">
              Set the distance below, then click each corner to add it. OK applies the chamfer to every corner.
            </p>

            <div class="panel-field active">
              <div class="field-header">
                <mat-icon class="field-icon">tune</mat-icon>
                <span class="field-label">Mode</span>
              </div>
              <select class="panel-input"
                      data-testid="chamfer-mode"
                      [value]="sketchEditor.chamferModeKind()"
                      (change)="sketchEditor.chamferModeKind.set($any($event.target).value)">
                <option value="equal">Equal distance</option>
                <option value="dist-dist">Distance / Distance</option>
                <option value="dist-angle">Distance / Angle</option>
              </select>
            </div>

            <div class="panel-field active">
              <div class="field-header">
                <mat-icon class="field-icon">
                  {{ sketchEditor.chamferModeKind() === 'dist-dist' ? 'swap_vert' : 'straighten' }}
                </mat-icon>
                <span class="field-label">
                  {{ sketchEditor.chamferModeKind() === 'dist-dist' ? 'Vertical' : 'Distance' }}
                </span>
              </div>
              <input class="panel-input"
                     type="number" min="0.01" step="0.5"
                     data-testid="chamfer-distance-input"
                     [value]="sketchEditor.chamferDistance() ?? 5"
                     (input)="sketchEditor.chamferDistance.set(+($any($event.target).value))" />
            </div>

            <div class="panel-field active" *ngIf="sketchEditor.chamferModeKind() === 'dist-dist'">
              <div class="field-header">
                <mat-icon class="field-icon">swap_horiz</mat-icon>
                <span class="field-label">Horizontal</span>
              </div>
              <input class="panel-input"
                     type="number" min="0.01" step="0.5"
                     data-testid="chamfer-distance2-input"
                     [value]="sketchEditor.chamferDistance2() ?? 5"
                     (input)="sketchEditor.chamferDistance2.set(+($any($event.target).value))" />
            </div>

            <div class="panel-field active" *ngIf="sketchEditor.chamferModeKind() === 'dist-angle'">
              <div class="field-header">
                <mat-icon class="field-icon">rotate_right</mat-icon>
                <span class="field-label">Angle (°)</span>
              </div>
              <input class="panel-input"
                     type="number" min="1" max="179" step="1"
                     data-testid="chamfer-angle-input"
                     [value]="sketchEditor.chamferAngleDeg() ?? 45"
                     (input)="sketchEditor.chamferAngleDeg.set(+($any($event.target).value))" />
              <button class="btn panel-flip"
                      data-testid="chamfer-flip"
                      (click)="sketchEditor.chamferPrimaryLine.set(sketchEditor.chamferPrimaryLine() === 1 ? 2 : 1)">
                <mat-icon>swap_horiz</mat-icon>
                Flip reference (currently line {{ sketchEditor.chamferPrimaryLine() }})
              </button>
            </div>

            <div class="panel-field active">
              <div class="field-header">
                <mat-icon class="field-icon">layers</mat-icon>
                <span class="field-label">Corners to chamfer</span>
                <span class="field-count">{{ chamferCornersArray().length }}</span>
              </div>
              <div class="field-empty" *ngIf="chamferCornersArray().length === 0">
                Click corner points in the canvas
              </div>
              <ul class="entity-list" *ngIf="chamferCornersArray().length > 0">
                <li class="entity-row"
                    *ngFor="let id of chamferCornersArray(); trackBy: trackString"
                    [attr.data-testid]="'chamfer-corner-' + id">
                  <mat-icon class="entity-icon">radio_button_checked</mat-icon>
                  <div class="entity-info">
                    <div class="entity-label">Corner</div>
                    <div class="entity-detail">{{ cornerCoordsLabel(id) }}</div>
                  </div>
                  <button class="icon-btn entity-remove"
                          (click)="sketchEditor.removeChamferCorner(id); $event.stopPropagation()">
                    <mat-icon>close</mat-icon>
                  </button>
                </li>
              </ul>
            </div>

            <label class="panel-toggle" data-testid="chamfer-keep-construction">
              <input type="checkbox"
                     [checked]="sketchEditor.chamferKeepConstruction()"
                     (change)="sketchEditor.chamferKeepConstruction.set($any($event.target).checked)" />
              <span>Keep removed segments as construction</span>
            </label>

            <div class="panel-actions">
              <button class="btn btn-primary"
                      [disabled]="chamferCornersArray().length === 0"
                      (click)="sketchEditor.commitChamfer()"
                      data-testid="chamfer-ok">
                <mat-icon>check</mat-icon> OK
              </button>
              <button class="btn"
                      (click)="sketchEditor.cancelChamfer()"
                      data-testid="chamfer-cancel">
                <mat-icon>close</mat-icon> Cancel
              </button>
            </div>
          </div>
        </ng-container>

        <!-- Offset PropertyManager — distance + multi-select queue +
             auto-chain toggle. Each click in the canvas toggles a curve
             in the queue; OK applies offsetCurve to every member. -->
        <ng-container *ngIf="activeSketchId() && sketchEditor.tool() === 'offset'">
          <div class="tool-panel" data-testid="offset-sidebar">
            <h3 class="panel-title">
              <mat-icon svgIcon="cad-offset"></mat-icon> Offset
            </h3>
            <p class="panel-hint">
              Set the distance, then click curves to add them to the queue. Click again on the same side of a curve to toggle it off. OK offsets every queued curve in one commit.
            </p>

            <div class="panel-field active">
              <div class="field-header">
                <mat-icon class="field-icon" svgIcon="cad-horizontal-distance"></mat-icon>
                <span class="field-label">Distance</span>
              </div>
              <input class="panel-input"
                     type="number" min="0.01" step="0.5"
                     data-testid="offset-distance-input"
                     [value]="sketchEditor.offsetDistance()"
                     (input)="sketchEditor.offsetDistance.set(+($any($event.target).value))" />
            </div>

            <label class="panel-toggle" data-testid="offset-chain-mode">
              <input type="checkbox"
                     [checked]="sketchEditor.offsetChainMode()"
                     (change)="sketchEditor.offsetChainMode.set($any($event.target).checked)" />
              <span>Auto-chain: pull in connected curves on click</span>
            </label>

            <label class="panel-toggle" data-testid="offset-both-directions">
              <input type="checkbox"
                     [checked]="sketchEditor.offsetBothDirections()"
                     (change)="sketchEditor.offsetBothDirections.set($any($event.target).checked)" />
              <span>Both directions: offset each curve to both sides</span>
            </label>

            <label class="panel-toggle" data-testid="offset-fill-corners">
              <input type="checkbox"
                     [checked]="sketchEditor.offsetFillCorners()"
                     (change)="sketchEditor.offsetFillCorners.set($any($event.target).checked)" />
              <span>Fill convex corners with an arc (SolidWorks default)</span>
            </label>

            <label class="panel-toggle" data-testid="offset-keep-construction">
              <input type="checkbox"
                     [checked]="sketchEditor.offsetKeepConstruction()"
                     (change)="sketchEditor.offsetKeepConstruction.set($any($event.target).checked)" />
              <span>Keep originals as construction</span>
            </label>

            <div class="panel-field active">
              <div class="field-header">
                <mat-icon class="field-icon">layers</mat-icon>
                <span class="field-label">Curves to offset</span>
                <span class="field-count">{{ offsetSelectionsArray().length }}</span>
              </div>
              <div class="field-empty" *ngIf="offsetSelectionsArray().length === 0">
                Click curves in the canvas (the click side decides which way to offset)
              </div>
              <ul class="entity-list" *ngIf="offsetSelectionsArray().length > 0">
                <li class="entity-row"
                    *ngFor="let id of offsetSelectionsArray(); trackBy: trackString"
                    [attr.data-testid]="'offset-curve-' + id">
                  <mat-icon class="entity-icon" [svgIcon]="offsetCurveIcon(id)"></mat-icon>
                  <div class="entity-info">
                    <div class="entity-label">{{ offsetCurveLabel(id) }}</div>
                    <div class="entity-detail">{{ id }}</div>
                  </div>
                  <button class="icon-btn"
                          [attr.data-testid]="'offset-flip-' + id"
                          matTooltip="Flip this curve to the opposite side"
                          (click)="sketchEditor.flipOffsetSelectionSide(id); $event.stopPropagation()">
                    <mat-icon>swap_horiz</mat-icon>
                  </button>
                  <button class="icon-btn entity-remove"
                          matTooltip="Remove from queue"
                          (click)="sketchEditor.removeOffsetSelection(id); $event.stopPropagation()">
                    <mat-icon>close</mat-icon>
                  </button>
                </li>
              </ul>
            </div>

            <div class="panel-actions">
              <button class="btn btn-primary"
                      [disabled]="offsetSelectionsArray().length === 0 || sketchEditor.offsetDistance() <= 0"
                      (click)="sketchEditor.commitOffset()"
                      data-testid="offset-ok">
                <mat-icon>check</mat-icon> OK
              </button>
              <button class="btn"
                      [disabled]="offsetSelectionsArray().length === 0"
                      (click)="sketchEditor.flipOffsetSide()"
                      data-testid="offset-flip"
                      matTooltip="Flip the offset to the opposite side of every queued curve">
                <mat-icon>swap_horiz</mat-icon> Flip
              </button>
              <button class="btn"
                      (click)="sketchEditor.cancelOffset()"
                      data-testid="offset-cancel">
                <mat-icon>close</mat-icon> Cancel
              </button>
            </div>
          </div>
        </ng-container>

        <!-- Extrude PropertyManager — opens when the Extrude ribbon button
             is clicked with a sketch selected (or after the "pick-extrude-
             target" mode lands on a sketch). Inputs mirror the previous
             MatDialog: distance, direction flip, loop selection. -->
        <ng-container *ngIf="extrudeSidebar() as ctx">
          <div class="tool-panel" data-testid="extrude-sidebar"
               (keyup.enter)="onExtrudeSidebarEnter()">
            <h3 class="panel-title">
              <mat-icon>{{ ctx.mode === 'cutExtrude' ? 'vertical_align_bottom' : 'arrow_upward' }}</mat-icon>
              {{ ctx.editingFeatureId
                  ? (ctx.mode === 'cutExtrude' ? 'Edit Cut' : 'Edit Extrude')
                  : (ctx.mode === 'cutExtrude' ? 'Cut Extrude' : 'Extrude') }}
            </h3>
            <p class="panel-hint">
              Pick the end condition. {{ ctx.regionCount > 1 ? 'Choose which closed regions in the sketch to extrude.' : '' }}
            </p>

            <!-- Group: Start condition.
                 Default 'sketchPlane' keeps the historical behaviour;
                 'offset' shifts the profile along the plane normal by a
                 typed distance before extruding; 'upToVertex'/'upToSurface'
                 are typed but kernel-resolved later. -->
            <div class="panel-field active">
              <div class="field-header">
                <mat-icon class="field-icon">flag</mat-icon>
                <span class="field-label">Start condition</span>
              </div>
              <div class="sub-row">
                <span class="sub-label">Start from</span>
                <select class="panel-input"
                        data-testid="extrude-start-condition"
                        [value]="extrudeStartKind()"
                        (change)="setExtrudeStartKind($any($event.target).value)">
                  <option value="sketchPlane">Sketch plane</option>
                  <option value="offset">Offset from sketch plane</option>
                  <option value="upToVertex">Up to vertex</option>
                  <option value="upToSurface">Up to surface</option>
                  <option value="offsetFromSurface">Offset from face</option>
                </select>
              </div>
              <div class="sub-row" *ngIf="extrudeStartKind() === 'offset'">
                <span class="sub-label">Offset distance</span>
                <div class="input-with-flip">
                  <app-dim-input
                    testid="extrude-start-offset"
                    ariaLabel="Extrude start offset"
                    unit="mm"
                    [value]="extrudeStartOffset()"
                    [expression]="extrudeStartOffsetExpression()"
                    [equationValues]="equationValues()"
                    (valueChange)="setStartOffsetMagnitude($event)"
                    (expressionChange)="extrudeStartOffsetExpression.set($event)" />
                  <button class="btn flip-square"
                          data-testid="extrude-start-offset-flip"
                          [matTooltip]="extrudeStartOffsetFlipped() ? 'Reverse (currently against normal)' : 'Along normal'"
                          (click)="extrudeStartOffsetFlipped.set(!extrudeStartOffsetFlipped())">
                    <mat-icon>{{ extrudeStartOffsetFlipped() ? 'south' : 'north' }}</mat-icon>
                  </button>
                </div>
              </div>
              <div class="sub-row" *ngIf="extrudeStartKind() === 'upToVertex'">
                <span class="sub-label">Target vertex</span>
                <button class="btn panel-flip"
                        data-testid="extrude-start-pick-vertex"
                        (click)="beginVertexPick('start')">
                  <mat-icon>{{ extrudeStartUpToVertexId() ? 'check_circle' : 'touch_app' }}</mat-icon>
                  {{ extrudeStartUpToVertexId() ? 'Vertex picked — click to change' : 'Pick a vertex in the viewer' }}
                </button>
              </div>
              <div class="sub-row" *ngIf="extrudeStartKind() === 'upToSurface'">
                <span class="sub-label">Target face</span>
                <button class="btn panel-flip"
                        data-testid="extrude-start-pick-face"
                        (click)="beginFacePick('start')">
                  <mat-icon>{{ extrudeStartUpToFaceId() ? 'check_circle' : 'touch_app' }}</mat-icon>
                  {{ extrudeStartUpToFaceId() ? 'Face picked — click to change' : 'Pick a face in the viewer' }}
                </button>
              </div>
              <div class="sub-row" *ngIf="extrudeStartKind() === 'offsetFromSurface'">
                <span class="sub-label">Reference face</span>
                <button class="btn panel-flip"
                        data-testid="extrude-start-pick-offset-face"
                        (click)="beginFacePick('start')">
                  <mat-icon>{{ extrudeStartUpToFaceId() ? 'check_circle' : 'touch_app' }}</mat-icon>
                  {{ extrudeStartUpToFaceId() ? 'Face picked — click to change' : 'Pick a face in the viewer' }}
                </button>
              </div>
              <div class="sub-row" *ngIf="extrudeStartKind() === 'offsetFromSurface'">
                <span class="sub-label">Offset distance</span>
                <div class="input-with-flip">
                  <app-dim-input
                    testid="extrude-start-offset-face-distance"
                    ariaLabel="Extrude start offset from face"
                    unit="mm"
                    [value]="extrudeStartOffsetFromFaceDistance()"
                    [expression]="extrudeStartOffsetFromFaceExpression()"
                    [equationValues]="equationValues()"
                    (valueChange)="setStartOffsetFromFaceMagnitude($event)"
                    (expressionChange)="extrudeStartOffsetFromFaceExpression.set($event)" />
                  <button class="btn flip-square"
                          data-testid="extrude-start-offset-face-flip"
                          [matTooltip]="extrudeStartOffsetFromFaceFlipped() ? 'Reverse (currently against face normal)' : 'Along face normal'"
                          (click)="extrudeStartOffsetFromFaceFlipped.set(!extrudeStartOffsetFromFaceFlipped())">
                    <mat-icon>{{ extrudeStartOffsetFromFaceFlipped() ? 'south' : 'north' }}</mat-icon>
                  </button>
                </div>
              </div>
            </div>

            <!-- Group: Direction 1. End condition + flip + the
                 condition-specific value (distance, target vertex,
                 target face) all live here. -->
            <div class="panel-field active">
              <div class="field-header">
                <mat-icon class="field-icon">north</mat-icon>
                <span class="field-label">Direction 1</span>
              </div>
              <div class="sub-row">
                <span class="sub-label">End condition</span>
                <div class="input-with-flip">
                  <select class="panel-input"
                          data-testid="extrude-end-condition"
                          [value]="extrudeEndKindDisplay()"
                          (change)="setExtrudeEndKind($any($event.target).value)">
                    <option value="blind">Blind</option>
                    <option value="midPlane">Mid Plane</option>
                    <option value="throughAll">Through All</option>
                    <option value="throughAllBoth" *ngIf="ctx.mode === 'cutExtrude'">Through All — Both</option>
                    <option value="upToVertex">Up to Vertex</option>
                    <option value="upToSurface">Up to Surface</option>
                    <option value="offsetFromSurface">Offset from face</option>
                    <option value="upToBody" disabled>Up to Body (coming soon)</option>
                  </select>
                  <button class="btn flip-square"
                          *ngIf="extrudeEndKind() !== 'midPlane'"
                          data-testid="extrude-flip"
                          [matTooltip]="extrudeFlipped() ? 'Reverse (currently against normal)' : 'Along normal'"
                          (click)="extrudeFlipped.set(!extrudeFlipped())">
                    <mat-icon>{{ extrudeFlipped() ? 'south' : 'north' }}</mat-icon>
                  </button>
                </div>
              </div>
              <div class="sub-row"
                   *ngIf="extrudeEndKind() === 'blind' || extrudeEndKind() === 'midPlane'">
                <span class="sub-label">{{ extrudeEndKind() === 'midPlane' ? 'Total thickness' : 'Distance' }}</span>
                <app-dim-input
                  testid="extrude-input"
                  ariaLabel="Extrude distance"
                  unit="mm"
                  [value]="extrudeDistance()"
                  [expression]="extrudeDistanceExpression()"
                  [equationValues]="equationValues()"
                  (valueChange)="extrudeDistance.set($event)"
                  (expressionChange)="extrudeDistanceExpression.set($event)" />
              </div>
              <div class="sub-row" *ngIf="extrudeEndKind() === 'upToVertex'">
                <span class="sub-label">Target vertex</span>
                <button class="btn panel-flip"
                        data-testid="extrude-pick-vertex"
                        (click)="beginVertexPick()">
                  <mat-icon>{{ extrudeUpToVertexId() ? 'check_circle' : 'touch_app' }}</mat-icon>
                  {{ extrudeUpToVertexId() ? 'Vertex picked — click to change' : 'Pick a vertex in the viewer' }}
                </button>
              </div>
              <div class="sub-row" *ngIf="extrudeEndKind() === 'upToSurface'">
                <span class="sub-label">Target face</span>
                <button class="btn panel-flip"
                        data-testid="extrude-pick-face"
                        (click)="beginFacePick()">
                  <mat-icon>{{ extrudeUpToFaceId() ? 'check_circle' : 'touch_app' }}</mat-icon>
                  {{ extrudeUpToFaceId() ? 'Face picked — click to change' : 'Pick a face in the viewer' }}
                </button>
              </div>
              <div class="sub-row" *ngIf="extrudeEndKind() === 'offsetFromSurface'">
                <span class="sub-label">Reference face</span>
                <button class="btn panel-flip"
                        data-testid="extrude-pick-offset-face"
                        (click)="beginFacePick()">
                  <mat-icon>{{ extrudeUpToFaceId() ? 'check_circle' : 'touch_app' }}</mat-icon>
                  {{ extrudeUpToFaceId() ? 'Face picked — click to change' : 'Pick a face in the viewer' }}
                </button>
              </div>
              <div class="sub-row" *ngIf="extrudeEndKind() === 'offsetFromSurface'">
                <span class="sub-label">Offset distance</span>
                <div class="input-with-flip">
                  <app-dim-input
                    testid="extrude-offset-face-distance"
                    ariaLabel="Extrude offset from face"
                    unit="mm"
                    [value]="extrudeOffsetFromFaceDistance()"
                    [expression]="extrudeOffsetFromFaceExpression()"
                    [equationValues]="equationValues()"
                    (valueChange)="setOffsetFromFaceMagnitude($event)"
                    (expressionChange)="extrudeOffsetFromFaceExpression.set($event)" />
                  <button class="btn flip-square"
                          data-testid="extrude-offset-face-flip"
                          [matTooltip]="extrudeOffsetFromFaceFlipped() ? 'Reverse (currently against face normal)' : 'Along face normal'"
                          (click)="extrudeOffsetFromFaceFlipped.set(!extrudeOffsetFromFaceFlipped())">
                    <mat-icon>{{ extrudeOffsetFromFaceFlipped() ? 'south' : 'north' }}</mat-icon>
                  </button>
                </div>
              </div>
            </div>

            <!-- Group: Direction 2.
                 Disabled when direction 1 is Mid Plane (already symmetric).
                 When enabled, a parallel end-condition + distance pair
                 grows the OPPOSITE way from direction 1. -->
            <div class="panel-field active" *ngIf="extrudeEndKind() !== 'midPlane'">
              <div class="field-header">
                <mat-icon class="field-icon">unfold_more</mat-icon>
                <span class="field-label">Direction 2</span>
                <label class="loop-toggle">
                  <input type="checkbox"
                         data-testid="extrude-dir2-enable"
                         [checked]="extrudeDir2Enabled()"
                         (change)="extrudeDir2Enabled.set($any($event.target).checked)" />
                  <span>{{ extrudeDir2Enabled() ? 'On' : 'Off' }}</span>
                </label>
              </div>
              <div class="sub-row" *ngIf="extrudeDir2Enabled()">
                <span class="sub-label">End condition</span>
                <select class="panel-input"
                        data-testid="extrude-dir2-end-condition"
                        [value]="extrudeDir2EndKind()"
                        (change)="setExtrudeDir2EndKind($any($event.target).value)">
                  <option value="blind">Blind</option>
                  <option value="throughAll">Through All</option>
                  <option value="upToVertex">Up to Vertex</option>
                  <option value="upToSurface">Up to Surface</option>
                  <option value="offsetFromSurface">Offset from face</option>
                </select>
              </div>
              <div class="sub-row"
                   *ngIf="extrudeDir2Enabled() && extrudeDir2EndKind() === 'blind'">
                <span class="sub-label">Distance</span>
                <app-dim-input
                  testid="extrude-dir2-distance"
                  ariaLabel="Extrude direction-2 distance"
                  unit="mm"
                  [value]="extrudeDir2Distance()"
                  [expression]="extrudeDir2DistanceExpression()"
                  [equationValues]="equationValues()"
                  (valueChange)="extrudeDir2Distance.set($event)"
                  (expressionChange)="extrudeDir2DistanceExpression.set($event)" />
              </div>
              <div class="sub-row"
                   *ngIf="extrudeDir2Enabled() && extrudeDir2EndKind() === 'upToVertex'">
                <span class="sub-label">Target vertex</span>
                <button class="btn panel-flip"
                        data-testid="extrude-dir2-pick-vertex"
                        (click)="beginVertexPick('end2')">
                  <mat-icon>{{ extrudeDir2UpToVertexId() ? 'check_circle' : 'touch_app' }}</mat-icon>
                  {{ extrudeDir2UpToVertexId() ? 'Vertex picked — click to change' : 'Pick a vertex in the viewer' }}
                </button>
              </div>
              <div class="sub-row"
                   *ngIf="extrudeDir2Enabled() && extrudeDir2EndKind() === 'upToSurface'">
                <span class="sub-label">Target face</span>
                <button class="btn panel-flip"
                        data-testid="extrude-dir2-pick-face"
                        (click)="beginFacePick('end2')">
                  <mat-icon>{{ extrudeDir2UpToFaceId() ? 'check_circle' : 'touch_app' }}</mat-icon>
                  {{ extrudeDir2UpToFaceId() ? 'Face picked — click to change' : 'Pick a face in the viewer' }}
                </button>
              </div>
              <div class="sub-row"
                   *ngIf="extrudeDir2Enabled() && extrudeDir2EndKind() === 'offsetFromSurface'">
                <span class="sub-label">Reference face</span>
                <button class="btn panel-flip"
                        data-testid="extrude-dir2-pick-offset-face"
                        (click)="beginFacePick('end2')">
                  <mat-icon>{{ extrudeDir2UpToFaceId() ? 'check_circle' : 'touch_app' }}</mat-icon>
                  {{ extrudeDir2UpToFaceId() ? 'Face picked — click to change' : 'Pick a face in the viewer' }}
                </button>
              </div>
              <div class="sub-row"
                   *ngIf="extrudeDir2Enabled() && extrudeDir2EndKind() === 'offsetFromSurface'">
                <span class="sub-label">Offset distance</span>
                <div class="input-with-flip">
                  <app-dim-input
                    testid="extrude-dir2-offset-face-distance"
                    ariaLabel="Direction-2 offset from face"
                    unit="mm"
                    [value]="extrudeDir2OffsetFromFaceDistance()"
                    [expression]="extrudeDir2OffsetFromFaceExpression()"
                    [equationValues]="equationValues()"
                    (valueChange)="setDir2OffsetFromFaceMagnitude($event)"
                    (expressionChange)="extrudeDir2OffsetFromFaceExpression.set($event)" />
                  <button class="btn flip-square"
                          data-testid="extrude-dir2-offset-face-flip"
                          [matTooltip]="extrudeDir2OffsetFromFaceFlipped() ? 'Reverse (currently against face normal)' : 'Along face normal'"
                          (click)="extrudeDir2OffsetFromFaceFlipped.set(!extrudeDir2OffsetFromFaceFlipped())">
                    <mat-icon>{{ extrudeDir2OffsetFromFaceFlipped() ? 'south' : 'north' }}</mat-icon>
                  </button>
                </div>
              </div>
            </div>

            <!-- "Merge result" — hidden for Cut Extrude (cuts always
                 target an existing body, can't seed a new one). When
                 unchecked, the additive extrude creates a NEW body
                 instead of fusing into the most-recent existing one. -->
            <div class="panel-field active" *ngIf="ctx.mode !== 'cutExtrude'">
              <div class="field-header">
                <mat-icon class="field-icon">merge_type</mat-icon>
                <span class="field-label">Merge result</span>
              </div>
              <label class="loop-toggle">
                <input type="checkbox"
                       data-testid="extrude-merge"
                       [checked]="extrudeMerge()"
                       (change)="extrudeMerge.set($any($event.target).checked)" />
                <span>{{ extrudeMerge() ? 'Fuse into existing body' : 'Create a new body' }}</span>
              </label>
            </div>

            <!-- (Target vertex / face pickers were merged into the
                 Direction 1 group above; previously they lived as their
                 own panel-fields here.) -->

            <div class="panel-field active" *ngIf="ctx.regionCount > 1">
              <div class="field-header">
                <mat-icon class="field-icon">layers</mat-icon>
                <span class="field-label">Profile regions</span>
                <span class="field-count">{{ ctx.regionCount }}</span>
              </div>
              <ul class="entity-list">
                <li class="entity-row"
                    *ngFor="let i of extrudeRegionIndices(); trackBy: trackIndex"
                    [attr.data-testid]="'extrude-region-' + i">
                  <label class="loop-toggle">
                    <input type="checkbox"
                           [checked]="isExtrudeRegionSelected(i)"
                           (change)="toggleExtrudeRegion(i)" />
                    <span>Region {{ i + 1 }}</span>
                  </label>
                </li>
              </ul>
            </div>

            <div class="panel-actions">
              <button class="btn btn-primary"
                      [disabled]="!canCommitExtrude()"
                      (click)="commitExtrudeSidebar()"
                      data-testid="extrude-apply">
                <mat-icon>check</mat-icon> OK
              </button>
              <button class="btn"
                      (click)="cancelExtrudeSidebar()"
                      data-testid="extrude-cancel">
                <mat-icon>close</mat-icon> Cancel
              </button>
            </div>
          </div>
        </ng-container>

        <!-- Revolve sidebar (parallel to extrude). Lists every line in
             the host sketch as a candidate axis, construction lines on
             top because they're the natural pick. -->
        <ng-container *ngIf="revolveSidebar() as ctx">
          <div class="tool-panel" data-testid="revolve-sidebar"
               (keyup.enter)="onRevolveSidebarEnter()">
            <h3 class="panel-title">
              <mat-icon>{{ ctx.mode === 'cutRevolve' ? 'remove_circle_outline' : '360' }}</mat-icon>
              {{ ctx.editingFeatureId
                  ? (ctx.mode === 'cutRevolve' ? 'Edit Cut Revolve' : 'Edit Revolve')
                  : (ctx.mode === 'cutRevolve' ? 'Cut Revolve' : 'Revolve') }}
            </h3>
            <p class="panel-hint">
              Pick a sketched line as the rotation axis and set the sweep angle.
            </p>

            <div class="panel-field active" [class.active]="axisPickMode()">
              <div class="field-header">
                <mat-icon class="field-icon">timeline</mat-icon>
                <span class="field-label">Axis</span>
              </div>
              <div class="field-empty" *ngIf="axisCandidates3D().length === 0">
                This sketch has no lines to use as an axis. Edit the sketch and add a line — a construction line is the natural choice.
              </div>
              <div class="axis-pick-row" *ngIf="axisCandidates3D().length > 0">
                <button class="btn panel-flip axis-pick-button"
                        data-testid="revolve-pick-axis"
                        (click)="beginAxisPick()">
                  <mat-icon>{{ revolveAxisLineId() ? 'check_circle' : 'touch_app' }}</mat-icon>
                  {{ revolveAxisLineId()
                      ? (revolveAxisLabel() ?? 'Axis picked') + ' — click to change'
                      : 'Pick an axis line in the viewer' }}
                </button>
                <button class="btn axis-clear-button"
                        *ngIf="revolveAxisLineId()"
                        data-testid="revolve-clear-axis"
                        matTooltip="Clear axis selection"
                        (click)="clearAxisPick()">
                  <mat-icon>close</mat-icon>
                </button>
              </div>
            </div>

            <div class="panel-field active">
              <div class="field-header">
                <mat-icon class="field-icon">rotate_right</mat-icon>
                <span class="field-label">Angle (deg)</span>
              </div>
              <app-dim-input
                testid="revolve-angle"
                ariaLabel="Revolve angle"
                unit="deg"
                [value]="revolveAngle()"
                [expression]="revolveAngleExpression()"
                [equationValues]="equationValues()"
                (valueChange)="revolveAngle.set($event)"
                (expressionChange)="revolveAngleExpression.set($event)" />
            </div>

            <div class="panel-field active">
              <div class="field-header">
                <mat-icon class="field-icon">swap_vert</mat-icon>
                <span class="field-label">Direction</span>
              </div>
              <button class="btn panel-flip"
                      data-testid="revolve-flip"
                      (click)="revolveFlipped.set(!revolveFlipped())">
                <mat-icon>{{ revolveFlipped() ? 'south' : 'north' }}</mat-icon>
                {{ revolveFlipped() ? 'Reverse' : 'Along axis' }}
              </button>
            </div>

            <div class="panel-field active" *ngIf="ctx.regionCount > 1">
              <div class="field-header">
                <mat-icon class="field-icon">layers</mat-icon>
                <span class="field-label">Profile regions</span>
                <span class="field-count">{{ ctx.regionCount }}</span>
              </div>
              <ul class="entity-list">
                <li class="entity-row"
                    *ngFor="let i of extrudeRegionIndices(); trackBy: trackIndex">
                  <label class="loop-toggle">
                    <input type="checkbox"
                           [checked]="isExtrudeRegionSelected(i)"
                           (change)="toggleExtrudeRegion(i)" />
                    <span>Region {{ i + 1 }}</span>
                  </label>
                </li>
              </ul>
            </div>

            <div class="panel-actions">
              <button class="btn btn-primary"
                      [disabled]="!canCommitRevolve()"
                      (click)="commitRevolveSidebar()"
                      data-testid="revolve-apply">
                <mat-icon>check</mat-icon> OK
              </button>
              <button class="btn"
                      (click)="cancelRevolveSidebar()"
                      data-testid="revolve-cancel">
                <mat-icon>close</mat-icon> Cancel
              </button>
            </div>
          </div>
        </ng-container>

        <!-- Sweep / Cut-Sweep sidebar. Profile + path are picked from the
             dropdowns below (every sketch in the doc is selectable); the
             two must be different sketches. Merge applies to additive only;
             cut sweep always subtracts. -->
        <ng-container *ngIf="sweepSidebar() as ctx">
          <div class="tool-panel" data-testid="sweep-sidebar"
               (keyup.enter)="onSweepSidebarEnter()">
            <h3 class="panel-title">
              <mat-icon>{{ ctx.mode === 'cutSweep' ? 'turn_right' : 'route' }}</mat-icon>
              {{ ctx.editingFeatureId
                  ? (ctx.mode === 'cutSweep' ? 'Edit Cut Sweep' : 'Edit Sweep')
                  : (ctx.mode === 'cutSweep' ? 'Cut Sweep' : 'Sweep') }}
            </h3>
            <p class="panel-hint">
              Pick the closed 2D profile to sweep and the path it travels along. Profile and path must be different sketches.
            </p>

            <div class="panel-field active">
              <div class="field-header">
                <mat-icon class="field-icon">crop_din</mat-icon>
                <span class="field-label">Profile sketch</span>
              </div>
              <select class="panel-input"
                      data-testid="sweep-profile"
                      [value]="sweepProfileSketchId() ?? ''"
                      (change)="sweepProfileSketchId.set($any($event.target).value || null)">
                <option value="">— pick a sketch —</option>
                <option *ngFor="let s of sweepSketchOptions(); trackBy: trackSketchId"
                        [value]="s.id"
                        [disabled]="s.id === sweepPathSketchId()">
                  {{ s.label }}
                </option>
              </select>
            </div>

            <div class="panel-field active">
              <div class="field-header">
                <mat-icon class="field-icon">timeline</mat-icon>
                <span class="field-label">Path sketch</span>
              </div>
              <select class="panel-input"
                      data-testid="sweep-path"
                      [value]="sweepPathSketchId() ?? ''"
                      (change)="sweepPathSketchId.set($any($event.target).value || null)">
                <option value="">— pick a sketch —</option>
                <option *ngFor="let s of sweepSketchOptions(); trackBy: trackSketchId"
                        [value]="s.id"
                        [disabled]="s.id === sweepProfileSketchId()">
                  {{ s.label }}
                </option>
              </select>
            </div>

            <div class="panel-field active" *ngIf="ctx.mode === 'sweep'">
              <div class="field-header">
                <mat-icon class="field-icon">merge_type</mat-icon>
                <span class="field-label">Merge result</span>
              </div>
              <label class="loop-toggle">
                <input type="checkbox"
                       data-testid="sweep-merge"
                       [checked]="sweepMerge()"
                       (change)="sweepMerge.set($any($event.target).checked)" />
                <span>Fuse with existing body</span>
              </label>
            </div>

            <div class="panel-actions">
              <button class="btn btn-primary"
                      [disabled]="!canCommitSweep()"
                      (click)="commitSweepSidebar()"
                      data-testid="sweep-apply">
                <mat-icon>check</mat-icon> OK
              </button>
              <button class="btn"
                      (click)="cancelSweepSidebar()"
                      data-testid="sweep-cancel">
                <mat-icon>close</mat-icon> Cancel
              </button>
            </div>
          </div>
        </ng-container>

        <!-- Loft sidebar — pick 2+ profile sketches in order; the solid
             blends between consecutive sections. -->
        <ng-container *ngIf="loftSidebar() as ctx">
          <div class="tool-panel" data-testid="loft-sidebar">
            <h3 class="panel-title">
              <mat-icon>layers</mat-icon>
              {{ ctx.editingFeatureId ? 'Edit Loft' : 'Loft' }}
            </h3>
            <p class="panel-hint">
              Add 2 or more profile sketches in order — the solid blends from one to the next.
            </p>

            <div class="panel-field active">
              <div class="field-header">
                <mat-icon class="field-icon">format_list_numbered</mat-icon>
                <span class="field-label">Profile sections ({{ loftSketchIds().length }})</span>
              </div>
              <div *ngFor="let sid of loftSketchIds(); let i = index; trackBy: trackLoftSection"
                   class="loop-toggle" style="justify-content: space-between;">
                <span>{{ i + 1 }}. {{ loftSketchLabel(sid) }}</span>
                <span style="display: flex; gap: 2px;">
                  <button class="icon-btn" matTooltip="Move up" [disabled]="i === 0"
                          (click)="moveLoftSection(i, -1)"><mat-icon>arrow_upward</mat-icon></button>
                  <button class="icon-btn" matTooltip="Move down" [disabled]="i === loftSketchIds().length - 1"
                          (click)="moveLoftSection(i, 1)"><mat-icon>arrow_downward</mat-icon></button>
                  <button class="icon-btn" matTooltip="Remove"
                          (click)="removeLoftSection(i)"><mat-icon>close</mat-icon></button>
                </span>
              </div>
              <select class="panel-input" data-testid="loft-add-section"
                      [value]="''"
                      (change)="addLoftSection($any($event.target).value); $any($event.target).value = ''">
                <option value="">— add a profile sketch —</option>
                <option *ngFor="let s of sweepSketchOptions(); trackBy: trackSketchId"
                        [value]="s.id" [disabled]="loftSketchIds().includes(s.id)">
                  {{ s.label }}
                </option>
              </select>
            </div>

            <div class="panel-field active">
              <div class="field-header">
                <mat-icon class="field-icon">merge_type</mat-icon>
                <span class="field-label">Merge result</span>
              </div>
              <label class="loop-toggle">
                <input type="checkbox" data-testid="loft-merge"
                       [checked]="loftMerge()"
                       (change)="loftMerge.set($any($event.target).checked)" />
                <span>Fuse with existing body</span>
              </label>
            </div>

            <div class="panel-actions">
              <button class="btn btn-primary" data-testid="loft-apply"
                      [disabled]="!canCommitLoft()"
                      (click)="commitLoftSidebar()">
                <mat-icon>check</mat-icon> OK
              </button>
              <button class="btn" data-testid="loft-cancel" (click)="cancelLoftSidebar()">
                <mat-icon>close</mat-icon> Cancel
              </button>
            </div>
          </div>
        </ng-container>

        <!-- 3D Fillet / Chamfer sidebar. Shared template: title +
             "kind" label flips by ctx.kind; the value input is
             radius for fillet and distance for chamfer. Edges are
             picked by clicking in the viewer while edgePickMode is on. -->
        <ng-container *ngIf="edgeBlendSidebar() as ctx">
          <div class="tool-panel" data-testid="edge-blend-sidebar"
               (keyup.enter)="onEdgeBlendSidebarEnter()">
            <h3 class="panel-title">
              <mat-icon>{{ ctx.kind === 'fillet' ? 'rounded_corner' : 'format_shapes' }}</mat-icon>
              {{ ctx.editingFeatureId
                  ? (ctx.kind === 'fillet' ? 'Edit Fillet' : 'Edit Chamfer')
                  : (ctx.kind === 'fillet' ? 'Fillet' : 'Chamfer') }}
            </h3>
            <p class="panel-hint">
              {{ ctx.kind === 'fillet' ? 'Round one or more edges with a constant radius.' : 'Bevel one or more edges with a constant 45° leg.' }}
            </p>
            <cad-selection-list
                label="Edges"
                headerIcon="timeline"
                testid="edge-blend"
                [rows]="edgeBlendSelectionRows()"
                [active]="true"
                (remove)="removeEdgeBlendRow($event)"
                (clear)="edgeBlendEdges.set([])">
              <button class="btn panel-flip"
                      data-testid="edge-blend-pick"
                      [class.active]="edgePickMode()"
                      (click)="beginEdgeBlendPick()">
                <mat-icon>{{ edgePickMode() ? 'touch_app' : 'add' }}</mat-icon>
                {{ edgePickMode() ? 'Click edges in the viewer (click again here to stop)' : 'Pick edges from viewer' }}
              </button>
              <button class="btn panel-flip"
                      data-testid="edge-blend-tangent-propagation"
                      [class.active]="edgeBlendTangentPropagation()"
                      matTooltip="When on, picking one edge auto-includes every tangent-continuous neighbor (e.g. all 4 arcs of a hole)."
                      (click)="edgeBlendTangentPropagation.set(!edgeBlendTangentPropagation())">
                <mat-icon>{{ edgeBlendTangentPropagation() ? 'check_box' : 'check_box_outline_blank' }}</mat-icon>
                Tangent propagation
              </button>
            </cad-selection-list>
            <div class="panel-field active" *ngIf="ctx.kind === 'chamfer'">
              <div class="field-header">
                <mat-icon class="field-icon">tune</mat-icon>
                <span class="field-label">Mode</span>
              </div>
              <select class="panel-input"
                      data-testid="chamfer-mode-select"
                      aria-label="Chamfer mode"
                      [value]="edgeBlendChamferMode()"
                      (change)="edgeBlendChamferMode.set($any($event.target).value)">
                <option value="equal" data-testid="chamfer-mode-equal">Equal distance</option>
                <option value="twoDistance" data-testid="chamfer-mode-two-distance">Two distances</option>
                <option value="distanceAngle" data-testid="chamfer-mode-distance-angle">Distance and angle</option>
              </select>
            </div>
            <div class="panel-field active">
              <div class="field-header">
                <mat-icon class="field-icon">straighten</mat-icon>
                <span class="field-label">{{
                  ctx.kind === 'fillet' ? 'Radius'
                    : (edgeBlendChamferMode() === 'twoDistance' ? 'Distance 1'
                    : 'Distance')
                }}</span>
              </div>
              <app-dim-input
                testid="edge-blend-value"
                [ariaLabel]="ctx.kind === 'fillet' ? 'Fillet radius' : 'Chamfer distance'"
                unit="mm"
                [value]="edgeBlendValue()"
                [expression]="edgeBlendValueExpression()"
                [equationValues]="equationValues()"
                (valueChange)="edgeBlendValue.set($event)"
                (expressionChange)="edgeBlendValueExpression.set($event)" />
            </div>
            <div class="panel-field active"
                 *ngIf="ctx.kind === 'chamfer' && edgeBlendChamferMode() === 'twoDistance'">
              <div class="field-header">
                <mat-icon class="field-icon">straighten</mat-icon>
                <span class="field-label">Distance 2</span>
              </div>
              <app-dim-input
                testid="edge-blend-distance2"
                ariaLabel="Chamfer secondary distance"
                unit="mm"
                [value]="edgeBlendDistance2()"
                [expression]="edgeBlendDistance2Expression()"
                [equationValues]="equationValues()"
                (valueChange)="edgeBlendDistance2.set($event)"
                (expressionChange)="edgeBlendDistance2Expression.set($event)" />
            </div>
            <div class="panel-field active"
                 *ngIf="ctx.kind === 'chamfer' && edgeBlendChamferMode() === 'distanceAngle'">
              <div class="field-header">
                <mat-icon class="field-icon">architecture</mat-icon>
                <span class="field-label">Angle</span>
              </div>
              <app-dim-input
                testid="edge-blend-angle"
                ariaLabel="Chamfer angle from reference face"
                unit="deg"
                [value]="edgeBlendAngle()"
                [expression]="edgeBlendAngleExpression()"
                [equationValues]="equationValues()"
                (valueChange)="edgeBlendAngle.set($event)"
                (expressionChange)="edgeBlendAngleExpression.set($event)" />
            </div>
            <div class="panel-actions">
              <button class="btn btn-primary"
                      [disabled]="!canCommitEdgeBlend()"
                      (click)="commitEdgeBlendSidebar()"
                      data-testid="edge-blend-apply">
                <mat-icon>check</mat-icon> OK
              </button>
              <button class="btn"
                      (click)="cancelEdgeBlendSidebar()"
                      data-testid="edge-blend-cancel">
                <mat-icon>close</mat-icon> Cancel
              </button>
            </div>
          </div>
        </ng-container>

        <!-- Measure sidebar — distance / angle / length readouts for
             vertex / edge / face picks. REQ 652–654. -->
        <!-- Datum Plane sidebar — REQ 657. Method dropdown switches
             between eight SolidWorks-style construction methods; the
             rest of the sidebar (picks + scalars) shows the slots the
             current method needs. Pick values come from clicking
             entities in the viewer; the click handlers route via the
             addDatumPlane* helpers. -->
        <ng-container *ngIf="datumPlaneSidebar() as dpCtx">
          <div class="tool-panel" data-testid="datum-plane-sidebar">
            <h3 class="panel-title">
              <mat-icon>crop_din</mat-icon>
              {{ dpCtx.editingFeatureId ? 'Edit Plane' : 'New Plane' }}
            </h3>
            <p class="panel-hint">Pick the references the chosen method needs. Click again to deselect.</p>
            <div class="panel-field active">
              <div class="field-header">
                <mat-icon class="field-icon">tune</mat-icon>
                <span class="field-label">Method</span>
              </div>
              <select class="panel-input"
                      data-testid="datum-plane-method"
                      aria-label="Datum plane construction method"
                      [value]="dpCtx.method"
                      (change)="setDatumPlaneMethod($any($event.target).value)">
                <option value="offset">Offset from plane/face</option>
                <option value="parallelThroughPoint">Parallel through point</option>
                <option value="angleThroughEdge">At angle through edge</option>
                <option value="threePoints">Through three points</option>
                <option value="midPlane">Mid-plane between two</option>
                <option value="lineAndPerpFace">Through edge, perpendicular to face</option>
                <option value="pointAndPerpEdge">Through point, perpendicular to edge</option>
                <option value="tangentCylinder">Tangent to cylinder</option>
              </select>
            </div>

            <!-- Reference A: plane/face. Used by offset, parallel,
                 angle, midPlane (A), lineAndPerpFace, tangentCylinder. -->
            <cad-selection-list
                *ngIf="['offset','parallelThroughPoint','angleThroughEdge','midPlane','lineAndPerpFace','tangentCylinder'].includes(dpCtx.method)"
                [label]="dpCtx.method === 'tangentCylinder' ? 'Reference plane' : (dpCtx.method === 'midPlane' ? 'Plane / face A' : 'Reference plane / face')"
                headerIcon="crop_din"
                testid="datum-plane-refA"
                [rows]="datumPlaneRefARows()"
                [active]="true"
                [emptyHint]="'Click a datum plane or flat face in the viewer.'"
                (remove)="removeDatumPlaneRow($event)">
            </cad-selection-list>

            <!-- Reference B: midPlane only. -->
            <cad-selection-list
                *ngIf="dpCtx.method === 'midPlane'"
                label="Plane / face B"
                headerIcon="crop_din"
                testid="datum-plane-refB"
                [rows]="datumPlaneRefBRows()"
                [active]="true"
                [emptyHint]="'Click a second datum plane or flat face.'"
                (remove)="removeDatumPlaneRow($event)">
            </cad-selection-list>

            <!-- Cylindrical face: tangentCylinder. -->
            <cad-selection-list
                *ngIf="dpCtx.method === 'tangentCylinder'"
                label="Cylindrical face"
                headerIcon="rotate_right"
                testid="datum-plane-cylinder"
                [rows]="datumPlaneCylinderRows()"
                [active]="true"
                [emptyHint]="'Click a cylindrical face.'"
                (remove)="removeDatumPlaneRow($event)">
            </cad-selection-list>

            <!-- Edge: angleThroughEdge, lineAndPerpFace, pointAndPerpEdge. -->
            <cad-selection-list
                *ngIf="['angleThroughEdge','lineAndPerpFace','pointAndPerpEdge'].includes(dpCtx.method)"
                label="Edge"
                headerIcon="timeline"
                testid="datum-plane-edge"
                [rows]="datumPlaneEdgeRows()"
                [active]="true"
                [emptyHint]="'Click an edge.'"
                (remove)="removeDatumPlaneRow($event)">
            </cad-selection-list>

            <!-- Vertices: threePoints (3), parallelThroughPoint (1),
                 pointAndPerpEdge (1). -->
            <cad-selection-list
                *ngIf="['threePoints','parallelThroughPoint','pointAndPerpEdge'].includes(dpCtx.method)"
                [label]="dpCtx.method === 'threePoints' ? 'Vertices (3 needed)' : 'Vertex'"
                headerIcon="place"
                testid="datum-plane-vertices"
                [rows]="datumPlaneVertexRows()"
                [active]="true"
                [emptyHint]="'Click a vertex.'"
                (remove)="removeDatumPlaneRow($event)">
            </cad-selection-list>

            <!-- Distance: offset only. -->
            <div class="panel-field active" *ngIf="dpCtx.method === 'offset'">
              <div class="field-header">
                <mat-icon class="field-icon">straighten</mat-icon>
                <span class="field-label">Distance</span>
              </div>
              <app-dim-input
                testid="datum-plane-distance"
                ariaLabel="Plane offset distance"
                unit="mm"
                [value]="datumPlaneDistance()"
                [expression]="datumPlaneDistanceExpression()"
                [equationValues]="equationValues()"
                (valueChange)="datumPlaneDistance.set($event)"
                (expressionChange)="datumPlaneDistanceExpression.set($event)" />
              <button class="btn panel-flip"
                      type="button"
                      data-testid="datum-plane-flip"
                      [class.active]="datumPlaneFlipped()"
                      (click)="datumPlaneFlipped.set(!datumPlaneFlipped())">
                <mat-icon>swap_vert</mat-icon>
                {{ datumPlaneFlipped() ? 'Flipped' : 'Flip direction' }}
              </button>
            </div>

            <!-- Flip side: tangentCylinder only — switches which side
                 of the cylinder the plane is tangent to. -->
            <div class="panel-field active" *ngIf="dpCtx.method === 'tangentCylinder'">
              <div class="field-header">
                <mat-icon class="field-icon">swap_horiz</mat-icon>
                <span class="field-label">Side</span>
              </div>
              <button class="btn panel-flip"
                      type="button"
                      data-testid="datum-plane-tangent-flip"
                      [class.active]="datumPlaneFlipped()"
                      (click)="datumPlaneFlipped.set(!datumPlaneFlipped())">
                <mat-icon>swap_horiz</mat-icon>
                {{ datumPlaneFlipped() ? 'Opposite side' : 'Near side' }}
              </button>
            </div>

            <!-- Angle: angleThroughEdge only. -->
            <div class="panel-field active" *ngIf="dpCtx.method === 'angleThroughEdge'">
              <div class="field-header">
                <mat-icon class="field-icon">architecture</mat-icon>
                <span class="field-label">Angle</span>
              </div>
              <app-dim-input
                testid="datum-plane-angle"
                ariaLabel="Rotation angle"
                unit="deg"
                [value]="datumPlaneAngle()"
                [expression]="datumPlaneAngleExpression()"
                [equationValues]="equationValues()"
                (valueChange)="datumPlaneAngle.set($event)"
                (expressionChange)="datumPlaneAngleExpression.set($event)" />
            </div>

            <div class="panel-actions">
              <button class="btn btn-primary"
                      [disabled]="!canCommitDatumPlane()"
                      (click)="commitDatumPlaneSidebar()"
                      data-testid="datum-plane-apply">
                <mat-icon>check</mat-icon> OK
              </button>
              <button class="btn"
                      (click)="cancelDatumPlaneSidebar()"
                      data-testid="datum-plane-cancel">
                <mat-icon>close</mat-icon> Cancel
              </button>
            </div>
          </div>
        </ng-container>

        <!-- Datum Axis sidebar (REQ 660). Method dropdown swaps the
             picker rows; pick clicks from the viewer route here via
             onVertexPicked / onEdgePicked / onFacePicked. -->
        <ng-container *ngIf="datumAxisSidebar() as daCtx">
          <div class="tool-panel" data-testid="datum-axis-sidebar">
            <h3 class="panel-title">
              <mat-icon>show_chart</mat-icon>
              {{ daCtx.editingFeatureId ? 'Edit Axis' : 'New Axis' }}
            </h3>
            <p class="panel-hint">Define a reference axis from existing geometry.</p>
            <div class="panel-field active">
              <div class="field-header">
                <mat-icon class="field-icon">tune</mat-icon>
                <span class="field-label">Method</span>
              </div>
              <select class="panel-input"
                      data-testid="datum-axis-method-select"
                      aria-label="Axis construction method"
                      [value]="daCtx.method"
                      (change)="setDatumAxisMethod($any($event.target).value)">
                <option value="twoPoints">Two Points</option>
                <option value="alongEdge">Along Edge</option>
                <option value="twoPlanesIntersection">Intersection of Two Planes</option>
                <option value="cylindricalFaceAxis">Cylindrical Face Axis</option>
                <option value="pointAndPerpFace">Point + Perpendicular Face</option>
              </select>
            </div>

            <!-- Two Points: two vertex picks. -->
            <ng-container *ngIf="daCtx.method === 'twoPoints'">
              <cad-selection-list label="Point A" headerIcon="place"
                  testid="datum-axis-vtx-a"
                  [rows]="datumAxisVertexARows()"
                  [active]="true"
                  (remove)="datumAxisVertexA.set(null)">
              </cad-selection-list>
              <cad-selection-list label="Point B" headerIcon="place"
                  testid="datum-axis-vtx-b"
                  [rows]="datumAxisVertexBRows()"
                  [active]="true"
                  (remove)="datumAxisVertexB.set(null)">
              </cad-selection-list>
            </ng-container>

            <!-- Along Edge: one edge pick (straight or circular). -->
            <ng-container *ngIf="daCtx.method === 'alongEdge'">
              <cad-selection-list label="Edge" headerIcon="timeline"
                  testid="datum-axis-edge"
                  [rows]="datumAxisEdgeRows()"
                  [active]="true"
                  (remove)="datumAxisEdge.set(null)">
              </cad-selection-list>
            </ng-container>

            <!-- Two-Planes Intersection: two plane picks. -->
            <ng-container *ngIf="daCtx.method === 'twoPlanesIntersection'">
              <cad-selection-list label="Plane A" headerIcon="crop_din"
                  testid="datum-axis-plane-a"
                  [rows]="datumAxisPlaneARows()"
                  [active]="true"
                  (remove)="datumAxisPlaneA.set(null)">
              </cad-selection-list>
              <cad-selection-list label="Plane B" headerIcon="crop_din"
                  testid="datum-axis-plane-b"
                  [rows]="datumAxisPlaneBRows()"
                  [active]="true"
                  (remove)="datumAxisPlaneB.set(null)">
              </cad-selection-list>
            </ng-container>

            <!-- Cylindrical Face Axis: one cylindrical face pick. -->
            <ng-container *ngIf="daCtx.method === 'cylindricalFaceAxis'">
              <cad-selection-list label="Cylindrical face" headerIcon="rotate_right"
                  testid="datum-axis-cyl"
                  [rows]="datumAxisCylinderRows()"
                  [active]="true"
                  (remove)="datumAxisCylinderFaceId.set(null); datumAxisCylinderFallback.set(null)">
              </cad-selection-list>
            </ng-container>

            <!-- Point + Perp Face: vertex + plane picks. -->
            <ng-container *ngIf="daCtx.method === 'pointAndPerpFace'">
              <cad-selection-list label="Point" headerIcon="place"
                  testid="datum-axis-vtx-a"
                  [rows]="datumAxisVertexARows()"
                  [active]="true"
                  (remove)="datumAxisVertexA.set(null)">
              </cad-selection-list>
              <cad-selection-list label="Perpendicular face" headerIcon="crop_din"
                  testid="datum-axis-plane-a"
                  [rows]="datumAxisPlaneARows()"
                  [active]="true"
                  (remove)="datumAxisPlaneA.set(null)">
              </cad-selection-list>
            </ng-container>

            <div class="panel-actions">
              <button class="btn btn-primary"
                      [disabled]="!canCommitDatumAxis()"
                      (click)="commitDatumAxisSidebar()"
                      data-testid="datum-axis-apply">
                <mat-icon>check</mat-icon> OK
              </button>
              <button class="btn"
                      (click)="cancelDatumAxisSidebar()"
                      data-testid="datum-axis-cancel">
                <mat-icon>close</mat-icon> Cancel
              </button>
            </div>
          </div>
        </ng-container>

        <!-- Datum Point sidebar (REQ 661). -->
        <ng-container *ngIf="datumPointSidebar() as dpCtx2">
          <div class="tool-panel" data-testid="datum-point-sidebar">
            <h3 class="panel-title">
              <mat-icon>place</mat-icon>
              {{ dpCtx2.editingFeatureId ? 'Edit Point' : 'New Point' }}
            </h3>
            <p class="panel-hint">Define a reference point from existing geometry.</p>
            <div class="panel-field active">
              <div class="field-header">
                <mat-icon class="field-icon">tune</mat-icon>
                <span class="field-label">Method</span>
              </div>
              <select class="panel-input"
                      data-testid="datum-point-method-select"
                      aria-label="Point construction method"
                      [value]="dpCtx2.method"
                      (change)="setDatumPointMethod($any($event.target).value)">
                <option value="onVertex">On Vertex</option>
                <option value="centerOfFace">Center of Face</option>
                <option value="centerOfCircularEdge">Center of Circular Edge</option>
                <option value="centerOfMass">Center of Mass (Body)</option>
                <option value="alongEdge">Along Edge (parametric)</option>
              </select>
            </div>

            <ng-container *ngIf="dpCtx2.method === 'onVertex'">
              <cad-selection-list label="Vertex" headerIcon="place"
                  testid="datum-point-vtx"
                  [rows]="datumPointVertexRows()"
                  [active]="true"
                  (remove)="datumPointVertex.set(null)">
              </cad-selection-list>
            </ng-container>

            <ng-container *ngIf="dpCtx2.method === 'centerOfFace'">
              <cad-selection-list label="Face" headerIcon="crop_square"
                  testid="datum-point-face"
                  [rows]="datumPointFaceRows()"
                  [active]="true"
                  (remove)="datumPointFaceId.set(null); datumPointFaceFallback.set(null)">
              </cad-selection-list>
            </ng-container>

            <ng-container *ngIf="dpCtx2.method === 'centerOfCircularEdge'">
              <cad-selection-list label="Circular edge" headerIcon="timeline"
                  testid="datum-point-edge"
                  [rows]="datumPointEdgeRows()"
                  [active]="true"
                  (remove)="datumPointEdge.set(null)">
              </cad-selection-list>
            </ng-container>

            <ng-container *ngIf="dpCtx2.method === 'centerOfMass'">
              <cad-selection-list label="Body" headerIcon="view_in_ar"
                  testid="datum-point-body"
                  [rows]="datumPointBodyRows()"
                  [active]="true"
                  (remove)="datumPointBodyId.set(null); datumPointBodyFallback.set(null)">
                <!-- Body picking: click a face to pick its owning body. -->
                <button class="btn panel-flip"
                        [class.active]="facePickMode()"
                        (click)="facePickMode.set(!facePickMode())">
                  <mat-icon>{{ facePickMode() ? 'touch_app' : 'add' }}</mat-icon>
                  {{ facePickMode() ? 'Click a face to pick its body' : 'Pick body via face' }}
                </button>
              </cad-selection-list>
            </ng-container>

            <ng-container *ngIf="dpCtx2.method === 'alongEdge'">
              <cad-selection-list label="Edge" headerIcon="timeline"
                  testid="datum-point-edge"
                  [rows]="datumPointEdgeRows()"
                  [active]="true"
                  (remove)="datumPointEdge.set(null)">
              </cad-selection-list>
              <div class="panel-field active">
                <div class="field-header">
                  <mat-icon class="field-icon">linear_scale</mat-icon>
                  <span class="field-label">Position (0 = start, 1 = end)</span>
                </div>
                <input class="panel-input" type="number" min="0" max="1" step="0.05"
                       data-testid="datum-point-t"
                       aria-label="Parametric position along edge"
                       [value]="datumPointT()"
                       (input)="datumPointT.set(_clamp01(+$any($event.target).value))" />
              </div>
            </ng-container>

            <div class="panel-actions">
              <button class="btn btn-primary"
                      [disabled]="!canCommitDatumPoint()"
                      (click)="commitDatumPointSidebar()"
                      data-testid="datum-point-apply">
                <mat-icon>check</mat-icon> OK
              </button>
              <button class="btn"
                      (click)="cancelDatumPointSidebar()"
                      data-testid="datum-point-cancel">
                <mat-icon>close</mat-icon> Cancel
              </button>
            </div>
          </div>
        </ng-container>

        <!-- Shell sidebar (REQ 659). Face picker + thickness +
             direction (inward / outward). Per-face thickness overrides
             are wired in the data model but the kernel currently uses
             a single thickness for every face — the per-face fields
             stay hidden until the FFI extension lands. -->
        <ng-container *ngIf="shellSidebar() as sCtx">
          <div class="tool-panel" data-testid="shell-sidebar">
            <h3 class="panel-title">
              <mat-icon>view_in_ar</mat-icon>
              {{ sCtx.editingFeatureId ? 'Edit Shell' : 'Shell' }}
            </h3>
            <p class="panel-hint">Hollow the body by removing one or more faces and offsetting the remainder.</p>

            <cad-selection-list
                label="Faces to remove"
                headerIcon="layers_clear"
                testid="shell-faces"
                [rows]="shellFaceRows()"
                [active]="true"
                (remove)="removeShellFace($event)"
                (clear)="shellFaces.set([])">
              <button class="btn panel-flip"
                      data-testid="shell-face-pick"
                      [class.active]="facePickMode()"
                      (click)="facePickMode.set(!facePickMode())">
                <mat-icon>{{ facePickMode() ? 'touch_app' : 'add' }}</mat-icon>
                {{ facePickMode() ? 'Click faces in the viewer (click here to stop)' : 'Pick faces from viewer' }}
              </button>
            </cad-selection-list>

            <div class="panel-field active">
              <div class="field-header">
                <mat-icon class="field-icon">straighten</mat-icon>
                <span class="field-label">Wall thickness</span>
              </div>
              <app-dim-input
                testid="shell-thickness"
                ariaLabel="Wall thickness"
                unit="mm"
                [value]="shellThickness()"
                [expression]="shellThicknessExpression()"
                [equationValues]="equationValues()"
                (valueChange)="shellThickness.set($event)"
                (expressionChange)="shellThicknessExpression.set($event)" />
            </div>

            <div class="panel-field active">
              <div class="field-header">
                <mat-icon class="field-icon">tune</mat-icon>
                <span class="field-label">Direction</span>
              </div>
              <select class="panel-input"
                      data-testid="shell-direction"
                      aria-label="Shell direction"
                      [value]="shellDirection()"
                      (change)="shellDirection.set($any($event.target).value)">
                <option value="inward">Inward (hollow the body)</option>
                <option value="outward">Outward (thicken outside)</option>
              </select>
            </div>

            <div class="panel-actions">
              <button class="btn btn-primary"
                      [disabled]="!canCommitShell()"
                      (click)="commitShellSidebar()"
                      data-testid="shell-apply">
                <mat-icon>check</mat-icon> OK
              </button>
              <button class="btn"
                      (click)="cancelShellSidebar()"
                      data-testid="shell-cancel">
                <mat-icon>close</mat-icon> Cancel
              </button>
            </div>
          </div>
        </ng-container>

        <!-- Combine sidebar (REQ 662). Operation dropdown +
             target body + tool body picker. Click a face in the
             viewer to pick its owning body; the active slot is
             chosen by the two "Pick target / Pick tools" buttons. -->
        <ng-container *ngIf="combineSidebar()">
          <div class="tool-panel" data-testid="combine-sidebar">
            <h3 class="panel-title">
              <mat-icon>merge_type</mat-icon>
              {{ combineSidebar()?.editingFeatureId ? 'Edit Combine' : 'Combine' }}
            </h3>
            <p class="panel-hint">Boolean operation between existing bodies. The target body keeps its id; tool bodies are consumed.</p>

            <div class="panel-field active">
              <div class="field-header">
                <mat-icon class="field-icon">tune</mat-icon>
                <span class="field-label">Operation</span>
              </div>
              <select class="panel-input"
                      data-testid="combine-op-select"
                      aria-label="Combine operation"
                      [value]="combineOperation()"
                      (change)="combineOperation.set($any($event.target).value)">
                <option value="add">Add (Target ∪ Tools)</option>
                <option value="subtract">Subtract (Target − Tools)</option>
                <option value="common">Common (Target ∩ Tools)</option>
              </select>
            </div>

            <cad-selection-list
                label="Target body"
                headerIcon="view_in_ar"
                testid="combine-target"
                [rows]="combineTargetRows()"
                [active]="true"
                (remove)="combineTargetBodyId.set(null)">
              <button class="btn panel-flip"
                      data-testid="combine-pick-target"
                      [class.active]="combinePickTarget() === 'target' && facePickMode()"
                      (click)="setCombinePickTarget('target')">
                <mat-icon>{{ combinePickTarget() === 'target' && facePickMode() ? 'touch_app' : 'add' }}</mat-icon>
                Pick target via face
              </button>
            </cad-selection-list>

            <cad-selection-list
                label="Tool bodies"
                headerIcon="view_in_ar"
                testid="combine-tools"
                [rows]="combineToolRows()"
                [active]="true"
                (remove)="removeCombineToolRow($event)"
                (clear)="combineToolBodyIds.set([])">
              <button class="btn panel-flip"
                      data-testid="combine-pick-tool"
                      [class.active]="combinePickTarget() === 'tool' && facePickMode()"
                      (click)="setCombinePickTarget('tool')">
                <mat-icon>{{ combinePickTarget() === 'tool' && facePickMode() ? 'touch_app' : 'add' }}</mat-icon>
                Pick tools via face
              </button>
            </cad-selection-list>

            <div class="panel-actions">
              <button class="btn btn-primary"
                      [disabled]="!canCommitCombine()"
                      (click)="commitCombineSidebar()"
                      data-testid="combine-apply">
                <mat-icon>check</mat-icon> OK
              </button>
              <button class="btn"
                      (click)="cancelCombineSidebar()"
                      data-testid="combine-cancel">
                <mat-icon>close</mat-icon> Cancel
              </button>
            </div>
          </div>
        </ng-container>

        <!-- Hole Wizard sidebar — REQ 663. Click faces in the viewer
             to drop holes at the click point; the face normal becomes
             the hole axis. Numeric fields show the spec value as the
             placeholder; entering a number overrides it. -->
        <ng-container *ngIf="holeSidebar() as hCtx">
          <div class="tool-panel" data-testid="hole-sidebar">
            <h3 class="panel-title">
              <mat-icon>radio_button_unchecked</mat-icon>
              {{ hCtx.editingFeatureId ? 'Edit Hole' : 'Hole Wizard' }}
            </h3>
            <p class="panel-hint">Click existing vertices to snap a hole to that point, or click anywhere on a face to drop a hole at the click point. The face under the cursor sets the hole axis (into the body).</p>

            <div class="panel-field active">
              <div class="field-header">
                <mat-icon class="field-icon">category</mat-icon>
                <span class="field-label">Hole type</span>
              </div>
              <select class="panel-input"
                      data-testid="hole-type-select"
                      aria-label="Hole type"
                      [value]="holeType()"
                      (change)="holeType.set($any($event.target).value)">
                <option value="drill">Simple Drill</option>
                <option value="counterbore">Counterbore</option>
                <option value="countersink">Countersink</option>
                <option value="tapped">Tapped</option>
              </select>
            </div>

            <div class="panel-field">
              <div class="field-header">
                <mat-icon class="field-icon">straighten</mat-icon>
                <span class="field-label">Standard</span>
              </div>
              <select class="panel-input"
                      data-testid="hole-standard-select"
                      aria-label="Hole standard"
                      [value]="holeStandard()"
                      (change)="onHoleStandardChange($any($event.target).value)">
                <option value="iso">ISO metric</option>
                <option value="ansi">ANSI inch</option>
              </select>
            </div>

            <div class="panel-field">
              <div class="field-header">
                <mat-icon class="field-icon">tag</mat-icon>
                <span class="field-label">Size</span>
              </div>
              <select class="panel-input"
                      data-testid="hole-size-select"
                      aria-label="Hole size"
                      [value]="holeSize()"
                      (change)="holeSize.set($any($event.target).value)">
                <option *ngFor="let opt of holeSizeOptions()" [value]="opt.key">{{ opt.label }}</option>
              </select>
            </div>

            <div class="panel-field">
              <div class="field-header">
                <mat-icon class="field-icon">vertical_align_bottom</mat-icon>
                <span class="field-label">End condition</span>
              </div>
              <select class="panel-input"
                      data-testid="hole-end-select"
                      aria-label="Hole end condition"
                      [value]="holeEndKind()"
                      (change)="holeEndKind.set($any($event.target).value)">
                <option value="throughAll">Through all</option>
                <option value="blind">Blind</option>
              </select>
              <input *ngIf="holeEndKind() === 'blind'"
                     type="number" min="0.01" step="0.5"
                     class="panel-input"
                     data-testid="hole-depth-input"
                     aria-label="Blind depth (mm)"
                     [value]="holeDepth()"
                     (input)="holeDepth.set(+$any($event.target).value)" />
            </div>

            <!-- Per-dimension overrides. Empty input = use spec value
                 (shown as placeholder). Number = override. -->
            <div class="panel-field">
              <div class="field-header">
                <mat-icon class="field-icon">tune</mat-icon>
                <span class="field-label">Dimension overrides (mm)</span>
              </div>
              <label class="hole-override-row">
                <span>Drill Ø</span>
                <input type="number" min="0.01" step="0.1"
                       class="panel-input"
                       data-testid="hole-drill-d-override"
                       [placeholder]="holeSpecDrillDia().toFixed(2)"
                       [value]="holeDrillDiaOverride() ?? ''"
                       (input)="setOverride('drillDia', $any($event.target).value)" />
              </label>
              <ng-container *ngIf="holeType() === 'counterbore'">
                <label class="hole-override-row">
                  <span>CBORE Ø</span>
                  <input type="number" min="0.01" step="0.1"
                         class="panel-input"
                         data-testid="hole-cbore-d-override"
                         [placeholder]="holeSpec_().counterboreDiameter.toFixed(2)"
                         [value]="holeCboreDiaOverride() ?? ''"
                         (input)="setOverride('cboreDia', $any($event.target).value)" />
                </label>
                <label class="hole-override-row">
                  <span>CBORE depth</span>
                  <input type="number" min="0.01" step="0.1"
                         class="panel-input"
                         data-testid="hole-cbore-depth-override"
                         [placeholder]="holeSpec_().counterboreDepth.toFixed(2)"
                         [value]="holeCboreDepthOverride() ?? ''"
                         (input)="setOverride('cboreDepth', $any($event.target).value)" />
                </label>
              </ng-container>
              <ng-container *ngIf="holeType() === 'countersink'">
                <label class="hole-override-row">
                  <span>CSK Ø</span>
                  <input type="number" min="0.01" step="0.1"
                         class="panel-input"
                         data-testid="hole-csk-d-override"
                         [placeholder]="holeSpec_().countersinkDiameter.toFixed(2)"
                         [value]="holeCskDiaOverride() ?? ''"
                         (input)="setOverride('cskDia', $any($event.target).value)" />
                </label>
                <label class="hole-override-row">
                  <span>CSK angle°</span>
                  <input type="number" min="10" max="180" step="1"
                         class="panel-input"
                         data-testid="hole-csk-angle-override"
                         [placeholder]="holeSpec_().countersinkAngleDeg.toString()"
                         [value]="holeCskAngleOverride() ?? ''"
                         (input)="setOverride('cskAngle', $any($event.target).value)" />
                </label>
              </ng-container>
            </div>

            <cad-selection-list
                label="Placements"
                headerIcon="touch_app"
                testid="hole-placements"
                [rows]="holePlacementRows()"
                [active]="true"
                (remove)="removeHolePlacementRow($event)"
                (clear)="holePlacements.set([])">
              <p class="panel-hint" style="margin: 4px 0 0;">Click vertices or faces in the viewer to add hole centers.</p>
            </cad-selection-list>

            <div class="panel-field">
              <label class="panel-checkbox">
                <input type="checkbox"
                       data-testid="hole-flipped"
                       [checked]="holeFlipped()"
                       (change)="holeFlipped.set($any($event.target).checked)" />
                <span>Flip axis (point out of body)</span>
              </label>
            </div>

            <div class="panel-actions">
              <button class="btn btn-primary"
                      [disabled]="!canCommitHole()"
                      (click)="commitHoleSidebar()"
                      data-testid="hole-apply">
                <mat-icon>check</mat-icon> OK
              </button>
              <button class="btn"
                      (click)="cancelHoleSidebar()"
                      data-testid="hole-cancel">
                <mat-icon>close</mat-icon> Cancel
              </button>
            </div>
          </div>
        </ng-container>

        <!-- Mirror Body sidebar — REQ 666. Reflects selected bodies
             across a plane. Plane picker mirrors the Pattern Mirror
             plane picker; body picker mirrors the Combine pattern. -->
        <ng-container *ngIf="mirrorBodySidebar() as mCtx">
          <div class="tool-panel" data-testid="mirror-body-sidebar">
            <h3 class="panel-title">
              <mat-icon>flip</mat-icon>
              {{ mCtx.editingFeatureId ? 'Edit Mirror Body' : 'Mirror Body' }}
            </h3>
            <p class="panel-hint">Reflects every selected body across the mirror plane.</p>

            <cad-selection-list
                label="Mirror plane"
                headerIcon="filter_none"
                testid="mirror-body-plane"
                [rows]="mirrorBodyPlaneRows()"
                [active]="true"
                (remove)="mirrorBodyPlaneRef.set(null)">
              <button class="btn panel-flip"
                      data-testid="mirror-body-plane-pick"
                      [class.active]="mirrorBodyPickTarget() === 'plane' && facePickMode()"
                      (click)="setMirrorBodyPickTarget('plane')">
                <mat-icon>{{ mirrorBodyPickTarget() === 'plane' && facePickMode() ? 'touch_app' : 'add' }}</mat-icon>
                Pick face or datum
              </button>
              <div class="panel-field active" style="padding: 4px 0;">
                <select class="panel-input"
                        data-testid="mirror-body-plane-datum-select"
                        aria-label="Use an origin plane"
                        [value]="mirrorBodyPlaneDatumOption()"
                        (change)="setMirrorBodyPlaneFromDatum($any($event.target).value)">
                  <option value="">— or pick an origin plane —</option>
                  <option value="xy_plane">Top (XY)</option>
                  <option value="xz_plane">Front (XZ)</option>
                  <option value="yz_plane">Right (YZ)</option>
                </select>
              </div>
            </cad-selection-list>

            <cad-selection-list
                label="Bodies to mirror"
                headerIcon="view_in_ar"
                testid="mirror-body-bodies"
                [rows]="mirrorBodyRows()"
                [active]="true"
                (remove)="removeMirrorBodyRow($event)"
                (clear)="mirrorBodyBodyIds.set([])">
              <button class="btn panel-flip"
                      data-testid="mirror-body-pick-body"
                      [class.active]="mirrorBodyPickTarget() === 'body' && facePickMode()"
                      (click)="setMirrorBodyPickTarget('body')">
                <mat-icon>{{ mirrorBodyPickTarget() === 'body' && facePickMode() ? 'touch_app' : 'add' }}</mat-icon>
                Pick body via face
              </button>
            </cad-selection-list>

            <div class="panel-field">
              <label class="panel-checkbox">
                <input type="checkbox"
                       data-testid="mirror-body-keep-originals"
                       [checked]="mirrorBodyKeepOriginals()"
                       (change)="mirrorBodyKeepOriginals.set($any($event.target).checked)" />
                <span>Keep originals (uncheck to mirror in place)</span>
              </label>
            </div>

            <div class="panel-actions">
              <button class="btn btn-primary"
                      [disabled]="!canCommitMirrorBody()"
                      (click)="commitMirrorBodySidebar()"
                      data-testid="mirror-body-apply">
                <mat-icon>check</mat-icon> OK
              </button>
              <button class="btn"
                      (click)="cancelMirrorBodySidebar()"
                      data-testid="mirror-body-cancel">
                <mat-icon>close</mat-icon> Cancel
              </button>
            </div>
          </div>
        </ng-container>

        <!-- Move/Copy Body sidebar — REQ 667. Translate (XYZ) and/or
             rotate (axis + angle) the selected bodies; toggle Copy
             to keep originals + add transformed copies. -->
        <ng-container *ngIf="moveCopyBodySidebar() as mcCtx">
          <div class="tool-panel" data-testid="move-copy-body-sidebar">
            <h3 class="panel-title">
              <mat-icon>open_with</mat-icon>
              {{ mcCtx.editingFeatureId ? 'Edit Move/Copy' : 'Move/Copy Body' }}
            </h3>
            <p class="panel-hint">Translate is applied before rotation about the rotation-axis origin.</p>

            <cad-selection-list
                label="Bodies"
                headerIcon="view_in_ar"
                testid="move-copy-bodies"
                [rows]="moveCopyBodyRows()"
                [active]="true"
                (remove)="removeMoveCopyBodyRow($event)"
                (clear)="moveCopyBodyIds.set([])">
              <button class="btn panel-flip"
                      data-testid="move-copy-pick-body"
                      [class.active]="facePickMode() && !!moveCopyBodySidebar()"
                      (click)="facePickMode.set(!facePickMode())">
                <mat-icon>{{ facePickMode() ? 'touch_app' : 'add' }}</mat-icon>
                Pick body via face
              </button>
            </cad-selection-list>

            <div class="panel-field active">
              <div class="field-header">
                <mat-icon class="field-icon">north_east</mat-icon>
                <span class="field-label">Translate (mm)</span>
              </div>
              <div class="hole-override-row">
                <span>X</span>
                <input type="number" step="1" class="panel-input"
                       data-testid="move-copy-tx"
                       [value]="moveCopyTx()"
                       (input)="moveCopyTx.set(+$any($event.target).value || 0)" />
              </div>
              <div class="hole-override-row">
                <span>Y</span>
                <input type="number" step="1" class="panel-input"
                       data-testid="move-copy-ty"
                       [value]="moveCopyTy()"
                       (input)="moveCopyTy.set(+$any($event.target).value || 0)" />
              </div>
              <div class="hole-override-row">
                <span>Z</span>
                <input type="number" step="1" class="panel-input"
                       data-testid="move-copy-tz"
                       [value]="moveCopyTz()"
                       (input)="moveCopyTz.set(+$any($event.target).value || 0)" />
              </div>
            </div>

            <div class="panel-field">
              <label class="panel-checkbox">
                <input type="checkbox"
                       data-testid="move-copy-rotate-enabled"
                       [checked]="moveCopyRotateEnabled()"
                       (change)="moveCopyRotateEnabled.set($any($event.target).checked)" />
                <span>Rotate</span>
              </label>
              <ng-container *ngIf="moveCopyRotateEnabled()">
                <div class="field-header" style="margin-top: 6px;">
                  <mat-icon class="field-icon">rotate_right</mat-icon>
                  <span class="field-label">Axis</span>
                </div>
                <select class="panel-input"
                        data-testid="move-copy-axis"
                        [value]="moveCopyAxisId()"
                        (change)="moveCopyAxisId.set($any($event.target).value)">
                  <option value="x_axis">X axis</option>
                  <option value="y_axis">Y axis</option>
                  <option value="z_axis">Z axis</option>
                </select>
                <div class="hole-override-row" style="margin-top: 6px;">
                  <span>Angle°</span>
                  <input type="number" step="1" class="panel-input"
                         data-testid="move-copy-angle"
                         [value]="moveCopyAngleDeg()"
                         (input)="moveCopyAngleDeg.set(+$any($event.target).value || 0)" />
                </div>
              </ng-container>
            </div>

            <div class="panel-field">
              <label class="panel-checkbox">
                <input type="checkbox"
                       data-testid="move-copy-copy"
                       [checked]="moveCopyCopy()"
                       (change)="moveCopyCopy.set($any($event.target).checked)" />
                <span>Copy (keep originals + add transformed copies)</span>
              </label>
            </div>

            <div class="panel-actions">
              <button class="btn btn-primary"
                      [disabled]="!canCommitMoveCopyBody()"
                      (click)="commitMoveCopyBodySidebar()"
                      data-testid="move-copy-apply">
                <mat-icon>check</mat-icon> OK
              </button>
              <button class="btn"
                      (click)="cancelMoveCopyBodySidebar()"
                      data-testid="move-copy-cancel">
                <mat-icon>close</mat-icon> Cancel
              </button>
            </div>
          </div>
        </ng-container>

        <!-- Pattern sidebar — covers Mirror Feature, Linear Pattern,
             and Circular Pattern. The kind selector at top swaps the
             input fields without re-opening the sidebar. REQ 658. -->
        <ng-container *ngIf="patternSidebar() as pCtx">
          <div class="tool-panel" data-testid="pattern-sidebar">
            <h3 class="panel-title">
              <mat-icon>{{
                pCtx.kind === 'mirror' ? 'flip'
                  : pCtx.kind === 'linearPattern' ? 'grid_on'
                  : 'rotate_right'
              }}</mat-icon>
              {{ pCtx.editingFeatureId ? 'Edit ' : '' }}{{
                pCtx.kind === 'mirror' ? 'Mirror'
                  : pCtx.kind === 'linearPattern' ? 'Linear Pattern'
                  : 'Circular Pattern'
              }}
            </h3>
            <p class="panel-hint">
              {{
                pCtx.kind === 'mirror'
                  ? 'Reflect the current body across a reference plane.'
                  : pCtx.kind === 'linearPattern'
                  ? 'Translate copies of the current body along one or two directions.'
                  : 'Rotate copies of the current body around an axis.'
              }}
            </p>

            <!-- Mirror: plane pick -->
            <ng-container *ngIf="pCtx.kind === 'mirror'">
              <cad-selection-list
                  label="Mirror plane"
                  headerIcon="filter_none"
                  testid="pattern-plane"
                  [rows]="patternPlaneRows()"
                  [active]="true"
                  (remove)="patternPlaneRef.set(null)">
                <button class="btn panel-flip"
                        data-testid="pattern-plane-pick"
                        [class.active]="facePickMode()"
                        (click)="facePickMode.set(!facePickMode())">
                  <mat-icon>{{ facePickMode() ? 'touch_app' : 'add' }}</mat-icon>
                  {{ facePickMode() ? 'Click a face or datum (click here to stop)' : 'Pick from viewer' }}
                </button>
                <div class="panel-field active" style="padding: 4px 0;">
                  <select class="panel-input"
                          data-testid="pattern-plane-datum-select"
                          aria-label="Use an origin plane"
                          [value]="patternPlaneDatumOption()"
                          (change)="setPatternPlaneFromDatum($any($event.target).value)">
                    <option value="">— or pick an origin plane —</option>
                    <option value="xy_plane">Top (XY)</option>
                    <option value="xz_plane">Front (XZ)</option>
                    <option value="yz_plane">Right (YZ)</option>
                  </select>
                </div>
              </cad-selection-list>
            </ng-container>

            <!-- Linear: direction 1, optional direction 2 -->
            <ng-container *ngIf="pCtx.kind === 'linearPattern'">
              <div class="panel-field active">
                <div class="field-header">
                  <mat-icon class="field-icon">north_east</mat-icon>
                  <span class="field-label">Direction 1 axis</span>
                </div>
                <select class="panel-input"
                        data-testid="pattern-dir1-axis"
                        aria-label="Direction 1 axis"
                        [value]="patternDir1AxisId()"
                        (change)="patternDir1AxisId.set($any($event.target).value)">
                  <option value="x_axis">X axis</option>
                  <option value="y_axis">Y axis</option>
                  <option value="z_axis">Z axis</option>
                </select>
              </div>
              <div class="panel-field active">
                <div class="field-header">
                  <mat-icon class="field-icon">straighten</mat-icon>
                  <span class="field-label">Spacing</span>
                </div>
                <app-dim-input
                  testid="pattern-dir1-spacing"
                  ariaLabel="Direction 1 spacing"
                  unit="mm"
                  [value]="patternDir1Spacing()"
                  [expression]="patternDir1SpacingExpression()"
                  [equationValues]="equationValues()"
                  (valueChange)="patternDir1Spacing.set($event)"
                  (expressionChange)="patternDir1SpacingExpression.set($event)" />
              </div>
              <div class="panel-field active">
                <div class="field-header">
                  <mat-icon class="field-icon">tag</mat-icon>
                  <span class="field-label">Instances</span>
                </div>
                <app-dim-input
                  testid="pattern-dir1-count"
                  ariaLabel="Direction 1 instance count"
                  [value]="patternDir1Count()"
                  [expression]="patternDir1CountExpression()"
                  [equationValues]="equationValues()"
                  (valueChange)="patternDir1Count.set(_floorPositiveInt($event, 1))"
                  (expressionChange)="patternDir1CountExpression.set($event)" />
              </div>
              <div class="panel-field">
                <button class="btn panel-flip"
                        data-testid="pattern-dir1-flip"
                        [class.active]="patternDir1Flipped()"
                        (click)="patternDir1Flipped.set(!patternDir1Flipped())">
                  <mat-icon>swap_horiz</mat-icon>
                  {{ patternDir1Flipped() ? 'Direction 1: reversed' : 'Reverse direction 1' }}
                </button>
              </div>

              <div class="panel-field">
                <button class="btn panel-flip"
                        data-testid="pattern-dir2-enable"
                        [class.active]="patternDir2Enabled()"
                        (click)="patternDir2Enabled.set(!patternDir2Enabled())">
                  <mat-icon>{{ patternDir2Enabled() ? 'check_box' : 'check_box_outline_blank' }}</mat-icon>
                  Direction 2 (2D grid)
                </button>
              </div>
              <ng-container *ngIf="patternDir2Enabled()">
                <div class="panel-field active">
                  <div class="field-header">
                    <mat-icon class="field-icon">east</mat-icon>
                    <span class="field-label">Direction 2 axis</span>
                  </div>
                  <select class="panel-input"
                          data-testid="pattern-dir2-axis"
                          aria-label="Direction 2 axis"
                          [value]="patternDir2AxisId()"
                          (change)="patternDir2AxisId.set($any($event.target).value)">
                    <option value="x_axis">X axis</option>
                    <option value="y_axis">Y axis</option>
                    <option value="z_axis">Z axis</option>
                  </select>
                </div>
                <div class="panel-field active">
                  <div class="field-header">
                    <mat-icon class="field-icon">straighten</mat-icon>
                    <span class="field-label">Spacing</span>
                  </div>
                  <app-dim-input
                    testid="pattern-dir2-spacing"
                    ariaLabel="Direction 2 spacing"
                    unit="mm"
                    [value]="patternDir2Spacing()"
                    [expression]="patternDir2SpacingExpression()"
                    [equationValues]="equationValues()"
                    (valueChange)="patternDir2Spacing.set($event)"
                    (expressionChange)="patternDir2SpacingExpression.set($event)" />
                </div>
                <div class="panel-field active">
                  <div class="field-header">
                    <mat-icon class="field-icon">tag</mat-icon>
                    <span class="field-label">Instances</span>
                  </div>
                  <app-dim-input
                    testid="pattern-dir2-count"
                    ariaLabel="Direction 2 instance count"
                    [value]="patternDir2Count()"
                    [expression]="patternDir2CountExpression()"
                    [equationValues]="equationValues()"
                    (valueChange)="patternDir2Count.set(_floorPositiveInt($event, 1))"
                    (expressionChange)="patternDir2CountExpression.set($event)" />
                </div>
                <div class="panel-field">
                  <button class="btn panel-flip"
                          data-testid="pattern-dir2-flip"
                          [class.active]="patternDir2Flipped()"
                          (click)="patternDir2Flipped.set(!patternDir2Flipped())">
                    <mat-icon>swap_horiz</mat-icon>
                    {{ patternDir2Flipped() ? 'Direction 2: reversed' : 'Reverse direction 2' }}
                  </button>
                </div>
              </ng-container>
            </ng-container>

            <!-- Circular: axis + count + mode + angle -->
            <ng-container *ngIf="pCtx.kind === 'circularPattern'">
              <div class="panel-field active">
                <div class="field-header">
                  <mat-icon class="field-icon">rotate_right</mat-icon>
                  <span class="field-label">Rotation axis</span>
                </div>
                <select class="panel-input"
                        data-testid="pattern-circ-axis"
                        aria-label="Rotation axis"
                        [value]="patternCircAxisId()"
                        (change)="patternCircAxisId.set($any($event.target).value)">
                  <option value="x_axis">X axis</option>
                  <option value="y_axis">Y axis</option>
                  <option value="z_axis">Z axis</option>
                </select>
              </div>
              <div class="panel-field active">
                <div class="field-header">
                  <mat-icon class="field-icon">tune</mat-icon>
                  <span class="field-label">Spacing mode</span>
                </div>
                <select class="panel-input"
                        data-testid="pattern-circ-mode"
                        aria-label="Spacing mode"
                        [value]="patternCircMode()"
                        (change)="patternCircMode.set($any($event.target).value)">
                  <option value="equalSpacing">Equal spacing (divide total angle)</option>
                  <option value="specifiedAngle">Specified angle (between copies)</option>
                </select>
              </div>
              <div class="panel-field active">
                <div class="field-header">
                  <mat-icon class="field-icon">architecture</mat-icon>
                  <span class="field-label">{{ patternCircMode() === 'equalSpacing' ? 'Total angle' : 'Step angle' }}</span>
                </div>
                <app-dim-input
                  testid="pattern-circ-angle"
                  ariaLabel="Circular pattern angle"
                  unit="deg"
                  [value]="patternCircAngleDeg()"
                  [expression]="patternCircAngleExpression()"
                  [equationValues]="equationValues()"
                  (valueChange)="patternCircAngleDeg.set($event)"
                  (expressionChange)="patternCircAngleExpression.set($event)" />
              </div>
              <div class="panel-field active">
                <div class="field-header">
                  <mat-icon class="field-icon">tag</mat-icon>
                  <span class="field-label">Instances (including source)</span>
                </div>
                <app-dim-input
                  testid="pattern-circ-count"
                  ariaLabel="Instance count"
                  [value]="patternCircCount()"
                  [expression]="patternCircCountExpression()"
                  [equationValues]="equationValues()"
                  (valueChange)="patternCircCount.set(_floorPositiveInt($event, 2))"
                  (expressionChange)="patternCircCountExpression.set($event)" />
              </div>
              <div class="panel-field">
                <button class="btn panel-flip"
                        data-testid="pattern-circ-flip"
                        [class.active]="patternCircFlipped()"
                        (click)="patternCircFlipped.set(!patternCircFlipped())">
                  <mat-icon>swap_horiz</mat-icon>
                  {{ patternCircFlipped() ? 'Reversed' : 'Reverse direction' }}
                </button>
              </div>
            </ng-container>

            <div class="panel-actions">
              <button class="btn btn-primary"
                      [disabled]="!canCommitPattern()"
                      (click)="commitPatternSidebar()"
                      data-testid="pattern-apply">
                <mat-icon>check</mat-icon> OK
              </button>
              <button class="btn"
                      (click)="cancelPatternSidebar()"
                      data-testid="pattern-cancel">
                <mat-icon>close</mat-icon> Cancel
              </button>
            </div>
          </div>
        </ng-container>

        <ng-container *ngIf="measureSidebar()">
          <div class="tool-panel" data-testid="measure-sidebar">
            <h3 class="panel-title">
              <mat-icon>straighten</mat-icon>
              Measure
            </h3>
            <p class="panel-hint">Click vertices, edges, or faces in the viewer. Click again to deselect.</p>
            <cad-selection-list
                label="Picks"
                headerIcon="ads_click"
                testid="measure"
                [rows]="measureSelectionRows()"
                [active]="true"
                (remove)="removeMeasureItem($event)"
                (clear)="measureItems.set([])">
            </cad-selection-list>
            <div class="panel-field active" *ngIf="measureResult().summary || measureResult().rows.length > 0">
              <div class="field-header">
                <mat-icon class="field-icon">calculate</mat-icon>
                <span class="field-label">Result</span>
              </div>
              <p class="panel-hint" *ngIf="measureResult().summary">{{ measureResult().summary }}</p>
              <div class="measure-rows" *ngIf="measureResult().rows.length > 0">
                <div class="measure-row" *ngFor="let row of measureResult().rows" data-testid="measure-result-row">
                  <span class="measure-row-label">{{ row.label }}</span>
                  <span class="measure-row-value">{{ row.value }}</span>
                </div>
              </div>
            </div>
            <div class="panel-actions">
              <button class="btn"
                      (click)="closeMeasureSidebar()"
                      data-testid="measure-close">
                <mat-icon>close</mat-icon> Close
              </button>
            </div>
          </div>
        </ng-container>

        <div class="viewport-wrap">
          <ng-container *ngIf="!loading(); else loadingTpl">
            <app-cad-viewer
              #viewer
              [geometry]="geometry()"
              [selected]="selected()"
              [selectedFeatures]="selectedFeatures()"
              [pickedFaceIds]="pickedFaceIdsForViewer()"
              [pickedEdgeIds]="pickedEdgeIdsForViewer()"
              [pickedVertexIds]="pickedVertexIdsForViewer()"
              [loading]="regenLoading()"
              [loadProgress]="regenError() || regenProgressText()"
              [sketchDoc]="doc()"
              [activeSketchId]="activeSketchId()"
              [sketchPreview]="sketchPreview()"
              [selectedSketchEntities]="sketchEditorSelection()"
              [mirrorAxisId]="sketchEditor.mirrorAxisId()"
              [activeSketchDof]="activeSketchDof()"
              [determinedEntities]="determinedEntities()"
              [editingDimensionId]="editingDimensionId()"
              [drivenDimensions]="drivenSketchDimensions()"
              [selectedConstraintId]="selectedConstraintId()"
              [defaultUnit]="defaultUnit()"
              [smartDimPreview]="smartDimPreview()"
              [displayMode]="displayMode()"
              [profileFills]="profileFills()"
              [holePreviews]="holePreviews()"
              [cosmeticThreads]="cosmeticThreads()"
              [textVariables]="textVariables()"
              [profileFillsSelected]="extrudeSelectedRegions()"
              [profileFillsHovered]="extrudeHoveredRegion()"
              [vertexPickMode]="vertexPickMode()"
              [extraPickableVertices]="sketchPickableVertices()"
              [facePickMode]="facePickActive()"
              [facePickExcludeFeatureId]="extrudeSidebar()?.editingFeatureId ?? null"
              [axisPickMode]="axisPickMode()"
              [axisCandidates]="axisCandidates3D()"
              [selectedAxisId]="revolveAxisLineId()"
              [edgePickMode]="edgePickActive()"
              [featurePreview]="featurePreview()"
              [edgeBlendPreview]="edgeBlendPreviewSig()"
              [datumPlanePreview]="datumPlanePreview()"
              [patternPreview]="patternPreview()"
              [shellPreview]="shellPreview()"
              (profileFillClick)="toggleExtrudeRegion($event)"
              (profileFillHover)="extrudeHoveredRegion.set($event)"
              (vertexPicked)="onVertexPicked($event)"
              (vertexPickedAt)="onVertexPickedAt($event)"
              (facePicked)="onFacePicked($event)"
              (facePickedAt)="onFacePickedAt($event)"
              (axisPicked)="onAxisPicked($event)"
              (edgePicked)="onEdgePicked($event)"
              (selectionChange)="onSelectionChange($event)"
              (featureClick)="onViewerFeatureClick($event)"
              (featureContextMenu)="onViewerFeatureContextMenu($event)"
              (sketchClick)="onViewerSketchClick($event)"
              (sketchPointerDown)="onViewerSketchPointerDown($event)"
              (sketchPointerMove)="onViewerSketchPointerMove($event)"
              (sketchPointerUp)="onViewerSketchPointerUp($event)"
              (dimensionLabelClicked)="onDimensionLabelClicked($event)"
              (dimensionCommitted)="onDimensionCommitted($event)"
              (dimensionCanceled)="onDimensionCanceled()"
              (dimensionDragged)="onDimensionDragged($event)"
              (dimensionDeleteRequested)="onDimensionDeleteRequested($event)"
              (dimensionDoubleClicked)="onDimensionDoubleClicked($event)"
              (constraintIconClicked)="onConstraintIconClicked($event)">
            </app-cad-viewer>

            <!-- REQ 623 — feature context menu, anchored at the cursor. -->
            <div class="ctx-anchor" #ctxAnchor
                 [style.left.px]="ctxMenuX()"
                 [style.top.px]="ctxMenuY()"
                 [matMenuTriggerFor]="featureCtxMenu"></div>
            <mat-menu #featureCtxMenu="matMenu">
              <ng-container *ngIf="ctxMenuFeatureId() as fid">
                <button mat-menu-item data-testid="viewer-ctx-edit" (click)="onTreeAction({ action: 'edit-feature', featureId: fid })">
                  <mat-icon>edit</mat-icon> Edit…
                </button>
                <button mat-menu-item data-testid="viewer-ctx-rename" (click)="onTreeAction({ action: 'rename-feature', featureId: fid })">
                  <mat-icon>drive_file_rename_outline</mat-icon> Rename
                </button>
                <button mat-menu-item data-testid="viewer-ctx-visibility" (click)="onTreeAction({ action: 'toggle-feature-visibility', featureId: fid })">
                  <mat-icon>visibility_off</mat-icon> Toggle visibility
                </button>
                <button mat-menu-item data-testid="viewer-ctx-delete" (click)="onTreeAction({ action: 'delete-feature', featureId: fid })">
                  <mat-icon>delete</mat-icon> Delete
                </button>
              </ng-container>
            </mat-menu>

            <!-- Mode prompt at the top of the viewport -->
            <div class="mode-prompt" *ngIf="mode() !== 'idle' && activeSketchId() === null" data-testid="mode-prompt">
              <mat-icon>{{ promptIcon() }}</mat-icon>
              <span class="prompt-text">{{ promptText() }}</span>
              <button class="btn btn-text" (click)="setMode('idle')">Cancel</button>
            </div>

            <!-- Active-sketch banner with quick exit -->
            <div class="mode-prompt" *ngIf="activeSketchId() !== null" data-testid="sketch-mode-banner">
              <mat-icon>draw</mat-icon>
              <span class="prompt-text">Sketch mode · plane: {{ activeSketchPlaneLabel() }}</span>
              <button class="btn" data-testid="exit-sketch" (click)="onExitSketch()">Exit sketch</button>
            </div>

            <div class="quick-start" *ngIf="mode() === 'idle' && activeSketchId() === null && featureTree().features.length === 1 && sketchCount() === 0">
              <h3>To get started</h3>
              <ol>
                <li>Click <strong>Sketch</strong> on the Features ribbon, then click a datum plane</li>
                <li>Switch to the <strong>Sketch</strong> ribbon and draw a closed shape</li>
                <li>Back on Features, click <strong>Extrude</strong> and pick that sketch</li>
              </ol>
              <p class="muted">Orbit: left-drag · Pan: shift-drag · Zoom: wheel · In sketch mode: left-click sketches, right-drag orbits</p>
            </div>

            <!-- Floating status overlay split into two translucent pill
                 groups (left + right) with a fully transparent gap between
                 them. Same HUD treatment as before — semi-transparent
                 plates sitting on the viewport rather than a strip
                 outside it. -->
            <div class="editor-footer">
              <div class="footer-group footer-group-left">
                <app-category-badge data-testid="revision-badge" *ngIf="model()?.part?.revision"
                  [label]="'Rev ' + model()!.part!.revision" subtle />
                <span class="footer-mode" data-testid="cad-hud-ready" *ngIf="activeSketchId() === null">
                  mode: {{ mode() }} · selected: {{ selected() || '(none)' }} · features: {{ featureTree().features.length }}
                </span>
                <span class="footer-mode footer-cursor"
                      data-testid="cad-hud-sketch-cursor"
                      *ngIf="activeSketchId() !== null">
                  sketch · x: {{ formatCursorCoord(sketchCursor()?.x) }} · y: {{ formatCursorCoord(sketchCursor()?.y) }}
                </span>
                <span class="readonly-banner" data-testid="readonly-banner" *ngIf="readonly()">View only</span>

                <!-- VCS: lock + check-in controls (Phase 1) -->
                <span class="vcs-dirty" data-testid="vcs-dirty" *ngIf="isDirty()"
                      matTooltip="Uncommitted changes since the last check-in">● unsaved</span>
                <span class="vcs-lock" data-testid="vcs-lock-foreign" *ngIf="lockedByOther()"
                      matTooltip="Checked out by another user">🔒 checked out</span>
                <button class="btn" data-testid="action-checkout"
                        *ngIf="model() && canWrite() && !model()?.lockedByUserID"
                        (click)="onCheckout()">Check out</button>
                <button class="btn btn-primary" data-testid="action-checkin"
                        *ngIf="isLockedByMe()" (click)="onCheckin()">Check in</button>
                <button class="btn" data-testid="action-release-lock"
                        *ngIf="isLockedByMe()" (click)="onReleaseLock()">Release lock</button>
                <button class="btn" data-testid="action-history"
                        *ngIf="model()" (click)="toggleCommits()">History ({{ commits().length }})</button>
                <div class="vcs-commits-panel" data-testid="vcs-commits-panel" *ngIf="showCommits()">
                  <div class="vcs-commits-head">
                    <span>Commit history</span>
                    <button class="vcs-commits-close" (click)="toggleCommits()">×</button>
                  </div>
                  <div class="vcs-commits-empty" *ngIf="!commits().length">No commits yet — check in to create the first.</div>
                  <ul class="vcs-commits-list">
                    <li *ngFor="let c of commits()">
                      <span class="vcs-commit-msg">{{ c.message || '(no message)' }}</span>
                      <span class="vcs-commit-hash">{{ shortHash(c.hash) }}</span>
                      <span class="vcs-commit-time">{{ c.timestamp | date:'short' }}</span>
                    </li>
                  </ul>
                </div>
                <button class="btn" data-testid="action-branches"
                        *ngIf="model()" (click)="toggleBranches()">⑂ {{ currentBranch() }} ({{ branches().length }})</button>
                <div class="vcs-commits-panel" data-testid="vcs-branches-panel" *ngIf="showBranches()">
                  <div class="vcs-commits-head">
                    <span>Branches</span>
                    <button class="vcs-commits-close" (click)="toggleBranches()">×</button>
                  </div>
                  <div class="vcs-commits-empty" *ngIf="!branches().length">No branches yet — check in first.</div>
                  <ul class="vcs-commits-list">
                    <li *ngFor="let b of branches()">
                      <span class="vcs-commit-msg">{{ b.name }}<span *ngIf="b.name===currentBranch()" class="vcs-cur"> · current</span></span>
                      <button class="vcs-mini" *ngIf="b.name!==currentBranch()" (click)="onSwitchBranch(b.name)">switch</button>
                      <button class="vcs-mini" *ngIf="b.name!=='main' && b.name!==currentBranch()" (click)="onArchiveBranch(b.name)">archive</button>
                    </li>
                  </ul>
                  <div class="vcs-branch-actions">
                    <button class="btn" (click)="onCreateBranch()">+ New branch</button>
                    <button class="btn" (click)="onCherryPick()">Cherry-pick…</button>
                  </div>
                </div>
                <button class="btn btn-primary"
                        data-testid="action-release"
                        *ngIf="model() && canApprove()"
                        [matTooltip]="'Commit + freeze + tag as Rev ' + (model()?.part?.revision || '')"
                        (click)="onRelease()">
                  Release Rev {{ model()?.part?.revision }}
                </button>
                <span class="kernel-badge"
                      data-testid="kernel-badge"
                      *ngIf="regenLoading() || !stream.connected()"
                      [class.streaming]="regenLoading() && stream.connected()"
                      [class.disconnected]="!stream.connected()"
                      [matTooltip]="kernelBadgeTooltip()">
                  <span class="kernel-dot"></span>
                  {{ kernelBadgeLabel() }}
                </span>
              </div>

              <span class="footer-gap"></span>

              <button class="footer-volume"
                      type="button"
                      data-testid="footer-volume"
                      *ngIf="totalVolumeMm3() > 0"
                      matTooltip="Click to copy full-precision mm³ value to clipboard"
                      (click)="copyTotalVolume()">
                <mat-icon class="footer-volume-icon">view_in_ar</mat-icon>
                {{ totalVolumeLabel() }}
              </button>

              <div class="footer-group footer-group-right">
                <button class="icon-btn footer-icon-btn"
                        data-testid="export-stl"
                        *ngIf="totalVolumeMm3() > 0"
                        matTooltip="Export STL (3D print / mesh, mm)"
                        (click)="exportStl()">
                  <mat-icon>download</mat-icon>
                </button>
                <button class="icon-btn footer-icon-btn"
                        data-testid="export-step"
                        *ngIf="totalVolumeMm3() > 0"
                        [disabled]="stepExporting() || !stream.connected()"
                        matTooltip="Export STEP (CAD interchange)"
                        (click)="exportStep()">
                  <mat-icon>{{ stepExporting() ? 'hourglass_empty' : 'category' }}</mat-icon>
                </button>
                <button class="icon-btn footer-icon-btn"
                        data-testid="filter-face"
                        [class.active-pick]="facePickMode()"
                        matTooltip="Select faces only"
                        (click)="toggleSelectionFilter('face')">
                  <mat-icon>crop_din</mat-icon>
                </button>
                <button class="icon-btn footer-icon-btn"
                        data-testid="filter-edge"
                        [class.active-pick]="edgePickMode()"
                        matTooltip="Select edges only"
                        (click)="toggleSelectionFilter('edge')">
                  <mat-icon>polyline</mat-icon>
                </button>
                <button class="icon-btn footer-icon-btn"
                        data-testid="filter-vertex"
                        [class.active-pick]="vertexPickMode()"
                        matTooltip="Select vertices only"
                        (click)="toggleSelectionFilter('vertex')">
                  <mat-icon>fiber_manual_record</mat-icon>
                </button>
                <button class="icon-btn footer-icon-btn"
                        data-testid="fullscreen-toggle"
                        matTooltip="{{ fullscreen() ? 'Exit full screen' : 'Full screen' }}"
                        (click)="toggleFullscreen()">
                  <mat-icon>{{ fullscreen() ? 'fullscreen_exit' : 'fullscreen' }}</mat-icon>
                </button>
                <mat-form-field appearance="outline" class="unit-field" subscriptSizing="dynamic">
                  <mat-select
                      data-testid="unit-select"
                      [value]="defaultUnit()"
                      (selectionChange)="setDefaultUnit($event.value)"
                      [disabled]="readonly()"
                      matTooltip="Default unit (type a unit suffix on any value to override per-dim)">
                    <mat-option value="mm">mm</mat-option>
                    <mat-option value="um">µm</mat-option>
                    <mat-option value="in">in</mat-option>
                  </mat-select>
                </mat-form-field>
              </div>
            </div>
          </ng-container>

          <ng-template #loadingTpl>
            <div class="loading">
              <mat-spinner diameter="48"></mat-spinner>
              <p>Loading CAD model…</p>
            </div>
          </ng-template>
        </div>
      </div>
    </div>
  `,
  styles: [`
    /* Fill the parent (main.content inside the app nav, which is already
       100vh minus the toolbar). An explicit min-height of 100vh here
       overflows that container by the toolbar's height and pushes the
       feature-tree's bottom off the bottom of the screen. */
    .cad-editor { display: flex; flex-direction: column; height: 100%; min-height: 0; background: #1e1e2e; color: #ddd; }
    .cad-editor.fullscreen { position: fixed; inset: 0; z-index: 9999; }
    /* Floating status overlay across the bottom of the viewport. The bar
       itself is fully transparent — only the left and right groups carry
       the HUD plate (rgba black), so the empty middle reveals whatever's
       in the cad viewport behind it. Pointer-events stay off the bar so
       clicks in the gap fall through to the viewport's orbit/pan/zoom. */
    .editor-footer { position: absolute; left: 8px; right: 8px; bottom: 8px; display: flex; align-items: center; gap: 8px; font-size: 12px; min-height: 28px; pointer-events: none; z-index: 5; }
    .footer-volume {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 3px 10px;
      background: rgba(30, 30, 40, 0.75);
      border: 1px solid #3a3a52;
      border-radius: 12px;
      color: #ddd;
      font-family: ui-monospace, monospace;
      font-size: 12px;
      cursor: pointer;
      pointer-events: auto;
      transition: background 0.1s, border-color 0.1s;
    }
    .footer-volume:hover { background: rgba(50, 50, 70, 0.85); border-color: #555; }
    .footer-volume:active { background: rgba(66, 165, 245, 0.25); border-color: #42a5f5; }
    .footer-volume-icon { font-size: 14px; width: 14px; height: 14px; opacity: 0.75; }
    .editor-footer .footer-group { display: flex; align-items: center; gap: 8px; padding: 4px 10px; background: rgba(0,0,0,0.35); border-radius: 4px; min-height: 28px; pointer-events: auto; }
    .editor-footer .footer-gap { flex: 1; }
    .editor-footer .footer-mode { font-family: monospace; opacity: 0.8; }
    .editor-footer .footer-icon-btn { width: 26px; height: 26px; padding: 0; display: inline-flex; align-items: center; justify-content: center; }
    .editor-footer .footer-icon-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .editor-footer .footer-icon-btn.active-pick { background: rgba(66, 165, 245, 0.35); color: #fff; }
    /* Edge-pick banner overlay — sits at the top of the viewport with the
       same translucent black plate the footer uses, monospace font for the
       numbers. */
    .edge-pick-banner { position: absolute; top: 8px; left: 8px; background: rgba(0,0,0,0.55); color: #ddd; padding: 8px 12px; border-radius: 4px; font-size: 12px; font-family: monospace; z-index: 5; max-width: 340px; }
    .edge-pick-banner .edge-pick-hint { display: flex; align-items: center; gap: 6px; color: #42a5f5; font-family: inherit; font-size: 12px; margin-bottom: 6px; }
    .edge-pick-banner .edge-pick-hint mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .edge-pick-banner .edge-pick-info > div { line-height: 1.5; }
    .edge-pick-banner .edge-pick-info strong { color: #ffb74d; font-weight: 500; }
    .editor-footer .unit-field { width: 96px; font-size: 12px; }
    .editor-footer .unit-field ::ng-deep .mat-mdc-form-field-infix { padding-top: 4px !important; padding-bottom: 4px !important; min-height: 0; }
    .editor-footer .unit-field ::ng-deep .mat-mdc-form-field-subscript-wrapper { display: none; }
    .spacer { flex: 1; }
    .revision-badge { padding: 4px 10px; background: #3a3a52; border-radius: 4px; font-weight: 600; }
    .state-badge { padding: 4px 10px; border-radius: 4px; font-size: 12px; text-transform: uppercase; font-weight: 600; }
    .state-badge.draft { background: #fff3e0; color: #e65100; }
    .state-badge.review { background: #e3f2fd; color: #1565c0; }
    .state-badge.released { background: #e8f5e9; color: #2e7d32; }
    .readonly-banner { padding: 4px 10px; background: #ffebee; color: #c62828; border-radius: 4px; font-size: 12px; font-weight: 600; }
    .kernel-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; background: #1b3a1b; color: #b5e0b5; border-radius: 4px; font-size: 12px; font-weight: 500; }
    .kernel-badge.streaming { background: #1b2e3a; color: #9cc7e0; }
    .kernel-badge.disconnected { background: #3a1b1b; color: #ef9a9a; }
    .kernel-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; animation: kernel-pulse 1.6s ease-in-out infinite; }
    .kernel-badge.disconnected .kernel-dot { animation: none; }
    @keyframes kernel-pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
    .tool-action.active { background: rgba(66, 165, 245, 0.22); border-color: #42a5f5; }
    .ctx-anchor { position: fixed; width: 0; height: 0; }
    .display-mode-field { width: 220px; font-size: 12px; }
    .display-mode-field .mat-mdc-form-field-subscript-wrapper { display: none; }
    .unit-field { width: 80px; font-size: 12px; }
    .unit-field .mat-mdc-form-field-subscript-wrapper { display: none; }
    .display-mode-field ::ng-deep .mat-mdc-form-field-infix { padding-top: 6px !important; padding-bottom: 6px !important; min-height: 0; }
    .ribbon { background: #25253a; border-bottom: 1px solid #444; flex-shrink: 0; }
    .ribbon-content { height: 76px; padding: 4px 12px; display: flex; align-items: stretch; overflow-x: auto; overflow-y: hidden; border-bottom: 1px solid #333; }
    .ribbon-content::-webkit-scrollbar { height: 6px; }
    .ribbon-content::-webkit-scrollbar-thumb { background: #444; border-radius: 3px; }
    .ribbon-pane { display: flex; align-items: center; gap: 4px; width: 100%; min-width: max-content; }
    .ribbon-pane[hidden] { display: none !important; }
    .ribbon-hint { font-size: 12px; opacity: 0.7; margin-left: 12px; align-self: center; }
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
    .ribbon-button mat-icon { font-size: 24px; width: 24px; height: 24px; }
    .ribbon-button .ribbon-label { font-size: 10px; line-height: 1.1; text-align: center; opacity: 0.9; }
    .ribbon-button:hover:not([disabled]) { background: rgba(255,255,255,0.08); }
    .ribbon-button.active { background: rgba(66, 165, 245, 0.22); border-color: #42a5f5; }
    .ribbon-button[disabled] { opacity: 0.35; cursor: not-allowed; }
    .ribbon-divider { width: 1px; align-self: stretch; background: #444; margin: 8px 6px; flex-shrink: 0; }
    .ribbon-group { display: flex; flex-direction: column; align-items: center; padding: 0 4px; flex-shrink: 0; }
    .ribbon-group-row { display: flex; gap: 2px; align-items: stretch; }
    .ribbon-group-label { font-size: 9px; line-height: 1.2; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.5; margin-top: 2px; user-select: none; }
    /* Split-button: main action on the left, small chevron on the right
       that opens the Boss/Cut menu. Two distinct click targets sharing
       one visual frame. Mirrors SolidWorks' Extrude split-button. */
    .ribbon-split { display: inline-flex; align-items: stretch; gap: 0; }
    .ribbon-split .ribbon-button { border-top-right-radius: 0; border-bottom-right-radius: 0; }
    .ribbon-split-chevron {
      display: inline-flex; align-items: center; justify-content: center;
      width: 18px; height: 64px;
      background: transparent; border: 1px solid transparent;
      border-left: none;
      border-top-right-radius: 4px; border-bottom-right-radius: 4px;
      color: #ddd; cursor: pointer; padding: 0;
    }
    .ribbon-split-chevron:hover { background: rgba(255,255,255,0.08); }
    .ribbon-split-chevron mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .tab-strip { display: flex; gap: 0; padding: 0 16px; height: 28px; }
    .tab { background: none; border: none; color: #aaa; padding: 0 14px; font-size: 12px; cursor: pointer; border-top: 2px solid transparent; font-weight: 500; height: 100%; text-transform: uppercase; letter-spacing: 0.4px; }
    .tab:hover { color: #fff; }
    .tab.active { color: #fff; border-top-color: #42a5f5; background: rgba(66,165,245,0.08); }
    .editor-body { display: flex; flex: 1; min-height: 0; }
    .feature-tree { width: 240px; background: #25253a; border-right: 1px solid #444; }
    .constraint-list { width: 220px; border-right: 1px solid #444; }
    .viewport-wrap { flex: 1; position: relative; overflow: hidden; }

    /* Tool panel — same column dimensions as .constraint-list so swapping
       between them doesn't reflow the viewer. Used by the Mirror tool
       today; same shell will accept Pattern, Linear/Circular pattern, etc. */
    .tool-panel {
      width: 220px;
      border-right: 1px solid #444;
      background: #25253a;
      padding: 12px;
      box-sizing: border-box;
      overflow-y: auto;
      font-size: 13px;
    }
    .panel-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
      font-weight: 600;
      margin: 0 0 8px 0;
      padding-bottom: 8px;
      border-bottom: 1px solid #444;
      color: #ddd;
    }
    .panel-title mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .panel-hint {
      font-size: 11px;
      color: #aaa;
      line-height: 1.4;
      margin: 0 0 12px 0;
    }
    .panel-field {
      padding: 8px;
      margin-bottom: 8px;
      border: 1px solid #444;
      border-radius: 4px;
      cursor: pointer;
      transition: border-color 0.1s, background 0.1s;
    }
    .panel-field:hover { background: rgba(255,255,255,0.04); }
    .panel-field.active {
      border-color: #42a5f5;
      background: rgba(66, 165, 245, 0.12);
    }
    .field-header {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 4px;
    }
    .field-icon { font-size: 16px; width: 16px; height: 16px; opacity: 0.7; }
    .field-label { font-size: 11px; color: #aaa; text-transform: uppercase; letter-spacing: 0.5px; flex: 1; }
    .field-count {
      font-size: 11px;
      color: #ddd;
      background: rgba(66, 165, 245, 0.18);
      border: 1px solid #42a5f5;
      padding: 1px 8px;
      border-radius: 8px;
      min-width: 18px;
      text-align: center;
    }
    .field-value { font-size: 13px; color: #ddd; }
    /* Inputs / selects / buttons all span the field's inner width with
       consistent height and padding so the sidebar reads as a vertical
       stack of equally-shaped controls — no left-indent quirks. */
    .panel-input {
      box-sizing: border-box;
      width: 100%;
      height: 30px;
      padding: 4px 8px;
      font-size: 13px;
      font-family: ui-monospace, monospace;
      background: #1f1f30;
      border: 1px solid #444;
      border-radius: 3px;
      color: #ddd;
    }
    .panel-input:focus { outline: none; border-color: #42a5f5; }
    /* Native <select> renders with the OS chrome by default; keep it
       but make sure the box geometry matches .panel-input. */
    select.panel-input {
      appearance: none;
      -webkit-appearance: none;
      padding-right: 28px;
      background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23aaa'><path d='M7 10l5 5 5-5z'/></svg>");
      background-repeat: no-repeat;
      background-position: right 6px center;
      background-size: 16px;
    }
    select.panel-input option { background: #1f1f30; color: #ddd; }
    .panel-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 4px;
      margin: 8px 0 4px 0;
      font-size: 12px;
      color: #ccc;
      cursor: pointer;
      user-select: none;
    }
    .panel-toggle input[type="checkbox"] {
      accent-color: #42a5f5;
      cursor: pointer;
    }
    /* Wide button modifier used by Direction (Reverse / Along normal)
       + Up to Vertex/Surface pickers + Cut Extrude affordances. Just
       spans the field's full width; the rest of the geometry comes
       from .btn (in styles.css). */
    .panel-flip { width: 100%; }
    /* Axis pick row: the wide "Pick an axis line" button + a small square
       X button next to it that clears the pick. X only renders when an
       axis is selected; layout is the same shape as the inline-flip in
       the offset row so they read consistently. */
    .axis-pick-row { display: flex; gap: 4px; align-items: stretch; }
    .axis-pick-button { flex: 1 1 auto; }
    .axis-clear-button {
      width: 30px; padding: 0;
      display: flex; align-items: center; justify-content: center;
    }
    .axis-clear-button mat-icon { font-size: 18px; width: 18px; height: 18px; }
    /* Group container holds related sub-rows under one header (e.g.
       "Direction 1" with its end-condition + distance + targets all
       stacked together). Each sub-row gets its own small label.
       Reuses .panel-field's visual shell so the look stays consistent. */
    .sub-row { display: flex; flex-direction: column; gap: 3px; margin-top: 8px; }
    .sub-row:first-child { margin-top: 0; }
    .sub-label { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.4px; }
    /* Inline flip button next to a value input. The input expands to
       fill the row; the square button matches the input's 30px height
       so they line up. Icon-only, tooltip carries the direction label. */
    .input-with-flip { display: flex; gap: 4px; align-items: stretch; }
    .input-with-flip .panel-input { flex: 1; min-width: 0; }
    .flip-square {
      width: 30px; height: 30px; padding: 0; flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center;
      background: #2a2a3a; border: 1px solid #444; border-radius: 3px;
      color: #ddd; cursor: pointer;
    }
    .flip-square:hover { background: #34344a; border-color: #555; }
    .flip-square mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .field-empty { font-size: 12px; color: #888; font-style: italic; }
    /* Measure sidebar result rows — label/value pairs in a compact column. */
    .measure-rows { display: flex; flex-direction: column; gap: 3px; margin-top: 4px; }
    .measure-row {
      display: flex; align-items: baseline; gap: 8px;
      padding: 2px 0; border-bottom: 1px dotted #3a3a52;
    }
    .measure-row:last-child { border-bottom: none; }
    .measure-row-label { font-size: 11px; color: #aaa; text-transform: uppercase; letter-spacing: 0.4px; min-width: 56px; }
    .measure-row-value { flex: 1; font-size: 13px; color: #fff; font-family: ui-monospace, monospace; }
    /* Inline checkbox label used by Merge result + Profile regions. */
    .loop-toggle {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 0;
      font-size: 13px;
      color: #ddd;
      cursor: pointer;
      user-select: none;
    }
    .loop-toggle input[type="checkbox"] {
      accent-color: #42a5f5;
      cursor: pointer;
      width: 14px;
      height: 14px;
      margin: 0;
      flex-shrink: 0;
    }

    /* List of selected entities (Mirror "Entities to mirror" field) and
       the single-row axis. Each row shows kind + coord hint + X button. */
    .entity-list { list-style: none; margin: 6px 0 0 0; padding: 0; }
    .entity-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 4px 4px 6px;
      margin-top: 4px;
      background: rgba(255,255,255,0.04);
      border: 1px solid #3a3a52;
      border-radius: 3px;
    }
    .entity-row.single { margin-top: 6px; }
    /* Clickable axis-picker rows in the Revolve sidebar. */
    .entity-row[class*="selected"] { border-color: #42a5f5; background: rgba(66, 165, 245, 0.18); }
    li.entity-row { cursor: pointer; }
    li.entity-row:hover { background: rgba(255,255,255,0.08); }
    .entity-icon { font-size: 16px; width: 16px; height: 16px; opacity: 0.85; flex-shrink: 0; }
    .entity-info { flex: 1; min-width: 0; }
    .entity-label { font-size: 12px; color: #ddd; line-height: 1.2; }
    .entity-detail {
      font-size: 10px;
      color: #888;
      line-height: 1.2;
      font-family: ui-monospace, monospace;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    /* Remove button inside an entity row — narrower than the toolbar's
       .icon-btn so it fits the 220px sidebar column. */
    .entity-remove {
      width: 22px;
      height: 22px;
      color: #aaa;
      flex-shrink: 0;
    }
    .entity-remove mat-icon { font-size: 16px; width: 16px; height: 16px; line-height: 16px; }
    .entity-remove:hover { color: #ff5252; }
    .panel-actions {
      display: flex;
      gap: 8px;
      margin-top: 12px;
    }
    .panel-actions button { flex: 1; }
    .mode-prompt { position: absolute; bottom: 56px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 12px; padding: 8px 14px; background: rgba(66, 165, 245, 0.92); color: #0a0a14; border-radius: 8px; font-weight: 500; box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
    .mode-prompt .prompt-text { font-size: 13px; }
    .quick-start { position: absolute; top: 64px; right: 16px; max-width: 320px; padding: 16px 18px; background: rgba(0,0,0,0.55); border-radius: 8px; font-size: 13px; }
    .quick-start h3 { margin: 0 0 8px; font-size: 14px; }
    .quick-start ol { margin: 0; padding-left: 18px; }
    .quick-start li { margin-bottom: 4px; }
    .quick-start .muted { margin: 10px 0 0; font-size: 11px; opacity: 0.6; }
    .loading { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 12px; }
    /* VCS lock / check-in / history (Phase 1) */
    .vcs-dirty { color: #ffb74d; font-size: 12px; }
    .vcs-lock { color: #e57373; font-size: 12px; }
    .vcs-commits-panel { position: absolute; bottom: 56px; left: 16px; width: 360px; max-height: 320px; overflow: auto;
      background: rgba(0,0,0,0.82); border: 1px solid rgba(255,255,255,0.14); border-radius: 8px; padding: 10px 12px; font-size: 12px; z-index: 30; }
    .vcs-commits-head { display: flex; justify-content: space-between; align-items: center; font-weight: 600; margin-bottom: 8px; }
    .vcs-commits-close { background: none; border: none; color: #ccc; font-size: 16px; cursor: pointer; line-height: 1; }
    .vcs-commits-empty { opacity: 0.6; }
    .vcs-commits-list { list-style: none; margin: 0; padding: 0; }
    .vcs-commits-list li { display: flex; gap: 8px; align-items: baseline; padding: 4px 0; border-top: 1px solid rgba(255,255,255,0.08); }
    .vcs-commit-msg { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .vcs-commit-hash { font-family: ui-monospace, monospace; opacity: 0.7; }
    .vcs-commit-time { opacity: 0.55; white-space: nowrap; }
    .vcs-cur { opacity: 0.6; font-style: italic; }
    .vcs-mini { background: rgba(255,255,255,0.1); border: none; color: #ddd; font-size: 11px; padding: 1px 7px; border-radius: 4px; cursor: pointer; }
    .vcs-branch-actions { display: flex; gap: 8px; margin-top: 8px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 8px; }
  `],
})
export class CadEditorComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private cadApi = inject(CadModelService);
  private inventory = inject(InventoryService);
  private auth = inject(AuthService);
  private errors = inject(ErrorNotificationService);
  private dialog = inject(MatDialog);
  /** REQ Batch 6 — owning Part (number / revision / etc.) fetched
   * when partID is set. Used to expose `partNumber`, `partRevision`,
   * `partName` to text equations + future scalar equations. */
  part = signal<Part | null>(null);
  // Public so the template can read the connection state for the kernel-
  // status badge. The stream is otherwise an internal concern.
  stream = inject(CadStreamService);
  private uiState = inject(CadUiStateService);
  private streamSub: { unsubscribe: () => void } | null = null;

  model = signal<CadModel | null>(null);
  loading = signal<boolean>(true);
  featureTree = signal<FeatureTree>(emptyFeatureTree());
  doc = signal<SketchDocument>(emptyDocument());
  // Equations document (REQ 634/635). Persisted alongside featureTree
  // and sketchDoc; the editor's save path includes it in the PATCH
  // payload and backend regen resolves it before dispatching features.
  // `equationValues` is the resolved Record<name, number> used by
  // dim-input components for live `=expr` preview.
  equations = signal<EquationDoc>({ entries: {} });
  equationValues = computed<Record<string, number>>(() => resolveEquations(this.equations()).values);

  /** REQ Batch 6 — string variable map for text-equation expansion.
   * Combines the active Part's identity fields with the resolved
   * numeric equations (formatted to a sensible precision). Consumed
   * by the viewer's text renderer to substitute `#{varName}` tokens
   * in the displayed text. */
  textVariables = computed<Record<string, string>>(() => {
    const p = this.part();
    const out: Record<string, string> = {};
    if (p) {
      out['partName'] = p.name ?? '';
      out['partNumber'] = p.sku ?? p.manufacturerPN ?? p.name ?? '';
      out['partRevision'] = p.revision ?? '';
      out['manufacturerPN'] = p.manufacturerPN ?? '';
    }
    for (const [k, v] of Object.entries(this.equationValues())) {
      if (k.includes('.')) continue;  // skip target-path entries (only globals)
      out[k] = Number.isFinite(v) ? formatEquationNumber(v) : '';
    }
    return out;
  });
  /** Resolver for `#{var}` placeholders, built from `textVariables`. Shared by
   * the sidebar preview and the extrude preview so both resolve identically. */
  textResolver = computed<TextResolver>(() => makeVarResolver(this.textVariables()));
  /** Sketch dimension equations indexed by the constraint id for the
   * CURRENTLY ACTIVE sketch only. Empty Record when no sketch is open.
   * Feeds the viewer's drivenDimensions input so the dim labels get a
   * Σ badge and the inline editor pre-fills with `=expression`. */
  drivenSketchDimensions = computed<Record<string, string>>(() => {
    const sid = this.activeSketchId();
    if (!sid) return {};
    const out: Record<string, string> = {};
    const prefix = `sketch.${sid}.constraint.`;
    for (const [key, entry] of Object.entries(this.equations().entries)) {
      if (key.startsWith(prefix)) {
        out[key.substring(prefix.length)] = entry.expression;
      }
    }
    return out;
  });
  activeSketchId = signal<SketchId | null>(null);
  selected = signal<string | null>(null);
  fullscreen = signal<boolean>(false);
  partID = signal<number | null>(null);
  geometry = signal<ModelGeometry | null>(null);
  // Multi-body state. Each entry is one body in the part; faces are kept
  // per-body so a hidden body just drops out of the union. The body
  // roster (id + name) is what the Bodies panel renders. Visibility is
  // transient — a hidden body's faces are excluded from the rendered
  // geometry but the body itself stays in the roster.
  bodies = signal<Array<{ id: string; name: string | null }>>([]);
  hiddenBodies = signal<Set<string>>(new Set());
  /** Per-body { faces, topology } populated as regen events arrive.
   * geometry() is derived by merging visible bodies' contents. */
  private perBodyGeometry = signal<Map<string, { faces: any[]; topology: ModelTopology }>>(new Map());

  /** Resolve the owning BODY id for a given face id by scanning the
   * per-body slots. Don't use `face.featureId` for this — that field
   * is the LATEST feature that touched the body (e.g. a pattern,
   * combine, or move/copy), which diverges from `body.id` whenever
   * a downstream feature has run since the additive root. */
  bodyIdForFaceId(faceId: string): string | null {
    const perBody = this.perBodyGeometry();
    for (const [bodyId, slot] of perBody.entries()) {
      if (slot.faces.some(f => f.faceId === faceId)) return bodyId;
    }
    return null;
  }

  stepExporting = signal<boolean>(false);

  /** Visible bodies as { id, label } for the export dialog. Unnamed bodies
   * fall back to "Body N" (1-indexed in body order). */
  private _exportBodies(): Array<{ id: string; label: string }> {
    const hidden = this.hiddenBodies();
    const out: Array<{ id: string; label: string }> = [];
    this.bodies().forEach((b, i) => {
      if (hidden.has(b.id)) return;
      out.push({ id: b.id, label: (b.name && b.name.trim()) ? b.name.trim() : `Body ${i + 1}` });
    });
    return out;
  }

  /** Filename variables for export name templates (#{partNumber} etc.).
   * `bodyName` is added per body at export time. */
  private _exportVars(): Record<string, string> {
    const p = this.part();
    return {
      partNumber: String(p?.sku || p?.name || ''),
      rev: String(p?.revision || ''),
      partRevision: String(p?.revision || ''),
      partName: String(p?.name || ''),
      manufacturerPN: String(p?.manufacturerPN || ''),
    };
  }

  private async _downloadZip(files: Array<{ name: string; data: ArrayBuffer | Uint8Array | string }>, filename: string): Promise<void> {
    const zip = new JSZip();
    for (const f of files) zip.file(f.name, f.data);
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    this._downloadBlob(blob, filename);
  }

  /** STL export — opens the body-selection dialog, then serializes on the
   * client (no kernel round-trip). */
  exportStl(): void {
    const bodies = this._exportBodies();
    if (bodies.length === 0) {
      this.errors.showError('Nothing to export — the model has no visible bodies.');
      return;
    }
    this.dialog.open(CadExportDialogComponent, { data: { format: 'STL', bodies, vars: this._exportVars() }, width: '380px' })
      .afterClosed().subscribe((res: ExportDialogResult | null) => {
        if (!res) return;
        this._runStlExport(res, bodies);
      });
  }

  private _runStlExport(res: ExportDialogResult, bodies: Array<{ id: string; label: string }>): void {
    const perBody = this.perBodyGeometry();
    const vars = this._exportVars();
    const labelOf = (id: string) => bodies.find(b => b.id === id)?.label ?? id;
    const nameFor = (bodyName: string) => resolveExportName(res.nameTemplate, { ...vars, bodyName });
    const meshesFor = (id: string): Array<{ positions: ArrayLike<number>; indices: ArrayLike<number> }> => {
      const slot = perBody.get(id);
      if (!slot) return [];
      return slot.faces
        .filter(f => f.positions && f.indices && f.indices.length >= 3)
        .map(f => ({ positions: f.positions, indices: f.indices }));
    };
    if (res.separate) {
      const files: Array<{ name: string; data: ArrayBuffer }> = [];
      for (const id of res.bodyIds) {
        const meshes = meshesFor(id);
        if (meshes.length === 0) continue;
        files.push({ name: `${nameFor(labelOf(id))}.stl`, data: buildBinaryStl(meshes) });
      }
      if (files.length === 0) { this.errors.showError('Nothing to export.'); return; }
      if (res.zip) {
        void this._downloadZip(files, `${nameFor('')}.zip`);
      } else {
        for (const f of files) this._downloadBlob(new Blob([f.data], { type: 'model/stl' }), f.name);
      }
    } else {
      const meshes = res.bodyIds.flatMap(meshesFor);
      if (meshes.length === 0) { this.errors.showError('Nothing to export.'); return; }
      const buf = buildBinaryStl(meshes);
      this._downloadBlob(new Blob([buf], { type: 'model/stl' }), `${nameFor('')}.stl`);
    }
  }

  /** STEP export — opens the body-selection dialog, then round-trips through
   * the backend (the kernel serializes the real BRep). */
  exportStep(): void {
    if (this.stepExporting()) return;
    const bodies = this._exportBodies();
    if (bodies.length === 0) {
      this.errors.showError('Nothing to export — the model has no visible bodies.');
      return;
    }
    this.dialog.open(CadExportDialogComponent, { data: { format: 'STEP', bodies, vars: this._exportVars() }, width: '380px' })
      .afterClosed().subscribe((res: ExportDialogResult | null) => {
        if (!res) return;
        this._runStepExport(res, bodies);
      });
  }

  private _runStepExport(res: ExportDialogResult, bodies: Array<{ id: string; label: string }>): void {
    const m = this.model();
    if (!m) return;
    const vars = this._exportVars();
    const labelOf = (id: string) => bodies.find(b => b.id === id)?.label ?? id;
    const nameFor = (bodyName: string) => resolveExportName(res.nameTemplate, { ...vars, bodyName });
    this.stepExporting.set(true);
    if (res.separate) {
      // One backend call per body (each STEP file holds a single body).
      const files: Array<{ name: string; data: string }> = [];
      const exportAt = (i: number): void => {
        if (i >= res.bodyIds.length) {
          this.stepExporting.set(false);
          if (files.length === 0) { this.errors.showError('STEP export returned no geometry.'); return; }
          if (res.zip) {
            void this._downloadZip(files, `${nameFor('')}.zip`);
          } else {
            for (const f of files) this._downloadBlob(new Blob([f.data], { type: 'application/step' }), f.name);
          }
          return;
        }
        const id = res.bodyIds[i];
        this.cadApi.exportStep(m.id, [id]).subscribe({
          next: (step) => {
            if (step && step.trim()) {
              files.push({ name: `${nameFor(labelOf(id))}.step`, data: step });
            }
            exportAt(i + 1);
          },
          error: (err) => { this.stepExporting.set(false); this.errors.showError(err?.error?.error || 'STEP export failed.'); },
        });
      };
      exportAt(0);
    } else {
      this.cadApi.exportStep(m.id, res.bodyIds).subscribe({
        next: (step) => {
          this.stepExporting.set(false);
          if (!step || !step.trim()) { this.errors.showError('STEP export returned no geometry.'); return; }
          this._downloadBlob(new Blob([step], { type: 'application/step' }), `${nameFor('')}.step`);
        },
        error: (err) => { this.stepExporting.set(false); this.errors.showError(err?.error?.error || 'STEP export failed.'); },
      });
    }
  }

  private _downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Sum of mesh-derived volumes for every VISIBLE body, in mm³.
   * Computed via divergence theorem on each face mesh: for each
   * triangle (v0, v1, v2), the signed tetrahedral volume to the origin
   * is (v0 · (v1 × v2)) / 6; summed across all triangles of a closed
   * outward-oriented body, the absolute total is the enclosed volume.
   * Updates whenever perBodyGeometry or hiddenBodies changes. */
  totalVolumeMm3 = computed<number>(() => {
    const perBody = this.perBodyGeometry();
    const hidden = this.hiddenBodies();
    let total = 0;
    for (const body of this.bodies()) {
      if (hidden.has(body.id)) continue;
      const slot = perBody.get(body.id);
      if (!slot) continue;
      let signedSum = 0;
      for (const face of slot.faces) {
        const positions: Float32Array | number[] = face.positions;
        const indices: Uint32Array | number[] = face.indices;
        if (!positions || !indices) continue;
        for (let t = 0; t + 2 < indices.length; t += 3) {
          const i0 = (indices[t] as number) * 3;
          const i1 = (indices[t + 1] as number) * 3;
          const i2 = (indices[t + 2] as number) * 3;
          const x0 = positions[i0], y0 = positions[i0 + 1], z0 = positions[i0 + 2];
          const x1 = positions[i1], y1 = positions[i1 + 1], z1 = positions[i1 + 2];
          const x2 = positions[i2], y2 = positions[i2 + 1], z2 = positions[i2 + 2];
          // v0 · (v1 × v2)
          signedSum +=
            x0 * (y1 * z2 - z1 * y2) +
            y0 * (z1 * x2 - x1 * z2) +
            z0 * (x1 * y2 - y1 * x2);
        }
      }
      total += Math.abs(signedSum / 6);
    }
    return total;
  });

  /** Human-readable volume for the footer: switch units when the
   * number gets unwieldy (≥ 1 cm³ → cm³, ≥ 1 m³ → m³). */
  totalVolumeLabel = computed<string>(() => {
    const v = this.totalVolumeMm3();
    if (!isFinite(v) || v <= 0) return '0 mm³';
    if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(3)} m³`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(3)} cm³`;
    return `${v.toFixed(2)} mm³`;
  });

  /** Copy the full-precision mm³ value to the clipboard. The footer
   * label rounds to 2–3 decimals to stay legible; this lets the user
   * grab the underlying number for paste-into-spreadsheet workflows. */
  copyTotalVolume(): void {
    const v = this.totalVolumeMm3();
    if (!isFinite(v) || v <= 0) return;
    const text = `${v} mm³`;
    const showCopied = () => this.errors.showError(`Copied ${text}`);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(showCopied, () => {
        this.errors.showError('Could not copy to clipboard (browser denied access).');
      });
    } else {
      // Older browsers without async clipboard — fall back to a
      // temporary textarea + execCommand. Still works on http://
      // contexts where the secure-context API isn't available.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); showCopied(); }
      finally { document.body.removeChild(ta); }
    }
  }

  /** SolidWorks-style rollback bar position. Index into
   * featureTree.features — the bar sits BEFORE this index, so features
   * with index >= rollbackBeforeIndex are "rolled back" (excluded from
   * the rendered model). null means the bar is at the end (no rollback).
   * Transient — not persisted with the model. */
  rollbackBeforeIndex = signal<number | null>(null);
  /** Raw last-regen feature list, kept so dragging the rollback bar can
   * re-derive perBodyGeometry locally without re-running regen. */
  private latestRegenFeatures = signal<Array<{
    featureId: string; bodyId: string | null;
    faces: any[]; topology: ModelTopology;
    error?: string; cached: boolean;
  }>>([]);
  // Phase 1: server-side regen is in flight. The viewer's loading overlay
  // reads this. Old kernelLoading + kernelLoadStatus signals were tied to
  // the deleted client-side OCCT loader.
  regenLoading = signal<boolean>(false);
  regenError = signal<string | null>(null);
  // Per-feature failures from the last regenerate pass. Cleared on regen
  // start, updated as feature-result events arrive (or the HTTP response
  // finalizes for clients without an active WS).
  featureErrors = signal<Map<string, string>>(new Map());
  // Per-feature compute errors for user datum planes (REQ 657). The
  // kernel never touches these features, so kernel-side feature errors
  // miss them. This map is populated by the geometry effect and
  // merged into `featureErrors` via a computed signal so the existing
  // feature-tree error indicator works.
  userDatumErrors = signal<Map<string, string>>(new Map());
  /** Union of kernel-emitted feature errors + frontend-computed user
   * datum errors. The feature-tree panel reads this. */
  mergedFeatureErrors = computed<Map<string, string>>(() => {
    const out = new Map(this.featureErrors());
    for (const [id, err] of this.userDatumErrors()) out.set(id, err);
    return out;
  });
  // Per-feature streaming progress: how many features the WS has confirmed
  // since the last regenerate-started event, vs how many we expect from the
  // current featureTree. Resets to 0/0 between regen passes.
  regenStreamedCount = signal<number>(0);
  regenExpectedCount = signal<number>(0);
  regenProgressText = computed<string>(() => {
    if (!this.regenLoading()) return '';
    const total = this.regenExpectedCount();
    const done = this.regenStreamedCount();
    if (total === 0) return '';
    return `feature ${Math.min(done + 1, total)} of ${total}`;
  });
  // Active-sketch projections for the constraint list panel. Returning the
  // empty arrays when no sketch is active keeps consumers from re-binding
  // on every doc() change.
  activeSketchConstraints = computed(() => {
    const sid = this.activeSketchId();
    if (!sid) return [];
    return this.doc().sketches[sid]?.state.constraints ?? [];
  });
  activeSketchEntities = computed(() => {
    const sid = this.activeSketchId();
    if (!sid) return [];
    return this.doc().sketches[sid]?.state.entities ?? [];
  });

  /** REQ Batch 6 — return the single selected entity if its kind is
   * one of the new editable-property types, else null. Drives the
   * sketch entity properties panel. */
  sketchEntityProps = computed<
    | import('../../../cad/lib/types').TextEntity
    | import('../../../cad/lib/types').PictureEntity
    | import('../../../cad/lib/types').EquationCurveEntity
    | null
  >(() => {
    const sketchRef = this.sketchEditorRef();
    if (!sketchRef) return null;
    const sel = sketchRef.selected();
    if (sel.size !== 1) return null;
    const sid = this.activeSketchId();
    if (!sid) return null;
    const id = Array.from(sel)[0];
    const e = this.doc().sketches[sid]?.state.entities.find(x => x.id === id);
    if (!e) return null;
    if (e.kind === 'text' || e.kind === 'picture' || e.kind === 'equation') return e;
    return null;
  });
  kernelBadgeLabel = computed<string>(() => {
    if (!this.stream.connected()) return 'Kernel offline';
    if (this.regenLoading()) {
      const txt = this.regenProgressText();
      return txt ? `Regenerating · ${txt}` : 'Regenerating';
    }
    return 'Idle';
  });
  kernelBadgeTooltip = computed<string>(() => {
    if (!this.stream.connected()) {
      return 'Stream disconnected — the editor still works via HTTP but won’t see per-feature progress.';
    }
    return this.regenLoading() ? 'Kernel is regenerating geometry' : 'Kernel idle, stream connected';
  });
  mode = signal<EditorMode>('idle');
  pendingExtrude = signal<boolean>(false);
  // REQ 616 — ribbon tab. Auto-switches to 'sketch' when activeSketchId becomes
  // non-null and back to 'features' when it clears; user can manually override.
  activeTab = signal<'features' | 'sketch'>('features');
  // REQ 619 — display mode for the 3D viewer (session state, not persisted).
  displayMode = signal<DisplayMode>('visible-edges');
  // REQ 623 — feature multi-select. Updated by viewer's featureClick event.
  selectedFeatures = signal<Set<string>>(new Set());
  selectedSketches = signal<Set<string>>(new Set());

  // Extrude PropertyManager — replaces the previous MatDialog so the
  // workflow matches the sketch-side tool sidebars (Fillet / Chamfer /
  // Mirror). `extrudeSidebar` carries the sketch the user is extruding
  // and how many closed loops are available; the distance / flipped /
  // loop-selection inputs are separate signals so the OK button reads
  // them directly on commit.
  /** Split-button mode for Extrude / Revolve / Sweep — picks which
   * variant (Boss / Cut) fires when the user clicks the main button.
   * The dropdown chevron lets them switch + remember the new default. */
  extrudeMode = signal<'boss' | 'cut'>('boss');
  revolveMode = signal<'boss' | 'cut'>('boss');
  sweepMode = signal<'boss' | 'cut'>('boss');

  /** Dispatch the active mode for each split-button. */
  invokeExtrude(): void { this.extrudeMode() === 'cut' ? this.onCutExtrudeAction() : this.onExtrudeAction(); }
  invokeRevolve(): void { this.revolveMode() === 'cut' ? this.onCutRevolveAction() : this.onRevolveAction(); }
  invokeSweep(): void { this.sweepMode() === 'cut' ? this.onCutSweepAction() : this.onSweepAction(); }

  extrudeSidebar = signal<{
    sketchId: string;
    regionCount: number;
    /** Which feature kind to emit on commit — 'extrude' (additive) or
     * 'cutExtrude' (subtractive). Drives the sidebar title/icon + which
     * factory call _applyExtrude routes to. */
    mode: 'extrude' | 'cutExtrude';
    /** When set, OK updates that existing feature instead of creating a
     * new one. The "Edit feature" tree action opens this mode. */
    editingFeatureId?: string;
  } | null>(null);
  extrudeDistance = signal<number>(10);
  // Pending expression signals (REQ 641). Non-null when the dim-input
  // is currently bound to an `=expr` value. On commit, written into
  // equations.entries[`feature.<id>.distance`] (and friends). On edit
  // load, populated from the existing entry.
  extrudeDistanceExpression = signal<string | null>(null);
  extrudeDir2DistanceExpression = signal<string | null>(null);
  extrudeStartOffsetExpression = signal<string | null>(null);
  revolveAngleExpression = signal<string | null>(null);
  extrudeFlipped = signal<boolean>(false);
  /** "Merge result" checkbox in the Extrude sidebar. Default true: the
   * new prism fuses into the most-recent existing body. False creates
   * a new disjoint body. Cut Extrude ignores this field. */
  extrudeMerge = signal<boolean>(true);
  /** SolidWorks-style end condition. Drives the sidebar UI (which fields
   * to show + which picker affordance to surface) and translates into a
   * resolved kernel call in the backend. */
  extrudeEndKind = signal<ExtrudeEndCondition['kind']>('blind');
  /** Vertex id picked for the Up to Vertex condition. Cleared when the
   * user switches to a different end kind. Populated by the vertex
   * picker overlay. */
  extrudeUpToVertexId = signal<string | null>(null);
  /** When true, the viewer renders vertex markers and restricts click
   * hit-testing to those markers (face/datum/region picks are
   * suppressed). Driven by the "Pick a vertex" button in the Extrude
   * sidebar; cleared after a vertex is picked or the panel closes. */
  vertexPickMode = signal<boolean>(false);
  /** Face id picked for Up to Surface. Cleared when the user switches
   * end-condition kind. Populated by the face picker overlay. */
  extrudeUpToFaceId = signal<string | null>(null);
  /** Face-pick mode flag (mutually exclusive with vertexPickMode). */
  facePickMode = signal<boolean>(false);
  /** Distance + flip for the end-condition "Offset from face" option.
   * Reuses extrudeUpToFaceId for the picked face (the picker is the
   * same — only the resolution adds an offset along the face normal). */
  extrudeOffsetFromFaceDistance = signal<number>(10);
  extrudeOffsetFromFaceFlipped = signal<boolean>(false);
  extrudeOffsetFromFaceExpression = signal<string | null>(null);

  // Start condition + Direction 2 ─────────────────────────────────────
  /** Where the extrude profile begins along the plane normal. Default
   * 'sketchPlane' matches the historical behaviour. */
  extrudeStartKind = signal<'sketchPlane' | 'offset' | 'upToVertex' | 'upToSurface' | 'offsetFromSurface'>('sketchPlane');
  /** Always non-negative — the SW-style "magnitude" of the offset. Sign
   * comes from `extrudeStartOffsetFlipped`. Persisted on the feature as
   * a signed distance (flip baked into the sign). */
  extrudeStartOffset = signal<number>(0);
  extrudeStartOffsetFlipped = signal<boolean>(false);
  /** Start condition's Up-to-Vertex / Up-to-Surface targets. Parallel
   * to the direction-1 versions; reset on kind switch + sidebar open. */
  extrudeStartUpToVertexId = signal<string | null>(null);
  extrudeStartUpToFaceId = signal<string | null>(null);
  extrudeStartUpToFaceFallback = signal<{ origin: [number, number, number]; normal: [number, number, number] } | null>(null);
  /** Distance + flip for the start-condition "Offset from face" option. */
  extrudeStartOffsetFromFaceDistance = signal<number>(0);
  extrudeStartOffsetFromFaceFlipped = signal<boolean>(false);
  extrudeStartOffsetFromFaceExpression = signal<string | null>(null);
  /** Which target the next pick result feeds — 'start' or 'end'. Lets
   * the START and DIRECTION-1 sections share `vertexPickMode` /
   * `facePickMode` without confusing which signal to write to. */
  extrudePickTarget = signal<'start' | 'end' | 'end2'>('end');
  /** When true, the sidebar exposes a Direction 2 row whose own distance
   * + end condition combine with Direction 1 to grow a single feature in
   * both directions from the start plane. SolidWorks-style. */
  extrudeDir2Enabled = signal<boolean>(false);
  extrudeDir2Distance = signal<number>(10);
  extrudeDir2EndKind = signal<ExtrudeEndCondition['kind']>('blind');
  /** Direction-2 mirrors of the direction-1 picker / offset signals so
   * dir 2 can use the full set of end conditions (sans midPlane). */
  extrudeDir2UpToVertexId = signal<string | null>(null);
  extrudeDir2UpToFaceId = signal<string | null>(null);
  extrudeDir2UpToFaceFallback = signal<{ origin: [number, number, number]; normal: [number, number, number] } | null>(null);
  extrudeDir2OffsetFromFaceDistance = signal<number>(10);
  extrudeDir2OffsetFromFaceFlipped = signal<boolean>(false);
  extrudeDir2OffsetFromFaceExpression = signal<string | null>(null);

  // ── Revolve sidebar ───────────────────────────────────────────────────
  // Parallel to extrudeSidebar but for RevolveFeature. Carries the host
  // sketch and edit-mode flag; angle / axis / flipped live in their own
  // signals so commit reads them at OK time. profileFills computed
  // listens to both sidebars so the canvas region overlay works for
  // either flow.
  revolveSidebar = signal<{
    sketchId: string;
    regionCount: number;
    /** 'revolve' (additive, default) or 'cutRevolve' (subtractive). Drives
     * the sidebar title/icon + which factory call _applyRevolve routes to. */
    mode: 'revolve' | 'cutRevolve';
    editingFeatureId?: string;
  } | null>(null);
  revolveAngle = signal<number>(360);
  revolveFlipped = signal<boolean>(false);
  /** Sketched line id picked as the rotation axis. */
  revolveAxisLineId = signal<string | null>(null);

  // ── 3D Fillet / Chamfer sidebar ────────────────────────────────────────
  // Shared sidebar handles both kinds (toggled by `kind`). Edges are
  // accumulated into `edgeBlendEdges` as the user picks them in the
  // viewer while `edgePickMode` is true.
  edgeBlendSidebar = signal<{
    kind: 'fillet' | 'chamfer';
    editingFeatureId?: string;
  } | null>(null);
  edgeBlendValue = signal<number>(2);
  edgeBlendValueExpression = signal<string | null>(null);
  // Each picked edge can be tagged with `faceId` to mark it as having
  // come from a face-expansion pick (SolidWorks-style "click face → all
  // boundary edges"). The UI groups all entries sharing a `faceId` into
  // a single "Face N" row so the user sees the face as one item rather
  // than N separate edges. Items without `faceId` are individually-
  // picked edges and render one per row.
  edgeBlendEdges = signal<Array<{ edgeId: string; start: [number, number, number]; end: [number, number, number]; value?: number; faceId?: string; edgeGroupId?: string }>>([]);
  // SolidWorks-style tangent propagation toggle. When ON (default),
  // picking one edge auto-picks every tangent-continuous neighbor — so
  // one click on a hole rim selects all four arcs of the circumference.
  edgeBlendTangentPropagation = signal<boolean>(true);
  // ── Datum Plane sidebar — REQ 657 ──────────────────────────────────
  // Eight construction methods. The sidebar's required picks + scalars
  // vary by method; each pick slot is its own signal. Pick handlers
  // (vertex / edge / face) route to whichever slot the active method
  // needs next.
  datumPlaneSidebar = signal<{
    method:
      | 'offset'
      | 'parallelThroughPoint'
      | 'angleThroughEdge'
      | 'threePoints'
      | 'midPlane'
      | 'lineAndPerpFace'
      | 'pointAndPerpEdge'
      | 'tangentCylinder';
    editingFeatureId?: string;
  } | null>(null);
  /** First plane/face reference slot. Used by methods: offset,
   * parallelThroughPoint, angleThroughEdge, midPlane (A),
   * lineAndPerpFace, tangentCylinder. */
  datumPlaneRefA = signal<PlaneRef | null>(null);
  /** Second plane/face reference slot — midPlane (B) only. */
  datumPlaneRefB = signal<PlaneRef | null>(null);
  /** Edge ref slot — angleThroughEdge, lineAndPerpFace, pointAndPerpEdge. */
  datumPlaneEdge = signal<EdgeRef3D | null>(null);
  /** Vertex slots (0–3) — threePoints uses all three, parallelThroughPoint
   * + pointAndPerpEdge use the first slot. */
  datumPlaneVertices = signal<VertexRef[]>([]);
  /** Cylindrical-face id for tangentCylinder. */
  datumPlaneCylinderFaceId = signal<string | null>(null);
  /** Scalar inputs — distance (offset, mm), angle (angleThroughEdge, deg). */
  datumPlaneDistance = signal<number>(10);
  datumPlaneDistanceExpression = signal<string | null>(null);
  datumPlaneAngle = signal<number>(45);
  datumPlaneAngleExpression = signal<string | null>(null);
  /** Flip direction for offset / tangentCylinder. */
  datumPlaneFlipped = signal<boolean>(false);

  // ── Combine sidebar — REQ 662 ──────────────────────────────────────
  /** Combine boolean-op feature between bodies. The user picks one
   * target body + one or more tool bodies; the operation drops the
   * tool bodies and replaces the target with the resulting solid
   * (or multiple solids if the operation splits the target). */
  combineSidebar = signal<{ editingFeatureId?: string } | null>(null);
  combineOperation = signal<'add' | 'subtract' | 'common'>('add');
  combineTargetBodyId = signal<string | null>(null);
  combineToolBodyIds = signal<string[]>([]);
  /** Which slot the next face-click sets: 'target' or 'tool'. */
  combinePickTarget = signal<'target' | 'tool'>('target');

  combineTargetRows = computed<SelectionRow[]>(() => {
    const id = this.combineTargetBodyId();
    return id ? [{ id: 'target', label: `Body ${id}`, icon: 'view_in_ar' }] : [];
  });
  combineToolRows = computed<SelectionRow[]>(() =>
    this.combineToolBodyIds().map((id, i) => ({ id: `tool:${i}`, label: `Body ${id}`, icon: 'view_in_ar' })));

  // ── Mirror Body sidebar — REQ 666 ──────────────────────────────────
  mirrorBodySidebar = signal<{ editingFeatureId?: string } | null>(null);
  mirrorBodyPlaneRef = signal<PlaneRef | null>(null);
  /** Snapshot captured at pick time so the dispatcher doesn't have
   * to re-resolve datums. Updated whenever planeRef changes. */
  mirrorBodyPlaneSnapshot = signal<Plane3 | null>(null);
  mirrorBodyBodyIds = signal<string[]>([]);
  mirrorBodyKeepOriginals = signal<boolean>(true);
  /** Which slot the next face-click sets: the mirror plane or a body. */
  mirrorBodyPickTarget = signal<'plane' | 'body'>('plane');

  mirrorBodyPlaneRows = computed<SelectionRow[]>(() => {
    const r = this.mirrorBodyPlaneRef();
    if (!r) return [];
    const label = r.kind === 'datum' ? String(r.datumId).replace(/_/g, ' ') : `face ${r.faceId}`;
    return [{ id: 'plane', label, icon: 'filter_none' }];
  });
  mirrorBodyRows = computed<SelectionRow[]>(() =>
    this.mirrorBodyBodyIds().map((id, i) => ({ id: `b:${i}`, label: `Body ${id}`, icon: 'view_in_ar' })));
  mirrorBodyPlaneDatumOption = computed<string>(() => {
    const r = this.mirrorBodyPlaneRef();
    return r?.kind === 'datum' ? String(r.datumId) : '';
  });

  // ── Move/Copy Body sidebar — REQ 667 ───────────────────────────────
  moveCopyBodySidebar = signal<{ editingFeatureId?: string } | null>(null);
  moveCopyBodyIds = signal<string[]>([]);
  moveCopyTx = signal<number>(0);
  moveCopyTy = signal<number>(0);
  moveCopyTz = signal<number>(0);
  moveCopyRotateEnabled = signal<boolean>(false);
  moveCopyAxisId = signal<'x_axis' | 'y_axis' | 'z_axis'>('z_axis');
  moveCopyAngleDeg = signal<number>(0);
  moveCopyCopy = signal<boolean>(true);

  moveCopyBodyRows = computed<SelectionRow[]>(() =>
    this.moveCopyBodyIds().map((id, i) => ({ id: `b:${i}`, label: `Body ${id}`, icon: 'view_in_ar' })));

  // ── Hole Wizard sidebar — REQ 663 ──────────────────────────────────
  /** Standardized-hole feature. Each placement was captured by
   * clicking a face in the viewer; the click point becomes the hole
   * center and the face normal sets the hole axis. */
  holeSidebar = signal<{ editingFeatureId?: string } | null>(null);
  holeType = signal<'drill' | 'counterbore' | 'countersink' | 'tapped'>('drill');
  holeStandard = signal<HoleStandard>('iso');
  holeSize = signal<HoleSizeKey>('M3');
  holeEndKind = signal<'throughAll' | 'blind'>('throughAll');
  holeDepth = signal<number>(10);
  holeFlipped = signal<boolean>(false);
  /** Per-click placements. Cleared on sidebar open/cancel; pre-filled
   * when editing an existing Hole feature. */
  holePlacements = signal<import('../../../cad/lib/types').HolePlacement[]>([]);
  /** Per-dimension overrides. `null` = use the spec table value. */
  holeDrillDiaOverride = signal<number | null>(null);
  holeCboreDiaOverride = signal<number | null>(null);
  holeCboreDepthOverride = signal<number | null>(null);
  holeCskDiaOverride = signal<number | null>(null);
  holeCskAngleOverride = signal<number | null>(null);

  /** Size options that match the active standard. Re-derived when the
   * standard changes so the dropdown never shows a stale set. */
  holeSizeOptions = computed(() => holeSizeOptionsFor(this.holeStandard()));
  /** Active spec — used by sidebar placeholders so the user sees the
   * spec value as the "what you get if you leave this empty" hint. */
  holeSpec_ = computed(() => holeSpec(this.holeStandard(), this.holeSize()));
  /** Resolved drill diameter for display (override wins over spec).
   * Mirrors the dispatch-time resolution so the placeholder is the
   * actual default value. */
  holeSpecDrillDia = computed(() => {
    const s = this.holeSpec_();
    return this.holeType() === 'tapped' ? s.tapDrillDiameter : s.clearanceDrillDiameter;
  });

  holePlacementRows = computed<SelectionRow[]>(() =>
    this.holePlacements().map((p, i) => ({
      id: `pl:${i}`,
      label: p.faceId.startsWith('vertex:')
        ? `Hole ${i + 1} — vertex ${p.faceId.slice('vertex:'.length)}`
        : `Hole ${i + 1} — face ${p.faceId}`,
      icon: p.faceId.startsWith('vertex:') ? 'fiber_manual_record' : 'radio_button_unchecked',
    })));
  /** REQ 665 — Cosmetic-threads visibility toggle. Mirrors how the
   * Datums group is hidden as a whole via the tree's eye-icon. */
  cosmeticThreadsVisible = signal<boolean>(true);

  /** REQ 665 — One thread shell per tapped placement across every
   * Hole feature in the active tree. Rolled-back / suppressed /
   * hidden Hole features are excluded so what you see matches what
   * the kernel built. This computed runs INDEPENDENTLY of the
   * cosmetic-threads visibility toggle so the tree's "Cosmetic
   * Threads (N)" row stays at N>0 when the user just hides the
   * overlay (count is the # of placements; visibility only gates
   * the viewer input below). */
  private cosmeticThreadsAll = computed<CosmeticThread[]>(() => {
    const features = this.featureTree().features;
    const cutoff = this.rollbackBeforeIndex();
    const out: CosmeticThread[] = [];
    for (let i = 0; i < features.length; i++) {
      if (cutoff !== null && i >= cutoff) break;
      const f = features[i];
      if (f.type !== 'hole') continue;
      if ((f as any).holeType !== 'tapped') continue;
      if ((f as any).suppressed) continue;
      if ((f as any).visible === false) continue;
      const hf = f as import('../../../cad/lib/types').HoleFeature;
      let spec: ReturnType<typeof holeSpec>;
      try { spec = holeSpec(hf.standard, hf.size); } catch { continue; }
      const flipped = hf.flipped === true;
      const sign = flipped ? +1 : -1;
      const isBlind = hf.endCondition.kind === 'blind';
      const depth = hf.endCondition.kind === 'blind' ? hf.endCondition.depth : Infinity;
      // Tap-drill Ø honors the user's drill override so the stripe
      // band lines up with whatever cut the kernel actually made.
      const drillDia = hf.drillDiameterOverride && hf.drillDiameterOverride > 0
        ? hf.drillDiameterOverride : spec.tapDrillDiameter;
      for (const pl of hf.placements) {
        out.push({
          position: pl.position,
          axis: [sign * pl.faceNormal[0], sign * pl.faceNormal[1], sign * pl.faceNormal[2]],
          drillDiameter: drillDia,
          pitch: spec.threadPitch,
          depth,
          fitToBody: !isBlind,
        });
      }
    }
    return out;
  });

  /** Threads passed to the viewer — empty array when the visibility
   * toggle is off so the render group clears. Count for the tree row
   * comes from `cosmeticThreadsAll`. */
  cosmeticThreads = computed<CosmeticThread[]>(() =>
    this.cosmeticThreadsVisible() ? this.cosmeticThreadsAll() : []);
  cosmeticThreadsTotalCount = computed<number>(() => this.cosmeticThreadsAll().length);

  /** Translucent hole previews — one entry per placement, fed to the
   * viewer's holePreviews input. Empty when the sidebar is closed so
   * nothing renders for committed Hole features (those show real
   * cut geometry from the kernel). Dimensions are already resolved
   * (override ?? spec) so the preview reflects exactly what the
   * dispatcher will cut. */
  holePreviews = computed<HolePreview[]>(() => {
    if (!this.holeSidebar()) return [];
    const spec = this.holeSpec_();
    const drillD = this.holeDrillDiaOverride() ?? this.holeSpecDrillDia();
    const cboreD = this.holeCboreDiaOverride() ?? spec.counterboreDiameter;
    const cboreH = this.holeCboreDepthOverride() ?? spec.counterboreDepth;
    const cskD = this.holeCskDiaOverride() ?? spec.countersinkDiameter;
    const cskAng = this.holeCskAngleOverride() ?? spec.countersinkAngleDeg;
    const cskDepth = (cskD / 2) / Math.tan((cskAng / 2) * Math.PI / 180);
    const drillDepth = this.holeEndKind() === 'blind'
      ? this.holeDepth() : 200;  // through-all preview length; backend uses sentinel
    const kind = this.holeType();
    const flipped = this.holeFlipped();
    return this.holePlacements().map(p => {
      // Hole axis points INTO the body — opposite of the face normal
      // unless the user flipped it.
      const sign = flipped ? +1 : -1;
      const axis: [number, number, number] = [sign * p.faceNormal[0], sign * p.faceNormal[1], sign * p.faceNormal[2]];
      return {
        position: p.position,
        axis,
        drillDiameter: drillD,
        drillDepth,
        ...(kind === 'counterbore' ? { counterbore: { diameter: cboreD, depth: cboreH } } : {}),
        ...(kind === 'countersink' ? { countersink: { diameter: cskD, depth: cskDepth } } : {}),
      };
    });
  });

  // ── Datum Axis sidebar — REQ 660 ───────────────────────────────────
  /** Datum Axis sidebar context. 5 construction methods; pick slots
   * live in dedicated signals so each method dispatches its picks to
   * the right targets without leaking across methods. */
  datumAxisSidebar = signal<{
    method:
      | 'twoPoints'
      | 'alongEdge'
      | 'twoPlanesIntersection'
      | 'cylindricalFaceAxis'
      | 'pointAndPerpFace';
    editingFeatureId?: string;
  } | null>(null);
  /** Two-Points: needs two vertex picks (A then B). */
  datumAxisVertexA = signal<VertexRef | null>(null);
  datumAxisVertexB = signal<VertexRef | null>(null);
  /** Along-Edge + Point-And-Perp-Face: edge ref for axis along edge,
   * NOT used by point-and-perp-face (which uses planeRef instead). */
  datumAxisEdge = signal<EdgeRef3D | null>(null);
  /** Two-Planes-Intersection: two plane references. */
  datumAxisPlaneA = signal<PlaneRef | null>(null);
  datumAxisPlaneB = signal<PlaneRef | null>(null);
  /** Cylindrical-Face-Axis: picked face id + snapshot axis captured
   * at pick time (so geometry compute can resolve without re-walking
   * the BREP). */
  datumAxisCylinderFaceId = signal<string | null>(null);
  datumAxisCylinderFallback = signal<import('../../../cad/lib/types').Axis3 | null>(null);
  /** Point-And-Perp-Face: vertex + plane. Reuses datumAxisPlaneA for
   * the plane slot since the method only needs one. */

  // ── Datum Point sidebar — REQ 661 ──────────────────────────────────
  datumPointSidebar = signal<{
    method:
      | 'onVertex'
      | 'centerOfFace'
      | 'centerOfCircularEdge'
      | 'centerOfMass'
      | 'alongEdge';
    editingFeatureId?: string;
  } | null>(null);
  datumPointVertex = signal<VertexRef | null>(null);
  /** Center-Of-Face: picked face id + centroid snapshot for renumber survival. */
  datumPointFaceId = signal<string | null>(null);
  datumPointFaceFallback = signal<[number, number, number] | null>(null);
  /** Edge slot — used by centerOfCircularEdge AND alongEdge methods. */
  datumPointEdge = signal<EdgeRef3D | null>(null);
  /** Along-Edge: parametric position 0–1 (default 0.5 = midpoint). */
  datumPointT = signal<number>(0.5);
  /** Center-Of-Mass: body id + centroid snapshot. */
  datumPointBodyId = signal<string | null>(null);
  datumPointBodyFallback = signal<[number, number, number] | null>(null);

  /** Selection-list rows for the datum-axis picks (one per slot). */
  datumAxisVertexARows = computed<SelectionRow[]>(() =>
    this.datumAxisVertexA() ? [{ id: 'vtxA', label: 'Vertex A', icon: 'place' }] : []);
  datumAxisVertexBRows = computed<SelectionRow[]>(() =>
    this.datumAxisVertexB() ? [{ id: 'vtxB', label: 'Vertex B', icon: 'place' }] : []);
  datumAxisEdgeRows = computed<SelectionRow[]>(() =>
    this.datumAxisEdge() ? [{ id: 'edge', label: 'Edge', icon: 'timeline' }] : []);
  datumAxisPlaneARows = computed<SelectionRow[]>(() => {
    const r = this.datumAxisPlaneA();
    if (!r) return [];
    if (r.kind === 'datum') return [{ id: 'planeA', label: r.datumId.replace(/_/g, ' '), icon: 'crop_din' }];
    return [{ id: 'planeA', label: this._shortFaceLabel(r.faceId), icon: 'crop_square' }];
  });
  datumAxisPlaneBRows = computed<SelectionRow[]>(() => {
    const r = this.datumAxisPlaneB();
    if (!r) return [];
    if (r.kind === 'datum') return [{ id: 'planeB', label: r.datumId.replace(/_/g, ' '), icon: 'crop_din' }];
    return [{ id: 'planeB', label: this._shortFaceLabel(r.faceId), icon: 'crop_square' }];
  });
  datumAxisCylinderRows = computed<SelectionRow[]>(() => {
    const fid = this.datumAxisCylinderFaceId();
    return fid ? [{ id: 'cyl', label: this._shortFaceLabel(fid), icon: 'rotate_right' }] : [];
  });
  /** Selection-list rows for the datum-point picks. */
  datumPointVertexRows = computed<SelectionRow[]>(() =>
    this.datumPointVertex() ? [{ id: 'vtx', label: 'Vertex', icon: 'place' }] : []);
  datumPointFaceRows = computed<SelectionRow[]>(() => {
    const fid = this.datumPointFaceId();
    return fid ? [{ id: 'face', label: this._shortFaceLabel(fid), icon: 'crop_square' }] : [];
  });
  datumPointEdgeRows = computed<SelectionRow[]>(() =>
    this.datumPointEdge() ? [{ id: 'edge', label: 'Edge', icon: 'timeline' }] : []);
  datumPointBodyRows = computed<SelectionRow[]>(() => {
    const bid = this.datumPointBodyId();
    return bid ? [{ id: 'body', label: `Body ${bid}`, icon: 'view_in_ar' }] : [];
  });

  // ── Shell sidebar — REQ 659 ────────────────────────────────────────
  /** Shell sidebar context. `editingFeatureId` set in edit mode so
   * commit updates the existing feature rather than appending. */
  shellSidebar = signal<{ editingFeatureId?: string } | null>(null);
  /** Picked faces to remove. Each pick captures a fallback centroid +
   * normal so the kernel can match geometrically. */
  shellFaces = signal<import('../../../cad/lib/types').ShellFaceRef[]>([]);
  /** Wall thickness magnitude (mm). Combined with direction at commit. */
  shellThickness = signal<number>(2);
  shellThicknessExpression = signal<string | null>(null);
  /** Inward (default) or outward. */
  shellDirection = signal<'inward' | 'outward'>('inward');

  /** Selection-list rows for picked shell faces. */
  shellFaceRows = computed<SelectionRow[]>(() => {
    return this.shellFaces().map((f, idx) => ({
      id: `face:${idx}`,
      label: this._shortFaceLabel(f.faceId),
      icon: 'crop_square',
    }));
  });

  // ── Pattern sidebar — REQ 658 ──────────────────────────────────────
  // Mirror Feature, Linear Pattern, Circular Pattern all share one
  // sidebar with a kind-discriminated UI. Input signals are partitioned
  // by kind so switching kinds doesn't drag stale values into the new
  // form — the open handler resets them.
  patternSidebar = signal<{
    kind: 'mirror' | 'linearPattern' | 'circularPattern';
    editingFeatureId?: string;
  } | null>(null);
  /** Mirror: the plane to reflect across. Picked via face/datum picks. */
  patternPlaneRef = signal<PlaneRef | null>(null);
  /** Mirror: selected origin datum option in the dropdown (or '' for
   * face-pick mode). Two-way bound with patternPlaneRef when the user
   * picks an origin plane via the dropdown. */
  patternPlaneDatumOption = signal<string>('');

  /** Linear: direction 1 axis + spacing + count + flipped. Count
   * supports expressions via the equations doc (REQ 658 update). */
  patternDir1AxisId = signal<'x_axis' | 'y_axis' | 'z_axis'>('x_axis');
  patternDir1Spacing = signal<number>(10);
  patternDir1SpacingExpression = signal<string | null>(null);
  patternDir1Count = signal<number>(3);
  patternDir1CountExpression = signal<string | null>(null);
  patternDir1Flipped = signal<boolean>(false);
  patternDir2Enabled = signal<boolean>(false);
  patternDir2AxisId = signal<'x_axis' | 'y_axis' | 'z_axis'>('y_axis');
  patternDir2Spacing = signal<number>(10);
  patternDir2SpacingExpression = signal<string | null>(null);
  patternDir2Count = signal<number>(2);
  patternDir2CountExpression = signal<string | null>(null);
  patternDir2Flipped = signal<boolean>(false);

  /** Circular: rotation axis + count + mode + angle. */
  patternCircAxisId = signal<'x_axis' | 'y_axis' | 'z_axis'>('z_axis');
  patternCircCount = signal<number>(4);
  patternCircCountExpression = signal<string | null>(null);
  patternCircMode = signal<'equalSpacing' | 'specifiedAngle'>('equalSpacing');
  patternCircAngleDeg = signal<number>(360);
  patternCircAngleExpression = signal<string | null>(null);
  patternCircFlipped = signal<boolean>(false);

  /** Selection-list row for the active mirror plane pick. */
  patternPlaneRows = computed<SelectionRow[]>(() => {
    const r = this.patternPlaneRef();
    if (!r) return [];
    if (r.kind === 'datum') return [{ id: 'mirrorPlane', label: r.datumId.replace(/_/g, ' '), icon: 'crop_din' }];
    return [{ id: 'mirrorPlane', label: this._shortFaceLabel(r.faceId), icon: 'crop_square' }];
  });

  /** Floor an instance-count value to a positive integer with a
   * minimum. Used by the pattern sidebar's dim-input commits — the
   * resolved expression may be 4.5 or 0; we floor and clamp to keep
   * the kernel happy. */
  _floorPositiveInt(v: number, min: number): number {
    if (!Number.isFinite(v)) return min;
    return Math.max(min, Math.floor(v));
  }

  /** Short, human-readable label for a face id. Face IDs are JSON
   * persistent-names like `{"feature_id":"f31#body#body0","role":"side","sub_index":4,"upstream_refs":[]}`
   * — way too long for a row label. Parse and reduce to `Face f31 #4`
   * style. Falls back to the raw id when parsing fails. */
  private _shortFaceLabel(faceId: string): string {
    try {
      const obj = JSON.parse(faceId) as { feature_id?: string; role?: string; sub_index?: number };
      // feature_id may have a `#body#body0` suffix — strip it for
      // brevity; the user picked a specific face on a specific body
      // but the role+sub_index disambiguate it.
      const feat = (obj.feature_id || '').split('#')[0] || '?';
      const role = obj.role || '';
      const sub = obj.sub_index;
      if (role === 'cap_top') return `Face ${feat} top`;
      if (role === 'cap_bottom') return `Face ${feat} bottom`;
      if (role === 'side' && sub !== undefined) return `Face ${feat} #${sub}`;
      return `Face ${feat}`;
    } catch {
      return 'Face';
    }
  }

  /** Selection-list row for the active refA pick. */
  datumPlaneRefARows = computed<SelectionRow[]>(() => {
    const r = this.datumPlaneRefA();
    if (!r) return [];
    if (r.kind === 'datum') return [{ id: 'refA', label: r.datumId.replace(/_/g, ' '), icon: 'crop_din' }];
    return [{ id: 'refA', label: this._shortFaceLabel(r.faceId), icon: 'crop_square' }];
  });
  datumPlaneRefBRows = computed<SelectionRow[]>(() => {
    const r = this.datumPlaneRefB();
    if (!r) return [];
    if (r.kind === 'datum') return [{ id: 'refB', label: r.datumId.replace(/_/g, ' '), icon: 'crop_din' }];
    return [{ id: 'refB', label: this._shortFaceLabel(r.faceId), icon: 'crop_square' }];
  });
  datumPlaneEdgeRows = computed<SelectionRow[]>(() => {
    const e = this.datumPlaneEdge();
    return e ? [{ id: 'edge', label: 'Edge', icon: 'timeline' }] : [];
  });
  datumPlaneVertexRows = computed<SelectionRow[]>(() => {
    return this.datumPlaneVertices().map((_v, idx) => ({
      id: `v:${idx}`, label: `Vertex ${idx + 1}`, icon: 'place',
    }));
  });
  datumPlaneCylinderRows = computed<SelectionRow[]>(() => {
    const c = this.datumPlaneCylinderFaceId();
    return c ? [{ id: 'cyl', label: this._shortFaceLabel(c), icon: 'rotate_right' }] : [];
  });

  /** Live preview transforms for the active pattern sidebar. Returns
   * the same `PatternTransform[]` the kernel would consume — the
   * viewer clones the most-recent body's mesh at each transform to
   * render ghost copies. Null when no sidebar is open or inputs are
   * not yet valid. REQ 658. */
  patternPreview = computed<{
    kind: 'mirror' | 'linearPattern' | 'circularPattern';
    transforms: import('../../../cad/lib/pattern').PatternTransform[];
  } | null>(() => {
    const ctx = this.patternSidebar();
    if (!ctx) return null;
    try {
      if (ctx.kind === 'mirror') {
        const ref = this.patternPlaneRef();
        if (!ref) return null;
        const snap = this._resolvePlaneRefSnapshot(ref);
        if (!snap) return null;
        return { kind: 'mirror', transforms: [{ kind: 'mirror', origin: snap.origin, normal: snap.normal }] };
      }
      if (ctx.kind === 'linearPattern') {
        const d1AxisId = this.patternDir1AxisId();
        const tForm: import('../../../cad/lib/types').LinearPatternFeature = {
          id: '__preview__',
          type: 'linearPattern',
          direction1: {
            axisRef: { kind: 'originAxis', axisId: d1AxisId },
            axisSnapshot: this._originAxisSnapshot(d1AxisId),
            spacing: this.patternDir1Spacing(),
            count: this.patternDir1Count(),
            flipped: this.patternDir1Flipped(),
          },
          direction2: this.patternDir2Enabled() ? {
            axisRef: { kind: 'originAxis', axisId: this.patternDir2AxisId() },
            axisSnapshot: this._originAxisSnapshot(this.patternDir2AxisId()),
            spacing: this.patternDir2Spacing(),
            count: this.patternDir2Count(),
            flipped: this.patternDir2Flipped(),
          } : undefined,
        };
        return { kind: 'linearPattern', transforms: linearTransforms(tForm) };
      }
      if (ctx.kind === 'circularPattern') {
        const axisId = this.patternCircAxisId();
        const tForm: import('../../../cad/lib/types').CircularPatternFeature = {
          id: '__preview__',
          type: 'circularPattern',
          axisRef: { kind: 'originAxis', axisId },
          axisSnapshot: this._originAxisSnapshot(axisId),
          count: this.patternCircCount(),
          mode: this.patternCircMode(),
          angleDeg: this.patternCircAngleDeg(),
          flipped: this.patternCircFlipped(),
        };
        return { kind: 'circularPattern', transforms: circularTransforms(tForm) };
      }
    } catch {
      // Invalid input (e.g. zero spacing, count < 2). No preview until
      // the user fixes it; canCommitPattern keeps the OK button off.
      return null;
    }
    return null;
  });

  /** Live preview plane computed from the in-progress sidebar state.
   * Updates on every pick / scalar change so the viewer can render a
   * translucent quad showing where the resulting plane will land. */
  datumPlanePreview = computed<Plane3 | null>(() => {
    const ctx = this.datumPlaneSidebar();
    if (!ctx) return null;
    const draft = this._buildDatumPlaneFeature(ctx.editingFeatureId || '__preview__');
    if (!draft) return null;
    const res = computeDatumPlane(draft, this.geometry() ?? { datums: [], faces: [], topology: { vertices: [], edges: [] } });
    return res.ok ? res.plane : null;
  });

  /** Remove dispatcher used by every datum-plane selection list.
   * Routes to the right slot reset based on the row id prefix. */
  removeDatumPlaneRow(rowId: string): void {
    if (rowId === 'refA') this.datumPlaneRefA.set(null);
    else if (rowId === 'refB') this.datumPlaneRefB.set(null);
    else if (rowId === 'edge') this.datumPlaneEdge.set(null);
    else if (rowId === 'cyl') this.datumPlaneCylinderFaceId.set(null);
    else if (rowId.startsWith('v:')) {
      const idx = Number(rowId.slice(2));
      const cur = this.datumPlaneVertices();
      if (Number.isFinite(idx)) this.datumPlaneVertices.set(cur.filter((_, i) => i !== idx));
    }
  }

  // ── Measure sidebar ────────────────────────────────────────────────
  // Active when the user opens the Measure tool. Accumulates picked
  // vertices / edges / faces; the live `measureResult` computed signal
  // turns the current pick list into a distance / angle / length report.
  measureSidebar = signal<boolean>(false);
  measureItems = signal<MeasureItem[]>([]);
  measureResult = computed(() => computeMeasure(this.measureItems(), 'mm'));

  // Chamfer mode (ignored when the sidebar is in fillet mode).
  //   - 'equal'         single leg, applied symmetrically (45°).
  //   - 'twoDistance'   leg + secondary leg (asymmetric).
  //   - 'distanceAngle' leg + angle from the reference face (degrees).
  edgeBlendChamferMode = signal<'equal' | 'twoDistance' | 'distanceAngle'>('equal');
  // Secondary distance for two-distance chamfer mode.
  edgeBlendDistance2 = signal<number>(1);
  edgeBlendDistance2Expression = signal<string | null>(null);
  // Angle (degrees) for distance-angle chamfer mode.
  edgeBlendAngle = signal<number>(45);
  edgeBlendAngleExpression = signal<string | null>(null);
  // Note: `edgePickMode` is the existing debug-edge-pick signal — we
  // re-use it here. When the blend sidebar is open AND edgePickMode is
  // true, onEdgePicked routes to addEdgeBlendEdge instead of pickedEdge.

  /** SelectionRow projection of `edgeBlendRows`, for the generic
   * `<cad-selection-list>` component. Each row's id encodes its kind
   * via a `face:` / `edge:` prefix so a single `removeEdgeBlendRow`
   * handler can route to the right underlying remove method. */
  edgeBlendSelectionRows = computed<SelectionRow[]>(() => {
    return this.edgeBlendRows().map(row => {
      if (row.kind === 'face') {
        return {
          id: `face:${row.faceId}`,
          label: row.label,
          icon: 'crop_square',
          tooltip: 'Remove this face (and all its edges)',
        };
      }
      if (row.kind === 'edgeGroup') {
        return {
          id: `edgeGroup:${row.edgeGroupId}`,
          label: row.label,
          icon: 'timeline',
          tooltip: 'Remove this edge (and all tangent-continuous neighbors)',
        };
      }
      return {
        id: `edge:${row.edgeIndex}`,
        label: row.label,
        icon: 'timeline',
        tooltip: 'Remove this edge',
      };
    });
  });

  /** Single remove dispatcher for `<cad-selection-list>` rows. Parses
   * the prefix the projection added and routes to the right underlying
   * remove method on `edgeBlendEdges`. */
  removeEdgeBlendRow(rowId: string): void {
    if (rowId.startsWith('face:')) {
      this.removeEdgeBlendFace(rowId.slice('face:'.length));
    } else if (rowId.startsWith('edgeGroup:')) {
      this.removeEdgeBlendEdgeGroup(rowId.slice('edgeGroup:'.length));
    } else if (rowId.startsWith('edge:')) {
      const idx = Number(rowId.slice('edge:'.length));
      if (Number.isFinite(idx)) this.removeEdgeBlendEdge(idx);
    }
  }

  /** Grouped view of `edgeBlendEdges` for the sidebar UI:
   *   - Each unique `faceId` becomes one row labelled "Face N" — N is
   *     the face's insertion order among faces picked in this sidebar.
   *   - Each loose edge (no `faceId`) becomes one "Edge N" row.
   * Order follows insertion, so the user sees rows appear in click order.
   * Removing a face row removes every underlying edge that shares its
   * faceId; removing an edge row removes that single edge. */
  edgeBlendRows = computed<Array<
    | { kind: 'face'; label: string; faceId: string }
    | { kind: 'edgeGroup'; label: string; edgeGroupId: string }
    | { kind: 'edge'; label: string; edgeIndex: number }
  >>(() => {
    const rows: Array<
      | { kind: 'face'; label: string; faceId: string }
      | { kind: 'edgeGroup'; label: string; edgeGroupId: string }
      | { kind: 'edge'; label: string; edgeIndex: number }
    > = [];
    const seenFaces = new Set<string>();
    const seenEdgeGroups = new Set<string>();
    let faceCount = 0;
    let edgeCount = 0;
    this.edgeBlendEdges().forEach((e, idx) => {
      if (e.faceId) {
        if (seenFaces.has(e.faceId)) return;
        seenFaces.add(e.faceId);
        faceCount += 1;
        rows.push({ kind: 'face', label: `Face ${faceCount}`, faceId: e.faceId });
      } else if (e.edgeGroupId) {
        if (seenEdgeGroups.has(e.edgeGroupId)) return;
        seenEdgeGroups.add(e.edgeGroupId);
        edgeCount += 1;
        rows.push({ kind: 'edgeGroup', label: `Edge ${edgeCount}`, edgeGroupId: e.edgeGroupId });
      } else {
        edgeCount += 1;
        rows.push({ kind: 'edge', label: `Edge ${edgeCount}`, edgeIndex: idx });
      }
    });
    return rows;
  });

  /** Live preview payload for the viewer's edgeBlendPreview overlay.
   * Active only while the blend sidebar is open AND at least one edge
   * has been picked. Updates on every value/edges change so the user
   * sees the tube/offset resize in real time. */
  edgeBlendPreviewSig = computed(() => {
    const ctx = this.edgeBlendSidebar();
    if (!ctx) return null;
    const edges = this.edgeBlendEdges();
    if (edges.length === 0) return null;
    const value = this.edgeBlendValue();
    if (!isFinite(value) || value <= 0) return null;
    return { kind: ctx.kind, value, edges };
  });

  // ── Sweep / Cut Sweep sidebar ──────────────────────────────────────────
  // Profile + path live on different sketches; the sidebar's two
  // dropdowns hold the picks. Merge applies to additive sweep only.
  sweepSidebar = signal<{
    /** 'sweep' (additive, default) or 'cutSweep' (subtractive). */
    mode: 'sweep' | 'cutSweep';
    /** Set when editing an existing feature; commit updates instead of
     * appending. Same pattern as extrudeSidebar.editingFeatureId. */
    editingFeatureId?: string;
  } | null>(null);
  sweepProfileSketchId = signal<string | null>(null);
  sweepPathSketchId = signal<string | null>(null);
  /** "Merge result" toggle for additive sweep. Cut sweep ignores it. */
  sweepMerge = signal<boolean>(true);
  /** Sketch points exposed as pickable vertices (in addition to BRep
   * vertices coming from the kernel). Includes every point in every
   * VISIBLE sketch — construction points count, since users explicitly
   * place those as references. Ids are namespaced `sketch:<sketchId>/
   * <pointId>` so the backend resolver can tell them apart from BRep
   * topology vertices when computing the Up to Vertex distance. */
  sketchPickableVertices = computed<Array<{ id: string; position: [number, number, number] }>>(() => {
    const doc = this.doc();
    const out: Array<{ id: string; position: [number, number, number] }> = [];
    for (const [sid, sketch] of Object.entries(doc.sketches)) {
      if (sketch.visible === false) continue;
      for (const e of sketch.state.entities) {
        if (e.kind !== 'point') continue;
        out.push({ id: `sketch:${sid}/${e.id}`, position: projectTo3D(sketch.plane, e.x, e.y) });
      }
    }
    return out;
  });
  /** Region indices the user has picked for extrusion. Each region is one
   * planar zone (outer loop + 0..N inner holes); selecting the donut
   * region of two concentric circles produces an annular extrude. */
  extrudeSelectedRegions = signal<Set<number>>(new Set([0]));
  /** Region index the pointer is hovering in the viewer; null when not on
   * a fill. Updated by the viewer's profileFillHover output. */
  extrudeHoveredRegion = signal<number | null>(null);
  /** Translucent fills the viewer renders when the Extrude sidebar is open.
   * One per planar region in the host sketch (nested loops collapse into
   * region+holes via extractRegions). Clicking a fill toggles the region
   * in `extrudeSelectedRegions`. */
  profileFills = computed<ProfileFill[]>(() => {
    const ctx = this.extrudeSidebar() ?? this.revolveSidebar();
    if (!ctx) return [];
    const sketch = this.doc().sketches[ctx.sketchId];
    if (!sketch) return [];
    const { regions } = extractRegions(sketch.state);
    const out: ProfileFill[] = [];
    for (let i = 0; i < regions.length; i++) {
      const region = regions[i];
      const poly2d = tessellateProfileLoop(region.outer);
      if (poly2d.length < 3) continue;
      const polygon3d = poly2d.map(p => projectTo3D(sketch.plane, p.x, p.y));
      const holePolygons3d = region.holes
        .map(h => tessellateProfileLoop(h))
        .filter(h => h.length >= 3)
        .map(h => h.map(p => projectTo3D(sketch.plane, p.x, p.y)));
      out.push({ index: i, polygon3d, holePolygons3d, normal: sketch.plane.normal });
    }
    return out;
  });
  /** Constraint id currently in inline-edit mode. Smart Dim's placement
   * click sets this (so the value popup opens right after creation), and
   * double-clicking an existing label also sets it. The viewer renders an
   * <input> in place of the label for this id. */
  editingDimensionId = signal<string | null>(null);

  /** Revolve axis-pick mode. Mirrors vertexPickMode / facePickMode: when
   * true the viewer renders the revolve target sketch's lines as
   * pickable highlights and a click emits axisPicked. */
  axisPickMode = signal<boolean>(false);

  /** Edge-pick mode — when on, the viewer enables edge hover +
   * click. Driven by the footer selection filter, the fillet /
   * chamfer sidebar's "Pick edges from viewer" button, and the
   * Convert Entities sketch tool. */
  edgePickMode = signal<boolean>(false);

  /** Translucent ghost mesh for in-progress Extrude / Cut / Revolve.
   * Tracks the open sidebar's params; null when no preview applies.
   * Generation is debounced via a microtask but otherwise runs on every
   * signal change — the cheap-path geometry builder is fast enough that
   * 200ms typing produces no visible jank. */
  featurePreview = computed<{
    kind: 'add' | 'cut';
    positions: Float32Array;
    normals: Float32Array;
    indices: Uint32Array;
  } | null>(() => {
    const ex = this.extrudeSidebar();
    const rv = this.revolveSidebar();
    if (ex) {
      const sketch = this.doc().sketches[ex.sketchId];
      if (!sketch) return null;
      const distance = this.extrudeDistance();
      const flipped = this.extrudeFlipped();
      const endCondition = this.resolveEndCondition() ?? { kind: 'blind' as const };
      const regionIndices = [...this.extrudeSelectedRegions()];
      if (regionIndices.length === 0) return null;
      const startCondition = this.resolveStartCondition() ?? { kind: 'sketchPlane' as const };
      const d2End = this.resolveDir2EndCondition();
      const direction2 = (this.extrudeDir2Enabled() && this.extrudeEndKind() !== 'midPlane' && d2End)
        ? { distance: this.extrudeDir2Distance(), endCondition: d2End }
        : undefined;
      const startOffsetOverride = this.resolveStartOffsetForPreview(startCondition, sketch.plane);
      const mesh = extrudePreview({
        sketchState: sketch.state, plane: sketch.plane,
        distance, flipped, regionIndices, endCondition,
        startCondition, direction2, startOffsetOverride,
        resolveText: this.textResolver(),
      });
      if (!mesh) return null;
      return { kind: ex.mode === 'cutExtrude' ? 'cut' : 'add', ...mesh };
    }
    if (rv) {
      const sketch = this.doc().sketches[rv.sketchId];
      if (!sketch) return null;
      const axisLineId = this.revolveAxisLineId();
      if (!axisLineId) return null;
      const regionIndices = [...this.extrudeSelectedRegions()];
      if (regionIndices.length === 0) return null;
      const mesh = revolvePreview({
        sketchState: sketch.state, plane: sketch.plane,
        axisLineId, angleDeg: this.revolveAngle(), flipped: this.revolveFlipped(),
        regionIndices,
      });
      if (!mesh) return null;
      return { kind: rv.mode === 'cutRevolve' ? 'cut' : 'add', ...mesh };
    }
    const sw = this.sweepSidebar();
    if (sw) {
      const profileId = this.sweepProfileSketchId();
      const pathId = this.sweepPathSketchId();
      if (!profileId || !pathId || profileId === pathId) return null;
      const profile = this.doc().sketches[profileId];
      const path = this.doc().sketches[pathId];
      if (!profile || !path) return null;
      const mesh = sweepPreview({
        profileSketchState: profile.state, profilePlane: profile.plane,
        pathSketchState: path.state, pathPlane: path.plane,
        regionIndices: [0],
      });
      if (!mesh) return null;
      return { kind: sw.mode === 'cutSweep' ? 'cut' : 'add', ...mesh };
    }
    return null;
  });

  /** Pickable axis candidates for the active Revolve sidebar — every line
   * in the revolve target sketch, projected to 3D via the sketch's plane.
   * Empty when no revolve sidebar is open. */
  axisCandidates3D = computed<Array<{
    id: string; p1: [number, number, number]; p2: [number, number, number]; construction?: boolean;
  }>>(() => {
    const ctx = this.revolveSidebar();
    if (!ctx) return [];
    const sketch = this.doc().sketches[ctx.sketchId];
    if (!sketch) return [];
    const out: Array<{ id: string; p1: [number, number, number]; p2: [number, number, number]; construction?: boolean }> = [];
    const findPt = (pid: string) => sketch.state.entities.find(
      (e): e is import('../../../cad/lib/types').PointEntity => e.id === pid && e.kind === 'point',
    );
    for (const e of sketch.state.entities) {
      if (e.kind !== 'line') continue;
      const a = findPt(e.startId);
      const b = findPt(e.endId);
      if (!a || !b) continue;
      out.push({
        id: e.id,
        p1: projectTo3D(sketch.plane, a.x, a.y),
        p2: projectTo3D(sketch.plane, b.x, b.y),
        construction: !!(e as { construction?: boolean }).construction,
      });
    }
    return out;
  });
  /** Constraint id currently SELECTED (single-clicked). Distinct from
   * editing — selected means "highlighted, ready for Delete-key removal".
   * Single-click switches selection between dimensions; click elsewhere /
   * Esc clears it. Double-click promotes to editing. */
  selectedConstraintId = signal<string | null>(null);

  // ── Undo / redo ───────────────────────────────────────────────────────
  // Each entry is a snapshot of (featureTree, doc) — the two signals that
  // own the editable model state. Captures are debounced so rapid changes
  // (drag previews, solver re-runs) collapse into one undo step.
  private history = signal<{ snapshots: HistorySnapshot[]; index: number }>({ snapshots: [], index: -1 });
  private historyTimer: number | null = null;
  /** True while undo/redo is restoring a snapshot. Tells the capture
   * effect that the next featureTree/doc change is a replay, not a new
   * user edit, so we don't snapshot it. */
  private replayingHistory = false;
  canUndo = computed(() => this.history().index > 0);
  canRedo = computed(() => {
    const h = this.history();
    return h.index < h.snapshots.length - 1;
  });
  /** Default unit for THIS model. Read off featureTree.defaultUnit so it
   * persists with the save blob. Setter writes back to featureTree and
   * triggers a save. Defaults to mm for legacy models without the field. */
  defaultUnit = computed<Unit>(() => (this.featureTree().defaultUnit as Unit) ?? 'mm');
  setDefaultUnit(u: Unit) {
    if (this.readonly()) return;
    const tree = this.featureTree();
    if (tree.defaultUnit === u) return;
    this.featureTree.set({ ...tree, defaultUnit: u });
    this.save();
  }
  // REQ 629 — sketch cursor + snap target. Updated on every viewer
  // sketchPointerMove. Cursor is in active sketch 2D coords (snapped if a
  // snap target was within range). snapTargetPoint is the un-snapped world
  // location of the snap target — used to render the snap-ring indicator.
  sketchCursor = signal<{ x: number; y: number } | null>(null);
  snapTargetPoint = signal<{ x: number; y: number; kind: SnapKind } | null>(null);
  // REQ 631 — mirror the sketch-editor's selection set into a computed so the
  // 3D viewer can react to changes (sketch-editor.selected is a signal accessed
  // via viewChild; this layer keeps Angular's reactivity tidy).
  sketchEditorSelection = computed<Set<string>>(() => {
    const editor = this.sketchEditorRef();
    if (!editor) return new Set<string>();
    // Offset tool queue uses its own Map state, separate from the
    // global `selected` signal. Merge it in here so curves the user
    // has clicked while in offset mode visually highlight in the
    // viewer — same orange/glow treatment as a regular selection.
    if (editor.tool() === 'offset' && editor.offsetSelections().size > 0) {
      return new Set<string>([...editor.selected(), ...editor.offsetSelections().keys()]);
    }
    return editor.selected();
  });
  /** Mirror of the sketch editor's `dofState` so the 3D viewer can recolor
   * the active sketch — blue (under-constrained), green (fully constrained),
   * or red (over-constrained / solver failed). Falls back to 'under'. */
  activeSketchDof = computed<'under' | 'fixed' | 'over'>(() => {
    const editor = this.sketchEditorRef();
    return editor?.dofState() ?? 'under';
  });
  /** Per-entity determinacy. Forwarded to the viewer so each sketch entity
   * colors based on its own constraint state (SW-style), not a single
   * global flag for the whole sketch. */
  determinedEntities = computed<Set<string>>(() => {
    const editor = this.sketchEditorRef();
    return editor?.determinedEntities() ?? new Set();
  });
  /** Live Smart Dim preview render derived from the sketch editor's
   * current picks + the cursor position. Passed to the viewer so the
   * dashed dimension lines + value pill follow the cursor before the
   * placement click. */
  smartDimPreview = computed(() => {
    const editor = this.sketchEditorRef();
    const cursor = this.sketchCursor();
    return editor?.smartDimPreview(cursor) ?? null;
  });
  // REQ 625 — last clicked face id + its flatness, captured separately from the
  // feature set so "click face → Sketch action" can pick the right plane.
  private lastPickedFaceId = signal<string | null>(null);
  private lastPickedFaceIsFlat = signal<boolean>(false);
  // REQ 623 — feature-tree context menu re-used for 3D right-click. Anchor
  // moves to the cursor; menu items are the same FeatureTreeAction emitters.
  ctxMenuX = signal(0);
  ctxMenuY = signal(0);
  ctxMenuFeatureId = signal<string | null>(null);
  private prevActiveSketchId: SketchId | null = null;
  // Tracks the previous over-constrained state so we only toast on the
  // ok→over edge, not every time the dof signal re-emits.
  private lastSketchWasOver = false;
  private sketchEditorRef = viewChild<CadSketchEditorComponent>('sketchEditor');
  private viewerRef = viewChild<CadViewerComponent>('viewer');
  private ctxMenuTrigger = viewChild(MatMenuTrigger);

  activeSketchPlaneLabel = computed(() => {
    const sid = this.activeSketchId();
    const sk = sid ? this.doc().sketches[sid] : null;
    if (!sk) return '';
    return sk.hostId.startsWith('datum:') ? sk.hostId.substring('datum:'.length).replace('_', ' ') : sk.hostId;
  });

  // ── VCS working-copy state (Phase 1) ──────────────────────────────────────
  commits = signal<CadCommit[]>([]);
  showCommits = signal(false);
  branches = signal<CadBranch[]>([]);      // Phase 2 variant branches
  showBranches = signal(false);
  isDirty = computed(() => !!this.model()?.dirty);
  lockHolderId = computed(() => this.model()?.lockedByUserID ?? null);
  isLockedByMe = computed(() => {
    const id = this.lockHolderId();
    return id != null && id === this.auth.currentUser()?.id;
  });
  lockedByOther = computed(() => {
    const id = this.lockHolderId();
    return id != null && id !== this.auth.currentUser()?.id;
  });

  readonly = computed(() => {
    const m = this.model();
    if (!m) return true;
    // Another user holds the exclusive checkout — view only until they release.
    if (this.lockedByOther()) return true;
    return !this.canWrite();
  });

  selectedIsPlanar = computed(() => {
    const s = this.selected();
    return s !== null && s.startsWith('datum:') && (s.endsWith('_plane'));
  });

  sketchCount = computed(() => Object.keys(this.doc().sketches).length);

  /** True when the current feature tree has at least one additive feature
   * (extrude or revolve) whose result is a body Cut Extrude can subtract
   * from. Drives the Cut button's disabled state on the Features ribbon. */
  hasAdditiveBody = computed<boolean>(() =>
    this.featureTree().features.some(f =>
      f.type === 'extrude' || f.type === 'revolve' || f.type === 'sweep',
    ),
  );

  promptIcon = computed(() => {
    const m = this.mode();
    if (m === 'pick-plane') return 'draw';
    if (m === 'pick-extrude-target') return 'vertical_align_top';
    if (m === 'pick-cut-extrude-target') return 'vertical_align_bottom';
    if (m === 'pick-revolve-target') return '360';
    return '';
  });

  promptText = computed(() => {
    const m = this.mode();
    if (m === 'pick-plane') return 'Click a datum plane or flat face in the viewer to start a sketch on it.';
    if (m === 'pick-extrude-target') {
      return this.sketchCount() > 0
        ? 'Select a sketch from the feature tree, or click a plane in the viewer to start a new one.'
        : 'No sketches yet — click a plane in the viewer to start one. It will be extruded when you finish.';
    }
    if (m === 'pick-cut-extrude-target') {
      return 'Select a sketch from the feature tree to subtract its profile from the current body.';
    }
    if (m === 'pick-revolve-target') {
      return this.sketchCount() > 0
        ? 'Select a sketch with a sketched axis line. The axis can be a construction line or any other line.'
        : 'Revolve needs an existing sketch with both a closed profile and a line to use as the axis.';
    }
    return '';
  });

  canWrite() { return this.auth.hasPermission('cad', 'write'); }
  canApprove() { return this.auth.hasPermission('cad', 'approve'); }

  private regenGeneration = 0;

  constructor() {
    // History capture — debounced 500ms. Watches the two mutable model
    // signals (featureTree + doc) and records a snapshot once they settle.
    // Skipped when replayingHistory is true (i.e. an undo/redo just set
    // the signals — that change isn't a new edit).
    effect(() => {
      const ft = this.featureTree();
      const dc = this.doc();
      if (this.replayingHistory) return;
      if (this.historyTimer !== null) clearTimeout(this.historyTimer);
      this.historyTimer = window.setTimeout(() => {
        this.historyTimer = null;
        this.pushSnapshot({ featureTree: ft, doc: dc });
      }, 500);
    });

    // Auto-rollback during edit: when the user enters edit mode on a
    // feature OR a sketch, drop the rollback bar so downstream features
    // don't appear. Restore the user's previous bar position on exit.
    // `_savedRollbackForEdit` uses `undefined` as the "not in edit"
    // sentinel — `null` is a meaningful saved value (no prior bar).
    //
    // The bar shift is a pure rollback transition — the model state
    // hasn't changed, only WHICH cached features render. So we
    // re-paint from the per-body cache (instant, no kernel round-trip)
    // instead of triggering a full regenerate(). When the user commits
    // an edit, the commit handler calls save() which will trigger the
    // necessary kernel regen for the actual feature change.
    effect(() => {
      const target = this.editRollbackTarget();
      const saved = this._savedRollbackForEdit;
      let changed = false;
      if (target !== null && saved === undefined) {
        this._savedRollbackForEdit = untracked(() => this.rollbackBeforeIndex());
        this.rollbackBeforeIndex.set(target);
        changed = true;
      } else if (target === null && saved !== undefined) {
        this.rollbackBeforeIndex.set(saved);
        this._savedRollbackForEdit = undefined;
        changed = true;
      } else if (target !== null && saved !== undefined) {
        const cur = untracked(() => this.rollbackBeforeIndex());
        if (cur !== target) {
          this.rollbackBeforeIndex.set(target);
          changed = true;
        }
      }
      if (changed) {
        // Repaint from cache — no kernel call. The bar moved, but
        // the cached per-feature geometry is still valid; we just
        // filter which features get included by the new cutoff.
        queueMicrotask(() => this._rederivePerBodyFromCache());
      }
    });

    // Convert Entities live link: re-project every sketch entity tagged
    // with projectedFrom whenever the geometry signal updates. Reads
    // the latest topology, recomputes 2D coords for each projection,
    // mutates doc in place WITHOUT calling save (the new coords are
    // derived, not user edits — persisting them would loop the regen).
    effect(() => {
      void this.geometry();  // dep
      // Run outside the current effect tick so the doc.set we'll
      // potentially make doesn't re-trigger this effect in the same
      // cycle (Angular signals coalesce, so this is mostly defensive).
      queueMicrotask(() => this._reprojectAllSketches());
    });

    // REQ 616: auto-switch the ribbon tab when activeSketchId transitions.
    // Steady-state changes (e.g., editing the sketch's contents) don't override
    // a user-initiated tab choice.
    effect(() => {
      const next = this.activeSketchId();
      if (next !== this.prevActiveSketchId) {
        this.activeTab.set(next ? 'sketch' : 'features');
        this.prevActiveSketchId = next;
      }
    });

    // REQ 700 — datum-only fast path. The 3D viewer still needs the datum
    // overlay derived from the OriginFeature's visibility map; recompute it
    // whenever featureTree changes. Feature geometry is fetched via the
    // server regenerate call (see `regenerate()` below) so it doesn't go
    // through an effect.
    //
    // `untracked()` is load-bearing: this effect both reads and writes
    // `geometry()` (read to preserve faces/topology while only swapping
    // datums). Without untracked, the write retriggers the effect via the
    // tracked read → infinite loop that locks the main thread.
    effect(() => {
      const tree = this.featureTree();
      const origin = tree.features.find(f => f.type === 'origin') as
        | (typeof tree.features[number] & { visibility?: Record<string, boolean> })
        | undefined;
      const vis = { ...defaultDatumVisibility(), ...(origin?.visibility ?? {}) };
      const datums = buildOriginDatums().filter(d => vis[d.id] !== false);
      const prev = untracked(() => this.geometry());
      // Append user-defined datum planes — REQ 657. Each
      // DatumPlaneFeature contributes one DatumElement of kind 'plane',
      // computed from its method against the CURRENT (origin-only at
      // this point) geometry. Hidden features and rolled-back ones are
      // skipped. The `plane` sidecar property carries the full Plane3
      // so sketches hosted on this datum get an accurate basis.
      const cutoff = untracked(() => this.rollbackBeforeIndex());
      const userDatumErrors = new Map<string, string>();
      const seedGeometry = {
        datums: [...datums],
        faces: prev?.faces ?? [],
        topology: prev?.topology ?? { vertices: [], edges: [] },
      };
      tree.features.forEach((f, idx) => {
        // OriginFeature has no `visible`; every other feature does.
        if ((f as { visible?: boolean }).visible === false) return;
        if (cutoff !== null && idx >= cutoff) return;
        if (f.type === 'datumPlane') {
          const res = computeDatumPlane(f, seedGeometry);
          if (res.ok) {
            // The DatumElement id does NOT carry the `datum:` prefix —
            // pickEntity adds that when it raycasts datum hits.
            seedGeometry.datums.push({
              id: f.id,
              kind: 'plane',
              direction: res.plane.normal,
              plane: res.plane,
              featureId: f.id,
            } as any);
          } else {
            userDatumErrors.set(f.id, res.error);
          }
        } else if (f.type === 'datumAxis') {
          // REQ 660 — user-defined axis. Sidecar `axis: { origin,
          // direction }` carries the resolved geometry; the renderer
          // reads it via the `axis` field while the basic
          // `direction` exposes the line direction for any consumer
          // that only needs that.
          const res = computeDatumAxis(f, seedGeometry);
          if (res.ok) {
            seedGeometry.datums.push({
              id: f.id,
              kind: 'axis',
              direction: res.axis.direction,
              axis: res.axis,
              featureId: f.id,
            } as any);
          } else {
            userDatumErrors.set(f.id, res.error);
          }
        } else if (f.type === 'datumPoint') {
          // REQ 661 — user-defined point. Sidecar `position` carries
          // the resolved world coords.
          const res = computeDatumPoint(f, seedGeometry);
          if (res.ok) {
            seedGeometry.datums.push({
              id: f.id,
              kind: 'point',
              position: res.position,
              featureId: f.id,
            } as any);
          } else {
            userDatumErrors.set(f.id, res.error);
          }
        }
      });
      this.userDatumErrors.set(userDatumErrors);
      this.geometry.set(seedGeometry);
    });

    // Surface over-constrained sketch state as a toast. Effect tracks the
    // active sketch's solver status (via the dofState computed) and fires a
    // single error toast on each ok→over transition. untracked() avoids a
    // feedback loop with the editor's own state reads.
    effect(() => {
      const dof = this.activeSketchDof();
      const wasOver = untracked(() => this.lastSketchWasOver);
      if (dof === 'over' && !wasOver) {
        this.errors.showError('Sketch is over-constrained — the last constraint conflicts with existing ones.');
        this.lastSketchWasOver = true;
      } else if (dof !== 'over' && wasOver) {
        this.lastSketchWasOver = false;
      }
    });

    effect(() => {
      const w = window as any;
      if (!environment.production) {
        w.__cadApp = {
          mode: this.activeSketchId() ? 'sketch' : this.mode(),
          featureTree: this.featureTree(),
          doc: this.doc(),
          selected: this.selected(),
          geometry: this.geometry(),
        };
        const sk = this.activeSketchId() ? this.doc().sketches[this.activeSketchId()!]?.state : null;
        w.__cadSketch = sk;
        w.__cadSetSelected = (id: string | null) => this.handleSelection(id);
      }
    });
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.mode() !== 'idle' && this.activeSketchId() === null) {
      this.setMode('idle');
    }
    // Esc also clears any dimension selection in the active sketch.
    this.selectedConstraintId.set(null);
  }

  /** Delete or Backspace with a dimension SELECTED (single-clicked) →
   * remove it. Bails when the user is typing in any input (sketch editor's
   * inline value editor has its own Delete handling for the "all-selected
   * text" case). Sketch-entity deletion is handled separately inside the
   * sketch editor component. Also handles Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z
   * for undo / redo.
   */
  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(ev: KeyboardEvent) {
    const target = ev.target as HTMLElement | null;
    if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return;
    const ctrl = ev.ctrlKey || ev.metaKey;
    if (ctrl && (ev.key === 'z' || ev.key === 'Z')) {
      ev.preventDefault();
      if (ev.shiftKey) this.redo(); else this.undo();
      return;
    }
    if (ctrl && (ev.key === 'y' || ev.key === 'Y')) {
      ev.preventDefault();
      this.redo();
      return;
    }
    if (ev.key !== 'Delete' && ev.key !== 'Backspace') return;
    const cid = this.selectedConstraintId();
    if (!cid) return;
    ev.preventDefault();
    this.onDimensionDeleteRequested(cid);
    this.selectedConstraintId.set(null);
  }

  // ── Undo / redo handlers ──────────────────────────────────────────────

  /** Add a snapshot at the current head; drop any redo branch past it. */
  private pushSnapshot(snap: HistorySnapshot) {
    this.history.update(h => {
      const truncated = h.snapshots.slice(0, h.index + 1);
      const last = truncated[truncated.length - 1];
      // Skip if nothing actually changed since the previous snapshot
      // (signal write that didn't mutate values, etc).
      if (last && last.featureTree === snap.featureTree && last.doc === snap.doc) return h;
      const next = [...truncated, snap];
      // Cap memory at ~100 entries.
      const trimmed = next.length > 100 ? next.slice(next.length - 100) : next;
      return { snapshots: trimmed, index: trimmed.length - 1 };
    });
  }

  undo() {
    if (!this.canUndo()) return;
    this.history.update(h => ({ ...h, index: h.index - 1 }));
    this.applySnapshot(this.history().snapshots[this.history().index]);
  }

  redo() {
    if (!this.canRedo()) return;
    this.history.update(h => ({ ...h, index: h.index + 1 }));
    this.applySnapshot(this.history().snapshots[this.history().index]);
  }

  /** Restore featureTree + doc to a stored snapshot. Flips
   * `replayingHistory` so the capture effect doesn't re-snapshot the
   * restore as a new edit, then saves + regenerates so server state +
   * geometry catch up. */
  private applySnapshot(s: HistorySnapshot) {
    this.replayingHistory = true;
    this.featureTree.set(s.featureTree);
    this.doc.set(s.doc);
    // Effect runs synchronously after signal writes; reset on microtask
    // so the post-write effect sees the flag still true.
    queueMicrotask(() => { this.replayingHistory = false; });
    // Skip save's own regen — we kick one off below for instant
    // post-undo response, then save persists in the background.
    this.save({ skipRegen: true });
    this.regenerate();
  }

  ngOnInit() {
    // Resolve the part id from whichever route segment carries it.
    // Different navigation paths (lazy-loaded nested routes vs the
    // flat /parts/:id/cad/editor path) put `:id` on different
    // ActivatedRoute levels; check both so we don't end up with a
    // null partID.
    const setPartFromRoute = (id: number) => {
      if (!id || !Number.isFinite(id)) return;
      const current = this.partID();
      if (current === id) return;
      this.partID.set(id);
      this.inventory.getPartById(id).subscribe({
        next: p => this.part.set(p),
        error: () => { /* leave part() null — text vars fall through */ },
      });
    };
    this.route.paramMap.subscribe(pm => setPartFromRoute(Number(pm.get('id'))));
    this.route.parent?.paramMap.subscribe(pm => setPartFromRoute(Number(pm.get('id'))));
    this.route.queryParamMap.subscribe(qp => {
      const fs = qp.get('fullscreen');
      if (fs === '1' || fs === 'true') this.fullscreen.set(true);
      this.uiState.fullscreen.set(this.fullscreen());
      const revID = Number(qp.get('revisionID'));
      if (revID) this.loadModel(revID);
      else this.loadActive();
    });
  }

  ngOnDestroy() {
    // Leaving the editor — never leave the nav hidden if the user
    // navigates away while still in full-screen mode.
    this.uiState.fullscreen.set(false);
    const w = window as any;
    delete w.__cadApp; delete w.__cadSketch; delete w.__cadSetSelected;
    if (this.streamSub) { this.streamSub.unsubscribe(); this.streamSub = null; }
    this.stream.disconnect();
  }

  setMode(m: EditorMode) {
    this.mode.set(m);
    if (m === 'idle') {
      this.pendingExtrude.set(false);
    }
  }

  // REQ 616 — manual tab switch from the ribbon. Independent of activeSketchId.
  setActiveTab(t: 'features' | 'sketch') { this.activeTab.set(t); }

  // REQ 623 — feature click from the 3D viewer. Tracks the last clicked face
  // for REQ 625 (sketch on a flat face) but defers selection-set updates to
  // the same path the tree click uses so behaviour is identical.
  onViewerFeatureClick(ev: {
    featureId: string | null; faceId: string | null; isFlat: boolean;
    shiftKey: boolean; ctrlKey: boolean;
  }) {
    this.lastPickedFaceId.set(ev.faceId);
    this.lastPickedFaceIsFlat.set(ev.isFlat);
    if (!ev.featureId) {
      if (!ev.shiftKey && !ev.ctrlKey) this.selectedFeatures.set(new Set());
      return;
    }
    // Plain click on a face only highlights THAT face (via the per-face
    // `selected` signal that handleSelection sets). Shift / Ctrl promote
    // the click to a feature-level multi-select so the user can grab
    // several whole features by shift-clicking faces.
    if (ev.shiftKey || ev.ctrlKey) {
      this.applyFeatureSelection(ev.featureId, ev.shiftKey, ev.ctrlKey);
    } else {
      this.selectedFeatures.set(new Set());
    }
  }

  // REQ 626 — feature-tree row click. Shared multi-select policy with the
  // viewer click path.
  onFeatureTreeSelect(ev: FeatureSelectEvent) {
    this.applyFeatureSelection(ev.featureId, ev.shiftKey, ev.ctrlKey);
  }

  private applyFeatureSelection(featureId: string, shift: boolean, ctrl: boolean) {
    const next = new Set(this.selectedFeatures());
    if (shift || ctrl) {
      if (next.has(featureId)) next.delete(featureId);
      else next.add(featureId);
    } else {
      next.clear();
      next.add(featureId);
    }
    this.selectedFeatures.set(next);
    if (!shift && !ctrl) this.selectedSketches.set(new Set());
  }

  // REQ 623 — right-click in the viewer opens the feature context menu.
  onViewerFeatureContextMenu(ev: { featureId: string | null; faceId: string | null; clientX: number; clientY: number }) {
    if (!ev.featureId) return;
    // If the right-clicked feature isn't already in the selection, drop the
    // selection to just it (familiar OS behaviour).
    if (!this.selectedFeatures().has(ev.featureId)) {
      this.selectedFeatures.set(new Set([ev.featureId]));
    }
    this.ctxMenuX.set(ev.clientX);
    this.ctxMenuY.set(ev.clientY);
    this.ctxMenuFeatureId.set(ev.featureId);
    queueMicrotask(() => this.ctxMenuTrigger()?.openMenu());
  }

  // REQ 616 / 629 — sketch pointer events from the 3D viewer. cad-editor
  // snaps incoming positions to nearby existing points (when not dragging) so
  // clicks and the preview overlay both lock onto vertices, then forwards
  // the result to the sketch-editor's tool dispatch.
  onViewerSketchClick(p: { x: number; y: number; shiftKey: boolean; tolerance: number; pointTolerance: number }) {
    // Click on the sketch (not on a dim label — those stop propagation)
    // clears any dimension selection so Delete-key intent stays coherent.
    this.selectedConstraintId.set(null);
    const { snapped } = this.snapToPoint({ x: p.x, y: p.y });
    this.sketchEditorRef()?.handleSketchClick({
      x: snapped.x, y: snapped.y, shiftKey: p.shiftKey,
      tolerance: p.tolerance, pointTolerance: p.pointTolerance,
    });
  }
  onViewerSketchPointerDown(p: { x: number; y: number; tolerance: number; pointTolerance: number }) {
    this.sketchEditorRef()?.handleSketchPointerDown(p);
  }
  onViewerSketchPointerMove(p: { x: number; y: number }) {
    const editor = this.sketchEditorRef();
    // No snap during a drag — would tug the dragged point onto every vertex.
    if (editor?.isDragging()) {
      this.sketchCursor.set(p);
      this.snapTargetPoint.set(null);
      editor.handleSketchPointerMove(p);
      return;
    }
    const { snapped, target } = this.snapToPoint(p);
    this.sketchCursor.set(snapped);
    this.snapTargetPoint.set(target);
    editor?.handleSketchPointerMove(snapped);
  }
  onViewerSketchPointerUp(p: { x: number; y: number }) {
    this.sketchEditorRef()?.handleSketchPointerUp(p);
  }

  // REQ 629 / 630 — find the nearest snappable point within SNAP_RADIUS and
  // return its location plus a marker for the indicator.
  //
  // Candidate set:
  //   - the synthetic sketch origin (0, 0)
  //   - every existing sketch point entity (line endpoints, circle centers…)
  //   - midpoint of every non-construction line
  //   - intersections between every pair of non-construction curves
  //   - top/bottom/left/right quadrant points on every non-construction
  //     circle and arc (quadrants outside an arc's sweep are filtered out)
  //
  // Real points (existing entities + origin) get a slightly tighter
  // selection radius than virtual ones (midpoint / intersection / quadrant)
  // so a real corner wins over a virtual point near the same screen pixel.
  private snapToPoint(p: { x: number; y: number }): {
    snapped: { x: number; y: number };
    target: { x: number; y: number; kind: SnapKind } | null;
  } {
    const sid = this.activeSketchId();
    if (!sid) return { snapped: p, target: null };
    const sketch = this.doc().sketches[sid];
    if (!sketch) return { snapped: p, target: null };
    const REAL_RADIUS = 3;
    const VIRTUAL_RADIUS = 2;  // a touch tighter so real points win ties
    let best: { x: number; y: number; kind: SnapKind } | null = null;
    let bestRank = 0;  // 1 = virtual hit, 2 = real hit (real beats virtual)
    let bestDist = Infinity;

    const consider = (q: { x: number; y: number }, kind: SnapKind, real: boolean) => {
      const radius = real ? REAL_RADIUS : VIRTUAL_RADIUS;
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d > radius) return;
      const rank = real ? 2 : 1;
      if (rank < bestRank) return;                   // never overtake a real with a virtual
      if (rank === bestRank && d >= bestDist) return;
      best = { x: q.x, y: q.y, kind };
      bestRank = rank;
      bestDist = d;
    };

    consider({ x: 0, y: 0 }, 'endpoint', true);
    for (const e of sketch.state.entities) {
      if (e.kind === 'point') consider({ x: e.x, y: e.y }, 'endpoint', true);
    }
    // Midpoints of every non-construction line.
    for (const e of sketch.state.entities) {
      if (e.kind !== 'line' || e.construction) continue;
      const a = findPt(sketch.state, e.startId);
      const b = findPt(sketch.state, e.endId);
      if (!a || !b) continue;
      consider({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, 'midpoint', false);
    }
    // Curve quadrants — for arcs, drop quadrants outside the sweep.
    for (const e of sketch.state.entities) {
      if (e.construction) continue;
      if (e.kind === 'circle' || e.kind === 'arc') {
        const c = findPt(sketch.state, e.centerId);
        if (!c) continue;
        const quads = [
          { x: c.x + e.radius, y: c.y },
          { x: c.x - e.radius, y: c.y },
          { x: c.x, y: c.y + e.radius },
          { x: c.x, y: c.y - e.radius },
        ];
        if (e.kind === 'arc') {
          const sp = findPt(sketch.state, e.startId);
          const ep = findPt(sketch.state, e.endId);
          if (!sp || !ep) continue;
          const sa = Math.atan2(sp.y - c.y, sp.x - c.x);
          const ea = Math.atan2(ep.y - c.y, ep.x - c.x);
          for (const q of quads) {
            const ang = Math.atan2(q.y - c.y, q.x - c.x);
            if (angleInArcSweep(ang, sa, ea, e.ccw)) consider(q, 'quadrant', false);
          }
        } else {
          for (const q of quads) consider(q, 'quadrant', false);
        }
      }
    }
    // Curve-curve intersections (line-line / line-circle / line-arc / circle-circle …).
    for (const xi of allCurveIntersections(sketch.state)) consider(xi, 'intersection', false);

    if (!best) return { snapped: p, target: null };
    const b = best as { x: number; y: number; kind: SnapKind };
    return { snapped: { x: b.x, y: b.y }, target: b };
  }

  // REQ 629 — rubber-band drawing preview. Reads the live tool + draft state
  // from the sketch-editor and combines with the snapped cursor + snap target
  // to produce the overlay-renderable preview items.
  sketchPreview = computed<SketchPreview[]>(() => {
    const editor = this.sketchEditorRef();
    const sid = this.activeSketchId();
    const cursor = this.sketchCursor();
    if (!editor || !sid || !cursor) return [];
    const sketch = this.doc().sketches[sid];
    if (!sketch) return [];

    const items: SketchPreview[] = [];
    // Rubber-band rectangle (Select tool, dragging from empty space).
    // Rendered as 4 dashed lines so the existing 'line' preview kind covers
    // it without adding a new SketchPreview variant.
    const rb = editor.rubberBand();
    if (rb) {
      const corners = [
        { x: rb.start.x, y: rb.start.y },
        { x: rb.current.x, y: rb.start.y },
        { x: rb.current.x, y: rb.current.y },
        { x: rb.start.x, y: rb.current.y },
      ];
      for (let i = 0; i < 4; i++) {
        items.push({ kind: 'line', start: corners[i], end: corners[(i + 1) % 4] });
      }
    }
    const snap = this.snapTargetPoint();
    if (snap) items.push({ kind: 'snap-indicator', x: snap.x, y: snap.y, snapKind: snap.kind });

    const tool = editor.tool();
    // ── Offset preview ────────────────────────────────────────────────
    // While the user has curves queued in the offset sidebar, render
    // ghost copies of the result (dashed orange) so they can see
    // what OK will produce. The editor's `offsetPreviewState` runs
    // the same offsetChain op the commit path uses — preview ⇔
    // commit are always in sync.
    if (tool === 'offset') {
      const preview = editor.offsetPreviewState();
      if (preview && preview.newIds.length > 0) {
        const ghostState = preview.state;
        for (const id of preview.newIds) {
          const e = ghostState.entities.find(en => en.id === id);
          if (!e) continue;
          if (e.kind === 'line') {
            const a = ghostState.entities.find(en => en.id === e.startId);
            const b = ghostState.entities.find(en => en.id === e.endId);
            if (a?.kind === 'point' && b?.kind === 'point') {
              items.push({ kind: 'line', start: { x: a.x, y: a.y }, end: { x: b.x, y: b.y } });
            }
          } else if (e.kind === 'circle') {
            const c = ghostState.entities.find(en => en.id === e.centerId);
            if (c?.kind === 'point') {
              items.push({ kind: 'circle', center: { x: c.x, y: c.y }, radius: e.radius });
            }
          } else if (e.kind === 'arc') {
            const c = ghostState.entities.find(en => en.id === e.centerId);
            const sp = ghostState.entities.find(en => en.id === e.startId);
            const ep = ghostState.entities.find(en => en.id === e.endId);
            if (c?.kind === 'point' && sp?.kind === 'point' && ep?.kind === 'point') {
              items.push({
                kind: 'arc',
                center: { x: c.x, y: c.y }, radius: e.radius,
                start: { x: sp.x, y: sp.y }, end: { x: ep.x, y: ep.y }, ccw: e.ccw,
              });
            }
          }
        }
      }
      return items;
    }
    // ── Composite-shape previews ───────────────────────────────────────
    // Each multi-click gesture shows point-markers for committed clicks +
    // a live outline that follows the cursor for the next click.
    if (tool === 'rect-corner') {
      const c = editor.draftRectCorner();
      if (c) {
        items.push({ kind: 'point-marker', x: c.x, y: c.y, style: 'pending' });
        const corners = [
          { x: c.x, y: c.y }, { x: cursor.x, y: c.y },
          { x: cursor.x, y: cursor.y }, { x: c.x, y: cursor.y },
        ];
        for (let i = 0; i < 4; i++) {
          items.push({ kind: 'line', start: corners[i], end: corners[(i + 1) % 4] });
        }
      }
      return items;
    }
    // REQ Batch 6 — Text-tool rubber band: same 4-line preview as
    // rect-corner. First click anchors the box's first corner; the
    // cursor live-defines the opposite corner.
    if (tool === 'text') {
      const c = editor.draftTextRect();
      if (c) {
        items.push({ kind: 'point-marker', x: c.x, y: c.y, style: 'pending' });
        const corners = [
          { x: c.x, y: c.y }, { x: cursor.x, y: c.y },
          { x: cursor.x, y: cursor.y }, { x: c.x, y: cursor.y },
        ];
        for (let i = 0; i < 4; i++) {
          items.push({ kind: 'line', start: corners[i], end: corners[(i + 1) % 4] });
        }
      }
      return items;
    }
    if (tool === 'rect-center') {
      const c = editor.draftRectCenter();
      if (c) {
        items.push({ kind: 'point-marker', x: c.x, y: c.y, style: 'pending' });
        const hw = Math.abs(cursor.x - c.x), hh = Math.abs(cursor.y - c.y);
        const corners = [
          { x: c.x - hw, y: c.y - hh }, { x: c.x + hw, y: c.y - hh },
          { x: c.x + hw, y: c.y + hh }, { x: c.x - hw, y: c.y + hh },
        ];
        for (let i = 0; i < 4; i++) {
          items.push({ kind: 'line', start: corners[i], end: corners[(i + 1) % 4] });
        }
      }
      return items;
    }
    // Rounded-rect previews. Same outline as the rectangle tools, but
    // the four corners render as quarter arcs and the side lines stop
    // at the tangent points. Fillet radius matches the commit-time
    // default: 10% of the shorter side, clamped to ≥ 1mm.
    const pushRoundedRectOutline = (
      xmin: number, ymin: number, xmax: number, ymax: number,
    ): void => {
      const w = xmax - xmin, h = ymax - ymin;
      if (w < 0.1 || h < 0.1) return;
      const r = Math.min(Math.max(1, 0.1 * Math.min(w, h)), Math.min(w, h) / 2);
      // 4 sides — endpoints are the tangent points where each arc starts/ends.
      items.push({ kind: 'line', start: { x: xmin + r, y: ymin }, end: { x: xmax - r, y: ymin } });  // bottom
      items.push({ kind: 'line', start: { x: xmax, y: ymin + r }, end: { x: xmax, y: ymax - r } });  // right
      items.push({ kind: 'line', start: { x: xmax - r, y: ymax }, end: { x: xmin + r, y: ymax } });  // top
      items.push({ kind: 'line', start: { x: xmin, y: ymax - r }, end: { x: xmin, y: ymin + r } });  // left
      // 4 quarter arcs at each corner (CCW so the curve bulges outward).
      items.push({ kind: 'arc', center: { x: xmax - r, y: ymin + r }, start: { x: xmax - r, y: ymin }, end: { x: xmax, y: ymin + r }, radius: r, ccw: true });  // BR
      items.push({ kind: 'arc', center: { x: xmax - r, y: ymax - r }, start: { x: xmax, y: ymax - r }, end: { x: xmax - r, y: ymax }, radius: r, ccw: true });  // TR
      items.push({ kind: 'arc', center: { x: xmin + r, y: ymax - r }, start: { x: xmin + r, y: ymax }, end: { x: xmin, y: ymax - r }, radius: r, ccw: true });  // TL
      items.push({ kind: 'arc', center: { x: xmin + r, y: ymin + r }, start: { x: xmin, y: ymin + r }, end: { x: xmin + r, y: ymin }, radius: r, ccw: true });  // BL
    };
    if (tool === 'rect-rounded-corner') {
      const c = editor.draftRectRoundedCorner();
      if (c) {
        items.push({ kind: 'point-marker', x: c.x, y: c.y, style: 'pending' });
        const xmin = Math.min(c.x, cursor.x), xmax = Math.max(c.x, cursor.x);
        const ymin = Math.min(c.y, cursor.y), ymax = Math.max(c.y, cursor.y);
        pushRoundedRectOutline(xmin, ymin, xmax, ymax);
      }
      return items;
    }
    if (tool === 'rect-rounded-center') {
      const c = editor.draftRectRoundedCenter();
      if (c) {
        items.push({ kind: 'point-marker', x: c.x, y: c.y, style: 'pending' });
        const hw = Math.abs(cursor.x - c.x), hh = Math.abs(cursor.y - c.y);
        pushRoundedRectOutline(c.x - hw, c.y - hh, c.x + hw, c.y + hh);
      }
      return items;
    }
    if (tool === 'polygon') {
      const c = editor.draftPolygonCenter();
      if (c) {
        items.push({ kind: 'point-marker', x: c.x, y: c.y, style: 'pending' });
        const n = editor.polygonSides();
        const radius = Math.hypot(cursor.x - c.x, cursor.y - c.y);
        if (radius > 0.1 && n >= 3) {
          const base = Math.atan2(cursor.y - c.y, cursor.x - c.x);
          const verts: Array<{ x: number; y: number }> = [];
          for (let i = 0; i < n; i++) {
            const t = base + (2 * Math.PI * i) / n;
            verts.push({ x: c.x + radius * Math.cos(t), y: c.y + radius * Math.sin(t) });
          }
          for (let i = 0; i < n; i++) {
            items.push({ kind: 'line', start: verts[i], end: verts[(i + 1) % n] });
          }
        }
      }
      return items;
    }
    if (tool === 'slot') {
      const path = editor.draftSlotPath();
      if (path.p1) items.push({ kind: 'point-marker', x: path.p1.x, y: path.p1.y, style: 'pending' });
      if (path.p2) items.push({ kind: 'point-marker', x: path.p2.x, y: path.p2.y, style: 'pending' });
      if (path.p1 && !path.p2) {
        // First-click → cursor preview: centerline only.
        items.push({ kind: 'line', start: path.p1, end: cursor });
      }
      if (path.p1 && path.p2) {
        // Both endpoints set; preview the full slot shape using the cursor as
        // the width control point.
        const dx = path.p2.x - path.p1.x, dy = path.p2.y - path.p1.y;
        const len = Math.hypot(dx, dy);
        if (len > 1e-6) {
          const px = -dy / len, py = dx / len;
          const hw = Math.max(0.5, Math.abs(px * (cursor.x - path.p1.x) + py * (cursor.y - path.p1.y)));
          const ox = px * hw, oy = py * hw;
          const a1 = { x: path.p1.x + ox, y: path.p1.y + oy };
          const a2 = { x: path.p1.x - ox, y: path.p1.y - oy };
          const b1 = { x: path.p2.x + ox, y: path.p2.y + oy };
          const b2 = { x: path.p2.x - ox, y: path.p2.y - oy };
          items.push({ kind: 'line', start: a1, end: b1 });
          items.push({ kind: 'line', start: b2, end: a2 });
          items.push({ kind: 'arc', center: path.p2, start: b1, end: b2, radius: hw, ccw: true });
          items.push({ kind: 'arc', center: path.p1, start: a2, end: a1, radius: hw, ccw: true });
        }
      }
      return items;
    }
    if (tool === 'circle-3pt' || tool === 'arc-3pt') {
      const pts = tool === 'circle-3pt' ? editor.draftCircle3() : editor.draftArc3();
      for (const p of pts) items.push({ kind: 'point-marker', x: p.x, y: p.y, style: 'pending' });
      return items;
    }
    if (tool === 'ellipse') {
      const draft = editor.draftEllipse();
      if (draft.center) items.push({ kind: 'point-marker', x: draft.center.x, y: draft.center.y, style: 'pending' });
      if (draft.majorEnd) items.push({ kind: 'point-marker', x: draft.majorEnd.x, y: draft.majorEnd.y, style: 'pending' });
      if (draft.center && !draft.majorEnd) {
        // Cursor preview during 2nd click: a circle of the candidate major
        // radius, since the minor axis isn't defined yet.
        const radius = Math.hypot(cursor.x - draft.center.x, cursor.y - draft.center.y);
        if (radius > 0.1) items.push({ kind: 'circle', center: draft.center, radius });
      }
      return items;
    }
    if (tool === 'spline') {
      const pts = editor.draftSpline();
      for (const p of pts) items.push({ kind: 'point-marker', x: p.x, y: p.y, style: 'pending' });
      // Connect committed control points with construction lines so the user
      // can see the order. Cursor segment shows where the next click will go.
      for (let i = 1; i < pts.length; i++) {
        items.push({ kind: 'line', start: pts[i - 1], end: pts[i] });
      }
      if (pts.length > 0) {
        items.push({ kind: 'line', start: pts[pts.length - 1], end: cursor });
      }
      return items;
    }

    if (tool === 'line') {
      const startId = editor.draftLineStart();
      if (startId) {
        const startEntity = sketch.state.entities.find(e => e.id === startId);
        if (startEntity?.kind === 'point') {
          // Apply inference so the live preview shows the same horizontal/
          // vertical/on-line snap the user will get on click commit. Adds an
          // extension indicator (snap-indicator ring) at the snapped point
          // when an inference fired so the user can see why the line locked.
          const inf = inferLineEnd(
            sketch.state,
            { x: startEntity.x, y: startEntity.y },
            cursor,
          );
          items.push({ kind: 'line', start: { x: startEntity.x, y: startEntity.y }, end: inf.snapped });
          // Stack every applicable relation as its own badge — a
          // hover on a vertical converted line produces ['on line',
          // 'vertical'], for example. Falls back to the single
          // `hint` field for older callers.
          const hints = inf.hints && inf.hints.length > 0
            ? inf.hints
            : (inf.hint ? [inf.hint] : []);
          if (hints.length > 0) {
            items.push({ kind: 'snap-indicator', x: inf.snapped.x, y: inf.snapped.y });
            for (let i = 0; i < hints.length; i++) {
              items.push({
                kind: 'inference-badge',
                x: inf.snapped.x + 3,
                y: inf.snapped.y + 3 + i * 2.5,
                label: hints[i],
              });
            }
          }
          // Polar / alignment guides: dashed rays the inference engine
          // emits so the user can see what their cursor lined up with.
          if (inf.guides) {
            for (const g of inf.guides) {
              items.push({ kind: 'alignment-guide', start: g.from, end: g.to });
            }
          }
        }
      } else {
        // No first click yet — show the SW-style "on line" / "on arc" /
        // "on circle" badge when hovering over a curve (sketched or
        // converted) so the user knows where a click would land + that
        // a coincident-on-curve will be added on commit.
        const hover = inferHoverOnCurve(sketch.state, cursor);
        if (hover) {
          items.push({ kind: 'snap-indicator', x: hover.snapped.x, y: hover.snapped.y });
          // Stack each hint as its own badge so the user sees every
          // relation that fires (e.g. 'on line' + 'vertical' for a
          // vertical converted edge). Offset each row by ~2 sketch
          // units; CSS pixel-locked rendering makes this look like a
          // small column of pills.
          for (let i = 0; i < hover.hints.length; i++) {
            items.push({
              kind: 'inference-badge',
              x: hover.snapped.x + 3,
              y: hover.snapped.y + 3 + i * 2.5,
              label: hover.hints[i],
            });
          }
        }
      }
    } else if (tool === 'circle') {
      const center = editor.draftCircleCenter();
      if (center) {
        items.push({ kind: 'point-marker', x: center.x, y: center.y, style: 'pending' });
        const radius = Math.hypot(cursor.x - center.x, cursor.y - center.y);
        if (radius > 0.1) items.push({ kind: 'circle', center, radius });
      } else {
        // Pre-first-click: "on line/arc/circle" badge when hovering
        // over a curve so the user knows the center will be coincident.
        const hover = inferHoverOnCurve(sketch.state, cursor);
        if (hover) {
          items.push({ kind: 'snap-indicator', x: hover.snapped.x, y: hover.snapped.y });
          // Stack each hint as its own badge so the user sees every
          // relation that fires (e.g. 'on line' + 'vertical' for a
          // vertical converted edge). Offset each row by ~2 sketch
          // units; CSS pixel-locked rendering makes this look like a
          // small column of pills.
          for (let i = 0; i < hover.hints.length; i++) {
            items.push({
              kind: 'inference-badge',
              x: hover.snapped.x + 3,
              y: hover.snapped.y + 3 + i * 2.5,
              label: hover.hints[i],
            });
          }
        }
      }
    } else if (tool === 'arc') {
      const center = editor.draftArcCenter();
      const start = editor.draftArcStart();
      if (center) items.push({ kind: 'point-marker', x: center.x, y: center.y, style: 'pending' });
      if (start) items.push({ kind: 'point-marker', x: start.x, y: start.y, style: 'pending' });
      if (!center && !start) {
        // Pre-first-click: same on-curve hint as the line tool.
        const hover = inferHoverOnCurve(sketch.state, cursor);
        if (hover) {
          items.push({ kind: 'snap-indicator', x: hover.snapped.x, y: hover.snapped.y });
          // Stack each hint as its own badge so the user sees every
          // relation that fires (e.g. 'on line' + 'vertical' for a
          // vertical converted edge). Offset each row by ~2 sketch
          // units; CSS pixel-locked rendering makes this look like a
          // small column of pills.
          for (let i = 0; i < hover.hints.length; i++) {
            items.push({
              kind: 'inference-badge',
              x: hover.snapped.x + 3,
              y: hover.snapped.y + 3 + i * 2.5,
              label: hover.hints[i],
            });
          }
        }
      }
      if (center && start) {
        const radius = Math.hypot(start.x - center.x, start.y - center.y);
        if (radius > 0.1) {
          // Project the cursor onto the circle so the preview arc end stays at
          // the same radius as start — matches what handleArcClick commits.
          const dx = cursor.x - center.x;
          const dy = cursor.y - center.y;
          const len = Math.hypot(dx, dy);
          const end = len > 1e-9
            ? { x: center.x + radius * dx / len, y: center.y + radius * dy / len }
            : { x: center.x + radius, y: center.y };
          const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
          const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
          let delta = endAngle - startAngle;
          while (delta <= -Math.PI) delta += 2 * Math.PI;
          while (delta > Math.PI) delta -= 2 * Math.PI;
          const ccw = delta >= 0;
          items.push({ kind: 'arc', center, start: { x: start.x, y: start.y }, end, radius, ccw });
        }
      }
    }
    // Trim / Extend hover: red preview of the segment that the click would
    // affect. Computed by the editor (it owns the pick tolerance + state).
    const editHover = editor.editHoverPreview(cursor);
    if (editHover) items.push(editHover);

    // Fillet preview — one arc per queued corner showing what OK will
    // produce with the current radius. Dispatches on the incident
    // curve kinds so line+arc corners (and arc+line) also show their
    // fillet preview, matching the line+line case.
    if (tool === 'fillet') {
      const r = editor.filletRadius() ?? 5;
      for (const cornerId of editor.filletCorners()) {
        const curves = editor.curvesIncidentTo(sketch.state, cornerId);
        if (curves.length !== 2) continue;
        const [c1, c2] = curves;
        let arcCenter: { x: number; y: number } | null = null;
        let arcStart:  { x: number; y: number } | null = null;
        let arcEnd:    { x: number; y: number } | null = null;
        let ccw = false;
        if (c1.kind === 'line' && c2.kind === 'line') {
          const geom = computeFilletGeometry(sketch.state, c1.id, c2.id, r);
          if (!geom) continue;
          arcCenter = geom.C; arcStart = geom.T1; arcEnd = geom.T2; ccw = geom.ccw;
        } else if (c1.kind === 'line' && c2.kind === 'arc') {
          const geom = computeFilletLineArcGeometry(sketch.state, c1.id, c2.id, r);
          if (!geom) continue;
          arcCenter = geom.C_F; arcStart = geom.T_line; arcEnd = geom.T_arc; ccw = geom.ccw;
        } else if (c1.kind === 'arc' && c2.kind === 'line') {
          const geom = computeFilletLineArcGeometry(sketch.state, c2.id, c1.id, r);
          if (!geom) continue;
          arcCenter = geom.C_F; arcStart = geom.T_line; arcEnd = geom.T_arc; ccw = geom.ccw;
        } else {
          continue;  // arc+arc not yet supported
        }
        items.push({
          kind: 'arc',
          center: arcCenter, start: arcStart, end: arcEnd,
          radius: r, ccw,
        });
        items.push({ kind: 'point-marker', x: arcStart.x, y: arcStart.y, style: 'pending' });
        items.push({ kind: 'point-marker', x: arcEnd.x,   y: arcEnd.y,   style: 'pending' });
      }
    }
    // Chamfer preview — one cut line per queued corner.
    if (tool === 'chamfer') {
      const mode = editor.currentChamferMode();
      for (const cornerId of editor.chamferCorners()) {
        const lines = editor.linesIncidentTo(sketch.state, cornerId);
        if (lines.length !== 2) continue;
        const geom = computeChamferGeometry(sketch.state, lines[0].id, lines[1].id, mode);
        if (!geom) continue;
        items.push({ kind: 'line', start: geom.T1, end: geom.T2 });
        items.push({ kind: 'point-marker', x: geom.T1.x, y: geom.T1.y, style: 'pending' });
        items.push({ kind: 'point-marker', x: geom.T2.x, y: geom.T2.y, style: 'pending' });
      }
    }
    return items;
  });

  /** trackBy for entity rows in the Mirror panel. Keeps the DOM elements
   * stable across selection changes so the X buttons stay clickable
   * without re-render flicker. */
  trackEntityById(_idx: number, e: { id: string }): string { return e.id; }
  trackString(_idx: number, id: string): string { return id; }
  trackIndex(_idx: number, i: number): number { return i; }

  /** Fillet sidebar reads the corner set as a sorted array so the *ngFor
   * has stable ordering across signal updates. */
  filletCornersArray = computed<string[]>(() => {
    const editor = this.sketchEditorRef();
    if (!editor) return [];
    return [...editor.filletCorners()].sort();
  });
  chamferCornersArray = computed<string[]>(() => {
    const editor = this.sketchEditorRef();
    if (!editor) return [];
    return [...editor.chamferCorners()].sort();
  });
  /** Sorted ids of the curves queued for the Offset batch. Drives
   * the sidebar's entity list — same pattern as filletCornersArray. */
  offsetSelectionsArray = computed<string[]>(() => {
    const editor = this.sketchEditorRef();
    if (!editor) return [];
    return [...editor.offsetSelections().keys()].sort();
  });

  /** Friendly "Line", "Circle", or "Arc" label for an offset-queue
   * row based on the entity's kind. */
  offsetCurveLabel(id: string): string {
    const sid = this.activeSketchId();
    if (!sid) return 'Curve';
    const sketch = this.doc().sketches[sid];
    if (!sketch) return 'Curve';
    const e = sketch.state.entities.find(en => en.id === id);
    if (!e) return 'Curve';
    if (e.kind === 'line') return 'Line';
    if (e.kind === 'circle') return 'Circle';
    if (e.kind === 'arc') return 'Arc';
    return 'Curve';
  }

  /** Maps an offset-queue entity to its custom icon for the sidebar
   * row. */
  offsetCurveIcon(id: string): string {
    const sid = this.activeSketchId();
    if (!sid) return 'cad-line';
    const sketch = this.doc().sketches[sid];
    if (!sketch) return 'cad-line';
    const e = sketch.state.entities.find(en => en.id === id);
    if (!e) return 'cad-line';
    if (e.kind === 'circle') return 'cad-circle';
    if (e.kind === 'arc') return 'cad-arc';
    return 'cad-line';
  }

  /** Render "(x, y)" for a corner point id, looking up the current sketch
   * state. One-decimal precision matches the cursor readout in the
   * sketch-editor's status bar. */
  cornerCoordsLabel(pointId: string): string {
    const sid = this.activeSketchId();
    if (!sid) return '';
    const sketch = this.doc().sketches[sid];
    if (!sketch) return '';
    const pt = findPt(sketch.state, pointId);
    if (!pt) return pointId.slice(0, 8);
    const round = (n: number) => Math.round(n * 10) / 10;
    return `(${round(pt.x)}, ${round(pt.y)})`;
  }

  onSketchAction() {
    if (this.readonly()) return;
    this.pendingExtrude.set(false);
    // REQ 625 — if a flat face is currently picked, sketch on it directly.
    // Otherwise fall through to pick-plane mode where the user clicks a datum
    // (or flat face) in the viewer to host the new sketch.
    const faceId = this.lastPickedFaceId();
    if (faceId) {
      const plane = this.faceToPlane(faceId);
      if (plane) {
        this.startSketchOnFace(faceId, plane);
        return;
      }
    }
    this.setMode('pick-plane');
  }

  // REQ 625 / REQ 627 — derive a Plane3 from a flat face's tessellated mesh.
  // The sketch origin is the projection of the world origin (0,0,0) onto the
  // face plane, so the sketch's 2D (0,0) lines up with the part origin
  // wherever the face happens to live in space. xAxis is a world axis
  // projected onto the plane (prefers +X, falls back to +Y or +Z if degenerate)
  // so the sketch basis stays familiar regardless of which face was picked.
  // Returns null for curved faces or when the face geometry isn't found.
  private faceToPlane(faceId: string): import('../../../cad/lib/types').Plane3 | null {
    const g = this.geometry();
    if (!g) return null;
    const face = g.faces.find(f => f.faceId === faceId);
    if (!face || face.isFlat !== true || face.positions.length < 9) return null;
    const samplePoint: [number, number, number] = [face.positions[0], face.positions[1], face.positions[2]];
    const n: [number, number, number] = [face.normals[0], face.normals[1], face.normals[2]];
    // Project (0,0,0) onto the plane through samplePoint with normal n.
    //   p_proj = p - ((p - sample) · n) * n
    //   for p = 0: p_proj = (sample · n) * n
    const dSample = samplePoint[0] * n[0] + samplePoint[1] * n[1] + samplePoint[2] * n[2];
    const origin: [number, number, number] = [dSample * n[0], dSample * n[1], dSample * n[2]];
    // Pick xAxis = world axis with the largest in-plane component.
    const candidates: Array<[number, number, number]> = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    let bestX: [number, number, number] = [0, 0, 0];
    let bestLen = 0;
    for (const c of candidates) {
      const d = c[0] * n[0] + c[1] * n[1] + c[2] * n[2];
      const x: [number, number, number] = [c[0] - d * n[0], c[1] - d * n[1], c[2] - d * n[2]];
      const len = Math.hypot(x[0], x[1], x[2]);
      if (len > bestLen) { bestLen = len; bestX = x; }
    }
    if (bestLen < 1e-6) return null;
    bestX[0] /= bestLen; bestX[1] /= bestLen; bestX[2] /= bestLen;
    const yAxis: [number, number, number] = [
      n[1] * bestX[2] - n[2] * bestX[1],
      n[2] * bestX[0] - n[0] * bestX[2],
      n[0] * bestX[1] - n[1] * bestX[0],
    ];
    return { origin, xAxis: bestX, yAxis, normal: n };
  }

  private startSketchOnFace(faceId: string, plane: import('../../../cad/lib/types').Plane3) {
    const oriented = this.flipPlaneTowardCamera(plane);
    const { doc, sketchId } = createSketch(this.doc(), `face:${faceId}`, oriented, null);
    this.doc.set(doc);
    this.activeSketchId.set(sketchId);
    this.setMode('idle');
    this.lastPickedFaceId.set(null);
    this.selectedFeatures.set(new Set());
    this.save();
  }

  /** If the plane's normal points AWAY from the current camera, return a
   * flipped version whose normal points TOWARD the camera. We flip both
   * `normal` and `yAxis` to keep the basis right-handed (xAxis × yAxis =
   * normal); keeping xAxis stable means "sketch +x" is consistent across
   * the flip. Safe to call on freshly-created sketches because the state
   * is empty — no entities are mirrored. Without this flip, picking the
   * back of a face would put the user behind their sketch with the
   * camera looking through the model. */
  private flipPlaneTowardCamera(
    plane: import('../../../cad/lib/types').Plane3,
  ): import('../../../cad/lib/types').Plane3 {
    const viewer = this.viewerRef();
    if (!viewer) return plane;
    const cam = viewer.cameraPosition();
    const toCam: [number, number, number] = [
      cam[0] - plane.origin[0],
      cam[1] - plane.origin[1],
      cam[2] - plane.origin[2],
    ];
    const dot = plane.normal[0] * toCam[0] + plane.normal[1] * toCam[1] + plane.normal[2] * toCam[2];
    if (dot >= 0) return plane;  // already facing the camera
    return {
      origin: plane.origin,
      xAxis:  plane.xAxis,
      yAxis:  [-plane.yAxis[0], -plane.yAxis[1], -plane.yAxis[2]],
      normal: [-plane.normal[0], -plane.normal[1], -plane.normal[2]],
    };
  }

  onExtrudeAction() {
    if (this.readonly()) return;
    // Shortcut: if the user has exactly one sketch already selected in the
    // tree, jump straight into the Extrude sidebar for it. Skips the
    // "click a sketch / datum" pick step entirely.
    const selected = this.selectedSketches();
    if (selected.size === 1) {
      const sid = [...selected][0];
      this.openExtrudeDialog(sid);
      return;
    }
    this.setMode('pick-extrude-target');
  }

  // Selection from viewer click → routed through mode.
  onSelectionChange(id: string | null) { this.handleSelection(id); }

  private handleSelection(id: string | null) {
    this.selected.set(id);
    const m = this.mode();
    if (id === null) return;

    // Datum Plane sidebar: a click on an existing datum (origin or
    // user) becomes a plane-ref pick for the active method's slot.
    if (this.datumPlaneSidebar() && id.startsWith('datum:')) {
      const datumId = id.substring('datum:'.length);
      if (this.addDatumPlaneDatumPick(datumId)) return;
    }
    if (m === 'pick-plane') {
      if (id.startsWith('datum:')) { this.startSketchOnDatum(id); return; }
      // REQ 625: pick-plane also accepts a flat face — sketch on it.
      const plane = this.faceToPlane(id);
      if (plane) { this.startSketchOnFace(id, plane); return; }
    }
    if (m === 'pick-extrude-target' && id.startsWith('datum:')) {
      this.pendingExtrude.set(true);
      this.startSketchOnDatum(id);
      return;
    }
  }

  onTreeSketchSelected(sketchId: string) {
    const m = this.mode();
    if (m === 'pick-extrude-target') { this.openExtrudeDialog(sketchId); return; }
    if (m === 'pick-cut-extrude-target') { this.openExtrudeDialog(sketchId, 'cutExtrude'); return; }
    if (m === 'pick-revolve-target') { this.openRevolveDialog(sketchId, 'revolve'); return; }
    if (m === 'pick-cut-revolve-target') { this.openRevolveDialog(sketchId, 'cutRevolve'); return; }
  }

  // Single-click on a sketch row in normal mode selects (highlights) it.
  // Edit / Delete / Hide live on the right-click context menu. Selecting
  // a sketch clears any feature selection so the two selection modes don't
  // conflict; shift/ctrl extend the selection within sketches.
  onTreeSketchSelect(ev: SketchSelectEvent) {
    const next = new Set(this.selectedSketches());
    if (ev.shiftKey || ev.ctrlKey) {
      if (next.has(ev.sketchId)) next.delete(ev.sketchId);
      else next.add(ev.sketchId);
    } else {
      next.clear();
      next.add(ev.sketchId);
    }
    this.selectedSketches.set(next);
    if (!ev.shiftKey && !ev.ctrlKey) this.selectedFeatures.set(new Set());
  }

  onDatumVisibilityToggled(datumId: string) {
    if (this.readonly()) return;
    const tree = this.featureTree();
    const newFeatures = tree.features.map(f => {
      if (f.type !== 'origin') return f;
      const vis = { ...defaultDatumVisibility(), ...(f.visibility ?? {}) };
      vis[datumId] = !(vis[datumId] !== false);
      return { ...f, visibility: vis };
    });
    this.featureTree.set({ ...tree, features: newFeatures });
    this.save();
  }

  private startSketchOnDatum(datumFullId: string) {
    const datumId = datumFullId.substring('datum:'.length);
    // First try the hard-coded origin datums; then look up the picked
    // id in the current geometry's datums array for user-defined
    // planes (REQ 657). User datums carry a `plane` sidecar with the
    // full Plane3 (origin + xAxis + yAxis + normal).
    let plane = planeForDatum(datumId);
    if (!plane) {
      const userDatum = this.geometry()?.datums.find(d => d.id === datumId && d.kind === 'plane');
      if (userDatum && (userDatum as any).plane) plane = (userDatum as any).plane;
    }
    if (!plane) {
      this.errors.showError('Selected host is not a planar surface');
      return;
    }
    const oriented = this.flipPlaneTowardCamera(plane);
    const { doc, sketchId } = createSketch(this.doc(), datumFullId, oriented, null);
    this.doc.set(doc);
    this.activeSketchId.set(sketchId);
    this.setMode('idle');
    this.save();
  }

  onSketchChanged(state: SketchState) {
    const sid = this.activeSketchId();
    if (!sid) return;
    this.doc.set(updateSketchState(this.doc(), sid, state));
    this.save();
  }

  onExitSketch() {
    const sid = this.activeSketchId();
    this.activeSketchId.set(null);
    // Restore the sketch's pre-edit visibility. Skip when the user
    // explicitly toggled visibility during the edit session (we'd
    // overwrite their choice) — heuristic: only restore if the
    // current state matches what we set on enter (visible). If the
    // user manually hid it during edit, that's their preference.
    const snap = this._sketchVisibilityBeforeEdit;
    if (snap && snap.sketchId === sid) {
      const cur = this.doc().sketches[snap.sketchId];
      if (cur && cur.visible !== false && !snap.wasVisible) {
        this.doc.set(setSketchVisibility(this.doc(), snap.sketchId, false));
      }
      this._sketchVisibilityBeforeEdit = null;
    }
    this.save();
    if (sid && this.pendingExtrude()) {
      this.pendingExtrude.set(false);
      this.openExtrudeDialog(sid);
    }
  }

  // Called from the sketch toolbar's "Extrude…" shortcut.
  onExtrudeRequested() {
    const sid = this.activeSketchId();
    if (!sid) return;
    this.activeSketchId.set(null);
    this.openExtrudeDialog(sid, 'extrude');
  }

  /** Sketch toolbar "Revolve" shortcut — invoked from inside a sketch.
   * Delegates to openRevolveDialog using the currently-active sketch id. */
  onRevolveRequested() {
    const sid = this.activeSketchId();
    if (!sid) return;
    this.openRevolveDialog(sid, 'revolve');
  }

  /** Features ribbon "Revolve" action. Same shortcut pattern as
   * onExtrudeAction: jump straight into the sidebar when exactly one
   * sketch is selected in the tree, otherwise enter pick-revolve-target
   * mode so the user can pick a sketch from the tree or viewer. */
  onRevolveAction() {
    if (this.readonly()) return;
    const selected = this.selectedSketches();
    if (selected.size === 1) {
      const sid = [...selected][0];
      this.openRevolveDialog(sid, 'revolve');
      return;
    }
    this.setMode('pick-revolve-target');
  }

  /** Features ribbon "Cut Revolve" action. Same flow as onRevolveAction
   * but emits a CutRevolveFeature on commit. Requires an additive body
   * upstream — there's nothing to cut FROM otherwise. */
  onCutRevolveAction() {
    if (this.readonly()) return;
    if (!this.hasAdditiveBody()) {
      this.errors.showError('Cut Revolve needs an existing body to cut from. Add an Extrude, Revolve, or Sweep first.');
      return;
    }
    const selected = this.selectedSketches();
    if (selected.size === 1) {
      const sid = [...selected][0];
      this.openRevolveDialog(sid, 'cutRevolve');
      return;
    }
    this.setMode('pick-cut-revolve-target');
  }

  /** Open the Revolve sidebar for a given sketch. Validates that the
   * sketch has both at least one line (axis candidate) and at least one
   * closed region (profile). Auto-picks the unique construction line as
   * axis when there's exactly one; otherwise leaves axis empty so the
   * user must pick. */
  private openRevolveDialog(sid: string, mode: 'revolve' | 'cutRevolve' = 'revolve') {
    const sketch = this.doc().sketches[sid];
    if (!sketch) return;
    const lines = sketch.state.entities.filter((e): e is import('../../../cad/lib/types').LineEntity => e.kind === 'line');
    if (lines.length === 0) {
      this.errors.showError('Revolve needs a sketched line as the axis. Add a line (preferably a construction line) and try again.');
      return;
    }
    const { regions, errors: regionErrors } = extractRegions(sketch.state);
    if (regions.length === 0) {
      this.errors.showError(friendlyError(regionErrors[0] || 'no closed loops in sketch'));
      return;
    }
    this.activeSketchId.set(null);
    this.setMode('idle');
    // Auto-pick the single construction line if there's exactly one;
    // otherwise leave null so the user must pick. (Matches SolidWorks
    // which auto-picks the unique centerline.)
    const constructionLines = lines.filter(l => l.construction);
    const autoPick = constructionLines.length === 1 ? constructionLines[0].id : null;
    this.revolveAxisLineId.set(autoPick);
    this.revolveAngle.set(360);
    this.revolveAngleExpression.set(null);
    this.revolveFlipped.set(false);
    this.extrudeSelectedRegions.set(new Set([0]));
    this.extrudeHoveredRegion.set(null);
    this.revolveSidebar.set({ sketchId: sid, regionCount: regions.length, mode });
    // Auto-arm axis-pick mode unless we already auto-picked the unique
    // construction line — same affordance as Mirror's pick-axis stage.
    this.axisPickMode.set(autoPick === null);
  }

  /** Candidates the axis picker lists, construction lines first. Read
   * by the sidebar template via revolveAxisCandidates(). Construction
   * lines sort first (they're the natural axis); within each group lines
   * sort by id for stable order across renders. */
  revolveAxisCandidates(): Array<{ id: string; label: string; construction: boolean }> {
    const ctx = this.revolveSidebar();
    if (!ctx) return [];
    const sketch = this.doc().sketches[ctx.sketchId];
    if (!sketch) return [];
    const lines = sketch.state.entities.filter((e): e is import('../../../cad/lib/types').LineEntity => e.kind === 'line');
    const findPt = (pid: string) => sketch.state.entities.find(e => e.id === pid && e.kind === 'point') as import('../../../cad/lib/types').PointEntity | undefined;
    let nextSeq = 1;
    const out = lines.map(l => {
      const a = findPt(l.startId);
      const b = findPt(l.endId);
      // Human-friendly label: prefer geometry-based ("Vertical at x=5",
      // "Horizontal at y=0", "(0,0) → (10,5)") over the raw id. Falls back
      // to "Line N" when endpoints aren't found.
      let geom: string;
      if (a && b) {
        const fmt = (n: number) => Number.isInteger(n) ? `${n}` : n.toFixed(2);
        const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
        if (dx < 1e-4) geom = `Vertical at x=${fmt(a.x)}`;
        else if (dy < 1e-4) geom = `Horizontal at y=${fmt(a.y)}`;
        else geom = `(${fmt(a.x)}, ${fmt(a.y)}) → (${fmt(b.x)}, ${fmt(b.y)})`;
      } else {
        geom = `Line ${nextSeq++}`;
      }
      const construction = !!(l as { construction?: boolean }).construction;
      return {
        id: l.id,
        label: construction ? `${geom} · construction` : geom,
        construction,
      };
    });
    out.sort((a, b) => Number(b.construction) - Number(a.construction) || a.id.localeCompare(b.id));
    return out;
  }
  trackLineId = (_: number, l: { id: string }) => l.id;

  /** Footer cursor coordinate formatter: 3 decimals, trailing zeros
   * stripped, em-dash when the cursor is off the plane. Used by the
   * sketch-mode HUD readout. */
  formatCursorCoord(n: number | undefined): string {
    if (n === undefined || n === null || !isFinite(n)) return '—';
    return n.toFixed(3).replace(/\.?0+$/, '');
  }

  /** Click on an axis row: select if not selected, otherwise deselect.
   * Lets the user back out of an auto-pick to choose a different line. */
  toggleRevolveAxis(lineId: string) {
    this.revolveAxisLineId.set(this.revolveAxisLineId() === lineId ? null : lineId);
  }

  canCommitRevolve(): boolean {
    if (!this.revolveSidebar()) return false;
    if (this.revolveAxisLineId() === null) return false;
    if (this.extrudeSelectedRegions().size === 0) return false;
    const a = this.revolveAngle();
    return isFinite(a) && a > 0 && a <= 360;
  }

  commitRevolveSidebar() {
    const ctx = this.revolveSidebar();
    if (!ctx || !this.canCommitRevolve()) return;
    const axisLineId = this.revolveAxisLineId()!;
    const angle = this.revolveAngle();
    const flipped = this.revolveFlipped();
    const regionIndices = [...this.extrudeSelectedRegions()].sort((a, b) => a - b);
    this.revolveSidebar.set(null);
    this.extrudeHoveredRegion.set(null);
    this.axisPickMode.set(false);
    this.setMode('idle');
    if (ctx.editingFeatureId) {
      this.featureTree.set(updateFeatureParam<import('../../../cad/lib/types').RevolveFeature>(
        this.featureTree(), ctx.editingFeatureId,
        { axisLineId, angle, flipped, regionIndices },
      ));
      this._writeRevolveEquations(ctx.editingFeatureId);
      this.save();
    } else {
      const base = ctx.mode === 'cutRevolve'
        ? { type: 'cutRevolve' as const, sketchId: ctx.sketchId, axisLineId, angle, flipped, regionIndices }
        : { type: 'revolve' as const, sketchId: ctx.sketchId, axisLineId, angle, flipped, regionIndices };
      const nextTree = addFeature(this.featureTree(), base);
      this.featureTree.set(nextTree);
      const newFeatureId = nextTree.features[nextTree.features.length - 1]?.id;
      if (newFeatureId) this._writeRevolveEquations(newFeatureId);
      // Auto-hide the source sketch after the revolve commits, same as
      // Extrude / Cut. Users can re-show via the tree visibility toggle.
      this.doc.set(setSketchVisibility(this.doc(), ctx.sketchId, false));
      this.save();
    }
  }

  cancelRevolveSidebar() {
    this.revolveSidebar.set(null);
    this.revolveAxisLineId.set(null);
    this.extrudeHoveredRegion.set(null);
    this.axisPickMode.set(false);
    this.setMode('idle');
  }

  /** Features ribbon "Sweep" action. Opens the Sweep sidebar; if exactly
   * one sketch is selected in the tree, prefill it as the profile so the
   * user only has to pick a path. */
  onSweepAction() {
    if (this.readonly()) return;
    const selected = this.selectedSketches();
    const profileId = selected.size === 1 ? [...selected][0] : null;
    this.openSweepDialog('sweep', profileId);
  }

  /** Features ribbon "Cut Sweep" action. Same flow as onSweepAction
   * but emits a CutSweepFeature on commit. Requires an additive body
   * upstream — there's nothing to cut FROM otherwise. */
  onCutSweepAction() {
    if (this.readonly()) return;
    if (!this.hasAdditiveBody()) {
      this.errors.showError('Cut Sweep needs an existing body to cut from. Add an Extrude, Revolve, or Sweep first.');
      return;
    }
    const selected = this.selectedSketches();
    const profileId = selected.size === 1 ? [...selected][0] : null;
    this.openSweepDialog('cutSweep', profileId);
  }

  /** Open the Sweep sidebar in either additive or subtractive mode.
   * Profile may be pre-filled (from a selected sketch); path always
   * starts empty so the user must pick. */
  private openSweepDialog(mode: 'sweep' | 'cutSweep', profileId: string | null) {
    this.activeSketchId.set(null);
    this.setMode(mode === 'sweep' ? 'pick-sweep-target' : 'pick-cut-sweep-target');
    this.sweepProfileSketchId.set(profileId);
    this.sweepPathSketchId.set(null);
    this.sweepMerge.set(true);
    this.sweepSidebar.set({ mode });
  }

  /** Dropdown options for both Profile and Path fields. Lists every
   * sketch in the doc with its name (or id fallback). Profile/path
   * mutually exclude each other via the `disabled` attr in the template. */
  sweepSketchOptions = computed<Array<{ id: string; label: string }>>(() => {
    const doc = this.doc();
    return Object.values(doc.sketches).map(sk => ({
      id: sk.id,
      label: sk.name && sk.name.trim() ? sk.name : `${sk.id} — ${sk.hostId}`,
    })).sort((a, b) => a.label.localeCompare(b.label));
  });
  trackSketchId = (_: number, s: { id: string }) => s.id;

  canCommitSweep(): boolean {
    if (!this.sweepSidebar()) return false;
    const p = this.sweepProfileSketchId();
    const q = this.sweepPathSketchId();
    if (!p || !q || p === q) return false;
    if (!this.doc().sketches[p] || !this.doc().sketches[q]) return false;
    return true;
  }

  commitSweepSidebar() {
    const ctx = this.sweepSidebar();
    if (!ctx || !this.canCommitSweep()) return;
    const profileSketchId = this.sweepProfileSketchId()!;
    const pathSketchId = this.sweepPathSketchId()!;
    const merge = this.sweepMerge();
    this.sweepSidebar.set(null);
    this.setMode('idle');
    if (ctx.editingFeatureId) {
      this.featureTree.set(updateFeatureParam<import('../../../cad/lib/types').SweepFeature>(
        this.featureTree(), ctx.editingFeatureId,
        ctx.mode === 'sweep'
          ? { profileSketchId, pathSketchId, merge }
          : { profileSketchId, pathSketchId } as Partial<import('../../../cad/lib/types').SweepFeature>,
      ));
      this.save();
    } else {
      const base = ctx.mode === 'sweep'
        ? { type: 'sweep' as const, profileSketchId, pathSketchId, merge }
        : { type: 'cutSweep' as const, profileSketchId, pathSketchId };
      this.featureTree.set(addFeature(this.featureTree(), base));
      // Auto-hide both source sketches, same as Extrude / Revolve.
      let doc = this.doc();
      doc = setSketchVisibility(doc, profileSketchId, false);
      doc = setSketchVisibility(doc, pathSketchId, false);
      this.doc.set(doc);
      this.save();
    }
  }

  cancelSweepSidebar() {
    this.sweepSidebar.set(null);
    this.sweepProfileSketchId.set(null);
    this.sweepPathSketchId.set(null);
    this.setMode('idle');
  }

  // ── Loft ───────────────────────────────────────────────────────────────

  loftSidebar = signal<{ editingFeatureId?: string } | null>(null);
  /** Ordered profile sketches to loft between (the section order). */
  loftSketchIds = signal<string[]>([]);
  loftMerge = signal<boolean>(true);

  onLoftAction(): void {
    if (this.readonly()) return;
    // Pre-fill from any currently-selected sketches.
    const pre = [...this.selectedSketches()].filter(id => this.doc().sketches[id]);
    this.activeSketchId.set(null);
    this.setMode('idle');
    this.loftSketchIds.set(pre);
    this.loftMerge.set(true);
    this.loftSidebar.set({});
  }

  loftSketchLabel(sid: string): string {
    const sk = this.doc().sketches[sid];
    if (!sk) return sid;
    return sk.name && sk.name.trim() ? sk.name : `${sk.id} — ${sk.hostId}`;
  }
  trackLoftSection = (i: number, sid: string) => `${sid}#${i}`;

  addLoftSection(sid: string): void {
    if (!sid || this.loftSketchIds().includes(sid)) return;
    this.loftSketchIds.set([...this.loftSketchIds(), sid]);
  }
  removeLoftSection(i: number): void {
    const next = [...this.loftSketchIds()];
    next.splice(i, 1);
    this.loftSketchIds.set(next);
  }
  moveLoftSection(i: number, dir: number): void {
    const next = [...this.loftSketchIds()];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    this.loftSketchIds.set(next);
  }
  canCommitLoft(): boolean {
    const ids = this.loftSketchIds();
    return ids.length >= 2 && ids.every(id => !!this.doc().sketches[id]);
  }
  commitLoftSidebar(): void {
    const ctx = this.loftSidebar();
    if (!ctx || !this.canCommitLoft()) return;
    const sketchIds = [...this.loftSketchIds()];
    const merge = this.loftMerge();
    this.loftSidebar.set(null);
    this.setMode('idle');
    if (ctx.editingFeatureId) {
      this.featureTree.set(updateFeatureParam<import('../../../cad/lib/types').LoftFeature>(
        this.featureTree(), ctx.editingFeatureId, { sketchIds, merge }));
      this.save();
    } else {
      this.featureTree.set(addFeature(this.featureTree(), { type: 'loft' as const, sketchIds, merge }));
      // Auto-hide the section sketches, same as Extrude / Sweep.
      let doc = this.doc();
      for (const sid of sketchIds) doc = setSketchVisibility(doc, sid, false);
      this.doc.set(doc);
      this.save();
    }
  }
  cancelLoftSidebar(): void {
    this.loftSidebar.set(null);
    this.loftSketchIds.set([]);
    this.setMode('idle');
  }

  // ── 3D Fillet / Chamfer ────────────────────────────────────────────────

  onFilletAction(): void { this._openEdgeBlendSidebar('fillet'); }
  onChamferAction(): void { this._openEdgeBlendSidebar('chamfer'); }

  // ── Datum Plane handlers — REQ 657 ────────────────────────────────

  /** Open the Datum Plane sidebar. Defaults to the offset method
   * (most common). Auto-enters vertex + edge + face pick modes so
   * subsequent clicks in the viewer route to whichever slot the
   * current method needs. */
  onDatumPlaneAction(): void {
    if (this.readonly()) return;
    if (this.datumPlaneSidebar()) {
      this.cancelDatumPlaneSidebar();
      return;
    }
    this._resetDatumPlaneInputs();
    this.datumPlaneSidebar.set({ method: 'offset' });
    this._armDatumPlanePicks();
  }

  private _resetDatumPlaneInputs(): void {
    this.datumPlaneRefA.set(null);
    this.datumPlaneRefB.set(null);
    this.datumPlaneEdge.set(null);
    this.datumPlaneVertices.set([]);
    this.datumPlaneCylinderFaceId.set(null);
    this.datumPlaneDistance.set(10);
    this.datumPlaneDistanceExpression.set(null);
    this.datumPlaneAngle.set(45);
    this.datumPlaneAngleExpression.set(null);
    this.datumPlaneFlipped.set(false);
  }

  private _armDatumPlanePicks(): void {
    this.vertexPickMode.set(true);
    this.edgePickMode.set(true);
    this.facePickMode.set(true);
  }

  cancelDatumPlaneSidebar(): void {
    this.datumPlaneSidebar.set(null);
    this.vertexPickMode.set(false);
    this.edgePickMode.set(false);
    this.facePickMode.set(false);
    this._resetDatumPlaneInputs();
  }

  setDatumPlaneMethod(method: NonNullable<ReturnType<typeof this.datumPlaneSidebar>>['method']): void {
    const ctx = this.datumPlaneSidebar();
    if (!ctx) return;
    // Switching methods clears all picks/scalars so the user starts
    // fresh — different methods need different inputs and stale slots
    // would silently feed wrong refs into the compute.
    this._resetDatumPlaneInputs();
    this.datumPlaneSidebar.set({ ...ctx, method });
    this._armDatumPlanePicks();
  }

  /** Route a face pick to the active datum-plane sidebar's next open
   * slot. The slot priority varies by method. Returns true when the
   * pick was consumed (so the editor's onFacePicked stops dispatching). */
  addDatumPlaneFacePick(faceId: string, fallbackPlane: Plane3): boolean {
    const ctx = this.datumPlaneSidebar();
    if (!ctx) return false;
    const planeRef: PlaneRef = { kind: 'face', faceId, fallbackPlane };
    switch (ctx.method) {
      case 'offset':
      case 'parallelThroughPoint':
      case 'angleThroughEdge':
      case 'lineAndPerpFace':
        this.datumPlaneRefA.set(planeRef);
        return true;
      case 'midPlane':
        if (!this.datumPlaneRefA()) this.datumPlaneRefA.set(planeRef);
        else this.datumPlaneRefB.set(planeRef);
        return true;
      case 'tangentCylinder':
        // First face is the cylinder; second is the reference plane.
        if (!this.datumPlaneCylinderFaceId()) this.datumPlaneCylinderFaceId.set(faceId);
        else this.datumPlaneRefA.set(planeRef);
        return true;
      case 'threePoints':
      case 'pointAndPerpEdge':
        return false;  // these methods don't accept face picks
    }
    return false;
  }

  /** Route an edge pick to the active datum-plane sidebar. */
  addDatumPlaneEdgePick(edgeRef: EdgeRef3D): boolean {
    const ctx = this.datumPlaneSidebar();
    if (!ctx) return false;
    if (ctx.method === 'angleThroughEdge' || ctx.method === 'lineAndPerpFace' || ctx.method === 'pointAndPerpEdge') {
      this.datumPlaneEdge.set(edgeRef);
      return true;
    }
    return false;
  }

  /** Route a vertex pick to the active datum-plane sidebar. */
  addDatumPlaneVertexPick(vertexRef: VertexRef): boolean {
    const ctx = this.datumPlaneSidebar();
    if (!ctx) return false;
    if (ctx.method === 'threePoints') {
      const cur = this.datumPlaneVertices();
      if (cur.length >= 3) return true;
      this.datumPlaneVertices.set([...cur, vertexRef]);
      return true;
    }
    if (ctx.method === 'parallelThroughPoint' || ctx.method === 'pointAndPerpEdge') {
      this.datumPlaneVertices.set([vertexRef]);
      return true;
    }
    return false;
  }

  /** Route a datum-plane pick (clicking an existing plane datum) to
   * the active sidebar. */
  addDatumPlaneDatumPick(datumId: string): boolean {
    const ctx = this.datumPlaneSidebar();
    if (!ctx) return false;
    const ref: PlaneRef = { kind: 'datum', datumId };
    switch (ctx.method) {
      case 'offset':
      case 'parallelThroughPoint':
      case 'angleThroughEdge':
      case 'lineAndPerpFace':
        this.datumPlaneRefA.set(ref);
        return true;
      case 'midPlane':
        if (!this.datumPlaneRefA()) this.datumPlaneRefA.set(ref);
        else this.datumPlaneRefB.set(ref);
        return true;
      case 'tangentCylinder':
        this.datumPlaneRefA.set(ref);
        return true;
      case 'threePoints':
      case 'pointAndPerpEdge':
        return false;
    }
    return false;
  }

  /** Composes a DatumPlaneFeature from the current sidebar state.
   * Returns null when required picks are missing for the active
   * method — the caller surfaces a sidebar disable / tooltip. */
  private _buildDatumPlaneFeature(featureId: string): DatumPlaneFeature | null {
    const ctx = this.datumPlaneSidebar();
    if (!ctx) return null;
    const baseFields = {
      id: featureId,
      type: 'datumPlane' as const,
      name: `Plane ${this._countFeaturesByType('datumPlane') + 1}`,
      createdAt: Date.now(),
    };
    switch (ctx.method) {
      case 'offset': {
        const planeRef = this.datumPlaneRefA();
        if (!planeRef) return null;
        return { ...baseFields, method: { kind: 'offset', planeRef, distance: this.datumPlaneDistance(), flipped: this.datumPlaneFlipped() } };
      }
      case 'parallelThroughPoint': {
        const planeRef = this.datumPlaneRefA();
        const v = this.datumPlaneVertices()[0];
        if (!planeRef || !v) return null;
        return { ...baseFields, method: { kind: 'parallelThroughPoint', planeRef, vertexRef: v } };
      }
      case 'angleThroughEdge': {
        const planeRef = this.datumPlaneRefA();
        const e = this.datumPlaneEdge();
        if (!planeRef || !e) return null;
        return { ...baseFields, method: { kind: 'angleThroughEdge', planeRef, edgeRef: e, angleDeg: this.datumPlaneAngle() } };
      }
      case 'threePoints': {
        const vs = this.datumPlaneVertices();
        if (vs.length < 3) return null;
        return { ...baseFields, method: { kind: 'threePoints', vertexRefs: [vs[0], vs[1], vs[2]] } };
      }
      case 'midPlane': {
        const a = this.datumPlaneRefA(), b = this.datumPlaneRefB();
        if (!a || !b) return null;
        return { ...baseFields, method: { kind: 'midPlane', planeRefA: a, planeRefB: b } };
      }
      case 'lineAndPerpFace': {
        const planeRef = this.datumPlaneRefA();
        const e = this.datumPlaneEdge();
        if (!planeRef || !e) return null;
        return { ...baseFields, method: { kind: 'lineAndPerpFace', edgeRef: e, planeRef } };
      }
      case 'pointAndPerpEdge': {
        const v = this.datumPlaneVertices()[0];
        const e = this.datumPlaneEdge();
        if (!v || !e) return null;
        return { ...baseFields, method: { kind: 'pointAndPerpEdge', vertexRef: v, edgeRef: e } };
      }
      case 'tangentCylinder': {
        const cyl = this.datumPlaneCylinderFaceId();
        const planeRef = this.datumPlaneRefA();
        if (!cyl || !planeRef) return null;
        return { ...baseFields, method: { kind: 'tangentCylinder', cylinderFaceId: cyl, planeRef, flipped: this.datumPlaneFlipped() } };
      }
    }
  }

  canCommitDatumPlane(): boolean {
    if (!this.datumPlaneSidebar()) return false;
    return this._buildDatumPlaneFeature('preview') !== null;
  }

  commitDatumPlaneSidebar(): void {
    const ctx = this.datumPlaneSidebar();
    if (!ctx) return;
    const tree = this.featureTree();
    const seq = tree.nextFeatureSeq;
    const id = ctx.editingFeatureId || `f${seq}`;
    const feature = this._buildDatumPlaneFeature(id);
    if (!feature) return;
    if (ctx.editingFeatureId) {
      this.featureTree.set(updateFeatureParam<any>(this.featureTree(), id, feature as any));
    } else {
      this.featureTree.set({
        features: [...tree.features, feature],
        nextFeatureSeq: seq + 1,
        defaultUnit: tree.defaultUnit,
      });
    }
    this.cancelDatumPlaneSidebar();
    this.save();
  }

  // ── Datum Axis handlers — REQ 660 ──────────────────────────────────

  onDatumAxisAction(): void {
    if (this.readonly()) return;
    if (this.datumAxisSidebar()) { this.cancelDatumAxisSidebar(); return; }
    this._resetDatumAxisInputs();
    this.datumAxisSidebar.set({ method: 'twoPoints' });
    this._armDatumAxisPicks();
  }
  private _resetDatumAxisInputs(): void {
    this.datumAxisVertexA.set(null);
    this.datumAxisVertexB.set(null);
    this.datumAxisEdge.set(null);
    this.datumAxisPlaneA.set(null);
    this.datumAxisPlaneB.set(null);
    this.datumAxisCylinderFaceId.set(null);
    this.datumAxisCylinderFallback.set(null);
  }
  private _armDatumAxisPicks(): void {
    this.vertexPickMode.set(true);
    this.edgePickMode.set(true);
    this.facePickMode.set(true);
  }
  cancelDatumAxisSidebar(): void {
    this.datumAxisSidebar.set(null);
    this.vertexPickMode.set(false);
    this.edgePickMode.set(false);
    this.facePickMode.set(false);
    this._resetDatumAxisInputs();
  }
  setDatumAxisMethod(method: NonNullable<ReturnType<typeof this.datumAxisSidebar>>['method']): void {
    const ctx = this.datumAxisSidebar();
    if (!ctx) return;
    this._resetDatumAxisInputs();
    this.datumAxisSidebar.set({ ...ctx, method });
    this._armDatumAxisPicks();
  }

  /** Route a vertex pick to the active axis-sidebar slot. Returns
   * true when consumed so the outer dispatcher stops. */
  addDatumAxisVertexPick(vRef: VertexRef): boolean {
    const ctx = this.datumAxisSidebar();
    if (!ctx) return false;
    if (ctx.method === 'twoPoints') {
      if (!this.datumAxisVertexA()) this.datumAxisVertexA.set(vRef);
      else this.datumAxisVertexB.set(vRef);
      return true;
    }
    if (ctx.method === 'pointAndPerpFace') {
      this.datumAxisVertexA.set(vRef);
      return true;
    }
    return false;
  }
  addDatumAxisEdgePick(eRef: EdgeRef3D): boolean {
    const ctx = this.datumAxisSidebar();
    if (!ctx) return false;
    if (ctx.method === 'alongEdge') {
      this.datumAxisEdge.set(eRef);
      return true;
    }
    return false;
  }
  addDatumAxisFacePick(faceId: string, fallbackPlane: Plane3): boolean {
    const ctx = this.datumAxisSidebar();
    if (!ctx) return false;
    const planeRef: PlaneRef = { kind: 'face', faceId, fallbackPlane };
    if (ctx.method === 'twoPlanesIntersection') {
      if (!this.datumAxisPlaneA()) this.datumAxisPlaneA.set(planeRef);
      else this.datumAxisPlaneB.set(planeRef);
      return true;
    }
    if (ctx.method === 'pointAndPerpFace') {
      this.datumAxisPlaneA.set(planeRef);
      return true;
    }
    if (ctx.method === 'cylindricalFaceAxis') {
      // Use the kernel-reported face axis if available (will need
      // surface introspection later); for Phase 1, take centroid +
      // normal as a stand-in until cylindricalFaceAxisSnapshot
      // lands. The compute helper will fall back to its snapshot.
      this.datumAxisCylinderFaceId.set(faceId);
      this.datumAxisCylinderFallback.set({
        origin: fallbackPlane.origin,
        direction: fallbackPlane.normal,
      });
      return true;
    }
    return false;
  }

  canCommitDatumAxis(): boolean {
    const ctx = this.datumAxisSidebar();
    if (!ctx) return false;
    switch (ctx.method) {
      case 'twoPoints': return !!this.datumAxisVertexA() && !!this.datumAxisVertexB();
      case 'alongEdge': return !!this.datumAxisEdge();
      case 'twoPlanesIntersection': return !!this.datumAxisPlaneA() && !!this.datumAxisPlaneB();
      case 'cylindricalFaceAxis': return !!this.datumAxisCylinderFaceId() && !!this.datumAxisCylinderFallback();
      case 'pointAndPerpFace': return !!this.datumAxisVertexA() && !!this.datumAxisPlaneA();
    }
  }

  private _buildDatumAxisFeature(id: string): import('../../../cad/lib/types').DatumAxisFeature | null {
    const ctx = this.datumAxisSidebar();
    if (!ctx) return null;
    const base = { id, type: 'datumAxis' as const, createdAt: Date.now() };
    switch (ctx.method) {
      case 'twoPoints': {
        const a = this.datumAxisVertexA(), b = this.datumAxisVertexB();
        if (!a || !b) return null;
        return { ...base, method: { kind: 'twoPoints', vertexRefA: a, vertexRefB: b } };
      }
      case 'alongEdge': {
        const e = this.datumAxisEdge();
        if (!e) return null;
        return { ...base, method: { kind: 'alongEdge', edgeRef: e } };
      }
      case 'twoPlanesIntersection': {
        const a = this.datumAxisPlaneA(), b = this.datumAxisPlaneB();
        if (!a || !b) return null;
        return { ...base, method: { kind: 'twoPlanesIntersection', planeRefA: a, planeRefB: b } };
      }
      case 'cylindricalFaceAxis': {
        const fid = this.datumAxisCylinderFaceId();
        const fb = this.datumAxisCylinderFallback();
        if (!fid || !fb) return null;
        return { ...base, method: { kind: 'cylindricalFaceAxis', cylinderFaceId: fid, fallbackAxis: fb } };
      }
      case 'pointAndPerpFace': {
        const v = this.datumAxisVertexA(), p = this.datumAxisPlaneA();
        if (!v || !p) return null;
        return { ...base, method: { kind: 'pointAndPerpFace', vertexRef: v, planeRef: p } };
      }
    }
  }

  commitDatumAxisSidebar(): void {
    const ctx = this.datumAxisSidebar();
    if (!ctx) return;
    const tree = this.featureTree();
    const seq = tree.nextFeatureSeq;
    const id = ctx.editingFeatureId || `f${seq}`;
    const feature = this._buildDatumAxisFeature(id);
    if (!feature) return;
    if (ctx.editingFeatureId) {
      this.featureTree.set(updateFeatureParam<any>(this.featureTree(), id, feature as any));
    } else {
      this.featureTree.set({
        features: [...tree.features, feature],
        nextFeatureSeq: seq + 1,
        defaultUnit: tree.defaultUnit,
      });
    }
    this.cancelDatumAxisSidebar();
    this.save();
  }

  private _editDatumAxis(feature: import('../../../cad/lib/types').DatumAxisFeature) {
    this._resetDatumAxisInputs();
    const m = feature.method;
    switch (m.kind) {
      case 'twoPoints':
        this.datumAxisVertexA.set(m.vertexRefA);
        this.datumAxisVertexB.set(m.vertexRefB);
        break;
      case 'alongEdge':
        this.datumAxisEdge.set(m.edgeRef);
        break;
      case 'twoPlanesIntersection':
        this.datumAxisPlaneA.set(m.planeRefA);
        this.datumAxisPlaneB.set(m.planeRefB);
        break;
      case 'cylindricalFaceAxis':
        this.datumAxisCylinderFaceId.set(m.cylinderFaceId);
        this.datumAxisCylinderFallback.set(m.fallbackAxis);
        break;
      case 'pointAndPerpFace':
        this.datumAxisVertexA.set(m.vertexRef);
        this.datumAxisPlaneA.set(m.planeRef);
        break;
    }
    this.datumAxisSidebar.set({ method: m.kind, editingFeatureId: feature.id });
    this._armDatumAxisPicks();
  }

  // ── Datum Point handlers — REQ 661 ─────────────────────────────────

  onDatumPointAction(): void {
    if (this.readonly()) return;
    if (this.datumPointSidebar()) { this.cancelDatumPointSidebar(); return; }
    this._resetDatumPointInputs();
    this.datumPointSidebar.set({ method: 'onVertex' });
    this._armDatumPointPicks();
  }
  private _resetDatumPointInputs(): void {
    this.datumPointVertex.set(null);
    this.datumPointFaceId.set(null);
    this.datumPointFaceFallback.set(null);
    this.datumPointEdge.set(null);
    this.datumPointT.set(0.5);
    this.datumPointBodyId.set(null);
    this.datumPointBodyFallback.set(null);
  }
  private _armDatumPointPicks(): void {
    this.vertexPickMode.set(true);
    this.edgePickMode.set(true);
    this.facePickMode.set(true);
  }
  cancelDatumPointSidebar(): void {
    this.datumPointSidebar.set(null);
    this.vertexPickMode.set(false);
    this.edgePickMode.set(false);
    this.facePickMode.set(false);
    this._resetDatumPointInputs();
  }
  setDatumPointMethod(method: NonNullable<ReturnType<typeof this.datumPointSidebar>>['method']): void {
    const ctx = this.datumPointSidebar();
    if (!ctx) return;
    this._resetDatumPointInputs();
    this.datumPointSidebar.set({ ...ctx, method });
    this._armDatumPointPicks();
  }

  addDatumPointVertexPick(vRef: VertexRef): boolean {
    const ctx = this.datumPointSidebar();
    if (!ctx || ctx.method !== 'onVertex') return false;
    this.datumPointVertex.set(vRef);
    return true;
  }
  addDatumPointEdgePick(eRef: EdgeRef3D): boolean {
    const ctx = this.datumPointSidebar();
    if (!ctx) return false;
    if (ctx.method === 'centerOfCircularEdge' || ctx.method === 'alongEdge') {
      this.datumPointEdge.set(eRef);
      return true;
    }
    return false;
  }
  addDatumPointFacePick(faceId: string, centroid: [number, number, number], _bodyId: string | null): boolean {
    const ctx = this.datumPointSidebar();
    if (!ctx) return false;
    if (ctx.method === 'centerOfFace') {
      this.datumPointFaceId.set(faceId);
      this.datumPointFaceFallback.set(centroid);
      return true;
    }
    if (ctx.method === 'centerOfMass') {
      // Pick the owning body. body.centroid lives on the bodies
      // signal — look it up by featureId (the body's "owner" id).
      if (_bodyId) {
        const body = this.bodies().find(b => b.id === _bodyId);
        const c = (body as { centroid?: [number, number, number] } | undefined)?.centroid ?? centroid;
        this.datumPointBodyId.set(_bodyId);
        this.datumPointBodyFallback.set(c);
        return true;
      }
    }
    return false;
  }

  /** Clamp a number to [0, 1]. Used by the along-edge parametric input. */
  _clamp01(v: number): number {
    if (!Number.isFinite(v)) return 0.5;
    return Math.max(0, Math.min(1, v));
  }

  canCommitDatumPoint(): boolean {
    const ctx = this.datumPointSidebar();
    if (!ctx) return false;
    switch (ctx.method) {
      case 'onVertex': return !!this.datumPointVertex();
      case 'centerOfFace': return !!this.datumPointFaceId() && !!this.datumPointFaceFallback();
      case 'centerOfCircularEdge': return !!this.datumPointEdge();
      case 'centerOfMass': return !!this.datumPointBodyId() && !!this.datumPointBodyFallback();
      case 'alongEdge': return !!this.datumPointEdge();
    }
  }

  private _buildDatumPointFeature(id: string): import('../../../cad/lib/types').DatumPointFeature | null {
    const ctx = this.datumPointSidebar();
    if (!ctx) return null;
    const base = { id, type: 'datumPoint' as const, createdAt: Date.now() };
    switch (ctx.method) {
      case 'onVertex': {
        const v = this.datumPointVertex();
        if (!v) return null;
        return { ...base, method: { kind: 'onVertex', vertexRef: v } };
      }
      case 'centerOfFace': {
        const fid = this.datumPointFaceId(), fb = this.datumPointFaceFallback();
        if (!fid || !fb) return null;
        return { ...base, method: { kind: 'centerOfFace', faceId: fid, fallbackPosition: fb } };
      }
      case 'centerOfCircularEdge': {
        const e = this.datumPointEdge();
        if (!e) return null;
        return { ...base, method: { kind: 'centerOfCircularEdge', edgeRef: e } };
      }
      case 'centerOfMass': {
        const bid = this.datumPointBodyId(), fb = this.datumPointBodyFallback();
        if (!bid || !fb) return null;
        return { ...base, method: { kind: 'centerOfMass', bodyId: bid, fallbackPosition: fb } };
      }
      case 'alongEdge': {
        const e = this.datumPointEdge();
        if (!e) return null;
        return { ...base, method: { kind: 'alongEdge', edgeRef: e, t: this.datumPointT() } };
      }
    }
  }

  commitDatumPointSidebar(): void {
    const ctx = this.datumPointSidebar();
    if (!ctx) return;
    const tree = this.featureTree();
    const seq = tree.nextFeatureSeq;
    const id = ctx.editingFeatureId || `f${seq}`;
    const feature = this._buildDatumPointFeature(id);
    if (!feature) return;
    if (ctx.editingFeatureId) {
      this.featureTree.set(updateFeatureParam<any>(this.featureTree(), id, feature as any));
    } else {
      this.featureTree.set({
        features: [...tree.features, feature],
        nextFeatureSeq: seq + 1,
        defaultUnit: tree.defaultUnit,
      });
    }
    this.cancelDatumPointSidebar();
    this.save();
  }

  private _editDatumPoint(feature: import('../../../cad/lib/types').DatumPointFeature) {
    this._resetDatumPointInputs();
    const m = feature.method;
    switch (m.kind) {
      case 'onVertex':
        this.datumPointVertex.set(m.vertexRef);
        break;
      case 'centerOfFace':
        this.datumPointFaceId.set(m.faceId);
        this.datumPointFaceFallback.set(m.fallbackPosition);
        break;
      case 'centerOfCircularEdge':
        this.datumPointEdge.set(m.edgeRef);
        break;
      case 'centerOfMass':
        this.datumPointBodyId.set(m.bodyId);
        this.datumPointBodyFallback.set(m.fallbackPosition);
        break;
      case 'alongEdge':
        this.datumPointEdge.set(m.edgeRef);
        this.datumPointT.set(m.t);
        break;
    }
    this.datumPointSidebar.set({ method: m.kind, editingFeatureId: feature.id });
    this._armDatumPointPicks();
  }

  // ── Shell handlers — REQ 659 ───────────────────────────────────────

  // ── Combine handlers — REQ 662 ─────────────────────────────────────

  onCombineAction(): void {
    if (this.readonly()) return;
    if (this.combineSidebar()) { this.cancelCombineSidebar(); return; }
    this.combineOperation.set('add');
    this.combineTargetBodyId.set(null);
    this.combineToolBodyIds.set([]);
    this.combinePickTarget.set('target');
    this.facePickMode.set(true);
    this.combineSidebar.set({});
  }
  cancelCombineSidebar(): void {
    this.combineSidebar.set(null);
    this.facePickMode.set(false);
    this.combineTargetBodyId.set(null);
    this.combineToolBodyIds.set([]);
  }
  setCombinePickTarget(t: 'target' | 'tool'): void {
    this.combinePickTarget.set(t);
    this.facePickMode.set(true);
  }
  removeCombineToolRow(rowId: string): void {
    const idx = Number(rowId.split(':')[1]);
    if (!Number.isInteger(idx)) return;
    this.combineToolBodyIds.set(this.combineToolBodyIds().filter((_, i) => i !== idx));
  }
  /** Route a face pick to the combine sidebar's target or tool slot
   * (based on which "pick" button is active). Owning body id is
   * resolved via `bodyIdForFaceId` — face.featureId can't be used
   * because it tracks the latest feature to touch the body, which
   * diverges from body.id after any in-place modification. */
  addCombineFacePick(faceId: string): boolean {
    if (!this.combineSidebar()) return false;
    const bodyId = this.bodyIdForFaceId(faceId);
    if (!bodyId) return false;
    if (this.combinePickTarget() === 'target') {
      this.combineTargetBodyId.set(bodyId);
    } else {
      // Add to tools (avoid dups; reject if same as target).
      if (bodyId === this.combineTargetBodyId()) return true;
      const cur = this.combineToolBodyIds();
      if (cur.includes(bodyId)) return true;
      this.combineToolBodyIds.set([...cur, bodyId]);
    }
    return true;
  }
  canCommitCombine(): boolean {
    if (!this.combineSidebar()) return false;
    return !!this.combineTargetBodyId() && this.combineToolBodyIds().length > 0;
  }
  commitCombineSidebar(): void {
    const ctx = this.combineSidebar();
    if (!ctx || !this.canCommitCombine()) return;
    const tree = this.featureTree();
    const seq = tree.nextFeatureSeq;
    const id = ctx.editingFeatureId || `f${seq}`;
    const feature: import('../../../cad/lib/types').CombineFeature = {
      id, type: 'combine',
      operation: this.combineOperation(),
      targetBodyId: this.combineTargetBodyId()!,
      toolBodyIds: [...this.combineToolBodyIds()],
      createdAt: Date.now(),
    };
    if (ctx.editingFeatureId) {
      this.featureTree.set(updateFeatureParam<any>(this.featureTree(), id, feature as any));
    } else {
      this.featureTree.set({
        features: [...tree.features, feature],
        nextFeatureSeq: seq + 1,
        defaultUnit: tree.defaultUnit,
      });
    }
    this.cancelCombineSidebar();
    this.save();
  }
  private _editCombine(feature: import('../../../cad/lib/types').CombineFeature) {
    this.combineOperation.set(feature.operation);
    this.combineTargetBodyId.set(feature.targetBodyId);
    this.combineToolBodyIds.set([...feature.toolBodyIds]);
    this.combinePickTarget.set('target');
    this.facePickMode.set(true);
    this.combineSidebar.set({ editingFeatureId: feature.id });
  }

  // ── Mirror Body handlers — REQ 666 ─────────────────────────────────

  onMirrorBodyAction(): void {
    if (this.readonly()) return;
    if (this.mirrorBodySidebar()) { this.cancelMirrorBodySidebar(); return; }
    this.mirrorBodyPlaneRef.set(null);
    this.mirrorBodyPlaneSnapshot.set(null);
    this.mirrorBodyBodyIds.set([]);
    this.mirrorBodyKeepOriginals.set(true);
    this.mirrorBodyPickTarget.set('plane');
    this.facePickMode.set(true);
    this.mirrorBodySidebar.set({});
  }
  cancelMirrorBodySidebar(): void {
    this.mirrorBodySidebar.set(null);
    this.facePickMode.set(false);
  }
  setMirrorBodyPickTarget(t: 'plane' | 'body'): void {
    this.mirrorBodyPickTarget.set(t);
    this.facePickMode.set(true);
  }
  setMirrorBodyPlaneFromDatum(datumId: string): void {
    if (datumId === '') {
      this.mirrorBodyPlaneRef.set(null);
      this.mirrorBodyPlaneSnapshot.set(null);
    } else {
      const ref: PlaneRef = { kind: 'datum', datumId } as PlaneRef;
      this.mirrorBodyPlaneRef.set(ref);
      this.mirrorBodyPlaneSnapshot.set(this._resolvePlaneRefSnapshot(ref));
    }
  }
  /** Routed from onFacePicked. Returns true if consumed. */
  addMirrorBodyFacePick(faceId: string, fallbackPlane: Plane3): boolean {
    if (!this.mirrorBodySidebar()) return false;
    if (this.mirrorBodyPickTarget() === 'plane') {
      const ref: PlaneRef = { kind: 'face', faceId, fallbackPlane } as PlaneRef;
      this.mirrorBodyPlaneRef.set(ref);
      this.mirrorBodyPlaneSnapshot.set(fallbackPlane);
      return true;
    }
    // Body pick: resolve owning body via perBodyGeometry membership.
    const bodyId = this.bodyIdForFaceId(faceId);
    if (!bodyId) return true;  // consumed but no-op
    const cur = this.mirrorBodyBodyIds();
    if (!cur.includes(bodyId)) this.mirrorBodyBodyIds.set([...cur, bodyId]);
    return true;
  }
  removeMirrorBodyRow(rowId: string): void {
    const idx = Number(rowId.split(':')[1]);
    if (!Number.isInteger(idx)) return;
    this.mirrorBodyBodyIds.set(this.mirrorBodyBodyIds().filter((_, i) => i !== idx));
  }
  canCommitMirrorBody(): boolean {
    if (!this.mirrorBodySidebar()) return false;
    if (!this.mirrorBodyPlaneRef() || !this.mirrorBodyPlaneSnapshot()) return false;
    if (this.mirrorBodyBodyIds().length === 0) return false;
    return true;
  }
  commitMirrorBodySidebar(): void {
    const ctx = this.mirrorBodySidebar();
    if (!ctx || !this.canCommitMirrorBody()) return;
    const tree = this.featureTree();
    const seq = tree.nextFeatureSeq;
    const id = ctx.editingFeatureId || `f${seq}`;
    const feature: import('../../../cad/lib/types').MirrorBodyFeature = {
      id, type: 'mirrorBody',
      bodyIds: [...this.mirrorBodyBodyIds()],
      planeRef: this.mirrorBodyPlaneRef()!,
      planeSnapshot: this.mirrorBodyPlaneSnapshot()!,
      keepOriginals: this.mirrorBodyKeepOriginals(),
      createdAt: Date.now(),
    };
    if (ctx.editingFeatureId) {
      this.featureTree.set(updateFeatureParam<any>(this.featureTree(), id, feature as any));
    } else {
      this.featureTree.set({
        features: [...tree.features, feature],
        nextFeatureSeq: seq + 1,
        defaultUnit: tree.defaultUnit,
      });
    }
    this.cancelMirrorBodySidebar();
    this.save();
  }
  private _editMirrorBody(feature: import('../../../cad/lib/types').MirrorBodyFeature) {
    this.mirrorBodyPlaneRef.set(feature.planeRef);
    this.mirrorBodyPlaneSnapshot.set(feature.planeSnapshot);
    this.mirrorBodyBodyIds.set([...feature.bodyIds]);
    this.mirrorBodyKeepOriginals.set(feature.keepOriginals !== false);
    this.mirrorBodyPickTarget.set('body');
    this.facePickMode.set(true);
    this.mirrorBodySidebar.set({ editingFeatureId: feature.id });
  }

  // ── Move/Copy Body handlers — REQ 667 ──────────────────────────────

  onMoveCopyBodyAction(): void {
    if (this.readonly()) return;
    if (this.moveCopyBodySidebar()) { this.cancelMoveCopyBodySidebar(); return; }
    this.moveCopyBodyIds.set([]);
    this.moveCopyTx.set(0); this.moveCopyTy.set(0); this.moveCopyTz.set(0);
    this.moveCopyRotateEnabled.set(false);
    this.moveCopyAxisId.set('z_axis');
    this.moveCopyAngleDeg.set(0);
    this.moveCopyCopy.set(true);
    this.facePickMode.set(true);
    this.moveCopyBodySidebar.set({});
  }
  cancelMoveCopyBodySidebar(): void {
    this.moveCopyBodySidebar.set(null);
    this.facePickMode.set(false);
  }
  /** Routed from onFacePicked. Returns true if consumed. */
  addMoveCopyBodyFromFace(faceId: string): boolean {
    if (!this.moveCopyBodySidebar()) return false;
    const bodyId = this.bodyIdForFaceId(faceId);
    if (!bodyId) return true;
    const cur = this.moveCopyBodyIds();
    if (!cur.includes(bodyId)) this.moveCopyBodyIds.set([...cur, bodyId]);
    return true;
  }
  removeMoveCopyBodyRow(rowId: string): void {
    const idx = Number(rowId.split(':')[1]);
    if (!Number.isInteger(idx)) return;
    this.moveCopyBodyIds.set(this.moveCopyBodyIds().filter((_, i) => i !== idx));
  }
  canCommitMoveCopyBody(): boolean {
    if (!this.moveCopyBodySidebar()) return false;
    if (this.moveCopyBodyIds().length === 0) return false;
    const hasTranslate = this.moveCopyTx() !== 0 || this.moveCopyTy() !== 0 || this.moveCopyTz() !== 0;
    const hasRotate = this.moveCopyRotateEnabled() && this.moveCopyAngleDeg() !== 0;
    return hasTranslate || hasRotate;
  }
  commitMoveCopyBodySidebar(): void {
    const ctx = this.moveCopyBodySidebar();
    if (!ctx || !this.canCommitMoveCopyBody()) return;
    const tree = this.featureTree();
    const seq = tree.nextFeatureSeq;
    const id = ctx.editingFeatureId || `f${seq}`;
    const tx = this.moveCopyTx(), ty = this.moveCopyTy(), tz = this.moveCopyTz();
    const hasTranslate = tx !== 0 || ty !== 0 || tz !== 0;
    const hasRotate = this.moveCopyRotateEnabled() && this.moveCopyAngleDeg() !== 0;
    // Origin axes have known snapshots — direction along the axis, origin at (0,0,0).
    const axisSnapshots: Record<string, { origin: [number, number, number]; direction: [number, number, number] }> = {
      x_axis: { origin: [0, 0, 0], direction: [1, 0, 0] },
      y_axis: { origin: [0, 0, 0], direction: [0, 1, 0] },
      z_axis: { origin: [0, 0, 0], direction: [0, 0, 1] },
    };
    const feature: import('../../../cad/lib/types').MoveCopyBodyFeature = {
      id, type: 'moveCopyBody',
      bodyIds: [...this.moveCopyBodyIds()],
      ...(hasTranslate ? { translate: [tx, ty, tz] as [number, number, number] } : {}),
      ...(hasRotate ? {
        rotate: {
          axisRef: { kind: 'originAxis', axisId: this.moveCopyAxisId() } as any,
          axisSnapshot: axisSnapshots[this.moveCopyAxisId()],
          angleDeg: this.moveCopyAngleDeg(),
        },
      } : {}),
      copy: this.moveCopyCopy(),
      createdAt: Date.now(),
    };
    if (ctx.editingFeatureId) {
      this.featureTree.set(updateFeatureParam<any>(this.featureTree(), id, feature as any));
    } else {
      this.featureTree.set({
        features: [...tree.features, feature],
        nextFeatureSeq: seq + 1,
        defaultUnit: tree.defaultUnit,
      });
    }
    this.cancelMoveCopyBodySidebar();
    this.save();
  }
  private _editMoveCopyBody(feature: import('../../../cad/lib/types').MoveCopyBodyFeature) {
    this.moveCopyBodyIds.set([...feature.bodyIds]);
    const t = feature.translate ?? [0, 0, 0];
    this.moveCopyTx.set(t[0]); this.moveCopyTy.set(t[1]); this.moveCopyTz.set(t[2]);
    if (feature.rotate) {
      this.moveCopyRotateEnabled.set(true);
      const ar = feature.rotate.axisRef as any;
      if (ar.kind === 'originAxis') this.moveCopyAxisId.set(ar.axisId);
      this.moveCopyAngleDeg.set(feature.rotate.angleDeg);
    } else {
      this.moveCopyRotateEnabled.set(false);
      this.moveCopyAngleDeg.set(0);
    }
    this.moveCopyCopy.set(feature.copy !== false);
    this.facePickMode.set(true);
    this.moveCopyBodySidebar.set({ editingFeatureId: feature.id });
  }

  // ── Hole Wizard handlers — REQ 663 ─────────────────────────────────

  onHoleAction(): void {
    if (this.readonly()) return;
    if (this.holeSidebar()) { this.cancelHoleSidebar(); return; }
    this.holeType.set('drill');
    this.holeStandard.set('iso');
    this.holeSize.set(holeDefaultSizeFor('iso'));
    this.holeEndKind.set('throughAll');
    this.holeDepth.set(10);
    this.holeFlipped.set(false);
    this.holePlacements.set([]);
    this.holeDrillDiaOverride.set(null);
    this.holeCboreDiaOverride.set(null);
    this.holeCboreDepthOverride.set(null);
    this.holeCskDiaOverride.set(null);
    this.holeCskAngleOverride.set(null);
    // Arm BOTH vertex- and face-pick. Vertex picker runs first
    // (cad-viewer click path) so existing body vertices snap on
    // click; face picks act as a fallback for "drop a hole at the
    // click point, axis = face normal" when no vertex is hit.
    this.vertexPickMode.set(true);
    this.facePickMode.set(true);
    this.holeSidebar.set({});
  }
  cancelHoleSidebar(): void {
    this.holeSidebar.set(null);
    this.vertexPickMode.set(false);
    this.facePickMode.set(false);
    this.holePlacements.set([]);
  }
  onHoleStandardChange(std: HoleStandard): void {
    this.holeStandard.set(std);
    // Switching standard invalidates the old size key — reset to the
    // standard's default so the dropdown never lands on a key that
    // doesn't exist in the new table. Overrides cleared too since
    // they were dialed in against the OLD spec values.
    this.holeSize.set(holeDefaultSizeFor(std));
    this.holeDrillDiaOverride.set(null);
    this.holeCboreDiaOverride.set(null);
    this.holeCboreDepthOverride.set(null);
    this.holeCskDiaOverride.set(null);
    this.holeCskAngleOverride.set(null);
  }
  /** Parse an empty-string input as "clear override" so the user can
   * blank the field to fall back to the spec value. Negative or
   * non-finite values are also treated as cleared (the spec table
   * always wins over garbage input). */
  setOverride(field: 'drillDia' | 'cboreDia' | 'cboreDepth' | 'cskDia' | 'cskAngle', raw: string): void {
    const trimmed = (raw ?? '').trim();
    const v = trimmed === '' ? null : Number(trimmed);
    const next = v !== null && Number.isFinite(v) && v > 0 ? v : null;
    switch (field) {
      case 'drillDia':   this.holeDrillDiaOverride.set(next); break;
      case 'cboreDia':   this.holeCboreDiaOverride.set(next); break;
      case 'cboreDepth': this.holeCboreDepthOverride.set(next); break;
      case 'cskDia':     this.holeCskDiaOverride.set(next); break;
      case 'cskAngle':   this.holeCskAngleOverride.set(next); break;
    }
  }
  /** Add a placement when a face is clicked while the Hole sidebar
   * is open. Returns true if consumed. */
  addHoleFacePick(evt: { faceId: string; point: [number, number, number]; normal: [number, number, number] }): boolean {
    if (!this.holeSidebar()) return false;
    const face = this.geometry()?.faces.find(f => f.faceId === evt.faceId);
    let centroid: [number, number, number] = evt.point;
    if (face) {
      let sx = 0, sy = 0, sz = 0, n = 0;
      const pos = face.positions as Float32Array | number[];
      for (let i = 0; i + 2 < pos.length; i += 3) { sx += pos[i]; sy += pos[i + 1]; sz += pos[i + 2]; n++; }
      if (n > 0) centroid = [sx / n, sy / n, sz / n];
    }
    this.holePlacements.set([...this.holePlacements(), {
      faceId: evt.faceId,
      position: evt.point,
      faceCentroid: centroid,
      faceNormal: evt.normal,
    }]);
    return true;
  }
  removeHolePlacementRow(rowId: string): void {
    const idx = Number(rowId.split(':')[1]);
    if (!Number.isInteger(idx)) return;
    this.holePlacements.set(this.holePlacements().filter((_, i) => i !== idx));
  }
  canCommitHole(): boolean {
    if (!this.holeSidebar()) return false;
    if (this.holePlacements().length === 0) return false;
    if (this.holeEndKind() === 'blind' && !(this.holeDepth() > 0)) return false;
    try { holeSpec(this.holeStandard(), this.holeSize()); } catch { return false; }
    return true;
  }
  commitHoleSidebar(): void {
    const ctx = this.holeSidebar();
    if (!ctx || !this.canCommitHole()) return;
    const tree = this.featureTree();
    const seq = tree.nextFeatureSeq;
    const id = ctx.editingFeatureId || `f${seq}`;
    const feature: import('../../../cad/lib/types').HoleFeature = {
      id, type: 'hole',
      placements: [...this.holePlacements()],
      holeType: this.holeType(),
      standard: this.holeStandard(),
      size: this.holeSize(),
      endCondition: this.holeEndKind() === 'throughAll'
        ? { kind: 'throughAll' }
        : { kind: 'blind', depth: this.holeDepth() },
      ...(this.holeFlipped() ? { flipped: true } : {}),
      ...(this.holeDrillDiaOverride() !== null ? { drillDiameterOverride: this.holeDrillDiaOverride()! } : {}),
      ...(this.holeCboreDiaOverride() !== null ? { counterboreDiameterOverride: this.holeCboreDiaOverride()! } : {}),
      ...(this.holeCboreDepthOverride() !== null ? { counterboreDepthOverride: this.holeCboreDepthOverride()! } : {}),
      ...(this.holeCskDiaOverride() !== null ? { countersinkDiameterOverride: this.holeCskDiaOverride()! } : {}),
      ...(this.holeCskAngleOverride() !== null ? { countersinkAngleOverride: this.holeCskAngleOverride()! } : {}),
      createdAt: Date.now(),
    };
    if (ctx.editingFeatureId) {
      this.featureTree.set(updateFeatureParam<any>(this.featureTree(), id, feature as any));
    } else {
      this.featureTree.set({
        features: [...tree.features, feature],
        nextFeatureSeq: seq + 1,
        defaultUnit: tree.defaultUnit,
      });
    }
    this.cancelHoleSidebar();
    this.save();
  }
  private _editHole(feature: import('../../../cad/lib/types').HoleFeature) {
    this.holeType.set(feature.holeType);
    this.holeStandard.set(feature.standard);
    this.holeSize.set(feature.size);
    this.holeEndKind.set(feature.endCondition.kind);
    this.holeDepth.set(feature.endCondition.kind === 'blind' ? feature.endCondition.depth : 10);
    this.holeFlipped.set(feature.flipped === true);
    this.holePlacements.set([...feature.placements]);
    this.holeDrillDiaOverride.set(feature.drillDiameterOverride ?? null);
    this.holeCboreDiaOverride.set(feature.counterboreDiameterOverride ?? null);
    this.holeCboreDepthOverride.set(feature.counterboreDepthOverride ?? null);
    this.holeCskDiaOverride.set(feature.countersinkDiameterOverride ?? null);
    this.holeCskAngleOverride.set(feature.countersinkAngleOverride ?? null);
    this.vertexPickMode.set(true);
    this.facePickMode.set(true);
    this.holeSidebar.set({ editingFeatureId: feature.id });
  }
  /** Add a placement at an existing vertex. The face under the
   * cursor (if any) supplies the hole axis; if the vertex was
   * picked without a co-located face hit we have no axis and the
   * pick is rejected with a notification. */
  addHoleVertexPick(evt: { vertexId: string; position: [number, number, number]; faceNormal?: [number, number, number] }): boolean {
    if (!this.holeSidebar()) return false;
    if (!evt.faceNormal) {
      this.errors.showError('Hole: could not determine the hole axis at this vertex. Hover over a face and try again.');
      return false;
    }
    this.holePlacements.set([...this.holePlacements(), {
      faceId: `vertex:${evt.vertexId}`,
      position: evt.position,
      faceCentroid: evt.position,
      faceNormal: evt.faceNormal,
    }]);
    return true;
  }
  /** Routed from cad-viewer's `facePickedAt` output. Currently the
   * only consumer is the Hole sidebar; other sidebars (datum, shell,
   * combine) keep using the legacy `facePicked` (id-only) signal. */
  onFacePickedAt(evt: { faceId: string; point: [number, number, number]; normal: [number, number, number] }): void {
    if (this.holeSidebar()) {
      this.addHoleFacePick(evt);
    }
  }
  /** Routed from cad-viewer's `vertexPickedAt` output. Hole sidebar
   * uses this so clicking an existing body vertex snaps the hole
   * placement to that vertex's exact coordinates. */
  onVertexPickedAt(evt: { vertexId: string; position: [number, number, number]; faceNormal?: [number, number, number] }): void {
    if (this.holeSidebar()) {
      this.addHoleVertexPick(evt);
    }
  }

  onShellAction(): void {
    if (this.readonly()) return;
    if (this.shellSidebar()) {
      this.cancelShellSidebar();
      return;
    }
    this._resetShellInputs();
    this.facePickMode.set(true);
    this.shellSidebar.set({});
  }

  private _resetShellInputs(): void {
    this.shellFaces.set([]);
    this.shellThickness.set(2);
    this.shellThicknessExpression.set(null);
    this.shellDirection.set('inward');
  }

  cancelShellSidebar(): void {
    this.shellSidebar.set(null);
    this.facePickMode.set(false);
    this._resetShellInputs();
  }

  /** Route a face pick to the shell sidebar's face list. Captures a
   * fallbackPlane snapshot (centroid + outward normal) so the kernel
   * can match by geometry even after upstream regens renumber faces.
   * Returns true when the pick was consumed. Subsequent clicks on the
   * same face TOGGLE — picking an already-picked face removes it. */
  addShellFacePick(faceId: string, fallbackPlane: Plane3): boolean {
    if (!this.shellSidebar()) return false;
    const cur = this.shellFaces();
    const existingIdx = cur.findIndex(f => f.faceId === faceId);
    if (existingIdx >= 0) {
      this.shellFaces.set(cur.filter((_, i) => i !== existingIdx));
      return true;
    }
    this.shellFaces.set([...cur, {
      faceId,
      fallbackPlane: { origin: fallbackPlane.origin, normal: fallbackPlane.normal },
    }]);
    return true;
  }

  removeShellFace(rowId: string): void {
    // rowId format: `face:<index>`
    const idx = Number(rowId.split(':')[1]);
    if (!Number.isInteger(idx)) return;
    this.shellFaces.set(this.shellFaces().filter((_, i) => i !== idx));
  }

  canCommitShell(): boolean {
    if (!this.shellSidebar()) return false;
    if (this.shellFaces().length === 0) return false;
    const t = this.shellThickness();
    if (!Number.isFinite(t) || t <= 0) return false;
    return true;
  }

  commitShellSidebar(): void {
    const ctx = this.shellSidebar();
    if (!ctx || !this.canCommitShell()) return;
    const tree = this.featureTree();
    const seq = tree.nextFeatureSeq;
    const id = ctx.editingFeatureId || `f${seq}`;
    const feature: import('../../../cad/lib/types').ShellFeature = {
      id,
      type: 'shell',
      faces: this.shellFaces().map(f => ({
        faceId: f.faceId,
        fallbackPlane: {
          origin: [f.fallbackPlane.origin[0], f.fallbackPlane.origin[1], f.fallbackPlane.origin[2]],
          normal: [f.fallbackPlane.normal[0], f.fallbackPlane.normal[1], f.fallbackPlane.normal[2]],
        },
        ...(typeof f.thickness === 'number' ? { thickness: f.thickness } : {}),
      })),
      thickness: this.shellThickness(),
      direction: this.shellDirection(),
      createdAt: Date.now(),
    };
    if (ctx.editingFeatureId) {
      this.featureTree.set(updateFeatureParam<any>(this.featureTree(), id, feature as any));
    } else {
      this.featureTree.set({
        features: [...tree.features, feature],
        nextFeatureSeq: seq + 1,
        defaultUnit: tree.defaultUnit,
      });
    }
    // Persist the thickness expression. Same equations-doc path as
    // other features so the Σ badge + global variables apply.
    let next = this.equations();
    const expr = this.shellThicknessExpression();
    next = expr === null
      ? removeEquation(next, `feature.${id}.thickness`)
      : setEquation(next, `feature.${id}.thickness`, expr);
    this.equations.set(next);
    this.cancelShellSidebar();
    this.save();
  }

  /** Re-open the Shell sidebar populated with an existing feature's
   * state. Rollback bar will move to before the shell (via the pattern
   * exclusion path in editRollbackTarget — extended below). */
  private _editShell(feature: import('../../../cad/lib/types').ShellFeature) {
    this._resetShellInputs();
    this.shellFaces.set(feature.faces.map(f => ({ ...f })));
    this.shellThickness.set(feature.thickness);
    this.shellThicknessExpression.set(this.featureEquation(`feature.${feature.id}.thickness`));
    this.shellDirection.set(feature.direction);
    this.facePickMode.set(true);
    this.shellSidebar.set({ editingFeatureId: feature.id });
  }

  // ── Pattern handlers — REQ 658 ─────────────────────────────────────

  onMirrorAction(): void { this._openPatternSidebar('mirror'); }
  onLinearPatternAction(): void { this._openPatternSidebar('linearPattern'); }
  onCircularPatternAction(): void { this._openPatternSidebar('circularPattern'); }

  private _openPatternSidebar(
    kind: 'mirror' | 'linearPattern' | 'circularPattern',
    editingFeatureId?: string,
  ): void {
    if (this.readonly()) return;
    const cur = this.patternSidebar();
    if (cur && cur.kind === kind && !editingFeatureId) {
      this.cancelPatternSidebar();
      return;
    }
    this._resetPatternInputs();
    if (kind === 'mirror') {
      // Mirror needs a plane pick — enable face picking. Datum picks
      // route through the dropdown.
      this.facePickMode.set(true);
    }
    this.patternSidebar.set({ kind, editingFeatureId });
  }

  private _resetPatternInputs(): void {
    this.patternPlaneRef.set(null);
    this.patternPlaneDatumOption.set('');
    this.patternDir1AxisId.set('x_axis');
    this.patternDir1Spacing.set(10);
    this.patternDir1SpacingExpression.set(null);
    this.patternDir1Count.set(3);
    this.patternDir1CountExpression.set(null);
    this.patternDir1Flipped.set(false);
    this.patternDir2Enabled.set(false);
    this.patternDir2AxisId.set('y_axis');
    this.patternDir2Spacing.set(10);
    this.patternDir2SpacingExpression.set(null);
    this.patternDir2Count.set(2);
    this.patternDir2CountExpression.set(null);
    this.patternDir2Flipped.set(false);
    this.patternCircAxisId.set('z_axis');
    this.patternCircCount.set(4);
    this.patternCircCountExpression.set(null);
    this.patternCircMode.set('equalSpacing');
    this.patternCircAngleDeg.set(360);
    this.patternCircAngleExpression.set(null);
    this.patternCircFlipped.set(false);
  }

  cancelPatternSidebar(): void {
    this.patternSidebar.set(null);
    this.facePickMode.set(false);
    this._resetPatternInputs();
  }

  /** Set the mirror plane from the origin-plane dropdown. Empty string
   * means "use face pick instead" — clears any datum pick. */
  setPatternPlaneFromDatum(datumId: string): void {
    this.patternPlaneDatumOption.set(datumId);
    if (datumId === '') {
      this.patternPlaneRef.set(null);
    } else {
      this.patternPlaneRef.set({ kind: 'datum', datumId });
    }
  }

  /** Route a face pick to the active pattern sidebar's plane slot.
   * Called from the editor's onFacePicked dispatch. Returns true when
   * the pick was consumed. */
  addPatternFacePick(faceId: string, fallbackPlane: Plane3): boolean {
    const ctx = this.patternSidebar();
    if (!ctx || ctx.kind !== 'mirror') return false;
    this.patternPlaneRef.set({ kind: 'face', faceId, fallbackPlane });
    this.patternPlaneDatumOption.set('');  // clear the datum dropdown to avoid stale display
    return true;
  }

  canCommitPattern(): boolean {
    const ctx = this.patternSidebar();
    if (!ctx) return false;
    if (ctx.kind === 'mirror') {
      const ref = this.patternPlaneRef();
      if (!ref) return false;
      const snap = this._resolvePlaneRefSnapshot(ref);
      return snap !== null;
    }
    if (ctx.kind === 'linearPattern') {
      const c1 = this.patternDir1Count();
      if (!Number.isInteger(c1) || c1 < 1) return false;
      if (c1 >= 2 && (!Number.isFinite(this.patternDir1Spacing()) || this.patternDir1Spacing() === 0)) return false;
      if (this.patternDir2Enabled()) {
        const c2 = this.patternDir2Count();
        if (!Number.isInteger(c2) || c2 < 1) return false;
        if (c2 >= 2 && (!Number.isFinite(this.patternDir2Spacing()) || this.patternDir2Spacing() === 0)) return false;
      }
      return true;
    }
    if (ctx.kind === 'circularPattern') {
      const c = this.patternCircCount();
      if (!Number.isInteger(c) || c < 2) return false;
      if (!Number.isFinite(this.patternCircAngleDeg())) return false;
      return true;
    }
    return false;
  }

  /** Resolve a PlaneRef to its Plane3 snapshot using current geometry.
   * Returns null when the ref can't be resolved (face ID stale and no
   * fallback). For datum refs, falls back to the origin planes. */
  private _resolvePlaneRefSnapshot(ref: PlaneRef): Plane3 | null {
    const geom = this.geometry() ?? { datums: [], faces: [], topology: { vertices: [], edges: [] } };
    return resolvePlaneRef(ref, geom);
  }

  /** Snapshot for an origin axis. Phase 1 supports only the three
   * origin axes; edge-derived axes follow later. */
  private _originAxisSnapshot(axisId: 'x_axis' | 'y_axis' | 'z_axis'): { origin: [number, number, number]; direction: [number, number, number] } {
    const dir: [number, number, number] = axisId === 'x_axis' ? [1, 0, 0]
      : axisId === 'y_axis' ? [0, 1, 0]
      : [0, 0, 1];
    return { origin: [0, 0, 0], direction: dir };
  }

  commitPatternSidebar(): void {
    const ctx = this.patternSidebar();
    if (!ctx || !this.canCommitPattern()) return;
    const tree = this.featureTree();
    const seq = tree.nextFeatureSeq;
    const id = ctx.editingFeatureId || `f${seq}`;
    let feature: import('../../../cad/lib/types').Feature | null = null;

    if (ctx.kind === 'mirror') {
      const ref = this.patternPlaneRef()!;
      const snap = this._resolvePlaneRefSnapshot(ref)!;
      const mirror: import('../../../cad/lib/types').MirrorFeatureFeature = {
        id,
        type: 'mirror',
        planeRef: ref,
        planeSnapshot: snap,
        createdAt: Date.now(),
      };
      feature = mirror;
    } else if (ctx.kind === 'linearPattern') {
      const d1AxisId = this.patternDir1AxisId();
      const direction1: import('../../../cad/lib/types').LinearPatternDirection = {
        axisRef: { kind: 'originAxis', axisId: d1AxisId },
        axisSnapshot: this._originAxisSnapshot(d1AxisId),
        spacing: this.patternDir1Spacing(),
        count: this.patternDir1Count(),
        flipped: this.patternDir1Flipped(),
      };
      let direction2: import('../../../cad/lib/types').LinearPatternDirection | undefined;
      if (this.patternDir2Enabled()) {
        const d2AxisId = this.patternDir2AxisId();
        direction2 = {
          axisRef: { kind: 'originAxis', axisId: d2AxisId },
          axisSnapshot: this._originAxisSnapshot(d2AxisId),
          spacing: this.patternDir2Spacing(),
          count: this.patternDir2Count(),
          flipped: this.patternDir2Flipped(),
        };
      }
      const lin: import('../../../cad/lib/types').LinearPatternFeature = {
        id,
        type: 'linearPattern',
        direction1,
        direction2,
        createdAt: Date.now(),
      };
      feature = lin;
    } else if (ctx.kind === 'circularPattern') {
      const axisId = this.patternCircAxisId();
      const circ: import('../../../cad/lib/types').CircularPatternFeature = {
        id,
        type: 'circularPattern',
        axisRef: { kind: 'originAxis', axisId },
        axisSnapshot: this._originAxisSnapshot(axisId),
        count: this.patternCircCount(),
        mode: this.patternCircMode(),
        angleDeg: this.patternCircAngleDeg(),
        flipped: this.patternCircFlipped(),
        createdAt: Date.now(),
      };
      feature = circ;
    }
    if (!feature) return;

    if (ctx.editingFeatureId) {
      this.featureTree.set(updateFeatureParam<any>(this.featureTree(), id, feature as any));
    } else {
      this.featureTree.set({
        features: [...tree.features, feature],
        nextFeatureSeq: seq + 1,
        defaultUnit: tree.defaultUnit,
      });
    }
    this._writePatternEquations(id);
    this.cancelPatternSidebar();
    this.save();
  }

  /** Persist the in-flight pattern-sidebar expressions into the
   * equations doc. Linear has up to four expressions (dir1 spacing /
   * count + dir2 spacing / count); circular has two (angle + count).
   * Mirror has none. Removes entries for inputs the user cleared so
   * stale expressions don't linger when toggling dir 2 off / on. */
  private _writePatternEquations(featureId: string): void {
    let next = this.equations();
    const ctx = this.patternSidebar();
    const kind = ctx?.kind ?? null;
    const writeOrClear = (key: string, expr: string | null) => {
      next = expr === null ? removeEquation(next, key) : setEquation(next, key, expr);
    };
    if (kind === 'linearPattern') {
      writeOrClear(`feature.${featureId}.direction1.spacing`, this.patternDir1SpacingExpression());
      writeOrClear(`feature.${featureId}.direction1.count`, this.patternDir1CountExpression());
      if (this.patternDir2Enabled()) {
        writeOrClear(`feature.${featureId}.direction2.spacing`, this.patternDir2SpacingExpression());
        writeOrClear(`feature.${featureId}.direction2.count`, this.patternDir2CountExpression());
      } else {
        // Dir2 was disabled — strip any leftover dir2 equations from a
        // prior edit so they don't sit orphaned in the doc.
        next = removeEquation(next, `feature.${featureId}.direction2.spacing`);
        next = removeEquation(next, `feature.${featureId}.direction2.count`);
      }
    } else if (kind === 'circularPattern') {
      writeOrClear(`feature.${featureId}.angle`, this.patternCircAngleExpression());
      writeOrClear(`feature.${featureId}.count`, this.patternCircCountExpression());
    }
    this.equations.set(next);
  }

  /** Open the Measure sidebar (or close it if already open). Auto-
   * enters vertex + edge + face pick modes so the user's next click in
   * the viewer adds to the measurement set. Closing clears the picks. */
  onMeasureAction(): void {
    if (this.measureSidebar()) {
      this.closeMeasureSidebar();
      return;
    }
    this.measureItems.set([]);
    this.vertexPickMode.set(true);
    this.edgePickMode.set(true);
    this.facePickMode.set(true);
    this.measureSidebar.set(true);
  }

  closeMeasureSidebar(): void {
    this.measureSidebar.set(false);
    this.vertexPickMode.set(false);
    this.edgePickMode.set(false);
    this.facePickMode.set(false);
    this.measureItems.set([]);
  }

  /** Add a picked entity to the measurement set, or toggle-deselect if
   * the same entity is clicked again. */
  addMeasureItem(item: MeasureItem): void {
    const cur = this.measureItems();
    const sameKey = (a: MeasureItem, b: MeasureItem) => a.kind === b.kind && a.id === b.id;
    if (cur.some(c => sameKey(c, item))) {
      this.measureItems.set(cur.filter(c => !sameKey(c, item)));
      return;
    }
    this.measureItems.set([...cur, item]);
  }

  removeMeasureItem(rowId: string): void {
    // rowId is the item's `kind:id` composite (see measureSelectionRows).
    const [kind, ...rest] = rowId.split(':');
    const id = rest.join(':');
    this.measureItems.set(this.measureItems().filter(i => !(i.kind === kind && i.id === id)));
  }

  /** Picked face ids from any active picker (Measure or Fillet/
   * Chamfer / Shell). Drives the viewer's sticky `pickedFaceIds`
   * highlight so the user sees every face already in the selection
   * set without having to hover it.  */
  pickedFaceIdsForViewer = computed<Set<string>>(() => {
    const out = new Set<string>();
    if (this.measureSidebar()) {
      for (const it of this.measureItems()) {
        if (it.kind === 'face') out.add(it.id);
      }
    }
    if (this.edgeBlendSidebar()) {
      // Face-expanded edges carry the face id on each row; one face
      // → many edges in the underlying list but a single id in the
      // highlight set.
      for (const e of this.edgeBlendEdges()) {
        if (e.faceId) out.add(e.faceId);
      }
    }
    if (this.shellSidebar()) {
      for (const f of this.shellFaces()) out.add(f.faceId);
    }
    return out;
  });

  /** Live preview for the Shell sidebar (REQ 659). Returns the set of
   * face IDs the user has picked so far so the viewer can paint them
   * in a distinct "removed" overlay color — visually communicates
   * "these faces will be cut away" before commit. Null clears the
   * overlay. */
  shellPreview = computed<{ faceIds: string[]; thickness: number; direction: 'inward' | 'outward' } | null>(() => {
    if (!this.shellSidebar()) return null;
    const faces = this.shellFaces();
    if (faces.length === 0) return null;
    return {
      faceIds: faces.map(f => f.faceId),
      thickness: this.shellThickness(),
      direction: this.shellDirection(),
    };
  });

  /** Picked edge ids — Measure picks AND Fillet/Chamfer picks. */
  pickedEdgeIdsForViewer = computed<Set<string>>(() => {
    const out = new Set<string>();
    if (this.measureSidebar()) {
      for (const it of this.measureItems()) {
        if (it.kind === 'edge') out.add(it.id);
      }
    }
    if (this.edgeBlendSidebar()) {
      for (const e of this.edgeBlendEdges()) {
        // Face-expanded edges already show as the highlighted face; we
        // skip individually highlighting them so the user sees the
        // face-blue tint rather than N edge overlays on top of it.
        if (!e.faceId) out.add(e.edgeId);
      }
    }
    return out;
  });

  /** Picked vertex ids — Measure only (other sidebars don't pick
   * vertices). */
  pickedVertexIdsForViewer = computed<Set<string>>(() => {
    const out = new Set<string>();
    if (this.measureSidebar()) {
      for (const it of this.measureItems()) {
        if (it.kind === 'vertex') out.add(it.id);
      }
    }
    return out;
  });

  /** SelectionRow projection of measureItems for `<cad-selection-list>`. */
  measureSelectionRows = computed<SelectionRow[]>(() => {
    return this.measureItems().map((i, idx) => {
      if (i.kind === 'vertex') return { id: `vertex:${i.id}`, label: `Vertex ${idx + 1}`, icon: 'place' };
      if (i.kind === 'edge') return { id: `edge:${i.id}`, label: `Edge ${idx + 1}`, icon: 'timeline' };
      return { id: `face:${i.id}`, label: `Face ${idx + 1}`, icon: 'crop_square' };
    });
  });

  /** Build a `MeasureItem` for a picked face: derive surface area
   * (sum of triangle areas from the mesh indices), centroid (mean of
   * mesh vertex positions), and outward normal for flat faces (from
   * the first triangle's vertex normals). */
  private _measureItemFromFace(faceId: string, face: { positions: Float32Array; normals: Float32Array; indices: Uint32Array; isFlat?: boolean }): MeasureItem {
    const positions = face.positions;
    const normals = face.normals;
    const indices = face.indices;
    const isFlat = face.isFlat === true;
    // Centroid: mean of all mesh vertices.
    let cx = 0, cy = 0, cz = 0, n = 0;
    for (let i = 0; i + 2 < positions.length; i += 3) {
      cx += positions[i];
      cy += positions[i + 1];
      cz += positions[i + 2];
      n++;
    }
    const centroid: [number, number, number] | undefined = n > 0
      ? [cx / n, cy / n, cz / n]
      : undefined;
    // Surface area: sum of triangle areas = 0.5 * |edge1 × edge2|.
    let area = 0;
    for (let t = 0; t + 2 < indices.length; t += 3) {
      const i0 = indices[t] * 3, i1 = indices[t + 1] * 3, i2 = indices[t + 2] * 3;
      const ax = positions[i1] - positions[i0];
      const ay = positions[i1 + 1] - positions[i0 + 1];
      const az = positions[i1 + 2] - positions[i0 + 2];
      const bx = positions[i2] - positions[i0];
      const by = positions[i2 + 1] - positions[i0 + 1];
      const bz = positions[i2 + 2] - positions[i0 + 2];
      const cxn = ay * bz - az * by;
      const cyn = az * bx - ax * bz;
      const czn = ax * by - ay * bx;
      area += 0.5 * Math.hypot(cxn, cyn, czn);
    }
    // Outward normal: for flat faces, every vertex normal points the
    // same direction, so reading the first is fine. For curved faces
    // we leave it undefined so the compute knows not to emit plane
    // calculations.
    let normal: [number, number, number] | undefined;
    if (isFlat && normals.length >= 3) {
      normal = [normals[0], normals[1], normals[2]];
    }
    return {
      kind: 'face',
      id: faceId,
      isFlat,
      ...(typeof area === 'number' && isFinite(area) ? { area } : {}),
      ...(centroid ? { centroid } : {}),
      ...(normal ? { normal } : {}),
    };
  }

  private _openEdgeBlendSidebar(kind: 'fillet' | 'chamfer', editingFeatureId?: string): void {
    if (this.readonly()) return;
    if (!this.hasAdditiveBody()) {
      this.errors.showError(`${kind === 'fillet' ? 'Fillet' : 'Chamfer'} needs an existing body to operate on. Add an Extrude / Revolve / Sweep first.`);
      return;
    }
    this.edgeBlendValue.set(kind === 'fillet' ? 2 : 1);
    this.edgeBlendValueExpression.set(null);
    this.edgeBlendEdges.set([]);
    this.edgeBlendChamferMode.set('equal');
    this.edgeBlendDistance2.set(1);
    this.edgeBlendDistance2Expression.set(null);
    this.edgeBlendAngle.set(45);
    this.edgeBlendAngleExpression.set(null);
    // Auto-enter edge-pick mode so the user can start clicking edges
    // immediately without first hitting "Pick edges from viewer". When
    // editing an existing feature we keep pick mode off — the edges
    // are already populated and the user typically just wants to tweak
    // the value.
    this.edgePickMode.set(editingFeatureId === undefined);
    this.edgeBlendSidebar.set({ kind, editingFeatureId });
  }

  /** Toggle edge-pick mode. When on, edge clicks in the viewer route
   * through onEdgePicked → addEdgeBlendEdge instead of the default
   * debug-pick path. */
  beginEdgeBlendPick(): void {
    this.edgePickMode.set(!this.edgePickMode());
  }

  /** Add (or remove) a picked edge to/from the current blend's edge list.
   * - Click an unpicked edge → add it (and, with tangent propagation,
   *   its tangent-continuous neighbors).
   * - Click an already-picked edge → remove it (SolidWorks-style
   *   toggle deselection). When tangent propagation is on, the whole
   *   propagated chain that touches the clicked edge gets removed
   *   together, matching the way it was added. */
  addEdgeBlendEdge(rec: { edgeId: string; endpoints: [[number, number, number], [number, number, number]] }): void {
    const start = rec.endpoints[0];
    const end = rec.endpoints[1];
    const seed = { edgeId: rec.edgeId, start, end };
    const expanded = this.edgeBlendTangentPropagation()
      ? this._propagateTangentEdges(seed)
      : [seed];
    const cur = this.edgeBlendEdges();
    const sameSpan = (
      a: { start: [number, number, number]; end: [number, number, number] },
      b: { start: [number, number, number]; end: [number, number, number] },
    ) => {
      const d2 = (p: [number, number, number], q: [number, number, number]) =>
        (p[0]-q[0])*(p[0]-q[0]) + (p[1]-q[1])*(p[1]-q[1]) + (p[2]-q[2])*(p[2]-q[2]);
      const direct = d2(a.start, b.start) + d2(a.end, b.end);
      const swap   = d2(a.start, b.end)   + d2(a.end, b.start);
      return Math.min(direct, swap) < 1e-4;
    };
    // If the SEED edge is already in the list, treat the click as a
    // deselection of the whole propagated set that touches it.
    const seedAlreadyPicked = cur.some(c => sameSpan(c, seed));
    if (seedAlreadyPicked) {
      const next = cur.filter(c => !expanded.some(e => sameSpan(c, e)));
      this.edgeBlendEdges.set(next);
      return;
    }
    const toAdd = expanded.filter(e => !cur.some(c => sameSpan(c, e)));
    if (toAdd.length === 0) return;
    // When tangent propagation expanded one click into multiple edges,
    // tag every one with the seed's id so the sidebar shows them as a
    // single "Edge N" row. Single-edge picks (or solo seeds with no
    // tangent neighbors) stay ungrouped so they render one row each.
    const tagged = toAdd.length > 1
      ? toAdd.map(e => ({ ...e, edgeGroupId: seed.edgeId }))
      : toAdd;
    this.edgeBlendEdges.set([...cur, ...tagged]);
  }

  removeEdgeBlendEdge(i: number): void {
    const cur = this.edgeBlendEdges();
    this.edgeBlendEdges.set(cur.filter((_, idx) => idx !== i));
  }

  /** Remove every edge tagged with this faceId — used by the sidebar
   * "Face N" row's remove button. Reverses `addEdgeBlendFace`. */
  removeEdgeBlendFace(faceId: string): void {
    const cur = this.edgeBlendEdges();
    this.edgeBlendEdges.set(cur.filter(c => c.faceId !== faceId));
  }

  /** Remove every edge tagged with this edgeGroupId — used by the
   * sidebar "Edge N" row's remove button when tangent propagation
   * created a multi-edge group. Drops the seed + every tangent-
   * continuous neighbor that was added with it. */
  removeEdgeBlendEdgeGroup(edgeGroupId: string): void {
    const cur = this.edgeBlendEdges();
    this.edgeBlendEdges.set(cur.filter(c => c.edgeGroupId !== edgeGroupId));
  }

  /** SolidWorks-style face-to-edges expansion: when the user clicks a
   * face while the Fillet / Chamfer sidebar is open, add every boundary
   * edge of that face. Tangent propagation does NOT run on top of this
   * (face boundary already covers everything we want); de-dups against
   * the existing edge set so re-clicking a face re-adds anything that
   * had been individually removed since. */
  addEdgeBlendFace(faceId: string): void {
    const geom = this.geometry();
    const face = geom?.faces.find(f => f.faceId === faceId);
    if (!face) return;
    const boundaryIds = face.boundaryEdgeIds || [];
    if (boundaryIds.length === 0) {
      this.errors.showError(
        'No boundary edges on this face. If you just upgraded the kernel, regenerate the model (toggle a feature\'s visibility and back) to refresh the cache, then try again. Click individual edges as a workaround.',
      );
      return;
    }
    const edgeById = new Map(geom!.topology.edges.map(e => [e.id, e]));
    const cur = this.edgeBlendEdges();
    const sameSpan = (
      a: { start: [number, number, number]; end: [number, number, number] },
      b: { start: [number, number, number]; end: [number, number, number] },
    ) => {
      const d2 = (p: [number, number, number], q: [number, number, number]) =>
        (p[0]-q[0])*(p[0]-q[0]) + (p[1]-q[1])*(p[1]-q[1]) + (p[2]-q[2])*(p[2]-q[2]);
      const direct = d2(a.start, b.start) + d2(a.end, b.end);
      const swap   = d2(a.start, b.end)   + d2(a.end, b.start);
      return Math.min(direct, swap) < 1e-4;
    };
    // If this exact face was already picked, treat the click as a
    // deselection — remove every item tagged with this faceId. Matches
    // the toggle-on-reclick behaviour the edge picker has.
    if (cur.some(c => c.faceId === faceId)) {
      this.edgeBlendEdges.set(cur.filter(c => c.faceId !== faceId));
      return;
    }
    const toAdd: Array<{ edgeId: string; start: [number, number, number]; end: [number, number, number]; faceId: string }> = [];
    const missing: string[] = [];
    for (const id of boundaryIds) {
      const e = edgeById.get(id);
      if (!e) { missing.push(id); continue; }
      const span = { edgeId: id, start: e.endpoints[0], end: e.endpoints[1], faceId };
      if (cur.some(c => sameSpan(c, span))) continue;
      if (toAdd.some(c => sameSpan(c, span))) continue;
      toAdd.push(span);
    }
    // Diagnostic: log every edge added via face expansion so the user can
    // verify they're the right ones. Trim coords to 3 decimals to keep
    // the console readable.
    const fmt = (p: [number, number, number]) =>
      `(${p[0].toFixed(3)}, ${p[1].toFixed(3)}, ${p[2].toFixed(3)})`;
    // eslint-disable-next-line no-console
    console.log(
      '[edge-blend] face→edges expansion',
      JSON.stringify({
        faceId,
        boundaryCount: boundaryIds.length,
        missingFromTopology: missing,
        added: toAdd.map(e => ({ edgeId: e.edgeId, start: fmt(e.start), end: fmt(e.end) })),
      }, null, 2),
    );
    if (toAdd.length === 0) return;
    this.edgeBlendEdges.set([...cur, ...toAdd]);
  }

  /** Delegates to the pure `propagateTangentEdges` helper. Pass through
   * to keep the editor template / handlers free of topology imports. */
  private _propagateTangentEdges(
    seed: { edgeId: string; start: [number, number, number]; end: [number, number, number] },
  ): Array<{ edgeId: string; start: [number, number, number]; end: [number, number, number] }> {
    const topo = this.geometry()?.topology;
    if (!topo) return [seed];
    return propagateTangentEdges(seed, topo);
  }

  canCommitEdgeBlend(): boolean {
    const ctx = this.edgeBlendSidebar();
    if (!ctx) return false;
    if (this.edgeBlendEdges().length === 0) return false;
    const v = this.edgeBlendValue();
    if (!(isFinite(v) && v > 0)) return false;
    if (ctx.kind === 'chamfer') {
      const mode = this.edgeBlendChamferMode();
      if (mode === 'twoDistance') {
        const d2 = this.edgeBlendDistance2();
        if (!(isFinite(d2) && d2 > 0)) return false;
      } else if (mode === 'distanceAngle') {
        const ang = this.edgeBlendAngle();
        // Strict (0, 90) range: 0 or 90 collapses the chamfer face
        // (rolling-ball degenerate cases the kernel will reject anyway).
        if (!(isFinite(ang) && ang > 0 && ang < 90)) return false;
      }
    }
    return true;
  }

  onEdgeBlendSidebarEnter(): void {
    queueMicrotask(() => { if (this.canCommitEdgeBlend()) this.commitEdgeBlendSidebar(); });
  }

  commitEdgeBlendSidebar(): void {
    const ctx = this.edgeBlendSidebar();
    if (!ctx || !this.canCommitEdgeBlend()) return;
    // Picked edges all share the feature-level value (radius for fillet,
    // distance for chamfer). The per-edge override on EdgeRef3D remains
    // in the data model for backwards-compat with stored payloads but
    // isn't exposed in the UI. `faceId` is persisted so re-opening for
    // edit restores the "Face N" row grouping in the sidebar.
    const edges = this.edgeBlendEdges().map(e => ({
      start: e.start,
      end: e.end,
      ...(e.faceId ? { faceId: e.faceId } : {}),
      ...(e.edgeGroupId ? { edgeGroupId: e.edgeGroupId } : {}),
    }));
    const value = this.edgeBlendValue();
    // Chamfer-only extras: pack mode + secondary fields. Skipped on
    // fillet (single radius is the whole story).
    const chamferExtras: { mode?: ChamferFeature['mode']; distance2?: number; angle?: number } = {};
    if (ctx.kind === 'chamfer') {
      const mode = this.edgeBlendChamferMode();
      chamferExtras.mode = mode;
      if (mode === 'twoDistance') chamferExtras.distance2 = this.edgeBlendDistance2();
      else if (mode === 'distanceAngle') chamferExtras.angle = this.edgeBlendAngle();
    }
    this.edgeBlendSidebar.set(null);
    this.edgePickMode.set(false);
    if (ctx.editingFeatureId) {
      const patch: any = ctx.kind === 'fillet'
        ? { edges, radius: value }
        : { edges, distance: value, ...chamferExtras };
      this.featureTree.set(updateFeatureParam<any>(
        this.featureTree(), ctx.editingFeatureId, patch,
      ));
      this.save();
    } else {
      const tree = this.featureTree();
      const seq = tree.nextFeatureSeq;
      const id = `f${seq}`;
      const feature: any = ctx.kind === 'fillet'
        ? { id, type: 'fillet', edges, radius: value, name: `Fillet ${this._countFeaturesByType('fillet') + 1}`, createdAt: Date.now() }
        : { id, type: 'chamfer', edges, distance: value, ...chamferExtras, name: `Chamfer ${this._countFeaturesByType('chamfer') + 1}`, createdAt: Date.now() };
      this.featureTree.set({
        features: [...tree.features, feature],
        nextFeatureSeq: seq + 1,
        defaultUnit: tree.defaultUnit,
      });
      this.save();
    }
  }

  cancelEdgeBlendSidebar(): void {
    this.edgeBlendSidebar.set(null);
    this.edgePickMode.set(false);
    this.edgeBlendEdges.set([]);
  }

  private _countFeaturesByType(type: string): number {
    return this.featureTree().features.filter(f => f.type === type).length;
  }

  /** Cut-extrude shortcut. Same flow as Extrude but the resulting
   * feature is a CutExtrudeFeature. Errors early if there's no body
   * to cut FROM (no prior additive features — extrude OR revolve). */
  onCutExtrudeRequested() {
    const sid = this.activeSketchId();
    if (!sid) return;
    if (!this.hasAdditiveBody()) {
      this.errors.showError('Cut Extrude needs an existing body to cut from. Add an Extrude or Revolve first.');
      return;
    }
    this.activeSketchId.set(null);
    this.openExtrudeDialog(sid, 'cutExtrude');
  }

  /** Features ribbon "Cut" action. Same shortcut pattern as
   * onExtrudeAction / onRevolveAction: jump straight into the sidebar
   * when exactly one sketch is selected in the tree, otherwise enter
   * pick-cut-extrude-target mode so the user can pick a sketch from
   * the tree or viewer. */
  onCutExtrudeAction() {
    if (this.readonly()) return;
    if (!this.hasAdditiveBody()) {
      this.errors.showError('Cut Extrude needs an existing body to cut from. Add an Extrude or Revolve first.');
      return;
    }
    const selected = this.selectedSketches();
    if (selected.size === 1) {
      const sid = [...selected][0];
      this.openExtrudeDialog(sid, 'cutExtrude');
      return;
    }
    this.setMode('pick-cut-extrude-target');
  }

  private openExtrudeDialog(sketchId: string, mode: 'extrude' | 'cutExtrude' = 'extrude') {
    const sketch = this.doc().sketches[sketchId];
    if (!sketch) {
      this.errors.showError(`Sketch ${sketchId} not found`);
      this.setMode('idle');
      return;
    }
    const { regions, errors } = extractRegions(sketch.state);
    if (regions.length === 0) {
      this.errors.showError(friendlyError(errors[0] || 'no closed loops in sketch'));
      this.setMode('idle');
      return;
    }
    // Open the Extrude sidebar (replaces the old MatDialog). Reset inputs
    // to defaults; the OK button reads them back on commit.
    this.extrudeDistance.set(10);
    this.extrudeDistanceExpression.set(null);
    this.extrudeDir2DistanceExpression.set(null);
    this.extrudeStartOffsetExpression.set(null);
    this.extrudeFlipped.set(false);
    this.extrudeMerge.set(true);
    this.extrudeEndKind.set('blind');
    this.extrudeUpToVertexId.set(null);
    this.extrudeUpToFaceId.set(null);
    this.extrudeUpToFaceFallback.set(null);
    this.vertexPickMode.set(false);
    this.facePickMode.set(false);
    // Text sketches: auto-select every top-level (letter) region so a whole
    // word extrudes in one click, each letter's counter kept as a hole. The
    // box sides are construction (see addTextBoxByCorners) so only glyph
    // loops form regions — extruding yields raised letters. Non-text sketches
    // keep the historical single-profile default (region 0).
    const hasText = sketch.state.entities.some(e => e.kind === 'text');
    const defaultRegions = hasText ? topLevelRegionIndices(sketch.state, this.textResolver()) : [0];
    this.extrudeSelectedRegions.set(new Set(defaultRegions));
    this.extrudeHoveredRegion.set(null);
    this.extrudeStartKind.set('sketchPlane');
    this.extrudeStartOffset.set(0);
    this.extrudeStartOffsetFlipped.set(false);
    this.extrudeStartUpToVertexId.set(null);
    this.extrudeStartUpToFaceId.set(null);
    this.extrudeStartUpToFaceFallback.set(null);
    this.extrudeOffsetFromFaceDistance.set(10);
    this.extrudeOffsetFromFaceFlipped.set(false);
    this.extrudeOffsetFromFaceExpression.set(null);
    this.extrudeStartOffsetFromFaceDistance.set(0);
    this.extrudeStartOffsetFromFaceFlipped.set(false);
    this.extrudeStartOffsetFromFaceExpression.set(null);
    this.extrudePickTarget.set('end');
    this.extrudeDir2Enabled.set(false);
    this.extrudeDir2Distance.set(10);
    this.extrudeDir2EndKind.set('blind');
    this.extrudeDir2UpToVertexId.set(null);
    this.extrudeDir2UpToFaceId.set(null);
    this.extrudeDir2UpToFaceFallback.set(null);
    this.extrudeDir2OffsetFromFaceDistance.set(10);
    this.extrudeDir2OffsetFromFaceFlipped.set(false);
    this.extrudeDir2OffsetFromFaceExpression.set(null);
    this.extrudeSidebar.set({ sketchId, regionCount: regions.length, mode });
  }

  /** End-condition dropdown handler. Switching kinds resets the
   * target-picking state so an old vertex pick doesn't carry across
   * (and so the disabled-OK button logic re-evaluates).
   *
   * Accepts the synthetic 'throughAllBoth' value (Cut-only preset that
   * sets direction 1 = Through All AND direction 2 enabled + Through
   * All in one click — a "punch the body in both directions" shortcut). */
  setExtrudeEndKind(kind: ExtrudeEndCondition['kind'] | 'throughAllBoth'): void {
    if (kind === 'throughAllBoth') {
      this.extrudeEndKind.set('throughAll');
      this.extrudeFlipped.set(false);
      this.extrudeDir2Enabled.set(true);
      this.extrudeDir2EndKind.set('throughAll');
      this.extrudeUpToVertexId.set(null);
      this.extrudeUpToFaceId.set(null);
      this.extrudeUpToFaceFallback.set(null);
      this.vertexPickMode.set(false);
      this.facePickMode.set(false);
      return;
    }
    this.extrudeEndKind.set(kind);
    if (kind !== 'upToVertex') this.extrudeUpToVertexId.set(null);
    // upToSurface and offsetFromSurface share the same face picker — only
    // clear the picked face when switching to a non-face kind.
    const facePickerKind = kind === 'upToSurface' || kind === 'offsetFromSurface';
    if (!facePickerKind) { this.extrudeUpToFaceId.set(null); this.extrudeUpToFaceFallback.set(null); }
    if (kind !== 'upToVertex') this.vertexPickMode.set(false);
    if (!facePickerKind) this.facePickMode.set(false);
  }

  /** Mirror of setExtrudeEndKind for the start side. Clears the face pick
   * only when the new kind no longer uses the face picker. */
  setExtrudeStartKind(kind: 'sketchPlane' | 'offset' | 'upToVertex' | 'upToSurface' | 'offsetFromSurface'): void {
    this.extrudeStartKind.set(kind);
    if (kind !== 'upToVertex') this.extrudeStartUpToVertexId.set(null);
    const facePickerKind = kind === 'upToSurface' || kind === 'offsetFromSurface';
    if (!facePickerKind) { this.extrudeStartUpToFaceId.set(null); this.extrudeStartUpToFaceFallback.set(null); }
    if (kind !== 'upToVertex') this.vertexPickMode.set(false);
    if (!facePickerKind) this.facePickMode.set(false);
  }

  /** Magnitude setter for the end-side "Offset from face" distance — the
   * flip toggle owns the sign, so clamp typed negatives up to zero. */
  setOffsetFromFaceMagnitude(v: number): void {
    this.extrudeOffsetFromFaceDistance.set(isFinite(v) ? Math.abs(v) : 0);
  }
  /** Same, but for the start-side offset distance. */
  setStartOffsetFromFaceMagnitude(v: number): void {
    this.extrudeStartOffsetFromFaceDistance.set(isFinite(v) ? Math.abs(v) : 0);
  }

  /** Enter-key handlers for each feature sidebar. queueMicrotask defers
   * the canCommit check until after any in-flight input value-commits
   * (e.g. the dim-input flushing its typed text on Enter) so the
   * just-typed value participates in the validity check. */
  onExtrudeSidebarEnter(): void {
    queueMicrotask(() => { if (this.canCommitExtrude()) this.commitExtrudeSidebar(); });
  }
  onRevolveSidebarEnter(): void {
    queueMicrotask(() => { if (this.canCommitRevolve()) this.commitRevolveSidebar(); });
  }
  onSweepSidebarEnter(): void {
    queueMicrotask(() => { if (this.canCommitSweep()) this.commitSweepSidebar(); });
  }

  /** What value the End-condition dropdown should DISPLAY. When the
   * three signals match the 'throughAllBoth' preset (dir1 = throughAll,
   * dir2 enabled, dir2 = throughAll), the dropdown sticks on that
   * synthetic option; otherwise it shows the actual direction-1 kind.
   * Lets the user pick the preset and have it round-trip cleanly until
   * they edit one of the underlying values. */
  extrudeEndKindDisplay = computed<string>(() => {
    if (
      this.extrudeEndKind() === 'throughAll' &&
      this.extrudeDir2Enabled() &&
      this.extrudeDir2EndKind() === 'throughAll'
    ) {
      return 'throughAllBoth';
    }
    return this.extrudeEndKind();
  });

  /** Build the ExtrudeEndCondition from the sidebar's current state. */
  private resolveEndCondition(): ExtrudeEndCondition | null {
    const kind = this.extrudeEndKind();
    switch (kind) {
      case 'blind':       return { kind: 'blind' };
      case 'midPlane':    return { kind: 'midPlane' };
      case 'throughAll':  return { kind: 'throughAll' };
      case 'upToVertex': {
        const vid = this.extrudeUpToVertexId();
        if (!vid) return null;  // OK button is disabled until a vertex is picked
        return { kind: 'upToVertex', vertexId: vid };
      }
      case 'upToSurface': {
        const fid = this.extrudeUpToFaceId();
        if (!fid) return null;
        const fallback = this.extrudeUpToFaceFallback();
        return fallback
          ? { kind: 'upToSurface', faceId: fid, fallbackPlane: fallback }
          : { kind: 'upToSurface', faceId: fid };
      }
      case 'offsetFromSurface': {
        const fid = this.extrudeUpToFaceId();
        if (!fid) return null;
        const fallback = this.extrudeUpToFaceFallback();
        const mag = Math.abs(this.extrudeOffsetFromFaceDistance());
        const sign = this.extrudeOffsetFromFaceFlipped() ? -1 : 1;
        const offset = sign * mag;
        return fallback
          ? { kind: 'offsetFromSurface', faceId: fid, offset, fallbackPlane: fallback }
          : { kind: 'offsetFromSurface', faceId: fid, offset };
      }
      // upToBody is still disabled in the dropdown until Pass 4.
      default: return null;
    }
  }

  /** Frontend mirror of cadRegenService._resolveStartOffset — projects
   * the start condition's target onto the sketch normal so the live
   * preview can show the right offset for Up-To-Vertex / Up-To-Surface
   * starts. Returns undefined to let the preview fall through to the
   * startCondition's own distance (offset / sketchPlane). */
  private resolveStartOffsetForPreview(
    sc: import('../../../cad/lib/types').ExtrudeStartCondition,
    plane: { origin: [number, number, number]; normal: [number, number, number] },
  ): number | undefined {
    if (sc.kind === 'upToVertex') {
      const g = this.geometry();
      const v = g?.topology?.vertices.find(x => x.id === sc.vertexId);
      if (!v) return undefined;
      return (v.position[0] - plane.origin[0]) * plane.normal[0]
           + (v.position[1] - plane.origin[1]) * plane.normal[1]
           + (v.position[2] - plane.origin[2]) * plane.normal[2];
    }
    if (sc.kind === 'upToSurface') {
      // Prefer the live geometry; fall back to the captured plane if
      // the persistent faceId has been re-tagged by a boolean merge.
      const fb = sc.fallbackPlane;
      const g = this.geometry();
      let centroid: [number, number, number] | null = null;
      if (g) {
        const f = g.faces.find(face => face.faceId === sc.faceId);
        if (f && f.positions.length >= 3) {
          const n = f.positions.length / 3;
          let cx = 0, cy = 0, cz = 0;
          for (let i = 0; i < n; i++) {
            cx += f.positions[i * 3];
            cy += f.positions[i * 3 + 1];
            cz += f.positions[i * 3 + 2];
          }
          centroid = [cx / n, cy / n, cz / n];
        }
      }
      if (!centroid && fb) centroid = fb.origin;
      if (!centroid) return undefined;
      return (centroid[0] - plane.origin[0]) * plane.normal[0]
           + (centroid[1] - plane.origin[1]) * plane.normal[1]
           + (centroid[2] - plane.origin[2]) * plane.normal[2];
    }
    return undefined;  // sketchPlane / offset use the startCondition's own value
  }

  /** Setter for the start-offset magnitude that clamps negative typed
   * values up to zero — the flip toggle owns the sign instead. */
  setStartOffsetMagnitude(v: number): void {
    this.extrudeStartOffset.set(isFinite(v) ? Math.abs(v) : 0);
  }

  /** Build the ExtrudeStartCondition from the sidebar's current state.
   * The flip toggle gets baked into the sign of `distance` so the
   * persisted feature stays single-field. Returns null when the user
   * picked an Up-To target but hasn't actually picked anything yet —
   * commit is gated until they do. */
  private resolveStartCondition(): import('../../../cad/lib/types').ExtrudeStartCondition | null {
    const kind = this.extrudeStartKind();
    if (kind === 'offset') {
      const magnitude = Math.abs(this.extrudeStartOffset());
      const sign = this.extrudeStartOffsetFlipped() ? -1 : 1;
      return { kind: 'offset', distance: sign * magnitude };
    }
    if (kind === 'upToVertex') {
      const vid = this.extrudeStartUpToVertexId();
      if (!vid) return null;
      return { kind: 'upToVertex', vertexId: vid };
    }
    if (kind === 'upToSurface') {
      const fid = this.extrudeStartUpToFaceId();
      if (!fid) return null;
      const fallback = this.extrudeStartUpToFaceFallback();
      return fallback
        ? { kind: 'upToSurface', faceId: fid, fallbackPlane: fallback }
        : { kind: 'upToSurface', faceId: fid };
    }
    if (kind === 'offsetFromSurface') {
      const fid = this.extrudeStartUpToFaceId();
      if (!fid) return null;
      const fallback = this.extrudeStartUpToFaceFallback();
      const mag = Math.abs(this.extrudeStartOffsetFromFaceDistance());
      const sign = this.extrudeStartOffsetFromFaceFlipped() ? -1 : 1;
      const offset = sign * mag;
      return fallback
        ? { kind: 'offsetFromSurface', faceId: fid, offset, fallbackPlane: fallback }
        : { kind: 'offsetFromSurface', faceId: fid, offset };
    }
    return { kind: 'sketchPlane' };
  }

  /** Build the Direction 2 ExtrudeEndCondition from the sidebar state.
   * Mirrors `resolveEndCondition` for direction 1, minus midPlane which
   * doesn't make sense in a 2nd direction (the whole feature would be
   * symmetric and the dir-2 toggle wouldn't be exposed). */
  private resolveDir2EndCondition(): ExtrudeEndCondition | null {
    const kind = this.extrudeDir2EndKind();
    switch (kind) {
      case 'blind':       return { kind: 'blind' };
      case 'throughAll':  return { kind: 'throughAll' };
      case 'upToVertex': {
        const vid = this.extrudeDir2UpToVertexId();
        if (!vid) return null;
        return { kind: 'upToVertex', vertexId: vid };
      }
      case 'upToSurface': {
        const fid = this.extrudeDir2UpToFaceId();
        if (!fid) return null;
        const fallback = this.extrudeDir2UpToFaceFallback();
        return fallback
          ? { kind: 'upToSurface', faceId: fid, fallbackPlane: fallback }
          : { kind: 'upToSurface', faceId: fid };
      }
      case 'offsetFromSurface': {
        const fid = this.extrudeDir2UpToFaceId();
        if (!fid) return null;
        const fallback = this.extrudeDir2UpToFaceFallback();
        const mag = Math.abs(this.extrudeDir2OffsetFromFaceDistance());
        const sign = this.extrudeDir2OffsetFromFaceFlipped() ? -1 : 1;
        const offset = sign * mag;
        return fallback
          ? { kind: 'offsetFromSurface', faceId: fid, offset, fallbackPlane: fallback }
          : { kind: 'offsetFromSurface', faceId: fid, offset };
      }
      default: return { kind: 'blind' };
    }
  }

  /** Disabled-state for the OK button. Distance-based kinds need a
   * positive distance; Up to Vertex/Surface need a pick; Through All
   * needs neither. */
  canCommitExtrude(): boolean {
    if (this.extrudeSelectedRegions().size === 0) return false;
    const kind = this.extrudeEndKind();
    let endOk: boolean;
    if (kind === 'blind' || kind === 'midPlane') {
      endOk = isFinite(this.extrudeDistance()) && this.extrudeDistance() > 0;
    } else if (kind === 'upToVertex') endOk = this.extrudeUpToVertexId() !== null;
    else if (kind === 'upToSurface') endOk = this.extrudeUpToFaceId() !== null;
    else if (kind === 'offsetFromSurface') {
      endOk = this.extrudeUpToFaceId() !== null
           && isFinite(this.extrudeOffsetFromFaceDistance());
    }
    else if (kind === 'throughAll') endOk = true;
    else endOk = false;
    if (!endOk) return false;
    // Start-condition gating: upToVertex / upToSurface / offsetFromSurface
    // each require a pick before commit.
    const sk = this.extrudeStartKind();
    if (sk === 'upToVertex' && !this.extrudeStartUpToVertexId()) return false;
    if (sk === 'upToSurface' && !this.extrudeStartUpToFaceId()) return false;
    if (sk === 'offsetFromSurface') {
      if (!this.extrudeStartUpToFaceId()) return false;
      if (!isFinite(this.extrudeStartOffsetFromFaceDistance())) return false;
    }
    // Direction-2 gating: when dir 2 is enabled (and dir 1 isn't
    // midPlane, which would already disable the toggle), validate the
    // dir-2 pick / distance the same way dir 1 is validated.
    if (this.extrudeDir2Enabled() && kind !== 'midPlane') {
      const d2 = this.extrudeDir2EndKind();
      if (d2 === 'blind') {
        if (!isFinite(this.extrudeDir2Distance()) || this.extrudeDir2Distance() <= 0) return false;
      } else if (d2 === 'upToVertex') {
        if (!this.extrudeDir2UpToVertexId()) return false;
      } else if (d2 === 'upToSurface') {
        if (!this.extrudeDir2UpToFaceId()) return false;
      } else if (d2 === 'offsetFromSurface') {
        if (!this.extrudeDir2UpToFaceId()) return false;
        if (!isFinite(this.extrudeDir2OffsetFromFaceDistance())) return false;
      }
    }
    return true;
  }

  /** Enter vertex-pick mode. The viewer renders a sphere at each
   * topology vertex and restricts click hit-testing to those spheres.
   * On click, onVertexPicked stores the id and exits the mode. Pressing
   * Esc or clicking Cancel exits without a pick.
   *
   * `target` says which signal the click result feeds — direction 1's
   * end condition (default) or the start condition. */
  beginVertexPick(target: 'start' | 'end' | 'end2' = 'end'): void {
    this.facePickMode.set(false);  // mutually exclusive with face pick
    this.extrudePickTarget.set(target);
    this.vertexPickMode.set(true);
  }

  /** Called by the viewer when the user clicks a vertex marker. Routes
   * to start / direction-1 / direction-2 signal based on extrudePickTarget. */
  onVertexPicked(vertexId: string): void {
    // Datum Plane sidebar gets first crack — its methods consume
    // vertex picks for three-points / parallel-through-point / etc.
    if (this.datumPlaneSidebar()) {
      const v = this.geometry()?.topology.vertices.find(vx => vx.id === vertexId);
      const pos: [number, number, number] = v ? (v.position as [number, number, number]) : [0, 0, 0];
      if (this.addDatumPlaneVertexPick({ vertexId, fallbackPosition: pos })) return;
    }
    // REQ 660/661 — datum axis + datum point vertex routing.
    if (this.datumAxisSidebar()) {
      const v = this.geometry()?.topology.vertices.find(vx => vx.id === vertexId);
      const pos: [number, number, number] = v ? (v.position as [number, number, number]) : [0, 0, 0];
      if (this.addDatumAxisVertexPick({ vertexId, fallbackPosition: pos })) return;
    }
    if (this.datumPointSidebar()) {
      const v = this.geometry()?.topology.vertices.find(vx => vx.id === vertexId);
      const pos: [number, number, number] = v ? (v.position as [number, number, number]) : [0, 0, 0];
      if (this.addDatumPointVertexPick({ vertexId, fallbackPosition: pos })) return;
    }
    // Measure sidebar: add the vertex to the measurement set and stay
    // in pick mode for chained picks. Looks up world position from the
    // active geometry's topology so the measure compute has 3D coords.
    if (this.measureSidebar()) {
      const v = this.geometry()?.topology.vertices.find(vx => vx.id === vertexId);
      if (v) this.addMeasureItem({ kind: 'vertex', id: vertexId, position: v.position });
      return;
    }
    const t = this.extrudePickTarget();
    if (t === 'start') this.extrudeStartUpToVertexId.set(vertexId);
    else if (t === 'end2') this.extrudeDir2UpToVertexId.set(vertexId);
    else this.extrudeUpToVertexId.set(vertexId);
    this.vertexPickMode.set(false);
  }

  /** Enter face-pick mode — same exclusive pattern as vertex picking. */
  beginFacePick(target: 'start' | 'end' | 'end2' = 'end'): void {
    this.vertexPickMode.set(false);
    this.extrudePickTarget.set(target);
    this.facePickMode.set(true);
  }

  onFacePicked(faceId: string): void {
    // Convert Entities: project every boundary edge of the picked face
    // into the active sketch. Tool stays armed so the user can chain
    // face/edge clicks.
    const sid = this.activeSketchId();
    if (sid && this.sketchEditorRef()?.tool() === 'convert-entities') {
      this.projectFaceBoundaryToActiveSketch(sid, faceId);
      return;
    }
    // Datum Plane sidebar: route face picks into the active method's
    // open slot. Captures a fallbackPlane snapshot so the feature
    // survives upstream regen-time face renumbering.
    if (this.datumPlaneSidebar()) {
      const fb = this.faceFallbackPlane(faceId);
      if (fb) {
        const plane: Plane3 = {
          origin: fb.origin,
          normal: fb.normal,
          xAxis: [1, 0, 0],
          yAxis: [0, 1, 0],
        };
        if (this.addDatumPlaneFacePick(faceId, plane)) return;
      }
    }
    // REQ 660 — datum axis face routing (plane intersection / cyl
    // face / point + perp face). Same fallback-plane snapshot path.
    if (this.datumAxisSidebar()) {
      const fb = this.faceFallbackPlane(faceId);
      if (fb) {
        const plane: Plane3 = { origin: fb.origin, normal: fb.normal, xAxis: [1, 0, 0], yAxis: [0, 1, 0] };
        if (this.addDatumAxisFacePick(faceId, plane)) return;
      }
    }
    // REQ 661 — datum point face routing (center of face, center of mass).
    if (this.datumPointSidebar()) {
      const face = this.geometry()?.faces.find(f => f.faceId === faceId);
      let centroid: [number, number, number] = [0, 0, 0];
      if (face) {
        let sx = 0, sy = 0, sz = 0, n = 0;
        const pos = face.positions as Float32Array | number[];
        for (let i = 0; i + 2 < pos.length; i += 3) {
          sx += pos[i]; sy += pos[i + 1]; sz += pos[i + 2]; n++;
        }
        if (n > 0) centroid = [sx / n, sy / n, sz / n];
      }
      const bodyId = face?.featureId ?? null;
      if (this.addDatumPointFacePick(faceId, centroid, bodyId)) return;
    }
    // Pattern sidebar (Mirror only): route face picks to the mirror
    // plane slot. Snapshot captured for the same renumber-survival
    // reason as the datum-plane case above.
    if (this.patternSidebar()?.kind === 'mirror') {
      const fb = this.faceFallbackPlane(faceId);
      if (fb) {
        const plane: Plane3 = {
          origin: fb.origin,
          normal: fb.normal,
          xAxis: [1, 0, 0],
          yAxis: [0, 1, 0],
        };
        if (this.addPatternFacePick(faceId, plane)) return;
      }
    }
    // REQ 662 — Combine: route the face pick to the active body slot
    // (target or tool). Owning body id is on the face record.
    if (this.combineSidebar()) {
      if (this.addCombineFacePick(faceId)) return;
    }
    // REQ 666 — Mirror Body: route to mirror plane OR body slot.
    if (this.mirrorBodySidebar()) {
      const fb = this.faceFallbackPlane(faceId);
      const plane: Plane3 = fb
        ? { origin: fb.origin, normal: fb.normal, xAxis: [1, 0, 0], yAxis: [0, 1, 0] }
        : { origin: [0, 0, 0], normal: [0, 0, 1], xAxis: [1, 0, 0], yAxis: [0, 1, 0] };
      if (this.addMirrorBodyFacePick(faceId, plane)) return;
    }
    // REQ 667 — Move/Copy Body: face-click picks owning body.
    if (this.moveCopyBodySidebar()) {
      if (this.addMoveCopyBodyFromFace(faceId)) return;
    }
    // Shell sidebar: collect picked faces with their centroid + normal
    // snapshot. Picking the same face again toggles it off so the user
    // can correct a misclick without opening the selection list.
    if (this.shellSidebar()) {
      const fb = this.faceFallbackPlane(faceId);
      if (fb) {
        const plane: Plane3 = {
          origin: fb.origin,
          normal: fb.normal,
          xAxis: [1, 0, 0],
          yAxis: [0, 1, 0],
        };
        if (this.addShellFacePick(faceId, plane)) return;
      }
    }
    // Fillet / Chamfer sidebar: expand the face to its boundary edges
    // (SolidWorks-style). Stays in pick mode so the user can chain.
    if (this.edgeBlendSidebar() && this.edgePickMode()) {
      this.addEdgeBlendFace(faceId);
      return;
    }
    // Measure sidebar: derive area / centroid / normal from the face's
    // mesh and add it as a MeasureItem so the compute can produce
    // face-area, face-to-face angle/distance, face-to-vertex/edge
    // perpendicular distance, etc.
    if (this.measureSidebar()) {
      const face = this.geometry()?.faces.find(f => f.faceId === faceId);
      if (face) {
        this.addMeasureItem(this._measureItemFromFace(faceId, face));
      } else {
        this.addMeasureItem({ kind: 'face', id: faceId, isFlat: false });
      }
      return;
    }
    const target = this.extrudePickTarget();
    const fallback = this.faceFallbackPlane(faceId);
    if (target === 'start') {
      this.extrudeStartUpToFaceId.set(faceId);
      this.extrudeStartUpToFaceFallback.set(fallback);
    } else if (target === 'end2') {
      this.extrudeDir2UpToFaceId.set(faceId);
      this.extrudeDir2UpToFaceFallback.set(fallback);
    } else {
      this.extrudeUpToFaceId.set(faceId);
      this.extrudeUpToFaceFallback.set(fallback);
    }
    this.facePickMode.set(false);
  }

  /** Dropdown handler for Direction 2's end-condition kind. Mirrors
   * setExtrudeEndKind's logic: clears the face/vertex pick state when
   * switching to a non-pick kind so the OK button re-evaluates. */
  setExtrudeDir2EndKind(kind: ExtrudeEndCondition['kind']): void {
    this.extrudeDir2EndKind.set(kind);
    if (kind !== 'upToVertex') this.extrudeDir2UpToVertexId.set(null);
    const facePickerKind = kind === 'upToSurface' || kind === 'offsetFromSurface';
    if (!facePickerKind) {
      this.extrudeDir2UpToFaceId.set(null);
      this.extrudeDir2UpToFaceFallback.set(null);
    }
    // Bail out of any in-flight pick session that targets dir 2 if we
    // switched to a kind that no longer wants it.
    if (this.extrudePickTarget() === 'end2') {
      if (kind !== 'upToVertex') this.vertexPickMode.set(false);
      if (!facePickerKind) this.facePickMode.set(false);
    }
  }

  /** Magnitude setter for Direction 2's "Offset from face" distance. */
  setDir2OffsetFromFaceMagnitude(v: number): void {
    this.extrudeDir2OffsetFromFaceDistance.set(isFinite(v) ? Math.abs(v) : 0);
  }

  /** Project every boundary edge of the given face into the active
   * sketch. Walks the face mesh's vertices for the unique set of edge
   * ids that share at least one face-mesh triangle's vertex with this
   * face, then runs each through the same projection logic that the
   * single-edge convert handler uses.
   *
   * Note: this doesn't truly walk the face's BRep boundary — that's a
   * kernel-side operation we haven't surfaced to the frontend yet.
   * Instead it finds every topology edge whose endpoints sit on this
   * face's mesh plane (the standard "edges of this face" approximation
   * that works for the common case of planar faces). For curved faces
   * the result may include extra/missing edges; users can fall back to
   * picking edges individually. */
  private projectFaceBoundaryToActiveSketch(sid: SketchId, faceId: string): void {
    const sketch = this.doc().sketches[sid];
    const geom = this.geometry();
    if (!sketch || !geom) return;
    const face = geom.faces.find(f => f.faceId === faceId);
    if (!face) {
      this.errors.showError('Convert Entities: face not found in current geometry.');
      return;
    }
    // Collect 3D positions of every vertex in the face mesh and build a
    // spatial lookup. Each topology edge whose BOTH endpoints land on
    // this face's vertex cloud counts as a boundary edge.
    const facePoints: Array<[number, number, number]> = [];
    for (let i = 0; i + 2 < face.positions.length; i += 3) {
      facePoints.push([face.positions[i], face.positions[i + 1], face.positions[i + 2]]);
    }
    const TOL = 1e-3;
    const isOnFace = (p: [number, number, number]) =>
      facePoints.some(fp =>
        Math.abs(fp[0] - p[0]) < TOL &&
        Math.abs(fp[1] - p[1]) < TOL &&
        Math.abs(fp[2] - p[2]) < TOL,
      );
    const boundary: typeof geom.topology.edges = [];
    // The kernel's TopExp_Explorer yields each BRep edge once per
    // owning face, so manifold-solid edges appear twice in
    // geom.topology.edges with different scope ids but identical
    // geometry. Dedupe by quantized geometric key (rounded start +
    // mid + end) so we project each boundary edge exactly once.
    const seen = new Set<string>();
    const keyOf = (e: typeof geom.topology.edges[number]) => {
      const q = (v: number) => Math.round(v * 1e4);
      const a = e.endpoints[0] as [number, number, number];
      const b = e.endpoints[1] as [number, number, number];
      // Mid sample disambiguates two edges that share endpoints (e.g.
      // semicircle + chord between the same vertices).
      const mid = (e.polyline && e.polyline.length > 2)
        ? (e.polyline[Math.floor(e.polyline.length / 2)] as [number, number, number])
        : a;
      // Endpoint order invariant — sort so reverse traversals match.
      const lo: [number, number, number] = a <= b ? a : b;
      const hi: [number, number, number] = a <= b ? b : a;
      return `${q(lo[0])},${q(lo[1])},${q(lo[2])}|${q(mid[0])},${q(mid[1])},${q(mid[2])}|${q(hi[0])},${q(hi[1])},${q(hi[2])}`;
    };
    for (const edge of geom.topology.edges) {
      // Match by 3D endpoints — straight edges have just the two
      // endpoints; curves rely on the polyline samples landing on the
      // face mesh, so we test both endpoints AND check a midpoint
      // sample lies on the face for confidence.
      const a = edge.endpoints[0] as [number, number, number];
      const b = edge.endpoints[1] as [number, number, number];
      let onFace = isOnFace(a) && isOnFace(b);
      if (onFace && edge.polyline && edge.polyline.length > 2) {
        const mid = edge.polyline[Math.floor(edge.polyline.length / 2)] as [number, number, number];
        onFace = isOnFace(mid);
      }
      if (!onFace) continue;
      const k = keyOf(edge);
      if (seen.has(k)) continue;
      seen.add(k);
      boundary.push(edge);
    }
    if (boundary.length === 0) {
      this.errors.showError('Convert Entities: no edges found on this face.');
      return;
    }
    let nextState = sketch.state;
    let added = 0;
    for (const edge of boundary) {
      const result = this._projectOneEdgeIntoState(nextState, sketch.plane, edge);
      if (result) {
        nextState = result;
        added++;
      }
    }
    if (added > 0) {
      this.doc.set(updateSketchState(this.doc(), sid, nextState));
      this.save();
    } else {
      this.errors.showError('Convert Entities: none of this face\'s edges could be projected (all perpendicular to the sketch plane?).');
    }
  }

  /** Single-edge projection that mutates a SketchState and returns the
   * new state (or null on degenerate / unsupported). Pulled out of
   * projectEdgeToActiveSketch so face-boundary projection can chain
   * many edges into one commit. */
  private _projectOneEdgeIntoState(
    state: SketchState,
    plane: { origin: [number, number, number]; xAxis: [number, number, number]; yAxis: [number, number, number]; normal: [number, number, number] },
    edge: ModelTopology['edges'][number],
  ): SketchState | null {
    if (edge.isStraight) {
      const p1 = projectFrom3D(plane, edge.endpoints[0] as [number, number, number]);
      const p2 = projectFrom3D(plane, edge.endpoints[1] as [number, number, number]);
      if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 1e-6) return null;
      let next = state;
      const a = addPoint(next, p1.x, p1.y); next = a.state;
      const b = addPoint(next, p2.x, p2.y); next = b.state;
      const ln = addLine(next, a.id, b.id); next = ln.state;
      return this._tagProjected(next, ln.id, edge.id);
    }
    if (!edge.polyline) return null;
    const poly = edge.polyline as Array<[number, number, number]>;
    const circleProj = this._circleFromPolyline(poly, plane);
    if (circleProj) {
      const r = addCircle(state, circleProj.cx, circleProj.cy, circleProj.radius);
      return this._tagProjected(r.state, r.id, edge.id);
    }
    const arcProj = this._arcFromPolyline(poly, plane);
    if (arcProj) {
      const r = addArc(state, arcProj.cx, arcProj.cy, arcProj.startX, arcProj.startY, arcProj.endX, arcProj.endY, arcProj.ccw);
      return this._tagProjected(r.state, r.id, edge.id);
    }
    return null;
  }

  /** Companion signal for `extrudeUpToFaceId`: centroid + outward normal
   * of the picked face, captured from the rendered geometry. Used as a
   * fallback target plane when the upstream-faceMap lookup misses. */
  extrudeUpToFaceFallback = signal<{ origin: [number, number, number]; normal: [number, number, number] } | null>(null);

  /** Compute a representative plane (centroid + average normal) for the
   * face mesh with the given id. Returns null when the face isn't in
   * the rendered geometry. */
  private faceFallbackPlane(faceId: string): { origin: [number, number, number]; normal: [number, number, number] } | null {
    const g = this.geometry();
    if (!g) return null;
    const f = g.faces.find(face => face.faceId === faceId);
    if (!f) return null;
    const verts = f.positions;
    const norms = f.normals;
    if (verts.length < 3 || norms.length < 3) return null;
    const vertCount = verts.length / 3;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < vertCount; i++) {
      cx += verts[i * 3];
      cy += verts[i * 3 + 1];
      cz += verts[i * 3 + 2];
    }
    cx /= vertCount; cy /= vertCount; cz /= vertCount;
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < vertCount; i++) {
      nx += norms[i * 3];
      ny += norms[i * 3 + 1];
      nz += norms[i * 3 + 2];
    }
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) return null;
    return {
      origin: [cx, cy, cz],
      normal: [nx / len, ny / len, nz / len],
    };
  }

  /** Enter axis-pick mode for the Revolve sidebar. Mutually exclusive with
   * vertex / face pick so the viewer's click handler only routes to one
   * picker at a time. */
  beginAxisPick(): void {
    this.vertexPickMode.set(false);
    this.facePickMode.set(false);
    this.axisPickMode.set(true);
  }

  /** Clear the picked axis from the Revolve sidebar's X button. The
   * commit button disables itself when axis is null so this also gates
   * the OK button — gives the user a way out when they've picked a bad
   * axis and want to start over without committing. */
  clearAxisPick(): void {
    this.revolveAxisLineId.set(null);
    this.axisPickMode.set(false);
  }

  /** Called by the viewer when the user clicks an axis-candidate line in
   * the Revolve sidebar's pick mode. */
  onAxisPicked(lineId: string): void {
    this.revolveAxisLineId.set(lineId);
    this.axisPickMode.set(false);
  }

  /** Selection filter — when no sidebar is driving the picker, the
   * three filter buttons in the footer let the user choose which
   * entity kind clicks select. Each call is a mutually-exclusive
   * toggle: clicking the active filter turns it off (default
   * unfiltered behavior); clicking another switches to that kind. */
  toggleSelectionFilter(kind: 'face' | 'edge' | 'vertex'): void {
    const isActive =
      (kind === 'face'   && this.facePickMode()) ||
      (kind === 'edge'   && this.edgePickMode()) ||
      (kind === 'vertex' && this.vertexPickMode());
    // Turn everything off first, then re-enable only the chosen kind
    // (or nothing, if the user clicked the currently-active filter).
    this.facePickMode.set(false);
    this.edgePickMode.set(false);
    this.vertexPickMode.set(false);
    this.axisPickMode.set(false);
    if (isActive) return;
    if (kind === 'face')   this.facePickMode.set(true);
    if (kind === 'edge')   this.edgePickMode.set(true);
    if (kind === 'vertex') this.vertexPickMode.set(true);
  }

  /** Viewer's edgePickMode goes hot when EITHER the debug toggle is on
   * OR a sketch is open with the "Convert Entities" tool active —
   * lets the user click an edge to project it into the sketch plane. */
  edgePickActive = computed<boolean>(() => {
    if (this.edgePickMode()) return true;
    if (!this.activeSketchId()) return false;
    return this.sketchEditorRef()?.tool() === 'convert-entities';
  });

  /** Face-pick on top of the existing dim-picker case. While Convert
   * Entities is active in a sketch the user can also click a face to
   * project its entire boundary (every edge of the face becomes a
   * projected entity in the sketch). */
  facePickActive = computed<boolean>(() => {
    if (this.facePickMode()) return true;
    // Fillet / Chamfer sidebar accepts face picks too — click a face,
    // expand to its boundary edges. onFacePicked routes to the blend
    // handler when the sidebar is open.
    if (this.edgeBlendSidebar() !== null && this.edgePickMode()) return true;
    // Measure sidebar accepts every entity kind simultaneously.
    if (this.measureSidebar()) return true;
    if (!this.activeSketchId()) return false;
    return this.sketchEditorRef()?.tool() === 'convert-entities';
  });

  onEdgePicked(rec: { edgeId: string; isStraight: boolean; endpoints: [[number, number, number], [number, number, number]]; polylineLength: number }): void {
    // Convert Entities: project the picked edge onto the active
    // sketch's plane as a new sketch entity. Tool stays active so the
    // user can chain conversions.
    const sid = this.activeSketchId();
    if (sid && this.sketchEditorRef()?.tool() === 'convert-entities') {
      this.projectEdgeToActiveSketch(sid, rec);
      return;
    }
    // Datum Plane sidebar: route edge picks to the active method's
    // open slot (angleThroughEdge / lineAndPerpFace / pointAndPerpEdge).
    if (this.datumPlaneSidebar()) {
      const edgeRef: EdgeRef3D = { start: rec.endpoints[0], end: rec.endpoints[1] };
      if (this.addDatumPlaneEdgePick(edgeRef)) return;
    }
    // REQ 660 — datum axis edge routing.
    if (this.datumAxisSidebar()) {
      const edgeRef: EdgeRef3D = { start: rec.endpoints[0], end: rec.endpoints[1] };
      if (this.addDatumAxisEdgePick(edgeRef)) return;
    }
    // REQ 661 — datum point edge routing.
    if (this.datumPointSidebar()) {
      const edgeRef: EdgeRef3D = { start: rec.endpoints[0], end: rec.endpoints[1] };
      if (this.addDatumPointEdgePick(edgeRef)) return;
    }
    // 3D Fillet / Chamfer: add the picked edge to the current blend's
    // edge list. Stays in pick mode so the user can chain clicks across
    // multiple edges before committing.
    if (this.edgePickMode() && this.edgeBlendSidebar()) {
      this.addEdgeBlendEdge(rec);
      return;
    }
    // Measure sidebar: add edge as a MeasureItem and stay in pick mode.
    if (this.measureSidebar()) {
      // Approximate analytic length from the polyline sample for curved
      // edges. For straight edges the length stays undefined and the
      // compute uses the chord distance.
      let length: number | undefined;
      let circle: ReturnType<typeof fitCircle> | null = null;
      if (!rec.isStraight) {
        const topoEdge = this.geometry()?.topology.edges.find(e => e.id === rec.edgeId);
        if (topoEdge?.polyline && topoEdge.polyline.length >= 2) {
          let total = 0;
          for (let i = 0; i + 1 < topoEdge.polyline.length; i++) {
            const a = topoEdge.polyline[i];
            const b = topoEdge.polyline[i + 1];
            total += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
          }
          length = total;
          // Try fitting a circle to the polyline. Returns null when
          // the curve is not circular (spline / ellipse / etc.).
          circle = fitCircle(topoEdge.polyline);
        }
      }
      this.addMeasureItem({
        kind: 'edge', id: rec.edgeId,
        start: rec.endpoints[0], end: rec.endpoints[1],
        isStraight: rec.isStraight,
        ...(typeof length === 'number' ? { length } : {}),
        ...(circle ? { circle } : {}),
      });
      return;
    }
    // No sidebar consumed the pick — nothing more to do. The general
    // selection state is handled by the viewer's `selectionChange`
    // path; this handler only fires when the viewer routes an edge
    // pick TO the editor (Convert Entities / Datum Plane / Fillet /
    // Chamfer / Measure). Anything else is intentionally a no-op.
  }

  /** Add a new sketch entity for the projected edge. Straight edges
   * become a single LineEntity between the projected endpoints.
   * Closed circular edges (full circles, e.g. the rim of a cylinder)
   * become a CircleEntity. Other curves are surfaced as an error for
   * now — polyline approximation would create dozens of entities and
   * confuse the picker; the user can break the source down into
   * primitives instead. */
  private projectEdgeToActiveSketch(
    sid: SketchId,
    rec: { edgeId: string; isStraight: boolean; endpoints: [[number, number, number], [number, number, number]]; polylineLength: number },
  ): void {
    const sketch = this.doc().sketches[sid];
    if (!sketch) return;
    // When the sketch editor's "Draw Cons." toggle is on while Convert
    // is active, the converted curve comes in as a construction (dashed
    // reference) entity. Only the CURVE itself is flagged construction
    // — its supporting points stay as-is so shared / reused points
    // don't inadvertently flip other entities.
    const asConstruction = this.sketchEditorRef()?.drawConstruction() ?? false;
    const markConstruction = (state: SketchState, entityId: string): SketchState => {
      if (!asConstruction) return state;
      return {
        ...state,
        entities: state.entities.map(e =>
          e.id === entityId ? { ...e, construction: true } : e),
      };
    };
    if (rec.isStraight) {
      const p1 = projectFrom3D(sketch.plane, rec.endpoints[0]);
      const p2 = projectFrom3D(sketch.plane, rec.endpoints[1]);
      if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 1e-6) {
        this.errors.showError('Convert Entities: edge projects to a point on the sketch plane (edge is perpendicular to the plane).');
        return;
      }
      // SolidWorks Convert Entities snaps each projected endpoint onto
      // any existing sketch point at the same coordinate (within
      // POINT_TOL). Two converted edges meeting at a 3D vertex therefore
      // share the projected sketch point — no duplicate endpoint, no
      // degree-1 dangling vertex, no fight with the profile walker.
      // The line carries a projectedFrom link to the source edge; the
      // re-projection effect re-applies the source coords each regen.
      let next = sketch.state;
      const a = this._acquirePointAtCoord(next, p1.x, p1.y); next = a.state;
      const b = this._acquirePointAtCoord(next, p2.x, p2.y); next = b.state;
      const ln = addLine(next, a.id, b.id); next = ln.state;
      next = markConstruction(next, ln.id);
      next = this._tagProjected(next, ln.id, rec.edgeId);
      this.doc.set(updateSketchState(this.doc(), sid, next));
      this.save();
      return;
    }
    // Curved edge — look up the topology entry to inspect the polyline.
    const topoEdge = this.geometry()?.topology?.edges.find(e => e.id === rec.edgeId);
    if (!topoEdge || !topoEdge.polyline || topoEdge.polyline.length < 2) {
      this.errors.showError('Convert Entities: edge has no polyline data available.');
      return;
    }
    const polyline = topoEdge.polyline as Array<[number, number, number]>;
    const circleProj = this._circleFromPolyline(polyline, sketch.plane);
    if (circleProj) {
      // Circle center reuses any existing point at the same coord — a
      // circular boss whose center already has a construction point will
      // anchor cleanly on it.
      let next = sketch.state;
      const c = this._acquirePointAtCoord(next, circleProj.cx, circleProj.cy); next = c.state;
      const r = addCircleByPoint(next, c.id, circleProj.radius); next = r.state;
      next = markConstruction(next, r.id);
      next = this._tagProjected(next, r.id, rec.edgeId);
      this.doc.set(updateSketchState(this.doc(), sid, next));
      this.save();
      return;
    }
    const arcProj = this._arcFromPolyline(polyline, sketch.plane);
    if (arcProj) {
      // Each of center / start / end shares with an existing sketch
      // point at the same coord. Fillets on a body that touch a flat
      // edge will share endpoints with the adjacent converted line.
      let next = sketch.state;
      const cp = this._acquirePointAtCoord(next, arcProj.cx, arcProj.cy); next = cp.state;
      const sp = this._acquirePointAtCoord(next, arcProj.startX, arcProj.startY); next = sp.state;
      const ep = this._acquirePointAtCoord(next, arcProj.endX, arcProj.endY); next = ep.state;
      const r = addArcByPoints(next, cp.id, sp.id, ep.id, arcProj.ccw); next = r.state;
      next = markConstruction(next, r.id);
      next = this._tagProjected(next, r.id, rec.edgeId);
      this.doc.set(updateSketchState(this.doc(), sid, next));
      this.save();
      return;
    }
    this.errors.showError('Convert Entities: edge is neither a straight line, a full circle, nor a circular arc. Splines / ellipses: coming soon.');
  }

  /** Find-or-create a sketch point at the given coord. Mirrors how SW's
   * Convert Entities treats projected endpoints: if a point already
   * exists within POINT_TOL=1e-4 of the target, reuse its id (so the new
   * line/arc shares that vertex with whatever else references it);
   * otherwise add a fresh point. POINT_TOL matches the arrangement
   * canonicalisation tolerance, so points considered the same by the
   * profile walker are also considered the same here. */
  private _acquirePointAtCoord(
    state: SketchState, x: number, y: number, tol = 1e-4,
  ): { state: SketchState; id: string } {
    const tol2 = tol * tol;
    for (const e of state.entities) {
      if (e.kind !== 'point') continue;
      const dx = e.x - x, dy = e.y - y;
      if (dx * dx + dy * dy <= tol2) return { state, id: e.id };
    }
    return addPoint(state, x, y);
  }

  /** Open polyline → arc detection. Three-point circumcircle (first /
   * middle / last sample), verified against every other sample. Returns
   * null when the polyline isn't an arc on the sketch plane. */
  private _arcFromPolyline(
    polyline: Array<[number, number, number]>,
    plane: { origin: [number, number, number]; xAxis: [number, number, number]; yAxis: [number, number, number]; normal: [number, number, number] },
  ): { cx: number; cy: number; radius: number; startX: number; startY: number; endX: number; endY: number; ccw: boolean } | null {
    if (polyline.length < 3) return null;
    const pts2d = polyline.map(p => projectFrom3D(plane, p));
    const first = pts2d[0], last = pts2d[pts2d.length - 1];
    const closed = Math.hypot(last.x - first.x, last.y - first.y) < 1e-4;
    if (closed) return null;  // _circleFromPolyline handles closed
    const mid = pts2d[Math.floor(pts2d.length / 2)];
    const c = _circumcircle2d(first, mid, last);
    if (!c) return null;
    const ok = pts2d.every(p =>
      Math.abs(Math.hypot(p.x - c.cx, p.y - c.cy) - c.radius) < c.radius * 0.01 + 1e-3,
    );
    if (!ok) return null;
    // CCW direction inferred from the angular ordering of (first, mid,
    // last) around the center. The earlier cross-product test on the
    // chord chose the LONG way around the circle for a quarter-circle
    // fillet — wrong. Going around CCW from start, the mid sample
    // must be encountered before end; otherwise the traversal is CW.
    const angA = Math.atan2(first.y - c.cy, first.x - c.cx);
    const angM = Math.atan2(mid.y - c.cy, mid.x - c.cx);
    const angB = Math.atan2(last.y - c.cy, last.x - c.cx);
    const norm = (x: number) => { let v = x; while (v < 0) v += 2 * Math.PI; while (v >= 2 * Math.PI) v -= 2 * Math.PI; return v; };
    const ccw = norm(angM - angA) < norm(angB - angA);
    return {
      cx: c.cx, cy: c.cy, radius: c.radius,
      startX: first.x, startY: first.y,
      endX: last.x, endY: last.y,
      ccw,
    };
  }

  /** Attach a SolidWorks-style on-edge constraint linking the entity
   * to a body edge. The entity itself stays a plain line/arc/circle;
   * the constraint carries the externalRef and is what re-projection,
   * solver, and break-link all read from. */
  private _tagProjected(state: SketchState, entityId: string, edgeId: string): SketchState {
    const featureId = edgeId.split('/')[0] ?? '';
    const id = `on-edge-${entityId}-${Date.now()}`;
    return {
      ...state,
      constraints: [
        ...state.constraints,
        {
          id, type: 'on-edge',
          targets: [{ entityId }],
          externalRef: { featureId, edgeId },
        },
      ],
    };
  }

  /** Detect "closed circular polyline lying on (or near) the sketch
   * plane" — returns null when not circular. Reused by the convert
   * handler and the re-projection effect. */
  private _circleFromPolyline(
    polyline: Array<[number, number, number]>, plane: { origin: [number, number, number]; xAxis: [number, number, number]; yAxis: [number, number, number]; normal: [number, number, number] },
  ): { cx: number; cy: number; radius: number } | null {
    if (polyline.length < 8) return null;
    const pts2d = polyline.map(p => projectFrom3D(plane, p));
    const first = pts2d[0], last = pts2d[pts2d.length - 1];
    const closed = Math.hypot(last.x - first.x, last.y - first.y) < 1e-4;
    if (!closed) return null;
    let cx = 0, cy = 0;
    for (let i = 0; i < pts2d.length - 1; i++) { cx += pts2d[i].x; cy += pts2d[i].y; }
    cx /= (pts2d.length - 1); cy /= (pts2d.length - 1);
    const radius = Math.hypot(pts2d[0].x - cx, pts2d[0].y - cy);
    if (radius < 1e-6) return null;
    const ok = pts2d.every(p => Math.abs(Math.hypot(p.x - cx, p.y - cy) - radius) < radius * 0.01 + 1e-3);
    if (!ok) return null;
    return { cx, cy, radius };
  }

  /** Re-project every projected sketch entity from its current source
   * edge in the regen topology. Called as an effect whenever the
   * geometry signal updates. Mutates `doc` in place WITHOUT triggering
   * save (the changes are derived; persisting them would feed back
   * into another regen and loop). */
  private _reprojectAllSketches(): void {
    const geom = this.geometry();
    if (!geom || !geom.topology) return;
    // Per-sketch upstream-state cutoff: when a sketch S is consumed
    // by feature F, its converted entities should reference body
    // state RIGHT BEFORE F composes — not the final body state. The
    // backend's projection already does this (each feature's regen
    // sees a `bodies` array built only from upstream features). The
    // frontend must mirror or the visible sketch state diverges
    // from the kernel and saves write post-F coords against pre-F
    // topology, producing the cyclic-reference symptom: sketch is
    // determining F yet seems to reference edges f11 itself
    // created.
    //
    // Build the cutoff map once: sketchId → tree index of the
    // FIRST feature that uses it. Sketches not consumed by any
    // feature get no cutoff (project against everything).
    const tree = this.featureTree();
    const sketchCutoffIdx = new Map<string, number>();
    for (let i = 0; i < tree.features.length; i++) {
      const f = tree.features[i] as { sketchId?: string };
      const sid = f.sketchId;
      if (!sid) continue;
      if (!sketchCutoffIdx.has(sid)) sketchCutoffIdx.set(sid, i);
    }
    // Per-feature regen emissions give us each feature's resulting
    // body topology. To produce the body state "upstream of feature
    // at index F", we take the LATEST emission per body whose
    // feature-index is < F. The frontend response was structured by
    // featureId; map back to tree indices via the feature tree.
    const featureIdToIdx = new Map<string, number>();
    for (let i = 0; i < tree.features.length; i++) featureIdToIdx.set(tree.features[i].id, i);
    const perFeatureEdges: Array<{ idx: number; bodyId: string | null; edges: ModelTopology['edges'] }> = [];
    for (const cf of this.latestRegenFeatures()) {
      const idx = featureIdToIdx.get(cf.featureId);
      if (idx === undefined) continue;
      perFeatureEdges.push({ idx, bodyId: cf.bodyId, edges: cf.topology.edges });
    }
    perFeatureEdges.sort((a, b) => a.idx - b.idx);
    // Reusable: build the edge index for "everything strictly before cutoffIdx".
    const buildEdgeIndexUpTo = (cutoffIdx: number | undefined): Map<string, ModelTopology['edges'][number]> => {
      if (cutoffIdx === undefined) {
        // No cutoff — project against final state.
        const out = new Map<string, ModelTopology['edges'][number]>();
        for (const e of geom.topology.edges) out.set(e.id, e);
        return out;
      }
      // For each body, take the LATEST emission with idx < cutoffIdx.
      const latestPerBody = new Map<string | null, ModelTopology['edges']>();
      for (const ent of perFeatureEdges) {
        if (ent.idx >= cutoffIdx) break;  // sorted by idx ascending
        latestPerBody.set(ent.bodyId, ent.edges);
      }
      const out = new Map<string, ModelTopology['edges'][number]>();
      for (const edges of latestPerBody.values()) {
        for (const e of edges) out.set(e.id, e);
      }
      return out;
    };
    const doc = this.doc();
    let docChanged = false;
    const nextSketches: Record<string, typeof doc.sketches[string]> = {};
    for (const [sid, sketch] of Object.entries(doc.sketches)) {
      const cutoff = sketchCutoffIdx.get(sid);
      const edgeIndex = buildEdgeIndexUpTo(cutoff);
      // Source of truth for "what's projected" is now the on-edge
      // constraint list. Build [entity, externalRef] pairs from the
      // constraints so the rest of this loop can stay unchanged in
      // shape (just iterate pairs instead of entity.projectedFrom).
      const entitiesById = new Map(sketch.state.entities.map(e => [e.id, e]));
      const projectedPairs: Array<{ entity: typeof sketch.state.entities[number]; edgeId: string }> = [];
      for (const c of sketch.state.constraints) {
        if (c.type !== 'on-edge' || !c.externalRef) continue;
        for (const t of c.targets) {
          const e = entitiesById.get(t.entityId);
          if (e) projectedPairs.push({ entity: e, edgeId: c.externalRef.edgeId });
        }
      }
      if (projectedPairs.length === 0) {
        nextSketches[sid] = sketch;
        continue;
      }
      // Build a working copy of entities, mutating points referenced
      // by projected lines/circles to their fresh 2D coords.
      let sketchChanged = false;
      const newEntities = sketch.state.entities.map(e => e);
      // A projected endpoint is "pinned" only when a POSITION-
      // determining constraint references it — coincident with
      // another curve / point, fixed, or midpoint. Dimensions
      // (distance / hdist / vdist) and orientation constraints
      // (horizontal / parallel / equal / …) constrain relationships,
      // NOT absolute 2D position, so they shouldn't block on-edge
      // re-projection. Without this distinction, adding a smart dim
      // that references the source endpoint silently kills the
      // on-edge link.
      const isPointPinned = (pointId: string): boolean => {
        for (const c of sketch.state.constraints) {
          if (c.type !== 'coincident' && c.type !== 'fixed' && c.type !== 'midpoint') continue;
          for (const t of c.targets) {
            if (t.entityId === pointId) return true;
          }
        }
        return false;
      };
      const updatePoint = (pid: string, x: number, y: number) => {
        if (isPointPinned(pid)) return;
        const idx = newEntities.findIndex(en => en.id === pid && en.kind === 'point');
        if (idx < 0) return;
        const cur = newEntities[idx] as PointEntity;
        if (Math.abs(cur.x - x) < 1e-9 && Math.abs(cur.y - y) < 1e-9) return;
        newEntities[idx] = { ...cur, x, y };
        sketchChanged = true;
      };
      for (const { entity: pe, edgeId } of projectedPairs) {
        const src = edgeIndex.get(edgeId);
        if (!src) continue;  // source missing — leave entity at last-known coords
        if (pe.kind === 'line' && src.isStraight) {
          const p1 = projectFrom3D(sketch.plane, src.endpoints[0]);
          const p2 = projectFrom3D(sketch.plane, src.endpoints[1]);
          // Endpoint correspondence isn't fixed: the kernel may
          // reorder a body edge's endpoints across regens, and a
          // trimmed sub-segment's startId / endId map to the source
          // endpoints based on geometric proximity, not insertion
          // order. Pick the assignment that minimises total travel
          // — without this, the FREE end of a trimmed sub-segment
          // can jump to the OPPOSITE source endpoint on rebuild,
          // visually flipping the kept side.
          const ln = pe as LineEntity;
          const sPt = newEntities.find(en => en.id === ln.startId && en.kind === 'point') as PointEntity | undefined;
          const ePt = newEntities.find(en => en.id === ln.endId && en.kind === 'point') as PointEntity | undefined;
          if (sPt && ePt) {
            const d2 = (a: PointEntity | { x: number; y: number }, b: { x: number; y: number }) =>
              (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
            const directCost = d2(sPt, p1) + d2(ePt, p2);
            const swapCost   = d2(sPt, p2) + d2(ePt, p1);
            const swap = swapCost < directCost;
            const startPinned = isPointPinned(ln.startId);
            const endPinned = isPointPinned(ln.endId);
            const startTarget = swap ? p2 : p1;
            const endTarget = swap ? p1 : p2;
            // Diagnostic log for "trim flips on rebuild". Enable with
            // `window.__cadDebug = true` in DevTools, exit the sketch,
            // and the console will print every projected line's
            // before/after along with whether each endpoint was
            // pinned, which target was chosen, and what coords actually
            // got written. Silent when the flag is off.
            if (typeof globalThis !== 'undefined'
                && (globalThis as { __cadDebug?: boolean }).__cadDebug) {
              const payload = {
                entityId: ln.id,
                edgeId,
                source_p1: p1, source_p2: p2,
                start: { id: ln.startId, coord: { x: sPt.x, y: sPt.y }, pinned: startPinned },
                end:   { id: ln.endId,   coord: { x: ePt.x, y: ePt.y }, pinned: endPinned },
                directCost, swapCost, swap,
                wouldWriteStart: startTarget,
                wouldWriteEnd:   endTarget,
              };
              // eslint-disable-next-line no-console
              console.log('[cad-reproject:line]\n' + JSON.stringify(payload, null, 2));
            }
            updatePoint(ln.startId, startTarget.x, startTarget.y);
            updatePoint(ln.endId,   endTarget.x,   endTarget.y);
          } else {
            // Defensive fallback when the endpoint records are gone
            // (shouldn't happen under normal flow).
            updatePoint(ln.startId, p1.x, p1.y);
            updatePoint(ln.endId, p2.x, p2.y);
          }
        } else if (pe.kind === 'circle' && src.polyline) {
          const proj = this._circleFromPolyline(src.polyline as Array<[number, number, number]>, sketch.plane);
          if (!proj) continue;
          const ce = pe as CircleEntity;
          updatePoint(ce.centerId, proj.cx, proj.cy);
          if (Math.abs(ce.radius - proj.radius) > 1e-9) {
            const idx = newEntities.findIndex(en => en.id === ce.id);
            newEntities[idx] = { ...ce, radius: proj.radius } as CircleEntity;
            sketchChanged = true;
          }
        } else if (pe.kind === 'arc' && src.polyline) {
          const proj = this._arcFromPolyline(src.polyline as Array<[number, number, number]>, sketch.plane);
          if (!proj) continue;
          const ae = pe as import('../../../cad/lib/types').ArcEntity;
          updatePoint(ae.centerId, proj.cx, proj.cy);
          updatePoint(ae.startId, proj.startX, proj.startY);
          updatePoint(ae.endId, proj.endX, proj.endY);
          if (Math.abs(ae.radius - proj.radius) > 1e-9 || ae.ccw !== proj.ccw) {
            const idx = newEntities.findIndex(en => en.id === ae.id);
            newEntities[idx] = { ...ae, radius: proj.radius, ccw: proj.ccw };
            sketchChanged = true;
          }
        }
      }
      nextSketches[sid] = sketchChanged
        ? { ...sketch, state: { ...sketch.state, entities: newEntities } }
        : sketch;
      if (sketchChanged) docChanged = true;
    }
    if (docChanged) {
      // Update doc without calling save() — projected coords are
      // derived, not user-edited, and saving here triggers the next
      // regen, whose response triggers projection again, looping
      // indefinitely if anything (regen failure / floating-point
      // drift / source-body shift) keeps producing changes. The DB
      // may carry stale coords until the user makes a manual edit
      // that triggers save; backend re-projection handles the
      // staleness at kernel time so the running geometry is still
      // correct.
      this.doc.set({ ...doc, sketches: nextSketches });
    }
  }

  /** Label for the currently-picked revolve axis, derived from its
   * endpoint coordinates so the button reads like the sidebar's prior
   * list rows ("Vertical at x=5", "(0,0) → (10,5)"). Falls back to a
   * generic "axis picked" if endpoints aren't found. */
  revolveAxisLabel = computed<string | null>(() => {
    const id = this.revolveAxisLineId();
    if (!id) return null;
    const ctx = this.revolveSidebar();
    if (!ctx) return null;
    const sketch = this.doc().sketches[ctx.sketchId];
    if (!sketch) return null;
    const ln = sketch.state.entities.find(e => e.id === id);
    if (!ln || ln.kind !== 'line') return null;
    const findPt = (pid: string) => sketch.state.entities.find(
      (e): e is import('../../../cad/lib/types').PointEntity => e.id === pid && e.kind === 'point',
    );
    const a = findPt(ln.startId), b = findPt(ln.endId);
    if (!a || !b) return null;
    const fmt = (n: number) => Number.isInteger(n) ? `${n}` : n.toFixed(2);
    const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
    if (dx < 1e-4) return `Vertical at x=${fmt(a.x)}`;
    if (dy < 1e-4) return `Horizontal at y=${fmt(a.y)}`;
    return `(${fmt(a.x)}, ${fmt(a.y)}) → (${fmt(b.x)}, ${fmt(b.y)})`;
  });

  /** Apply the Extrude sidebar's current inputs. Branches on whether the
   * sidebar was opened to create a new extrude or to edit an existing one. */
  commitExtrudeSidebar() {
    const ctx = this.extrudeSidebar();
    if (!ctx) return;
    if (!this.canCommitExtrude()) return;
    const endCondition = this.resolveEndCondition();
    if (!endCondition) return;
    const distance = this.extrudeDistance();
    const flipped = this.extrudeFlipped();
    const merge = this.extrudeMerge();
    const regionIndices = [...this.extrudeSelectedRegions()].sort((a, b) => a - b);
    const startCondition = this.resolveStartCondition();
    if (!startCondition) return;  // canCommitExtrude already gates this
    const d2End = this.resolveDir2EndCondition();
    const direction2 = (this.extrudeDir2Enabled() && this.extrudeEndKind() !== 'midPlane' && d2End)
      ? { distance: this.extrudeDir2Distance(), endCondition: d2End }
      : undefined;
    this.extrudeSidebar.set(null);
    this.extrudeHoveredRegion.set(null);
    this.vertexPickMode.set(false);
    this.facePickMode.set(false);
    this.setMode('idle');
    if (ctx.editingFeatureId) {
      // merge only applies to additive Extrude; updateFeatureParam ignores
      // it for cutExtrude (the field doesn't exist there).
      const patch: Partial<ExtrudeFeature> = {
        distance, flipped, regionIndices, endCondition,
        startCondition, direction2,
      };
      if (ctx.mode !== 'cutExtrude') patch.merge = merge;
      this.featureTree.set(updateFeatureParam<ExtrudeFeature>(
        this.featureTree(), ctx.editingFeatureId, patch,
      ));
      this._writeExtrudeEquations(ctx.editingFeatureId, !!direction2, startCondition.kind === 'offset');
      this.save();
    } else {
      this._applyExtrude(ctx.sketchId, {
        distance, flipped, regionIndices, endCondition, mode: ctx.mode, merge,
        startCondition, direction2,
      });
    }
  }

  /** Persist the active dim-input expressions to the equations doc
   * under the appropriate target keys. Called after addFeature /
   * updateFeatureParam so we know the feature id. Clears entries when
   * the corresponding expression is null (user typed a literal). */
  private _writeExtrudeEquations(featureId: string, hasDir2: boolean, hasOffset: boolean): void {
    let next = this.equations();
    const apply = (target: string, expression: string | null) => {
      next = expression === null ? removeEquation(next, target) : setEquation(next, target, expression);
    };
    apply(`feature.${featureId}.distance`, this.extrudeDistanceExpression());
    apply(
      `feature.${featureId}.direction2.distance`,
      hasDir2 ? this.extrudeDir2DistanceExpression() : null,
    );
    apply(
      `feature.${featureId}.startCondition.distance`,
      hasOffset ? this.extrudeStartOffsetExpression() : null,
    );
    this.equations.set(next);
  }

  private _writeRevolveEquations(featureId: string): void {
    let next = this.equations();
    const expr = this.revolveAngleExpression();
    next = expr === null
      ? removeEquation(next, `feature.${featureId}.angle`)
      : setEquation(next, `feature.${featureId}.angle`, expr);
    this.equations.set(next);
  }

  cancelExtrudeSidebar() {
    this.extrudeSidebar.set(null);
    this.extrudeHoveredRegion.set(null);
    this.extrudeUpToVertexId.set(null);
    this.extrudeUpToFaceId.set(null);
    this.extrudeUpToFaceFallback.set(null);
    this.extrudeStartUpToVertexId.set(null);
    this.extrudeStartUpToFaceId.set(null);
    this.extrudeStartUpToFaceFallback.set(null);
    this.vertexPickMode.set(false);
    this.facePickMode.set(false);
    this.setMode('idle');
  }

  isExtrudeRegionSelected(i: number): boolean {
    return this.extrudeSelectedRegions().has(i);
  }
  toggleExtrudeRegion(i: number) {
    const next = new Set(this.extrudeSelectedRegions());
    if (next.has(i)) next.delete(i); else next.add(i);
    this.extrudeSelectedRegions.set(next);
  }
  extrudeRegionIndices(): number[] {
    const ctx = this.extrudeSidebar();
    return ctx ? Array.from({ length: ctx.regionCount }, (_, i) => i) : [];
  }

  /** Commit the extrude feature to the feature tree. Pulled out of the
   * sidebar flow so both paths share the same finalisation logic
   * (auto-extrude after sketch-on-datum, manual extrude via sidebar). */
  private _applyExtrude(
    sketchId: string,
    result: {
      distance: number; flipped: boolean; regionIndices: number[];
      endCondition?: ExtrudeEndCondition;
      mode?: 'extrude' | 'cutExtrude';
      merge?: boolean;
      startCondition?: import('../../../cad/lib/types').ExtrudeStartCondition;
      direction2?: import('../../../cad/lib/types').ExtrudeDirection;
    },
  ) {
    const type = result.mode === 'cutExtrude' ? 'cutExtrude' : 'extrude';
    const featurePayload: any = {
      type, sketchId,
      distance: result.distance,
      flipped: result.flipped,
      regionIndices: result.regionIndices,
      endCondition: result.endCondition ?? { kind: 'blind' },
    };
    if (type === 'extrude' && result.merge === false) featurePayload.merge = false;
    // Persist startCondition only when it differs from the default —
    // keeps the JSON tidy for the common case.
    if (result.startCondition && result.startCondition.kind !== 'sketchPlane') {
      featurePayload.startCondition = result.startCondition;
    }
    if (result.direction2) featurePayload.direction2 = result.direction2;
    const nextTree = addFeature(this.featureTree(), featurePayload);
    this.featureTree.set(nextTree);
    // addFeature appends — the new feature is the last entry. Persist
    // any pending equation bindings under that feature's id.
    const newFeatureId = nextTree.features[nextTree.features.length - 1]?.id;
    if (newFeatureId) {
      this._writeExtrudeEquations(
        newFeatureId,
        !!result.direction2,
        result.startCondition?.kind === 'offset',
      );
    }
    // REQ 618 — extruded sketches auto-hide their 2D overlay. The user can
    // re-show via the feature-tree eye toggle if they need to inspect the
    // source profile.
    this.doc.set(setSketchVisibility(this.doc(), sketchId, false));
    this.save();
  }

  // Tree context-menu actions (REQs 607, 609, 610, 611) and sketch deletion (REQ 608).
  onTreeAction(action: FeatureTreeAction) {
    if (this.readonly()) return;
    switch (action.action) {
      case 'edit-feature': return this.editFeature(action.featureId);
      case 'delete-feature': return this.deleteFeature(action.featureId);
      case 'toggle-feature-visibility': return this.toggleFeatureVisibility(action.featureId);
      case 'toggle-feature-suppression': return this.toggleFeatureSuppression(action.featureId);
      case 'rename-feature': return this.renameFeature(action.featureId);
      case 'edit-sketch': return this.editSketch(action.sketchId);
      case 'delete-sketch': return this.requestDeleteSketch(action.sketchId);
      case 'toggle-sketch-visibility': return this.toggleSketchVisibility(action.sketchId);
      case 'rename-sketch': return this.renameSketch(action.sketchId);
      case 'toggle-cosmetic-threads-visibility': return this.cosmeticThreadsVisible.set(!this.cosmeticThreadsVisible());
    }
  }

  private renameFeature(featureId: string) {
    const feature = this.featureTree().features.find(f => f.id === featureId);
    if (!feature || feature.type !== 'extrude') return;
    const current = feature.name ?? '';
    const next = window.prompt('Rename feature:', current);
    if (next === null) return;  // user cancelled
    const trimmed = next.trim();
    this.featureTree.set(updateFeatureParam<ExtrudeFeature>(this.featureTree(), featureId, {
      name: trimmed || undefined,  // clearing the name reverts to default label
    }));
    this.save();
  }

  private renameSketch(sketchId: string) {
    const sketch = this.doc().sketches[sketchId];
    if (!sketch) return;
    const current = sketch.name ?? '';
    const next = window.prompt('Rename sketch:', current);
    if (next === null) return;
    const trimmed = next.trim();
    this.doc.set(setSketchName(this.doc(), sketchId, trimmed));
    this.save();
  }

  private toggleSketchVisibility(sketchId: string) {
    const ids = this.batchSketchTargets(sketchId);
    const anchor = this.doc().sketches[sketchId];
    if (!anchor) return;
    // Anchor the next visibility off the right-clicked sketch so every batch
    // member lands in the same visible/hidden state (predictable bulk toggle).
    const nextVisible = anchor.visible === false;
    let doc = this.doc();
    for (const id of ids) {
      if (!doc.sketches[id]) continue;
      doc = setSketchVisibility(doc, id, nextVisible);
    }
    this.doc.set(doc);
    this.save();
  }

  // Same rule as batchTargets but for the selectedSketches signal.
  private batchSketchTargets(sketchId: string): string[] {
    const sel = this.selectedSketches();
    return sel.has(sketchId) && sel.size > 1 ? Array.from(sel) : [sketchId];
  }

  private editFeature(featureId: string) {
    const feature = this.featureTree().features.find(f => f.id === featureId);
    if (!feature) return;
    if (feature.type === 'revolve' || feature.type === 'cutRevolve') {
      this._editRevolve(feature);
      return;
    }
    if (feature.type === 'sweep' || feature.type === 'cutSweep') {
      this._editSweep(feature);
      return;
    }
    if (feature.type === 'datumPlane') {
      this._editDatumPlane(feature);
      return;
    }
    if (feature.type === 'datumAxis') {
      this._editDatumAxis(feature);
      return;
    }
    if (feature.type === 'datumPoint') {
      this._editDatumPoint(feature);
      return;
    }
    if (feature.type === 'mirror' || feature.type === 'linearPattern' || feature.type === 'circularPattern') {
      this._editPattern(feature);
      return;
    }
    if (feature.type === 'shell') {
      this._editShell(feature);
      return;
    }
    if (feature.type === 'combine') {
      this._editCombine(feature);
      return;
    }
    if (feature.type === 'hole') {
      this._editHole(feature);
      return;
    }
    if (feature.type === 'mirrorBody') {
      this._editMirrorBody(feature);
      return;
    }
    if (feature.type === 'moveCopyBody') {
      this._editMoveCopyBody(feature);
      return;
    }
    if (feature.type === 'fillet' || feature.type === 'chamfer') {
      const f = feature as any;
      this.edgeBlendValue.set(feature.type === 'fillet' ? Number(f.radius) : Number(f.distance));
      this.edgeBlendValueExpression.set(null);
      this.edgeBlendEdges.set((f.edges || []).map((e: any, idx: number) => ({
        edgeId: `edit#${idx}`,  // synthetic id — kernel re-matches by endpoints
        start: e.start,
        end: e.end,
        ...(typeof e.value === 'number' ? { value: e.value } : {}),
        ...(typeof e.faceId === 'string' ? { faceId: e.faceId } : {}),
        ...(typeof e.edgeGroupId === 'string' ? { edgeGroupId: e.edgeGroupId } : {}),
      })));
      // Restore chamfer-specific mode + extras. Legacy chamfer records
      // without `mode` set count as 'equal' so they keep rendering the
      // same way they always did.
      if (feature.type === 'chamfer') {
        this.edgeBlendChamferMode.set((f.mode as ChamferFeature['mode']) || 'equal');
        this.edgeBlendDistance2.set(typeof f.distance2 === 'number' ? f.distance2 : 1);
        this.edgeBlendDistance2Expression.set(null);
        this.edgeBlendAngle.set(typeof f.angle === 'number' ? f.angle : 45);
        this.edgeBlendAngleExpression.set(null);
      }
      this.edgePickMode.set(false);
      this.edgeBlendSidebar.set({ kind: feature.type, editingFeatureId: featureId });
      return;
    }
    if (feature.type !== 'extrude' && feature.type !== 'cutExtrude') return;
    const sketch = this.doc().sketches[feature.sketchId];
    const regionCount = sketch ? extractRegions(sketch.state).regions.length : 1;
    // Reuse the same Extrude sidebar in "editing" mode: commit updates the
    // existing feature rather than appending a new one.
    this.extrudeDistance.set(feature.distance);
    // Populate expression signals from the equations doc — if this
    // feature is driven by an equation the user sees the expression
    // text + Σ badge in the dim-input. Null when there's no binding.
    this.extrudeDistanceExpression.set(this.featureEquation(`feature.${featureId}.distance`));
    this.extrudeDir2DistanceExpression.set(this.featureEquation(`feature.${featureId}.direction2.distance`));
    this.extrudeStartOffsetExpression.set(this.featureEquation(`feature.${featureId}.startCondition.distance`));
    this.extrudeFlipped.set(feature.flipped === true);
    // merge only on additive extrude — cut features don't carry the flag.
    this.extrudeMerge.set(feature.type === 'extrude' ? (feature as ExtrudeFeature).merge !== false : true);
    this.extrudeSelectedRegions.set(new Set(feature.regionIndices ?? [0]));
    const ec = feature.endCondition ?? { kind: 'blind' };
    this.extrudeEndKind.set(ec.kind);
    this.extrudeUpToVertexId.set(ec.kind === 'upToVertex' ? ec.vertexId : null);
    // upToSurface and offsetFromSurface share the face picker — populate
    // extrudeUpToFaceId for either kind. Offset distance + flip are
    // split for the UI (magnitude + flip), mirroring the offset start.
    const ecFaceId = ec.kind === 'upToSurface' || ec.kind === 'offsetFromSurface' ? ec.faceId : null;
    const ecFallback = (ec.kind === 'upToSurface' || ec.kind === 'offsetFromSurface') && ec.fallbackPlane
      ? ec.fallbackPlane : null;
    this.extrudeUpToFaceId.set(ecFaceId);
    this.extrudeUpToFaceFallback.set(ecFallback);
    this.extrudeOffsetFromFaceDistance.set(ec.kind === 'offsetFromSurface' ? Math.abs(ec.offset) : 10);
    this.extrudeOffsetFromFaceFlipped.set(ec.kind === 'offsetFromSurface' && ec.offset < 0);
    this.extrudeOffsetFromFaceExpression.set(this.featureEquation(`feature.${featureId}.endCondition.offset`));
    // Hydrate start condition + direction 2 from the stored feature.
    // For offset start, split the signed distance into magnitude + flip
    // so the UI can present them as separate controls.
    const sc = (feature as ExtrudeFeature).startCondition ?? { kind: 'sketchPlane' as const };
    this.extrudeStartKind.set(sc.kind);
    this.extrudeStartOffset.set(sc.kind === 'offset' ? Math.abs(sc.distance) : 0);
    this.extrudeStartOffsetFlipped.set(sc.kind === 'offset' && sc.distance < 0);
    this.extrudeStartUpToVertexId.set(sc.kind === 'upToVertex' ? sc.vertexId : null);
    const scFaceId = sc.kind === 'upToSurface' || sc.kind === 'offsetFromSurface' ? sc.faceId : null;
    const scFallback = (sc.kind === 'upToSurface' || sc.kind === 'offsetFromSurface') && sc.fallbackPlane
      ? sc.fallbackPlane : null;
    this.extrudeStartUpToFaceId.set(scFaceId);
    this.extrudeStartUpToFaceFallback.set(scFallback);
    this.extrudeStartOffsetFromFaceDistance.set(sc.kind === 'offsetFromSurface' ? Math.abs(sc.offset) : 0);
    this.extrudeStartOffsetFromFaceFlipped.set(sc.kind === 'offsetFromSurface' && sc.offset < 0);
    this.extrudeStartOffsetFromFaceExpression.set(this.featureEquation(`feature.${featureId}.startCondition.offset`));
    const d2 = (feature as ExtrudeFeature).direction2;
    this.extrudeDir2Enabled.set(!!d2);
    this.extrudeDir2Distance.set(d2 ? d2.distance : 10);
    const d2ec = d2 ? d2.endCondition : { kind: 'blind' as const };
    this.extrudeDir2EndKind.set(d2ec.kind);
    this.extrudeDir2UpToVertexId.set(d2ec.kind === 'upToVertex' ? d2ec.vertexId : null);
    const d2FaceId = d2ec.kind === 'upToSurface' || d2ec.kind === 'offsetFromSurface' ? d2ec.faceId : null;
    const d2Fallback = (d2ec.kind === 'upToSurface' || d2ec.kind === 'offsetFromSurface') && d2ec.fallbackPlane
      ? d2ec.fallbackPlane : null;
    this.extrudeDir2UpToFaceId.set(d2FaceId);
    this.extrudeDir2UpToFaceFallback.set(d2Fallback);
    this.extrudeDir2OffsetFromFaceDistance.set(d2ec.kind === 'offsetFromSurface' ? Math.abs(d2ec.offset) : 10);
    this.extrudeDir2OffsetFromFaceFlipped.set(d2ec.kind === 'offsetFromSurface' && d2ec.offset < 0);
    this.extrudeDir2OffsetFromFaceExpression.set(this.featureEquation(`feature.${featureId}.direction2.endCondition.offset`));
    this.extrudeSidebar.set({
      sketchId: feature.sketchId,
      regionCount,
      mode: feature.type === 'cutExtrude' ? 'cutExtrude' : 'extrude',
      editingFeatureId: featureId,
    });
  }

  /** Rehydrate the Sweep sidebar from an existing SweepFeature or
   * CutSweepFeature. Same pattern as _editRevolve. */
  private _editSweep(feature: import('../../../cad/lib/types').SweepFeature | import('../../../cad/lib/types').CutSweepFeature) {
    this.sweepProfileSketchId.set(feature.profileSketchId);
    this.sweepPathSketchId.set(feature.pathSketchId);
    this.sweepMerge.set(feature.type === 'sweep' ? (feature.merge !== false) : true);
    this.sweepSidebar.set({
      mode: feature.type,
      editingFeatureId: feature.id,
    });
  }

  /** Rehydrate the Revolve sidebar from an existing RevolveFeature or
   * CutRevolveFeature. The mode is preserved on commit so the right
   * feature kind gets written back. */
  private _editRevolve(feature: import('../../../cad/lib/types').RevolveFeature | import('../../../cad/lib/types').CutRevolveFeature) {
    const sketch = this.doc().sketches[feature.sketchId];
    const regionCount = sketch ? extractRegions(sketch.state).regions.length : 1;
    this.revolveAxisLineId.set(feature.axisLineId);
    this.revolveAngle.set(feature.angle);
    this.revolveAngleExpression.set(this.featureEquation(`feature.${feature.id}.angle`));
    this.revolveFlipped.set(feature.flipped === true);
    this.extrudeSelectedRegions.set(new Set(feature.regionIndices ?? [0]));
    this.revolveSidebar.set({
      sketchId: feature.sketchId,
      regionCount,
      mode: feature.type === 'cutRevolve' ? 'cutRevolve' : 'revolve',
      editingFeatureId: feature.id,
    });
  }

  /** Re-open the Datum Plane sidebar populated with this feature's
   * stored picks + scalars. Sidebar sits in "editing" mode so commit
   * updates the existing feature instead of appending a new one. */
  private _editDatumPlane(feature: DatumPlaneFeature) {
    this._resetDatumPlaneInputs();
    const m = feature.method;
    switch (m.kind) {
      case 'offset':
        this.datumPlaneRefA.set(m.planeRef);
        this.datumPlaneDistance.set(m.distance);
        this.datumPlaneFlipped.set(m.flipped === true);
        break;
      case 'parallelThroughPoint':
        this.datumPlaneRefA.set(m.planeRef);
        this.datumPlaneVertices.set([m.vertexRef]);
        break;
      case 'angleThroughEdge':
        this.datumPlaneRefA.set(m.planeRef);
        this.datumPlaneEdge.set(m.edgeRef);
        this.datumPlaneAngle.set(m.angleDeg);
        break;
      case 'threePoints':
        this.datumPlaneVertices.set([m.vertexRefs[0], m.vertexRefs[1], m.vertexRefs[2]]);
        break;
      case 'midPlane':
        this.datumPlaneRefA.set(m.planeRefA);
        this.datumPlaneRefB.set(m.planeRefB);
        break;
      case 'lineAndPerpFace':
        this.datumPlaneEdge.set(m.edgeRef);
        this.datumPlaneRefA.set(m.planeRef);
        break;
      case 'pointAndPerpEdge':
        this.datumPlaneVertices.set([m.vertexRef]);
        this.datumPlaneEdge.set(m.edgeRef);
        break;
      case 'tangentCylinder':
        this.datumPlaneCylinderFaceId.set(m.cylinderFaceId);
        this.datumPlaneRefA.set(m.planeRef);
        this.datumPlaneFlipped.set(m.flipped === true);
        break;
    }
    this.datumPlaneSidebar.set({ method: m.kind, editingFeatureId: feature.id });
    this._armDatumPlanePicks();
  }

  /** Re-open the Pattern sidebar populated with a Mirror / Linear /
   * Circular feature's state. REQ 658. */
  private _editPattern(
    feature: import('../../../cad/lib/types').MirrorFeatureFeature
          | import('../../../cad/lib/types').LinearPatternFeature
          | import('../../../cad/lib/types').CircularPatternFeature,
  ) {
    this._resetPatternInputs();
    if (feature.type === 'mirror') {
      this.patternPlaneRef.set(feature.planeRef);
      if (feature.planeRef.kind === 'datum') {
        this.patternPlaneDatumOption.set(feature.planeRef.datumId);
      }
      this.facePickMode.set(true);
    } else if (feature.type === 'linearPattern') {
      const d1 = feature.direction1;
      if (d1.axisRef.kind === 'originAxis') this.patternDir1AxisId.set(d1.axisRef.axisId);
      this.patternDir1Spacing.set(d1.spacing);
      this.patternDir1SpacingExpression.set(this.featureEquation(`feature.${feature.id}.direction1.spacing`));
      this.patternDir1Count.set(d1.count);
      this.patternDir1CountExpression.set(this.featureEquation(`feature.${feature.id}.direction1.count`));
      this.patternDir1Flipped.set(d1.flipped === true);
      const d2 = feature.direction2;
      if (d2) {
        this.patternDir2Enabled.set(true);
        if (d2.axisRef.kind === 'originAxis') this.patternDir2AxisId.set(d2.axisRef.axisId);
        this.patternDir2Spacing.set(d2.spacing);
        this.patternDir2SpacingExpression.set(this.featureEquation(`feature.${feature.id}.direction2.spacing`));
        this.patternDir2Count.set(d2.count);
        this.patternDir2CountExpression.set(this.featureEquation(`feature.${feature.id}.direction2.count`));
        this.patternDir2Flipped.set(d2.flipped === true);
      }
    } else if (feature.type === 'circularPattern') {
      if (feature.axisRef.kind === 'originAxis') this.patternCircAxisId.set(feature.axisRef.axisId);
      this.patternCircCount.set(feature.count);
      this.patternCircCountExpression.set(this.featureEquation(`feature.${feature.id}.count`));
      this.patternCircMode.set(feature.mode);
      this.patternCircAngleDeg.set(feature.angleDeg);
      this.patternCircAngleExpression.set(this.featureEquation(`feature.${feature.id}.angle`));
      this.patternCircFlipped.set(feature.flipped === true);
    }
    this.patternSidebar.set({ kind: feature.type, editingFeatureId: feature.id });
  }

  // REQ 626 — if the right-clicked feature is part of the current selection
  // (size > 1), batch the action across the whole selection. Otherwise act
  // on just the clicked feature and leave the selection alone.
  private batchTargets(featureId: string): string[] {
    const sel = this.selectedFeatures();
    return sel.has(featureId) && sel.size > 1 ? Array.from(sel) : [featureId];
  }

  private deleteFeature(featureId: string) {
    const ids = this.batchTargets(featureId);
    let tree = this.featureTree();
    for (const id of ids) {
      const f = tree.features.find(ft => ft.id === id);
      if (!f || f.type === 'origin') continue;  // REQ 607: origin not deletable
      tree = removeFeature(tree, id);
    }
    this.featureTree.set(tree);
    this.selectedFeatures.set(new Set());
    this.save();
  }

  private toggleFeatureVisibility(featureId: string) {
    const ids = this.batchTargets(featureId);
    // Anchor the new visibility off the right-clicked feature's current state
    // so every batch member ends in the same visibility (intuitive bulk toggle).
    const anchor = this.featureTree().features.find(f => f.id === featureId);
    if (!anchor || anchor.type === 'origin') return;
    const nextVisible = anchor.visible === false;
    let tree = this.featureTree();
    for (const id of ids) {
      const f = tree.features.find(ft => ft.id === id);
      if (!f || f.type === 'origin') continue;
      tree = updateFeatureParam<ExtrudeFeature>(tree, id, { visible: nextVisible });
    }
    this.featureTree.set(tree);
    this.save();
  }

  /** SolidWorks-style suppression. Skips the feature entirely in regen
   * (distinct from hiding which only affects rendering). Bulk applies
   * when the right-clicked feature is part of a multi-select. */
  private toggleFeatureSuppression(featureId: string) {
    const ids = this.batchTargets(featureId);
    const anchor = this.featureTree().features.find(f => f.id === featureId);
    if (!anchor || anchor.type === 'origin') return;
    const nextSuppressed = !((anchor as ExtrudeFeature).suppressed === true);
    let tree = this.featureTree();
    for (const id of ids) {
      const f = tree.features.find(ft => ft.id === id);
      if (!f || f.type === 'origin') continue;
      tree = updateFeatureParam<ExtrudeFeature>(tree, id, { suppressed: nextSuppressed });
    }
    this.featureTree.set(tree);
    this.save();
  }

  editSketch(sketchId: string) {
    const sketch = this.doc().sketches[sketchId];
    if (!sketch) return;
    // Force the sketch visible while editing. Save the pre-edit
    // visibility so onExitSketch can restore it — users frequently
    // hide a sketch after the parent feature is created, but still
    // need to see it while editing. Transient + per-editor-session.
    this._sketchVisibilityBeforeEdit = {
      sketchId,
      wasVisible: sketch.visible !== false,
    };
    if (sketch.visible === false) {
      this.doc.set(setSketchVisibility(this.doc(), sketchId, true));
    }
    this.activeSketchId.set(sketchId);
    this.setMode('idle');
  }

  /** Pre-edit visibility snapshot — see editSketch / onExitSketch. */
  private _sketchVisibilityBeforeEdit: { sketchId: string; wasVisible: boolean } | null = null;

  /** Per-(featureId,bodyId) hash map of the last body state we
   * actually applied to `perBodyGeometry`. Lets us drop redundant
   * cache-hit feature-result events from the regen stream — the
   * geometry didn't change, no point rebuilding meshes. Not cleared
   * between regen passes: a feature whose paramHash genuinely changed
   * arrives with a new hash and applies normally; cache-hit re-emits
   * keep their old hash and silently no-op. */
  private _lastEmittedBodyHashes = new Map<string, string>();

  /** Saved rollback bar position while an edit sidebar is open. Set
   * to `undefined` outside of edit mode; carries the user's pre-edit
   * value while editing so the restore-on-exit effect can put it back.
   * `null` (no prior bar) is a meaningful saved value. */
  private _savedRollbackForEdit: number | null | undefined = undefined;

  /** Computed: which feature index the rollback bar should sit at while
   * the user is editing something. Returns null when no edit sidebar
   * is open and no sketch is being edited (rollback stays user-driven).
   *
   * - Editing a feature → bar drops AFTER that feature (so the user
   *   sees the feature being edited but no downstream features).
   * - Editing a sketch → bar drops BEFORE the first feature that
   *   consumes the sketch (so the user sees the model state the
   *   sketch is layered onto without the consuming feature or any
   *   downstream features). Sketches not consumed by any feature
   *   leave the bar alone.
   */
  editRollbackTarget = computed<number | null>(() => {
    const features = this.featureTree().features;
    // Sketch edit — find the consumer feature index.
    const sid = this.activeSketchId();
    if (sid) {
      const idx = features.findIndex(f => {
        switch (f.type) {
          case 'extrude':
          case 'cutExtrude':
          case 'revolve':
          case 'cutRevolve':
            return (f as any).sketchId === sid;
          case 'sweep':
          case 'cutSweep':
            return (f as any).profileSketchId === sid || (f as any).pathSketchId === sid;
          case 'loft':
            return Array.isArray((f as any).sketchIds) && (f as any).sketchIds.includes(sid);
          default:
            return false;
        }
      });
      return idx >= 0 ? idx : null;
    }
    // Feature edit — read editingFeatureId off whichever sidebar owns
    // it. Each sidebar uses the same field name when in edit mode.
    const editingId =
      this.extrudeSidebar()?.editingFeatureId ??
      this.revolveSidebar()?.editingFeatureId ??
      this.sweepSidebar()?.editingFeatureId ??
      this.edgeBlendSidebar()?.editingFeatureId ??
      this.datumPlaneSidebar()?.editingFeatureId ??
      this.datumAxisSidebar()?.editingFeatureId ??
      this.datumPointSidebar()?.editingFeatureId ??
      this.patternSidebar()?.editingFeatureId ??
      this.shellSidebar()?.editingFeatureId ??
      this.combineSidebar()?.editingFeatureId ??
      this.holeSidebar()?.editingFeatureId ??
      this.mirrorBodySidebar()?.editingFeatureId ??
      this.moveCopyBodySidebar()?.editingFeatureId ?? null;
    if (editingId) {
      const idx = features.findIndex(f => f.id === editingId);
      if (idx < 0) return null;
      // Pattern + Shell edits need the edited feature EXCLUDED from
      // the displayed geometry — otherwise the live preview / face
      // picks reference the already-modified body, which produces
      // "pattern of a pattern" (REQ 658) or makes it impossible to
      // pick the un-shelled cap (REQ 659). Other feature kinds keep
      // the legacy include-self behavior (rollback at idx+1) so the
      // user still sees the saved feature's effect while tweaking.
      const feature = features[idx];
      const isBodyModifier = feature && (
        feature.type === 'mirror' ||
        feature.type === 'linearPattern' ||
        feature.type === 'circularPattern' ||
        feature.type === 'shell' ||
        feature.type === 'combine' ||
        feature.type === 'mirrorBody' ||
        feature.type === 'moveCopyBody'
      );
      return isBodyModifier ? idx : idx + 1;
    }
    return null;
  });

  private requestDeleteSketch(sketchId: string) {
    const ids = this.batchSketchTargets(sketchId);
    // Collect every dependent feature across the whole delete batch — one
    // warning dialog for the lot, not N dialogs that the user has to dismiss
    // one by one.
    const features = this.featureTree().features;
    const dependents = features
      .filter((f): f is ExtrudeFeature => (f.type === 'extrude' || f.type === 'cutExtrude' || f.type === 'revolve' || f.type === 'cutRevolve') && ids.includes((f as ExtrudeFeature).sketchId))
      .map(f => f.id);
    if (dependents.length === 0) {
      // No references — just delete all selected.
      for (const id of ids) this.applySketchDelete(id, 'break');
      this.selectedSketches.set(new Set());
      return;
    }
    const ref = this.dialog.open(SketchDeleteWarningDialogComponent, {
      data: { sketchId, dependentFeatureIds: dependents },
      width: '420px',
    });
    ref.afterClosed().subscribe((choice: SketchDeleteAction | null) => {
      if (!choice || choice === 'cancel') return;
      for (const id of ids) this.applySketchDelete(id, choice);
      this.selectedSketches.set(new Set());
    });
  }

  /** Open the equations panel. Every commit inside the dialog pushes
   * the new doc back via the onChange callback; the parent's save()
   * is debounced so rapid edits batch into a single PATCH+regen. */
  openEquationsPanel(): void {
    if (this.readonly()) return;
    this.dialog.open(CadEquationsPanelComponent, {
      data: {
        doc: this.equations(),
        onChange: (next: EquationDoc) => {
          this.equations.set(next);
          this.save();
        },
      },
      width: '720px',
      maxHeight: '85vh',
    });
  }

  /** Bind a feature parameter to an equation (or unbind it). Called by
   * the dim-input components when the user commits an `=expr` entry or
   * clears it. `target` is the equations-doc key (e.g.
   * `feature.f20.distance`); expression=null removes the entry. */
  setFeatureEquation(target: string, expression: string | null): void {
    const next = expression === null
      ? removeEquation(this.equations(), target)
      : setEquation(this.equations(), target, expression);
    this.equations.set(next);
  }

  /** Returns the expression currently bound to a target key, or null
   * if the target isn't equation-driven. Used by dim-input templates
   * to populate their `expression` input. */
  featureEquation(target: string): string | null {
    return this.equations().entries[target]?.expression ?? null;
  }

  private applySketchDelete(sketchId: string, action: 'cascade' | 'break') {
    // If we're currently editing the sketch we're about to delete, exit sketch mode.
    if (this.activeSketchId() === sketchId) this.activeSketchId.set(null);
    this.doc.set(deleteSketch(this.doc(), sketchId));
    if (action === 'cascade') {
      this.featureTree.set(removeFeaturesReferencingSketch(this.featureTree(), sketchId));
    }
    this.save();
  }

  private loadModel(id: number) {
    this.loading.set(true);
    this.cadApi.getById(id).subscribe({
      next: m => this.bootstrap(m),
      error: err => { this.loading.set(false); this.errors.showError(err?.error?.error || 'Failed to load CAD model'); },
    });
  }

  private loadActive() {
    const pid = this.partID();
    if (!pid) return;
    this.loading.set(true);
    this.cadApi.getActiveByPart(pid).subscribe({
      next: m => this.bootstrap(m),
      error: err => {
        this.loading.set(false);
        if (err?.status === 404) {
          this.router.navigate(['../'], { relativeTo: this.route });
        } else {
          this.errors.showError(err?.error?.error || 'Failed to load CAD model');
        }
      },
    });
  }

  private bootstrap(m: CadModel) {
    this.model.set(m);
    // Apply the loopIndices → regionIndices rename to any saved ExtrudeFeature.
    this.featureTree.set(migrateFeatureTree(m.featureTree as FeatureTree));
    // REQ 565: legacy SketchDocument blobs are auto-upgraded to the entity model on load.
    this.doc.set(migrateSketchDocument(m.sketchDoc as SketchDocument));
    // REQ 635: equations are optional on legacy models (column added in
    // a migration; rows from before the bump have the default {entries:{}}).
    this.equations.set(
      m.equations && typeof m.equations === 'object' && (m.equations as EquationDoc).entries
        ? (m.equations as EquationDoc)
        : { entries: {} },
    );
    this.activeSketchId.set(null);
    this.setMode('idle');
    this.loading.set(false);
    // Seed history with the loaded state so undo can return to "as
    // opened" without going past it. Reset to a fresh stack so models
    // loaded into the same component instance don't inherit each other's
    // history.
    this.history.set({
      snapshots: [{ featureTree: this.featureTree(), doc: this.doc() }],
      index: 0,
    });
    // Phase 1.5 — subscribe to the streaming session for per-feature events.
    // The HTTP regenerate stays the authoritative trigger + fallback; the
    // stream just paints each feature as soon as the kernel finishes it.
    if (!this.streamSub) {
      this.streamSub = this.stream.events$.subscribe((ev) => this.onStreamEvent(ev));
    }
    this.stream.subscribeToModel(m.id);
    // Load the model's commit history + branches for the VCS panels.
    this.loadCommits();
    this.loadBranches();
    // Kick the initial regeneration so the cached/freshly-built faces render.
    this.regenerate();
  }

  // Per-feature streaming handler. Replaces the feature's faces in the
  // geometry signal as the kernel completes each one. `regenerate-started`
  // wipes prior faces for *this* regen pass; `regenerate-complete` is
  // informational (HTTP response is the canonical end-of-regen confirmation).
  private onStreamEvent(ev: CadStreamEvent) {
    if (ev.type === 'regenerate-started') {
      this.regenStreamedCount.set(0);
      return;
    }
    if (ev.type === 'feature-result') {
      this.regenStreamedCount.update(n => n + 1);
      // Sync per-feature error state as it streams in so the tree's red
      // icon updates feature-by-feature rather than waiting for HTTP.
      if (ev.error) {
        const m = new Map(this.featureErrors());
        m.set(ev.featureId, friendlyError(ev.error));
        this.featureErrors.set(m);
      } else if (this.featureErrors().has(ev.featureId)) {
        // Previously errored, now succeeded — clear it.
        const m = new Map(this.featureErrors());
        m.delete(ev.featureId);
        this.featureErrors.set(m);
      }
      // Multi-body pipeline: each event reports the latest state of the
      // body this feature contributed to. Update that body's slot in
      // perBodyGeometry and rebuild the merged geometry.
      if (ev.error) {
        console.warn('[stream] feature', ev.featureId, ev.error);
        return;
      }
      const bodyId = (ev as any).bodyId as string | null;
      if (!bodyId || (ev.faces || []).length === 0) return;
      // Honour the rollback bar — drop events for features past the bar.
      const cutoff = this.rollbackBeforeIndex();
      if (cutoff !== null) {
        const evIdx = this.featureTree().features.findIndex(f => f.id === ev.featureId);
        if (evIdx >= 0 && evIdx >= cutoff) return;
      }
      // Skip redundant updates: when the backend re-emits a feature's
      // result on a cache-hit regen, the body's paramHash is identical
      // to what we last rendered. Avoiding the perBodyGeometry update
      // also avoids the downstream geometry rebuild + viewer mesh
      // recreation. Trade-off: we keep a per-feature-per-body hash
      // map in memory (~50 entries even for huge parts — cheap).
      const evHash = (ev as any).bodyParamHash as string | undefined;
      if (evHash) {
        const key = `${ev.featureId}|${bodyId}`;
        if (this._lastEmittedBodyHashes.get(key) === evHash) return;
        this._lastEmittedBodyHashes.set(key, evHash);
      }
      const newFaces = (ev.faces || []).map(face => ({
        faceId: face.faceId,
        positions: new Float32Array(face.positions),
        normals: new Float32Array(face.normals),
        indices: new Uint32Array(face.indices),
        featureId: ev.featureId,
        isFlat: face.isFlat,
        boundaryEdgeIds: face.boundaryEdgeIds,
      }));
      const incomingTopo = ev.topology || { vertices: [], edges: [] };
      const nextMap = new Map(this.perBodyGeometry());
      nextMap.set(bodyId, {
        faces: newFaces,
        topology: { vertices: incomingTopo.vertices ?? [], edges: incomingTopo.edges ?? [] },
      });
      this.perBodyGeometry.set(nextMap);
      // Make sure the body roster has this id even if the WS arrives
      // before the HTTP body list does. Name stays null until HTTP fills.
      if (!this.bodies().some(b => b.id === bodyId)) {
        this.bodies.set([...this.bodies(), { id: bodyId, name: null }]);
      }
      this.rebuildGeometryFromBodies();
    }
  }

  /** Rebuild the flat geometry signal from per-body state + visibility.
   * Called whenever perBodyGeometry or hiddenBodies changes (streaming
   * event, HTTP regen completion, user toggling body visibility). */
  private rebuildGeometryFromBodies(): void {
    const perBody = this.perBodyGeometry();
    const hidden = this.hiddenBodies();
    const faces: any[] = [];
    const vertices: ModelTopology['vertices'] = [];
    const edges: ModelTopology['edges'] = [];
    // Iterate bodies in roster order so face render order is stable.
    for (const body of this.bodies()) {
      if (hidden.has(body.id)) continue;
      const slot = perBody.get(body.id);
      if (!slot) continue;
      faces.push(...slot.faces);
      vertices.push(...slot.topology.vertices);
      edges.push(...slot.topology.edges);
    }
    const prev = this.geometry();
    this.geometry.set({
      datums: prev?.datums ?? [],
      faces,
      topology: { vertices, edges },
    });
  }

  /** SolidWorks-style rollback bar. Drops the bar before the given
   * feature index — everything from that index onward is suppressed
   * from the rendered model. `null` rolls forward to the end (no bar).
   *
   * Re-derives perBodyGeometry from the cached regen response,
   * filtering to features whose tree-index < bar position, and for each
   * body keeping only the LAST surviving feature's emission. */
  setRollbackBeforeIndex(idx: number | null): void {
    this.rollbackBeforeIndex.set(idx);
    // Cache-derived rebuild paints the new state instantly (no kernel
    // round-trip). The regen kick that follows tells the backend the
    // new bar position so it skips features past it on this and future
    // passes — important for slow features whose kernel work we don't
    // want to repeat just because we briefly scrubbed the bar past them.
    this._rederivePerBodyFromCache();
    this.regenerate();
  }

  /** Convenience helper — opens the menu's "Roll back to here" action. */
  rollBackBeforeFeature(featureId: string): void {
    const idx = this.featureTree().features.findIndex(f => f.id === featureId);
    if (idx < 0) return;
    this.setRollbackBeforeIndex(idx);
  }

  /** Convenience helper — opens the menu's "Roll forward to end". */
  rollForwardToEnd(): void {
    this.setRollbackBeforeIndex(null);
  }

  private _rederivePerBodyFromCache(): void {
    const features = this.latestRegenFeatures();
    if (features.length === 0) return;
    const treeFeatures = this.featureTree().features;
    const featureIndexById = new Map<string, number>();
    treeFeatures.forEach((f, i) => featureIndexById.set(f.id, i));
    const cutoff = this.rollbackBeforeIndex();
    const perBody = new Map<string, { faces: any[]; topology: ModelTopology }>();
    for (const f of features) {
      if (f.error) continue;
      const treeIdx = featureIndexById.get(f.featureId);
      if (treeIdx === undefined) continue;
      if (cutoff !== null && treeIdx >= cutoff) continue;
      if (!f.bodyId || (f.faces || []).length === 0) continue;
      perBody.set(f.bodyId, {
        faces: f.faces,
        topology: f.topology ?? { vertices: [], edges: [] },
      });
    }
    this.perBodyGeometry.set(perBody);
    // Bodies that have no surviving feature drop out of the roster
    // (their root feature was rolled back).
    this.bodies.set(this.bodies().filter(b => perBody.has(b.id)));
    this.rebuildGeometryFromBodies();
  }

  /** Toggle the visibility of a body in the Bodies panel. Transient
   * (lost on reload) — body visibility isn't persisted yet. */
  toggleBodyVisibility(bodyId: string): void {
    const next = new Set(this.hiddenBodies());
    if (next.has(bodyId)) next.delete(bodyId); else next.add(bodyId);
    this.hiddenBodies.set(next);
    this.rebuildGeometryFromBodies();
  }

  /** Hide every body except this one. Transient. Re-isolating shows all. */
  onIsolateBody(bodyId: string): void {
    const allIds = this.bodies().map(b => b.id);
    const current = this.hiddenBodies();
    const isolated = new Set(allIds.filter(id => id !== bodyId));
    // If we're already isolated to this body, restore all visible.
    const restoringAll = current.size === isolated.size &&
      [...current].every(id => isolated.has(id));
    this.hiddenBodies.set(restoringAll ? new Set() : isolated);
    this.rebuildGeometryFromBodies();
  }

  /** Delete every feature that contributed to this body. Body id == the
   * root additive feature's id; we drop that one PLUS every subsequent
   * feature whose target body resolves to the same id (i.e. merge=true
   * additive + any cut feature, until a merge=false feature splits the
   * chain). For now we use the simpler rule: drop the root feature AND
   * all features after it in the tree — that mirrors how the backend
   * builds bodies in regen order. Drastic; survives undo. */
  onDeleteBody(bodyId: string): void {
    const ok = window.confirm(
      'Delete this body? This removes the root feature and every feature ' +
      'after it that contributed to it. Cannot be undone without redo.',
    );
    if (!ok) return;
    const tree = this.featureTree();
    const rootIdx = tree.features.findIndex(f => f.id === bodyId);
    if (rootIdx < 0) return;
    // Drop the root + everything after it. Conservative but matches the
    // backend's "subsequent merge=true features extend the latest body"
    // semantic — there's no clean way to tell which features after the
    // root targeted THIS body vs. a later one without re-running the
    // regen, so the safe move is "everything from root onward".
    const next = {
      ...tree,
      features: tree.features.slice(0, rootIdx),
    };
    this.featureTree.set(next);
    this.save();
  }

  private debouncedSave: number | null = null;
  /** Persist current state with a 500ms debounce. On success, optionally
   * trigger a kernel regen (default true). Two reasons to opt out:
   *   1. Caller already ran an immediate regen and doesn't want a
   *      second, slightly-later one (undo/redo, sidebar commits that
   *      pair with the auto-rollback effect).
   *   2. The change is frontend-only (datum-plane reference geometry,
   *      sketch/datum visibility flags) — kernel produces identical
   *      output, so the call is purely a cache-hash walk.
   * Multiple in-flight save calls coalesce into the last one's
   * regen behaviour via the debounce clear+reset.
   */
  private save(opts?: { skipRegen?: boolean }) {
    const m = this.model();
    if (!m) return;
    const skipRegen = opts?.skipRegen === true;
    if (this.debouncedSave) clearTimeout(this.debouncedSave);
    this.debouncedSave = window.setTimeout(() => {
      this.cadApi.update(m.id, {
        featureTree: this.featureTree(),
        sketchDoc: this.doc(),
        equations: this.equations(),
      }).subscribe({
        next: updated => {
          this.model.set(updated);
          // Regen is skipped while the user is inside a sketch — the
          // model's body geometry can't change from sketch edits alone
          // (only sketch state changes; the body that consumes it
          // hasn't been re-evaluated yet). onExitSketch() calls save()
          // again with activeSketchId === null, which is when the
          // accumulated sketch changes propagate to the kernel.
          if (skipRegen) return;
          if (this.activeSketchId() === null) this.regenerate();
        },
        error: err => this.errors.showError(err?.error?.error || 'Save failed'),
      });
    }, 500);
  }

  // Phase 1 — call the server-side regenerate endpoint and merge the
  // returned per-feature face meshes into the geometry signal. Older
  // in-flight regens are dropped by `regenGeneration` so a stale response
  // can't overwrite a newer one.
  private regenerate() {
    const m = this.model();
    if (!m) return;
    const genId = ++this.regenGeneration;
    this.regenLoading.set(true);
    this.regenError.set(null);
    // Seed the progress counters from the current featureTree so the HUD
    // shows accurate "feature X of N" right away. Origin and hidden
    // features are excluded — they're skipped by the regen service.
    const expectedFeatures = this.featureTree().features.filter(
      f => f.type !== 'origin' && f.visible !== false,
    ).length;
    this.regenExpectedCount.set(expectedFeatures);
    this.regenStreamedCount.set(0);
    this.featureErrors.set(new Map());
    // Pass the rollback bar so the backend skips features past it — no
    // kernel work, no cache lookups. Default null = process all features.
    this.cadApi.regenerate(m.id, this.rollbackBeforeIndex()).subscribe({
      next: (resp) => {
        if (genId !== this.regenGeneration) return;
        this.regenLoading.set(false);
        // Multi-body pipeline: each feature reports its target body's
        // latest state. Cache the full response so the rollback bar
        // (transient, client-side) can re-derive per-body geometry by
        // dropping features above its cutoff without a kernel round-trip.
        const cachedFeatures = resp.features
          .filter(f => !f.error)
          .map(f => ({
            featureId: f.featureId,
            bodyId: (f as any).bodyId as string | null,
            faces: (f.faces || []).map(face => ({
              faceId: face.faceId,
              positions: new Float32Array(face.positions),
              normals: new Float32Array(face.normals),
              indices: new Uint32Array(face.indices),
              featureId: f.featureId,
              isFlat: face.isFlat,
              boundaryEdgeIds: face.boundaryEdgeIds,
            })),
            topology: {
              vertices: f.topology?.vertices ?? [],
              edges: f.topology?.edges ?? [],
            },
            error: f.error,
            cached: f.cached,
          }));
        this.latestRegenFeatures.set(cachedFeatures);
        // For each body, take the LAST surviving feature's emission as
        // the body's current state. Honour the active rollback bar.
        const treeFeatures = this.featureTree().features;
        const indexById = new Map<string, number>();
        treeFeatures.forEach((f, i) => indexById.set(f.id, i));
        const cutoff = this.rollbackBeforeIndex();
        const perBody = new Map<string, { faces: any[]; topology: ModelTopology }>();
        for (const cf of cachedFeatures) {
          if (!cf.bodyId) continue;
          const ti = indexById.get(cf.featureId);
          if (ti === undefined) continue;
          if (cutoff !== null && ti >= cutoff) continue;
          perBody.set(cf.bodyId, { faces: cf.faces, topology: cf.topology });
        }
        this.perBodyGeometry.set(perBody);
        const rosterFromResp = resp.bodies ?? Array.from(perBody.keys()).map(id => ({ id, name: null }));
        this.bodies.set(rosterFromResp.filter(b => perBody.has(b.id)));
        this.rebuildGeometryFromBodies();
        // Per-feature errors are nested in the merged response. Surface them
        // as warning toasts so the user sees what failed and why — silent
        // console.warns don't reach the user. De-dupe identical messages so
        // one bad sketch doesn't spam the toaster.
        const seen = new Set<string>();
        for (const err of resp.errors || []) {
          const friendly = friendlyError(err);
          if (seen.has(friendly)) continue;
          seen.add(friendly);
          this.errors.showWarning(friendly);
        }
        // Build the per-feature error map from the response so the tree can
        // show a red icon on each broken feature. WS may have already
        // populated this incrementally — overwrite with the HTTP truth for
        // consistency.
        const errMap = new Map<string, string>();
        for (const f of resp.features) {
          if (f.error) errMap.set(f.featureId, friendlyError(f.error));
        }
        this.featureErrors.set(errMap);
      },
      error: (err) => {
        if (genId !== this.regenGeneration) return;
        this.regenLoading.set(false);
        const msg = err?.error?.error || err?.message || 'Regenerate failed';
        const friendly = friendlyError(msg);
        this.regenError.set(friendly);
        this.errors.showError(friendly);
      },
    });
  }

  // ── dimension inline-edit handlers ────────────────────────────────────
  /** Smart Dim just placed a dimension — open the inline editor on it. */
  onDimensionCreated(constraintId: string) {
    this.editingDimensionId.set(constraintId);
  }

  /** Single-click on a dimension label — select it (don't open editor).
   * Selected state is visible (orange + bold) and enables Delete-key
   * removal. To edit the value, the user double-clicks. */
  onDimensionLabelClicked(constraintId: string) {
    this.selectedConstraintId.set(constraintId);
    this.editingDimensionId.set(null);
    // Selecting a dimension drops other selections so Delete-key intent
    // is unambiguous (only the dim is up for deletion).
    this.selectedFeatures.set(new Set());
    this.selectedSketches.set(new Set());
  }

  /** Double-click on a dimension label — open the inline value editor. */
  onDimensionDoubleClicked(constraintId: string) {
    this.selectedConstraintId.set(null);
    this.editingDimensionId.set(constraintId);
  }

  /** Inline editor committed a string the user typed (raw text). Parses
   * the value + optional unit suffix, normalizes to mm for storage, then
   * runs the minimum-change solver and saves.
   *
   * Length constraints: bare number → defaultUnit; "10in" / "10\"" /
   * "0.5 in" → inches; "200um" / "200 µm" → micrometers; "10mm" → mm. If
   * the user typed a unit other than defaultUnit, the dim remembers it as
   * its per-dim override so future renders show the suffix.
   *
   * Angle: always degrees → radians for storage. Unit doesn't apply. */
  async onDimensionCommitted(ev: { id: string; raw: string }) {
    const sid = this.activeSketchId();
    if (!sid) return;
    const sketch = this.doc().sketches[sid];
    if (!sketch) return;
    const c = sketch.state.constraints.find(c => c.id === ev.id);
    if (!c) return;

    const eqnKey = `sketch.${sid}.constraint.${ev.id}`;
    const raw = ev.raw.trim();
    let valueStored: number;
    let nextConstraintUnit: Unit | undefined = c.unit;

    if (raw.startsWith('=')) {
      // Expression mode — evaluate against the resolved equations
      // context. Successful evaluation persists the expression under
      // sketch.<sid>.constraint.<id> and stores the resolved numeric
      // value on the constraint so planegcs sees a plain number.
      const expr = raw.slice(1).trim();
      if (!expr) { this.editingDimensionId.set(null); return; }
      const r = evalExpression(expr, this.equationValues());
      if (r.error || r.value === undefined) {
        this.errors.showError(`Equation error: ${r.error || 'no value'}`);
        return;
      }
      // Angles in expressions are interpreted in DEGREES (matching the
      // sketch UI convention) but stored in radians like every other
      // angle constraint value. Linear dims are stored in mm with no
      // unit conversion — expressions don't carry unit suffixes.
      valueStored = c.type === 'angle' ? r.value * Math.PI / 180 : r.value;
      // Drop per-dim unit override when equation-driven — the
      // expression's resolved value is unitless (mm/deg implied).
      nextConstraintUnit = undefined;
      this.equations.set(setEquation(this.equations(), eqnKey, expr));
    } else if (c.type === 'angle') {
      const n = parseFloat(raw);
      if (!isFinite(n)) return;
      valueStored = n * Math.PI / 180;
      // Plain numeric entry clears any equation binding on this dim.
      if (this.equations().entries[eqnKey]) {
        this.equations.set(removeEquation(this.equations(), eqnKey));
      }
    } else {
      const parsed = parseUserValue(raw, this.defaultUnit());
      if (!parsed) return;
      valueStored = parsed.valueMm;
      // If the user typed an explicit unit (even matching defaultUnit),
      // remember it on the dim. If they typed a bare number, drop any
      // existing per-dim unit override (revert to default).
      nextConstraintUnit = parsed.unit ?? undefined;
      if (this.equations().entries[eqnKey]) {
        this.equations.set(removeEquation(this.equations(), eqnKey));
      }
    }

    let updated = setConstraintValue(sketch.state, ev.id, valueStored);
    updated = {
      ...updated,
      constraints: updated.constraints.map(cc => cc.id === ev.id
        ? { ...cc, unit: nextConstraintUnit }
        : cc),
    };
    // Chain propagation: when the user edits a dim that belongs to a
    // constraint group (chainId — emitted by offset to keep all its
    // hidden sibling dims in lockstep), push the same value to every
    // other constraint in the group. Without this, the hidden dims
    // keep their original value, the solver becomes inconsistent,
    // and the offset stops tracking the source.
    const editedConstraint = updated.constraints.find(cc => cc.id === ev.id);
    const chainGroupId = editedConstraint?.chainId;
    if (chainGroupId) {
      // For line distance siblings, copy the new value verbatim. For
      // radius siblings (offset arcs), the stored value is
      // `source_radius ± offset_distance` — recompute it from the
      // matching concentric's source arc + the offset's current
      // direction (inward = source > offset, outward = offset > source).
      // Without this the visible 9mm dim wouldn't drive arc radii and
      // the offset would visually decouple from the dim value.
      updated = {
        ...updated,
        constraints: updated.constraints.map(cc => {
          if (cc.chainId !== chainGroupId || cc.id === ev.id) return cc;
          if (cc.value === undefined) return cc;
          if (cc.type === 'radius') {
            const offsetArcId = cc.targets[0]?.entityId;
            if (!offsetArcId) return cc;
            const concentric = updated.constraints.find(other =>
              other.chainId === chainGroupId && other.type === 'concentric' &&
              other.targets.some(t => t.entityId === offsetArcId),
            );
            if (!concentric) return cc;
            const srcId = concentric.targets.find(t => t.entityId !== offsetArcId)?.entityId;
            const srcArc = updated.entities.find(e => e.id === srcId);
            if (!srcArc || (srcArc.kind !== 'arc' && srcArc.kind !== 'circle')) return cc;
            const sign = cc.value > srcArc.radius ? 1 : -1;
            const newRadius = srcArc.radius + sign * valueStored;
            return { ...cc, value: newRadius, unit: nextConstraintUnit };
          }
          return { ...cc, value: valueStored, unit: nextConstraintUnit };
        }),
      };
    }
    const result = await solveSketchAfterAdd(updated, ev.id);
    const final = result.status === 'ok' ? result.state : updated;
    this.doc.set(updateSketchState(this.doc(), sid, final));
    this.editingDimensionId.set(null);
    this.save();
  }

  /** Esc or click-outside in the inline editor — just clear the editing
   * state, the constraint keeps its prior value. */
  onDimensionCanceled() {
    this.editingDimensionId.set(null);
  }

  /** Click on a mini constraint badge → SELECT the constraint (don't
   * delete). The selection highlights the matching row in the constraint
   * list and lights up the badge itself; pressing Delete on a selected
   * constraint removes it. To remove via mouse the user clicks the X
   * button in the constraint-list panel. */
  onConstraintIconClicked(constraintId: string) {
    this.selectedConstraintId.set(constraintId);
    // Make selection intent unambiguous — clear other selections so the
    // Delete key targets only the picked constraint.
    this.selectedFeatures.set(new Set());
    this.selectedSketches.set(new Set());
  }

  /** Constraint-list row click — same selection semantics as a badge
   * click, but originating from the panel. */
  onConstraintListSelect(constraintId: string) {
    this.selectedConstraintId.set(constraintId);
    // Also push the constraint's target entities into the sketch
    // editor's selection so the viewer highlights them. SW shows the
    // constraint's geometry in orange when you click the constraint —
    // gives instant visual feedback for "which entities does this
    // apply to?". Resolving point-id targets to their parent entities
    // when the point belongs to a line / arc / circle (an arc's
    // `centerId`, a line's `startId`, etc.) — selecting the parent
    // entity highlights the whole shape, which reads better than a
    // single bare point.
    const sid = this.activeSketchId();
    if (!sid) return;
    const sketch = this.doc().sketches[sid];
    if (!sketch) return;
    const constraint = sketch.state.constraints.find(c => c.id === constraintId);
    if (!constraint) return;
    const targetIds = new Set<string>();
    const targetPointParents = new Map<string, string>();
    for (const e of sketch.state.entities) {
      if (e.kind === 'line') {
        targetPointParents.set(e.startId, e.id);
        targetPointParents.set(e.endId, e.id);
      } else if (e.kind === 'arc') {
        targetPointParents.set(e.startId, e.id);
        targetPointParents.set(e.endId, e.id);
        targetPointParents.set(e.centerId, e.id);
      } else if (e.kind === 'circle') {
        targetPointParents.set(e.centerId, e.id);
      }
    }
    for (const t of constraint.targets) {
      // Always include the raw target id (selecting a free point still
      // highlights the point). If it's a support-point owned by a
      // curve, ALSO include the curve so the user sees the whole
      // shape light up.
      targetIds.add(t.entityId);
      const parent = targetPointParents.get(t.entityId);
      if (parent) targetIds.add(parent);
    }
    const editor = this.sketchEditorRef();
    editor?.selected.set(targetIds);
  }

  /** Right-click on a dimension label — remove the constraint from the
   * active sketch and re-solve (without that constraint there may be
   * extra DOF, but the geometry is left as-is). */
  onDimensionDeleteRequested(constraintId: string) {
    if (this.readonly()) return;
    const sid = this.activeSketchId();
    if (!sid) return;
    const sketch = this.doc().sketches[sid];
    if (!sketch) return;
    const next = removeConstraint(sketch.state, constraintId);
    this.doc.set(updateSketchState(this.doc(), sid, next));
    // If the user was mid-edit on this dimension, clear that state too.
    if (this.editingDimensionId() === constraintId) this.editingDimensionId.set(null);
    this.save();
  }

  /** Dim label drag — update the constraint's placement so the dimension
   * line + extension lines follow the cursor. For 2-point LINEAR dims
   * (distance / horizontal-distance / vertical-distance), the dim TYPE
   * also follows the label: SW-style, dragging the label into the
   * "above/below" zone of the bbox switches to horizontal-distance, into
   * "left/right" switches to vertical-distance, and into the diagonal
   * zone switches back to minimum distance. The value is re-derived for
   * each type so the dim stays consistent with the geometry. Live
   * previews fire per pointermove without saving; `commit: true` fires
   * once on pointerup. */
  onDimensionDragged(ev: { id: string; placement: { x: number; y: number }; commit: boolean }) {
    const sid = this.activeSketchId();
    if (!sid) return;
    const sketch = this.doc().sketches[sid];
    if (!sketch) return;
    const next: SketchState = {
      ...sketch.state,
      constraints: sketch.state.constraints.map(c => {
        if (c.id !== ev.id) return c;
        // For 2-point linear dims, recompute the type from the label
        // placement and update the value to match the new type.
        const linear = c.type === 'distance' || c.type === 'horizontal-distance' || c.type === 'vertical-distance';
        if (linear && c.targets.length === 2) {
          const e0 = sketch.state.entities.find(en => en.id === c.targets[0].entityId);
          const e1 = sketch.state.entities.find(en => en.id === c.targets[1].entityId);
          if (e0?.kind === 'point' && e1?.kind === 'point') {
            const newType = chooseTwoPointDimType(e0, e1, ev.placement);
            const newValue = twoPointDimValue(e0, e1, newType);
            return { ...c, type: newType, value: newValue, placement: ev.placement };
          }
        }
        return { ...c, placement: ev.placement };
      }),
    };
    this.doc.set(updateSketchState(this.doc(), sid, next));
    if (ev.commit) this.save();
  }

  // ── constraint list panel handlers ────────────────────────────────────
  onRemoveConstraint(sketchId: string, constraintId: string) {
    if (this.readonly()) return;
    const sketch = this.doc().sketches[sketchId];
    if (!sketch) return;
    const next = removeConstraint(sketch.state, constraintId);
    this.doc.set(updateSketchState(this.doc(), sketchId, next));
    this.save();
  }

  onEditConstraint(sketchId: string, ev: { id: string; value: number; unit?: Unit | null }) {
    if (this.readonly()) return;
    const sketch = this.doc().sketches[sketchId];
    if (!sketch) return;
    let next = setConstraintValue(sketch.state, ev.id, ev.value);
    // Persist the unit override (null = clear) when the panel passed one.
    if ('unit' in ev) {
      const newUnit = ev.unit ?? undefined;
      next = {
        ...next,
        constraints: next.constraints.map(c => c.id === ev.id ? { ...c, unit: newUnit } : c),
      };
    }
    this.doc.set(updateSketchState(this.doc(), sketchId, next));
    this.save();
  }

  /** Apply `#{name}` substitution against the current `textVariables`
   * so the properties sidebar can show a live preview of what the
   * viewer will render. Mirrors the substitution in cad-viewer's
   * text renderer. */
  resolveTextPreview(raw: string): string {
    return this.textResolver()(raw ?? '');
  }
  /** Flat list of available text variables for the sidebar hint. */
  textVariableEntries = computed<Array<{ name: string; value: string }>>(() =>
    Object.entries(this.textVariables()).map(([name, value]) => ({ name, value })));

  /** REQ Batch 6 — Text entity property edit. Re-runs the solver
   * and saves the document the same way constraint edits do. */
  onSketchTextEdit(
    entityId: string,
    field: 'text' | 'size' | 'justify' | 'font' | 'mirror' | 'rotation',
    value: string | number,
  ): void {
    if (this.readonly()) return;
    const sid = this.activeSketchId();
    if (!sid) return;
    const sketch = this.doc().sketches[sid];
    if (!sketch) return;
    // Rotation moves the real box geometry, then re-solves so the construction
    // lines, dimensions and centerline follow — handled separately (async).
    if (field === 'rotation') {
      void this._rotateTextBox(sid, entityId, Number.isFinite(+value) ? +value : 0);
      return;
    }
    let patch: any;
    switch (field) {
      case 'size':
        patch = { size: Number.isFinite(+value) && +value > 0 ? +value : 1 };
        break;
      case 'justify':
        patch = { justify: (value === 'right' || value === 'center') ? value : 'left' };
        break;
      case 'font':
        patch = { font: value === 'singleLine' ? 'singleLine' : 'outline' };
        break;
      case 'mirror':
        patch = { mirror: !!+value };
        break;
      default:
        patch = { text: String(value) };
    }
    const next = updateTextEntity(sketch.state, entityId, patch);
    this.doc.set(updateSketchState(this.doc(), sid, next));
    this.save();
  }

  /** Rotate a text box's real geometry to an absolute angle, then re-solve so
   * the centerline midpoints re-pin and everything stays a rigid rectangle. */
  private async _rotateTextBox(sid: string, entityId: string, deg: number): Promise<void> {
    const sketch = this.doc().sketches[sid];
    if (!sketch) return;
    const rotated = rotateTextBox(sketch.state, entityId, deg);
    const solved = await solveSketch(rotated);
    this.doc.set(updateSketchState(this.doc(), sid, solved.state ?? rotated));
    this.save();
  }
  onSketchPictureEdit(entityId: string, field: 'width' | 'height' | 'rotation' | 'opacity', value: number): void {
    if (this.readonly()) return;
    const sid = this.activeSketchId();
    if (!sid) return;
    const sketch = this.doc().sketches[sid];
    if (!sketch) return;
    let v = +value;
    if (field === 'opacity') v = Math.max(0, Math.min(1, v));
    if ((field === 'width' || field === 'height') && !(v > 0)) v = 1;
    if (!Number.isFinite(v)) return;
    const next = updatePictureEntity(sketch.state, entityId, { [field]: v } as any);
    this.doc.set(updateSketchState(this.doc(), sid, next));
    this.save();
  }
  onSketchEquationEdit(entityId: string, field: 'xExpr' | 'yExpr' | 'tMin' | 'tMax' | 'samples', value: string | number): void {
    if (this.readonly()) return;
    const sid = this.activeSketchId();
    if (!sid) return;
    const sketch = this.doc().sketches[sid];
    if (!sketch) return;
    const patch: any = {};
    if (field === 'xExpr' || field === 'yExpr') patch[field] = String(value);
    else if (field === 'samples') patch.samples = Math.max(8, Math.min(2000, Math.floor(+value || 100)));
    else {
      const v = +value;
      if (!Number.isFinite(v)) return;
      patch[field] = v;
    }
    const next = updateEquationCurveEntity(sketch.state, entityId, patch);
    this.doc.set(updateSketchState(this.doc(), sid, next));
    this.save();
  }

  onBack() { this.router.navigate(['../'], { relativeTo: this.route }); }

  // Release the working copy as the Part's revision (commit + freeze + tag).
  onRelease() {
    const m = this.model(); if (!m) return;
    this.cadApi.release(m.id).subscribe({
      next: res => { this.model.set(res.model); this.loadCommits(); },
      error: err => this.errors.showError(err?.error?.error || 'Release failed'),
    });
  }

  // ── VCS: checkout / check-in / lock / history (Phase 1) ─────────────────────

  onCheckout() {
    const m = this.model(); if (!m) return;
    this.cadApi.checkout(m.id).subscribe({
      next: updated => this.model.set(updated),
      error: err => this.errors.showError(err?.error?.error || 'Checkout failed'),
    });
  }

  onCheckin() {
    const m = this.model(); if (!m) return;
    const message = window.prompt('Check-in message:', '');
    if (message === null) return; // cancelled
    this.cadApi.checkin(m.id, message).subscribe({
      next: res => { this.model.set(res.model); this.loadCommits(); },
      error: err => this.errors.showError(err?.error?.error || 'Check-in failed'),
    });
  }

  onReleaseLock() {
    const m = this.model(); if (!m) return;
    this.cadApi.releaseLock(m.id).subscribe({
      next: updated => this.model.set(updated),
      error: err => this.errors.showError(err?.error?.error || 'Release lock failed'),
    });
  }

  loadCommits() {
    const m = this.model(); if (!m) return;
    this.cadApi.getCommits(m.id).subscribe({
      next: list => this.commits.set(list),
      error: () => this.commits.set([]),
    });
  }

  toggleCommits() { this.showCommits.update(v => !v); }

  shortHash(h: string): string { return (h || '').slice(0, 8); }

  // ── VCS: variant branches + cherry-pick (Phase 2) ───────────────────────────

  currentBranch(): string { return this.model()?.branchName || 'main'; }
  toggleBranches() { this.showBranches.update(v => !v); }

  loadBranches() {
    const m = this.model(); if (!m) return;
    this.cadApi.listBranches(m.id).subscribe({
      next: list => this.branches.set(list),
      error: () => this.branches.set([]),
    });
  }

  onCreateBranch() {
    const m = this.model(); if (!m) return;
    const name = window.prompt('New branch name:', '');
    if (!name) return;
    this.cadApi.createBranch(m.id, name).subscribe({
      next: () => this.loadBranches(),
      error: err => this.errors.showError(err?.error?.error || 'Create branch failed'),
    });
  }

  onSwitchBranch(name: string) {
    const m = this.model(); if (!m || name === this.currentBranch()) return;
    this.cadApi.switchBranch(m.id, name).subscribe({
      next: updated => { this.bootstrap(updated); this.showBranches.set(false); },
      error: err => this.errors.showError(err?.error?.error || 'Switch branch failed'),
    });
  }

  onArchiveBranch(name: string) {
    const m = this.model(); if (!m) return;
    this.cadApi.archiveBranch(m.id, name).subscribe({
      next: () => this.loadBranches(),
      error: err => this.errors.showError(err?.error?.error || 'Archive branch failed'),
    });
  }

  onCherryPick() {
    const m = this.model(); if (!m) return;
    const sourceCommit = window.prompt('Source commit hash to cherry-pick from:', '');
    if (!sourceCommit) return;
    const featureId = window.prompt('Feature id to cherry-pick:', '');
    if (!featureId) return;
    this.cadApi.cherryPick(m.id, sourceCommit, featureId).subscribe({
      next: updated => { this.bootstrap(updated); this.loadBranches(); },
      error: err => this.errors.showError(err?.error?.error || 'Cherry-pick failed'),
    });
  }

  toggleFullscreen() {
    this.fullscreen.update(v => !v);
    this.uiState.fullscreen.set(this.fullscreen());
    this.router.navigate([], { relativeTo: this.route, queryParams: { fullscreen: this.fullscreen() ? '1' : null }, queryParamsHandling: 'merge', replaceUrl: true });
  }
}

/** Unique circle through three 2D points; null when collinear. Used by
 * Convert Entities arc projection on both create + re-projection. */
/** Compact number rendering for text-equation substitution.
 * Integer-valued numbers stay as integers; floats use up to 3 decimals
 * with trailing zeros stripped. */
function formatEquationNumber(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(3).replace(/\.?0+$/, '');
}

function _circumcircle2d(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): { cx: number; cy: number; radius: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const cx = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const cy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  const radius = Math.hypot(a.x - cx, a.y - cy);
  return { cx, cy, radius };
}
