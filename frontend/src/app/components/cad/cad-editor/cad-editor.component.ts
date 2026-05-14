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
import { CadModelService } from '../../../services/cad-model.service';
import { CadModel } from '../../../models/cad-model.model';
import { AuthService } from '../../../services/auth.service';
import { ErrorNotificationService } from '../../../services/error-notification.service';
import { CadViewerComponent } from '../cad-viewer/cad-viewer.component';
import { CadFeatureTreePanelComponent, type FeatureTreeAction } from '../cad-feature-tree-panel/cad-feature-tree-panel.component';
import { CadSketchEditorComponent } from '../cad-sketch-editor/cad-sketch-editor.component';
import { ExtrudeDialogComponent } from '../extrude-dialog/extrude-dialog.component';
import { SketchDeleteWarningDialogComponent, type SketchDeleteAction } from '../sketch-delete-warning-dialog/sketch-delete-warning-dialog.component';
import type { FeatureTree, SketchDocument, SketchId, ModelGeometry, SketchState, ExtrudeFeature } from '../../../cad/lib/types';
import {
  emptyFeatureTree, addFeature, regenerateModel, defaultDatumVisibility, type KernelAdapter,
  removeFeature, updateFeatureParam, removeFeaturesReferencingSketch,
} from '../../../cad/lib/featureTree';
import { emptyDocument, createSketch, updateSketchState, deleteSketch, setSketchVisibility } from '../../../cad/lib/document';
import { migrateSketchDocument } from '../../../cad/lib/migration';
import { planeForDatum, buildOriginDatums } from '../../../cad/lib/datum';
import { extractClosedLoop } from '../../../cad/lib/profile';
import { makePureJsKernel } from '../../../cad/lib/kernel';
import { CadKernelService } from '../../../services/cad-kernel.service';
import { environment } from '../../../../environments/environment';

type EditorMode = 'idle' | 'pick-plane' | 'pick-extrude-target';

