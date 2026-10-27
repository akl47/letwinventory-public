import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { FormsModule } from '@angular/forms';

export interface ExtrudeDialogResult {
  distance: number;
  flipped: boolean;
  /** REQ 620 — sketch loops the user picked to extrude. Always at least one. */
  loopIndices: number[];
}

@Component({
  selector: 'app-extrude-dialog',
  standalone: true,
  imports: [
    CommonModule, MatDialogModule, MatButtonModule, MatIconModule, MatInputModule,
    MatFormFieldModule, MatCheckboxModule, FormsModule,
  ],
  template: `
    <h2 mat-dialog-title>Extrude</h2>
    <mat-dialog-content>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Distance</mat-label>
        <input matInput type="number" [(ngModel)]="distance" data-testid="extrude-input" autofocus>
      </mat-form-field>
      <div class="direction-row">
        <button mat-stroked-button data-testid="extrude-flip" (click)="flipped = !flipped">
          <mat-icon>{{ flipped ? 'south' : 'north' }}</mat-icon>
          Direction: {{ flipped ? 'reverse' : 'along normal' }}
        </button>
      </div>
      <div class="loop-picker" *ngIf="loopCount > 1">
        <h3>Profile regions ({{ loopCount }})</h3>
        <p class="hint">Pick which closed areas to extrude.</p>
        <div *ngFor="let _ of loopIndexArray(); let i = index">
          <mat-checkbox
              [attr.data-testid]="'extrude-loop-' + i"
              [checked]="isLoopSelected(i)"
              (change)="toggleLoop(i)">
            Region {{ i + 1 }}
          </mat-checkbox>
        </div>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="cancel()">Cancel</button>
      <button mat-raised-button color="primary" data-testid="extrude-apply" (click)="apply()" [disabled]="!isValid()">
        Apply
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .full-width { width: 100%; }
    .direction-row { margin-top: 4px; }
    .loop-picker { margin-top: 12px; }
    .loop-picker h3 { margin: 0 0 4px; font-size: 13px; opacity: 0.85; }
    .loop-picker .hint { margin: 0 0 8px; font-size: 12px; opacity: 0.65; }
  `],
})
export class ExtrudeDialogComponent {
  private ref = inject(MatDialogRef<ExtrudeDialogComponent>);
  private data = inject(MAT_DIALOG_DATA) as {
    defaultDistance: number;
    defaultFlipped?: boolean;
    loopCount?: number;
    defaultLoopIndices?: number[];
  };

  distance: number = this.data?.defaultDistance ?? 10;
  flipped: boolean = this.data?.defaultFlipped ?? false;
  loopCount: number = this.data?.loopCount ?? 1;
  selectedLoops = new Set<number>(this.data?.defaultLoopIndices ?? [0]);

  loopIndexArray(): number[] {
    return Array.from({ length: this.loopCount }, (_, i) => i);
  }
  isLoopSelected(i: number) { return this.selectedLoops.has(i); }
  toggleLoop(i: number) {
    if (this.selectedLoops.has(i)) this.selectedLoops.delete(i);
    else this.selectedLoops.add(i);
  }

  isValid() {
    return typeof this.distance === 'number' && this.distance > 0 && this.selectedLoops.size > 0;
  }
  cancel() { this.ref.close(null); }
  apply() {
    if (!this.isValid()) return;
    const loopIndices = Array.from(this.selectedLoops).sort((a, b) => a - b);
    const result: ExtrudeDialogResult = { distance: this.distance, flipped: this.flipped, loopIndices };
    this.ref.close(result);
  }
}
