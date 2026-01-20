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
import { Part, OrderItem, OrderLineType } from '../../../models';
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
  currentQuantity = signal<number>(1);
  currentPrice = signal<number>(0);
  currentLineTypeID = signal<number>(1);

  orderLineTypes = signal<OrderLineType[]>([]);

  form = this.fb.group({
    orderLineTypeID: [1, Validators.required],
    partSearch: [null as Part | string | null],
    partID: [null as number | null],
    name: [''],
    quantity: [1, [Validators.required, Validators.min(1)]],
    price: [0, [Validators.required, Validators.min(0)]]
  });

  filteredParts!: Observable<Part[]>;

  currentLineTypeName = computed(() => {
    const types = this.orderLineTypes();
    const id = this.currentLineTypeID();
    const found = types.find(t => t.id === id);
    return found?.name || '';
  });

  isPartLineType = computed(() => this.currentLineTypeName() === 'Part');
  isEquipmentLineType = computed(() => this.currentLineTypeName() === 'Equipment');
  showPartAutocomplete = computed(() => this.isPartLineType() || this.isEquipmentLineType());
  showQuantityField = computed(() => this.isPartLineType());

  // Filter parts based on line type
  availableParts = computed(() => {
    const parts = this.allParts();
    if (this.isEquipmentLineType()) {
      return parts.filter(p => p.PartCategory?.name === 'Equipment');
    } else if (this.isPartLineType()) {
      return parts.filter(p => p.PartCategory?.name !== 'Equipment');
    }
    return parts;
  });

  lineTotal = computed(() => {
    const quantity = this.currentQuantity();
    const price = this.currentPrice();
    return quantity * price;
  });

  ngOnInit() {
    this.loadParts();
    this.loadOrderLineTypes();
    this.setupAutocomplete();

    // Sync form values to signals for reactive updates
    this.form.get('quantity')?.valueChanges.subscribe(val => {
      this.currentQuantity.set(val || 0);
    });

    this.form.get('price')?.valueChanges.subscribe(val => {
      this.currentPrice.set(val || 0);
    });

    this.form.get('orderLineTypeID')?.valueChanges.subscribe(val => {
      this.currentLineTypeID.set(val || 1);
    });

    // If editing an existing item, populate the form
    if (this.data.orderItem) {
      const item = this.data.orderItem;
      const price = typeof item.price === 'string' ? parseFloat(item.price) : item.price;

      this.form.patchValue({
        orderLineTypeID: item.orderLineTypeID,
        partID: item.partID,
        name: item.name || '',
        quantity: item.quantity,
        price: price
      });

      // Update signals
      this.currentQuantity.set(item.quantity);
      this.currentPrice.set(price);
      this.currentLineTypeID.set(item.orderLineTypeID);

      // If it's a Part line item, set up the part search field
      if (item.Part) {
        const part = item.Part as Part;
        this.selectedPart.set(part);
        this.form.patchValue({
          partSearch: part
        });
      }
    }
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

  loadOrderLineTypes() {
    this.inventoryService.getOrderLineTypes().subscribe({
      next: (types) => {
        this.orderLineTypes.set(types);
        // Now that types are loaded, set up validation
        this.setupValidation();
      },
      error: (err) => {
        this.errorNotification.showHttpError(err, 'Error loading order line types');
      }
    });
  }

  private setupValidation() {
    // Update validation when line type changes
    const updateValidation = (typeId: number, resetValues = true) => {
      const typeName = this.orderLineTypes().find(t => t.id === typeId)?.name || '';

      if (typeName === 'Part') {
        // Part line item - partID required, name optional, quantity required
        this.form.get('partID')?.setValidators([Validators.required]);
        if (resetValues) {
          this.form.get('partID')?.setValue(null);
          this.form.get('partSearch')?.setValue('');
          this.selectedPart.set(null);
        }
        this.form.get('name')?.clearValidators();
        if (resetValues) {
          this.form.get('name')?.setValue('');
        }
        this.form.get('quantity')?.setValidators([Validators.required, Validators.min(1)]);
      } else if (typeName === 'Equipment') {
        // Equipment line item - partID required, no quantity (always 1)
        this.form.get('partID')?.setValidators([Validators.required]);
        if (resetValues) {
          this.form.get('partID')?.setValue(null);
          this.form.get('partSearch')?.setValue('');
          this.selectedPart.set(null);
        }
        this.form.get('name')?.clearValidators();
        if (resetValues) {
          this.form.get('name')?.setValue('');
        }
        this.form.get('quantity')?.clearValidators();
        this.form.get('quantity')?.setValue(1);
        this.currentQuantity.set(1);
      } else if (typeName === 'Shipping') {
        // Shipping - default name to "Shipping"
        this.form.get('partID')?.clearValidators();
        this.form.get('partID')?.setValue(null);
        this.form.get('partSearch')?.setValue('');
        this.form.get('name')?.setValidators([Validators.required]);
        if (resetValues) {
          this.form.get('name')?.setValue('Shipping');
        }
        this.form.get('quantity')?.clearValidators();
        this.form.get('quantity')?.setValue(1);
        this.currentQuantity.set(1);
      } else if (typeName === 'Taxes') {
        // Taxes - default name to "Tax"
        this.form.get('partID')?.clearValidators();
        this.form.get('partID')?.setValue(null);
        this.form.get('partSearch')?.setValue('');
        this.form.get('name')?.setValidators([Validators.required]);
        if (resetValues) {
          this.form.get('name')?.setValue('Tax');
        }
        this.form.get('quantity')?.clearValidators();
        this.form.get('quantity')?.setValue(1);
        this.currentQuantity.set(1);
      } else {
        // Other line items - name required, quantity set to 1
        this.form.get('partID')?.clearValidators();
        this.form.get('partID')?.setValue(null);
        this.form.get('partSearch')?.setValue('');
        this.form.get('name')?.setValidators([Validators.required]);
        this.form.get('quantity')?.clearValidators();
        this.form.get('quantity')?.setValue(1);
        this.currentQuantity.set(1);
      }
      this.form.get('partID')?.updateValueAndValidity();
      this.form.get('name')?.updateValueAndValidity();
      this.form.get('quantity')?.updateValueAndValidity();
    };

    // Set initial validation state (don't reset values if editing)
    updateValidation(this.form.value.orderLineTypeID || 1, !this.data.orderItem);

    // Subscribe to changes (always reset values when user changes type)
    this.form.get('orderLineTypeID')?.valueChanges.subscribe(typeId => {
      updateValidation(typeId || 1, true);
    });
  }

  setupAutocomplete() {
    this.filteredParts = this.form.get('partSearch')!.valueChanges.pipe(
      startWith(null),
      map(value => {
        if (!value) {
          return this.availableParts();
        }
        if (typeof value === 'object') {
          return this.availableParts();
        }
        const searchValue = typeof value === 'string' ? value : '';
        return this._filterParts(searchValue);
      })
    );
  }

  private _filterParts(value: string): Part[] {
    const filterValue = value.toLowerCase();
    return this.availableParts().filter(part =>
      part.name.toLowerCase().includes(filterValue) ||
      part.description?.toLowerCase().includes(filterValue) ||
      part.sku?.toLowerCase().includes(filterValue) ||
      part.vendor?.toLowerCase().includes(filterValue)
    );
  }

  formatPartDisplay(part: Part | Partial<Part> | string | null): string {
    if (!part || typeof part === 'string') {
      return part as string || '';
    }
    return `${part.sku || ''} - ${part.name || ''}`.trim();
  }

  onPartSelected(part: Part) {
    this.selectedPart.set(part);
    this.form.patchValue({
      partID: part.id
    });
  }

  save() {
    if (!this.form.valid) {
      this.errorNotification.showError('Please fill in all required fields');
      return;
    }

    const formValue = this.form.value;
    const typeName = this.currentLineTypeName();

    // Validation: if Part or Equipment line item, partID must be set
    if ((typeName === 'Part' || typeName === 'Equipment') && !formValue.partID) {
      this.errorNotification.showError('Please select a part from the catalog');
      return;
    }

    // Validation: if non-Part/Equipment line item, name must be set
    if (typeName !== 'Part' && typeName !== 'Equipment' && !formValue.name) {
      this.errorNotification.showError('Please enter a description for this line item');
      return;
    }

    const orderItemData: any = {
      orderID: this.data.orderID,
      orderLineTypeID: formValue.orderLineTypeID!,
      partID: formValue.partID,
      name: formValue.name || null,
      quantity: formValue.quantity!,
      price: formValue.price!
    };

    if (this.data.orderItem) {
      // Update existing item - preserve lineNumber
      orderItemData.lineNumber = this.data.orderItem.lineNumber;

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
      // Create new item - get the next line number
      this.inventoryService.getOrderById(this.data.orderID).subscribe({
        next: (order) => {
          const maxLineNumber = order.OrderItems && order.OrderItems.length > 0
            ? Math.max(...order.OrderItems.map((item: any) => item.lineNumber || 0))
            : 0;
          orderItemData.lineNumber = maxLineNumber + 1;

          this.inventoryService.createOrderItem(orderItemData).subscribe({
            next: () => {
              this.errorNotification.showSuccess('Line item added successfully');
              this.dialogRef.close(true);
            },
            error: (err) => {
              this.errorNotification.showHttpError(err, 'Failed to add line item');
            }
          });
        },
        error: (err) => {
          this.errorNotification.showHttpError(err, 'Failed to get order details');
        }
      });
    }
  }

  cancel() {
    this.dialogRef.close(false);
  }
}
