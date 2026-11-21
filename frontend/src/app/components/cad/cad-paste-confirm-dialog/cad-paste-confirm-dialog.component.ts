import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import type { UnresolvedRef, VariableChoice, VariableClash } from '../../../cad/lib/clipboardItems';

export interface PasteConfirmData { unresolved: UnresolvedRef[]; clashes: VariableClash[] }
export interface PasteConfirmResult { deleteKeys: string[]; variables: Record<string, VariableChoice> }

/** REQ 1102/1103 — Copy Confirmation: what a paste could not carry over.
 * Closes with the choices, or undefined when the paste is cancelled. */
@Component({
  selector: 'app-cad-paste-confirm-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title>Copy Confirmation</h2>
    <mat-dialog-content>
      @if (data.unresolved.length) {
        <p>These references point at geometry that is not part of the copy:</p>
        <div class="all">
          <button class="cad-btn btn-text" data-testid="paste-all-delete" (click)="setAll(true)">Delete all</button>
          <button class="cad-btn btn-text" data-testid="paste-all-dangle" (click)="setAll(false)">Leave all dangling</button>
        </div>
        <table class="refs">
          @for (u of data.unresolved; track u.key) {
            <tr [attr.data-testid]="'paste-ref'">
              <td>{{ u.itemName }} — {{ u.label }}</td>
              <td>
                <select class="cad-input" [disabled]="!u.deletable" [value]="deleted().has(u.key) ? 'delete' : 'dangle'"
                        (change)="set(u.key, $any($event.target).value === 'delete')">
                  @if (u.deletable) { <option value="delete">Delete reference</option> }
                  <option value="dangle">Leave dangling</option>
                </select>
              </td>
            </tr>
          }
        </table>
        <p class="hint">A deleted reference is removed from the pasted item. A dangling one shows as an error on the item until you re-pick it.</p>
      }
      @if (data.clashes.length) {
        <p>These variables already exist in this part with a different value:</p>
        <table class="refs">
          @for (c of data.clashes; track c.name) {
            <tr data-testid="paste-clash">
              <td><b>{{ c.name }}</b> — copied: {{ c.incoming }}, here: {{ c.existing }}</td>
              <td>
                <select class="cad-input" [value]="variables()[c.name] ?? 'existing'"
                        (change)="setVar(c.name, $any($event.target).value)">
                  <option value="existing">Use the one here</option>
                  <option value="rename">Add copied as new variable</option>
                  @if (c.value !== null) { <option value="bake">Use the value {{ c.value }}</option> }
                </select>
              </td>
            </tr>
          }
        </table>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button class="cad-btn btn-text" data-testid="paste-cancel" (click)="ref.close()">Cancel</button>
      <button class="cad-btn btn-primary" data-testid="paste-ok" (click)="ok()">Paste</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .refs { width: 100%; border-collapse: collapse; margin: 4px 0 12px; }
    .refs td { padding: 4px 8px 4px 0; vertical-align: middle; }
    .refs td:last-child { width: 1%; white-space: nowrap; padding-right: 0; }
    .all { display: flex; gap: 8px; }
    .hint { font-size: 12px; opacity: 0.8; line-height: 1.5; }
  `],
})
export class CadPasteConfirmDialogComponent {
  ref = inject(MatDialogRef<CadPasteConfirmDialogComponent, PasteConfirmResult>);
  data = inject(MAT_DIALOG_DATA) as PasteConfirmData;

  /** Deletable references default to Delete (the SolidWorks default). */
  deleted = signal(new Set(this.data.unresolved.filter(u => u.deletable).map(u => u.key)));
  variables = signal<Partial<Record<string, VariableChoice>>>({});

  set(key: string, del: boolean) {
    const next = new Set(this.deleted());
    if (del) next.add(key); else next.delete(key);
    this.deleted.set(next);
  }
  setAll(del: boolean) {
    this.deleted.set(new Set(del ? this.data.unresolved.filter(u => u.deletable).map(u => u.key) : []));
  }
  setVar(name: string, choice: VariableChoice) {
    this.variables.set({ ...this.variables(), [name]: choice });
  }
  ok() {
    this.ref.close({ deleteKeys: [...this.deleted()], variables: this.variables() as Record<string, VariableChoice> });
  }
}
