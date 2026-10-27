import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

export type SketchDeleteAction = 'cascade' | 'break' | 'cancel';

export interface SketchDeleteWarningData {
  sketchId: string;
  dependentFeatureIds: string[];
}

@Component({
  selector: 'app-sketch-delete-warning-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>Delete sketch {{ data.sketchId }}?</h2>
    <mat-dialog-content>
      <p>
        This sketch is used by the following extrude feature{{ data.dependentFeatureIds.length === 1 ? '' : 's' }}:
      </p>
      <ul class="dep-list">
        <li *ngFor="let id of data.dependentFeatureIds">{{ id }}</li>
      </ul>
      <p class="hint">
        <b>Cascade</b> removes the sketch and every feature listed above.
        <b>Break references</b> removes only the sketch — listed features will surface as
        regeneration errors until you fix them.
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button class="cad-btn btn-text" data-testid="sketch-delete-cancel" (click)="choose('cancel')">Cancel</button>
      <button class="cad-btn" data-testid="sketch-delete-break" (click)="choose('break')">Break references</button>
      <button class="cad-btn btn-danger" data-testid="sketch-delete-cascade" (click)="choose('cascade')">Cascade delete</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .dep-list { margin: 4px 0 12px; padding-left: 24px; }
    .hint { font-size: 12px; opacity: 0.8; line-height: 1.5; }
  `],
})
export class SketchDeleteWarningDialogComponent {
  private ref = inject(MatDialogRef<SketchDeleteWarningDialogComponent>);
  data = inject(MAT_DIALOG_DATA) as SketchDeleteWarningData;

  choose(action: SketchDeleteAction) {
    this.ref.close(action);
  }
}
