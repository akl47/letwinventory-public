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
import { CadModel } from '../../../models/cad-model.model';
import { AuthService } from '../../../services/auth.service';
import { ErrorNotificationService } from '../../../services/error-notification.service';
import { CadStreamService, type CadStreamEvent } from '../../../services/cad-stream.service';
import { CadViewerComponent, type DisplayMode, type SketchPreview, type ProfileFill } from '../cad-viewer/cad-viewer.component';
import { CadFeatureTreePanelComponent, type FeatureTreeAction, type FeatureSelectEvent, type SketchSelectEvent } from '../cad-feature-tree-panel/cad-feature-tree-panel.component';
import { CadSketchEditorComponent } from '../cad-sketch-editor/cad-sketch-editor.component';
import { CadConstraintListComponent } from '../cad-constraint-list/cad-constraint-list.component';
import { SketchDeleteWarningDialogComponent, type SketchDeleteAction } from '../sketch-delete-warning-dialog/sketch-delete-warning-dialog.component';
import { projectTo3D } from '../../../cad/lib/plane';
import type { FeatureTree, SketchDocument, SketchId, ModelGeometry, ModelTopology, SketchState, ExtrudeFeature, ExtrudeEndCondition } from '../../../cad/lib/types';
import {
  emptyFeatureTree, addFeature, defaultDatumVisibility,
  removeFeature, updateFeatureParam, removeFeaturesReferencingSketch,
} from '../../../cad/lib/featureTree';
import { emptyDocument, createSketch, updateSketchState, deleteSketch, setSketchVisibility, setSketchName } from '../../../cad/lib/document';
import { removeConstraint, setConstraintValue } from '../../../cad/lib/store';
import { solveSketchAfterAdd } from '../../../cad/lib/solver';
import { parseUserValue, type Unit } from '../../../cad/lib/units';
import { migrateSketchDocument, migrateFeatureTree } from '../../../cad/lib/migration';
import { friendlyError } from '../../../cad/lib/errorMessages';
import { planeForDatum, buildOriginDatums } from '../../../cad/lib/datum';
import { inferLineEnd } from '../../../cad/lib/inference';
import { allCurveIntersections, angleInArcSweep } from '../../../cad/lib/geometry';
import { findPoint as findPt } from '../../../cad/lib/types';
import { computeFilletGeometry, computeChamferGeometry } from '../../../cad/lib/sketchEditOps';
import { chooseTwoPointDimType, twoPointDimValue } from '../../../cad/lib/dimensions';

/** Snap kinds. Drives the viewer's snap-indicator glyph: square for
 * endpoint (existing point), triangle for midpoint, X for intersection,
 * diamond for quadrant. */
type SnapKind = 'endpoint' | 'midpoint' | 'intersection' | 'quadrant';
import { extractRegions, tessellateProfileLoop } from '../../../cad/lib/profile';
import { environment } from '../../../../environments/environment';

