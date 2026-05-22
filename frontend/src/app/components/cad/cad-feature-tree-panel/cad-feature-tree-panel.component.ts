import { Component, input, output, signal, computed, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import type { Feature, SketchDocument, OriginFeature, ExtrudeFeature } from '../../../cad/lib/types';
import { defaultDatumVisibility } from '../../../cad/lib/featureTree';

export type FeatureTreeAction =
  | { action: 'edit-feature'; featureId: string }
  | { action: 'delete-feature'; featureId: string }
  | { action: 'toggle-feature-visibility'; featureId: string }
  | { action: 'rename-feature'; featureId: string }
  | { action: 'edit-sketch'; sketchId: string }
  | { action: 'delete-sketch'; sketchId: string }
  | { action: 'toggle-sketch-visibility'; sketchId: string }
  | { action: 'rename-sketch'; sketchId: string };

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

interface TreeNode {
  /** Unique within the tree; used for expansion tracking. */
  key: string;
  kind: 'feature' | 'sketch' | 'datum';
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
  /** Stable id payload passed back through events. */
  datumId?: string;
  sketchId?: string;
  feature?: Feature;
}

@Component({
  selector: 'app-cad-feature-tree-panel',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatTooltipModule, MatMenuModule],
  template: `
    <div class="panel">
      <div class="section features-section">
        <header class="panel-header">
          <mat-icon>account_tree</mat-icon>
          <span>Feature Tree</span>
        </header>
        <ul class="tree">
        <li *ngFor="let n of nodes()"
            [attr.data-testid]="rowTestId(n)"
            class="row"
            [class.depth-0]="n.depth === 0"
            [class.depth-1]="n.depth === 1"
            [class.selectable]="n.selectable"
            [class.hidden-datum]="n.kind === 'datum' && n.visible === false"
            [class.hidden-feature]="n.kind === 'feature' && n.visible === false"
            [class.hidden-sketch]="n.kind === 'sketch' && n.visible === false"
            [class.selected]="isRowSelected(n)"
            (click)="onRowClick(n, $event)"
            (contextmenu)="onRowContextMenu($event, n)">
          <span class="chevron" *ngIf="n.expandable" (click)="toggleExpand(n, $event)">
            <mat-icon>{{ n.expanded ? 'expand_more' : 'chevron_right' }}</mat-icon>
          </span>
          <span class="chevron-spacer" *ngIf="!n.expandable && n.depth > 0"></span>
          <mat-icon class="kind-icon" [ngClass]="n.iconClass">{{ n.iconName }}</mat-icon>
          <span class="label">{{ n.label }}</span>
          <ng-container *ngIf="n.kind === 'feature' && n.feature && featureErrors().has(n.feature.id)">
            <mat-icon class="error-indicator"
                      [matTooltip]="featureErrors().get(n.feature.id) || ''"
                      [attr.data-testid]="featureErrorTestId(n)">error</mat-icon>
          </ng-container>
          <mat-icon *ngIf="n.kind === 'feature' && n.visible === false" class="hidden-indicator" matTooltip="Hidden">visibility_off</mat-icon>
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
      <div class="section bodies-section">
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
              <button *ngIf="scope.count === 1"
                      mat-menu-item data-testid="ctx-rename-feature"
                      (click)="emitAction({ action: 'rename-feature', featureId: n.feature.id })">
                <mat-icon>drive_file_rename_outline</mat-icon> Rename
              </button>
              <button mat-menu-item data-testid="ctx-toggle-feature-visibility"
                      (click)="emitAction({ action: 'toggle-feature-visibility', featureId: n.feature.id })">
                <mat-icon>{{ scope.anyVisible ? 'visibility_off' : 'visibility' }}</mat-icon>
                {{ scope.anyVisible ? 'Hide' : 'Show' }}{{ scope.count > 1 ? ' (' + scope.count + ')' : '' }}
              </button>
              <button mat-menu-item data-testid="ctx-delete-feature"
                      (click)="emitAction({ action: 'delete-feature', featureId: n.feature.id })">
                <mat-icon>delete</mat-icon> Delete{{ scope.count > 1 ? ' (' + scope.count + ')' : '' }}
              </button>
            </ng-container>
            <!-- Sketch menu — same pattern. -->
            <ng-container *ngIf="scope.kind === 'sketch' && n.sketchId">
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
              <button mat-menu-item data-testid="ctx-toggle-sketch-visibility"
                      (click)="emitAction({ action: 'toggle-sketch-visibility', sketchId: n.sketchId })">
                <mat-icon>{{ scope.anyVisible ? 'visibility_off' : 'visibility' }}</mat-icon>
                {{ scope.anyVisible ? 'Hide' : 'Show' }}{{ scope.count > 1 ? ' (' + scope.count + ')' : '' }}
              </button>
              <button mat-menu-item data-testid="ctx-delete-sketch"
                      (click)="emitAction({ action: 'delete-sketch', sketchId: n.sketchId })">
                <mat-icon>delete</mat-icon> Delete sketch{{ scope.count > 1 ? 'es (' + scope.count + ')' : '' }}
              </button>
            </ng-container>
          </ng-container>
        </ng-container>
      </mat-menu>
    </div>
  `,
  styles: [`
    .panel { display: flex; flex-direction: column; height: 100%; min-height: 0; }
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
    .menu-anchor { position: fixed; width: 0; height: 0; }
    .chevron { display: inline-flex; align-items: center; width: 18px; cursor: pointer; opacity: 0.7; }
    .chevron mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .chevron:hover { opacity: 1; }
    .chevron-spacer { display: inline-block; width: 18px; }
    .kind-icon { font-size: 18px; width: 18px; height: 18px; }
    .kind-icon.origin { color: #ffeb3b; }
    .kind-icon.extrude { color: #4caf50; }
    .kind-icon.sketch { color: #42a5f5; }
    .kind-icon.datum-point { color: #fff; }
    .kind-icon.datum-axis-x { color: #e53935; }
    .kind-icon.datum-axis-y { color: #43a047; }
    .kind-icon.datum-axis-z { color: #1e88e5; }
    .kind-icon.datum-plane-xy { color: #1e88e5; }
    .kind-icon.datum-plane-yz { color: #e53935; }
    .kind-icon.datum-plane-xz { color: #43a047; }
    .label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .visibility-toggle { border: none; background: none; cursor: pointer; opacity: 0.55; padding: 2px; display: inline-flex; align-items: center; justify-content: center; color: inherit; }
    .visibility-toggle:hover { opacity: 1; }
    .visibility-toggle mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .pick-hint { font-size: 14px; width: 14px; height: 14px; opacity: 0.7; color: #42a5f5; }
  `],
})
export class CadFeatureTreePanelComponent {
  features = input<Feature[]>([]);
  doc = input<SketchDocument | null>(null);
  selectableSketches = input<boolean>(false);
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
  private menuTrigger = viewChild<MatMenuTrigger>('menuTriggerEl', { read: MatMenuTrigger });
  private bodyMenuTrigger = viewChild<MatMenuTrigger>('bodyMenuTriggerEl', { read: MatMenuTrigger });

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
    queueMicrotask(() => this.bodyMenuTrigger()?.openMenu());
  }

  // What the context menu will act on, given the right-clicked node and the
  // current selection. Mirrors the OS-file-manager rule: if the right-clicked
  // item is part of the current selection, the action targets the whole
  // selection; otherwise it targets only the right-clicked item. The menu
  // template hides edit/rename when count > 1 (those actions don't make
  // sense in bulk) and appends a "(N)" suffix to bulk toggle/delete.
  ctxScope = computed<{ kind: 'feature' | 'sketch' | null; count: number; anyVisible: boolean }>(() => {
    const n = this.contextNode();
    if (!n) return { kind: null, count: 0, anyVisible: false };
    if (n.kind === 'feature' && n.feature && n.feature.type !== 'origin') {
      const sel = this.selectedFeatures();
      const ids = sel.has(n.feature.id) && sel.size > 1 ? Array.from(sel) : [n.feature.id];
      const feats = this.features();
      const anyVisible = ids.some(id => {
        const f = feats.find(x => x.id === id) as ExtrudeFeature | undefined;
        return !!f && f.visible !== false;
      });
      return { kind: 'feature', count: ids.length, anyVisible };
    }
    if (n.kind === 'sketch' && n.sketchId) {
      const sel = this.selectedSketches();
      const ids = sel.has(n.sketchId) && sel.size > 1 ? Array.from(sel) : [n.sketchId];
      const doc = this.doc();
      const anyVisible = ids.some(id => {
        const s = doc?.sketches[id];
        return !!s && s.visible !== false;
      });
      return { kind: 'sketch', count: ids.length, anyVisible };
    }
    return { kind: null, count: 0, anyVisible: false };
  });

  nodes = computed<TreeNode[]>(() => {
    const out: TreeNode[] = [];
    const features = this.features();
    const doc = this.doc();
    const expanded = this.expanded();
    const sketchesUsed = new Set<string>();

    for (const f of features) {
      if (f.type === 'origin') {
        const isOpen = expanded.has('origin-children');
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
          feature: f,
        });
        if (isOpen) {
          const vis = { ...defaultDatumVisibility(), ...((f as OriginFeature).visibility ?? {}) };
          out.push(this.datumNode('origin', 'Origin point', 'fiber_manual_record', 'datum-point', vis));
          out.push(this.datumNode('x_axis', 'X axis', 'east', 'datum-axis-x', vis));
          out.push(this.datumNode('y_axis', 'Y axis', 'north', 'datum-axis-y', vis));
          out.push(this.datumNode('z_axis', 'Z axis', 'open_in_new', 'datum-axis-z', vis));
          out.push(this.datumNode('xy_plane', 'XY plane', 'rectangle', 'datum-plane-xy', vis));
          out.push(this.datumNode('yz_plane', 'YZ plane', 'rectangle', 'datum-plane-yz', vis));
          out.push(this.datumNode('xz_plane', 'XZ plane', 'rectangle', 'datum-plane-xz', vis));
        }
      } else if (f.type === 'extrude' || f.type === 'cutExtrude' || f.type === 'revolve') {
        const ef = f as ExtrudeFeature;  // structural overlap covers all three for tree-display purposes
        const sketch = doc?.sketches[ef.sketchId] ?? null;
        const hasChild = !!sketch;
        const isOpen = expanded.has(f.id);
        const isCut = f.type === 'cutExtrude';
        const isRevolve = f.type === 'revolve';
        // REQ 624: user-supplied name if present, else the default summary.
        const defaultLabel = isRevolve
          ? `Revolve · ${(f as any).angle}°${(f as any).flipped ? ' (flipped)' : ''}`
          : `${isCut ? 'Cut' : 'Extrude'} · ${ef.distance}${ef.flipped ? ' (flipped)' : ''}`;
        out.push({
          key: f.id,
          kind: 'feature',
          label: ef.name && ef.name.trim() ? ef.name : defaultLabel,
          iconName: isRevolve ? '360' : isCut ? 'vertical_align_bottom' : 'vertical_align_top',
          iconClass: 'extrude',
          depth: 0,
          expandable: hasChild,
          expanded: isOpen,
          selectable: false,
          visible: ef.visible !== false,
          feature: f,
        });
        if (sketch) {
          sketchesUsed.add(sketch.id);
          if (isOpen) {
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
      }
    }

    // Orphan sketches (created but not yet extruded).
    if (doc) {
      const orphans = Object.values(doc.sketches).filter(s => !sketchesUsed.has(s.id));
      for (const s of orphans) {
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
        });
      }
    }

    return out;
  });

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
      selectable: false,
      datumId: id,
    };
  }

  featureErrorTestId(n: TreeNode): string {
    return n.feature ? `feature-error-${n.feature.id}` : 'feature-error';
  }

  hostLabel(hostId: string): string {
    if (hostId.startsWith('datum:')) return hostId.substring('datum:'.length).replace('_', ' ');
    return hostId;
  }

  rowTestId(n: TreeNode): string {
    if (n.kind === 'feature') return 'feature-tree-row';
    if (n.kind === 'sketch') return 'sketch-tree-row';
    if (n.kind === 'datum') return `datum-tree-row-${n.datumId}`;
    return 'tree-row';
  }

  toggleExpand(n: TreeNode, ev?: MouseEvent) {
    ev?.stopPropagation();
    const key = n.kind === 'feature' && n.feature?.type === 'origin' ? 'origin-children' : n.key;
    this.expanded.update(set => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  onRowClick(n: TreeNode, ev: MouseEvent) {
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
    // Non-feature, non-sketch row: clicking toggles expand.
    if (n.expandable) {
      this.toggleExpand(n, ev);
    }
  }

  isRowSelected(n: TreeNode): boolean {
    if (n.kind === 'feature' && n.feature) {
      return this.selectedFeatures().has(n.feature.id);
    }
    if (n.kind === 'sketch' && n.sketchId) {
      return this.selectedSketches().has(n.sketchId);
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
    if (n.kind === 'datum' && n.datumId) {
      this.visibilityToggled.emit(n.datumId);
    } else if (n.kind === 'sketch' && n.sketchId) {
      this.actionRequested.emit({ action: 'toggle-sketch-visibility', sketchId: n.sketchId });
    }
  }

  onRowContextMenu(ev: MouseEvent, n: TreeNode) {
    // Origin features and datum rows have no context menu — fall through to the
    // browser's native menu so power users can copy/inspect.
    if (n.kind === 'datum') return;
    if (n.kind === 'feature' && n.feature?.type === 'origin') return;
    ev.preventDefault();
    this.menuX.set(ev.clientX);
    this.menuY.set(ev.clientY);
    this.contextNode.set(n);
    // openMenu is async w.r.t. anchor position because the menu reads the
    // trigger element's bounding rect — set position first, then open.
    queueMicrotask(() => this.menuTrigger()?.openMenu());
  }

  emitAction(action: FeatureTreeAction) {
    this.menuTrigger()?.closeMenu();
    this.actionRequested.emit(action);
  }
}
