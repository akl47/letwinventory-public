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
  | { action: 'edit-sketch'; sketchId: string }
  | { action: 'delete-sketch'; sketchId: string }
  | { action: 'toggle-sketch-visibility'; sketchId: string };

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
            (click)="onRowClick(n, $event)"
            (contextmenu)="onRowContextMenu($event, n)">
          <span class="chevron" *ngIf="n.expandable" (click)="toggleExpand(n, $event)">
            <mat-icon>{{ n.expanded ? 'expand_more' : 'chevron_right' }}</mat-icon>
          </span>
          <span class="chevron-spacer" *ngIf="!n.expandable && n.depth > 0"></span>
          <mat-icon class="kind-icon" [ngClass]="n.iconClass">{{ n.iconName }}</mat-icon>
          <span class="label">{{ n.label }}</span>
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

      <!-- Floating trigger for the context menu, positioned at the cursor on right-click. -->
      <div #menuTriggerEl
           class="menu-anchor"
           [style.left.px]="menuX()"
           [style.top.px]="menuY()"
           [matMenuTriggerFor]="ctxMenu"></div>

      <mat-menu #ctxMenu="matMenu">
        <ng-container *ngIf="contextNode() as n">
          <ng-container *ngIf="n.kind === 'feature' && n.feature?.type === 'extrude'">
            <button mat-menu-item data-testid="ctx-edit-feature" (click)="emitAction({ action: 'edit-feature', featureId: n.feature!.id })">
              <mat-icon>edit</mat-icon> Edit…
            </button>
            <button mat-menu-item data-testid="ctx-toggle-feature-visibility" (click)="emitAction({ action: 'toggle-feature-visibility', featureId: n.feature!.id })">
              <mat-icon>{{ n.visible === false ? 'visibility' : 'visibility_off' }}</mat-icon>
              {{ n.visible === false ? 'Show' : 'Hide' }}
            </button>
            <button mat-menu-item data-testid="ctx-delete-feature" (click)="emitAction({ action: 'delete-feature', featureId: n.feature!.id })">
              <mat-icon>delete</mat-icon> Delete
            </button>
          </ng-container>
          <ng-container *ngIf="n.kind === 'sketch' && n.sketchId">
            <button mat-menu-item data-testid="ctx-edit-sketch" (click)="emitAction({ action: 'edit-sketch', sketchId: n.sketchId! })">
              <mat-icon>edit</mat-icon> Edit sketch
            </button>
            <button mat-menu-item data-testid="ctx-toggle-sketch-visibility" (click)="emitAction({ action: 'toggle-sketch-visibility', sketchId: n.sketchId! })">
              <mat-icon>{{ n.visible === false ? 'visibility' : 'visibility_off' }}</mat-icon>
              {{ n.visible === false ? 'Show' : 'Hide' }}
            </button>
            <button mat-menu-item data-testid="ctx-delete-sketch" (click)="emitAction({ action: 'delete-sketch', sketchId: n.sketchId! })">
              <mat-icon>delete</mat-icon> Delete sketch
            </button>
          </ng-container>
        </ng-container>
      </mat-menu>
    </div>
  `,
  styles: [`
    .panel { display: flex; flex-direction: column; height: 100%; }
    .panel-header { display: flex; align-items: center; gap: 8px; padding: 12px; border-bottom: 1px solid #444; font-weight: 600; font-size: 13px; text-transform: uppercase; opacity: 0.75; }
    .tree { list-style: none; padding: 0; margin: 0; user-select: none; }
    .row { display: flex; align-items: center; gap: 6px; padding: 6px 12px; border-bottom: 1px solid #2a2a3a; font-size: 13px; line-height: 1.2; }
    .row.depth-1 { padding-left: 28px; background: #1f1f2e; }
    .row.selectable { cursor: pointer; }
    .row.selectable:hover { background: rgba(255,255,255,0.06); }
    .row.hidden-datum .label { opacity: 0.4; text-decoration: line-through; }
    .row.hidden-feature .label { opacity: 0.5; font-style: italic; }
    .row.hidden-sketch .label { opacity: 0.5; font-style: italic; }
    .hidden-indicator { font-size: 14px; width: 14px; height: 14px; opacity: 0.55; }
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

  sketchSelected = output<string>();
  visibilityToggled = output<string>(); // datum id
  actionRequested = output<FeatureTreeAction>();

  // Expansion state: keys for expanded nodes (origin is expanded by default).
  expanded = signal<Set<string>>(new Set<string>(['origin-children']));

  // Context menu state: position the floating trigger at the cursor and remember
  // which node the menu is operating on.
  menuX = signal(0);
  menuY = signal(0);
  contextNode = signal<TreeNode | null>(null);
  private menuTrigger = viewChild(MatMenuTrigger);

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
      } else if (f.type === 'extrude') {
        const ef = f as ExtrudeFeature;
        const sketch = doc?.sketches[ef.sketchId] ?? null;
        const hasChild = !!sketch;
        const isOpen = expanded.has(f.id);
        out.push({
          key: f.id,
          kind: 'feature',
          label: `Extrude · ${ef.distance}`,
          iconName: 'vertical_align_top',
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
            out.push({
              key: `child:${sketch.id}`,
              kind: 'sketch',
              label: `${sketch.id} — ${this.hostLabel(sketch.hostId)}`,
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
        out.push({
          key: s.id,
          kind: 'sketch',
          label: `${s.id} — ${this.hostLabel(s.hostId)}`,
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
    // If the row is expandable, clicking the body toggles expand.
    if (n.expandable) {
      this.toggleExpand(n, ev);
      return;
    }
    if (n.kind === 'sketch' && n.selectable && n.sketchId) {
      this.sketchSelected.emit(n.sketchId);
    }
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
