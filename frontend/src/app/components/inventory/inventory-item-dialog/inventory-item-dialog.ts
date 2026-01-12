import { Component, Inject, inject, OnInit, signal, computed } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatIconModule } from '@angular/material/icon';
import { InventoryService } from '../../../services/inventory.service';
import { InventoryTag, Part, UnitOfMeasure } from '../../../models';
import { CommonModule } from '@angular/common';
import { ErrorNotificationService } from '../../../services/error-notification.service';

@Component({
  selector: 'app-inventory-item-dialog',
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
  templateUrl: './inventory-item-dialog.html',
  styleUrl: './inventory-item-dialog.css',
})
export class InventoryItemDialog implements OnInit {
  private fb = inject(FormBuilder);
  private inventoryService = inject(InventoryService);
  private errorNotification = inject(ErrorNotificationService);
  isEditMode = false;
  parts = signal<Part[]>([]);
  unitsOfMeasure = signal<UnitOfMeasure[]>([]);
  selectedPart = signal<Part | null>(null);
  partSearchText = signal<string>('');
  filteredParts = computed(() => {
    const searchText = this.partSearchText().toLowerCase();
    if (!searchText) {
      return this.parts();
    }
    return this.parts().filter(part =>
      part.name.toLowerCase().includes(searchText) ||
      (part.description && part.description.toLowerCase().includes(searchText)) ||
      part.vendor.toLowerCase().includes(searchText) ||
      (part.sku && part.sku.toLowerCase().includes(searchText))
    );
  });
  selectedPartUOM = computed(() => {
    const part = this.selectedPart();
    if (!part || !part.defaultUnitOfMeasureID) return null;
    return this.unitsOfMeasure().find(u => u.id === part.defaultUnitOfMeasureID) || null;
  });

  form = this.fb.group({
    name: ['', Validators.required],
    description: [''],
    type: ['Box', Validators.required], // Default to Box for creation
    partSearch: [''],
    partID: [null as number | null],
    quantity: [1],
    unitOfMeasureID: [1 as number | null], // Default to 'ea' (id: 1)
    serialNumber: [''],
    lotNumber: ['']
  });

  constructor(
    public dialogRef: MatDialogRef<InventoryItemDialog>,
    @Inject(MAT_DIALOG_DATA) public data: { item?: InventoryTag; parentId?: number }
  ) {
    if (data.item) {
      this.isEditMode = true;
      this.form.patchValue({
        name: data.item.name,
        description: data.item.description || '',
        type: data.item.type as any
      });
      // Disable type changing in edit mode
      this.form.get('type')?.disable();
    }
  }

  ngOnInit() {
    if (!this.isEditMode) {
      // Load parts for trace creation
      this.inventoryService.getAllParts().subscribe({
        next: (parts) => {
          this.parts.set(parts);
        },
        error: (err) => {
          console.error('Error loading parts:', err);
        }
      });

      // Load units of measure
      this.inventoryService.getUnitsOfMeasure().subscribe({
        next: (uom) => {
          this.unitsOfMeasure.set(uom);
        },
        error: (err) => {
          console.error('Error loading units of measure:', err);
        }
      });

      // Set initial validators based on default type (Box)
      this.updateValidators('Box');

      // Update validators when type changes
      this.form.get('type')?.valueChanges.subscribe(type => {
        this.updateValidators(type);
      });

      // Update search filter when user types
      this.form.get('partSearch')?.valueChanges.subscribe(value => {
        this.partSearchText.set(value || '');
      });
    }
  }

  onPartSelected(part: Part) {
    this.selectedPart.set(part);
    this.form.patchValue({
      partID: part.id,
      partSearch: `${part.name} - ${part.description}`
    });
  }

  displayPartFn(partId: number | null): string {
    if (!partId) return '';
    const part = this.parts().find(p => p.id === partId);
    return part ? `${part.name} - ${part.description}` : '';
  }

  updateValidators(type: string | null) {
    const nameControl = this.form.get('name');
    const partIDControl = this.form.get('partID');
    const quantityControl = this.form.get('quantity');

    if (type === 'Trace') {
      nameControl?.clearValidators();
      partIDControl?.setValidators([Validators.required]);
      quantityControl?.setValidators([Validators.required, Validators.min(1)]);
    } else {
      nameControl?.setValidators([Validators.required]);
      partIDControl?.clearValidators();
      quantityControl?.clearValidators();
    }

    nameControl?.updateValueAndValidity();
    partIDControl?.updateValueAndValidity();
    quantityControl?.updateValueAndValidity();
  }

