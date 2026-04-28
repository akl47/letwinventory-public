import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatRadioModule } from '@angular/material/radio';
import { InventoryService } from '../../../services/inventory.service';

export type BarcodeActionType = 'move' | 'merge' | 'split' | 'delete' | 'adjust' | 'kit' | 'unkit';

export interface BarcodeMovementDialogData {
  action: BarcodeActionType;
  barcodeId: number;
  barcode: string;
  isTrace: boolean;
  allowDecimal?: boolean;
  defaultQuantity?: number;
  /** For kit action: if true, barcodeId is the TARGET and user enters the SOURCE */
  kitToTarget?: boolean;
}

export interface BarcodeMovementDialogResult {
  success: boolean;
  action: BarcodeActionType;
  data?: any;
  error?: string;
}

@Component({
  selector: 'app-barcode-movement-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    MatRadioModule
  ],
  templateUrl: './barcode-movement-dialog.html',
  styleUrl: './barcode-movement-dialog.css'
})
export class BarcodeMovementDialog implements OnInit {
  private dialogRef = inject(MatDialogRef<BarcodeMovementDialog>);
  private inventoryService = inject(InventoryService);
  data: BarcodeMovementDialogData = inject(MAT_DIALOG_DATA);

  isSubmitting = signal(false);
  errorMessage = signal<string | null>(null);

  // Move fields
  destinationBarcode = '';

  // Split fields
  splitQuantity: number | null = null;

  // Merge fields
  mergeBarcode = '';

  // Adjust fields
  adjustQuantity: number | null = null;

  // Kit fields
  kitTargetBarcode = '';
  kitQuantity: number | null = null;

  ngOnInit() {
    if (this.data.action === 'kit' && this.data.defaultQuantity) {
      this.kitQuantity = this.data.defaultQuantity;
    }
  }

  // Delete fields
  deleteConfirmation = '';
  deleteType: 'full' | 'partial' = 'full';
  deleteQuantity: number | null = null;

  get actionTitle(): string {
    switch (this.data.action) {
      case 'move': return 'Move Barcode';
      case 'merge': return 'Merge Barcode';
      case 'split': return 'Split Barcode';
      case 'adjust': return 'Adjust Quantity';
      case 'kit': return 'Kit to Assembly';
      case 'unkit': return 'Dekit from Assembly';
      case 'delete': return 'Delete Barcode';
    }
  }

  get actionIcon(): string {
    switch (this.data.action) {
      case 'move': return 'swap_horiz';
      case 'merge': return 'call_merge';
      case 'split': return 'call_split';
      case 'adjust': return 'tune';
      case 'kit': return 'inventory_2';
      case 'unkit': return 'undo';
      case 'delete': return 'delete';
    }
  }

  get canSubmit(): boolean {
    switch (this.data.action) {
      case 'move':
        return !!this.destinationBarcode.trim();
      case 'merge':
        return !!this.mergeBarcode.trim();
      case 'split':
        return this.splitQuantity !== null && this.splitQuantity > 0;
      case 'adjust':
        return this.adjustQuantity !== null && this.adjustQuantity > 0;
      case 'kit':
      case 'unkit':
        return !!this.kitTargetBarcode.trim() && this.kitQuantity !== null && this.kitQuantity > 0;
      case 'delete':
        if (this.deleteConfirmation !== this.data.barcode) return false;
        if (this.data.isTrace && this.deleteType === 'partial') {
          return this.deleteQuantity !== null && this.deleteQuantity > 0;
        }
        return true;
    }
  }

  onCancel() {
    this.dialogRef.close({ success: false, action: this.data.action });
  }

  onSubmit() {
    if (!this.canSubmit) return;

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    switch (this.data.action) {
      case 'move':
        this.executeMove();
        break;
      case 'merge':
        this.executeMerge();
        break;
      case 'split':
        this.executeSplit();
        break;
      case 'adjust':
        this.executeAdjust();
        break;
      case 'kit':
        this.executeKit();
        break;
      case 'unkit':
        this.executeUnkit();
        break;
      case 'delete':
        this.executeDelete();
        break;
    }
  }

  private executeMove() {
    const barcodeString = this.destinationBarcode.trim();

    // First lookup the destination barcode to get its ID
    this.inventoryService.lookupBarcode(barcodeString).subscribe({
      next: (destinationBarcode) => {
        if (destinationBarcode.id === this.data.barcodeId) {
          this.isSubmitting.set(false);
          this.errorMessage.set('A barcode cannot be moved into itself');
          return;
        }
        // Now move the barcode to the destination
        this.inventoryService.moveBarcode(this.data.barcodeId, destinationBarcode.id).subscribe({
          next: (result) => {
            this.dialogRef.close({
              success: true,
              action: 'move',
              data: result
            });
          },
          error: (err) => {
            this.isSubmitting.set(false);
            this.errorMessage.set(err.error?.message || 'Failed to move barcode');
          }
        });
      },
      error: (err) => {
        this.isSubmitting.set(false);
        if (err.status === 404) {
          this.errorMessage.set(`Barcode "${barcodeString}" not found`);
        } else {
          this.errorMessage.set(err.error?.message || 'Failed to lookup destination barcode');
        }
      }
    });
  }

