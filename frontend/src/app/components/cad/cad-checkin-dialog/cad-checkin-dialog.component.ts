import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { CadModelService } from '../../../services/cad-model.service';
import { formatDiffEntry, FormattedDiff } from '../../../cad/lib/diffFormat';

export interface CadCheckinResult { message: string; keepCheckedOut: boolean; }

// Check-in dialog: shows the uncommitted changes (working copy vs the last
// check-in) and collects a commit message. Returns { message } on confirm, or
// null on cancel.
@Component({
  selector: 'app-cad-checkin-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatProgressSpinnerModule, MatCheckboxModule],
  template: `
    <h2 mat-dialog-title>Check in</h2>
    <mat-dialog-content>
      <div class="section-label">Changes since last check-in</div>
      <div class="diff">
        <div class="loading" *ngIf="loading()"><mat-spinner diameter="22"></mat-spinner></div>
        <ng-container *ngIf="!loading()">
          <ng-container *ngFor="let e of entries()">
            <div class="chg {{ e.cls }}"><span class="m">{{ e.sign }}</span><span>{{ e.text }}</span></div>
            <div class="chg sub {{ s.cls }}" *ngFor="let s of e.sublines"><span class="m">{{ s.sign }}</span><span>{{ s.text }}</span></div>
          </ng-container>
          <div class="empty" *ngIf="!entries().length && !error()">No changes since the last check-in.</div>
          <div class="empty err" *ngIf="error()">{{ error() }}</div>
        </ng-container>
      </div>
      <mat-form-field appearance="outline" class="msg">
        <mat-label>Check-in message</mat-label>
        <input matInput [(ngModel)]="message" placeholder="Describe what changed" cdkFocusInitial
               (keydown.enter)="confirm()">
      </mat-form-field>
      <mat-checkbox [(ngModel)]="keepCheckedOut" class="keep">
        Keep checked out (checkpoint — continue editing after check-in)
      </mat-checkbox>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="cancel()">Cancel</button>
      <button mat-raised-button color="primary" (click)="confirm()">Check in</button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content { min-width: 380px; }
    .section-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin: 2px 0 6px; }
    .diff { max-height: 280px; overflow-y: auto; border: 1px solid #e0e0e0; border-radius: 6px; padding: 8px 10px; margin-bottom: 14px; background: #fafafa; }
    .chg { display: flex; gap: 8px; padding: 1px 0; font-size: 13.5px; }
    .chg .m { font-family: ui-monospace, monospace; width: 12px; font-weight: 700; flex: 0 0 12px; }
    .chg.sub { padding-left: 18px; font-size: 12.5px; opacity: 0.92; }
    .chg.add, .chg.add .m { color: #2e7d32; }
    .chg.mod, .chg.mod .m { color: #1565c0; }
    .chg.del .m { color: #c62828; } .chg.del span:last-child { color: #c62828; text-decoration: line-through; }
    .empty { color: #888; font-size: 13px; padding: 2px 0; } .empty.err { color: #c62828; }
    .loading { display: flex; justify-content: center; padding: 14px; }
    .msg { width: 100%; }
    .keep { display: block; margin-top: -8px; font-size: 13px; }
  `],
})
export class CadCheckinDialogComponent {
  private data = inject<{ modelId: number }>(MAT_DIALOG_DATA);
  private ref = inject(MatDialogRef<CadCheckinDialogComponent, CadCheckinResult | null>);
  private cadApi = inject(CadModelService);

  message = '';
  keepCheckedOut = false;
  loading = signal(true);
  entries = signal<FormattedDiff[]>([]);
  error = signal<string | null>(null);

  constructor() {
    this.cadApi.workingDiff(this.data.modelId).subscribe({
      next: d => {
        this.entries.set((d.entries ?? []).filter(e => e.status !== 'unchanged').map(formatDiffEntry));
        this.loading.set(false);
      },
      error: () => { this.error.set('Could not load changes.'); this.loading.set(false); },
    });
  }

  confirm() { this.ref.close({ message: this.message, keepCheckedOut: this.keepCheckedOut }); }
  cancel() { this.ref.close(null); }
}
