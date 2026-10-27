import { Component, input, output, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

/**
 * Shared tree-row chrome for the CAD/assembly side panels — one canonical
 * formatting (indent, chevron, kind-icon, label, right-justified action slot)
 * so the assembly sidebar and the part feature tree stay visually identical.
 * Trailing controls (e.g. a show/hide eye) are projected via <ng-content> and
 * pinned to the right of the row.
 */
@Component({
  selector: 'cad-tree-row',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="row"
         [class.depth-1]="depth() === 1"
         [class.depth-2]="depth() >= 2"
         [class.selectable]="selectable()"
         [class.selected]="selected()"
         (click)="rowClick.emit($event)"
         (contextmenu)="rowContext.emit($event)">
      @if (expandable()) {
        <span class="chevron" (click)="onChevron($event)">
          <mat-icon>{{ expanded() ? 'expand_more' : 'chevron_right' }}</mat-icon>
        </span>
      } @else {
        <span class="chevron-spacer"></span>
      }
      <mat-icon class="kind-icon" [ngClass]="iconClass()">{{ iconName() }}</mat-icon>
      <span class="label" [class.dimmed]="dimmed()">{{ label() }}</span>
      <span class="actions"><ng-content></ng-content></span>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .row { display: flex; align-items: center; gap: 6px; padding: 6px 12px; border-bottom: 1px solid #2a2a3a; font-size: 13px; line-height: 1.2; color: #ddd; }
    .row.depth-1 { padding-left: 28px; background: #1f1f2e; }
    .row.depth-2 { padding-left: 44px; background: #1f1f2e; }
    .row.selectable { cursor: pointer; }
    .row.selectable:hover { background: rgba(255,255,255,0.06); }
    .row.selected { background: rgba(255,183,77,0.18); }
    .row.selected.depth-1 { background: rgba(255,183,77,0.12); }
    .chevron { display: inline-flex; align-items: center; width: 18px; cursor: pointer; opacity: 0.7; }
    .chevron:hover { opacity: 1; }
    .chevron mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .chevron-spacer { display: inline-block; width: 18px; flex: 0 0 18px; }
    .kind-icon { font-size: 18px; width: 18px; height: 18px; flex: 0 0 auto; }
    .kind-icon.origin { color: #ffeb3b; }
    .kind-icon.part { color: #90a4ae; }
    .kind-icon.mate { color: #42a5f5; }
    .kind-icon.datum-point { color: #fff; }
    .kind-icon.datum-axis-x { color: #e53935; }
    .kind-icon.datum-axis-y { color: #43a047; }
    .kind-icon.datum-axis-z { color: #1e88e5; }
    .kind-icon.datum-plane-xy { color: #1e88e5; }
    .kind-icon.datum-plane-yz { color: #e53935; }
    .kind-icon.datum-plane-xz { color: #43a047; }
    .label { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .label.dimmed { opacity: 0.4; text-decoration: line-through; }
    /* Right-justified trailing controls (show/hide eyes, etc.). */
    .actions { margin-left: auto; display: inline-flex; align-items: center; gap: 2px; flex: 0 0 auto; }
  `],
})
export class CadTreeRowComponent {
  depth = input(0);
  iconName = input('');
  iconClass = input('');
  label = input('');
  selected = input(false);
  selectable = input(true);
  expandable = input(false);
  expanded = input(false);
  /** Dimmed + struck-through label (a hidden datum / feature). */
  dimmed = input(false);

  rowClick = output<MouseEvent>();
  rowContext = output<MouseEvent>();
  toggleExpand = output<MouseEvent>();

  onChevron(ev: MouseEvent) {
    ev.stopPropagation();
    this.toggleExpand.emit(ev);
  }
}
