import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { EquationDoc, resolveEquations } from '../../../cad/lib/equations';
import { CadConfiguration } from '../../../cad/lib/types';

/**
 * SolidWorks-style configurations / design-table dialog (REQ: configurations).
 *
 * One table: rows = configurations (plus the read-only Default baseline),
 * columns = the part's GLOBAL equation variables (auto — one per variable)
 * plus user-added feature-suppression columns. A cell overrides that
 * variable's value for that configuration; blank = inherit the base value.
 * Suppression cells cycle inherit (—) → suppressed (✕) → unsuppressed (✓).
 *
 * The active configuration is chosen via the radio column; "Default"
 * clears activeConfigurationId (base document, today's behavior).
 *
 * Variables-only by design: to configure a dimension, drive it with a
 * variable expression first. The values map is keyed like equation
 * entries, so direct-dimension columns can be added later without a
 * data-model change.
 */
@Component({
  selector: 'app-cad-configurations-panel',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>
      <mat-icon class="title-icon">tune</mat-icon>
      Configurations
    </h2>
    <mat-dialog-content class="cfg-content">
      <p class="hint view-only" *ngIf="readonly" data-testid="cfg-view-only">
        <mat-icon>visibility</mat-icon> View only — check out the part to edit configurations.
      </p>
      <p class="hint" *ngIf="!readonly">
        Each configuration overrides <em>variable values</em> and <em>feature suppression</em>.
        Drive a dimension with a variable (type <code>=name</code> in its input) to make it
        configurable. Blank cells inherit the Default value.
      </p>
      <p class="hint" *ngIf="variables().length === 0">
        <mat-icon class="inline-icon">info</mat-icon>
        No variables defined yet — add them in the Equations panel to get value columns here.
      </p>

      <table class="cfg-table" *ngIf="configs().length > 0 || !readonly">
        <thead>
          <tr>
            <th class="col-active" matTooltip="Active configuration">●</th>
            <th class="col-name">Configuration</th>
            <th class="col-val" *ngFor="let v of variables()"><code>{{ v }}</code></th>
            <th class="col-sup" *ngFor="let f of suppressionCols()"
                [matTooltip]="'Suppression of ' + featureLabel(f)">
              <span class="sup-head">{{ featureLabel(f) }}</span>
              <button class="btn-icon col-remove" *ngIf="!readonly"
                      matTooltip="Remove column"
                      (click)="removeSuppressionCol(f)"><mat-icon>close</mat-icon></button>
            </th>
            <th class="col-act"></th>
          </tr>
        </thead>
        <tbody>
          <!-- Default baseline (read-only): base variable values + base suppression -->
          <tr class="default-row" data-testid="cfg-default-row">
            <td class="col-active">
              <input type="radio" name="activeCfg"
                     data-testid="cfg-active-default"
                     [checked]="!activeId()"
                     [disabled]="readonly"
                     (change)="setActive(undefined)" />
            </td>
            <td class="col-name"><span class="default-label">Default</span></td>
            <td class="col-val" *ngFor="let v of variables()">
              <span class="value-base">{{ baseValue(v) }}</span>
            </td>
            <td class="col-sup" *ngFor="let f of suppressionCols()">
              <span class="value-base">{{ baseSuppressed(f) ? '✕' : '✓' }}</span>
            </td>
            <td class="col-act"></td>
          </tr>
          <tr *ngFor="let cfg of configs(); trackBy: trackId" data-testid="cfg-row">
            <td class="col-active">
              <input type="radio" name="activeCfg"
                     data-testid="cfg-active"
                     [checked]="activeId() === cfg.id"
                     [disabled]="readonly"
                     (change)="setActive(cfg.id)" />
            </td>
            <td class="col-name">
              <input class="cell-input" data-testid="cfg-name"
                     [disabled]="readonly"
                     [value]="cfg.name"
                     (blur)="rename(cfg.id, $any($event.target).value)" />
            </td>
            <td class="col-val" *ngFor="let v of variables()">
              <input class="cell-input num" data-testid="cfg-value"
                     [disabled]="readonly"
                     [placeholder]="baseValue(v)"
                     [value]="cellValue(cfg, v)"
                     (blur)="setValue(cfg.id, v, $any($event.target).value)" />
            </td>
            <td class="col-sup" *ngFor="let f of suppressionCols()">
              <button class="sup-cell" data-testid="cfg-suppress"
                      [disabled]="readonly"
                      [matTooltip]="supTooltip(cfg, f)"
                      (click)="cycleSuppression(cfg.id, f)">
                {{ supGlyph(cfg, f) }}
              </button>
            </td>
            <td class="col-act">
              <button class="btn-icon" *ngIf="!readonly" matTooltip="Duplicate"
                      data-testid="cfg-duplicate"
                      (click)="duplicate(cfg.id)"><mat-icon>content_copy</mat-icon></button>
              <button class="btn-icon danger" *ngIf="!readonly" matTooltip="Delete"
                      data-testid="cfg-delete"
                      (click)="remove(cfg.id)"><mat-icon>delete</mat-icon></button>
            </td>
          </tr>
        </tbody>
      </table>

      <div class="toolbar" *ngIf="!readonly">
        <button class="cad-btn" data-testid="cfg-add" (click)="addConfig()">
          <mat-icon>add</mat-icon> Add configuration
        </button>
        <select class="panel-input add-col" data-testid="cfg-add-feature-col"
                *ngIf="availableFeatureCols().length > 0"
                [value]="''"
                (change)="addSuppressionCol($any($event.target).value)">
          <option value="" disabled selected>+ feature suppression column…</option>
          <option *ngFor="let f of availableFeatureCols()" [value]="f.id">{{ f.label }}</option>
        </select>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button class="cad-btn btn-text" data-testid="cfg-close" (click)="close()">Close</button>
    </mat-dialog-actions>
  `,
  styles: [`
    :host { display: block; color: #ddd; }
    .cfg-content {
      min-width: 560px; max-width: 100%; max-height: 70vh; overflow: auto;
      background: #1e1e2e; color: #ddd; padding: 16px 20px;
    }
    .hint { font-size: 12px; color: #aaa; margin-bottom: 12px; line-height: 1.5; }
    .hint.view-only { display: flex; align-items: center; gap: 6px; color: #ffcc80; }
    .hint.view-only mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .hint code { background: #2d2d44; color: #ffeb3b; padding: 1px 4px; border-radius: 2px; font-size: 11px; }
    .inline-icon { font-size: 14px; width: 14px; height: 14px; vertical-align: -2px; }

    .cfg-table {
      width: 100%; border-collapse: collapse; font-size: 13px;
      background: #25253a; border: 1px solid #3a3a52; border-radius: 4px;
    }
    .cfg-table th {
      text-align: left; padding: 6px 8px; font-weight: 500; color: #888;
      border-bottom: 1px solid #3a3a52; text-transform: uppercase;
      letter-spacing: 0.4px; font-size: 10px; background: #2a2a40;
      white-space: nowrap;
    }
    .cfg-table th code { text-transform: none; color: #b5c2d4; font-size: 11px; }
    .cfg-table td { padding: 4px 8px; border-top: 1px solid #2d2d44; vertical-align: middle; }
    .col-active { width: 30px; text-align: center; }
    .col-name { min-width: 140px; }
    .col-val { min-width: 90px; }
    .col-sup { min-width: 90px; text-align: center; }
    .col-act { width: 70px; text-align: right; white-space: nowrap; }
    .sup-head {
      display: inline-block; max-width: 110px; overflow: hidden;
      text-overflow: ellipsis; vertical-align: middle;
    }
    .col-remove { vertical-align: middle; }
    .col-remove mat-icon { font-size: 12px; width: 12px; height: 12px; }

    .default-row td { background: rgba(255, 255, 255, 0.02); }
    .default-label { font-style: italic; color: #9aa5b4; }
    .value-base { color: #7f8a99; font-family: monospace; font-size: 12px; }

    .cell-input {
      width: 100%; padding: 4px 6px; border: 1px solid transparent;
      border-radius: 3px; font: inherit; color: #ddd; background: transparent;
      box-sizing: border-box;
    }
    .cell-input.num { font-family: monospace; font-size: 12px; }
    .cell-input::placeholder { color: #595f6b; }
    .cell-input:hover { background: #2d2d44; }
    .cell-input:focus { outline: none; border-color: #42a5f5; background: #1a1a2a; }

    .sup-cell {
      min-width: 34px; padding: 2px 8px; border: 1px solid #3a3a52;
      border-radius: 3px; background: #2a2a40; color: #ddd; cursor: pointer;
      font-size: 12px; line-height: 18px;
    }
    .sup-cell:hover:not(:disabled) { border-color: #42a5f5; }
    .sup-cell:disabled { cursor: default; opacity: 0.6; }

    .toolbar { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
    .add-col {
      background: #25253a; color: #ddd; border: 1px solid #3a3a52;
      border-radius: 3px; padding: 5px 8px; font-size: 12px;
    }

    .btn-icon {
      padding: 2px; min-width: 0; border: none; background: none; cursor: pointer;
      opacity: 0.55; color: #ddd; display: inline-flex; align-items: center;
    }
    .btn-icon:hover { opacity: 1; }
    .btn-icon.danger:hover { color: #ef9a9a; }
    .btn-icon mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .cad-btn {
      display: inline-flex; align-items: center; gap: 4px;
      background: #2d2d44; color: #ddd; border: 1px solid #3a3a52;
      border-radius: 3px; padding: 5px 10px; font-size: 12px; cursor: pointer;
    }
    .cad-btn:hover { border-color: #42a5f5; }
    .cad-btn mat-icon { font-size: 16px; width: 16px; height: 16px; }

    .title-icon { vertical-align: middle; margin-right: 4px; }
    :host ::ng-deep .mat-mdc-dialog-surface,
    :host ::ng-deep .mat-mdc-dialog-container .mdc-dialog__surface {
      background: #1e1e2e !important; color: #ddd !important;
    }
    :host ::ng-deep .mat-mdc-dialog-title {
      color: #ddd !important; background: #25253a;
      padding: 12px 20px !important; margin: 0 !important;
      border-bottom: 1px solid #3a3a52; font-size: 14px !important; font-weight: 600 !important;
    }
    :host ::ng-deep .mat-mdc-dialog-actions {
      background: #25253a; border-top: 1px solid #3a3a52; padding: 10px 16px !important;
    }
  `],
})
export class CadConfigurationsPanelComponent {
  private ref = inject(MatDialogRef<CadConfigurationsPanelComponent>);
  private data = inject(MAT_DIALOG_DATA) as {
    configurations: CadConfiguration[];
    activeConfigurationId?: string;
    equations: EquationDoc;
    /** Feature-tree rows eligible for suppression columns (id + display
     * label + base suppressed flag), in tree order. Origin excluded. */
    features: Array<{ id: string; label: string; suppressed: boolean }>;
    readonly?: boolean;
    /** Pushed on every stable mutation — parent writes the configs +
     * active id onto featureTree and triggers its debounced save+regen. */
    onChange?: (configs: CadConfiguration[], activeId: string | undefined) => void;
  };

  configs = signal<CadConfiguration[]>((this.data.configurations ?? []).map(c => ({
    ...c,
    values: { ...(c.values ?? {}) },
    suppressed: { ...(c.suppressed ?? {}) },
  })));
  activeId = signal<string | undefined>(this.data.activeConfigurationId);
  readonly = !!this.data.readonly;

  /** Global variables (no-dot equation keys) — one value column each. */
  variables = computed<string[]>(() =>
    Object.keys(this.data.equations.entries ?? {}).filter(k => !k.includes('.')).sort());

  /** Base resolved values of the document with no overrides. */
  private baseResolved = resolveEquations(this.data.equations).values;

  /** Suppression columns = union of features referenced by any config +
   * columns added in this dialog session. */
  suppressionCols = signal<string[]>([...new Set(
    (this.data.configurations ?? []).flatMap(c => Object.keys(c.suppressed ?? {})),
  )]);

  availableFeatureCols = computed(() => {
    const used = new Set(this.suppressionCols());
    return this.data.features.filter(f => !used.has(f.id));
  });

  trackId = (_: number, c: CadConfiguration) => c.id;

  featureLabel(id: string): string {
    return this.data.features.find(f => f.id === id)?.label ?? id;
  }
  baseValue(variable: string): string {
    const v = this.baseResolved[variable];
    return v === undefined ? '—' : formatNumber(v);
  }
  baseSuppressed(featureId: string): boolean {
    return this.data.features.find(f => f.id === featureId)?.suppressed === true;
  }
  cellValue(cfg: CadConfiguration, variable: string): string {
    const v = cfg.values?.[variable];
    return typeof v === 'number' ? String(v) : '';
  }
  /** Suppression glyph: — inherit, ✕ suppressed, ✓ unsuppressed. */
  supGlyph(cfg: CadConfiguration, featureId: string): string {
    const s = cfg.suppressed?.[featureId];
    return s === true ? '✕' : s === false ? '✓' : '—';
  }
  supTooltip(cfg: CadConfiguration, featureId: string): string {
    const s = cfg.suppressed?.[featureId];
    const state = s === true ? 'Suppressed' : s === false ? 'Unsuppressed' : 'Inherit Default';
    return `${state} — click to change`;
  }

  private emit(): void {
    this.data.onChange?.(this.configs(), this.activeId());
  }

  setActive(id: string | undefined): void {
    this.activeId.set(id);
    this.emit();
  }

  addConfig(): void {
    const id = `cfg${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
    const n = this.configs().length + 1;
    this.configs.update(list => [...list, { id, name: `Config ${n}`, values: {}, suppressed: {} }]);
    this.emit();
  }

  duplicate(id: string): void {
    const src = this.configs().find(c => c.id === id);
    if (!src) return;
    const nid = `cfg${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
    this.configs.update(list => [...list, {
      id: nid, name: `${src.name} copy`,
      values: { ...(src.values ?? {}) }, suppressed: { ...(src.suppressed ?? {}) },
    }]);
    this.emit();
  }

  remove(id: string): void {
    this.configs.update(list => list.filter(c => c.id !== id));
    if (this.activeId() === id) this.activeId.set(undefined);
    this.emit();
  }

  rename(id: string, raw: string): void {
    const name = raw.trim();
    if (!name) return;
    this.configs.update(list => list.map(c => (c.id === id ? { ...c, name } : c)));
    this.emit();
  }

  /** Commit a variable-value cell. Blank/invalid clears the override
   * (inherit Default). */
  setValue(id: string, variable: string, raw: string): void {
    const trimmed = raw.trim();
    const num = trimmed === '' ? null : Number(trimmed);
    this.configs.update(list => list.map(c => {
      if (c.id !== id) return c;
      const values = { ...(c.values ?? {}) };
      if (num === null || !isFinite(num)) delete values[variable];
      else values[variable] = num;
      return { ...c, values };
    }));
    this.emit();
  }

  /** Click cycles inherit → suppressed → unsuppressed → inherit. */
  cycleSuppression(id: string, featureId: string): void {
    this.configs.update(list => list.map(c => {
      if (c.id !== id) return c;
      const suppressed = { ...(c.suppressed ?? {}) };
      const cur = suppressed[featureId];
      if (cur === undefined) suppressed[featureId] = true;
      else if (cur === true) suppressed[featureId] = false;
      else delete suppressed[featureId];
      return { ...c, suppressed };
    }));
    this.emit();
  }

  addSuppressionCol(featureId: string): void {
    if (!featureId) return;
    this.suppressionCols.update(cols => (cols.includes(featureId) ? cols : [...cols, featureId]));
  }

  /** Remove a column AND every config's override for it (so removal
   * actually returns those features to inherit). */
  removeSuppressionCol(featureId: string): void {
    this.suppressionCols.update(cols => cols.filter(c => c !== featureId));
    this.configs.update(list => list.map(c => {
      if (!c.suppressed || !(featureId in c.suppressed)) return c;
      const suppressed = { ...c.suppressed };
      delete suppressed[featureId];
      return { ...c, suppressed };
    }));
    this.emit();
  }

  close(): void {
    this.ref.close(null);
  }
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(4).replace(/\.?0+$/, '');
}
