import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { OrderItem } from '../../../models';
import { InventoryService } from '../../../services/inventory.service';

export interface ReceiveLineItemDialogData {
  orderItem: OrderItem;
  remainingQuantity: number;
  isEquipment?: boolean;
}

export interface ReceiveLineItemDialogResult {
  success: boolean;
  receivedQuantity: number;
  printBarcode: boolean;
  barcodeSize: string;
  parentBarcodeID: number;
  equipmentName?: string | null;
  serialNumber?: string | null;
}

interface LocationBarcode {
  id: number;
  barcode: string;
  type: string;
  name: string | null;
  description: string | null;
}

@Component({
  selector: 'app-receive-line-item-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatRadioModule,
    MatSlideToggleModule,
    MatSelectModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './receive-line-item-dialog.html',
  styleUrl: './receive-line-item-dialog.css'
})
export class ReceiveLineItemDialog implements OnInit {
  private dialogRef = inject(MatDialogRef<ReceiveLineItemDialog>);
  private inventoryService = inject(InventoryService);
  data: ReceiveLineItemDialogData = inject(MAT_DIALOG_DATA);

  receiptType = signal<'full' | 'partial'>('full');
  partialQuantity = signal<number>(1);
  printBarcode = signal<boolean>(false);
  barcodeSize = signal<string>('3x1');
  selectedLocationId = signal<number | null>(null);
  locations = signal<LocationBarcode[]>([]);
  loadingLocations = signal<boolean>(true);
  equipmentName = signal<string>('');
  serialNumber = signal<string>('');

  barcodeSizes = [
    { value: '3x1', label: '3" x 1"' },
    { value: '1.5x1', label: '1.5" x 1"' }
  ];

  ngOnInit() {
    this.loadLocations();
    // Pre-fill equipment name from part name
    if (this.data.isEquipment) {
      const name = this.data.orderItem.Part?.name || this.data.orderItem.name || '';
      this.equipmentName.set(name);
    }
  }

  private loadLocations() {
    this.loadingLocations.set(true);
    this.inventoryService.getLocationBarcodes().subscribe({
      next: (locations) => {
        this.locations.set(locations);
        this.loadingLocations.set(false);
      },
      error: () => {
        this.loadingLocations.set(false);
      }
    });
  }

  get isEquipment(): boolean {
    return this.data.isEquipment === true;
  }

  get canSubmit(): boolean {
    // Must have a location selected
    if (!this.selectedLocationId()) {
      return false;
    }
    // Equipment requires a name and is always received 1 at a time
    if (this.isEquipment) {
      return !!this.equipmentName().trim();
    }
    if (this.receiptType() === 'full') {
      return true;
    }
    const qty = this.partialQuantity();
    return qty > 0 && qty <= this.data.remainingQuantity;
  }

  get receivedQuantity(): number {
    // Equipment is always received 1 at a time
    if (this.isEquipment) {
      return 1;
    }
    if (this.receiptType() === 'full') {
      return this.data.remainingQuantity;
    }
    return this.partialQuantity();
  }

  onCancel() {
    this.dialogRef.close(null);
  }

  onSubmit() {
    if (!this.canSubmit) return;

    const result: ReceiveLineItemDialogResult = {
      success: true,
      receivedQuantity: this.receivedQuantity,
      printBarcode: this.printBarcode(),
      barcodeSize: this.barcodeSize(),
      parentBarcodeID: this.selectedLocationId()!,
      equipmentName: this.isEquipment ? this.equipmentName().trim() : null,
      serialNumber: this.isEquipment ? (this.serialNumber().trim() || null) : null
    };

    this.dialogRef.close(result);
  }
}
