import { Component, input, output, signal, computed, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import type { Feature, Sketch, SketchDocument, OriginFeature, ExtrudeFeature } from '../../../cad/lib/types';
import { defaultDatumVisibility } from '../../../cad/lib/featureTree';
import { holeSpec } from '../../../cad/lib/holeSpecs';
import { originPlaneLabel } from '../../../cad/lib/datum';

export type FeatureTreeAction =
  | { action: 'edit-feature'; featureId: string }
  | { action: 'delete-feature'; featureId: string }
  | { action: 'toggle-feature-visibility'; featureId: string }
  | { action: 'toggle-feature-suppression'; featureId: string }
  | { action: 'rename-feature'; featureId: string }
  | { action: 'edit-sketch'; sketchId: string }
  | { action: 'delete-sketch'; sketchId: string }
  | { action: 'toggle-sketch-visibility'; sketchId: string }
  | { action: 'rename-sketch'; sketchId: string }
  | { action: 'change-sketch-host'; sketchId: string }
  | { action: 'toggle-cosmetic-threads-visibility' };

/** Generic row event emitted when the panel renders externally-supplied nodes
 * (e.g. the assembly tree). The host owns selection/visibility/expand/context
 * semantics — the panel just reports which node + how it was interacted with. */
export interface ExternalTreeEvent {
  type: 'select' | 'expand' | 'visibility' | 'context';
  node: TreeNode;
  ev?: MouseEvent;
}

// REQ 626 — feature selection event from a left-click on a feature row.
// Carries the modifier keys so the parent decides multi-select policy.
export interface FeatureSelectEvent {
  featureId: string;
  shiftKey: boolean;
  ctrlKey: boolean;
}

/** Sketch selection event from a left-click on a sketch row outside
 * pick-extrude-target mode. Mirrors `FeatureSelectEvent` so the parent can
 * apply the same shift/ctrl multi-select policy. */
export interface SketchSelectEvent {
  sketchId: string;
  shiftKey: boolean;
  ctrlKey: boolean;
}

export interface TreeNode {
  /** Unique within the tree; used for expansion tracking. */
  key: string;
  kind: 'feature' | 'sketch' | 'datum' | 'rollback-bar' | 'cosmetic-threads-group';
  label: string;
  iconName: string;
  iconClass: string;
  depth: number;
  expandable: boolean;
  expanded: boolean;
  /** For datums: rendered as eye/eye-off button. For features: shows a small indicator when hidden. */
  visible?: boolean;
  visibilityToggleable?: boolean;
  selectable: boolean;          // highlighted as clickable in current mode
  /** External-nodes mode: explicit selection highlight (the host owns selection). */
  selected?: boolean;
  /** Position in the feature tree for features. Used by the rollback
   * bar to grey out features past its cutoff. */
  featureIndex?: number;
  /** True when this feature is below the rollback bar. */
  rolledBack?: boolean;
  /** True when this feature has been explicitly suppressed (skipped in regen). */
  suppressed?: boolean;
  /** Stable id payload passed back through events. */
  datumId?: string;
  sketchId?: string;
  feature?: Feature;
  /** Top-level createdAt (sketch rows) — used for drag-reorder hit-testing. */
  createdAt?: number;
}

@Component({
  selector: 'app-cad-feature-tree-panel',
  standalone: true,
  host: { '[class.embedded]': 'externalNodes() !== null' },
  imports: [CommonModule, MatIconModule, MatTooltipModule, MatMenuModule],
  template: `
    <div class="panel">
      <div class="section features-section">
        <header class="panel-header">
          <mat-icon>{{ headerIcon() }}</mat-icon>
          <span>{{ headerTitle() }}</span>
        </header>
        <ul class="tree" #treeList>
        <li *ngFor="let n of nodes()"
            [attr.data-testid]="rowTestId(n)"
            [attr.data-feature-index]="n.featureIndex"
            [attr.data-node-key]="n.key"
            class="row"
            [class.dragging-sketch]="dragSketchId() !== null && n.sketchId === dragSketchId()"
            [class.depth-0]="n.depth === 0"
            [class.depth-1]="n.depth === 1"
            [class.selectable]="n.selectable"
            [class.hidden-datum]="n.kind === 'datum' && n.visible === false"
            [class.hidden-feature]="n.kind === 'feature' && n.visible === false"
            [class.hidden-sketch]="n.kind === 'sketch' && n.visible === false"
            [class.rolled-back]="n.rolledBack"
            [class.suppressed]="n.suppressed"
            [class.rollback-bar]="n.kind === 'rollback-bar'"
            [class.drag-target-above]="(dragTargetIndex() !== null && n.featureIndex === dragTargetIndex()) || (dropBeforeKey() !== null && n.key === dropBeforeKey())"
            [class.dragging-feature]="dragFeatureIndex() !== null && n.featureIndex === dragFeatureIndex()"
            [class.selected]="isRowSelected(n)"
            (mousedown)="onRowMouseDown($event, n)"
            (click)="onRowClick(n, $event)"
            (contextmenu)="onRowContextMenu($event, n)">
          <span class="chevron" *ngIf="n.expandable" (click)="toggleExpand(n, $event)">
            <mat-icon>{{ n.expanded ? 'expand_more' : 'chevron_right' }}</mat-icon>
          </span>
          <span class="chevron-spacer" *ngIf="!n.expandable && n.kind !== 'rollback-bar'"></span>
          <mat-icon class="kind-icon" [ngClass]="n.iconClass">{{ n.iconName }}</mat-icon>
          <span class="label">{{ n.label }}</span>
          <span class="dbg-id" *ngIf="debugVisible() && dbgId(n)">({{ dbgId(n) }})</span>
          <ng-container *ngIf="n.kind === 'feature' && n.feature && featureErrors().has(n.feature.id)">
            <mat-icon class="error-indicator"
                      [matTooltip]="featureErrors().get(n.feature.id) || ''"
                      [attr.data-testid]="featureErrorTestId(n)">error</mat-icon>
          </ng-container>
          <ng-container *ngIf="n.kind === 'sketch' && n.sketchId && sketchHostMissing(n.sketchId)">
            <mat-icon class="dangling-indicator"
                      matTooltip="Reference face missing — this sketch's host face was deleted. Right-click → Change reference face."
                      [attr.data-testid]="'sketch-dangling-' + n.sketchId">link_off</mat-icon>
          </ng-container>
          <button class="visibility-toggle"
                  *ngIf="n.visibilityToggleable"
                  [attr.data-testid]="visibilityTestId(n)"
                  [matTooltip]="n.visible ? 'Hide' : 'Show'"
                  (click)="onVisibilityToggleClick(n, $event)">
            <mat-icon>{{ n.visible ? 'visibility' : 'visibility_off' }}</mat-icon>
          </button>
          <mat-icon *ngIf="n.selectable && n.kind === 'sketch'" class="pick-hint">arrow_forward</mat-icon>
        </li>
        </ul>
      </div>

      <!-- Bodies section. Lists every body in the part (1 per additive
           feature with merge=false, plus a default body for merge=true
           additive chains). Each row has a visibility toggle. -->
      <div class="section bodies-section" *ngIf="showBodies()">
        <header class="panel-header">
          <mat-icon>category</mat-icon>
          <span>Bodies</span>
          <span class="count" *ngIf="bodiesView().length > 0">({{ bodiesView().length }})</span>
        </header>
        <ul class="tree">
          <li *ngIf="bodiesView().length === 0" class="row empty-row">
            <span class="label muted">No body yet — add an Extrude or Revolve.</span>
          </li>
          <li *ngFor="let b of bodiesView(); let i = index"
              class="row depth-0"
              [class.hidden-feature]="!b.visible"
              [attr.data-testid]="'body-' + b.id"
              (contextmenu)="onBodyContextMenu($event, b)">
            <span class="chevron-spacer"></span>
            <mat-icon class="kind-icon extrude">deployed_code</mat-icon>
            <span class="label">{{ b.label }}</span>
            <button class="visibility-toggle"
                    [attr.data-testid]="'body-visibility-' + b.id"
                    [matTooltip]="b.visible ? 'Hide' : 'Show'"
                    (click)="onBodyVisibilityClick(b, $event)">
              <mat-icon>{{ b.visible ? 'visibility' : 'visibility_off' }}</mat-icon>
            </button>
          </li>
        </ul>
      </div>

      <!-- Floating trigger for the context menu, positioned at the cursor on right-click. -->
      <div #menuTriggerEl
           class="menu-anchor"
           [style.left.px]="menuX()"
           [style.top.px]="menuY()"
           [matMenuTriggerFor]="ctxMenu"></div>

      <!-- Body context menu trigger — separate from the feature/sketch
           one so its menu can list body-specific actions. -->
      <div #bodyMenuTriggerEl
           class="menu-anchor"
           [style.left.px]="bodyMenuX()"
           [style.top.px]="bodyMenuY()"
           [matMenuTriggerFor]="bodyCtxMenu"></div>
      <mat-menu #bodyCtxMenu="matMenu">
        <ng-container *ngIf="contextBody() as b">
          <button mat-menu-item data-testid="ctx-body-toggle-visibility"
                  (click)="bodyVisibilityToggled.emit(b.id)">
            <mat-icon>{{ b.visible ? 'visibility_off' : 'visibility' }}</mat-icon>
            {{ b.visible ? 'Hide body' : 'Show body' }}
          </button>
          <button mat-menu-item data-testid="ctx-body-isolate"
                  (click)="bodyIsolated.emit(b.id)">
            <mat-icon>filter_center_focus</mat-icon> Isolate body
          </button>
          <button mat-menu-item data-testid="ctx-body-delete"
                  (click)="bodyDeleted.emit(b.id)">
            <mat-icon>delete</mat-icon> Delete body
          </button>
        </ng-container>
      </mat-menu>

      <mat-menu #ctxMenu="matMenu">
        <ng-container *ngIf="contextNode() as n">
          <ng-container *ngIf="ctxScope() as scope">
            <!-- Feature menu — hide Edit/Rename when targeting multiple features. -->
            <ng-container *ngIf="scope.kind === 'feature' && n.feature">
              <button *ngIf="scope.count === 1"
                      mat-menu-item data-testid="ctx-edit-feature"
                      (click)="emitAction({ action: 'edit-feature', featureId: n.feature.id })">
                <mat-icon>edit</mat-icon> Edit…
              </button>
              <button *ngIf="scope.count === 1 && featureSketchId(n.feature) as fSketchId"
                      mat-menu-item data-testid="ctx-edit-feature-sketch"
                      (click)="emitAction({ action: 'edit-sketch', sketchId: fSketchId })">
                <mat-icon>draw</mat-icon> Edit sketch
              </button>
              <button *ngIf="scope.count === 1"
                      mat-menu-item data-testid="ctx-rename-feature"
                      (click)="emitAction({ action: 'rename-feature', featureId: n.feature.id })">
                <mat-icon>drive_file_rename_outline</mat-icon> Rename
              </button>
              <button *ngIf="scope.count === 1 && n.featureIndex !== undefined"
                      mat-menu-item data-testid="ctx-rollback-here"
                      (click)="rollbackChanged.emit(n.featureIndex!)">
                <mat-icon>arrow_drop_down</mat-icon> Roll back to here
              </button>
              <button *ngIf="scope.count === 1 && rollbackBeforeIndex() !== null"
                      mat-menu-item data-testid="ctx-rollback-forward"
                      (click)="rollbackChanged.emit(null)">
                <mat-icon>arrow_drop_up</mat-icon> Roll forward to end
              </button>
              <button mat-menu-item data-testid="ctx-toggle-feature-visibility"
                      (click)="emitAction({ action: 'toggle-feature-visibility', featureId: n.feature.id })">
                <mat-icon>{{ scope.anyVisible ? 'visibility_off' : 'visibility' }}</mat-icon>
                {{ scope.anyVisible ? 'Hide' : 'Show' }}{{ scope.count > 1 ? ' (' + scope.count + ')' : '' }}
              </button>
              <button mat-menu-item data-testid="ctx-toggle-feature-suppression"
                      (click)="emitAction({ action: 'toggle-feature-suppression', featureId: n.feature.id })">
                <mat-icon>{{ scope.anySuppressed ? 'play_arrow' : 'block' }}</mat-icon>
                {{ scope.anySuppressed ? 'Unsuppress' : 'Suppress' }}{{ scope.count > 1 ? ' (' + scope.count + ')' : '' }}
              </button>
              <button mat-menu-item data-testid="ctx-delete-feature"
                      (click)="emitAction({ action: 'delete-feature', featureId: n.feature.id })">
                <mat-icon>delete</mat-icon> Delete{{ scope.count > 1 ? ' (' + scope.count + ')' : '' }}
              </button>
              <!-- Debug: the internal feature id (hash) — what regen errors,
                   topology ids (featureId/eN), and externalRefs reference.
                   Only shown in debug mode (footer bug toggle). -->
              <button *ngIf="scope.count === 1 && debugVisible()"
                      mat-menu-item data-testid="ctx-copy-feature-id"
                      (click)="copyToClipboard(n.feature.id)">
                <mat-icon>content_copy</mat-icon> Copy feature name
              </button>
            </ng-container>
            <!-- Sketch menu — same pattern. -->
            <ng-container *ngIf="scope.kind === 'sketch' && n.sketchId">
              <!-- Reference plane/face the sketch is hosted on (info + re-pick). -->
              <div *ngIf="scope.count === 1" class="ctx-info" data-testid="ctx-sketch-host">
                <mat-icon>filter_none</mat-icon> Reference: {{ sketchHostLabel(n.sketchId) }}
              </div>
              <button *ngIf="scope.count === 1"
                      mat-menu-item data-testid="ctx-change-sketch-host"
                      (click)="emitAction({ action: 'change-sketch-host', sketchId: n.sketchId })">
                <mat-icon>swap_horiz</mat-icon> Change reference face…
              </button>
              <button *ngIf="scope.count === 1"
                      mat-menu-item data-testid="ctx-edit-sketch"
                      (click)="emitAction({ action: 'edit-sketch', sketchId: n.sketchId })">
                <mat-icon>edit</mat-icon> Edit sketch
              </button>
              <button *ngIf="scope.count === 1"
                      mat-menu-item data-testid="ctx-rename-sketch"
                      (click)="emitAction({ action: 'rename-sketch', sketchId: n.sketchId })">
                <mat-icon>drive_file_rename_outline</mat-icon> Rename
              </button>
              <button *ngIf="scope.count === 1"
                      mat-menu-item data-testid="ctx-sketch-rollback-here"
                      (click)="rollbackToSketch.emit(n.sketchId)">
                <mat-icon>arrow_drop_down</mat-icon> Roll back to here
              </button>
              <button *ngIf="scope.count === 1 && rollbackBeforeIndex() !== null"
                      mat-menu-item data-testid="ctx-sketch-rollback-forward"
                      (click)="rollbackChanged.emit(null)">
                <mat-icon>arrow_drop_up</mat-icon> Roll forward to end
              </button>
              <button mat-menu-item data-testid="ctx-toggle-sketch-visibility"
                      (click)="emitAction({ action: 'toggle-sketch-visibility', sketchId: n.sketchId })">
                <mat-icon>{{ scope.anyVisible ? 'visibility_off' : 'visibility' }}</mat-icon>
                {{ scope.anyVisible ? 'Hide' : 'Show' }}{{ scope.count > 1 ? ' (' + scope.count + ')' : '' }}
              </button>
              <button mat-menu-item data-testid="ctx-delete-sketch"
                      (click)="emitAction({ action: 'delete-sketch', sketchId: n.sketchId })">
                <mat-icon>delete</mat-icon> Delete sketch{{ scope.count > 1 ? 'es (' + scope.count + ')' : '' }}
              </button>
              <!-- Debug: the internal sketch id (hash). Only in debug mode. -->
              <button *ngIf="scope.count === 1 && debugVisible()"
                      mat-menu-item data-testid="ctx-copy-sketch-id"
                      (click)="copyToClipboard(n.sketchId)">
                <mat-icon>content_copy</mat-icon> Copy sketch name
              </button>
            </ng-container>
          </ng-container>
        </ng-container>
      </mat-menu>
    </div>
  `,
  styles: [`
    /* Custom elements default to display: inline, so percentage heights
       on .panel below don't resolve and the bottom section can clip its
       last row (visibility-toggle button gets cut off). Pin the host to a
       real flex column with its parent's full height. */
    :host { display: flex; flex-direction: column; height: 100%; min-height: 0; }
    /* Embedded (external-nodes) mode: flow with the host's other content instead
       of filling 100% height. */
    :host(.embedded) { display: block; height: auto; min-height: 0; }
    :host(.embedded) .panel { flex: 0 0 auto; }
    :host(.embedded) .section { flex: 0 0 auto; overflow: visible; }
    :host(.embedded) .section .tree { flex: 0 0 auto; overflow: visible; }
    :host(.embedded) .panel-header { padding: 8px 12px; }
    .panel { display: flex; flex-direction: column; flex: 1 1 0; min-height: 0; }
    /* Two equal-height sections stacked vertically. Each section scrolls its
       own list independently so a long feature tree doesn't push bodies
       off-screen, and a long bodies list doesn't push features off-screen. */
    .section { flex: 1 1 0; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
    .features-section { border-bottom: 1px solid #555; }
    .section .tree { flex: 1 1 0; overflow-y: auto; }
    .panel-header { display: flex; align-items: center; gap: 8px; padding: 12px; border-bottom: 1px solid #444; font-weight: 600; font-size: 13px; text-transform: uppercase; opacity: 0.75; flex-shrink: 0; }
    .panel-header .count { opacity: 0.55; font-weight: 400; text-transform: none; margin-left: 2px; }
    .empty-row { font-style: italic; opacity: 0.55; }
    .label.muted { opacity: 0.7; }
    .tree { list-style: none; padding: 0; margin: 0; user-select: none; }
    .row { display: flex; align-items: center; gap: 6px; padding: 6px 12px; border-bottom: 1px solid #2a2a3a; font-size: 13px; line-height: 1.2; }
    .row.depth-1 { padding-left: 28px; background: #1f1f2e; }
    .row.selectable { cursor: pointer; }
    .row.selectable:hover { background: rgba(255,255,255,0.06); }
    .row.hidden-datum .label { opacity: 0.4; text-decoration: line-through; }
    .row.hidden-feature .label { opacity: 0.5; font-style: italic; }
    .row.hidden-sketch .label { opacity: 0.5; font-style: italic; }
    .row.selected { background: rgba(255, 183, 77, 0.18); }
    .row.selected.depth-1 { background: rgba(255, 183, 77, 0.12); }
    .hidden-indicator { font-size: 14px; width: 14px; height: 14px; opacity: 0.55; }
    .error-indicator { font-size: 16px; width: 16px; height: 16px; color: #ef5350; flex-shrink: 0; }
    .dangling-indicator { font-size: 16px; width: 16px; height: 16px; color: #ffa726; flex-shrink: 0; cursor: help; }
    .menu-anchor { position: fixed; width: 0; height: 0; }
    .chevron { display: inline-flex; align-items: center; width: 18px; cursor: pointer; opacity: 0.7; }
    .chevron mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .chevron:hover { opacity: 1; }
    .chevron-spacer { display: inline-block; width: 18px; }
    .kind-icon { font-size: 18px; width: 18px; height: 18px; }
    .kind-icon.origin { color: #ffeb3b; }
    .kind-icon.part { color: #90a4ae; }
    .kind-icon.mate { color: #42a5f5; }
    .kind-icon.extrude { color: #4caf50; }
    .kind-icon.sketch { color: #42a5f5; }
    .kind-icon.datum-point { color: #fff; }
    .kind-icon.datum-axis-x { color: #e53935; }
    .kind-icon.datum-axis-y { color: #43a047; }
    .kind-icon.datum-axis-z { color: #1e88e5; }
    .kind-icon.datum-plane-xy { color: #1e88e5; }
    .kind-icon.datum-plane-yz { color: #e53935; }
    .kind-icon.datum-plane-xz { color: #43a047; }
    .label { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dbg-id { flex: 1 0 auto; margin-left: 4px; font-family: ui-monospace, monospace; font-size: 10px; opacity: 0.45; }
    .ctx-info { display: flex; align-items: center; gap: 8px; padding: 6px 16px; font-size: 11px; opacity: 0.65; cursor: default; }
    .ctx-info mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .visibility-toggle { border: none; background: none; cursor: pointer; opacity: 0.55; padding: 2px; display: inline-flex; align-items: center; justify-content: center; color: inherit; }
    .visibility-toggle:hover { opacity: 1; }
    .visibility-toggle mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .pick-hint { font-size: 14px; width: 14px; height: 14px; opacity: 0.7; color: #42a5f5; }

    /* SolidWorks-style rollback bar — a thick yellow horizontal divider
       between feature rows. Rows below it (.rolled-back class) render
       muted + strike-through. The bar itself is a clickable row so the
       user can right-click to roll forward. */
    .row.rollback-bar {
      cursor: grab;
      padding: 2px 12px;
      background: rgba(255, 235, 59, 0.16);
      border-top: 2px solid #ffc107;
      border-bottom: 2px solid #ffc107;
      color: #ffc107;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      user-select: none;
    }
    .row.rollback-bar .kind-icon { color: #ffc107; }
    .row.rollback-bar:hover { background: rgba(255, 235, 59, 0.24); }
    .row.rollback-bar:active { cursor: grabbing; }
    /* Drop-target preview during a rollback-bar drag. A 2px yellow
       border-top on the row that the bar would land BEFORE, so the
       user sees the prospective new position before releasing. Pairs
       with the rollback bar's grabbing cursor. */
    .row.drag-target-above {
      box-shadow: inset 0 2px 0 0 #ffc107;
    }
    /* Feature being dragged to reorder — dimmed so the gold drop line reads. */
    .row.dragging-feature, .row.dragging-sketch { opacity: 0.45; background: rgba(255, 193, 7, 0.08); }
    .row.rolled-back .label,
    .row.rolled-back .kind-icon {
      opacity: 0.4;
      text-decoration: line-through;
    }
    /* Suppressed features render greyer + strike-through so the user
       can tell at a glance which features are skipped during regen. */
    .row.suppressed .label,
    .row.suppressed .kind-icon {
      opacity: 0.45;
      text-decoration: line-through;
      font-style: italic;
    }
  `],
})
export class CadFeatureTreePanelComponent {
  features = input<Feature[]>([]);
  doc = input<SketchDocument | null>(null);
  selectableSketches = input<boolean>(false);
  // ── External-nodes mode (e.g. assembly tree) ────────────────────────
  /** When non-null, the panel renders THESE nodes verbatim instead of building
   * them from `features`, and routes row interactions to `externalEvent`. */
  externalNodes = input<TreeNode[] | null>(null);
  headerTitle = input<string>('Feature Tree');
  headerIcon = input<string>('account_tree');
  showBodies = input<boolean>(true);
  /** Debug mode (footer bug toggle). Gates developer-only context-menu items
   * — the "Copy feature/sketch name" entries that surface the internal id. */
  debugVisible = input<boolean>(false);
  /** Generic row interaction, emitted only in external-nodes mode. */
  externalEvent = output<ExternalTreeEvent>();
  // Map of featureId → friendly error message. Features in this map render
  // with a red error icon + tooltip so the user can identify which feature
  // failed during the last regenerate. Empty map = no errors.
  featureErrors = input<Map<string, string>>(new Map());

  sketchSelected = output<string>();
  /** Fired on a left-click of a sketch row outside pick-extrude-target mode.
   * Click selects (highlights) the sketch; right-click context menu still
   * handles Edit / Delete / Hide. The parent decides multi-select policy. */
  sketchSelect = output<SketchSelectEvent>();
  visibilityToggled = output<string>(); // datum id
  actionRequested = output<FeatureTreeAction>();
  // REQ 626 — selected feature ids drive row highlighting; the click event
  // lets the parent apply set/toggle policy based on modifier keys.
  selectedFeatures = input<Set<string>>(new Set());
  featureSelect = output<FeatureSelectEvent>();
  /** Set of selected sketch ids — parallel to `selectedFeatures`. */
  selectedSketches = input<Set<string>>(new Set());
  /** Set of selected origin-datum ids (origin / x_axis / … / xy_plane / …) —
   * parallel to the feature/sketch sets so the origin's point, axes, and
   * planes are selectable like any other tree item. */
  selectedDatums = input<Set<string>>(new Set());
  /** Fired on a left-click of an origin-datum row (point / axis / plane). */
  datumSelect = output<{ datumId: string; shiftKey: boolean; ctrlKey: boolean }>();
  /** Sketch ids whose host face the kernel reports as missing (deleted, not
   * re-tagged) — flagged with a warning indicator on the sketch row. */
  danglingSketchIds = input<Set<string>>(new Set());

  // ── Bodies panel inputs / outputs ───────────────────────────────────
  /** Body roster surfaced in the bottom half of the panel. Editor
   * populates from the regen response. */
  bodyList = input<Array<{ id: string; name: string | null }>>([]);
  /** Body ids currently hidden — drawn faded with a closed-eye icon
   * and excluded from rendered geometry. */
  hiddenBodyIds = input<Set<string>>(new Set());
  /** Body visibility toggled — emit the body id. Editor flips its
   * hiddenBodies signal in response. */
  bodyVisibilityToggled = output<string>();
  /** Isolate body — hide everything but this one. */
  bodyIsolated = output<string>();
  /** Delete body — drops every feature whose target was this body. */
  bodyDeleted = output<string>();

  // ── Rollback bar inputs / outputs ───────────────────────────────────
  /** Index of the feature the rollback bar sits BEFORE. null = no
   * rollback (bar at the end). Driven by the editor. */
  rollbackBeforeIndex = input<number | null>(null);
  /** The createdAt the bar sits before — lets the bar render before a SKETCH
   * (which has no feature index), treating sketches like features. null = no
   * rollback. Editor derives it from the rollback anchor. */
  rollbackBeforeCreatedAt = input<number | null>(null);
  /** User asked to roll back to before feature at this index. Editor
   * sets its own rollbackBeforeIndex in response. */
  rollbackChanged = output<number | null>();
  /** User asked to roll back to before this sketch. */
  rollbackToSketch = output<string>();
  /** Drag-reorder (feature 2): a feature row dragged to a new slot. `fromIndex`
   * and `toIndex` are array indices in featureTree.features; `toIndex` is the
   * index to land BEFORE (features.length = move to the end). `createdAt` is the
   * exact display position (so a feature can land between sketches). */
  reorderFeature = output<{ fromIndex: number; toIndex: number; createdAt: number }>();
  /** Drag-reorder a sketch row — sketches are ordered by createdAt, so we emit
   * the new createdAt to stamp (midpoint of the drop neighbors). */
  reorderSketch = output<{ sketchId: string; createdAt: number }>();
  // REQ 665 — Cosmetic threads group state.
  cosmeticThreadsCount = input<number>(0);
  cosmeticThreadsVisible = input<boolean>(true);

  // Expansion state: keys for expanded nodes (origin is expanded by default).
  // REQ 622 — Origin collapsed by default. Per-session state; user can expand
  // and the expansion is preserved while the editor is open.
  expanded = signal<Set<string>>(new Set<string>());

  // Context menu state: position the floating trigger at the cursor and remember
  // which node the menu is operating on.
  menuX = signal(0);
  menuY = signal(0);
  contextNode = signal<TreeNode | null>(null);
  // Separate context-menu state for body rows — independent X/Y +
  // contextBody so menu placement / contents don't collide with the
  // feature/sketch one.
  bodyMenuX = signal(0);
  bodyMenuY = signal(0);
  contextBody = signal<{ id: string; label: string; visible: boolean } | null>(null);
  @ViewChild('menuTriggerEl', { read: MatMenuTrigger }) private menuTrigger?: MatMenuTrigger;
  @ViewChild('bodyMenuTriggerEl', { read: MatMenuTrigger }) private bodyMenuTrigger?: MatMenuTrigger;
  @ViewChild('treeList') private treeList?: ElementRef<HTMLUListElement>;

  // ── Rollback bar drag ────────────────────────────────────────────────
  // Drag the SolidWorks-style rollback bar between feature rows to move
  // the rollback position. dragTargetIndex tracks the prospective new
  // position during the drag (the feature index the bar would land BEFORE
  // on mouseup); rendered rows highlight via the drag-target-above class
  // so the user sees where the bar will drop. mouseup commits via the
  // rollbackChanged output, exactly like the context-menu action.
  dragTargetIndex = signal<number | null>(null);
  private rollbackDragMove?: (ev: MouseEvent) => void;
  private rollbackDragUp?: (ev: MouseEvent) => void;

  /** Body roster computed into the shape the template renders — adds
   * a default "Body N" label + the visibility flag. */
  bodiesView = computed<Array<{ id: string; label: string; visible: boolean }>>(() => {
    const hidden = this.hiddenBodyIds();
    return this.bodyList().map((b, i) => ({
      id: b.id,
      label: b.name && b.name.trim() ? b.name : `Body ${i + 1}`,
      visible: !hidden.has(b.id),
    }));
  });

  onBodyVisibilityClick(b: { id: string }, ev: MouseEvent): void {
    ev.stopPropagation();
    this.bodyVisibilityToggled.emit(b.id);
  }

  onBodyContextMenu(ev: MouseEvent, b: { id: string; label: string; visible: boolean }): void {
    ev.preventDefault();
    this.bodyMenuX.set(ev.clientX);
    this.bodyMenuY.set(ev.clientY);
    this.contextBody.set(b);
    queueMicrotask(() => this.bodyMenuTrigger?.openMenu());
  }

  /** Debug helper — copy an internal id (feature/sketch hash) to the
   * clipboard. These ids are what regen errors, topology ids, and
   * externalRefs reference, so being able to grab one from the tree makes
   * bug reports precise. */
  copyToClipboard(text: string | undefined): void {
    if (!text) return;
    void navigator.clipboard?.writeText(text);
  }

  // What the context menu will act on, given the right-clicked node and the
  // current selection. Mirrors the OS-file-manager rule: if the right-clicked
  // item is part of the current selection, the action targets the whole
  // selection; otherwise it targets only the right-clicked item. The menu
  // template hides edit/rename when count > 1 (those actions don't make
  // sense in bulk) and appends a "(N)" suffix to bulk toggle/delete.
  ctxScope = computed<{ kind: 'feature' | 'sketch' | null; count: number; anyVisible: boolean; anySuppressed: boolean }>(() => {
    const n = this.contextNode();
    if (!n) return { kind: null, count: 0, anyVisible: false, anySuppressed: false };
    if (n.kind === 'feature' && n.feature && n.feature.type !== 'origin') {
      const sel = this.selectedFeatures();
      const ids = sel.has(n.feature.id) && sel.size > 1 ? Array.from(sel) : [n.feature.id];
      const feats = this.features();
      const anyVisible = ids.some(id => {
        const f = feats.find(x => x.id === id) as ExtrudeFeature | undefined;
        return !!f && f.visible !== false;
      });
      const anySuppressed = ids.some(id => {
        const f = feats.find(x => x.id === id) as ExtrudeFeature | undefined;
        return !!f && f.suppressed === true;
      });
      return { kind: 'feature', count: ids.length, anyVisible, anySuppressed };
    }
    if (n.kind === 'sketch' && n.sketchId) {
      const sel = this.selectedSketches();
      const ids = sel.has(n.sketchId) && sel.size > 1 ? Array.from(sel) : [n.sketchId];
      const doc = this.doc();
      const anyVisible = ids.some(id => {
        const s = doc?.sketches[id];
        return !!s && s.visible !== false;
      });
      return { kind: 'sketch', count: ids.length, anyVisible, anySuppressed: false };
    }
    return { kind: null, count: 0, anyVisible: false, anySuppressed: false };
  });

  nodes = computed<TreeNode[]>(() => {
    const ext = this.externalNodes();
    if (ext) return ext;
    const out: TreeNode[] = [];
    const features = this.features();
    const doc = this.doc();
    const expanded = this.expanded();
    const sketchesUsed = new Set<string>();
    const rollback = this.rollbackBeforeIndex();

    // SolidWorks-style chronological tree. Top-level rows are features
    // + orphan sketches sorted by createdAt; sketches consumed by a
    // feature render as the feature's CHILD instead of as their own
    // row. The feature's index in featureTree.features (NOT the display
    // position) is what the rollback bar gates against.
    //
    // Exception: in pick-extrude-target mode (selectableSketches=true),
    // surface every sketch — consumed or orphan — at the top level so
    // the user can click any sketch as the new extrude's source
    // without having to expand the parent feature first. A sketch may
    // be re-extruded into a second feature with different region picks
    // (common pattern: extrude one region, then create a new extrude
    // from the same sketch with a different region selection).
    const pickMode = this.selectableSketches();
    const consumedSketchIds = new Set<string>();
    for (const f of features) {
      if (f.type !== 'origin') {
        const sid = (f as any).sketchId as string | undefined;
        if (sid) consumedSketchIds.add(sid);
      }
    }
    type TopLevel =
      | { kind: 'feature'; createdAt: number; feature: Feature; index: number }
      | { kind: 'orphanSketch'; createdAt: number; sketch: Sketch };
    const topLevel: TopLevel[] = [];
    features.forEach((f, idx) => {
      topLevel.push({
        kind: 'feature',
        createdAt: f.createdAt ?? (f.type === 'origin' ? 0 : idx + 1),
        feature: f,
        index: idx,
      });
    });
    if (doc) {
      for (const s of Object.values(doc.sketches)) {
        if (!pickMode && consumedSketchIds.has(s.id)) continue;
        // Fall back to the numeric tail of the sketch id when createdAt
        // is missing (defensive — backfill should have populated it).
        const fallback = parseInt(s.id.replace(/^\D+/, ''), 10) || 0;
        topLevel.push({ kind: 'orphanSketch', createdAt: s.createdAt ?? fallback, sketch: s });
      }
    }
    topLevel.sort((a, b) => a.createdAt - b.createdAt);

    // Rollback bar sits before the first top-level row (feature OR sketch)
    // whose createdAt reaches the bar threshold — so it can land before a
    // sketch, treating sketches like features. The threshold is the editor's
    // createdAt anchor; the feature regen cutoff (rollbackBeforeIndex) is the
    // matching index.
    const barCa = this.rollbackBeforeCreatedAt();
    let barInserted = false;
    const maybeBar = (itemCa: number) => {
      if (barInserted || barCa === null || itemCa < barCa) return;
      barInserted = true;
      out.push({
        key: '__rollback_bar__',
        kind: 'rollback-bar',
        label: 'Rolled back to here',
        iconName: 'arrow_drop_down',
        iconClass: 'rollback',
        depth: 0,
        expandable: false,
        expanded: false,
        selectable: false,
      });
    };

    for (const item of topLevel) {
      maybeBar(item.createdAt);
      if (item.kind === 'feature') {
        this._appendFeatureNodes(item.feature, item.index, rollback, expanded, doc, sketchesUsed, out);
      } else {
        const s = item.sketch;
        const defaultSketchLabel = `${s.id} — ${this.hostLabel(s.hostId)}`;
        out.push({
          key: s.id,
          kind: 'sketch',
          label: s.name && s.name.trim() ? s.name : defaultSketchLabel,
          iconName: 'draw',
          iconClass: 'sketch',
          depth: 0,
          expandable: false,
          expanded: false,
          selectable: this.selectableSketches(),
          visible: s.visible !== false,
          visibilityToggleable: true,
          sketchId: s.id,
          createdAt: item.createdAt,
          // Greyed below the bar, like features.
          rolledBack: barCa !== null && item.createdAt >= barCa,
        });
      }
    }

    // REQ 665 — Cosmetic Threads group row, appended at the bottom
    // when at least one tapped Hole feature exists. Mirrors the
    // Datums group pattern: single visibility toggle hides every
    // thread shell across the model.
    if (this.cosmeticThreadsCount() > 0) {
      out.push({
        key: 'cosmetic-threads-group',
        kind: 'cosmetic-threads-group',
        label: `Cosmetic Threads (${this.cosmeticThreadsCount()})`,
        iconName: 'graphic_eq',
        iconClass: 'origin',
        depth: 0,
        expandable: false,
        expanded: false,
        selectable: false,
        visible: this.cosmeticThreadsVisible(),
        visibilityToggleable: true,
      });
    }

    return out;
  });

  /** Body of the per-feature emit, factored so the rollback-bar inject
   * loop stays readable. The original logic lives unchanged below. */
  private _appendFeatureNodes(
    f: Feature, idx: number, rollback: number | null,
    expanded: Set<string>,
    doc: SketchDocument | null,
    sketchesUsed: Set<string>,
    out: TreeNode[],
  ): void {
    const isRolledBack = rollback !== null && idx >= rollback;
    if (f.type === 'origin') {
        const isOpen = expanded.has('origin-children');
        const vis = { ...defaultDatumVisibility(), ...((f as OriginFeature).visibility ?? {}) };
        // The Origin's show/hide toggles ALL its datums together; the row reads
        // as "visible" when any datum is shown (matching the per-datum eyes).
        const anyDatumVisible = Object.keys(vis).some(k => vis[k] !== false);
        out.push({
          key: f.id,
          kind: 'feature',
          label: 'Origin',
          iconName: 'crop_free',
          iconClass: 'origin',
          depth: 0,
          expandable: true,
          expanded: isOpen,
          selectable: false,
          visible: anyDatumVisible,
          visibilityToggleable: true,
          featureIndex: idx,
          rolledBack: isRolledBack,
          feature: f,
        });
        if (isOpen) {
          out.push(this.datumNode('origin', 'Origin point', 'fiber_manual_record', 'datum-point', vis));
          out.push(this.datumNode('x_axis', 'X axis', 'east', 'datum-axis-x', vis));
          out.push(this.datumNode('y_axis', 'Y axis', 'north', 'datum-axis-y', vis));
          out.push(this.datumNode('z_axis', 'Z axis', 'open_in_new', 'datum-axis-z', vis));
          out.push(this.datumNode('xy_plane', originPlaneLabel('xy_plane')!, 'rectangle', 'datum-plane-xy', vis));
          out.push(this.datumNode('yz_plane', originPlaneLabel('yz_plane')!, 'rectangle', 'datum-plane-yz', vis));
          out.push(this.datumNode('xz_plane', originPlaneLabel('xz_plane')!, 'rectangle', 'datum-plane-xz', vis));
        }
      } else if (f.type === 'extrude' || f.type === 'cutExtrude' || f.type === 'revolve' || f.type === 'cutRevolve') {
        const ef = f as ExtrudeFeature;  // structural overlap covers all four for tree-display purposes
        const sketch = doc?.sketches[ef.sketchId] ?? null;
        const hasChild = !!sketch;
        const isOpen = expanded.has(f.id);
        const isCut = f.type === 'cutExtrude' || f.type === 'cutRevolve';
        const isRevolve = f.type === 'revolve' || f.type === 'cutRevolve';
        // REQ 624: user-supplied name if present, else the default summary.
        const defaultLabel = isRevolve
          ? `${isCut ? 'Cut-Revolve' : 'Revolve'} · ${(f as any).angle}°${(f as any).flipped ? ' (flipped)' : ''}`
          : `${isCut ? 'Cut' : 'Extrude'} · ${ef.distance}${ef.flipped ? ' (flipped)' : ''}`;
        out.push({
          key: f.id,
          kind: 'feature',
          label: ef.name && ef.name.trim() ? ef.name : defaultLabel,
          iconName: isRevolve ? (isCut ? 'remove_circle_outline' : '360') : isCut ? 'vertical_align_bottom' : 'vertical_align_top',
          iconClass: 'extrude',
          depth: 0,
          expandable: hasChild,
          expanded: isOpen,
          selectable: false,
          visible: ef.visible !== false,
          featureIndex: idx,
          rolledBack: isRolledBack,
          suppressed: ef.suppressed === true,
          feature: f,
        });
        if (sketch) {
          sketchesUsed.add(sketch.id);
          // Skip the nested child row in pick-extrude-target mode — the
          // sketch is already rendered at the top level for one-click
          // picking. Avoids the duplicate row.
          if (isOpen && !this.selectableSketches()) {
            const defaultSketchLabel = `${sketch.id} — ${this.hostLabel(sketch.hostId)}`;
            out.push({
              key: `child:${sketch.id}`,
              kind: 'sketch',
              label: sketch.name && sketch.name.trim() ? sketch.name : defaultSketchLabel,
              iconName: 'draw',
              iconClass: 'sketch',
              depth: 1,
              expandable: false,
              expanded: false,
              selectable: this.selectableSketches(),
              visible: sketch.visible !== false,
              visibilityToggleable: true,
              sketchId: sketch.id,
            });
          }
        }
      } else if (f.type === 'sweep' || f.type === 'cutSweep') {
        // Sweep variants reference two sketches (profile + path); render
        // both as labelled children when expanded. Visually identical row
        // shape to extrude/revolve so the tree feels consistent.
        const sf = f;
        const profile = doc?.sketches[sf.profileSketchId] ?? null;
        const path = doc?.sketches[sf.pathSketchId] ?? null;
        const hasChild = !!profile || !!path;
        const isOpen = expanded.has(f.id);
        const isCut = f.type === 'cutSweep';
        const defaultLabel = isCut ? 'Cut-Sweep' : 'Sweep';
        out.push({
          key: f.id,
          kind: 'feature',
          label: sf.name && sf.name.trim() ? sf.name : defaultLabel,
          iconName: isCut ? 'turn_right' : 'route',
          iconClass: 'extrude',
          depth: 0,
          expandable: hasChild,
          expanded: isOpen,
          selectable: false,
          visible: sf.visible !== false,
          featureIndex: idx,
          rolledBack: isRolledBack,
          suppressed: sf.suppressed === true,
          feature: f,
        });
        if (isOpen && !this.selectableSketches()) {
          for (const [role, sk] of [['Profile', profile], ['Path', path]] as const) {
            if (!sk) continue;
            sketchesUsed.add(sk.id);
            const defaultSketchLabel = `${role}: ${sk.id} — ${this.hostLabel(sk.hostId)}`;
            out.push({
              key: `child:${sk.id}:${role}`,
              kind: 'sketch',
              label: sk.name && sk.name.trim() ? `${role}: ${sk.name}` : defaultSketchLabel,
              iconName: 'draw',
              iconClass: 'sketch',
              depth: 1,
              expandable: false,
              expanded: false,
              selectable: false,
              visible: sk.visible !== false,
              visibilityToggleable: true,
              sketchId: sk.id,
            });
          }
        } else if (profile) {
          sketchesUsed.add(profile.id);
        }
        if (path) sketchesUsed.add(path.id);
      } else if (f.type === 'hole') {
        // REQ 663 — Hole Wizard. Direct face-pick placements; no
        // sketch child. Label shows hole type + size + placement count.
        const hf = f as any;
        const kindLabel = ({
          drill: 'Drill',
          counterbore: 'CBORE',
          countersink: 'CSK',
          tapped: 'Tap',
        } as Record<string, string>)[hf.holeType] ?? hf.holeType;
        let displaySize = String(hf.size);
        try { displaySize = holeSpec(hf.standard, hf.size).label; } catch { /* keep raw */ }
        const endLabel = hf.endCondition?.kind === 'blind'
          ? `blind ${hf.endCondition.depth}mm`
          : 'through all';
        const count = Array.isArray(hf.placements) ? hf.placements.length : 0;
        const defaultLabel = `Hole · ${kindLabel} ${displaySize} × ${count} (${endLabel})`;
        out.push({
          key: f.id,
          kind: 'feature',
          label: hf.name && hf.name.trim() ? hf.name : defaultLabel,
          iconName: 'radio_button_unchecked',
          iconClass: 'extrude',
          depth: 0,
          expandable: false,
          expanded: false,
          selectable: false,
          visible: hf.visible !== false,
          featureIndex: idx,
          rolledBack: isRolledBack,
          suppressed: hf.suppressed === true,
          feature: f,
        });
      } else if (f.type === 'fillet' || f.type === 'chamfer') {
        // 3D edge blends — no sketch child. Label shows the value
        // (radius / distance) + edge count for at-a-glance reading.
        const bf = f as any;
        const value = f.type === 'fillet' ? bf.radius : bf.distance;
        const count = Array.isArray(bf.edges) ? bf.edges.length : 0;
        const defaultLabel = `${f.type === 'fillet' ? 'Fillet' : 'Chamfer'} · ${value}mm × ${count} edge${count === 1 ? '' : 's'}`;
        out.push({
          key: f.id,
          kind: 'feature',
          label: bf.name && bf.name.trim() ? bf.name : defaultLabel,
          iconName: f.type === 'fillet' ? 'rounded_corner' : 'format_shapes',
          iconClass: 'extrude',
          depth: 0,
          expandable: false,
          expanded: false,
          selectable: false,
          visible: bf.visible !== false,
          featureIndex: idx,
          rolledBack: isRolledBack,
          suppressed: bf.suppressed === true,
          feature: f,
        });
      } else if (f.type === 'shell') {
        // Shell — label includes the thickness (with direction sign so
        // the user can tell inward from outward at a glance). REQ 659.
        // Shell has no visibility toggle: hiding it would leave the
        // body in a weird half-hollowed state that doesn't match any
        // real CAD semantics (suppress is the right tool for that).
        const sf = f as any;
        const sign = sf.direction === 'outward' ? '+' : '−';
        const defaultLabel = `Shell · ${sign}${Number(sf.thickness ?? 0).toFixed(2)}mm × ${(sf.faces || []).length} face${(sf.faces || []).length === 1 ? '' : 's'}`;
        out.push({
          key: f.id,
          kind: 'feature',
          label: sf.name && sf.name.trim() ? sf.name : defaultLabel,
          iconName: 'view_in_ar',
          iconClass: 'extrude',
          depth: 0,
          expandable: false,
          expanded: false,
          selectable: true,
          visible: true,
          visibilityToggleable: false,
          featureIndex: idx,
          rolledBack: isRolledBack,
          suppressed: sf.suppressed === true,
          feature: f,
        });
      } else if (f.type === 'mirror' || f.type === 'linearPattern' || f.type === 'circularPattern') {
        // Pattern / Mirror features — no sketch child. Label includes
        // copy count / mirror plane so the tree shows the shape at a
        // glance. REQ 658.
        const pf = f as any;
        let defaultLabel = '';
        let iconName = 'flip';
        if (f.type === 'mirror') {
          const ref = pf.planeRef;
          const planeLabel = ref?.kind === 'datum'
            ? String(ref.datumId).replace(/_/g, ' ')
            : 'face';
          defaultLabel = `Mirror · across ${planeLabel}`;
          iconName = 'flip';
        } else if (f.type === 'linearPattern') {
          const c1 = pf.direction1?.count ?? 0;
          const c2 = pf.direction2?.count;
          const totalCopies = c2 ? c1 * c2 - 1 : Math.max(0, c1 - 1);
          defaultLabel = `Linear Pattern · ${totalCopies} ${totalCopies === 1 ? 'copy' : 'copies'}`;
          iconName = 'grid_on';
        } else {
          const cc = pf.count ?? 0;
          const copies = Math.max(0, cc - 1);
          defaultLabel = `Circular Pattern · ${copies} ${copies === 1 ? 'copy' : 'copies'}`;
          iconName = 'rotate_right';
        }
        out.push({
          key: f.id,
          kind: 'feature',
          label: pf.name && pf.name.trim() ? pf.name : defaultLabel,
          iconName,
          iconClass: 'extrude',
          depth: 0,
          expandable: false,
          expanded: false,
          selectable: true,
          visible: pf.visible !== false,
          // Mirror + Linear Pattern have no show/hide (hiding the derived copies
          // is confusing — use Suppress instead). Circular Pattern keeps it.
          visibilityToggleable: f.type === 'circularPattern',
          featureIndex: idx,
          rolledBack: isRolledBack,
          suppressed: pf.suppressed === true,
          feature: f,
        });
      } else if (f.type === 'mirrorBody') {
        // REQ 666 — Mirror Body.
        const mf = f as any;
        const planeLabel = mf.planeRef?.kind === 'datum'
          ? String(mf.planeRef.datumId).replace(/_/g, ' ')
          : 'face';
        const count = Array.isArray(mf.bodyIds) ? mf.bodyIds.length : 0;
        const verb = mf.keepOriginals === false ? 'in place' : 'keep originals';
        const defaultLabel = `Mirror Body · ${count} ${count === 1 ? 'body' : 'bodies'} across ${planeLabel} (${verb})`;
        out.push({
          key: f.id,
          kind: 'feature',
          label: mf.name && mf.name.trim() ? mf.name : defaultLabel,
          iconName: 'flip',
          iconClass: 'extrude',
          depth: 0,
          expandable: false,
          expanded: false,
          selectable: true,
          visible: true,
          visibilityToggleable: false,
          featureIndex: idx,
          rolledBack: isRolledBack,
          suppressed: mf.suppressed === true,
          feature: f,
        });
      } else if (f.type === 'moveCopyBody') {
        // REQ 667 — Move/Copy Body.
        const mcf = f as any;
        const parts: string[] = [];
        if (Array.isArray(mcf.translate) && mcf.translate.some((v: number) => v !== 0)) {
          parts.push(`T(${mcf.translate.map((v: number) => v.toFixed(0)).join(',')})`);
        }
        if (mcf.rotate?.angleDeg) {
          const axisLabel = mcf.rotate.axisRef?.kind === 'originAxis'
            ? String(mcf.rotate.axisRef.axisId).replace('_axis', '')
            : 'edge';
          parts.push(`R ${mcf.rotate.angleDeg}° ${axisLabel}`);
        }
        const cnt = Array.isArray(mcf.bodyIds) ? mcf.bodyIds.length : 0;
        const verb = mcf.copy === false ? 'in place' : 'copy';
        const defaultLabel = `Move/Copy · ${cnt} ${cnt === 1 ? 'body' : 'bodies'} ${parts.join(' + ') || '(no-op)'} (${verb})`;
        out.push({
          key: f.id,
          kind: 'feature',
          label: mcf.name && mcf.name.trim() ? mcf.name : defaultLabel,
          iconName: 'open_with',
          iconClass: 'extrude',
          depth: 0,
          expandable: false,
          expanded: false,
          selectable: true,
          visible: true,
          visibilityToggleable: false,
          featureIndex: idx,
          rolledBack: isRolledBack,
          suppressed: mcf.suppressed === true,
          feature: f,
        });
      } else if (f.type === 'combine') {
        // Boolean body operation (REQ 662). Label encodes the operation
        // so the tree shows add/subtract/common without expanding the
        // sidebar.
        const cf = f as any;
        const opLabel = ({
          add: 'Add',
          subtract: 'Subtract',
          common: 'Common',
        } as Record<string, string>)[cf.operation] ?? cf.operation;
        const toolCount = (cf.toolBodyIds || []).length;
        const defaultLabel = `Combine · ${opLabel} (${toolCount} tool${toolCount === 1 ? '' : 's'})`;
        out.push({
          key: f.id,
          kind: 'feature',
          label: cf.name && cf.name.trim() ? cf.name : defaultLabel,
          iconName: 'merge_type',
          iconClass: 'extrude',
          depth: 0,
          expandable: false,
          expanded: false,
          selectable: true,
          visible: true,
          visibilityToggleable: false,
          featureIndex: idx,
          rolledBack: isRolledBack,
          suppressed: cf.suppressed === true,
          feature: f,
        });
      } else if (f.type === 'datumAxis') {
        // User-defined reference axis (REQ 660). Label includes the
        // construction method.
        const df = f as any;
        const method = df.method?.kind ?? 'unknown';
        const methodLabel = ({
          twoPoints: 'Two points',
          alongEdge: 'Along edge',
          twoPlanesIntersection: 'Plane ∩ plane',
          cylindricalFaceAxis: 'Cylindrical face',
          pointAndPerpFace: 'Point ⊥ face',
        } as Record<string, string>)[method] ?? method;
        out.push({
          key: f.id,
          kind: 'feature',
          label: df.name && df.name.trim() ? df.name : `Axis · ${methodLabel}`,
          iconName: 'show_chart',
          iconClass: 'origin',
          depth: 0,
          expandable: false,
          expanded: false,
          selectable: false,
          visible: df.visible !== false,
          visibilityToggleable: true,
          featureIndex: idx,
          rolledBack: isRolledBack,
          suppressed: false,
          feature: f,
        });
      } else if (f.type === 'datumPoint') {
        // User-defined reference point (REQ 661).
        const df = f as any;
        const method = df.method?.kind ?? 'unknown';
        const methodLabel = ({
          onVertex: 'On vertex',
          centerOfFace: 'Center of face',
          centerOfCircularEdge: 'Center of circular edge',
          centerOfMass: 'Center of mass',
          alongEdge: 'Along edge',
        } as Record<string, string>)[method] ?? method;
        out.push({
          key: f.id,
          kind: 'feature',
          label: df.name && df.name.trim() ? df.name : `Point · ${methodLabel}`,
          iconName: 'place',
          iconClass: 'origin',
          depth: 0,
          expandable: false,
          expanded: false,
          selectable: false,
          visible: df.visible !== false,
          visibilityToggleable: true,
          featureIndex: idx,
          rolledBack: isRolledBack,
          suppressed: false,
          feature: f,
        });
      } else if (f.type === 'datumPlane') {
        // User-defined reference plane — no sketch child. Label shows
        // the construction method so the user can tell offset planes
        // apart from three-point / angle / mid-plane / etc. at a
        // glance. REQ 657.
        const df = f as any;
        const method = df.method?.kind ?? 'unknown';
        const methodLabel = ({
          offset: 'Offset',
          parallelThroughPoint: '∥ through point',
          angleThroughEdge: 'Angle through edge',
          threePoints: 'Through 3 points',
          midPlane: 'Mid-plane',
          lineAndPerpFace: 'Line ⊥ face',
          pointAndPerpEdge: 'Point ⊥ edge',
          tangentCylinder: 'Tangent to cylinder',
        } as Record<string, string>)[method] ?? method;
        const defaultLabel = `Plane · ${methodLabel}`;
        out.push({
          key: f.id,
          kind: 'feature',
          label: df.name && df.name.trim() ? df.name : defaultLabel,
          iconName: 'crop_din',  // material symbol — square frame, reads as "plane"
          iconClass: 'origin',
          depth: 0,
          expandable: false,
          expanded: false,
          selectable: false,
          visible: df.visible !== false,
          visibilityToggleable: true,
          featureIndex: idx,
          rolledBack: isRolledBack,
          suppressed: false,
          feature: f,
        });
      }
  }

  private datumNode(id: string, label: string, icon: string, iconClass: string, vis: Record<string, boolean>): TreeNode {

    return {
      key: `datum:${id}`,
      kind: 'datum',
      label,
      iconName: icon,
      iconClass,
      depth: 1,
      expandable: false,
      expanded: false,
      visible: vis[id] !== false,
      visibilityToggleable: true,
      // Origin datums (point / axes / planes) are selectable like any other
      // feature-tree row — single/ctrl/shift-range via the unified model.
      selectable: true,
      datumId: id,
    };
  }

  featureErrorTestId(n: TreeNode): string {
    return n.feature ? `feature-error-${n.feature.id}` : 'feature-error';
  }

  hostLabel(hostId: string): string {
    if (hostId.startsWith('datum:')) {
      const id = hostId.substring('datum:'.length);
      return originPlaneLabel(id) ?? id.replace(/_/g, ' ');
    }
    return hostId;
  }

  /** Human-readable reference (host) of a sketch — the datum name or a short
   * face label — shown in the sketch context menu. */
  sketchHostLabel(sketchId: string): string {
    const sk = this.doc()?.sketches[sketchId];
    if (!sk || !sk.hostId) return '—';
    const hostId = sk.hostId;
    if (hostId.startsWith('datum:')) {
      const id = hostId.substring('datum:'.length);
      return originPlaneLabel(id) ?? id.replace(/_/g, ' ');
    }
    if (hostId.startsWith('face:')) {
      const missing = this.sketchHostMissing(sketchId) ? ' (missing)' : '';
      try {
        const o = JSON.parse(hostId.substring('face:'.length)) as { feature_id?: string; role?: string; sub_index?: number };
        const feat = (o.feature_id || '?').split('#')[0];
        const role = o.role === 'cap_top' || o.role === 'cap-top' ? 'top'
          : o.role === 'cap_bottom' || o.role === 'cap-bottom' ? 'bottom'
          : (o.role || 'face');
        const sub = o.role === 'side' && o.sub_index !== undefined ? ` #${o.sub_index}` : '';
        return `Face ${feat} ${role}${sub}${missing}`;
      } catch { return 'Face' + missing; }
    }
    return hostId;
  }

  /** A sketch's face host is "missing" — the host editor computes the
   * authoritative set (kernel dangling + geometry feature-base check) and
   * passes it via `danglingSketchIds`. */
  sketchHostMissing(sketchId: string): boolean {
    return this.danglingSketchIds().has(sketchId);
  }

  rowTestId(n: TreeNode): string {
    if (n.kind === 'feature') return 'feature-tree-row';
    if (n.kind === 'sketch') return 'sketch-tree-row';
    if (n.kind === 'datum') return `datum-tree-row-${n.datumId}`;
    return 'tree-row';
  }

  toggleExpand(n: TreeNode, ev?: MouseEvent) {
    ev?.stopPropagation();
    if (this.externalNodes()) { this.externalEvent.emit({ type: 'expand', node: n, ev }); return; }
    const key = n.kind === 'feature' && n.feature?.type === 'origin' ? 'origin-children' : n.key;
    this.expanded.update(set => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  onRowClick(n: TreeNode, ev: MouseEvent) {
    // A just-completed feature drag fires a trailing click — swallow it so the
    // reorder doesn't also select the row.
    if (this._suppressNextRowClick) { this._suppressNextRowClick = false; return; }
    // External-nodes mode: selectable rows select; expandable rows toggle.
    if (this.externalNodes()) {
      if (n.selectable) this.externalEvent.emit({ type: 'select', node: n, ev });
      else if (n.expandable) this.externalEvent.emit({ type: 'expand', node: n, ev });
      return;
    }
    // Sketch row:
    //   - in pick-extrude-target mode (`selectable=true`), emit sketchSelected
    //     so the editor knows which sketch to use as the extrude target
    //   - otherwise, open it for editing (same effect as the right-click
    //     "Edit sketch" menu item) — this is the natural single-click action
    if (n.kind === 'sketch' && n.sketchId) {
      if (n.selectable) {
        // pick-extrude-target mode: clicking commits the sketch as the
        // extrude source, no selection happens here.
        this.sketchSelected.emit(n.sketchId);
      } else {
        // Normal mode: click selects (highlights). Edit/Delete/Hide live
        // on the right-click context menu so a single click never opens
        // the sketch unexpectedly.
        this.sketchSelect.emit({
          sketchId: n.sketchId,
          shiftKey: ev.shiftKey,
          ctrlKey: ev.ctrlKey || ev.metaKey,
        });
      }
      return;
    }
    // REQ 626 — feature row click emits selection with modifier keys. Origin
    // rows are non-selectable. Click does NOT toggle expand here — the
    // chevron has its own click handler for that.
    if (n.kind === 'feature' && n.feature && n.feature.type !== 'origin') {
      this.featureSelect.emit({
        featureId: n.feature.id,
        shiftKey: ev.shiftKey,
        ctrlKey: ev.ctrlKey || ev.metaKey,
      });
      return;
    }
    // Origin-datum row (point / axis / plane): clicking selects it (the eye
    // button stops propagation, so this only fires for the row body). Datums
    // join the unified selection model (shift-range / ctrl-toggle).
    if (n.kind === 'datum' && n.datumId) {
      this.datumSelect.emit({ datumId: n.datumId, shiftKey: ev.shiftKey, ctrlKey: ev.ctrlKey || ev.metaKey });
      return;
    }
    // Non-feature, non-sketch row: clicking toggles expand.
    if (n.expandable) {
      this.toggleExpand(n, ev);
    }
  }

  /** Visible selectable rows (features + sketches + origin datums) in display
   *  order. The parent uses this for unified shift-range selection across all
   *  three kinds. The Origin parent row, bodies, the rollback bar, and
   *  cosmetic-thread groups are excluded. */
  orderedSelectableRows(): Array<{ kind: 'feature' | 'sketch' | 'datum'; id: string }> {
    const out: Array<{ kind: 'feature' | 'sketch' | 'datum'; id: string }> = [];
    for (const n of this.nodes()) {
      if (n.kind === 'feature' && n.feature && n.feature.type !== 'origin') {
        out.push({ kind: 'feature', id: n.feature.id });
      } else if (n.kind === 'sketch' && n.sketchId) {
        out.push({ kind: 'sketch', id: n.sketchId });
      } else if (n.kind === 'datum' && n.datumId) {
        out.push({ kind: 'datum', id: n.datumId });
      }
    }
    return out;
  }

  isRowSelected(n: TreeNode): boolean {
    if (this.externalNodes()) return n.selected === true;
    if (n.kind === 'feature' && n.feature) {
      return this.selectedFeatures().has(n.feature.id);
    }
    if (n.kind === 'sketch' && n.sketchId) {
      return this.selectedSketches().has(n.sketchId);
    }
    if (n.kind === 'datum' && n.datumId) {
      return this.selectedDatums().has(n.datumId);
    }
    return false;
  }

  visibilityTestId(n: TreeNode): string {
    if (n.datumId) return `visibility-${n.datumId}`;
    if (n.sketchId) return `visibility-sketch-${n.sketchId}`;
    return 'visibility-toggle';
  }

  onVisibilityToggleClick(n: TreeNode, ev: MouseEvent) {
    ev.stopPropagation();
    if (this.externalNodes()) { this.externalEvent.emit({ type: 'visibility', node: n, ev }); return; }
    if (n.kind === 'datum' && n.datumId) {
      this.visibilityToggled.emit(n.datumId);
    } else if (n.kind === 'sketch' && n.sketchId) {
      this.actionRequested.emit({ action: 'toggle-sketch-visibility', sketchId: n.sketchId });
    } else if (n.kind === 'feature' && n.feature) {
      // Origin has no single `visible` field — its show/hide flips ALL its
      // datums together, routed through the datum channel with a sentinel id.
      if (n.feature.type === 'origin') { this.visibilityToggled.emit('origin-all'); return; }
      // Other feature rows — patterns, fillets, bodies, etc. Route through
      // toggle-feature-visibility; the editor's `toggleFeatureVisibility` flips
      // the feature's `visible` field and regens without the hidden geometry.
      this.actionRequested.emit({ action: 'toggle-feature-visibility', featureId: n.feature.id });
    } else if (n.kind === 'cosmetic-threads-group') {
      this.actionRequested.emit({ action: 'toggle-cosmetic-threads-visibility' });
    }
  }

  /** Begin dragging the rollback bar. Captures document-level mousemove
   * + mouseup so the drag survives leaving the bar itself. The target
   * row under the cursor highlights via dragTargetIndex; mouseup commits
   * via rollbackChanged (same path the context-menu uses), or releases
   * silently if the cursor never crossed onto a different row. */
  onRollbackDragStart(ev: MouseEvent): void {
    // Left-click only — right-click on the bar already maps to "roll
    // forward to end" via onRowContextMenu.
    if (ev.button !== 0) return;
    ev.preventDefault();
    const startIndex = this.rollbackBeforeIndex();
    this.dragTargetIndex.set(startIndex);

    this.rollbackDragMove = (mv: MouseEvent) => {
      const target = this._hitTestRollbackTarget(mv.clientY);
      this.dragTargetIndex.set(target);
    };
    this.rollbackDragUp = () => {
      const target = this.dragTargetIndex();
      this.dragTargetIndex.set(null);
      if (this.rollbackDragMove) document.removeEventListener('mousemove', this.rollbackDragMove);
      if (this.rollbackDragUp) document.removeEventListener('mouseup', this.rollbackDragUp);
      this.rollbackDragMove = undefined;
      this.rollbackDragUp = undefined;
      if (target !== startIndex) {
        this.rollbackChanged.emit(target);
      }
    };
    document.addEventListener('mousemove', this.rollbackDragMove);
    document.addEventListener('mouseup', this.rollbackDragUp);
  }

  /** Map a cursor Y to the prospective new rollback index. Walks every
   * top-level feature row in the tree and finds the one whose vertical
   * MIDPOINT sits below the cursor — that feature's index is where the
   * bar would land (the bar sits BEFORE the target feature). Returns
   * null when the cursor is past the last feature (i.e. "no rollback,
   * full tree active"). */
  private _hitTestRollbackTarget(cursorY: number): number | null {
    const list = this.treeList?.nativeElement;
    if (!list) return this.rollbackBeforeIndex();
    const rows = Array.from(list.querySelectorAll<HTMLLIElement>('li.row'));
    // Walk in document order, looking for the FIRST feature row whose
    // midpoint is below the cursor. That row's featureIndex is the
    // drop target. Only top-level feature rows (depth-0) participate —
    // nested sketch rows and the bar itself don't count.
    for (const row of rows) {
      if (!row.classList.contains('depth-0')) continue;
      const fi = row.dataset['featureIndex'];
      if (fi === undefined || fi === '') continue;
      const r = row.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      if (cursorY < mid) {
        return Number(fi);
      }
    }
    // Past all features — clear the bar entirely.
    return null;
  }

  // ── Feature drag-reorder (feature 2) ─────────────────────────────────
  // A feature row can be dragged to a new slot. dragFeatureIndex = the row
  // being dragged; featureDropIndex = where it would land (insert BEFORE that
  // featureIndex; the past-end sentinel renders no indicator). Engages only
  // after the cursor moves past a small threshold so plain clicks still
  // select. Origin is pinned; the assembly (external-nodes) tree opts out.
  dragFeatureIndex = signal<number | null>(null);
  featureDropIndex = signal<number | null>(null);
  private _featureDropCreatedAt = 0;
  private featureDragCandidate: { index: number; startY: number } | null = null;
  private featureDragMove?: (ev: MouseEvent) => void;
  private featureDragUp?: (ev: MouseEvent) => void;
  private _suppressNextRowClick = false;

  onRowMouseDown(ev: MouseEvent, n: TreeNode): void {
    if (n.kind === 'rollback-bar') { this.onRollbackDragStart(ev); return; }
    if (n.kind === 'feature') this.onFeatureDragStart(ev, n);
    else if (n.kind === 'sketch' && n.sketchId && n.depth === 0) this.onSketchDragStart(ev, n);
  }

  // Drag-reorder a top-level sketch row. Sketches are ordered by createdAt, so
  // a drop computes a target createdAt (midpoint of the neighbouring rows) and
  // the host re-stamps it. dragSketchId = the row being dragged; dropBeforeKey
  // = the row any drag would land before (shared with the feature drag).
  dragSketchId = signal<string | null>(null);
  dropBeforeKey = signal<string | null>(null);
  private sketchDragCandidate: { sketchId: string; startY: number } | null = null;
  private sketchDragMove?: (ev: MouseEvent) => void;
  private sketchDragUp?: (ev: MouseEvent) => void;

  private onSketchDragStart(ev: MouseEvent, n: TreeNode): void {
    if (ev.button !== 0) return;
    if (this.externalNodes() !== null) return;
    const sketchId = n.sketchId!;
    this.sketchDragCandidate = { sketchId, startY: ev.clientY };

    this.sketchDragMove = (mv: MouseEvent) => {
      const cand = this.sketchDragCandidate;
      if (!cand) return;
      if (this.dragSketchId() === null) {
        if (Math.abs(mv.clientY - cand.startY) < 4) return;  // threshold → engage drag
        this.dragSketchId.set(cand.sketchId);
      }
      this.dropBeforeKey.set(this._hitTestDrop(mv.clientY).beforeKey);
    };
    this.sketchDragUp = (up: MouseEvent) => {
      const sid = this.dragSketchId();
      const drop = this._hitTestDrop(up.clientY);
      this._endSketchDrag();
      if (sid === null) return;                  // never moved → fall through to click
      this._suppressNextRowClick = true;
      this.reorderSketch.emit({ sketchId: sid, createdAt: drop.createdAt });
    };
    document.addEventListener('mousemove', this.sketchDragMove);
    document.addEventListener('mouseup', this.sketchDragUp);
  }

  private _endSketchDrag(): void {
    if (this.sketchDragMove) document.removeEventListener('mousemove', this.sketchDragMove);
    if (this.sketchDragUp) document.removeEventListener('mouseup', this.sketchDragUp);
    this.sketchDragMove = undefined;
    this.sketchDragUp = undefined;
    this.sketchDragCandidate = null;
    this.dragSketchId.set(null);
    this.dropBeforeKey.set(null);
  }

  /** Cursor Y → unified drop target over ALL top-level rows (features +
   * sketches), createdAt-sorted. Returns the row to land BEFORE (`beforeKey`,
   * null = end), the `createdAt` to stamp a dragged sketch with (midpoint of
   * the neighbours), and the `featureIndex` a dragged feature should land
   * before (count of feature rows above the drop). The ORIGIN is never a valid
   * "before" target, so nothing can be dropped before it. Each row's createdAt
   * comes straight from the model (feature → data-feature-index, sketch →
   * data-node-key → doc.sketches), so both kinds are valid drop neighbours. */
  private _hitTestDrop(cursorY: number): { beforeKey: string | null; createdAt: number; featureIndex: number } {
    const list = this.treeList?.nativeElement;
    const features = this.features();
    const doc = this.doc();
    const rows: { el: HTMLLIElement; key: string | null; ca: number; isOrigin: boolean; isFeature: boolean }[] = [];
    if (list) {
      for (const el of Array.from(list.querySelectorAll<HTMLLIElement>('li.row.depth-0'))) {
        const fi = el.dataset['featureIndex'];
        let ca: number | null = null;
        let isFeature = false;
        let isOrigin = false;
        if (fi !== undefined && fi !== '') {
          const f = features[Number(fi)];
          if (f) { ca = f.createdAt ?? (f.type === 'origin' ? 0 : Number(fi) + 1); isFeature = true; isOrigin = f.type === 'origin'; }
        } else {
          const key = el.dataset['nodeKey'];
          const sk = key && doc ? doc.sketches[key] : null;
          if (sk) ca = sk.createdAt ?? 0;
        }
        if (ca !== null) rows.push({ el, key: el.dataset['nodeKey'] ?? null, ca, isOrigin, isFeature });
      }
    }
    let prevCa = 0;
    let featuresBefore = 0;
    for (const r of rows) {
      const rect = r.el.getBoundingClientRect();
      // The origin is pinned first: never a "drop before" target.
      if (!r.isOrigin && cursorY < rect.top + rect.height / 2) {
        return { beforeKey: r.key, createdAt: (prevCa + r.ca) / 2, featureIndex: featuresBefore };
      }
      prevCa = r.ca;
      if (r.isFeature) featuresBefore++;
    }
    return { beforeKey: null, createdAt: prevCa + 1, featureIndex: featuresBefore };  // past the end
  }

  private onFeatureDragStart(ev: MouseEvent, n: TreeNode): void {
    if (ev.button !== 0) return;
    if (this.externalNodes() !== null) return;        // assembly tree: no reorder
    if (n.featureIndex === undefined) return;
    if (n.feature?.type === 'origin') return;          // origin is pinned at index 0
    this.featureDragCandidate = { index: n.featureIndex, startY: ev.clientY };

    this.featureDragMove = (mv: MouseEvent) => {
      const cand = this.featureDragCandidate;
      if (!cand) return;
      if (this.dragFeatureIndex() === null) {
        if (Math.abs(mv.clientY - cand.startY) < 4) return;  // threshold → engage drag
        this.dragFeatureIndex.set(cand.index);
      }
      // Unified hit-test so a feature can land between sketches too (not just
      // between features), and never before the origin.
      const h = this._hitTestDrop(mv.clientY);
      this.dropBeforeKey.set(h.beforeKey);
      this.featureDropIndex.set(h.featureIndex);
      this._featureDropCreatedAt = h.createdAt;
    };
    this.featureDragUp = () => {
      const from = this.dragFeatureIndex();
      const to = this.featureDropIndex();
      const ca = this._featureDropCreatedAt;
      this._endFeatureDrag();
      if (from === null) return;                       // never moved → fall through to click
      this._suppressNextRowClick = true;               // a real drag — don't also select
      if (to !== null) this.reorderFeature.emit({ fromIndex: from, toIndex: to, createdAt: ca });
    };
    document.addEventListener('mousemove', this.featureDragMove);
    document.addEventListener('mouseup', this.featureDragUp);
  }

  private _endFeatureDrag(): void {
    if (this.featureDragMove) document.removeEventListener('mousemove', this.featureDragMove);
    if (this.featureDragUp) document.removeEventListener('mouseup', this.featureDragUp);
    this.featureDragMove = undefined;
    this.featureDragUp = undefined;
    this.featureDragCandidate = null;
    this.dragFeatureIndex.set(null);
    this.featureDropIndex.set(null);
    this.dropBeforeKey.set(null);
  }

  onRowContextMenu(ev: MouseEvent, n: TreeNode) {
    // External-nodes mode: the host owns the context menu.
    if (this.externalNodes()) { ev.preventDefault(); this.externalEvent.emit({ type: 'context', node: n, ev }); return; }
    // Origin features and datum rows have no context menu — fall through to the
    // browser's native menu so power users can copy/inspect.
    if (n.kind === 'datum') return;
    if (n.kind === 'feature' && n.feature?.type === 'origin') return;
    // Rollback bar — right-click rolls forward to end (clears the bar).
    if (n.kind === 'rollback-bar') {
      ev.preventDefault();
      this.rollbackChanged.emit(null);
      return;
    }
    ev.preventDefault();
    this.menuX.set(ev.clientX);
    this.menuY.set(ev.clientY);
    this.contextNode.set(n);
    // openMenu is async w.r.t. anchor position because the menu reads the
    // trigger element's bounding rect — set position first, then open.
    queueMicrotask(() => this.menuTrigger?.openMenu());
  }

  emitAction(action: FeatureTreeAction) {
    this.menuTrigger?.closeMenu();
    this.actionRequested.emit(action);
  }

  /** Debug: the underlying feature/sketch/datum id for a row. */
  dbgId(n: TreeNode): string { return n.feature?.id || n.sketchId || n.datumId || ''; }

  /** Resolve the underlying sketch id for a feature, or null when the
   * feature kind doesn't own a sketch (fillet, chamfer, origin) or
   * carries multiple (sweep — picks the profile, which is the main
   * one users want to edit). */
  featureSketchId(feature: Feature | undefined): string | null {
    if (!feature) return null;
    switch (feature.type) {
      case 'extrude':
      case 'cutExtrude':
      case 'revolve':
      case 'cutRevolve':
        return (feature as any).sketchId ?? null;
      case 'sweep':
      case 'cutSweep':
        return (feature as any).profileSketchId ?? null;
      case 'loft':
        return (feature as any).sketchIds?.[0] ?? null;
      default:
        return null;
    }
  }
}
