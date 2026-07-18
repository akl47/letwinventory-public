import { Component, computed, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { SketchConstraint, ConstraintType } from '../../../cad/lib/types';
import { formatNumber, fromMm, unitSymbol, type Unit } from '../../../cad/lib/units';

// Sidebar panel shown above the constraint list while a DIMENSION is
// selected (SolidWorks Dimension PropertyManager-lite). Shows the value
// (editable, same raw-string parsing as the inline viewer editor, so
// unit suffixes and `=equation` bindings work identically) plus the
// dimension's display properties: radius↔diameter, arrowheads
// inside/outside, and the driven (reference) flag.

const TYPE_LABEL: Partial<Record<ConstraintType, string>> = {
  distance: 'Distance',
  'horizontal-distance': 'Horizontal distance',
  'vertical-distance': 'Vertical distance',
  'point-line-distance': 'Point–line distance',
  radius: 'Radius',
  diameter: 'Diameter',
  angle: 'Angle',
  'arc-length': 'Arc length',
  'chord-distance': 'Chord distance',
  'radial-distance': 'Radial gap',
};

// Types whose arrowheads can flip inside/outside — dims that render a
// dimension line or angle arc. Leader-style dims (radius, arc-length)
// have a single fixed arrow at the curve, so the control would be dead.
const HAS_ARROWS = new Set<ConstraintType>([
  'distance', 'horizontal-distance', 'vertical-distance',
  'point-line-distance', 'chord-distance', 'radial-distance',
  'angle', 'diameter',
]);

@Component({
  selector: 'app-cad-dimension-properties',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatTooltipModule],
  template: `
    <div class="panel" data-testid="dim-props">
      <header class="collapsible" (click)="toggleCollapsed.emit()">
        <mat-icon class="section-chevron">{{ collapsed() ? 'chevron_right' : 'expand_more' }}</mat-icon>
        <mat-icon>straighten</mat-icon>
        <span class="title">{{ typeLabel() }}</span>
        <button class="icon-btn" data-testid="dim-props-close"
                (click)="closed.emit(); $event.stopPropagation()" matTooltip="Deselect">
          <mat-icon>close</mat-icon>
        </button>
      </header>
      <div class="body" [hidden]="collapsed()">
        <label class="field">
          <span class="field-label">Value</span>
          <input class="value-input" data-testid="dim-props-value" type="text" inputmode="decimal"
                 [value]="valueDisplay()"
                 [disabled]="readonly()"
                 [title]="equationExpr() !== null ? 'Equation-driven — edit the expression, or type a number to unbind' : ''"
                 (keydown.enter)="commitFromInput($event)"
                 (keydown.escape)="resetInput($event)"
                 (blur)="commitFromInput($event)" />
          <span class="unit-hint" *ngIf="constraint().type === 'angle'">deg</span>
          <mat-icon class="eqn-badge" *ngIf="equationExpr() !== null"
                    matTooltip="Driven by equation">functions</mat-icon>
        </label>

        <div class="field" *ngIf="canSwitchType()">
          <span class="field-label">Display as</span>
          <div class="seg" data-testid="dim-props-type">
            <button [class.on]="constraint().type === 'radius'"
                    [disabled]="readonly()"
                    (click)="onSwitchType('radius')">R Radius</button>
            <button [class.on]="constraint().type === 'diameter'"
                    [disabled]="readonly()"
                    (click)="onSwitchType('diameter')">⌀ Diameter</button>
          </div>
        </div>

        <div class="field" *ngIf="hasArrows()">
          <span class="field-label">Arrows</span>
          <div class="seg" data-testid="dim-props-arrows">
            <button [class.on]="!constraint().arrowsOutside"
                    [disabled]="readonly()"
                    matTooltip="Arrowheads between the witness lines"
                    (click)="onSetArrowsOutside(false)">Inside</button>
            <button [class.on]="!!constraint().arrowsOutside"
                    [disabled]="readonly()"
                    matTooltip="Arrowheads outside, pointing in"
                    (click)="onSetArrowsOutside(true)">Outside</button>
          </div>
        </div>

        <label class="check" matTooltip="A driven (reference) dimension displays the measured value but doesn't constrain the geometry">
          <input type="checkbox" data-testid="dim-props-driven"
                 [checked]="!!constraint().driven"
                 [disabled]="readonly()"
                 (change)="toggleDriven.emit(constraint().id)" />
          Driven (reference)
        </label>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; overflow: hidden; }
    .panel { display: flex; flex-direction: column; height: 100%; background: #2a2a3e; color: #e0e0e0; font-size: 12px; border-bottom: 1px solid #444; }
    header { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid #444; font-weight: 600; flex: 0 0 auto; }
    header.collapsible { cursor: pointer; user-select: none; }
    header mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .section-chevron { opacity: 0.7; flex-shrink: 0; }
    .title { flex: 1; }
    .icon-btn { background: none; border: none; color: #e0e0e0; cursor: pointer; padding: 2px; display: inline-flex; opacity: 0.6; }
    .icon-btn:hover { opacity: 1; }
    .icon-btn mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .body { display: flex; flex-direction: column; gap: 8px; padding: 8px 10px; flex: 1 1 auto; min-height: 0; overflow-y: auto; }
    /* [hidden] loses to the explicit display:flex above without this. */
    .body[hidden] { display: none; }
    .field { display: flex; align-items: center; gap: 8px; }
    .field-label { flex: 0 0 72px; opacity: 0.7; }
    .value-input { flex: 1; min-width: 0; background: #1e1e2e; color: #ffeb3b; border: 1px solid #555; border-radius: 3px; padding: 3px 6px; font: 500 12px monospace; outline: none; }
    .value-input:focus { border-color: #42a5f5; }
    .value-input:disabled { opacity: 0.5; }
    .unit-hint { opacity: 0.55; font-family: monospace; }
    .eqn-badge { font-size: 16px; width: 16px; height: 16px; color: #ffc107; }
    .seg { display: flex; flex: 1; }
    .seg button { flex: 1; background: #1e1e2e; color: #e0e0e0; border: 1px solid #555; padding: 3px 6px; cursor: pointer; font-size: 11px; }
    .seg button:first-child { border-radius: 3px 0 0 3px; }
    .seg button:last-child { border-radius: 0 3px 3px 0; border-left: none; }
    .seg button.on { background: rgba(66, 165, 245, 0.25); border-color: #42a5f5; color: #90caf9; }
    .seg button:disabled { opacity: 0.5; cursor: default; }
    .check { display: flex; align-items: center; gap: 6px; cursor: pointer; }
    .check input { accent-color: #42a5f5; }
  `],
})
export class CadDimensionPropertiesComponent {
  constraint = input.required<SketchConstraint>();
  defaultUnit = input<Unit>('mm');
  readonly = input<boolean>(false);
  /** Expression text when this dim is equation-driven, else null. */
  equationExpr = input<string | null>(null);
  /** Parent-owned section collapse (the editor also collapses the host's
   * flex sizing and hides the rail divider off this). */
  collapsed = input<boolean>(false);

