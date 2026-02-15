import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { InventoryItemDialog } from './inventory-item-dialog';
import { InventoryService } from '../../../services/inventory.service';
import { ErrorNotificationService } from '../../../services/error-notification.service';
import { InventoryTag, Part } from '../../../models';

const mockParts: Part[] = [
  {
    id: 1, name: '000001', description: 'Resistor 100R', internalPart: false,
    vendor: 'Digi-Key', sku: 'DK-R100', link: null, minimumOrderQuantity: 10,
    partCategoryID: 1, activeFlag: true, serialNumberRequired: false,
    lotNumberRequired: false, defaultUnitOfMeasureID: 1, manufacturer: null,
    manufacturerPN: null, createdAt: '2026-01-01', updatedAt: '2026-01-01',
  },
  {
    id: 2, name: '000002', description: 'Capacitor 10uF', internalPart: false,
    vendor: 'Mouser', sku: 'MO-C10', link: null, minimumOrderQuantity: 5,
    partCategoryID: 1, activeFlag: true, serialNumberRequired: true,
    lotNumberRequired: true, defaultUnitOfMeasureID: 2, manufacturer: null,
    manufacturerPN: null, createdAt: '2026-01-02', updatedAt: '2026-01-02',
  },
];

const mockUoMs = [
  { id: 1, name: 'ea', description: 'each' },
  { id: 2, name: 'ft', description: 'feet' },
];

const mockEditItem: InventoryTag = {
  id: 5, barcode: 'BOX-001', parentBarcodeID: 1, barcodeCategoryID: 2,
  activeFlag: true, name: 'Shelf A', description: 'Top shelf', type: 'Box', item_id: 1,
};

