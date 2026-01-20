import { Component, Inject, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { CommonModule } from '@angular/common';
import { InventoryService } from '../../../services/inventory.service';
import { Equipment } from '../../../models/equipment.model';
import { ErrorNotificationService } from '../../../services/error-notification.service';
import { MatIconModule } from '@angular/material/icon';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';

@Component({
  selector: 'app-equipment-edit-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatDatepickerModule,
    MatNativeDateModule
  ],
  templateUrl: './equipment-edit-dialog.html',
  styleUrl: './equipment-edit-dialog.css',
})
export class EquipmentEditDialog {
  private fb = inject(FormBuilder);
  private inventoryService = inject(InventoryService);
  private errorNotification = inject(ErrorNotificationService);
  isEditMode = false;

  form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    description: ['', Validators.maxLength(255)],
    serialNumber: ['', Validators.maxLength(100)],
    commissionDate: [null as Date | null]
  });

  constructor(
    public dialogRef: MatDialogRef<EquipmentEditDialog>,
    @Inject(MAT_DIALOG_DATA) public data: { equipment?: Equipment }
  ) {
    if (data.equipment) {
      this.isEditMode = true;
      this.form.patchValue({
        name: data.equipment.name,
        description: data.equipment.description || '',
        serialNumber: data.equipment.serialNumber || '',
        commissionDate: data.equipment.commissionDate ? new Date(data.equipment.commissionDate) : null
      });
    }
  }

  getFormValidationErrors(): string[] {
    const errors: string[] = [];

    if (this.form.get('name')?.hasError('required')) {
      errors.push('Equipment name is required');
    }
    if (this.form.get('name')?.hasError('maxlength')) {
      errors.push('Equipment name must be 100 characters or less');
    }

    return errors;
  }

  save() {
    Object.keys(this.form.controls).forEach(key => {
      this.form.get(key)?.markAsTouched();
    });

    if (!this.form.valid) {
      const errors = this.getFormValidationErrors();
      const errorMessage = errors.length > 0
        ? 'Please fix the following errors: ' + errors.join(', ')
        : 'Please fill in all required fields correctly';
      this.errorNotification.showError(errorMessage);
      return;
    }

    const formValue = this.form.value;
    const equipmentData = {
      name: formValue.name!,
      description: formValue.description || null,
      serialNumber: formValue.serialNumber || null,
      commissionDate: formValue.commissionDate ? formValue.commissionDate.toISOString().split('T')[0] : null
    };

    if (this.isEditMode && this.data.equipment?.id) {
      this.inventoryService.updateEquipment(this.data.equipment.id, equipmentData).subscribe({
        next: () => {
          this.errorNotification.showSuccess('Equipment updated successfully');
          this.dialogRef.close(true);
        },
        error: (err) => {
          this.errorNotification.showHttpError(err, 'Failed to update equipment');
        }
      });
    } else {
      this.inventoryService.createEquipment(equipmentData).subscribe({
        next: () => {
          this.errorNotification.showSuccess('Equipment created successfully');
          this.dialogRef.close(true);
        },
        error: (err) => {
          this.errorNotification.showHttpError(err, 'Failed to create equipment');
        }
      });
    }
  }

  delete() {
    if (!this.isEditMode || !this.data.equipment?.id) {
      return;
    }

    const confirmed = confirm(`Are you sure you want to delete equipment "${this.data.equipment.name}"? This will mark it as inactive.`);
    if (!confirmed) {
      return;
    }

    this.inventoryService.deleteEquipment(this.data.equipment.id).subscribe({
      next: () => {
        this.errorNotification.showSuccess('Equipment deleted successfully');
        this.dialogRef.close(true);
      },
      error: (err) => {
        this.errorNotification.showHttpError(err, 'Failed to delete equipment');
      }
    });
  }
}
