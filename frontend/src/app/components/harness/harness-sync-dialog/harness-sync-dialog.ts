import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';

export interface SyncChange {
  elementType: 'connector' | 'cable' | 'component';
  elementId: string;
  label: string;
  changes: { field: string; description: string }[];
  dbData: any;
  accepted: boolean;
}

export interface SyncDialogData {
  changes: SyncChange[];
}

@Component({
  selector: 'app-harness-sync-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatCheckboxModule,
    MatIconModule
  ],
  templateUrl: './harness-sync-dialog.html',
  styleUrls: ['./harness-sync-dialog.css']
})
export class HarnessSyncDialog {
  private dialogRef = inject(MatDialogRef<HarnessSyncDialog>);
  data: SyncDialogData = inject(MAT_DIALOG_DATA);

  getTypeIcon(type: string): string {
    switch (type) {
      case 'connector': return 'settings_input_component';
      case 'cable': return 'cable';
      case 'component': return 'memory';
      default: return 'info';
    }
  }

  acceptSelected() {
    this.dialogRef.close(this.data.changes);
  }

  keepAll() {
    this.data.changes.forEach(c => c.accepted = false);
    this.dialogRef.close(this.data.changes);
  }
}
