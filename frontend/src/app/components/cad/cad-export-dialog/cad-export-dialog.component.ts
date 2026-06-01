import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';

export interface ExportDialogBody { id: string; label: string; }

export interface ExportDialogData {
  format: 'STL' | 'STEP';
  bodies: ExportDialogBody[];
  /** Part-level filename variables (#{partNumber}, #{rev}, …). `bodyName` is
   * supplied per body at export time. */
  vars: Record<string, string>;
}

export interface ExportDialogResult {
  /** Body ids to export, in the order shown. */
  bodyIds: string[];
  /** When true, each body becomes its own file; otherwise one combined file. */
  separate: boolean;
  /** When true (with `separate`), bundle the per-body files into one .zip. */
  zip: boolean;
  /** Filename template with #{var} placeholders (no extension). */
  nameTemplate: string;
}

export const DEFAULT_EXPORT_NAME_TEMPLATE = '#{partNumber}-#{rev} - #{bodyName}';

/** Resolve a filename template's #{var} placeholders, then tidy dangling
 * separators left by empty vars (e.g. a combined export has no #{bodyName}).
 * Returns a clean base name (no extension, no path-unsafe chars). */
export function resolveExportName(template: string, vars: Record<string, string>): string {
  let s = (template || '').replace(/#\{(\w+)\}/g, (_m, k) => vars[k] ?? '');
  // Drop separators stranded by empty substitutions: "A-B -  " / "  - A".
  s = s.replace(/\s*-\s*$/g, '').replace(/^\s*-\s*/g, '').replace(/\s{2,}/g, ' ').trim();
  s = s.replace(/[^a-zA-Z0-9._ -]+/g, '_').trim();
  return s || 'part';
}

@Component({
  selector: 'app-cad-export-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatCheckboxModule],
  template: `
    <h2 mat-dialog-title>Export {{ data.format }}</h2>
    <mat-dialog-content>
      <p class="hint">Choose which bodies to include. Defaults to all.</p>
      <div class="body-list">
        <mat-checkbox class="all" [checked]="allSelected()" [indeterminate]="someSelected()"
                      (change)="toggleAll($any($event).checked)">
          All bodies
        </mat-checkbox>
        <mat-checkbox *ngFor="let b of data.bodies"
                      [checked]="isSelected(b.id)"
                      (change)="toggle(b.id, $any($event).checked)">
          {{ b.label }}
        </mat-checkbox>
      </div>
      <mat-checkbox class="sep" [checked]="separate()" (change)="separate.set($any($event).checked)"
                    [disabled]="selectedCount() < 2">
        Export each body as a separate file
      </mat-checkbox>
      <mat-checkbox class="zip" *ngIf="separate() && selectedCount() >= 2"
                    [checked]="zip()" (change)="zip.set($any($event).checked)">
        Bundle into a single .zip
      </mat-checkbox>

      <div class="namebox">
        <label class="nlabel">File name</label>
        <input class="ninput" type="text" data-testid="export-name-template"
               [value]="nameTemplate()" (input)="nameTemplate.set($any($event.target).value)" />
        <p class="hint vars">
          Variables:
          <code *ngFor="let v of varKeys">{{ '#{' + v + '}' }}</code>
        </p>
        <p class="hint preview">
          → {{ previewName() }}{{ fileExt() }}
          <span *ngIf="separate() && zip() && selectedCount() >= 2"> &nbsp;(in {{ zipName() }})</span>
        </p>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button class="cad-btn btn-text" data-testid="export-cancel" (click)="cancel()">Cancel</button>
      <button class="cad-btn" data-testid="export-confirm" [disabled]="selectedCount() === 0" (click)="confirm()">
        Export
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .hint { font-size: 12px; opacity: 0.8; margin: 0 0 10px; }
    .namehint { margin: 10px 0 0; font-family: monospace; }
    .body-list { display: flex; flex-direction: column; gap: 6px; max-height: 260px; overflow: auto; }
    .body-list .all { border-bottom: 1px solid rgba(255,255,255,0.12); padding-bottom: 6px; margin-bottom: 2px; }
    .sep { margin-top: 12px; display: block; }
    .zip { margin: 6px 0 0 24px; display: block; }
    .namebox { margin-top: 14px; border-top: 1px solid rgba(255,255,255,0.12); padding-top: 12px; }
    .nlabel { font-size: 12px; opacity: 0.75; display: block; margin-bottom: 4px; }
    .ninput { width: 100%; box-sizing: border-box; padding: 6px 8px; font-family: monospace; font-size: 13px; }
    .vars { margin: 8px 0 4px; }
    .vars code { margin-right: 6px; opacity: 0.85; }
    .preview { margin: 4px 0 0; font-family: monospace; opacity: 0.95; }
  `],
})
export class CadExportDialogComponent {
  private ref = inject(MatDialogRef<CadExportDialogComponent>);
  data = inject(MAT_DIALOG_DATA) as ExportDialogData;
  selected = signal<Set<string>>(new Set(this.data.bodies.map(b => b.id)));
  separate = signal<boolean>(false);
  zip = signal<boolean>(false);
  nameTemplate = signal<string>(DEFAULT_EXPORT_NAME_TEMPLATE);
  /** Variable chips shown under the input. */
  varKeys = [...Object.keys(this.data.vars), 'bodyName'];

  fileExt(): string { return this.data.format === 'STL' ? '.stl' : '.step'; }

  /** Live preview of the first file's name. Combined exports resolve
   * #{bodyName} to empty; separate exports use the first selected body. */
  previewName(): string {
    const sep = this.separate() && this.selectedCount() >= 2;
    const firstId = this.data.bodies.find(b => this.selected().has(b.id))?.id;
    const bodyName = sep ? (this.data.bodies.find(b => b.id === firstId)?.label ?? '') : '';
    return resolveExportName(this.nameTemplate(), { ...this.data.vars, bodyName });
  }

  /** Zip file name (no #{bodyName}). */
  zipName(): string {
    return resolveExportName(this.nameTemplate(), { ...this.data.vars, bodyName: '' }) + '.zip';
  }

  isSelected(id: string): boolean { return this.selected().has(id); }
  selectedCount(): number { return this.selected().size; }
  allSelected(): boolean { return this.selected().size === this.data.bodies.length && this.data.bodies.length > 0; }
  someSelected(): boolean { const n = this.selected().size; return n > 0 && n < this.data.bodies.length; }

  toggle(id: string, on: boolean): void {
    const next = new Set(this.selected());
    if (on) next.add(id); else next.delete(id);
    this.selected.set(next);
  }
  toggleAll(on: boolean): void {
    this.selected.set(on ? new Set(this.data.bodies.map(b => b.id)) : new Set());
  }

  confirm(): void {
    if (this.selected().size === 0) return;
    const bodyIds = this.data.bodies.map(b => b.id).filter(id => this.selected().has(id));
    const separate = this.separate() && bodyIds.length >= 2;
    this.ref.close({
      bodyIds,
      separate,
      zip: separate && this.zip(),
      nameTemplate: this.nameTemplate(),
    } as ExportDialogResult);
  }
  cancel(): void { this.ref.close(null); }
}
