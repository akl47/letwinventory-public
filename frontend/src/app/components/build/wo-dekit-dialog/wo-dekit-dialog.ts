import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { InventoryService } from '../../../services/inventory.service';
import { BarcodeTag } from '../../inventory/barcode-tag/barcode-tag';
import { KittedTrace } from '../../../models/work-order.model';

export interface WoDekitDialogData {
  woBarcodeId: number;
  woBarcode: string;
  partName: string;
  partRevision: string;
  kittedTraces: KittedTrace[];
}

@Component({
  selector: 'app-wo-dekit-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatRadioModule, MatProgressSpinnerModule, BarcodeTag,
  ],
  template: `
    <div class="dialog-container">
      <h2 mat-dialog-title>
        <mat-icon>undo</mat-icon>
        Dekit {{ data.partName }}
      </h2>

      <mat-dialog-content>
        @if (data.kittedTraces.length === 0) {
          <p class="no-traces">No kitted traces found for this part.</p>
        } @else if (data.kittedTraces.length === 1) {
          <div class="trace-info">
            <span class="label">Barcode:</span>
            <app-barcode-tag [barcode]="data.kittedTraces[0].barcode" ></app-barcode-tag>
            <span class="kitted-qty">{{ data.kittedTraces[0].qty }} kitted</span>
          </div>
        } @else {
          <p class="action-description">Select which trace to dekit from:</p>
          <mat-radio-group [(ngModel)]="selectedTraceIndex" class="trace-select-group">
            @for (trace of data.kittedTraces; track trace.barcodeID; let i = $index) {
              <mat-radio-button [value]="i" class="trace-option">
                <div class="trace-option-content">
                  <app-barcode-tag [barcode]="trace.barcode" ></app-barcode-tag>
                  <span class="kitted-qty">{{ trace.qty }} kitted</span>
                  @if (!trace.barcodeActiveFlag) {
                    <span class="inactive-badge">Inactive</span>
                  }
                </div>
              </mat-radio-button>
            }
          </mat-radio-group>
        }

        @if (selectedTrace()) {
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Quantity to Dekit</mat-label>
            <input matInput type="number" [(ngModel)]="dekitQuantity"
                   [max]="selectedTrace()!.qty" min="1" step="1">
            <mat-icon matPrefix>tag</mat-icon>
          </mat-form-field>

          @if (!selectedTrace()!.barcodeActiveFlag) {
            <div class="location-prompt">
              <mat-icon class="location-warn-icon">warning</mat-icon>
              <span>This barcode is currently inactive. It will be reactivated. Provide a location for the returned part.</span>
            </div>
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Location Barcode</mat-label>
              <input matInput [(ngModel)]="locationBarcode" placeholder="Scan or enter location barcode">
              <mat-icon matPrefix>qr_code_scanner</mat-icon>
            </mat-form-field>
          }
        }

        @if (errorMessage()) {
          <div class="error-message">
            <mat-icon>error</mat-icon>
            <span>{{ errorMessage() }}</span>
          </div>
        }
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button mat-button (click)="onCancel()" [disabled]="isSubmitting()">Cancel</button>
        <button mat-flat-button color="warn"
                (click)="onSubmit()"
                [disabled]="!canSubmit() || isSubmitting()">
          @if (isSubmitting()) {
            <mat-spinner diameter="20"></mat-spinner>
          } @else {
            <ng-container><mat-icon>undo</mat-icon> Dekit</ng-container>
          }
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .dialog-container { min-width: 400px; }
    h2 { display: flex; align-items: center; gap: 8px; }
    .trace-info { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
    .label { color: #888; font-size: 13px; }
    .kitted-qty { color: #aaa; font-size: 13px; }
    .action-description { color: #aaa; font-size: 13px; margin-bottom: 8px; }
    .no-traces { color: #888; font-style: italic; }
    .trace-select-group { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
    .trace-option-content { display: flex; align-items: center; gap: 8px; }
    .inactive-badge { font-size: 11px; background: rgba(244,67,54,0.15); color: #ef5350; padding: 1px 6px; border-radius: 8px; }
    .full-width { width: 100%; }
    .location-prompt { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 12px; padding: 8px 12px; background: rgba(255,152,0,0.08); border: 1px solid rgba(255,152,0,0.2); border-radius: 4px; font-size: 13px; color: #ffb74d; }
    .location-warn-icon { color: #ff9800; font-size: 20px; width: 20px; height: 20px; flex-shrink: 0; }
    .error-message { display: flex; align-items: center; gap: 8px; color: #f44336; margin-top: 8px; font-size: 13px; }
  `],
})
export class WoDekitDialog {
  private dialogRef = inject(MatDialogRef<WoDekitDialog>);
  private inventoryService = inject(InventoryService);
  data: WoDekitDialogData = inject(MAT_DIALOG_DATA);

