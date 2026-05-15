import { Component, inject, signal, computed, effect, OnInit, OnDestroy, HostListener, viewChild } from '@angular/core';
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
import { CadViewerComponent, type DisplayMode, type SketchPreview } from '../cad-viewer/cad-viewer.component';
import { CadFeatureTreePanelComponent, type FeatureTreeAction, type FeatureSelectEvent } from '../cad-feature-tree-panel/cad-feature-tree-panel.component';
import { CadSketchEditorComponent } from '../cad-sketch-editor/cad-sketch-editor.component';
import { ExtrudeDialogComponent, type ExtrudeDialogResult } from '../extrude-dialog/extrude-dialog.component';
import { SketchDeleteWarningDialogComponent, type SketchDeleteAction } from '../sketch-delete-warning-dialog/sketch-delete-warning-dialog.component';
import type { FeatureTree, SketchDocument, SketchId, ModelGeometry, SketchState, ExtrudeFeature } from '../../../cad/lib/types';
import {
  emptyFeatureTree, addFeature, defaultDatumVisibility,
  removeFeature, updateFeatureParam, removeFeaturesReferencingSketch,
} from '../../../cad/lib/featureTree';
import { emptyDocument, createSketch, updateSketchState, deleteSketch, setSketchVisibility, setSketchName } from '../../../cad/lib/document';
import { migrateSketchDocument } from '../../../cad/lib/migration';
import { planeForDatum, buildOriginDatums } from '../../../cad/lib/datum';
import { extractClosedLoops } from '../../../cad/lib/profile';
import { environment } from '../../../../environments/environment';

type EditorMode = 'idle' | 'pick-plane' | 'pick-extrude-target';