  /** Raw value string commit — routed through the SAME parser as the
   * inline viewer editor (unit suffixes, `=expr` bindings, negatives). */
  commitValue = output<{ id: string; raw: string }>();
  toggleArrows = output<string>();
  toggleDriven = output<string>();
  switchType = output<{ id: string; to: 'radius' | 'diameter' }>();
  closed = output<void>();
  toggleCollapsed = output<void>();

  typeLabel = computed(() => TYPE_LABEL[this.constraint().type] ?? 'Dimension');

  canSwitchType = computed(() => {
    const t = this.constraint().type;
    return t === 'radius' || t === 'diameter';
  });

  hasArrows = computed(() => {
    const c = this.constraint();
    // 3-point vertex angle renders as a plain leader label — no arc/arrows.
    if (c.type === 'angle' && c.targets.length === 3) return false;
    return HAS_ARROWS.has(c.type);
  });

  /** Same prefill convention as the viewer's inline dim editor: equation
   * dims show `=expr`, angles show degrees, lengths show the value in the
   * dim's effective unit with the unit suffix. */
  valueDisplay = computed(() => {
    const c = this.constraint();
    const expr = this.equationExpr();
    if (expr !== null) return `=${expr}`;
    const v = c.value ?? 0;
    if (c.type === 'angle') return formatNumber(v * 180 / Math.PI);
    const u: Unit = (c.unit as Unit | undefined) ?? this.defaultUnit();
    return `${formatNumber(fromMm(v, u))} ${unitSymbol(u)}`;
  });

  commitFromInput(ev: Event) {
    if (this.readonly()) return;
    const el = ev.target as HTMLInputElement;
    const raw = el.value.trim();
    // Unchanged (or emptied) → nothing to do; keeps blur-after-enter from
    // double-committing.
    if (!raw || raw === this.valueDisplay()) return;
    this.commitValue.emit({ id: this.constraint().id, raw });
  }

  resetInput(ev: Event) {
    const el = ev.target as HTMLInputElement;
    el.value = this.valueDisplay();
    el.blur();
  }

  onSetArrowsOutside(outside: boolean) {
    if (this.readonly()) return;
    if (!!this.constraint().arrowsOutside !== outside) {
      this.toggleArrows.emit(this.constraint().id);
    }
  }

  onSwitchType(to: 'radius' | 'diameter') {
    if (this.readonly() || this.constraint().type === to) return;
    this.switchType.emit({ id: this.constraint().id, to });
  }
}
