import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { InventoryService } from '../../../services/inventory.service';
import { Part } from '../../../models';
import { PartNumberPipe, formatPartNumber } from '../../../pipes/part-number.pipe';

interface LocationBarcode {
  id: number;
  barcode: string;
  type: string;
  name: string | null;
  description: string | null;
}

@Component({
  selector: 'app-new-build-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatAutocompleteModule,
    MatProgressSpinnerModule,
    PartNumberPipe,
  ],
  templateUrl: './new-build-dialog.html',
  styleUrl: './new-build-dialog.css',
})
export class NewBuildDialog implements OnInit {
  private dialogRef = inject(MatDialogRef<NewBuildDialog>);
  private inventoryService = inject(InventoryService);

  allParts = signal<Part[]>([]);
  searchText = signal('');
  selectedPart = signal<Part | null>(null);
  isSubmitting = signal(false);
  errorMessage = signal<string | null>(null);

  // Location selection
  locations = signal<LocationBarcode[]>([]);
  loadingLocations = signal(true);
  locationSearch = signal('');
  selectedLocationId = signal<number | null>(null);

  filteredParts = computed(() => {
    const search = this.searchText().toLowerCase();
    const parts = this.allParts().filter(p =>
      p.activeFlag && (p.PartCategory?.name === 'Kit' || p.PartCategory?.name === 'Assembly')
    );
    if (!search) return parts;
    return parts.filter(p =>
      p.name.toLowerCase().includes(search) ||
      (p.description && p.description.toLowerCase().includes(search)) ||
      (p.vendor && p.vendor.toLowerCase().includes(search)) ||
      (p.sku && p.sku.toLowerCase().includes(search))
    );
  });

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
    this.inventoryService.getAllParts().subscribe({
      next: (parts) => this.allParts.set(parts),
      error: () => this.errorMessage.set('Failed to load parts')
    });
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

  displayPartName(part: Part | string | null): string {
    if (!part) return '';
    if (typeof part === 'string') return part;
    return `${formatPartNumber(part.name, part.revision)} - ${part.description || ''}`;
  }

  getLocationLabel(loc: LocationBarcode): string {
    const detail = loc.name || loc.description;
    return detail ? `${loc.barcode} - ${detail}` : loc.barcode;
  }

  onPartSelected(part: Part) {
    this.selectedPart.set(part);
  }

  onLocationSelected(loc: LocationBarcode) {
    this.selectedLocationId.set(loc.id);
    this.locationSearch.set(this.getLocationLabel(loc));
  }

  onLocationInput(value: string) {
    this.locationSearch.set(value);
    if (this.selectedLocationId()) {
      this.selectedLocationId.set(null);
    }
  }

  onCancel() {
    this.dialogRef.close(null);
  }

  onSubmit() {
    const part = this.selectedPart();
    if (!part || !this.selectedLocationId()) return;

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    this.inventoryService.createTrace({
      partID: part.id,
      quantity: 1,
      parentBarcodeID: this.selectedLocationId(),
      unitOfMeasureID: part.defaultUnitOfMeasureID || 1,
    }).subscribe({
      next: (trace) => {
        this.dialogRef.close({ barcodeId: trace.barcodeID || trace.Barcode?.id });
      },
      error: (err) => {
        this.isSubmitting.set(false);
        this.errorMessage.set(err.error?.errorMessage || 'Failed to create build');
      }
    });
  }
}
