import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { evalExpression } from '../../../cad/lib/equations';
import { formatNumber, fromMm, resolveFieldEntry, unitSymbol, type Unit } from '../../../cad/lib/units';

const LENGTH_UNITS: readonly string[] = ['mm', 'um', 'in'];

/** Display precision per unit. Inches need more decimals than millimetres:
 * at 3 decimals one step is 0.0254 mm, coarse enough that re-committing a
 * displayed value would visibly move the model. */
const DECIMALS: Record<Unit, number> = { mm: 3, um: 3, in: 5 };

/**
 * Expression-aware numeric input (REQ 641).
 *
 * A drop-in replacement for `<input type="number">` that ALSO accepts the
 * SolidWorks-style `=<expression>` syntax. Three states:
 *
 *  - **Number mode** (default): user types `50` → emits `valueChange(50)`
 *    and `expressionChange(null)`. Identical to a plain number input.
 *  - **Expression mode**: user types `=length * 2` → live evaluator
 *    resolves against the supplied `equationValues` map, shows the
 *    numeric result beneath the input, emits BOTH the resolved number
 *    (`valueChange`) and the expression text (`expressionChange`)
 *    on blur / Enter so the parent can persist the equation.
 *  - **Driven mode** (inputs set externally): when the parent passes a
 *    non-null `expression` input, the field renders the expression with
 *    a Σ badge. Editing it replaces the equation; clearing the field
 *    or typing a bare number drops the equation back to a literal.
 *
 * Persists the resolved number in `value` regardless of mode so any
 * downstream consumer that reads `value` always sees a number.
 */
