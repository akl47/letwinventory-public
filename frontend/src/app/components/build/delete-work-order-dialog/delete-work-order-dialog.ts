import { Component, Inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';

export interface DeleteWorkOrderDialogData {
  workOrderId: number;
  workOrderName: string;
  kittedCount: number;
  completedSteps: number;
}

export interface DeleteWorkOrderDialogResult {
  deletionReason: string;
}

@Component({
  selector: 'app-delete-work-order-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatIconModule,
  ],
  templateUrl: './delete-work-order-dialog.html',
  styleUrl: './delete-work-order-dialog.css',
})
export class DeleteWorkOrderDialog {
  reason = signal('');
  hasKittedWarning = computed(() => this.data.kittedCount > 0);
  hasCompletedStepsWarning = computed(() => this.data.completedSteps > 0);
  canSubmit = computed(() => this.reason().trim().length > 0);

  constructor(
    public dialogRef: MatDialogRef<DeleteWorkOrderDialog, DeleteWorkOrderDialogResult>,
    @Inject(MAT_DIALOG_DATA) public data: DeleteWorkOrderDialogData,
  ) {}

  confirm() {
    if (!this.canSubmit()) return;
    this.dialogRef.close({ deletionReason: this.reason().trim() });
  }

  cancel() {
    this.dialogRef.close();
  }
}
