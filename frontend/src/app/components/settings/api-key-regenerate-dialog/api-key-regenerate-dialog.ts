import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatRadioModule } from '@angular/material/radio';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { AuthService } from '../../../services/auth.service';
import { ExpirationMode, computeExpiresAt } from '../../../utils/expiration';

export interface ApiKeyRegenerateDialogData {
  id: number;
  name: string;
  /** The original key's expiresAt, used to pre-select the picker. */
  expiresAt?: string | null;
}

@Component({
  selector: 'app-api-key-regenerate-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatRadioModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    MatNativeDateModule,
  ],
  templateUrl: './api-key-regenerate-dialog.html',
  styleUrl: './api-key-regenerate-dialog.css',
})
export class ApiKeyRegenerateDialog {
  private dialogRef = inject(MatDialogRef<ApiKeyRegenerateDialog>);
  private authService = inject(AuthService);
  data = inject<ApiKeyRegenerateDialogData>(MAT_DIALOG_DATA);

  busy = signal(false);
  error = signal<string | null>(null);
  newKey = signal<string | null>(null);

  expirationMode: ExpirationMode;
  customExpiresAt: Date | null;
  minDate = new Date();

  constructor() {
    // Default the picker to mirror the original key: a specific date keeps the
    // date selected, a null original expiry starts as Never.
    if (this.data.expiresAt) {
      this.expirationMode = 'date';
      this.customExpiresAt = new Date(this.data.expiresAt);
    } else {
      this.expirationMode = 'never';
      this.customExpiresAt = null;
    }
  }

  regenerate() {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    const expiresAt = computeExpiresAt(this.expirationMode, this.customExpiresAt);
    const body: { expiresAt: string | null } = { expiresAt: expiresAt ? expiresAt.toISOString() : null };
    this.authService.regenerateApiKey(this.data.id, body).subscribe({
      next: (result) => {
        this.newKey.set(result.key);
        this.busy.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.error || 'Failed to regenerate API key');
        this.busy.set(false);
      },
    });
  }

  copyKey() {
    const key = this.newKey();
    if (key) navigator.clipboard.writeText(key);
  }

  close() {
    this.dialogRef.close(!!this.newKey());
  }
}