@Component({
  selector: 'app-dim-input',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dim-input-wrap">
      <input #inp
             class="dim-input"
             type="text"
             [attr.data-testid]="testid()"
             [attr.aria-label]="ariaLabel()"
             [value]="displayText()"
             (focus)="onFocus()"
             (input)="onTyping($any($event.target).value)"
             (blur)="onCommit($any($event.target).value)"
             (keydown.enter)="$any($event.target).blur()" />
      <span class="sigma-badge" *ngIf="expression() !== null" title="Driven by equation">Σ</span>
    </div>
    <div class="resolved" *ngIf="livePreview() as preview">
      <ng-container *ngIf="preview.error; else okPreview">
        <span class="resolved-error">{{ preview.error }}</span>
      </ng-container>
      <ng-template #okPreview>
        <span class="resolved-value">= {{ previewText() }}</span>
      </ng-template>
    </div>
  `,
  styles: [`
    :host { display: inline-block; width: 100%; }
    .dim-input-wrap { position: relative; display: flex; align-items: center; }
    .dim-input {
      width: 100%; padding: 4px 8px; border: 1px solid #ccc; border-radius: 3px;
      font-family: inherit; font-size: 13px; height: 30px; box-sizing: border-box;
    }
    .dim-input:focus { outline: 1px solid #42a5f5; border-color: #42a5f5; }
    .sigma-badge {
      position: absolute; right: 6px;
      background: #ffc107; color: #333; font-weight: bold;
      padding: 0 4px; border-radius: 3px; font-size: 10px;
      pointer-events: none;
    }
    .resolved { font-size: 10px; color: #888; padding: 2px 0 0 2px; min-height: 12px; }
    .resolved-value { font-family: monospace; }
    .resolved-error { color: #d32f2f; font-style: italic; }
  `],
})
export class DimInputComponent {
  /** Current resolved numeric value. When `expression` is non-null, this
   * should be the resolved value of that expression. */
  value = input.required<number>();
  /** Expression text (without leading `=`) when this dim is driven by
   * an equation; null when it's a literal number. */
  expression = input<string | null>(null);
  /** Resolved global / target values used to evaluate live expressions.
   * Pass the editor's `equationValues` computed signal here. */
  equationValues = input<Record<string, number>>({});
  /** Unit for this field. A LENGTH unit ('mm' | 'um' | 'in') additionally makes
   * the field unit-aware (REQ 940): the stored value is canonical millimeters,
   * displayed in this unit, and the user may type any unit suffix ("0.5in",
   * "200µm") to enter a value in a different unit. Any other label ('deg', …)
   * is treated as display-only with no conversion — matching how the sketch
   * dimension editor parses angles with plain parseFloat. */
  unit = input<string | null>(null);

  /** The MODEL's unit for this field, or null when it isn't a length
   * (angles/counts keep their plain numeric behaviour). */
  private modelUnit = computed<Unit | null>(() => {
    const u = this.unit();
    return u && LENGTH_UNITS.includes(u) ? (u as Unit) : null;
  });

  /** Per-field unit override, mirroring `SketchConstraint.unit` on a sketch
   * dimension: typing an explicit suffix makes the field keep displaying in
   * that unit; typing a bare number reverts it to the model default.
   *
   * A dimension stores this on the constraint, but a sidebar field has no
   * such record — features carry a bare millimetre number. It is a display
   * preference, so it is persisted per field alongside the editor's other
   * `cad*` UI preferences, keyed by testid. */
  private unitOverride = signal<Unit | null>(null);
  private overrideKey = computed<string | null>(() => {
    const t = this.testid();
    return t ? `cadFieldUnit:${t}` : null;
  });
  private storedOverride = computed<Unit | null>(() => {
    const key = this.overrideKey();
    if (!key) return null;
    const v = localStorage.getItem(key);
    return v && LENGTH_UNITS.includes(v) ? (v as Unit) : null;
  });
  /** The unit this field currently displays in: explicit override, else the
   * model default. Null for non-length fields. */
  private lengthUnit = computed<Unit | null>(() => {
    const model = this.modelUnit();
    if (!model) return null;
    return this.unitOverride() ?? this.storedOverride() ?? model;
  });

  private setUnitOverride(u: Unit | null): void {
    this.unitOverride.set(u);
    const key = this.overrideKey();
    if (!key) return;
    if (u) localStorage.setItem(key, u);
    else localStorage.removeItem(key);
  }
  /** Testid + aria label hooks for the underlying input element. */
  testid = input<string | null>(null);
  ariaLabel = input<string | null>(null);

  /** Emitted with the resolved numeric value when the user commits. */
  valueChange = output<number>();
  /** Emitted with the expression text on commit, or null when the user
   * cleared the expression (typed a literal number). Parent persists
   * this into the equations document. */
  expressionChange = output<string | null>();

  // Local edit buffer — what's literally in the text field during edit.
  // Cleared on blur (we render from inputs again). Decoupled from the
  // input value so typing doesn't fire signal-update churn upstream.
  private editText = signal<string | null>(null);

  /** What the input element currently DISPLAYS. While focused with edits
   * in progress, that's the edit buffer; otherwise it's the expression
   * (with `=` prefix) if driven, else the literal value. */
  /** The field's text as derived from its INPUTS only — deliberately blind to
   * the edit buffer. The no-op check compares against this; comparing against
   * `displayText()` mid-edit would compare the typed text with itself and
   * silently discard every commit. */
  private pristineText = computed<string>(() => {
    const expr = this.expression();
    if (expr !== null) return `=${expr}`;
    const lu = this.lengthUnit();
    // Stored value is mm; show it in this field's unit WITH the suffix — the
    // same prefill convention as a sketch dimension, so the unit a value is
    // expressed in is never ambiguous.
    return lu
      ? `${formatNumber(fromMm(this.value(), lu), DECIMALS[lu])} ${unitSymbol(lu)}`
      : String(this.value());
  });

  displayText = computed<string>(() => this.editText() ?? this.pristineText());

  /** Live preview shown below the input. Always null in plain-number
   * mode (no preview needed when WYSIWYG); shows the resolved value or
   * the parse error otherwise. */
  livePreview = computed<{ value?: number; error?: string } | null>(() => {
    const text = this.displayText();
    if (!text.startsWith('=')) return null;
    const expr = text.slice(1);
    if (!expr.trim()) return null;
    return evalExpression(expr, this.equationValues());
  });

  /** The resolved-expression preview, shown in the field's own unit.
   * Equation values are canonical millimetres (a shared global means the same
   * length everywhere), so the expression result is NOT re-interpreted in this
   * field's unit — only converted for display, matching what the field will
   * show once committed. */
  previewText = computed<string>(() => {
    const p = this.livePreview();
    if (!p || p.value === undefined) return '';
    const lu = this.lengthUnit();
    if (lu) return `${formatNumber(fromMm(p.value, lu))} ${unitSymbol(lu)}`;
    const label = this.unit();
    return label ? `${p.value} ${label}` : String(p.value);
  });

  onFocus(): void {
    this.editText.set(this.displayText());
  }

  onTyping(raw: string): void {
    this.editText.set(raw);
  }

  onCommit(raw: string): void {
    // Compare against the pristine (input-derived) text, NOT displayText() —
    // mid-edit the latter IS the edit buffer.
    const before = this.pristineText();
    this.editText.set(null);
    const text = raw.trim();
    if (text.startsWith('=')) {
      const expr = text.slice(1).trim();
      if (!expr) {
        // `=` with nothing after — treat as clearing the equation.
        this.expressionChange.emit(null);
        return;
      }
      const r = evalExpression(expr, this.equationValues());
      if (r.error || r.value === undefined) {
        // Invalid expression — keep the equation text (so user sees the
        // error in the preview) but don't change the numeric value.
        this.expressionChange.emit(expr);
        return;
      }
      this.expressionChange.emit(expr);
      this.valueChange.emit(r.value);
      return;
    }
    // Plain number. REQ 940: on a length field the text is parsed unit-aware,
    // so "0.5in" stores 12.7 (mm) rather than 0.5 — plain parseFloat used to
    // drop the suffix silently and store a wrong value. The decision lives in
    // resolveFieldEntry so it is unit-testable without a TestBed.
    const outcome = resolveFieldEntry(text, before, this.modelUnit());
    if (outcome.kind === 'noop') return;
    if (outcome.kind === 'reject') {
      // Restore the previous value by re-emitting the current one.
      this.valueChange.emit(this.value());
      return;
    }
    // Explicit suffix → remember it for this field; bare number → revert to
    // the model default. Same rule a dimension applies to its `unit`.
    if (this.modelUnit()) this.setUnitOverride(outcome.unitOverride);
    if (this.expression() !== null) this.expressionChange.emit(null);
    this.valueChange.emit(outcome.value);
  }
}
