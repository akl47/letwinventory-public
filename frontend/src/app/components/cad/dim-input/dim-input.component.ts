import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { evalExpression } from '../../../cad/lib/equations';

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
        <span class="resolved-value">= {{ preview.value }}{{ unit() ? ' ' + unit() : '' }}</span>
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
  /** Unit label shown next to the resolved preview ("mm", "deg", …). */
  unit = input<string | null>(null);
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
  displayText = computed<string>(() => {
    const buffer = this.editText();
    if (buffer !== null) return buffer;
    const expr = this.expression();
    if (expr !== null) return `=${expr}`;
    return String(this.value());
  });

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

  onFocus(): void {
    this.editText.set(this.displayText());
  }

  onTyping(raw: string): void {
    this.editText.set(raw);
  }

  onCommit(raw: string): void {
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
    // Plain number — strip any prior equation, commit the number.
    const num = parseFloat(text);
    if (!isFinite(num)) {
      // Reject — restore previous value by re-emitting current.
      this.valueChange.emit(this.value());
      return;
    }
    if (this.expression() !== null) this.expressionChange.emit(null);
    this.valueChange.emit(num);
  }
}
