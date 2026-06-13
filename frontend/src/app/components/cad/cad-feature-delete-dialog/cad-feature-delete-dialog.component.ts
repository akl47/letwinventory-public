import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';

export interface FeatureDeleteData {
  /** Display names of the features being deleted. */
  featureNames: string[];
  /** Sketches linked ONLY to the features being deleted (not used by any
   * surviving feature) — eligible to delete alongside. Empty hides the
   * checkbox. */
  deletableSketchLabels: string[];
}

export interface FeatureDeleteResult {
  confirmed: boolean;
  deleteSketches: boolean;
}

@Component({
  selector: 'app-cad-feature-delete-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatCheckboxModule],
  template: `
    <h2 mat-dialog-title>
      {{ data.featureNames.length === 1 ? 'Delete feature?' : 'Delete ' + data.featureNames.length + ' features?' }}
    </h2>
    <mat-dialog-content>
      <ul class="feat-list" data-testid="del-feature-list">
        <li *ngFor="let n of data.featureNames">{{ n }}</li>
      </ul>
      <mat-checkbox *ngIf="data.deletableSketchLabels.length > 0"
                    data-testid="del-also-sketch"
                    [checked]="deleteSketches()"
                    (change)="deleteSketches.set($any($event).checked)">
        Also delete {{ data.deletableSketchLabels.length === 1 ? 'the linked sketch' : 'the ' + data.deletableSketchLabels.length + ' linked sketches' }}
      </mat-checkbox>
      <ul class="sketch-list" *ngIf="data.deletableSketchLabels.length > 0 && deleteSketches()">
        <li *ngFor="let s of data.deletableSketchLabels">{{ s }}</li>
      </ul>
      <p class="hint" *ngIf="data.deletableSketchLabels.length > 0">
        Only sketches used solely by the deleted feature{{ data.featureNames.length === 1 ? '' : 's' }} are offered —
        sketches still referenced by other features are kept.
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button class="cad-btn btn-text" data-testid="del-cancel" (click)="cancel()">Cancel</button>
      <button class="cad-btn btn-danger" data-testid="del-confirm" (click)="confirm()">Delete</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .feat-list { margin: 4px 0 12px; padding-left: 22px; }
    .sketch-list { margin: 6px 0 4px; padding-left: 22px; font-size: 12px; opacity: 0.75; }
    .hint { font-size: 12px; opacity: 0.7; line-height: 1.5; margin: 10px 0 0; }
  `],
})
export class CadFeatureDeleteDialogComponent {
  private ref = inject(MatDialogRef<CadFeatureDeleteDialogComponent>);
  data = inject(MAT_DIALOG_DATA) as FeatureDeleteData;
  deleteSketches = signal(false);

  cancel() { this.ref.close({ confirmed: false, deleteSketches: false } as FeatureDeleteResult); }
  confirm() { this.ref.close({ confirmed: true, deleteSketches: this.deleteSketches() } as FeatureDeleteResult); }
}
