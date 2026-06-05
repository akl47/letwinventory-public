import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  EquationDoc, resolveEquations, evalExpression,
  setEquation, removeEquation, RESERVED_EQUATION_NAMES,
} from '../../../cad/lib/equations';

/**
 * SolidWorks-style equations dialog (REQ 640).
 *
 * Two sections, both rendered as 4-column tables (name | expression |
 * value | delete):
 *
 *   1. **Variables**  — globals the user defines. Always-present draft
 *      row at the bottom: typing a name OR expression auto-promotes
 *      it (no "+" button) and a fresh empty row appears below.
 *   2. **Used in**    — equations bound to specific feature or sketch
 *      parameters. The name column is a read-only friendly label
 *      (`f20 · distance`, `s5 · c2`); expression and delete still work.
 *      Section is hidden when there are no such bindings.
 *
 * Value column updates LIVE as the user types, against the rest of the
 * doc's resolved values.
 *
 * Palette matches the dark cad-editor theme: panel bg = #1e1e2e style,
 * text = #ddd, accents borrowed from the existing tool sidebars.
 */
@Component({
  selector: 'app-cad-equations-panel',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>
      <mat-icon class="title-icon">functions</mat-icon>
      Equations
    </h2>
    <mat-dialog-content class="eqn-content">
      <p class="hint view-only" *ngIf="readonly" data-testid="eqn-view-only">
        <mat-icon>visibility</mat-icon> View only — check out the part to edit variables.
      </p>
      <p class="hint" *ngIf="!readonly">
        Define named scalars below and reference them from any dimension input by typing
        <code>=name</code> in place of a literal number.
      </p>

      <!-- VARIABLES (globals) ─────────────────────────────────────── -->
      <section class="eqn-section">
        <h3 class="section-title">Variables</h3>
        <table class="eqn-table">
          <thead>
            <tr>
              <th class="col-name">Name</th>
              <th class="col-expr">Expression</th>
              <th class="col-val">Value</th>
              <th class="col-act"></th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let row of globals(); trackBy: trackKey"
                [class.has-error]="!!row.error">
              <td class="col-name">
                <div class="name-cell">
                  <input class="cell-input"
                         data-testid="eqn-name"
                         [disabled]="readonly"
                         [value]="row.key"
                         (blur)="renameGlobal(row.key, $any($event.target).value)" />
                  <span *ngIf="nameWarning(row.key) as w"
                        class="name-warning"
                        data-testid="eqn-name-warning"
                        [matTooltip]="w">⚠</span>
                </div>
              </td>
              <td>
                <input class="cell-input"
                       data-testid="eqn-expression"
                       [disabled]="readonly"
                       [value]="row.expression"
                       (input)="setLiveExpression(row.key, $any($event.target).value)"
                       (blur)="commitExpression(row.key, $any($event.target).value)" />
              </td>
              <td class="col-val">
                <span *ngIf="row.error" class="value-error" [matTooltip]="row.error">⚠ {{ row.error }}</span>
                <span *ngIf="!row.error" class="value-ok">{{ row.value }}</span>
              </td>
              <td class="col-act">
                <button class="btn-icon" data-testid="eqn-delete"
                        *ngIf="!readonly"
                        matTooltip="Delete"
                        (click)="deleteEntry(row.key)">
                  <mat-icon>delete</mat-icon>
                </button>
              </td>
            </tr>
            <!-- Always-present draft row — typing here auto-creates a new
                 variable, a fresh empty row appears immediately. -->
            <tr class="draft-row" *ngIf="!readonly" [class.has-error]="!!draftError()">
              <td class="col-name">
                <div class="name-cell">
                  <input #draftNameInput
                         class="cell-input"
                         placeholder="new variable"
                         data-testid="eqn-draft-name"
                         [value]="draftName()"
                         (input)="draftName.set($any($event.target).value)"
                         (blur)="commitDraft()" />
                  <span *ngIf="draftNameWarning() as w"
                        class="name-warning"
                        data-testid="eqn-draft-name-warning"
                        [matTooltip]="w">⚠</span>
                </div>
              </td>
              <td>
                <input class="cell-input"
                       placeholder="expression"
                       data-testid="eqn-draft-expression"
                       [value]="draftExpression()"
                       (input)="draftExpression.set($any($event.target).value)"
                       (keydown.enter)="onDraftEnter($event)"
                       (blur)="commitDraft()" />
              </td>
              <td class="col-val">
                <span *ngIf="draftError() as e" class="value-error" [matTooltip]="e">⚠ {{ e }}</span>
                <span *ngIf="!draftError() && draftValue() as v" class="value-ok">{{ v }}</span>
              </td>
              <td class="col-act"></td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- DEFAULT VARIABLES (built-in, from the part) ─────────────────── -->
      <section class="eqn-section" *ngIf="defaultVariables.length > 0">
        <h3 class="section-title">Default variables</h3>
        <table class="eqn-table">
          <thead>
            <tr>
              <th class="col-name">Name</th>
              <th class="col-expr">Reference</th>
              <th class="col-val">Value</th>
              <th class="col-act"></th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let v of defaultVariables" data-testid="eqn-default-var">
              <td class="col-name"><code class="target-label">{{ v.name }}</code></td>
              <td><code class="target-label">{{ '#{' + v.name + '}' }}</code></td>
              <td class="col-val"><span class="value-ok">{{ v.value || '—' }}</span></td>
              <td class="col-act"><mat-icon class="lock-icon" matTooltip="Built-in — provided by the part">lock</mat-icon></td>
            </tr>
          </tbody>
        </table>
        <p class="hint" style="margin: 6px 0 0">Built-in, read-only. Use in sketch text via <code>#{{ '{name}' }}</code>.</p>
      </section>

      <!-- USED IN (feature + sketch bindings) ──────────────────────── -->
      <section class="eqn-section" *ngIf="bindings().length > 0">
        <h3 class="section-title">Used in</h3>
        <table class="eqn-table">
          <thead>
            <tr>
              <th class="col-name">Target</th>
              <th class="col-expr">Expression</th>
              <th class="col-val">Value</th>
              <th class="col-act"></th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let row of bindings(); trackBy: trackKey"
                [class.has-error]="!!row.error">
              <td class="col-name" [matTooltip]="row.key">
                <code class="target-label">{{ row.label }}</code>
              </td>
              <td>
                <input class="cell-input"
                       [disabled]="readonly"
                       [value]="row.expression"
                       (input)="setLiveExpression(row.key, $any($event.target).value)"
                       (blur)="commitExpression(row.key, $any($event.target).value)" />
              </td>
              <td class="col-val">
                <span *ngIf="row.error" class="value-error" [matTooltip]="row.error">⚠ {{ row.error }}</span>
                <span *ngIf="!row.error" class="value-ok">{{ row.value }}</span>
              </td>
              <td class="col-act">
                <button class="btn-icon"
                        *ngIf="!readonly"
                        matTooltip="Unbind (keep current numeric value)"
                        (click)="deleteEntry(row.key)">
                  <mat-icon>link_off</mat-icon>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button class="cad-btn btn-text" data-testid="eqn-close" (click)="close()">Close</button>
    </mat-dialog-actions>
  `,
  styles: [`
    /* Dialog matches the dark cad-editor theme. mat-dialog itself
       provides its own surface; we paint our content on top. */
    :host { display: block; color: #ddd; }
    .eqn-content {
      width: 760px; max-width: 100%; max-height: 70vh; overflow-y: auto;
      background: #1e1e2e; color: #ddd;
      padding: 16px 20px;
    }
    .hint { font-size: 12px; color: #aaa; margin-bottom: 14px; line-height: 1.5; }
    .hint.view-only { display: flex; align-items: center; gap: 6px; color: #ffcc80; }
    .hint.view-only mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .hint code {
      background: #2d2d44; color: #ffeb3b;
      padding: 1px 4px; border-radius: 2px; font-size: 11px;
    }

    .eqn-section { margin-bottom: 20px; }
    .eqn-section:last-child { margin-bottom: 0; }
    .section-title {
      font-size: 11px; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.6px;
      color: #888; margin: 0 0 8px;
    }

    /* Fixed table layout — long expressions can't push the page out. */
    .eqn-table {
      width: 100%; border-collapse: collapse;
      font-size: 13px; table-layout: fixed;
      background: #25253a;
      border: 1px solid #3a3a52; border-radius: 4px;
      overflow: hidden;
    }
    .eqn-table th {
      text-align: left; padding: 6px 10px; font-weight: 500;
      color: #888; border-bottom: 1px solid #3a3a52;
      text-transform: uppercase; letter-spacing: 0.4px; font-size: 10px;
      background: #2a2a40;
    }
    .eqn-table td {
      padding: 4px 8px; vertical-align: middle;
      overflow: hidden; text-overflow: ellipsis;
      border-top: 1px solid #2d2d44;
    }
    .col-name { width: 200px; }
    .col-expr { min-width: 240px; }
    .col-val  { width: 110px; text-align: right; font-family: monospace; }
    .col-act  { width: 40px; text-align: center; }

    .target-label {
      display: inline-block; max-width: 100%;
      overflow: hidden; text-overflow: ellipsis;
      vertical-align: middle; font-size: 11px;
      color: #b5c2d4; padding: 4px 6px;
    }

    /* Name cell wraps the input with a reserved-name warning glyph
       (⚠) that appears inline to the right of the input when the
       chosen name shadows a math built-in. Tooltip carries the
       explanation; the icon stays terse to match the table density. */
    .name-cell {
      display: flex; align-items: center; gap: 4px;
    }
    .name-cell .cell-input { flex: 1; min-width: 0; }
    .name-warning {
      color: #ffb74d; font-size: 13px; line-height: 1;
      cursor: help; user-select: none;
      flex-shrink: 0;
    }

    .cell-input {
      width: 100%; padding: 4px 6px;
      border: 1px solid transparent; border-radius: 3px;
      font: inherit; color: #ddd;
      background: transparent; box-sizing: border-box;
    }
    .cell-input::placeholder { color: #666; }
    .cell-input:hover {
      background: #2d2d44;
    }
    .cell-input:focus {
      outline: none; border-color: #42a5f5;
      background: #1a1a2a;
    }
    /* Draft row inputs sit on a subtle accent tint so the user
       notices the "type to add" affordance without it shouting. */
    .draft-row td { background: rgba(66, 165, 245, 0.05); }
    .draft-row .cell-input { color: #ddd; }

    .value-ok    { color: #b5c2d4; }
    .value-error { color: #ef9a9a; font-style: italic; }
    tr.has-error .col-val { color: #ef9a9a; }

    .btn-icon {
      padding: 2px; min-width: 0; border: none; background: none;
      cursor: pointer; opacity: 0.55; color: #ddd;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .btn-icon:hover { opacity: 1; color: #ef9a9a; }
    .btn-icon mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .lock-icon { font-size: 15px; width: 15px; height: 15px; color: #6a6a80; cursor: help; }

    .title-icon { vertical-align: middle; margin-right: 4px; }

    /* Dialog title + actions sit on the mat-dialog surface; match
       the dark theme so they don't read as a light "header" bar. */
    :host ::ng-deep .mat-mdc-dialog-surface,
    :host ::ng-deep .mat-mdc-dialog-container .mdc-dialog__surface {
      background: #1e1e2e !important;
      color: #ddd !important;
    }
    :host ::ng-deep .mat-mdc-dialog-title {
      color: #ddd !important;
      background: #25253a;
      padding: 12px 20px !important;
      margin: 0 !important;
      border-bottom: 1px solid #3a3a52;
      font-size: 14px !important;
      font-weight: 600 !important;
    }
    :host ::ng-deep .mat-mdc-dialog-actions {
      background: #25253a;
      border-top: 1px solid #3a3a52;
      padding: 10px 16px !important;
    }
  `],
})
export class CadEquationsPanelComponent {
  private ref = inject(MatDialogRef<CadEquationsPanelComponent>);
  private data = inject(MAT_DIALOG_DATA) as {
    doc: EquationDoc;
    /** Built-in variables provided by the part (partName / partRevision / …).
     * Read-only; shown so the user knows what they can reference (in sketch
     * text via `#{name}`) without redefining them. */
    defaultVariables?: { name: string; value: string }[];
    /** View-only mode (part not checked out): variables are visible but every
     * edit affordance is disabled. */
    readonly?: boolean;
    /** Called every time the doc reaches a stable state (after each
     * commit, rename, delete, or draft promotion). Parent uses this
     * to push the new doc into its signal + trigger save+regen.
     * Debounced save on the parent batches rapid edits. */
    onChange?: (doc: EquationDoc) => void;
  };

  doc = signal<EquationDoc>(this.data.doc);
  defaultVariables = this.data.defaultVariables ?? [];
  readonly = !!this.data.readonly;

  /** Push the current doc upward whenever it reaches a stable state.
   * Called from every mutation path so the parent stays in sync
   * without an explicit Apply step. */
  private emitChange(): void {
    this.data.onChange?.(this.doc());
  }

  /** In-progress entry edits, keyed by entry key. While the user is
   * typing in a row, the doc's stored expression isn't updated yet
   * (we only commit on blur to avoid every keystroke writing to the
   * model); this map provides the live value the value column shows. */
  private liveExpressions = signal<Record<string, string>>({});

  /** Draft (bottom) row state for the Variables section. */
  draftName = signal('');
  draftExpression = signal('');
  /** Reference to the draft-name input so Enter on the draft
   * expression can advance focus back to it for fast keyboard entry
   * (type name → Tab → type expression → Enter → type next name → …). */
  private draftNameInput = viewChild<ElementRef<HTMLInputElement>>('draftNameInput');

  resolved = computed(() => resolveEquations(this.doc()));

  globals = computed<EquationRow[]>(() => this._rowsFor(k => !k.includes('.')));
  bindings = computed<EquationRow[]>(() => this._rowsFor(k => k.includes('.')));

  private _rowsFor(predicate: (key: string) => boolean): EquationRow[] {
    const entries = this.doc().entries;
    const live = this.liveExpressions();
    const { values, errors } = this.resolved();
    const keys = Object.keys(entries).filter(predicate).sort(sortEqnKeys);
    return keys.map(key => {
      const entry = entries[key];
      const expressionForRow = live[key] ?? entry.expression;
      // When the user is actively editing this row, the value column
      // reflects the in-progress expression rather than the
      // doc-committed one. Keeps the preview live.
      const liveResult = key in live ? evalExpression(live[key], values) : null;
      const isTarget = key.includes('.');
      return {
        key,
        label: isTarget ? shortLabelForKey(key) : key,
        isTarget,
        expression: expressionForRow,
        value: liveResult
          ? (liveResult.value !== undefined ? formatNumber(liveResult.value) : '—')
          : (key in values ? formatNumber(values[key]) : '—'),
        error: liveResult?.error ?? errors[key] ?? null,
      };
    });
  }

  /** Resolved value of the draft row's in-progress expression. */
  draftValue = computed<string | null>(() => {
    const expr = this.draftExpression().trim();
    if (!expr) return null;
    const r = evalExpression(expr, this.resolved().values);
    return r.value !== undefined ? formatNumber(r.value) : null;
  });

  /** Error of the draft expression OR a name-conflict warning. */
  draftError = computed<string | null>(() => {
    const name = this.draftName().trim();
    if (name && this.doc().entries[name]) return `name "${name}" already exists`;
    const expr = this.draftExpression().trim();
    if (!expr) return null;
    const r = evalExpression(expr, this.resolved().values);
    return r.error ?? null;
  });

  /** Soft warning when the draft name matches a built-in math name
   * (function like `sin`, or a formerly-reserved constant like `E` /
   * `PI`). Doesn't block save — math constants are no longer auto-
   * provided, and function names live in a separate namespace from
   * variables — but it's worth surfacing to avoid confusion. */
  draftNameWarning = computed<string | null>(() => {
    return reservedNameWarning(this.draftName().trim());
  });

  /** Same check for existing-row names. Returns null when fine. */
  nameWarning(name: string): string | null {
    return reservedNameWarning(name);
  }

  trackKey = (_: number, r: { key: string }) => r.key;

  /** Live-update the expression display + value preview without
   * committing to the doc. Commits on blur. */
  setLiveExpression(key: string, raw: string): void {
    this.liveExpressions.update(m => ({ ...m, [key]: raw }));
  }

  /** Commit a row's expression edit on blur. Empty input deletes the
   * entry (matches SolidWorks where clearing the expression removes
   * the equation). Clears the live cache for this key so the row
   * reads from the doc again. */
  commitExpression(key: string, raw: string): void {
    const expr = raw.trim();
    this.liveExpressions.update(m => {
      const next = { ...m };
      delete next[key];
      return next;
    });
    if (!expr) {
      this.deleteEntry(key);
      return;
    }
    if (expr === this.doc().entries[key]?.expression) return;
    this.doc.set(setEquation(this.doc(), key, expr));
    this.emitChange();
  }

  renameGlobal(oldName: string, newName: string): void {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    const entry = this.doc().entries[oldName];
    if (!entry) return;
    if (this.doc().entries[trimmed]) return;  // name conflict — silently ignore
    let next = removeEquation(this.doc(), oldName);
    next = setEquation(next, trimmed, entry.expression);
    this.doc.set(next);
    this.emitChange();
  }

  deleteEntry(key: string): void {
    this.doc.set(removeEquation(this.doc(), key));
    this.emitChange();
  }

  /** Promote the draft to a real entry when both inputs are non-empty
   * AND the name is unique + the expression parses. Called on blur
   * from either input and on Enter from the expression input. */
  commitDraft(): void {
    const name = this.draftName().trim();
    const expr = this.draftExpression().trim();
    if (!name || !expr) return;
    if (this.doc().entries[name]) return;
    if (this.draftError()) return;
    this.doc.set(setEquation(this.doc(), name, expr));
    this.draftName.set('');
    this.draftExpression.set('');
    this.emitChange();
  }

  /** Enter in the draft expression commits AND advances focus back
   * to the (now-empty) name input so the user can chain entries
   * without reaching for the mouse. */
  onDraftEnter(ev: Event): void {
    ev.preventDefault();
    this.commitDraft();
    // Wait a tick so the draft fields actually clear before re-focusing —
    // otherwise the blur from the keypress (which also commits) and the
    // focus() race, leaving the wrong input focused.
    queueMicrotask(() => this.draftNameInput()?.nativeElement.focus());
  }

  close(): void {
    // Changes are pushed live via emitChange() — no flush needed.
    this.ref.close(null);
  }
}

interface EquationRow {
  key: string;
  label: string;
  isTarget: boolean;
  expression: string;
  value: string;
  error: string | null;
}

/** Sort: globals alphabetical, then feature, then sketch — but the
 * sections are split into separate tables, so within either table
 * this is just a stable alphabetical sort. */
function sortEqnKeys(a: string, b: string): number {
  return a.localeCompare(b);
}

/** Display-friendly number formatting (4 sig figs, trailing-zero stripped). */
function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(4).replace(/\.?0+$/, '');
}

/** Build a human-readable warning when `name` collides with a math
 * built-in. Used by the draft row and existing variable rows. Returns
 * null when the name is safe (or empty). */
function reservedNameWarning(name: string): string | null {
  if (!name) return null;
  if (!RESERVED_EQUATION_NAMES.has(name)) return null;
  return `"${name}" matches a built-in math name — variables shadow them, which can be confusing`;
}

/** Friendly label for a target-key row — collapses the verbose
 * `feature.f20.startCondition.distance` into `f20 · start offset`. */
function shortLabelForKey(key: string): string {
  if (!key.includes('.')) return key;
  const parts = key.split('.');
  if (parts[0] === 'feature') {
    const id = parts[1];
    const tail = parts.slice(2).join('.');
    const niceTail = ({
      'distance': 'distance',
      'angle': 'angle',
      'direction2.distance': 'dir-2 distance',
      'startCondition.distance': 'start offset',
    } as Record<string, string>)[tail] ?? tail;
    return `${id} · ${niceTail}`;
  }
  if (parts[0] === 'sketch') {
    return `${parts[1]} · ${parts[3] ?? ''}`;
  }
  return key;
}
