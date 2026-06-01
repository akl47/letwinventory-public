import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

/** One row in the selection list — typically a picked face / edge /
 * vertex. The `icon` is a Material symbol name; `id` is the opaque
 * identifier the host uses to know which underlying entity to remove
 * when the row's X is clicked. */
export interface SelectionRow {
  id: string;
  label: string;
  /** Optional Material icon. Defaults to `radio_button_unchecked`
   * when omitted. */
  icon?: string;
  /** Optional per-row tooltip. */
  tooltip?: string;
}

/** SolidWorks-style selection-box component. Renders a labelled panel
 * containing zero-to-many entity rows (each with a kind icon, label,
 * and remove button), with a slot for the host's pick-button(s) /
 * mode-toggles (passed via `<ng-content>`). The visual shell reuses
 * the existing `.panel-field` / `.entity-row` styles so it stays
 * consistent with every other CAD sidebar field. */
@Component({
  selector: 'cad-selection-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, MatTooltipModule],
  template: `
    <div class="panel-field" [class.active]="active()" [attr.data-testid]="testid()">
      <div class="field-header">
        <mat-icon class="field-icon" *ngIf="headerIcon()">{{ headerIcon() }}</mat-icon>
        <span class="field-label">{{ label() }}</span>
        <span class="field-count" *ngIf="showCount()">{{ rows().length }}</span>
        <button class="header-clear"
                type="button"
                *ngIf="rows().length > 0"
                [attr.data-testid]="testid() ? testid() + '-clear' : null"
                matTooltip="Clear all"
                (click)="clear.emit()">
          <mat-icon>clear_all</mat-icon>
        </button>
      </div>
      <ng-content></ng-content>
      <ul class="entity-list" *ngIf="rows().length > 0">
        <li class="entity-row"
            *ngFor="let row of rows(); let i = index"
            [attr.data-testid]="testid() ? testid() + '-row-' + i : null">
          <mat-icon class="entity-row-icon">{{ row.icon || 'radio_button_unchecked' }}</mat-icon>
          <span class="entity-row-label">{{ row.label }}</span>
          <button class="entity-row-remove"
                  type="button"
                  [attr.data-testid]="testid() ? testid() + '-remove-' + i : null"
                  [matTooltip]="row.tooltip || 'Remove'"
                  (click)="remove.emit(row.id)">
            <mat-icon>close</mat-icon>
          </button>
        </li>
      </ul>
      <div class="field-empty" *ngIf="rows().length === 0 && emptyHint()">
        {{ emptyHint() }}
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .panel-field {
      padding: 5px 6px;
      margin-bottom: 6px;
      border: 1px solid #444;
      border-radius: 4px;
      transition: border-color 0.1s, background 0.1s;
    }
    .panel-field.active {
      border-color: #42a5f5;
      background: rgba(66, 165, 245, 0.12);
    }
    .field-header {
      display: flex;
      align-items: center;
      gap: 5px;
      margin-bottom: 2px;
    }
    .field-icon { font-size: 14px; width: 14px; height: 14px; opacity: 0.7; }
    .field-label { font-size: 11px; color: #aaa; text-transform: uppercase; letter-spacing: 0.5px; flex: 1; }
    .field-count {
      font-size: 11px;
      line-height: 14px;
      color: #ddd;
      background: rgba(66, 165, 245, 0.18);
      border: 1px solid #42a5f5;
      padding: 0 6px;
      border-radius: 7px;
      min-width: 16px;
      text-align: center;
    }
    .header-clear {
      width: 16px; height: 16px; padding: 0; flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center;
      background: transparent; border: none; border-radius: 2px;
      color: #aaa; cursor: pointer; line-height: 1;
    }
    .header-clear:hover { background: rgba(255,255,255,0.12); color: #fff; }
    .header-clear mat-icon { font-size: 14px; width: 14px; height: 14px; line-height: 14px; }
    .field-empty { font-size: 11px; color: #888; font-style: italic; padding: 2px 0; }
    .entity-list { list-style: none; margin: 4px 0 0 0; padding: 0; }
    .entity-row {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 0 3px 0 5px;
      margin-top: 2px;
      background: rgba(255,255,255,0.04);
      border: 1px solid #3a3a52;
      border-radius: 3px;
      min-height: 18px;
    }
    .entity-row-icon { font-size: 14px; width: 14px; height: 14px; opacity: 0.85; flex-shrink: 0; }
    .entity-row-label { flex: 1; font-size: 12px; color: #ddd; line-height: 1.15; min-width: 0; }
    .entity-row-remove {
      width: 14px; height: 14px; padding: 0; flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center;
      background: transparent; border: none; border-radius: 2px;
      color: #aaa; cursor: pointer; line-height: 1;
    }
    .entity-row-remove:hover { background: rgba(255,255,255,0.12); color: #fff; }
    .entity-row-remove mat-icon { font-size: 12px; width: 12px; height: 12px; line-height: 12px; }
  `],
})
export class CadSelectionListComponent {
  /** Visible field title (e.g. "Items to Fillet"). */
  label = input.required<string>();
  /** Material icon shown to the left of the title. */
  headerIcon = input<string | null>(null);
  /** Picked entities, one row per item. */
  rows = input.required<SelectionRow[]>();
  /** Highlight the panel as currently active (e.g. picker is armed). */
  active = input<boolean>(false);
  /** Whether to show the count chip in the header. */
  showCount = input<boolean>(true);
  /** Italic hint rendered when `rows` is empty (e.g. "Click an edge in
   * the viewer"). Omit to render nothing in the empty state. */
  emptyHint = input<string | null>(null);
  /** Optional data-testid base — children get `{testid}-row-N` etc. */
  testid = input<string | null>(null);

  /** Emits the row's `id` when its X button is clicked. */
  remove = output<string>();
  /** Emits when the header "Clear all" button is clicked. The button
   * renders only when `rows.length > 0`. Host is responsible for
   * actually clearing whatever underlying state feeds `rows`. */
  clear = output<void>();
}
