import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface VerificationResult {
  passed: boolean;
  label: string;
  detail?: string;
}

export interface VerificationDialogData {
  title: string;
  checks: VerificationResult[];
  warnings: string[];
  canProceed: boolean;
  proceedLabel?: string;
}

@Component({
  selector: 'app-verification-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      <div class="check-list">
        @for (check of data.checks; track check.label) {
          <div class="check-item" [class.passed]="check.passed" [class.failed]="!check.passed">
            <mat-icon>{{ check.passed ? 'check_circle' : 'warning' }}</mat-icon>
            <div class="check-content">
              <span class="check-label">{{ check.label }}</span>
              @if (check.detail && !check.passed) {
                <span class="check-detail">{{ check.detail }}</span>
              }
            </div>
          </div>
        }
      </div>
      @if (data.warnings.length) {
        <div class="warnings-section">
          <h4>Warnings</h4>
          @for (w of data.warnings; track w) {
            <div class="warning-item">
              <mat-icon>info</mat-icon>
              <span>{{ w }}</span>
            </div>
          }
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      @if (data.canProceed) {
        <button mat-flat-button color="primary" (click)="dialogRef.close('proceed')">
          {{ data.proceedLabel || 'Proceed' }}
        </button>
      }
    </mat-dialog-actions>
  `,
  styles: [`
    .check-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
    .check-item { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border-radius: 6px; }
    .check-item.passed { background: rgba(76, 175, 80, 0.08); }
    .check-item.passed mat-icon { color: #4caf50; }
    .check-item.failed { background: rgba(255, 152, 0, 0.08); }
    .check-item.failed mat-icon { color: #ff9800; }
    .check-item mat-icon { font-size: 20px; width: 20px; height: 20px; flex-shrink: 0; margin-top: 1px; }
    .check-content { display: flex; flex-direction: column; }
    .check-label { font-weight: 500; font-size: 14px; }
    .check-detail { font-size: 12px; color: var(--mat-sys-on-surface-variant); margin-top: 2px; }
    .warnings-section h4 { margin: 0 0 8px 0; font-size: 13px; text-transform: uppercase; color: #888; }
    .warning-item { display: flex; align-items: flex-start; gap: 8px; padding: 6px 0; font-size: 13px; color: #ff9800; }
    .warning-item mat-icon { font-size: 18px; width: 18px; height: 18px; flex-shrink: 0; }
  `]
})
export class VerificationDialog {
  constructor(
    @Inject(MAT_DIALOG_DATA) public data: VerificationDialogData,
    public dialogRef: MatDialogRef<VerificationDialog>,
  ) {}
}