@Component({
  selector: 'app-cad-editor',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatButtonModule, MatIconModule, MatTooltipModule,
    MatProgressSpinnerModule, MatDialogModule, MatInputModule, MatFormFieldModule, MatDividerModule,
    MatSelectModule, MatMenuModule,
    CadViewerComponent, CadFeatureTreePanelComponent, CadSketchEditorComponent,
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
              (extrudeRequested)="onExtrudeRequested()">
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
          (sketchSelected)="onTreeSketchSelected($event)"
          (visibilityToggled)="onDatumVisibilityToggled($event)"
          (actionRequested)="onTreeAction($event)"
          (featureSelect)="onFeatureTreeSelect($event)"
          class="feature-tree">
        </app-cad-feature-tree-panel>

        <div class="viewport-wrap">
          <ng-container *ngIf="!loading(); else loadingTpl">
            <app-cad-viewer
              [geometry]="geometry()"
              [selected]="selected()"
              [selectedFeatures]="selectedFeatures()"
              [loading]="regenLoading()"
              [loadProgress]="regenError() || ''"
              [sketchDoc]="doc()"
              [activeSketchId]="activeSketchId()"
              [sketchPreview]="sketchPreview()"
              [selectedSketchEntities]="sketchEditorSelection()"
              [displayMode]="displayMode()"
              (selectionChange)="onSelectionChange($event)"
              (featureClick)="onViewerFeatureClick($event)"
              (featureContextMenu)="onViewerFeatureContextMenu($event)"
              (sketchClick)="onViewerSketchClick($event)"
              (sketchPointerDown)="onViewerSketchPointerDown($event)"
              (sketchPointerMove)="onViewerSketchPointerMove($event)"
              (sketchPointerUp)="onViewerSketchPointerUp($event)">
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
    .tool-action.active { background: rgba(66, 165, 245, 0.22); border-color: #42a5f5; }
    .ctx-anchor { position: fixed; width: 0; height: 0; }
    .display-mode-field { width: 220px; font-size: 12px; }
    .display-mode-field .mat-mdc-form-field-subscript-wrapper { display: none; }
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
    .viewport-wrap { flex: 1; position: relative; overflow: hidden; }
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

  model = signal<CadModel | null>(null);
  loading = signal<boolean>(true);
  featureTree = signal<FeatureTree>(emptyFeatureTree());
  doc = signal<SketchDocument>(emptyDocument());
  activeSketchId = signal<SketchId | null>(null);
  selected = signal<string | null>(null);
  fullscreen = signal<boolean>(false);
  partID = signal<number | null>(null);
  geometry = signal<ModelGeometry | null>(null);
  // Phase 1: server-side regen is in flight. The viewer's loading overlay
  // reads this. Old kernelLoading + kernelLoadStatus signals were tied to
  // the deleted client-side OCCT loader.
  regenLoading = signal<boolean>(false);
  regenError = signal<string | null>(null);
  mode = signal<EditorMode>('idle');
  pendingExtrude = signal<boolean>(false);
  // REQ 616 — ribbon tab. Auto-switches to 'sketch' when activeSketchId becomes
  // non-null and back to 'features' when it clears; user can manually override.
  activeTab = signal<'features' | 'sketch'>('features');
  // REQ 619 — display mode for the 3D viewer (session state, not persisted).
  displayMode = signal<DisplayMode>('visible-edges');
  // REQ 623 — feature multi-select. Updated by viewer's featureClick event.
  selectedFeatures = signal<Set<string>>(new Set());
  // REQ 629 — sketch cursor + snap target. Updated on every viewer
  // sketchPointerMove. Cursor is in active sketch 2D coords (snapped if a
  // snap target was within range). snapTargetPoint is the un-snapped world
  // location of the snap target — used to render the snap-ring indicator.
  sketchCursor = signal<{ x: number; y: number } | null>(null);
  snapTargetPoint = signal<{ x: number; y: number } | null>(null);
  // REQ 631 — mirror the sketch-editor's selection set into a computed so the
  // 3D viewer can react to changes (sketch-editor.selected is a signal accessed
  // via viewChild; this layer keeps Angular's reactivity tidy).
  sketchEditorSelection = computed<Set<string>>(() => {
    const editor = this.sketchEditorRef();
    return editor?.selected() ?? new Set<string>();
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
  private sketchEditorRef = viewChild<CadSketchEditorComponent>('sketchEditor');
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
    effect(() => {
      const tree = this.featureTree();
      const origin = tree.features.find(f => f.type === 'origin') as
        | (typeof tree.features[number] & { visibility?: Record<string, boolean> })
        | undefined;
      const vis = { ...defaultDatumVisibility(), ...(origin?.visibility ?? {}) };
      const datums = buildOriginDatums().filter(d => vis[d.id] !== false);
      const prev = this.geometry();
      this.geometry.set({
        datums,
        faces: prev?.faces ?? [],
        topology: prev?.topology ?? { vertices: [], edges: [] },
      });
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
  onViewerSketchClick(p: { x: number; y: number; shiftKey: boolean }) {
    const { snapped } = this.snapToPoint({ x: p.x, y: p.y });
    this.sketchEditorRef()?.handleSketchClick({ x: snapped.x, y: snapped.y, shiftKey: p.shiftKey });
  }
  onViewerSketchPointerDown(p: { x: number; y: number }) {
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
  // return its location plus a marker for the indicator. Candidates are all
  // existing sketch point entities AND the sketch origin (0, 0) — the origin
  // is rendered as a visible marker per REQ 616 but isn't a point entity, so
  // we add it explicitly to the candidate set.
  private snapToPoint(p: { x: number; y: number }): {
    snapped: { x: number; y: number };
    target: { x: number; y: number } | null;
  } {
    const sid = this.activeSketchId();
    if (!sid) return { snapped: p, target: null };
    const sketch = this.doc().sketches[sid];
    if (!sketch) return { snapped: p, target: null };
    const SNAP_RADIUS = 3;
    let best: { x: number; y: number } | null = null;
    let bestDist = SNAP_RADIUS;
    const dOrigin = Math.hypot(p.x, p.y);
    if (dOrigin < bestDist) { bestDist = dOrigin; best = { x: 0, y: 0 }; }
    for (const e of sketch.state.entities) {
      if (e.kind !== 'point') continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < bestDist) { bestDist = d; best = { x: e.x, y: e.y }; }
    }
    return best ? { snapped: best, target: best } : { snapped: p, target: null };
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
    const snap = this.snapTargetPoint();
    if (snap) items.push({ kind: 'snap-indicator', x: snap.x, y: snap.y });

    const tool = editor.tool();
    if (tool === 'line') {
      const startId = editor.draftLineStart();
      if (startId) {
        const startEntity = sketch.state.entities.find(e => e.id === startId);
        if (startEntity?.kind === 'point') {
          items.push({ kind: 'line', start: { x: startEntity.x, y: startEntity.y }, end: cursor });
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
    return items;
  });

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
    const { doc, sketchId } = createSketch(this.doc(), `face:${faceId}`, plane, null);
    this.doc.set(doc);
    this.activeSketchId.set(sketchId);
    this.setMode('idle');
    this.lastPickedFaceId.set(null);
    this.selectedFeatures.set(new Set());
    this.save();
  }

  onExtrudeAction() {
    if (this.readonly()) return;
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
    const { doc, sketchId } = createSketch(this.doc(), datumFullId, plane, null);
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
    this.openExtrudeDialog(sid);
  }

  private openExtrudeDialog(sketchId: string) {
    const sketch = this.doc().sketches[sketchId];
    if (!sketch) {
      this.errors.showError(`Sketch ${sketchId} not found`);
      this.setMode('idle');
      return;
    }
    const { loops, errors } = extractClosedLoops(sketch.state);
    if (loops.length === 0) {
      this.errors.showError(errors[0] || 'Sketch has no closed profile — extrude requires a closed shape');
      this.setMode('idle');
      return;
    }
    const ref = this.dialog.open(ExtrudeDialogComponent, {
      data: { defaultDistance: 10, loopCount: loops.length, defaultLoopIndices: [0] },
      width: '320px',
    });
    ref.afterClosed().subscribe((result: ExtrudeDialogResult | null) => {
      this.setMode('idle');
      if (!result || result.distance <= 0) return;
      this.featureTree.set(addFeature(this.featureTree(), {
        type: 'extrude', sketchId,
        distance: result.distance,
        flipped: result.flipped,
        loopIndices: result.loopIndices,
      }));
      // REQ 618 — extruded sketches auto-hide their 2D overlay. The user can
      // re-show via the feature-tree eye toggle if they need to inspect the
      // source profile.
      this.doc.set(setSketchVisibility(this.doc(), sketchId, false));
      this.save();
    });
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
    const sketch = this.doc().sketches[sketchId];
    if (!sketch) return;
    const nextVisible = sketch.visible === false;  // currently hidden ⇒ show
    this.doc.set(setSketchVisibility(this.doc(), sketchId, nextVisible));
    this.save();
  }

  private editFeature(featureId: string) {
    const feature = this.featureTree().features.find(f => f.id === featureId);
    if (!feature || feature.type !== 'extrude') return;
    const sketch = this.doc().sketches[feature.sketchId];
    const loopCount = sketch ? extractClosedLoops(sketch.state).loops.length : 1;
    const ref = this.dialog.open(ExtrudeDialogComponent, {
      data: {
        defaultDistance: feature.distance,
        defaultFlipped: feature.flipped === true,
        loopCount,
        defaultLoopIndices: feature.loopIndices ?? [0],
      },
      width: '320px',
    });
    ref.afterClosed().subscribe((result: ExtrudeDialogResult | null) => {
      if (!result || result.distance <= 0) return;
      this.featureTree.set(updateFeatureParam<ExtrudeFeature>(this.featureTree(), featureId, {
        distance: result.distance, flipped: result.flipped, loopIndices: result.loopIndices,
      }));
      this.save();
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

  private editSketch(sketchId: string) {
    if (!this.doc().sketches[sketchId]) return;
    this.activeSketchId.set(sketchId);
    this.setMode('idle');
  }

  private requestDeleteSketch(sketchId: string) {
    const dependents = this.featureTree().features
      .filter((f): f is ExtrudeFeature => f.type === 'extrude' && f.sketchId === sketchId)
      .map(f => f.id);
    if (dependents.length === 0) {
      // No references — just delete.
      this.applySketchDelete(sketchId, 'break');
      return;
    }
    const ref = this.dialog.open(SketchDeleteWarningDialogComponent, {
      data: { sketchId, dependentFeatureIds: dependents },
      width: '420px',
    });
    ref.afterClosed().subscribe((choice: SketchDeleteAction | null) => {
      if (!choice || choice === 'cancel') return;
      this.applySketchDelete(sketchId, choice);
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
    this.featureTree.set(m.featureTree as FeatureTree);
    // REQ 565: legacy SketchDocument blobs are auto-upgraded to the entity model on load.
    this.doc.set(migrateSketchDocument(m.sketchDoc as SketchDocument));
    this.activeSketchId.set(null);
    this.setMode('idle');
    this.loading.set(false);
    // Kick the initial regeneration so the cached/freshly-built faces render.
    this.regenerate();
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
    this.cadApi.regenerate(m.id).subscribe({
      next: (resp) => {
        if (genId !== this.regenGeneration) return;
        this.regenLoading.set(false);
        const faces = resp.features.flatMap(f =>
          (f.faces || []).map(face => ({
            faceId: face.faceId,
            positions: new Float32Array(face.positions),
            normals: new Float32Array(face.normals),
            indices: new Uint32Array(face.indices),
            featureId: f.featureId,
            isFlat: face.isFlat,
          })),
        );
        const prev = this.geometry();
        this.geometry.set({
          datums: prev?.datums ?? [],
          faces,
          topology: { vertices: [], edges: [] },  // server topology arrives in Phase 1.5
        });
        for (const err of resp.errors || []) {
          // eslint-disable-next-line no-console
          console.warn('[regen]', err);
        }
      },
      error: (err) => {
        if (genId !== this.regenGeneration) return;
        this.regenLoading.set(false);
        const msg = err?.error?.error || err?.message || 'Regenerate failed';
        this.regenError.set(msg);
        this.errors.showError(msg);
      },
    });
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