  isSubmitting = signal(false);
  errorMessage = signal<string | null>(null);

  selectedTraceIndex = 0;
  dekitQuantity: number | null = null;
  locationBarcode = '';

  selectedTrace = signal<KittedTrace | null>(null);

  constructor() {
    // Auto-select single trace and pre-fill qty
    if (this.data.kittedTraces.length === 1) {
      this.selectedTraceIndex = 0;
      this.dekitQuantity = this.data.kittedTraces[0].qty;
      this.selectedTrace.set(this.data.kittedTraces[0]);
    } else if (this.data.kittedTraces.length > 1) {
      this.updateSelectedTrace();
    }
  }

  updateSelectedTrace() {
    const trace = this.data.kittedTraces[this.selectedTraceIndex] ?? null;
    this.selectedTrace.set(trace);
    if (trace) {
      this.dekitQuantity = trace.qty;
    }
  }

  canSubmit = signal(false);

  ngDoCheck() {
    // Update selected trace when radio changes
    const trace = this.data.kittedTraces[this.selectedTraceIndex] ?? null;
    if (trace !== this.selectedTrace()) {
      this.selectedTrace.set(trace);
      if (trace) this.dekitQuantity = trace.qty;
    }

    const t = this.selectedTrace();
    const valid = !!t
      && this.dekitQuantity !== null
      && this.dekitQuantity > 0
      && this.dekitQuantity <= t.qty
      && (!t.barcodeActiveFlag ? this.locationBarcode.trim().length > 0 : true);
    this.canSubmit.set(valid);
  }

  onCancel() {
    this.dialogRef.close({ success: false });
  }

  onSubmit() {
    if (!this.canSubmit()) return;
    const trace = this.selectedTrace()!;

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    const needsMove = !trace.barcodeActiveFlag && this.locationBarcode.trim();

    if (needsMove) {
      // Validate location barcode BEFORE unkitting
      this.inventoryService.lookupBarcode(this.locationBarcode.trim()).subscribe({
        next: (locationBarcode) => {
          this.executeUnkit(trace, locationBarcode.id);
        },
        error: (err) => {
          this.isSubmitting.set(false);
          if (err.status === 404) {
            this.errorMessage.set(`Location barcode "${this.locationBarcode.trim()}" not found`);
          } else {
            this.errorMessage.set(err.error?.message || 'Failed to lookup location barcode');
          }
        },
      });
    } else {
      this.executeUnkit(trace, null);
    }
  }

  private executeUnkit(trace: KittedTrace, moveToLocationBarcodeId: number | null) {
    this.inventoryService.unkitTrace(this.data.woBarcodeId, trace.barcodeID, this.dekitQuantity!).subscribe({
      next: () => {
        if (moveToLocationBarcodeId !== null) {
          this.inventoryService.moveBarcode(trace.barcodeID, moveToLocationBarcodeId).subscribe({
            next: () => this.dialogRef.close({ success: true }),
            error: (err) => {
              this.dialogRef.close({ success: true, moveError: err.error?.message || 'Failed to move barcode to location' });
            },
          });
        } else {
          this.dialogRef.close({ success: true });
        }
      },
      error: (err) => {
        this.isSubmitting.set(false);
        this.errorMessage.set(err.error?.errorMessage || err.error?.message || 'Failed to dekit');
      },
    });
  }
}
