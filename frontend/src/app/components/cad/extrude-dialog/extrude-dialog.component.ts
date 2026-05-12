import { Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-extrude-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatInputModule, MatFormFieldModule, FormsModule],
  template: `
    <h2 mat-dialog-title>Extrude</h2>
    <mat-dialog-content>
      <mat-form-field appearance="outline">
        <mat-label>Distance</mat-label>
        <input matInput type="number" [(ngModel)]="distance" data-testid="extrude-input" autofocus>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="cancel()">Cancel</button>
      <button mat-raised-button color="primary" data-testid="extrude-apply" (click)="apply()" [disabled]="!isValid()">
        Apply
      </button>
    </mat-dialog-actions>
  `,
})
export class ExtrudeDialogComponent {
  private ref = inject(MatDialogRef<ExtrudeDialogComponent>);
  private data = inject(MAT_DIALOG_DATA) as { defaultDistance: number };

  distance: number = this.data?.defaultDistance ?? 10;

  isValid() { return typeof this.distance === 'number' && this.distance > 0; }
  cancel() { this.ref.close(null); }
  apply() { if (this.isValid()) this.ref.close(this.distance); }
}
