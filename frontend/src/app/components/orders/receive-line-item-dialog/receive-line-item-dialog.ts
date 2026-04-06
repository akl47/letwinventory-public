import { Component, inject, signal, computed, OnInit } from '@angular/core';
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
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { OrderItem } from '../../../models';
import { InventoryService } from '../../../services/inventory.service';
import { formatPartNumber } from '../../../pipes/part-number.pipe';

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

interface ReceiveSettingsCache {
  receiptType: 'full' | 'partial';
  printBarcode: boolean;
  barcodeSize: string;
  locationId: number | null;
  locationTimestamp: number | null;
}

const CACHE_KEY = 'receiveDialogSettings';
const LOCATION_TTL_MS = 5 * 60 * 1000; // 5 minutes

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
    MatAutocompleteModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './receive-line-item-dialog.html',
  styleUrl: './receive-line-item-dialog.css'
})
export class ReceiveLineItemDialog implements OnInit {
  private dialogRef = inject(MatDialogRef<ReceiveLineItemDialog>);
  private inventoryService = inject(InventoryService);
  data: ReceiveLineItemDialogData = inject(MAT_DIALOG_DATA);

  formatPN = (part: any) => formatPartNumber(part?.name, part?.revision);
  receiptType = signal<'full' | 'partial'>('full');
  partialQuantity = signal<number>(1);
  printBarcode = signal<boolean>(false);
  barcodeSize = signal<string>('3x1');
  selectedLocationId = signal<number | null>(null);
  locations = signal<LocationBarcode[]>([]);
  loadingLocations = signal<boolean>(true);
  equipmentName = signal<string>('');
  serialNumber = signal<string>('');
  locationSearch = signal<string>('');

  barcodeSizes = [
    { value: '3x1', label: '3" x 1"' },
    { value: '1.5x1', label: '1.5" x 1"' }
  ];

  filteredLocations = computed(() => {
    const search = this.locationSearch().toLowerCase();
    const locs = this.locations();
    if (!search) return locs;
    return locs.filter(loc => {
      const label = loc.name || loc.description || '';
      return loc.barcode.toLowerCase().includes(search) || label.toLowerCase().includes(search);
    });
  });

  ngOnInit() {
    this.loadCachedSettings();
    this.loadLocations();
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
        // If we have a cached location, set the search text to show it
        const locId = this.selectedLocationId();
        if (locId) {
          const loc = locations.find(l => l.id === locId);
          if (loc) {
            this.locationSearch.set(this.getLocationLabel(loc));
          } else {
            // Cached location no longer exists
            this.selectedLocationId.set(null);
          }
        }
      },
      error: () => {
        this.loadingLocations.set(false);
      }
    });
  }

  getLocationLabel(loc: LocationBarcode): string {
    const detail = loc.name || loc.description;
    return detail ? `${loc.barcode} - ${detail}` : loc.barcode;
  }

  onLocationSelected(loc: LocationBarcode) {
    this.selectedLocationId.set(loc.id);
    this.locationSearch.set(this.getLocationLabel(loc));
  }

  onLocationInput(value: string) {
    this.locationSearch.set(value);
    // Clear selection if user edits the text
    if (this.selectedLocationId()) {
      const loc = this.locations().find(l => l.id === this.selectedLocationId());
      if (loc && this.getLocationLabel(loc) !== value) {
        this.selectedLocationId.set(null);
      }
    }
  }

  get isEquipment(): boolean {
    return this.data.isEquipment === true;
  }

  get canSubmit(): boolean {
    if (!this.selectedLocationId()) {
      return false;
    }
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

    this.saveCachedSettings();

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

  private loadCachedSettings() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const cached: ReceiveSettingsCache = JSON.parse(raw);
      this.receiptType.set(cached.receiptType || 'full');
      this.printBarcode.set(cached.printBarcode ?? false);
      this.barcodeSize.set(cached.barcodeSize || '3x1');
      // Only restore location if used within the TTL
      if (cached.locationId && cached.locationTimestamp &&
          (Date.now() - cached.locationTimestamp) < LOCATION_TTL_MS) {
        this.selectedLocationId.set(cached.locationId);
      }
    } catch {
      // Ignore corrupt cache
    }
  }

  private saveCachedSettings() {
    const settings: ReceiveSettingsCache = {
      receiptType: this.receiptType(),
      printBarcode: this.printBarcode(),
      barcodeSize: this.barcodeSize(),
      locationId: this.selectedLocationId(),
      locationTimestamp: Date.now()
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(settings));
  }
}