  isFormValid(): boolean {
    const formValue = this.form.getRawValue();

    if (this.isEditMode) {
      // Edit mode: just need name
      return !!formValue.name;
    }

    // Create mode
    const type = formValue.type;

    if (type === 'Trace') {
      // For trace: need partID and quantity
      const basicValid = !!formValue.partID && !!formValue.quantity && formValue.quantity > 0;
      if (!basicValid) return false;

      // Check serial/lot number requirements based on selected part
      const part = this.selectedPart();
      if (part?.serialNumberRequired && !formValue.serialNumber?.trim()) {
        return false;
      }
      if (part?.lotNumberRequired && !formValue.lotNumber?.trim()) {
        return false;
      }
      return true;
    } else {
      // For Location/Box: need name
      return !!formValue.name;
    }
  }

  save() {
    if (this.isFormValid()) {
      const formValue = this.form.getRawValue();
      if (this.isEditMode && this.data.item) {
        const updateData = {
          name: formValue.name!,
          description: formValue.description || null
        };
        console.log('Updating item:', this.data.item, 'with data:', updateData);
        this.inventoryService.updateItem(this.data.item, updateData).subscribe({
          next: (response) => {
            console.log('Update successful:', response);
            this.errorNotification.showSuccess(`${this.data.item!.type} updated successfully`);
            this.dialogRef.close(true);
          },
          error: (err) => {
            console.error('Update failed:', err);
            this.errorNotification.showHttpError(err, `Failed to update ${this.data.item!.type.toLowerCase()}`);
          }
        });
      } else {
        // Create mode
        if (formValue.type === 'Trace') {
          // Create trace - use the part's default UOM
          const part = this.selectedPart();
          const traceData = {
            partID: formValue.partID!,
            quantity: formValue.quantity!,
            parentBarcodeID: this.data.parentId!,
            unitOfMeasureID: part?.defaultUnitOfMeasureID || 1,
            serialNumber: formValue.serialNumber || null,
            lotNumber: formValue.lotNumber || null
          };
          console.log('Creating trace with data:', traceData);
          this.inventoryService.createTrace(traceData).subscribe({
            next: (response) => {
              console.log('Trace created successfully:', response);
              this.errorNotification.showSuccess('Trace created successfully');
              this.dialogRef.close(true);
            },
            error: (err) => {
              console.error('Trace creation failed:', err);
              this.errorNotification.showHttpError(err, 'Failed to create trace');
            }
          });
        } else {
          // Create location or box
          const createData = {
            name: formValue.name!,
            description: formValue.description || null,
            parentBarcodeID: this.data.parentId!
          };
          console.log('Creating item:', formValue.type, 'with data:', createData);
          this.inventoryService.createItem(formValue.type as 'Location' | 'Box', createData).subscribe({
            next: (response) => {
              console.log('Create successful:', response);
              this.errorNotification.showSuccess(`${formValue.type} created successfully`);
              this.dialogRef.close(true);
            },
            error: (err) => {
              console.error('Create failed:', err);
              this.errorNotification.showHttpError(err, `Failed to create ${formValue.type!.toLowerCase()}`);
            }
          });
        }
      }
    } else {
      console.log('Form is invalid:', this.form.errors);
    }
  }

  delete() {
    if (!this.isEditMode || !this.data.item) {
      return;
    }

    const confirmed = confirm(`Are you sure you want to delete "${this.data.item.name}"? This will mark it as inactive.`);
    if (!confirmed) {
      return;
    }

    console.log('Deleting item:', this.data.item);
    this.inventoryService.deleteItem(this.data.item).subscribe({
      next: (response) => {
        console.log('Delete successful:', response);
        this.errorNotification.showSuccess(`${this.data.item!.type} deleted successfully`);
        this.dialogRef.close(true);
      },
      error: (err) => {
        console.error('Delete failed:', err);
        this.errorNotification.showHttpError(err, `Failed to delete ${this.data.item!.type.toLowerCase()}`);
      }
    });
  }
}