@Component({
  selector: 'app-cad-editor',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatButtonModule, MatIconModule, MatTooltipModule,
    MatProgressSpinnerModule, MatDialogModule, MatInputModule, MatFormFieldModule, MatDividerModule,
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
           sketch is active) but the user can manually click tabs to override. -->
      <div class="ribbon">
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
        <div class="ribbon-content">
          <div class="ribbon-pane" [hidden]="activeTab() !== 'features'">
            <button mat-stroked-button
                    data-testid="action-sketch"
                    class="tool-action"
                    [disabled]="readonly() || activeSketchId() !== null"
                    [class.active]="mode() === 'pick-plane'"
                    matTooltip="Start a new sketch on a datum plane"
                    (click)="onSketchAction()">
              <mat-icon>draw</mat-icon> Sketch
            </button>
            <button mat-stroked-button
                    data-testid="action-extrude"
                    class="tool-action"
                    [disabled]="readonly() || activeSketchId() !== null"
                    [class.active]="mode() === 'pick-extrude-target'"
                    matTooltip="Extrude an existing sketch, or start a new one on a plane"
                    (click)="onExtrudeAction()">
              <mat-icon>vertical_align_top</mat-icon> Extrude
            </button>
            <button mat-icon-button
                    *ngIf="mode() !== 'idle' && activeSketchId() === null"
                    matTooltip="Cancel (Esc)"
                    (click)="setMode('idle')">
              <mat-icon>close</mat-icon>
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
      </div>

      <div class="editor-body">
        <app-cad-feature-tree-panel
          [features]="featureTree().features"
          [doc]="doc()"
          [selectableSketches]="mode() === 'pick-extrude-target'"
          (sketchSelected)="onTreeSketchSelected($event)"
          (visibilityToggled)="onDatumVisibilityToggled($event)"
          (actionRequested)="onTreeAction($event)"
          class="feature-tree">
        </app-cad-feature-tree-panel>

        <div class="viewport-wrap">
          <ng-container *ngIf="!loading(); else loadingTpl">
            <app-cad-viewer
              [geometry]="geometry()"
              [selected]="selected()"
              [loading]="kernelLoading()"
              [loadProgress]="kernelLoadStatus()"
              [sketchDoc]="doc()"
              [activeSketchId]="activeSketchId()"
              (selectionChange)="onSelectionChange($event)"
              (sketchClick)="onViewerSketchClick($event)"
              (sketchPointerDown)="onViewerSketchPointerDown($event)"
              (sketchPointerMove)="onViewerSketchPointerMove($event)"
              (sketchPointerUp)="onViewerSketchPointerUp($event)">
            </app-cad-viewer>

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
    .ribbon { background: #25253a; border-bottom: 1px solid #444; }
    .tab-strip { display: flex; gap: 0; padding: 0 16px; border-bottom: 1px solid #333; }
    .tab { background: none; border: none; color: #aaa; padding: 6px 14px; font-size: 13px; cursor: pointer; border-bottom: 2px solid transparent; font-weight: 500; }
    .tab:hover { color: #fff; }
    .tab.active { color: #fff; border-bottom-color: #42a5f5; }
    .ribbon-content { padding: 6px 16px; min-height: 44px; display: flex; align-items: center; }
    .ribbon-pane { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; width: 100%; }
    .ribbon-pane[hidden] { display: none !important; }
    .ribbon-hint { font-size: 12px; opacity: 0.7; margin-left: 8px; }
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
  private kernelService = inject(CadKernelService);

  model = signal<CadModel | null>(null);
  loading = signal<boolean>(true);
  featureTree = signal<FeatureTree>(emptyFeatureTree());
  doc = signal<SketchDocument>(emptyDocument());
  activeSketchId = signal<SketchId | null>(null);
  selected = signal<string | null>(null);
  fullscreen = signal<boolean>(false);
  partID = signal<number | null>(null);
  geometry = signal<ModelGeometry | null>(null);
  kernelLoading = signal<boolean>(false);
  kernelLoadStatus = signal<string>('');
  mode = signal<EditorMode>('idle');
  pendingExtrude = signal<boolean>(false);
  // REQ 616 — ribbon tab. Auto-switches to 'sketch' when activeSketchId becomes
  // non-null and back to 'features' when it clears; user can manually override.
  activeTab = signal<'features' | 'sketch'>('features');
  private prevActiveSketchId: SketchId | null = null;
  private sketchEditorRef = viewChild<CadSketchEditorComponent>('sketchEditor');
  private kernel: KernelAdapter = makePureJsKernel();

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
    if (m === 'pick-plane') return 'Click a datum plane in the viewer to start a sketch on it.';
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

    effect(() => {
      const tree = this.featureTree();
      const doc = this.doc();
      const genId = ++this.regenGeneration;
      (async () => {
        try {
          const result = await regenerateModel(this.kernel, tree, doc);
          if (genId !== this.regenGeneration) return;
          // Filter datums by the Origin feature's visibility map.
          const origin = tree.features.find(f => f.type === 'origin') as
            | (typeof tree.features[number] & { visibility?: Record<string, boolean> })
            | undefined;
          const vis = { ...defaultDatumVisibility(), ...(origin?.visibility ?? {}) };
          const datums = buildOriginDatums().filter(d => vis[d.id] !== false);
          this.geometry.set({ ...result.geometry, datums });
          for (const err of result.errors) {
            // eslint-disable-next-line no-console
            console.warn('Regenerate:', err);
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('regenerateModel failed', e);
        }
      })();
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

  // REQ 616 — sketch pointer events forwarded from the 3D viewer (after
  // ray-plane projection into the active sketch's 2D coords).
  onViewerSketchClick(p: { x: number; y: number; shiftKey: boolean }) {
    this.sketchEditorRef()?.handleSketchClick(p);
  }
  onViewerSketchPointerDown(p: { x: number; y: number }) {
    this.sketchEditorRef()?.handleSketchPointerDown(p);
  }
  onViewerSketchPointerMove(p: { x: number; y: number }) {
    this.sketchEditorRef()?.handleSketchPointerMove(p);
  }
  onViewerSketchPointerUp(p: { x: number; y: number }) {
    this.sketchEditorRef()?.handleSketchPointerUp(p);
  }

  onSketchAction() {
    if (this.readonly()) return;
    this.pendingExtrude.set(false);
    this.setMode('pick-plane');
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

    if (m === 'pick-plane' && id.startsWith('datum:')) {
      this.startSketchOnDatum(id);
      return;
    }
    if (m === 'pick-extrude-target' && id.startsWith('datum:')) {
      this.pendingExtrude.set(true);
      this.startSketchOnDatum(id);
      return;
    }
    // (Faces / non-plane datums in pick modes do nothing — keep prompt visible.)
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
    const { loop, error } = extractClosedLoop(sketch.state);
    if (!loop) {
      this.errors.showError(error || 'Sketch profile is not a closed loop — extrude requires a closed shape');
      this.setMode('idle');
      return;
    }
    const ref = this.dialog.open(ExtrudeDialogComponent, { data: { defaultDistance: 10 }, width: '320px' });
    ref.afterClosed().subscribe((distance: number | null) => {
      this.setMode('idle');
      if (typeof distance === 'number' && distance > 0) {
        this.featureTree.set(addFeature(this.featureTree(), { type: 'extrude', sketchId, distance }));
        this.save();
      }
    });
  }

  // Tree context-menu actions (REQs 607, 609, 610, 611) and sketch deletion (REQ 608).
  onTreeAction(action: FeatureTreeAction) {
    if (this.readonly()) return;
    switch (action.action) {
      case 'edit-feature': return this.editFeature(action.featureId);
      case 'delete-feature': return this.deleteFeature(action.featureId);
      case 'toggle-feature-visibility': return this.toggleFeatureVisibility(action.featureId);
      case 'edit-sketch': return this.editSketch(action.sketchId);
      case 'delete-sketch': return this.requestDeleteSketch(action.sketchId);
      case 'toggle-sketch-visibility': return this.toggleSketchVisibility(action.sketchId);
    }
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
    const ref = this.dialog.open(ExtrudeDialogComponent, {
      data: { defaultDistance: feature.distance },
      width: '320px',
    });
    ref.afterClosed().subscribe((distance: number | null) => {
      if (typeof distance !== 'number' || distance <= 0) return;
      this.featureTree.set(updateFeatureParam<ExtrudeFeature>(this.featureTree(), featureId, { distance }));
      this.save();
    });
  }

  private deleteFeature(featureId: string) {
    const feature = this.featureTree().features.find(f => f.id === featureId);
    if (!feature || feature.type === 'origin') return;  // REQ 607: origin not deletable
    this.featureTree.set(removeFeature(this.featureTree(), featureId));
    this.save();
  }

  private toggleFeatureVisibility(featureId: string) {
    const feature = this.featureTree().features.find(f => f.id === featureId);
    if (!feature || feature.type === 'origin') return;
    const nextVisible = feature.visible === false;  // currently hidden ⇒ show
    this.featureTree.set(updateFeatureParam<ExtrudeFeature>(this.featureTree(), featureId, { visible: nextVisible }));
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
  }

  private debouncedSave: number | null = null;
  private save() {
    const m = this.model();
    if (!m || m.releaseState !== 'draft') return;
    if (this.debouncedSave) clearTimeout(this.debouncedSave);
    this.debouncedSave = window.setTimeout(() => {
      this.cadApi.update(m.id, { featureTree: this.featureTree(), sketchDoc: this.doc() }).subscribe({
        next: updated => this.model.set(updated),
        error: err => this.errors.showError(err?.error?.error || 'Save failed'),
      });
    }, 500);
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
