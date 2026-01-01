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
import { Part } from '../../../models';
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

  categories = signal<{ id: number, name: string }[]>([
    { id: 1, name: 'Part' },
    { id: 2, name: 'Consumable' },
    { id: 3, name: 'Tooling' }
  ]);

  form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(16)]],
    description: ['', Validators.maxLength(62)],
    internalPart: [false, Validators.required],
    vendor: [''],
    sku: [''],
    link: [''],
    minimumOrderQuantity: [1, [Validators.required, Validators.min(1)]],
    partCategoryID: [null as number | null, Validators.required]
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
        partCategoryID: data.part.partCategoryID
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

    // Update vendor validation when internalPart changes
    this.form.get('internalPart')?.valueChanges.subscribe(isInternal => {
      const vendorControl = this.form.get('vendor');
      if (isInternal) {
        // Internal parts don't require vendor
        vendorControl?.clearValidators();
      } else {
        // External parts require vendor
        vendorControl?.setValidators([Validators.required]);
      }
      vendorControl?.updateValueAndValidity();
    });

    // Set initial vendor validation based on current internalPart value
    const isInternal = this.form.get('internalPart')?.value;
    const vendorControl = this.form.get('vendor');
    if (!isInternal) {
      vendorControl?.setValidators([Validators.required]);
      vendorControl?.updateValueAndValidity();
    }
  }

  getNextAvailablePartNumber(): string {
    // Extract all numeric part numbers
    const numericParts = this.allParts
      .map(p => p.name)
      .filter(name => /^\d+$/.test(name))
      .map(name => parseInt(name, 10))
      .filter(num => !isNaN(num));

    // Find the highest number
    const maxNumber = numericParts.length > 0 ? Math.max(...numericParts) : -1;

    // Suggest next number with leading zeros (6 digits)
    const nextNumber = maxNumber + 1;
    return nextNumber.toString().padStart(6, '0');
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
        partCategoryID: formValue.partCategoryID!
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
