import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface CadContextOrphanData {
  names: string[];
}

export interface CadContextOrphanResult {
  keep: boolean;
  dontAskAgain: boolean;
}

/** Sketch-exit prompt: an assembly context lost its last cross-part reference. */
@Component({
  selector: 'app-cad-context-orphan-dialog',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatIconModule, MatCheckboxModule],
  template: `
    <h2 mat-dialog-title>Keep assembly context?</h2>
    <mat-dialog-content>
      <div class="section-label">No longer referenced by any sketch</div>
      <div class="ctx-list">
        @for (n of data.names; track n) {
          <div class="ctx"><mat-icon>link</mat-icon><span>{{ n }}</span></div>
        }
      </div>
      <p class="hint">Keep leaves the context in the feature tree so you can add new references later.</p>
      <mat-checkbox data-testid="ctx-orphan-dont-ask" [(ngModel)]="dontAskAgain" class="dont-ask">
        Don't ask again for this part this session
      </mat-checkbox>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button color="warn" data-testid="ctx-orphan-remove" (click)="close(false)">Remove</button>
      <button mat-raised-button color="primary" data-testid="ctx-orphan-keep" cdkFocusInitial (click)="close(true)">Keep</button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content { min-width: 360px; }
    .section-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin: 2px 0 6px; }
    .ctx-list { max-height: 200px; overflow-y: auto; border: 1px solid #e0e0e0; border-radius: 6px; padding: 6px 10px; margin-bottom: 10px; background: #fafafa; }
    .ctx { display: flex; align-items: center; gap: 8px; padding: 2px 0; font-size: 13.5px; }
    .ctx mat-icon { font-size: 16px; width: 16px; height: 16px; color: #888; }
    .hint { font-size: 13px; color: #888; margin: 0 0 8px; }
    .dont-ask { display: block; font-size: 13px; }
  `],
})
export class CadContextOrphanDialogComponent {
  private ref = inject(MatDialogRef<CadContextOrphanDialogComponent, CadContextOrphanResult>);
  data = inject(MAT_DIALOG_DATA) as CadContextOrphanData;
  dontAskAgain = false;

  close(keep: boolean) {
    this.ref.close({ keep, dontAskAgain: this.dontAskAgain });
  }
}
