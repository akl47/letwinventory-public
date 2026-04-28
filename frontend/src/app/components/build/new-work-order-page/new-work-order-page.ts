import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatCardModule } from '@angular/material/card';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ManufacturingService } from '../../../services/manufacturing.service';
import { InventoryService } from '../../../services/inventory.service';
import { EngineeringMaster } from '../../../models/engineering-master.model';

@Component({
  selector: 'app-new-work-order-page',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule,
    MatAutocompleteModule, MatCardModule, MatSnackBarModule,
  ],
  templateUrl: './new-work-order-page.html',
  styleUrl: './new-work-order-page.css',
})
export class NewWorkOrderPage implements OnInit {
  router = inject(Router);
  private manufacturingService = inject(ManufacturingService);
  private inventoryService = inject(InventoryService);
  private snackBar = inject(MatSnackBar);

  // Master selection
  masterSearch = signal('');
  masterResults = signal<EngineeringMaster[]>([]);
  selectedMaster = signal<EngineeringMaster | null>(null);
  allMasters = signal<EngineeringMaster[]>([]);

  // Location selection
  locationSearch = signal('');
  locationResults = signal<any[]>([]);
  selectedLocation = signal<any>(null);
  allLocations = signal<any[]>([]);

  // Quantity
  quantity = signal(1);

  // Creating state
  isCreating = signal(false);

  canCreate = computed(() =>
    !!this.selectedMaster() && !!this.selectedLocation() && this.quantity() > 0 && !this.isCreating()
  );

  outputPreview = computed(() => {
    const master = this.selectedMaster();
    const qty = this.quantity();
    if (!master?.outputParts) return [];
    return master.outputParts.map(op => ({
      name: op.part?.name,
      revision: op.part?.revision,
      quantity: qty * Number(op.quantity),
    }));
  });

  ngOnInit() {
    // Load released masters
    this.manufacturingService.getMasters().subscribe({
      next: (masters) => {
        this.allMasters.set(masters.filter(m => m.releaseState === 'released'));
      },
    });

    // Load locations
    this.inventoryService.getLocationBarcodes().subscribe({
      next: (locations) => this.allLocations.set(locations),
    });
  }

  searchMasters(query: string) {
    this.masterSearch.set(query);
    if (typeof query !== 'string') return;
    const q = query.toLowerCase();
    this.masterResults.set(
      this.allMasters().filter(m => m.name?.toLowerCase().includes(q)).slice(0, 10)
    );
  }

  selectMaster(master: EngineeringMaster) {
    this.selectedMaster.set(master);
    this.masterSearch.set('');
    this.masterResults.set([]);
  }

  clearMaster() {
    this.selectedMaster.set(null);
  }

  displayMaster(master: any): string {
    return master?.name || '';
  }

  searchLocations(query: string) {
    this.locationSearch.set(query);
    if (typeof query !== 'string') return;
    const q = query.toLowerCase();
    this.locationResults.set(
      this.allLocations().filter(l =>
        l.barcode?.toLowerCase().includes(q) ||
        l.name?.toLowerCase().includes(q) ||
        l.description?.toLowerCase().includes(q)
      ).slice(0, 10)
    );
  }

  selectLocation(location: any) {
    this.selectedLocation.set(location);
    this.locationSearch.set('');
    this.locationResults.set([]);
  }

  clearLocation() {
    this.selectedLocation.set(null);
  }

  displayLocation(loc: any): string {
    return loc ? `${loc.barcode} - ${loc.name || loc.description || ''}` : '';
  }

  create() {
    const master = this.selectedMaster();
    const location = this.selectedLocation();
    if (!master || !location) return;

    this.isCreating.set(true);
    this.manufacturingService.createWorkOrder({
      engineeringMasterID: master.id,
      quantity: this.quantity(),
      locationBarcodeID: location.id,
    }).subscribe({
      next: (wo) => {
        this.snackBar.open('Work Order created', 'OK', { duration: 2000 });
        this.router.navigate(['/build/work-orders', wo.id]);
      },
      error: (err) => {
        this.isCreating.set(false);
        this.snackBar.open('Error: ' + (err.error?.errorMessage || err.error?.message || err.message), 'OK', { duration: 5000 });
      },
    });
  }
}
