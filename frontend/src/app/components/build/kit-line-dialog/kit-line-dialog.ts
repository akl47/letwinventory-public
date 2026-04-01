import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { InventoryService } from '../../../services/inventory.service';
import { PartNumberPipe } from '../../../pipes/part-number.pipe';

export interface KitLineDialogData {
  kitBarcodeId: number;
  partName: string;
  requiredQty: number;
  kittedQty: number;
}

@Component({
  selector: 'app-kit-line-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    PartNumberPipe,
  ],
  templateUrl: './kit-line-dialog.html',
  styleUrl: './kit-line-dialog.css',
})
export class KitLineDialog {
  private dialogRef = inject(MatDialogRef<KitLineDialog>);
  private inventoryService = inject(InventoryService);
  data: KitLineDialogData = inject(MAT_DIALOG_DATA);

  scanBarcode = '';
  scanResult = signal<{ tag: any; barcode: any } | null>(null);
  scanError = signal<string | null>(null);
  kitQuantity: number | null = null;
  isKitting = signal(false);

  get remaining(): number {
    return this.data.requiredQty - this.data.kittedQty;
  }

  onScan() {
    const barcode = this.scanBarcode.trim();
    if (!barcode) return;

    this.scanError.set(null);
    this.scanResult.set(null);

    this.inventoryService.lookupBarcode(barcode).subscribe({
      next: (barcodeData) => {
        this.inventoryService.getTagById(barcodeData.id).subscribe({
          next: (tag) => {
            if (tag.type !== 'Trace') {
              this.scanError.set('Scanned barcode is not a trace');
              return;
            }
            this.scanResult.set({ tag, barcode: barcodeData });
            this.kitQuantity = Math.min(this.remaining, tag.quantity || 0);
          },
          error: () => this.scanError.set('Failed to look up trace details')
        });
      },
      error: (err) => {
        this.scanError.set(err.status === 404 ? `Barcode "${barcode}" not found` : 'Failed to look up barcode');
      }
    });
  }

  confirmKit() {
    const result = this.scanResult();
    if (!result || !this.kitQuantity) return;

    this.isKitting.set(true);
    this.scanError.set(null);

    this.inventoryService.kitTrace(result.barcode.id, this.data.kitBarcodeId, this.kitQuantity).subscribe({
      next: () => {
        this.dialogRef.close({ success: true, quantity: this.kitQuantity, partName: result.tag.name });
      },
      error: (err) => {
        this.isKitting.set(false);
        this.scanError.set(err.error?.errorMessage || err.error?.message || 'Failed to kit trace');
      }
    });
  }

  clearScan() {
    this.scanResult.set(null);
    this.scanError.set(null);
    this.scanBarcode = '';
    this.kitQuantity = null;
  }

  onCancel() {
    this.dialogRef.close(null);
  }
}
