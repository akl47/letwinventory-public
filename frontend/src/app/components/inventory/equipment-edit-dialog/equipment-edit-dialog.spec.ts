import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { EquipmentEditDialog } from './equipment-edit-dialog';
import { InventoryService } from '../../../services/inventory.service';
import { ErrorNotificationService } from '../../../services/error-notification.service';
import { Equipment } from '../../../models/equipment.model';

const existingEquipment: Equipment = {
  id: 1, name: 'Oscilloscope', description: 'Tektronix 4-ch',
  serialNumber: 'SN-001', commissionDate: '2025-06-01',
  barcodeID: 10, partID: null, activeFlag: true,
  createdAt: '2025-01-01', updatedAt: '2025-06-01',
};

describe('EquipmentEditDialog', () => {
  let component: EquipmentEditDialog;
  let fixture: ComponentFixture<EquipmentEditDialog>;
  let inventoryService: InventoryService;
  let errorNotification: ErrorNotificationService;
  let dialogRef: any;

  function createComponent(data: any = {}) {
    dialogRef = { close: vi.fn() } as any;
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: data });
    TestBed.overrideProvider(MatDialogRef, { useValue: dialogRef });

    inventoryService = TestBed.inject(InventoryService);
    errorNotification = TestBed.inject(ErrorNotificationService);

    fixture = TestBed.createComponent(EquipmentEditDialog);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EquipmentEditDialog],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
        { provide: MAT_DIALOG_DATA, useValue: {} },
        { provide: MatDialogRef, useValue: { close: vi.fn() } as any },
      ],
    }).compileComponents();
  });

  describe('create mode', () => {
    beforeEach(() => createComponent({}));

    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should not be in edit mode', () => {
      expect(component.isEditMode).toBe(false);
    });

    it('should have empty form', () => {
      expect(component.form.get('name')?.value).toBe('');
      expect(component.form.get('description')?.value).toBe('');
      expect(component.form.get('serialNumber')?.value).toBe('');
      expect(component.form.get('commissionDate')?.value).toBeNull();
    });

    it('should require name', () => {
      component.form.patchValue({ name: '' });
      expect(component.form.get('name')?.valid).toBe(false);
    });

    it('should enforce name maxlength', () => {
      component.form.patchValue({ name: 'a'.repeat(101) });
      expect(component.form.get('name')?.hasError('maxlength')).toBe(true);
    });

    it('should call createEquipment on save', () => {
      vi.spyOn(inventoryService, 'createEquipment').mockReturnValue(of({} as any));
      vi.spyOn(errorNotification, 'showSuccess');
      component.form.patchValue({ name: 'New Equipment' });
      component.save();
      expect(inventoryService.createEquipment).toHaveBeenCalled();
      expect(dialogRef.close).toHaveBeenCalledWith(true);
    });

    it('should show error on create failure', () => {
      vi.spyOn(inventoryService, 'createEquipment').mockReturnValue(
        throwError(() => ({ error: { message: 'Failed' } }))
      );
      vi.spyOn(errorNotification, 'showHttpError');
      component.form.patchValue({ name: 'New Equipment' });
      component.save();
      expect(errorNotification.showHttpError).toHaveBeenCalled();
    });
  });

  describe('edit mode', () => {
    beforeEach(() => createComponent({ equipment: existingEquipment }));

    it('should be in edit mode', () => {
      expect(component.isEditMode).toBe(true);
    });

    it('should populate form from equipment data', () => {
      expect(component.form.get('name')?.value).toBe('Oscilloscope');
      expect(component.form.get('description')?.value).toBe('Tektronix 4-ch');
      expect(component.form.get('serialNumber')?.value).toBe('SN-001');
      expect(component.form.get('commissionDate')?.value).toEqual(new Date('2025-06-01'));
    });

    it('should call updateEquipment on save', () => {
      vi.spyOn(inventoryService, 'updateEquipment').mockReturnValue(of({} as any));
      vi.spyOn(errorNotification, 'showSuccess');
      component.save();
      expect(inventoryService.updateEquipment).toHaveBeenCalledWith(1, expect.any(Object));
      expect(dialogRef.close).toHaveBeenCalledWith(true);
    });

    it('should show error on update failure', () => {
      vi.spyOn(inventoryService, 'updateEquipment').mockReturnValue(
        throwError(() => ({ error: { message: 'Failed' } }))
      );
      vi.spyOn(errorNotification, 'showHttpError');
      component.save();
      expect(errorNotification.showHttpError).toHaveBeenCalled();
    });
  });

  describe('getFormValidationErrors', () => {
    beforeEach(() => createComponent({}));

    it('should return name required error', () => {
      component.form.patchValue({ name: '' });
      component.form.get('name')?.markAsTouched();
      const errors = component.getFormValidationErrors();
      expect(errors).toContain('Equipment name is required');
    });

    it('should return maxlength error', () => {
      component.form.patchValue({ name: 'a'.repeat(101) });
      const errors = component.getFormValidationErrors();
      expect(errors).toContain('Equipment name must be 100 characters or less');
    });

    it('should return empty array for valid form', () => {
      component.form.patchValue({ name: 'Valid Name' });
      const errors = component.getFormValidationErrors();
      expect(errors.length).toBe(0);
    });
  });

  describe('save validation', () => {
    beforeEach(() => createComponent({}));

    it('should show error and not save when form is invalid', () => {
      vi.spyOn(errorNotification, 'showError');
      vi.spyOn(inventoryService, 'createEquipment');
      component.form.patchValue({ name: '' });
      component.save();
      expect(errorNotification.showError).toHaveBeenCalled();
      expect(inventoryService.createEquipment).not.toHaveBeenCalled();
    });

    it('should mark all fields as touched on save', () => {
      vi.spyOn(errorNotification, 'showError');
      component.save();
      expect(component.form.get('name')?.touched).toBe(true);
      expect(component.form.get('description')?.touched).toBe(true);
    });

    it('should format commission date correctly', () => {
      vi.spyOn(inventoryService, 'createEquipment').mockReturnValue(of({} as any));
      vi.spyOn(errorNotification, 'showSuccess');
      component.form.patchValue({
        name: 'Test',
        commissionDate: new Date('2025-06-15')
      });
      component.save();
      const callArgs = vi.mocked(inventoryService.createEquipment).mock.lastCall![0];
      expect(callArgs.commissionDate).toBe('2025-06-15');
    });

    it('should send null commissionDate when not set', () => {
      vi.spyOn(inventoryService, 'createEquipment').mockReturnValue(of({} as any));
      vi.spyOn(errorNotification, 'showSuccess');
      component.form.patchValue({ name: 'Test', commissionDate: null });
      component.save();
      const callArgs = vi.mocked(inventoryService.createEquipment).mock.lastCall![0];
      expect(callArgs.commissionDate).toBeNull();
    });
  });

  describe('delete', () => {
    it('should do nothing in create mode', () => {
      createComponent({});
      vi.spyOn(inventoryService, 'deleteEquipment');
      component.delete();
      expect(inventoryService.deleteEquipment).not.toHaveBeenCalled();
    });

    it('should do nothing without equipment data', () => {
      createComponent({});
      component.isEditMode = true;
      vi.spyOn(inventoryService, 'deleteEquipment');
      component.delete();
      expect(inventoryService.deleteEquipment).not.toHaveBeenCalled();
    });

    it('should call deleteEquipment when confirmed', () => {
      createComponent({ equipment: existingEquipment });
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      vi.spyOn(inventoryService, 'deleteEquipment').mockReturnValue(of({}));
      vi.spyOn(errorNotification, 'showSuccess');
      component.delete();
      expect(inventoryService.deleteEquipment).toHaveBeenCalledWith(1);
      expect(dialogRef.close).toHaveBeenCalledWith(true);
    });

    it('should not delete when not confirmed', () => {
      createComponent({ equipment: existingEquipment });
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      vi.spyOn(inventoryService, 'deleteEquipment');
      component.delete();
      expect(inventoryService.deleteEquipment).not.toHaveBeenCalled();
    });

    it('should show error on delete failure', () => {
      createComponent({ equipment: existingEquipment });
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      vi.spyOn(inventoryService, 'deleteEquipment').mockReturnValue(
        throwError(() => ({ error: { message: 'Cannot delete' } }))
      );
      vi.spyOn(errorNotification, 'showHttpError');
      component.delete();
      expect(errorNotification.showHttpError).toHaveBeenCalled();
    });
  });
});