type EditorMode = 'idle' | 'pick-plane' | 'pick-extrude-target';

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
  ],
  template: `
    <div class="cad-editor" [class.fullscreen]="fullscreen()" [attr.data-testid]="'cad-editor'">
      <div class="editor-header">
        <button mat-icon-button (click)="onBack()" matTooltip="Back to revisions">
          <mat-icon>arrow_back</mat-icon>
        </button>
        <span class="revision-badge" data-testid="revision-badge" *ngIf="model()">Rev {{ model()!.revision }}</span>
        <span class="state-badge"
              data-testid="state-badge"
              [class.draft]="model()?.releaseState==='draft'"
              [class.review]="model()?.releaseState==='review'"
              [class.released]="model()?.releaseState==='released'"
              *ngIf="model()">{{ model()!.releaseState }}</span>
        <span class="readonly-banner" data-testid="readonly-banner" *ngIf="readonly()">View only</span>

        <button mat-icon-button data-testid="action-undo"
                [disabled]="!canUndo() || readonly()"
                (click)="undo()"
                matTooltip="Undo (Ctrl+Z)">
          <mat-icon>undo</mat-icon>
        </button>
        <button mat-icon-button data-testid="action-redo"
                [disabled]="!canRedo() || readonly()"
                (click)="redo()"
                matTooltip="Redo (Ctrl+Y / Ctrl+Shift+Z)">
          <mat-icon>redo</mat-icon>
        </button>

        <!-- Kernel connection badge. Hidden when fully idle + connected so it
             doesn't clutter the header; surfaces only when something
             interesting is happening (streaming, disconnected, or actively
             regenerating). -->
        <span class="kernel-badge"
              data-testid="kernel-badge"
              *ngIf="regenLoading() || !stream.connected()"
              [class.streaming]="regenLoading() && stream.connected()"
              [class.disconnected]="!stream.connected()"
              [matTooltip]="kernelBadgeTooltip()">
          <span class="kernel-dot"></span>
          {{ kernelBadgeLabel() }}
        </span>

        <span class="spacer"></span>

        <!-- REQ 619 — display-mode picker. Session-only; default visible-edges. -->
        <mat-form-field appearance="outline" class="display-mode-field">
          <mat-select
              data-testid="display-mode-select"
              [value]="displayMode()"
              (selectionChange)="displayMode.set($event.value)"
              panelClass="display-mode-panel"
              matTooltip="Display mode">
            <mat-option value="visible-edges">Shaded, visible edges</mat-option>
            <mat-option value="hidden-dashed">Shaded, hidden dashed</mat-option>
            <mat-option value="all-edges">Shaded, all edges</mat-option>
            <mat-option value="wireframe-no-hidden">Wireframe (no hidden)</mat-option>
            <mat-option value="wireframe-hidden-dashed">Wireframe, hidden dashed</mat-option>
            <mat-option value="wireframe">Wireframe (all edges)</mat-option>
          </mat-select>
        </mat-form-field>

        <!-- Default unit for this model. Per-dim overrides via the input
             parser (e.g. typing "10in" on a single dim). Stored on the
             featureTree blob so it persists with the model save. -->
        <mat-form-field appearance="outline" class="unit-field">
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

        <button mat-stroked-button
                data-testid="action-submit"
                *ngIf="model()?.releaseState==='draft' && canWrite()"
                (click)="onSubmit()">
          Submit for review
        </button>
        <button mat-stroked-button color="primary"
                data-testid="action-release"
                *ngIf="model()?.releaseState==='review' && canApprove()"
                (click)="onRelease()">
          Release
        </button>
        <button mat-stroked-button
                data-testid="action-new-revision"
                *ngIf="model()?.releaseState==='released' && canWrite()"
                (click)="onNewRevision()">
          New Revision
        </button>
        <button mat-icon-button
                data-testid="fullscreen-toggle"
                matTooltip="{{ fullscreen() ? 'Exit full screen' : 'Full screen' }}"
                (click)="toggleFullscreen()">
          <mat-icon>{{ fullscreen() ? 'fullscreen_exit' : 'fullscreen' }}</mat-icon>
        </button>
      </div>

      <!-- REQ 616 — tabbed ribbon. Toolbar content swaps with the active tab.
           Active tab follows the editor context (auto-switches to Sketch when a
           sketch is active) but the user can manually click tabs to override.
           OnShape/SolidWorks layout: content row on top, tab labels at the bottom. -->
      <div class="ribbon">
        <div class="ribbon-content">
          <div class="ribbon-pane" [hidden]="activeTab() !== 'features'">
            <button class="ribbon-button"
                    data-testid="action-sketch"
                    [disabled]="readonly() || activeSketchId() !== null"
                    [class.active]="mode() === 'pick-plane'"
                    matTooltip="Start a new sketch on a datum plane"
                    (click)="onSketchAction()">
              <mat-icon>draw</mat-icon>
              <span class="ribbon-label">Sketch</span>
            </button>
            <button class="ribbon-button"
                    data-testid="action-extrude"
                    [disabled]="readonly() || activeSketchId() !== null"
                    [class.active]="mode() === 'pick-extrude-target'"
                    matTooltip="Extrude an existing sketch, or start a new one on a plane"
                    (click)="onExtrudeAction()">
              <mat-icon>vertical_align_top</mat-icon>
              <span class="ribbon-label">Extrude</span>
            </button>
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
          [selectableSketches]="mode() === 'pick-extrude-target'"
          [selectedFeatures]="selectedFeatures()"
          [featureErrors]="featureErrors()"
          [selectedSketches]="selectedSketches()"
          [bodyList]="bodies()"
          [hiddenBodyIds]="hiddenBodies()"
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
          [hidden]="sketchEditor.tool() === 'mirror' || sketchEditor.tool() === 'fillet' || sketchEditor.tool() === 'chamfer'">
        </app-cad-constraint-list>
        <ng-template #nothing></ng-template>

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
                  <button mat-icon-button class="entity-remove"
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
                  <button mat-icon-button class="entity-remove"
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
              <button mat-flat-button color="primary"
                      [disabled]="sketchEditor.selected().size === 0 || !sketchEditor.mirrorAxisId()"
                      (click)="sketchEditor.commitMirror()"
                      data-testid="mirror-ok">
                <mat-icon>check</mat-icon> OK
              </button>
              <button mat-stroked-button
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
                  <button mat-icon-button class="entity-remove"
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
              <button mat-flat-button color="primary"
                      [disabled]="filletCornersArray().length === 0"
                      (click)="sketchEditor.commitFillet()"
                      data-testid="fillet-ok">
                <mat-icon>check</mat-icon> OK
              </button>
              <button mat-stroked-button
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
              <button mat-stroked-button class="panel-flip"
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
                  <button mat-icon-button class="entity-remove"
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
              <button mat-flat-button color="primary"
                      [disabled]="chamferCornersArray().length === 0"
                      (click)="sketchEditor.commitChamfer()"
                      data-testid="chamfer-ok">
                <mat-icon>check</mat-icon> OK
              </button>
              <button mat-stroked-button
                      (click)="sketchEditor.cancelChamfer()"
                      data-testid="chamfer-cancel">
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
          <div class="tool-panel" data-testid="extrude-sidebar">
            <h3 class="panel-title">
              <mat-icon>{{ ctx.mode === 'cutExtrude' ? 'vertical_align_bottom' : 'arrow_upward' }}</mat-icon>
              {{ ctx.editingFeatureId
                  ? (ctx.mode === 'cutExtrude' ? 'Edit Cut' : 'Edit Extrude')
                  : (ctx.mode === 'cutExtrude' ? 'Cut Extrude' : 'Extrude') }}
            </h3>
            <p class="panel-hint">
              Pick the end condition. {{ ctx.regionCount > 1 ? 'Choose which closed regions in the sketch to extrude.' : '' }}
            </p>

            <div class="panel-field active">
              <div class="field-header">
                <mat-icon class="field-icon">stop</mat-icon>
                <span class="field-label">End condition</span>
              </div>
              <mat-form-field appearance="outline" class="panel-select">
                <mat-select [value]="extrudeEndKind()"
                            data-testid="extrude-end-condition"
                            (selectionChange)="setExtrudeEndKind($event.value)">
                  <mat-option value="blind">Blind</mat-option>
                  <mat-option value="midPlane">Mid Plane</mat-option>
                  <mat-option value="throughAll">Through All</mat-option>
                  <mat-option value="upToVertex">Up to Vertex</mat-option>
                  <mat-option value="upToSurface">Up to Surface</mat-option>
                  <mat-option value="upToBody" disabled>Up to Body (coming soon)</mat-option>
                </mat-select>
              </mat-form-field>
            </div>

            <div class="panel-field active"
                 *ngIf="extrudeEndKind() === 'blind' || extrudeEndKind() === 'midPlane'">
              <div class="field-header">
                <mat-icon class="field-icon">straighten</mat-icon>
                <span class="field-label">{{ extrudeEndKind() === 'midPlane' ? 'Total thickness' : 'Distance' }}</span>
              </div>
              <input class="panel-input"
                     type="number" min="0.01" step="1"
                     data-testid="extrude-input"
                     [value]="extrudeDistance()"
                     (input)="extrudeDistance.set(+($any($event.target).value))" />
            </div>

            <div class="panel-field active" *ngIf="extrudeEndKind() !== 'midPlane'">
              <div class="field-header">
                <mat-icon class="field-icon">swap_vert</mat-icon>
                <span class="field-label">Direction</span>
              </div>
              <button mat-stroked-button class="panel-flip"
                      data-testid="extrude-flip"
                      (click)="extrudeFlipped.set(!extrudeFlipped())">
                <mat-icon>{{ extrudeFlipped() ? 'south' : 'north' }}</mat-icon>
                {{ extrudeFlipped() ? 'Reverse' : 'Along normal' }}
              </button>
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

            <div class="panel-field active" *ngIf="extrudeEndKind() === 'upToVertex'">
              <div class="field-header">
                <mat-icon class="field-icon">place</mat-icon>
                <span class="field-label">Target vertex</span>
              </div>
              <button mat-stroked-button class="panel-flip"
                      data-testid="extrude-pick-vertex"
                      (click)="beginVertexPick()">
                <mat-icon>{{ extrudeUpToVertexId() ? 'check_circle' : 'touch_app' }}</mat-icon>
                {{ extrudeUpToVertexId() ? 'Vertex picked — click to change' : 'Pick a vertex in the viewer' }}
              </button>
            </div>

            <div class="panel-field active" *ngIf="extrudeEndKind() === 'upToSurface'">
              <div class="field-header">
                <mat-icon class="field-icon">crop_square</mat-icon>
                <span class="field-label">Target face</span>
              </div>
              <button mat-stroked-button class="panel-flip"
                      data-testid="extrude-pick-face"
                      (click)="beginFacePick()">
                <mat-icon>{{ extrudeUpToFaceId() ? 'check_circle' : 'touch_app' }}</mat-icon>
                {{ extrudeUpToFaceId() ? 'Face picked — click to change' : 'Pick a face in the viewer' }}
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
              <button mat-flat-button color="primary"
                      [disabled]="!canCommitExtrude()"
                      (click)="commitExtrudeSidebar()"
                      data-testid="extrude-apply">
                <mat-icon>check</mat-icon> OK
              </button>
              <button mat-stroked-button
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
          <div class="tool-panel" data-testid="revolve-sidebar">
            <h3 class="panel-title">
              <mat-icon>360</mat-icon>
              {{ ctx.editingFeatureId ? 'Edit Revolve' : 'Revolve' }}
            </h3>
            <p class="panel-hint">
              Pick a sketched line as the rotation axis and set the sweep angle.
            </p>

            <div class="panel-field active">
              <div class="field-header">
                <mat-icon class="field-icon">timeline</mat-icon>
                <span class="field-label">Axis</span>
              </div>
              <ul class="entity-list">
                <li class="entity-row"
                    *ngFor="let line of revolveAxisCandidates(); trackBy: trackLineId"
                    [class.selected]="revolveAxisLineId() === line.id"
                    [attr.data-testid]="'revolve-axis-' + line.id"
                    (click)="revolveAxisLineId.set(line.id)">
                  <mat-icon class="field-icon" *ngIf="line.construction">build_circle</mat-icon>
                  <mat-icon class="field-icon" *ngIf="!line.construction">show_chart</mat-icon>
                  <span>{{ line.label }}</span>
                </li>
              </ul>
            </div>

            <div class="panel-field active">
              <div class="field-header">
                <mat-icon class="field-icon">rotate_right</mat-icon>
                <span class="field-label">Angle (deg)</span>
              </div>
              <input class="panel-input"
                     type="number" min="0.1" max="360" step="1"
                     data-testid="revolve-angle"
                     [value]="revolveAngle()"
                     (input)="revolveAngle.set(+($any($event.target).value))" />
            </div>

            <div class="panel-field active">
              <div class="field-header">
                <mat-icon class="field-icon">swap_vert</mat-icon>
                <span class="field-label">Direction</span>
              </div>
              <button mat-stroked-button class="panel-flip"
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
              <button mat-flat-button color="primary"
                      [disabled]="!canCommitRevolve()"
                      (click)="commitRevolveSidebar()"
                      data-testid="revolve-apply">
                <mat-icon>check</mat-icon> OK
              </button>
              <button mat-stroked-button
                      (click)="cancelRevolveSidebar()"
                      data-testid="revolve-cancel">
                <mat-icon>close</mat-icon> Cancel
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
              [selectedConstraintId]="selectedConstraintId()"
              [defaultUnit]="defaultUnit()"
              [smartDimPreview]="smartDimPreview()"
              [displayMode]="displayMode()"
              [profileFills]="profileFills()"
              [profileFillsSelected]="extrudeSelectedRegions()"
              [profileFillsHovered]="extrudeHoveredRegion()"
              [vertexPickMode]="vertexPickMode()"
              [extraPickableVertices]="sketchPickableVertices()"
              [facePickMode]="facePickMode()"
              (profileFillClick)="toggleExtrudeRegion($event)"
              (profileFillHover)="extrudeHoveredRegion.set($event)"
              (vertexPicked)="onVertexPicked($event)"
              (facePicked)="onFacePicked($event)"
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
              <button mat-button (click)="setMode('idle')">Cancel</button>
            </div>

            <!-- Active-sketch banner with quick exit -->
            <div class="mode-prompt" *ngIf="activeSketchId() !== null" data-testid="sketch-mode-banner">
              <mat-icon>draw</mat-icon>
              <span class="prompt-text">Sketch mode · plane: {{ activeSketchPlaneLabel() }}</span>
              <button mat-stroked-button data-testid="exit-sketch" (click)="onExitSketch()">Exit sketch</button>
            </div>

            <div class="hud" data-testid="cad-hud-ready" *ngIf="activeSketchId() === null">
              mode: {{ mode() }} · selected: {{ selected() || '(none)' }} · features: {{ featureTree().features.length }}
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
    .cad-editor { display: flex; flex-direction: column; height: 100%; min-height: 100vh; background: #1e1e2e; color: #ddd; }
    .cad-editor.fullscreen { position: fixed; inset: 0; z-index: 9999; }
    .editor-header { display: flex; align-items: center; gap: 8px; padding: 8px 16px; background: #2a2a3a; border-bottom: 1px solid #444; }
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
    .field-value { font-size: 13px; padding-left: 22px; color: #ddd; }
    .panel-input {
      width: calc(100% - 24px);
      margin-left: 22px;
      padding: 4px 6px;
      font-size: 13px;
      font-family: monospace;
      background: #1f1f30;
      border: 1px solid #444;
      border-radius: 3px;
      color: #ddd;
    }
    .panel-input:focus { outline: none; border-color: #42a5f5; }
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
    .panel-flip {
      width: calc(100% - 24px);
      margin-left: 22px;
      margin-top: 6px;
      font-size: 12px !important;
    }
    select.panel-input { appearance: auto; }
    .field-empty { font-size: 12px; color: #888; font-style: italic; padding-left: 22px; }

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
    /* Remove button — small enough not to dominate the row. mat-icon-button
       defaults to 40×40 which is way too big inside a 220px column. */
    .entity-remove {
      width: 24px !important;
      height: 24px !important;
      line-height: 24px !important;
      padding: 0 !important;
      min-width: 0 !important;
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
    .mode-prompt { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 12px; padding: 8px 14px; background: rgba(66, 165, 245, 0.92); color: #0a0a14; border-radius: 8px; font-weight: 500; box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
    .mode-prompt .prompt-text { font-size: 13px; }
    .hud { position: absolute; bottom: 8px; left: 8px; font-family: monospace; font-size: 12px; opacity: 0.7; background: rgba(0,0,0,0.3); padding: 4px 8px; border-radius: 4px; }
    .quick-start { position: absolute; top: 64px; right: 16px; max-width: 320px; padding: 16px 18px; background: rgba(0,0,0,0.55); border-radius: 8px; font-size: 13px; }
    .quick-start h3 { margin: 0 0 8px; font-size: 14px; }
    .quick-start ol { margin: 0; padding-left: 18px; }
    .quick-start li { margin-bottom: 4px; }
    .quick-start .muted { margin: 10px 0 0; font-size: 11px; opacity: 0.6; }
    .loading { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 12px; }
  `],
})
export class CadEditorComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private cadApi = inject(CadModelService);
  private auth = inject(AuthService);
  private errors = inject(ErrorNotificationService);
  private dialog = inject(MatDialog);
  // Public so the template can read the connection state for the kernel-
  // status badge. The stream is otherwise an internal concern.
  stream = inject(CadStreamService);
  private streamSub: { unsubscribe: () => void } | null = null;

  model = signal<CadModel | null>(null);
  loading = signal<boolean>(true);
  featureTree = signal<FeatureTree>(emptyFeatureTree());
  doc = signal<SketchDocument>(emptyDocument());
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
  // Phase 1: server-side regen is in flight. The viewer's loading overlay
  // reads this. Old kernelLoading + kernelLoadStatus signals were tied to
  // the deleted client-side OCCT loader.
  regenLoading = signal<boolean>(false);
  regenError = signal<string | null>(null);
  // Per-feature failures from the last regenerate pass. Cleared on regen
  // start, updated as feature-result events arrive (or the HTTP response
  // finalizes for clients without an active WS).
  featureErrors = signal<Map<string, string>>(new Map());
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

  // ── Revolve sidebar ───────────────────────────────────────────────────
  // Parallel to extrudeSidebar but for RevolveFeature. Carries the host
  // sketch and edit-mode flag; angle / axis / flipped live in their own
  // signals so commit reads them at OK time. profileFills computed
  // listens to both sidebars so the canvas region overlay works for
  // either flow.
  revolveSidebar = signal<{
    sketchId: string;
    regionCount: number;
    editingFeatureId?: string;
  } | null>(null);
  revolveAngle = signal<number>(360);
  revolveFlipped = signal<boolean>(false);
  /** Sketched line id picked as the rotation axis. */
  revolveAxisLineId = signal<string | null>(null);
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
    return editor?.selected() ?? new Set<string>();
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

  readonly = computed(() => {
    const m = this.model();
    if (!m) return true;
    if (m.releaseState !== 'draft') return true;
    return !this.canWrite();
  });

  selectedIsPlanar = computed(() => {
    const s = this.selected();
    return s !== null && s.startsWith('datum:') && (s.endsWith('_plane'));
  });

  sketchCount = computed(() => Object.keys(this.doc().sketches).length);

  promptIcon = computed(() => {
    const m = this.mode();
    if (m === 'pick-plane') return 'draw';
    if (m === 'pick-extrude-target') return 'vertical_align_top';
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
      this.geometry.set({
        datums,
        faces: prev?.faces ?? [],
        topology: prev?.topology ?? { vertices: [], edges: [] },
      });
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
    this.save();
    this.regenerate();
  }

  ngOnInit() {
    this.route.parent?.paramMap.subscribe(pm => {
      const id = Number(pm.get('id'));
      if (id) this.partID.set(id);
    });
    this.route.queryParamMap.subscribe(qp => {
      const fs = qp.get('fullscreen');
      if (fs === '1' || fs === 'true') this.fullscreen.set(true);
      const revID = Number(qp.get('revisionID'));
      if (revID) this.loadModel(revID);
      else this.loadActive();
    });
  }

  ngOnDestroy() {
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
    this.applyFeatureSelection(ev.featureId, ev.shiftKey, ev.ctrlKey);
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
          if (inf.hint) {
            items.push({ kind: 'snap-indicator', x: inf.snapped.x, y: inf.snapped.y });
            // Small auto-relations badge near the snap point — tells the
            // user WHICH inference fired (horizontal / vertical / polar
            // angle / aligned with another point / on line).
            items.push({ kind: 'inference-badge', x: inf.snapped.x + 3, y: inf.snapped.y + 3, label: inf.hint });
          }
          // Polar / alignment guides: dashed rays the inference engine
          // emits so the user can see what their cursor lined up with.
          if (inf.guides) {
            for (const g of inf.guides) {
              items.push({ kind: 'alignment-guide', start: g.from, end: g.to });
            }
          }
        }
      }
    } else if (tool === 'circle') {
      const center = editor.draftCircleCenter();
      if (center) {
        items.push({ kind: 'point-marker', x: center.x, y: center.y, style: 'pending' });
        const radius = Math.hypot(cursor.x - center.x, cursor.y - center.y);
        if (radius > 0.1) items.push({ kind: 'circle', center, radius });
      }
    } else if (tool === 'arc') {
      const center = editor.draftArcCenter();
      const start = editor.draftArcStart();
      if (center) items.push({ kind: 'point-marker', x: center.x, y: center.y, style: 'pending' });
      if (start) items.push({ kind: 'point-marker', x: start.x, y: start.y, style: 'pending' });
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
    // produce with the current radius.
    if (tool === 'fillet') {
      const r = editor.filletRadius() ?? 5;
      for (const cornerId of editor.filletCorners()) {
        const lines = editor.linesIncidentTo(sketch.state, cornerId);
        if (lines.length !== 2) continue;
        const geom = computeFilletGeometry(sketch.state, lines[0].id, lines[1].id, r);
        if (!geom) continue;
        items.push({
          kind: 'arc',
          center: geom.C, start: geom.T1, end: geom.T2,
          radius: geom.radius, ccw: geom.ccw,
        });
        items.push({ kind: 'point-marker', x: geom.T1.x, y: geom.T1.y, style: 'pending' });
        items.push({ kind: 'point-marker', x: geom.T2.x, y: geom.T2.y, style: 'pending' });
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
    if (this.mode() !== 'pick-extrude-target') return;
    this.openExtrudeDialog(sketchId);
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
    const plane = planeForDatum(datumId);
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

  /** Sketch toolbar "Revolve" shortcut. Builds the sidebar state from
   * the sketch's lines + default 360°, then opens the panel. The user
   * picks an axis (or accepts the auto-pick if exactly one construction
   * line exists) and confirms. */
  onRevolveRequested() {
    const sid = this.activeSketchId();
    if (!sid) return;
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
    this.revolveFlipped.set(false);
    this.extrudeSelectedRegions.set(new Set([0]));
    this.extrudeHoveredRegion.set(null);
    this.revolveSidebar.set({ sketchId: sid, regionCount: regions.length });
  }

  /** Candidates the axis picker lists, construction lines first. Read
   * by the sidebar template via revolveAxisCandidates(). */
  revolveAxisCandidates(): Array<{ id: string; label: string; construction: boolean }> {
    const ctx = this.revolveSidebar();
    if (!ctx) return [];
    const sketch = this.doc().sketches[ctx.sketchId];
    if (!sketch) return [];
    const lines = sketch.state.entities.filter(e => e.kind === 'line');
    const out = lines.map(l => ({
      id: l.id,
      label: l.id,
      construction: !!(l as any).construction,
    }));
    // Construction lines first, then by id for stable ordering.
    out.sort((a, b) => Number(b.construction) - Number(a.construction) || a.id.localeCompare(b.id));
    return out;
  }
  trackLineId = (_: number, l: { id: string }) => l.id;

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
    this.setMode('idle');
    if (ctx.editingFeatureId) {
      this.featureTree.set(updateFeatureParam<import('../../../cad/lib/types').RevolveFeature>(
        this.featureTree(), ctx.editingFeatureId,
        { axisLineId, angle, flipped, regionIndices },
      ));
      this.save();
    } else {
      this.featureTree.set(addFeature(this.featureTree(), {
        type: 'revolve', sketchId: ctx.sketchId,
        axisLineId, angle, flipped, regionIndices,
      }));
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
    this.setMode('idle');
  }

  /** Cut-extrude shortcut. Same flow as Extrude but the resulting
   * feature is a CutExtrudeFeature. Errors early if there's no body
   * to cut FROM (no prior additive features). */
  onCutExtrudeRequested() {
    const sid = this.activeSketchId();
    if (!sid) return;
    const hasAdditive = this.featureTree().features.some(f => f.type === 'extrude');
    if (!hasAdditive) {
      this.errors.showError('Cut Extrude needs an existing body to cut from. Add an Extrude first.');
      return;
    }
    this.activeSketchId.set(null);
    this.openExtrudeDialog(sid, 'cutExtrude');
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
    this.extrudeFlipped.set(false);
    this.extrudeMerge.set(true);
    this.extrudeEndKind.set('blind');
    this.extrudeUpToVertexId.set(null);
    this.extrudeUpToFaceId.set(null);
    this.vertexPickMode.set(false);
    this.facePickMode.set(false);
    this.extrudeSelectedRegions.set(new Set([0]));
    this.extrudeHoveredRegion.set(null);
    this.extrudeSidebar.set({ sketchId, regionCount: regions.length, mode });
  }

  /** End-condition dropdown handler. Switching kinds resets the
   * target-picking state so an old vertex pick doesn't carry across
   * (and so the disabled-OK button logic re-evaluates). */
  setExtrudeEndKind(kind: ExtrudeEndCondition['kind']): void {
    this.extrudeEndKind.set(kind);
    if (kind !== 'upToVertex') this.extrudeUpToVertexId.set(null);
    if (kind !== 'upToSurface') this.extrudeUpToFaceId.set(null);
    // Exit any picker mode if it was active and the kind no longer needs it.
    if (kind !== 'upToVertex') this.vertexPickMode.set(false);
    if (kind !== 'upToSurface') this.facePickMode.set(false);
  }

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
        return { kind: 'upToSurface', faceId: fid };
      }
      // upToBody is still disabled in the dropdown until Pass 4.
      default: return null;
    }
  }

  /** Disabled-state for the OK button. Distance-based kinds need a
   * positive distance; Up to Vertex/Surface need a pick; Through All
   * needs neither. */
  canCommitExtrude(): boolean {
    if (this.extrudeSelectedRegions().size === 0) return false;
    const kind = this.extrudeEndKind();
    if (kind === 'blind' || kind === 'midPlane') {
      return isFinite(this.extrudeDistance()) && this.extrudeDistance() > 0;
    }
    if (kind === 'upToVertex') return this.extrudeUpToVertexId() !== null;
    if (kind === 'upToSurface') return this.extrudeUpToFaceId() !== null;
    if (kind === 'throughAll') return true;
    return false;
  }

  /** Enter vertex-pick mode. The viewer renders a sphere at each
   * topology vertex and restricts click hit-testing to those spheres.
   * On click, onVertexPicked stores the id and exits the mode. Pressing
   * Esc or clicking Cancel exits without a pick. */
  beginVertexPick(): void {
    this.facePickMode.set(false);  // mutually exclusive with face pick
    this.vertexPickMode.set(true);
  }

  /** Called by the viewer when the user clicks a vertex marker. Stores
   * the id on the in-progress feature state and exits pick mode so the
   * normal sidebar picker UI returns. */
  onVertexPicked(vertexId: string): void {
    this.extrudeUpToVertexId.set(vertexId);
    this.vertexPickMode.set(false);
  }

  /** Enter face-pick mode — same exclusive pattern as vertex picking. */
  beginFacePick(): void {
    this.vertexPickMode.set(false);
    this.facePickMode.set(true);
  }

  onFacePicked(faceId: string): void {
    this.extrudeUpToFaceId.set(faceId);
    this.facePickMode.set(false);
  }

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
    this.extrudeSidebar.set(null);
    this.extrudeHoveredRegion.set(null);
    this.vertexPickMode.set(false);
    this.facePickMode.set(false);
    this.setMode('idle');
    if (ctx.editingFeatureId) {
      // merge only applies to additive Extrude; updateFeatureParam ignores
      // it for cutExtrude (the field doesn't exist there).
      const patch: Partial<ExtrudeFeature> = { distance, flipped, regionIndices, endCondition };
      if (ctx.mode !== 'cutExtrude') patch.merge = merge;
      this.featureTree.set(updateFeatureParam<ExtrudeFeature>(
        this.featureTree(), ctx.editingFeatureId, patch,
      ));
      this.save();
    } else {
      this._applyExtrude(ctx.sketchId, { distance, flipped, regionIndices, endCondition, mode: ctx.mode, merge });
    }
  }

  cancelExtrudeSidebar() {
    this.extrudeSidebar.set(null);
    this.extrudeHoveredRegion.set(null);
    this.extrudeUpToVertexId.set(null);
    this.extrudeUpToFaceId.set(null);
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
    this.featureTree.set(addFeature(this.featureTree(), featurePayload));
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
      case 'rename-feature': return this.renameFeature(action.featureId);
      case 'edit-sketch': return this.editSketch(action.sketchId);
      case 'delete-sketch': return this.requestDeleteSketch(action.sketchId);
      case 'toggle-sketch-visibility': return this.toggleSketchVisibility(action.sketchId);
      case 'rename-sketch': return this.renameSketch(action.sketchId);
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
    if (feature.type === 'revolve') {
      this._editRevolve(feature);
      return;
    }
    if (feature.type !== 'extrude' && feature.type !== 'cutExtrude') return;
    const sketch = this.doc().sketches[feature.sketchId];
    const regionCount = sketch ? extractRegions(sketch.state).regions.length : 1;
    // Reuse the same Extrude sidebar in "editing" mode: commit updates the
    // existing feature rather than appending a new one.
    this.extrudeDistance.set(feature.distance);
    this.extrudeFlipped.set(feature.flipped === true);
    // merge only on additive extrude — cut features don't carry the flag.
    this.extrudeMerge.set(feature.type === 'extrude' ? (feature as ExtrudeFeature).merge !== false : true);
    this.extrudeSelectedRegions.set(new Set(feature.regionIndices ?? [0]));
    const ec = feature.endCondition ?? { kind: 'blind' };
    this.extrudeEndKind.set(ec.kind);
    this.extrudeUpToVertexId.set(ec.kind === 'upToVertex' ? ec.vertexId : null);
    this.extrudeUpToFaceId.set(ec.kind === 'upToSurface' ? ec.faceId : null);
    this.extrudeSidebar.set({
      sketchId: feature.sketchId,
      regionCount,
      mode: feature.type === 'cutExtrude' ? 'cutExtrude' : 'extrude',
      editingFeatureId: featureId,
    });
  }

  /** Rehydrate the Revolve sidebar from an existing RevolveFeature. */
  private _editRevolve(feature: import('../../../cad/lib/types').RevolveFeature) {
    const sketch = this.doc().sketches[feature.sketchId];
    const regionCount = sketch ? extractRegions(sketch.state).regions.length : 1;
    this.revolveAxisLineId.set(feature.axisLineId);
    this.revolveAngle.set(feature.angle);
    this.revolveFlipped.set(feature.flipped === true);
    this.extrudeSelectedRegions.set(new Set(feature.regionIndices ?? [0]));
    this.revolveSidebar.set({
      sketchId: feature.sketchId,
      regionCount,
      editingFeatureId: feature.id,
    });
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

  editSketch(sketchId: string) {
    if (!this.doc().sketches[sketchId]) return;
    this.activeSketchId.set(sketchId);
    this.setMode('idle');
  }

  private requestDeleteSketch(sketchId: string) {
    const ids = this.batchSketchTargets(sketchId);
    // Collect every dependent feature across the whole delete batch — one
    // warning dialog for the lot, not N dialogs that the user has to dismiss
    // one by one.
    const features = this.featureTree().features;
    const dependents = features
      .filter((f): f is ExtrudeFeature => (f.type === 'extrude' || f.type === 'cutExtrude' || f.type === 'revolve') && ids.includes((f as ExtrudeFeature).sketchId))
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
      const newFaces = (ev.faces || []).map(face => ({
        faceId: face.faceId,
        positions: new Float32Array(face.positions),
        normals: new Float32Array(face.normals),
        indices: new Uint32Array(face.indices),
        featureId: ev.featureId,
        isFlat: face.isFlat,
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
  private save() {
    const m = this.model();
    if (!m || m.releaseState !== 'draft') return;
    if (this.debouncedSave) clearTimeout(this.debouncedSave);
    this.debouncedSave = window.setTimeout(() => {
      this.cadApi.update(m.id, { featureTree: this.featureTree(), sketchDoc: this.doc() }).subscribe({
        next: updated => {
          this.model.set(updated);
          // After every successful save, regen the geometry from the server.
          // Server reads the just-saved featureTree + sketchDoc; cache hits
          // on unchanged features keep the round-trip cheap.
          this.regenerate();
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
    this.cadApi.regenerate(m.id).subscribe({
      next: (resp) => {
        if (genId !== this.regenGeneration) return;
        this.regenLoading.set(false);
        // Multi-body pipeline: each feature reports its target body's
        // latest state. For each body, take the LAST non-errored feature
        // emit and use that as the body's current geometry.
        const perBody = new Map<string, { faces: any[]; topology: ModelTopology }>();
        for (const f of resp.features) {
          if (f.error) continue;
          const bid = (f as any).bodyId as string | null;
          if (!bid) continue;
          perBody.set(bid, {
            faces: (f.faces || []).map(face => ({
              faceId: face.faceId,
              positions: new Float32Array(face.positions),
              normals: new Float32Array(face.normals),
              indices: new Uint32Array(face.indices),
              featureId: f.featureId,
              isFlat: face.isFlat,
            })),
            topology: {
              vertices: f.topology?.vertices ?? [],
              edges: f.topology?.edges ?? [],
            },
          });
        }
        this.perBodyGeometry.set(perBody);
        this.bodies.set(resp.bodies ?? Array.from(perBody.keys()).map(id => ({ id, name: null })));
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

    let valueStored: number;
    let nextConstraintUnit: Unit | undefined = c.unit;
    if (c.type === 'angle') {
      const n = parseFloat(ev.raw);
      if (!isFinite(n)) return;
      valueStored = n * Math.PI / 180;
    } else {
      const parsed = parseUserValue(ev.raw, this.defaultUnit());
      if (!parsed) return;
      valueStored = parsed.valueMm;
      // If the user typed an explicit unit (even matching defaultUnit),
      // remember it on the dim. If they typed a bare number, drop any
      // existing per-dim unit override (revert to default).
      nextConstraintUnit = parsed.unit ?? undefined;
    }

    let updated = setConstraintValue(sketch.state, ev.id, valueStored);
    updated = {
      ...updated,
      constraints: updated.constraints.map(cc => cc.id === ev.id
        ? { ...cc, unit: nextConstraintUnit }
        : cc),
    };
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

  onBack() { this.router.navigate(['../'], { relativeTo: this.route }); }

  onSubmit() {
    const m = this.model(); if (!m) return;
    this.cadApi.submit(m.id).subscribe({
      next: updated => this.model.set(updated),
      error: err => this.errors.showError(err?.error?.error || 'Submit failed'),
    });
  }

  onRelease() {
    const m = this.model(); if (!m) return;
    this.cadApi.release(m.id).subscribe({
      next: updated => this.model.set(updated),
      error: err => this.errors.showError(err?.error?.error || 'Release failed'),
    });
  }

  onNewRevision() {
    const m = this.model(); if (!m) return;
    this.cadApi.newRevision(m.id).subscribe({
      next: created => this.router.navigate([], { relativeTo: this.route, queryParams: { revisionID: created.id }, replaceUrl: true }),
      error: err => this.errors.showError(err?.error?.error || 'New revision failed'),
    });
  }

  toggleFullscreen() {
    this.fullscreen.update(v => !v);
    this.router.navigate([], { relativeTo: this.route, queryParams: { fullscreen: this.fullscreen() ? '1' : null }, queryParamsHandling: 'merge', replaceUrl: true });
  }
}
