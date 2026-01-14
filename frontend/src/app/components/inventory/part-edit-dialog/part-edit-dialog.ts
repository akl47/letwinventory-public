import { Component, Inject, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSelectModule } from '@angular/material/select';
import { CommonModule } from '@angular/common';
import { InventoryService } from '../../../services/inventory.service';
import { Part, PartCategory, UnitOfMeasure } from '../../../models';
import { ErrorNotificationService } from '../../../services/error-notification.service';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-part-edit-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatCheckboxModule,
    MatSelectModule,
    MatIconModule
  ],
  templateUrl: './part-edit-dialog.html',
  styleUrl: './part-edit-dialog.css',
})
export class PartEditDialog implements OnInit {
  private fb = inject(FormBuilder);
  private inventoryService = inject(InventoryService);
  private errorNotification = inject(ErrorNotificationService);
  isEditMode = false;
  allParts: Part[] = [];
  suggestedPartNumber = '';

  categories = signal<PartCategory[]>([]);

  unitsOfMeasure = signal<UnitOfMeasure[]>([]);

  form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(16)]],
    description: ['', Validators.maxLength(62)],
    internalPart: [false, Validators.required],
    vendor: [''],
    sku: [''],
    link: [''],
    minimumOrderQuantity: [1, [Validators.required, Validators.min(1)]],
    partCategoryID: [null as number | null, Validators.required],
    serialNumberRequired: [false],
    lotNumberRequired: [false],
    defaultUnitOfMeasureID: [1 as number | null],
    manufacturer: [''],
    manufacturerPN: [''],
    manufacturerSameAsVendor: [false]
  });

  constructor(
    public dialogRef: MatDialogRef<PartEditDialog>,
    @Inject(MAT_DIALOG_DATA) public data: { part?: Part }
  ) {
    if (data.part) {
      this.isEditMode = true;
      this.form.patchValue({
        name: data.part.name,
        description: data.part.description || '',
        internalPart: data.part.internalPart,
        vendor: data.part.vendor,
        sku: data.part.sku || '',
        link: data.part.link || '',
        minimumOrderQuantity: data.part.minimumOrderQuantity,
        partCategoryID: data.part.partCategoryID,
        serialNumberRequired: data.part.serialNumberRequired || false,
        lotNumberRequired: data.part.lotNumberRequired || false,
        defaultUnitOfMeasureID: data.part.defaultUnitOfMeasureID || 1,
        manufacturer: data.part.manufacturer || '',
        manufacturerPN: data.part.manufacturerPN || ''
      });
    }
  }

  ngOnInit() {
    // Load all parts to check for uniqueness and suggest next number
    this.inventoryService.getAllParts().subscribe({
      next: (parts) => {
        this.allParts = parts;
        if (!this.isEditMode) {
          this.suggestedPartNumber = this.getNextAvailablePartNumber();
          this.form.patchValue({ name: this.suggestedPartNumber });
        }
      },
      error: (err) => {
        console.error('Failed to load parts:', err);
      }
    });

    // Load units of measure
    this.inventoryService.getUnitsOfMeasure().subscribe({
      next: (uom) => {
        this.unitsOfMeasure.set(uom);
      },
      error: (err) => {
        console.error('Failed to load units of measure:', err);
      }
    });

    // Load part categories from API
    this.inventoryService.getPartCategories().subscribe({
      next: (categories) => {
        this.categories.set(categories);
      },
      error: (err) => {
        console.error('Failed to load part categories:', err);
      }
    });

    // Update vendor validation when internalPart changes
    this.form.get('internalPart')?.valueChanges.subscribe(isInternal => {
      const vendorControl = this.form.get('vendor');
      const manufacturerControl = this.form.get('manufacturer');
      const manufacturerPNControl = this.form.get('manufacturerPN');

      if (isInternal) {
        // Internal parts don't require vendor or manufacturer
        vendorControl?.clearValidators();
        manufacturerControl?.clearValidators();
        manufacturerPNControl?.clearValidators();
        // Clear manufacturer fields for internal parts
        this.form.patchValue({
          manufacturer: '',
          manufacturerPN: '',
          manufacturerSameAsVendor: false
        });
      } else {
        // External parts require vendor and manufacturer
        vendorControl?.setValidators([Validators.required]);
        manufacturerControl?.setValidators([Validators.required]);
        manufacturerPNControl?.setValidators([Validators.required]);
      }
      vendorControl?.updateValueAndValidity();
      manufacturerControl?.updateValueAndValidity();
      manufacturerPNControl?.updateValueAndValidity();
    });

    // Set initial vendor and manufacturer validation based on current internalPart value
    const isInternal = this.form.get('internalPart')?.value;
    const vendorControl = this.form.get('vendor');
    const manufacturerControl = this.form.get('manufacturer');
    const manufacturerPNControl = this.form.get('manufacturerPN');
    if (!isInternal) {
      vendorControl?.setValidators([Validators.required]);
      manufacturerControl?.setValidators([Validators.required]);
      manufacturerPNControl?.setValidators([Validators.required]);
      vendorControl?.updateValueAndValidity();
      manufacturerControl?.updateValueAndValidity();
      manufacturerPNControl?.updateValueAndValidity();
    }

    // Handle "manufacturer same as vendor" checkbox
    this.form.get('manufacturerSameAsVendor')?.valueChanges.subscribe(isSame => {
      if (isSame) {
        // Copy vendor info to manufacturer fields
        const vendor = this.form.get('vendor')?.value;
        const sku = this.form.get('sku')?.value;
        this.form.patchValue({
          manufacturer: vendor || '',
          manufacturerPN: sku || ''
        });
        // Disable manufacturer fields when checkbox is checked
        this.form.get('manufacturer')?.disable();
        this.form.get('manufacturerPN')?.disable();
      } else {
        // Enable manufacturer fields when checkbox is unchecked
        this.form.get('manufacturer')?.enable();
        this.form.get('manufacturerPN')?.enable();
      }
    });

    // When vendor or SKU changes, update manufacturer fields if checkbox is checked
    this.form.get('vendor')?.valueChanges.subscribe(vendor => {
      if (this.form.get('manufacturerSameAsVendor')?.value) {
        this.form.patchValue({ manufacturer: vendor || '' });
      }
    });

    this.form.get('sku')?.valueChanges.subscribe(sku => {
      if (this.form.get('manufacturerSameAsVendor')?.value) {
        this.form.patchValue({ manufacturerPN: sku || '' });
      }
    });
  }

  getNextAvailablePartNumber(): string {
    // Find the highest part ID
    const maxPartId = this.allParts.length > 0
      ? Math.max(...this.allParts.map(p => p.id))
      : 0;

    // Next part ID will be maxPartId + 1, formatted as 6-digit number with leading zeros
    const nextPartId = maxPartId + 1;
    return nextPartId.toString().padStart(6, '0');
  }

  isPartNameTaken(): boolean {
    const currentName = this.form.get('name')?.value?.trim();
    if (!currentName) return false;

    // In edit mode, ignore the current part's own name
    if (this.isEditMode && this.data.part) {
      return this.allParts.some(p =>
        p.name.toLowerCase() === currentName.toLowerCase() &&
        p.id !== this.data.part!.id
      );
    }

    // In create mode, check if any part has this name
    return this.allParts.some(p => p.name.toLowerCase() === currentName.toLowerCase());
  }

  getPartNameError(): string {
    const nameControl = this.form.get('name');
    if (nameControl?.hasError('required')) {
      return 'Part name is required';
    }
    if (nameControl?.hasError('maxlength')) {
      return 'Part name must be 16 characters or less';
    }
    if (this.isPartNameTaken()) {
      return 'This part name is already in use';
    }
    return '';
  }

  getFormValidationErrors(): string[] {
    const errors: string[] = [];

    if (this.form.get('name')?.hasError('required')) {
      errors.push('Part number is required');
    }
    if (this.form.get('name')?.hasError('maxlength')) {
      errors.push('Part number must be 16 characters or less');
    }
    if (this.isPartNameTaken()) {
      errors.push('Part name is already in use');
    }
    if (this.form.get('partCategoryID')?.hasError('required')) {
      errors.push('Category is required');
    }
    if (this.form.get('vendor')?.hasError('required')) {
      errors.push('Vendor is required');
    }
    if (this.form.get('manufacturer')?.hasError('required')) {
      errors.push('Manufacturer is required for vendor parts');
    }
    if (this.form.get('manufacturerPN')?.hasError('required')) {
      errors.push('Manufacturer Part Number is required for vendor parts');
    }
    if (this.form.get('minimumOrderQuantity')?.hasError('required')) {
      errors.push('Minimum order quantity is required');
    }
    if (this.form.get('minimumOrderQuantity')?.hasError('min')) {
      errors.push('Minimum order quantity must be at least 1');
    }

    return errors;
  }

  save() {
    // Mark all fields as touched to show validation errors
    Object.keys(this.form.controls).forEach(key => {
      this.form.get(key)?.markAsTouched();
    });

    // Check for duplicate part name
    if (this.isPartNameTaken()) {
      this.errorNotification.showError('This part name is already in use. Please choose a different name.');
      return;
    }

    if (!this.form.valid) {
      const errors = this.getFormValidationErrors();
      const errorMessage = errors.length > 0
        ? 'Please fix the following errors: ' + errors.join(', ')
        : 'Please fill in all required fields correctly';
      this.errorNotification.showError(errorMessage);
      return;
    }

    if (this.form.valid) {
      const formValue = this.form.value;
      const partData = {
        name: formValue.name!,
        description: formValue.description || '',
        internalPart: formValue.internalPart!,
        vendor: formValue.vendor!,
        sku: formValue.sku || '',
        link: formValue.link || '',
        minimumOrderQuantity: formValue.minimumOrderQuantity!,
        partCategoryID: formValue.partCategoryID!,
        serialNumberRequired: formValue.serialNumberRequired || false,
        lotNumberRequired: formValue.lotNumberRequired || false,
        defaultUnitOfMeasureID: formValue.defaultUnitOfMeasureID || 1,
        manufacturer: this.form.get('manufacturer')?.value || '',
        manufacturerPN: this.form.get('manufacturerPN')?.value || ''
      };

      if (this.isEditMode && this.data.part?.id) {
        console.log('Updating part:', this.data.part.id, 'with data:', partData);
        this.inventoryService.updatePart(this.data.part.id, partData).subscribe({
          next: (response) => {
            console.log('Update successful:', response);
            this.errorNotification.showSuccess('Part updated successfully');
            this.dialogRef.close(true);
          },
          error: (err) => {
            console.error('Update failed:', err);
            this.errorNotification.showHttpError(err, 'Failed to update part');
          }
        });
      } else {
        console.log('Creating part with data:', partData);
        this.inventoryService.createPart(partData).subscribe({
          next: (response) => {
            console.log('Create successful:', response);
            this.errorNotification.showSuccess('Part created successfully');
            this.dialogRef.close(true);
          },
          error: (err) => {
            console.error('Create failed - Full error:', err);
            console.error('Error status:', err.status);
            console.error('Error error:', err.error);
            console.error('Error message:', err.message);
            this.errorNotification.showHttpError(err, 'Failed to create part');
          }
        });
      }
    } else {
      console.log('Form is invalid:', this.form.errors);
    }
  }

  delete() {
    if (!this.isEditMode || !this.data.part?.id) {
      return;
    }

    const confirmed = confirm(`Are you sure you want to delete part "${this.data.part.name}"? This will mark it as inactive.`);
    if (!confirmed) {
      return;
    }

    console.log('Deleting part:', this.data.part.id);
    this.inventoryService.deletePart(this.data.part.id).subscribe({
      next: (response) => {
        console.log('Delete successful:', response);
        this.errorNotification.showSuccess('Part deleted successfully');
        this.dialogRef.close(true);
      },
      error: (err) => {
        console.error('Delete failed:', err);
        this.errorNotification.showHttpError(err, 'Failed to delete part');
      }
    });
  }
}