  private executeMerge() {
    const barcodeString = this.mergeBarcode.trim();

    // First lookup the barcode to merge into (the one that will stay)
    this.inventoryService.lookupBarcode(barcodeString).subscribe({
      next: (targetBarcode) => {
        // Merge current barcode into the entered barcode (entered barcode stays)
        this.inventoryService.mergeTrace(targetBarcode.id, this.data.barcodeId).subscribe({
          next: (result) => {
            this.dialogRef.close({
              success: true,
              action: 'merge',
              data: result
            });
          },
          error: (err) => {
            this.isSubmitting.set(false);
            this.errorMessage.set(err.error?.message || 'Failed to merge traces');
          }
        });
      },
      error: (err) => {
        this.isSubmitting.set(false);
        if (err.status === 404) {
          this.errorMessage.set(`Barcode "${barcodeString}" not found`);
        } else {
          this.errorMessage.set(err.error?.message || 'Failed to lookup barcode to merge into');
        }
      }
    });
  }

  private executeSplit() {
    if (this.splitQuantity === null) return;

    this.inventoryService.splitTrace(this.data.barcodeId, this.splitQuantity).subscribe({
      next: (result) => {
        this.dialogRef.close({
          success: true,
          action: 'split',
          data: result
        });
      },
      error: (err) => {
        this.isSubmitting.set(false);
        this.errorMessage.set(err.error?.message || 'Failed to split trace');
      }
    });
  }

  private executeAdjust() {
    if (this.adjustQuantity === null) return;

    this.inventoryService.adjustTraceQuantity(this.data.barcodeId, this.adjustQuantity!).subscribe({
      next: (result) => {
        this.dialogRef.close({
          success: true,
          action: 'adjust',
          data: result
        });
      },
      error: (err) => {
        this.isSubmitting.set(false);
        this.errorMessage.set(err.error?.message || 'Failed to adjust quantity');
      }
    });
  }

  private executeKit() {
    if (this.kitQuantity === null) return;
    const barcodeString = this.kitTargetBarcode.trim();

    this.inventoryService.lookupBarcode(barcodeString).subscribe({
      next: (scannedBarcode) => {
        // If kitToTarget, data.barcodeId is the target and the scanned barcode is the source
        const sourceBarcodeId = this.data.kitToTarget ? scannedBarcode.id : this.data.barcodeId;
        const targetBarcodeId = this.data.kitToTarget ? this.data.barcodeId : scannedBarcode.id;
        this.inventoryService.kitTrace(sourceBarcodeId, targetBarcodeId, this.kitQuantity!).subscribe({
          next: (result) => {
            this.dialogRef.close({
              success: true,
              action: 'kit',
              data: result
            });
          },
          error: (err) => {
            this.isSubmitting.set(false);
            this.errorMessage.set(err.error?.errorMessage || err.error?.message || 'Failed to kit trace');
          }
        });
      },
      error: (err) => {
        this.isSubmitting.set(false);
        if (err.status === 404) {
          this.errorMessage.set(`Barcode "${barcodeString}" not found`);
        } else {
          this.errorMessage.set(err.error?.message || 'Failed to lookup target barcode');
        }
      }
    });
  }

  private executeUnkit() {
    if (this.kitQuantity === null) return;
    const barcodeString = this.kitTargetBarcode.trim();

    this.inventoryService.lookupBarcode(barcodeString).subscribe({
      next: (targetBarcode) => {
        // data.barcodeId = the kit/WO trace, targetBarcode = the part barcode to return to
        this.inventoryService.unkitTrace(this.data.barcodeId, targetBarcode.id, this.kitQuantity!).subscribe({
          next: (result) => {
            this.dialogRef.close({ success: true, action: 'unkit', data: result });
          },
          error: (err) => {
            this.isSubmitting.set(false);
            this.errorMessage.set(err.error?.errorMessage || err.error?.message || 'Failed to dekit');
          }
        });
      },
      error: (err) => {
        this.isSubmitting.set(false);
        if (err.status === 404) {
          this.errorMessage.set(`Barcode "${barcodeString}" not found`);
        } else {
          this.errorMessage.set(err.error?.message || 'Failed to lookup barcode');
        }
      }
    });
  }

  private executeDelete() {
    if (!this.data.isTrace) {
      // Non-trace barcodes - use the existing deleteItem (sets activeFlag to false)
      this.inventoryService.deleteItem({ id: this.data.barcodeId } as any).subscribe({
        next: () => {
          this.dialogRef.close({
            success: true,
            action: 'delete',
            data: { deleted: true }
          });
        },
        error: (err) => {
          this.isSubmitting.set(false);
          this.errorMessage.set(err.error?.message || 'Failed to delete barcode');
        }
      });
      return;
    }

    // Trace barcodes - use deleteTrace with optional quantity
    const quantity = this.deleteType === 'partial' ? this.deleteQuantity! : undefined;
    this.inventoryService.deleteTrace(this.data.barcodeId, quantity).subscribe({
      next: (result) => {
        this.dialogRef.close({
          success: true,
          action: 'delete',
          data: result
        });
      },
      error: (err) => {
        this.isSubmitting.set(false);
        this.errorMessage.set(err.error?.message || 'Failed to delete trace');
      }
    });
  }
}
