import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatIconModule } from '@angular/material/icon';
import { Observable } from 'rxjs';
import { map, startWith } from 'rxjs/operators';
import { InventoryService } from '../../../services/inventory.service';
import { Part, OrderItem } from '../../../models';
import { ErrorNotificationService } from '../../../services/error-notification.service';

export interface OrderItemDialogData {
  orderID: number;
  orderItem?: OrderItem;
}

@Component({
  selector: 'app-order-item-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatAutocompleteModule,
    MatIconModule
  ],
  templateUrl: './order-item-dialog.html',
  styleUrl: './order-item-dialog.css'
})
export class OrderItemDialog implements OnInit {
  private fb = inject(FormBuilder);
  private inventoryService = inject(InventoryService);
  private errorNotification = inject(ErrorNotificationService);
  private dialogRef = inject(MatDialogRef<OrderItemDialog>);
  data = inject<OrderItemDialogData>(MAT_DIALOG_DATA);

  allParts = signal<Part[]>([]);
  selectedPart = signal<Part | null>(null);

  orderLineTypes = signal([
    { id: 1, name: 'Part' },
    { id: 2, name: 'Shipping' },
    { id: 3, name: 'Taxes' },
    { id: 4, name: 'Services' },
    { id: 5, name: 'Other' }
  ]);

  form = this.fb.group({
    orderLineTypeID: [1, Validators.required],
    partSearch: [''],
    partID: [null as number | null],
    name: [''],
    quantity: [1, [Validators.required, Validators.min(1)]],
    price: [0, [Validators.required, Validators.min(0)]]
  });

  filteredParts!: Observable<Part[]>;

  isPartLineType = computed(() => this.form.value.orderLineTypeID === 1);

  lineTotal = computed(() => {
    const quantity = this.form.value.quantity || 0;
    const price = this.form.value.price || 0;
    return quantity * price;
  });

  ngOnInit() {
    this.loadParts();
    this.setupAutocomplete();

    // If editing an existing item, populate the form
    if (this.data.orderItem) {
      const item = this.data.orderItem;
      this.form.patchValue({
        orderLineTypeID: item.orderLineTypeID,
        partID: item.partID,
        name: item.name || '',
        quantity: item.quantity,
        price: typeof item.price === 'string' ? parseFloat(item.price) : item.price
      });

      // If it's a Part line item, set up the part search field
      if (item.Part) {
        // Cast to Part since we know it has the essential fields from backend
        this.selectedPart.set(item.Part as Part);
        this.form.patchValue({
          partSearch: this.formatPartDisplay(item.Part)
        });
      }
    }

    // Update validation when line type changes
    this.form.get('orderLineTypeID')?.valueChanges.subscribe(typeId => {
      if (typeId === 1) {
        // Part line item - partID required, name optional
        this.form.get('partID')?.setValidators([Validators.required]);
        this.form.get('name')?.clearValidators();
      } else {
        // Non-part line item - name required, partID optional
        this.form.get('partID')?.clearValidators();
        this.form.get('name')?.setValidators([Validators.required]);
      }
      this.form.get('partID')?.updateValueAndValidity();
      this.form.get('name')?.updateValueAndValidity();
    });
  }

  loadParts() {
    this.inventoryService.getAllParts().subscribe({
      next: (parts) => {
        this.allParts.set(parts.filter(p => p.activeFlag));
      },
      error: (err) => {
        this.errorNotification.showHttpError(err, 'Error loading parts');
      }
    });
  }

  setupAutocomplete() {
    this.filteredParts = this.form.get('partSearch')!.valueChanges.pipe(
      startWith(''),
      map(value => {
        const searchValue = typeof value === 'string' ? value : '';
        return this._filterParts(searchValue);
      })
    );
  }

  private _filterParts(value: string): Part[] {
    const filterValue = value.toLowerCase();
    return this.allParts().filter(part =>
      part.name.toLowerCase().includes(filterValue) ||
      part.description?.toLowerCase().includes(filterValue) ||
      part.sku?.toLowerCase().includes(filterValue) ||
      part.vendor?.toLowerCase().includes(filterValue)
    );
  }

  formatPartDisplay(part: Part | Partial<Part>): string {
    return `${part.sku || ''} - ${part.name || ''}`;
  }

  onPartSelected(part: Part) {
    this.selectedPart.set(part);
    this.form.patchValue({
      partID: part.id,
      partSearch: this.formatPartDisplay(part)
    });
  }

  save() {
    if (!this.form.valid) {
      this.errorNotification.showError('Please fill in all required fields');
      return;
    }

    const formValue = this.form.value;

    // Validation: if Part line item, partID must be set
    if (formValue.orderLineTypeID === 1 && !formValue.partID) {
      this.errorNotification.showError('Please select a part from the catalog');
      return;
    }

    // Validation: if non-Part line item, name must be set
    if (formValue.orderLineTypeID !== 1 && !formValue.name) {
      this.errorNotification.showError('Please enter a description for this line item');
      return;
    }

    const orderItemData = {
      orderID: this.data.orderID,
      orderLineTypeID: formValue.orderLineTypeID!,
      partID: formValue.partID,
      name: formValue.name || null,
      quantity: formValue.quantity!,
      price: formValue.price!
    };

    if (this.data.orderItem) {
      // Update existing item
      this.inventoryService.updateOrderItem(this.data.orderItem.id, orderItemData).subscribe({
        next: () => {
          this.errorNotification.showSuccess('Line item updated successfully');
          this.dialogRef.close(true);
        },
        error: (err) => {
          this.errorNotification.showHttpError(err, 'Failed to update line item');
        }
      });
    } else {
      // Create new item
      this.inventoryService.createOrderItem(orderItemData).subscribe({
        next: () => {
          this.errorNotification.showSuccess('Line item added successfully');
          this.dialogRef.close(true);
        },
        error: (err) => {
          this.errorNotification.showHttpError(err, 'Failed to add line item');
        }
      });
    }
  }

  cancel() {
    this.dialogRef.close(false);
  }
}