describe('InventoryItemDialog', () => {
  let component: InventoryItemDialog;
  let fixture: ComponentFixture<InventoryItemDialog>;
  let inventoryService: InventoryService;
  let errorNotification: ErrorNotificationService;
  let dialogRef: { close: ReturnType<typeof vi.fn> };

  function createComponent(data: any) {
    dialogRef = { close: vi.fn() } as any;
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: data });
    TestBed.overrideProvider(MatDialogRef, { useValue: dialogRef });

    inventoryService = TestBed.inject(InventoryService);
    errorNotification = TestBed.inject(ErrorNotificationService);

    vi.spyOn(inventoryService, 'getAllParts').mockReturnValue(of(mockParts));
    vi.spyOn(inventoryService, 'getUnitsOfMeasure').mockReturnValue(of(mockUoMs as any));

    fixture = TestBed.createComponent(InventoryItemDialog);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InventoryItemDialog],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        { provide: MAT_DIALOG_DATA, useValue: {} },
        { provide: MatDialogRef, useValue: { close: vi.fn() } as any },
      ],
    }).compileComponents();
  });

  describe('create mode - Box', () => {
    beforeEach(() => createComponent({ parentId: 1 }));

    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should not be in edit mode', () => {
      expect(component.isEditMode).toBe(false);
    });

    it('should default to Box type', () => {
      expect(component.form.get('type')?.value).toBe('Box');
    });

    it('should load parts', () => {
      expect(inventoryService.getAllParts).toHaveBeenCalled();
      expect(component.parts().length).toBe(2);
    });

    it('should load units of measure', () => {
      expect(inventoryService.getUnitsOfMeasure).toHaveBeenCalled();
      expect(component.unitsOfMeasure().length).toBe(2);
    });

    it('should have type control enabled', () => {
      expect(component.form.get('type')?.enabled).toBe(true);
    });
  });

  describe('edit mode', () => {
    beforeEach(() => createComponent({ item: mockEditItem }));

    it('should be in edit mode', () => {
      expect(component.isEditMode).toBe(true);
    });

    it('should populate form from item', () => {
      expect(component.form.get('name')?.value).toBe('Shelf A');
      expect(component.form.get('description')?.value).toBe('Top shelf');
    });

    it('should disable type field in edit mode', () => {
      expect(component.form.get('type')?.disabled).toBe(true);
    });

    it('should not load parts in edit mode', () => {
      expect(inventoryService.getAllParts).not.toHaveBeenCalled();
    });
  });

  describe('filteredParts computed', () => {
    beforeEach(() => createComponent({ parentId: 1 }));

    it('should return all parts when no search text', () => {
      component.partSearchText.set('');
      expect(component.filteredParts().length).toBe(2);
    });

    it('should filter parts by name', () => {
      component.partSearchText.set('000001');
      expect(component.filteredParts().length).toBe(1);
    });

    it('should filter parts by description', () => {
      component.partSearchText.set('capacitor');
      expect(component.filteredParts().length).toBe(1);
    });

    it('should filter parts by vendor', () => {
      component.partSearchText.set('mouser');
      expect(component.filteredParts().length).toBe(1);
    });

    it('should filter parts by sku', () => {
      component.partSearchText.set('DK-R100');
      expect(component.filteredParts().length).toBe(1);
    });
  });

  describe('selectedPartUOM computed', () => {
    beforeEach(() => createComponent({ parentId: 1 }));

    it('should return null when no part selected', () => {
      expect(component.selectedPartUOM()).toBeNull();
    });

    it('should return UOM when part has defaultUnitOfMeasureID', () => {
      component.selectedPart.set(mockParts[1]); // defaultUnitOfMeasureID: 2
      const uom = component.selectedPartUOM();
      expect(uom).toBeTruthy();
      expect(uom?.name).toBe('ft');
    });
  });

  describe('onPartSelected', () => {
    beforeEach(() => createComponent({ parentId: 1 }));

    it('should set selectedPart and update form', () => {
      component.onPartSelected(mockParts[0]);
      expect(component.selectedPart()).toBe(mockParts[0]);
      expect(component.form.get('partID')?.value).toBe(1);
      expect(component.form.get('partSearch')?.value).toBe('000001 - Resistor 100R');
    });
  });

  describe('displayPartFn', () => {
    beforeEach(() => createComponent({ parentId: 1 }));

    it('should return empty for null', () => {
      expect(component.displayPartFn(null)).toBe('');
    });

    it('should return formatted part info', () => {
      const result = component.displayPartFn(1);
      expect(result).toBe('000001 - Resistor 100R');
    });

    it('should return empty for unknown id', () => {
      expect(component.displayPartFn(999)).toBe('');
    });
  });

  describe('updateValidators', () => {
    beforeEach(() => createComponent({ parentId: 1 }));

    it('should require name for Box type', () => {
      component.updateValidators('Box');
      expect(component.form.get('name')?.hasError('required')).toBe(true);
      expect(component.form.get('partID')?.hasError('required')).toBeFalsy();
    });

    it('should require name for Location type', () => {
      component.updateValidators('Location');
      component.form.patchValue({ name: '' });
      component.form.get('name')?.updateValueAndValidity();
      expect(component.form.get('name')?.hasError('required')).toBe(true);
    });

    it('should require partID and quantity for Trace type', () => {
      component.updateValidators('Trace');
      expect(component.form.get('partID')?.hasError('required')).toBe(true);
    });

    it('should not require name for Trace type', () => {
      component.updateValidators('Trace');
      component.form.patchValue({ name: '' });
      component.form.get('name')?.updateValueAndValidity();
      expect(component.form.get('name')?.hasError('required')).toBeFalsy();
    });
  });

  describe('isFormValid', () => {
    beforeEach(() => createComponent({ parentId: 1 }));

    it('should be valid for Box with name', () => {
      component.form.patchValue({ type: 'Box', name: 'Test Box' });
      expect(component.isFormValid()).toBe(true);
    });

    it('should be invalid for Box without name', () => {
      component.form.patchValue({ type: 'Box', name: '' });
      expect(component.isFormValid()).toBe(false);
    });

    it('should be valid for Trace with part and quantity', () => {
      component.form.patchValue({ type: 'Trace', partID: 1, quantity: 5 });
      component.selectedPart.set(mockParts[0]); // no serial/lot required
      expect(component.isFormValid()).toBe(true);
    });

    it('should be invalid for Trace without partID', () => {
      component.form.patchValue({ type: 'Trace', partID: null, quantity: 5 });
      expect(component.isFormValid()).toBe(false);
    });

    it('should be invalid for Trace without quantity', () => {
      component.form.patchValue({ type: 'Trace', partID: 1, quantity: null });
      expect(component.isFormValid()).toBe(false);
    });

    it('should be invalid for Trace with zero quantity', () => {
      component.form.patchValue({ type: 'Trace', partID: 1, quantity: 0 });
      expect(component.isFormValid()).toBe(false);
    });

    it('should be invalid for Trace when serial required but missing', () => {
      component.form.patchValue({ type: 'Trace', partID: 2, quantity: 5, serialNumber: '' });
      component.selectedPart.set(mockParts[1]); // serialNumberRequired: true
      expect(component.isFormValid()).toBe(false);
    });

    it('should be invalid for Trace when lot required but missing', () => {
      component.form.patchValue({ type: 'Trace', partID: 2, quantity: 5, serialNumber: 'SN1', lotNumber: '' });
      component.selectedPart.set(mockParts[1]); // lotNumberRequired: true
      expect(component.isFormValid()).toBe(false);
    });

    it('should be valid for Trace with serial and lot when required', () => {
      component.form.patchValue({ type: 'Trace', partID: 2, quantity: 5, serialNumber: 'SN1', lotNumber: 'LOT1' });
      component.selectedPart.set(mockParts[1]);
      expect(component.isFormValid()).toBe(true);
    });
  });

  describe('isFormValid in edit mode', () => {
    beforeEach(() => createComponent({ item: mockEditItem }));

    it('should be valid with name in edit mode', () => {
      expect(component.isFormValid()).toBe(true);
    });

    it('should be invalid without name in edit mode', () => {
      component.form.patchValue({ name: '' });
      expect(component.isFormValid()).toBe(false);
    });
  });

  describe('save - create Box', () => {
    beforeEach(() => createComponent({ parentId: 1 }));

    it('should call createItem for Box type', () => {
      vi.spyOn(inventoryService, 'createItem').mockReturnValue(of({}));
      vi.spyOn(errorNotification, 'showSuccess');
      component.form.patchValue({ type: 'Box', name: 'New Box' });
      component.save();
      expect(inventoryService.createItem).toHaveBeenCalledWith('Box', {
        name: 'New Box',
        description: null,
        parentBarcodeID: 1
      });
      expect(dialogRef.close).toHaveBeenCalledWith(true);
    });

    it('should show error on create failure', () => {
      vi.spyOn(inventoryService, 'createItem').mockReturnValue(
        throwError(() => ({ error: { message: 'Failed' } }))
      );
      vi.spyOn(errorNotification, 'showHttpError');
      component.form.patchValue({ type: 'Box', name: 'New Box' });
      component.save();
      expect(errorNotification.showHttpError).toHaveBeenCalled();
    });
  });

  describe('save - create Location', () => {
    beforeEach(() => createComponent({ parentId: 1 }));

    it('should call createItem for Location type', () => {
      vi.spyOn(inventoryService, 'createItem').mockReturnValue(of({}));
      vi.spyOn(errorNotification, 'showSuccess');
      component.form.patchValue({ type: 'Location', name: 'New Location' });
      component.save();
      expect(inventoryService.createItem).toHaveBeenCalledWith('Location', expect.any(Object));
    });
  });

  describe('save - create Trace', () => {
    beforeEach(() => createComponent({ parentId: 1 }));

    it('should call createTrace for Trace type', () => {
      vi.spyOn(inventoryService, 'createTrace').mockReturnValue(of({}));
      vi.spyOn(errorNotification, 'showSuccess');
      component.selectedPart.set(mockParts[0]);
      component.form.patchValue({
        type: 'Trace', partID: 1, quantity: 10,
        serialNumber: '', lotNumber: ''
      });
      component.save();
      expect(inventoryService.createTrace).toHaveBeenCalledWith({
        partID: 1,
        quantity: 10,
        parentBarcodeID: 1,
        unitOfMeasureID: 1,
        serialNumber: null,
        lotNumber: null
      });
      expect(dialogRef.close).toHaveBeenCalledWith(true);
    });

    it('should include serial/lot numbers when provided', () => {
      vi.spyOn(inventoryService, 'createTrace').mockReturnValue(of({}));
      vi.spyOn(errorNotification, 'showSuccess');
      component.selectedPart.set(mockParts[1]);
      component.form.patchValue({
        type: 'Trace', partID: 2, quantity: 5,
        serialNumber: 'SN-123', lotNumber: 'LOT-456'
      });
      component.save();
      const callArgs = vi.mocked(inventoryService.createTrace).mock.calls.at(-1)![0];
      expect(callArgs.serialNumber).toBe('SN-123');
      expect(callArgs.lotNumber).toBe('LOT-456');
      expect(callArgs.unitOfMeasureID).toBe(2);
    });
  });

  describe('save - edit', () => {
    beforeEach(() => createComponent({ item: mockEditItem }));

    it('should call updateItem in edit mode', () => {
      vi.spyOn(inventoryService, 'updateItem').mockReturnValue(of({}));
      vi.spyOn(errorNotification, 'showSuccess');
      component.form.patchValue({ name: 'Updated Name' });
      component.save();
      expect(inventoryService.updateItem).toHaveBeenCalledWith(mockEditItem, {
        name: 'Updated Name',
        description: 'Top shelf'
      });
      expect(dialogRef.close).toHaveBeenCalledWith(true);
    });

    it('should show error on update failure', () => {
      vi.spyOn(inventoryService, 'updateItem').mockReturnValue(
        throwError(() => ({ error: { message: 'Failed' } }))
      );
      vi.spyOn(errorNotification, 'showHttpError');
      component.save();
      expect(errorNotification.showHttpError).toHaveBeenCalled();
    });
  });

  describe('save - invalid form', () => {
    beforeEach(() => createComponent({ parentId: 1 }));

    it('should not save when form is invalid', () => {
      vi.spyOn(inventoryService, 'createItem');
      component.form.patchValue({ name: '' });
      component.save();
      expect(inventoryService.createItem).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should do nothing in create mode', () => {
      createComponent({ parentId: 1 });
      vi.spyOn(inventoryService, 'deleteItem');
      component.delete();
      expect(inventoryService.deleteItem).not.toHaveBeenCalled();
    });

    it('should do nothing without item', () => {
      createComponent({ parentId: 1 });
      component.isEditMode = true;
      vi.spyOn(inventoryService, 'deleteItem');
      component.delete();
      expect(inventoryService.deleteItem).not.toHaveBeenCalled();
    });

    it('should call deleteItem when confirmed', () => {
      createComponent({ item: mockEditItem });
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      vi.spyOn(inventoryService, 'deleteItem').mockReturnValue(of({}));
      vi.spyOn(errorNotification, 'showSuccess');
      component.delete();
      expect(inventoryService.deleteItem).toHaveBeenCalledWith(mockEditItem);
      expect(dialogRef.close).toHaveBeenCalledWith(true);
    });

    it('should not delete when not confirmed', () => {
      createComponent({ item: mockEditItem });
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      vi.spyOn(inventoryService, 'deleteItem');
      component.delete();
      expect(inventoryService.deleteItem).not.toHaveBeenCalled();
    });

    it('should show error on delete failure', () => {
      createComponent({ item: mockEditItem });
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      vi.spyOn(inventoryService, 'deleteItem').mockReturnValue(
        throwError(() => ({ error: { message: 'Cannot delete' } }))
      );
      vi.spyOn(errorNotification, 'showHttpError');
      component.delete();
      expect(errorNotification.showHttpError).toHaveBeenCalled();
    });
  });
});
