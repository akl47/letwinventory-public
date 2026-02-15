import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { PartEditDialog } from './part-edit-dialog';
import { InventoryService } from '../../../services/inventory.service';
import { HarnessPartsService } from '../../../services/harness-parts.service';
import { ErrorNotificationService } from '../../../services/error-notification.service';
import { Part, PartCategory } from '../../../models';

const mockCategories: PartCategory[] = [
  { id: 1, name: 'Connector', tagColorHex: '#FF0000', activeFlag: true, createdAt: '', updatedAt: '' },
  { id: 2, name: 'Wire', tagColorHex: '#00FF00', activeFlag: true, createdAt: '', updatedAt: '' },
  { id: 3, name: 'Cable', tagColorHex: '#0000FF', activeFlag: true, createdAt: '', updatedAt: '' },
  { id: 4, name: 'Harness', tagColorHex: '#FFFF00', activeFlag: true, createdAt: '', updatedAt: '' },
  { id: 5, name: 'Electrical Component', tagColorHex: '#FF00FF', activeFlag: true, createdAt: '', updatedAt: '' },
];

const mockParts: Part[] = [
  {
    id: 1, name: '000001', description: 'Existing Part', internalPart: false,
    vendor: 'Digi-Key', sku: 'DK-001', link: null, minimumOrderQuantity: 1,
    partCategoryID: 1, activeFlag: true, serialNumberRequired: false,
    lotNumberRequired: false, defaultUnitOfMeasureID: 1, manufacturer: 'TE',
    manufacturerPN: 'TE-001', createdAt: '2026-01-01', updatedAt: '2026-01-01',
  },
];

const mockUoMs = [{ id: 1, name: 'ea', description: 'each' }];
const mockPinTypes = [{ id: 1, name: 'Standard Pin', matingConnector: false }];

describe('PartEditDialog', () => {
  let component: PartEditDialog;
  let fixture: ComponentFixture<PartEditDialog>;
  let inventoryService: InventoryService;
  let harnessPartsService: HarnessPartsService;
  let errorNotification: ErrorNotificationService;
  let dialogRef: { close: ReturnType<typeof vi.fn> };

  function createComponent(data: any = {}) {
    dialogRef = { close: vi.fn() } as any;

    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: data });
    TestBed.overrideProvider(MatDialogRef, { useValue: dialogRef });

    inventoryService = TestBed.inject(InventoryService);
    harnessPartsService = TestBed.inject(HarnessPartsService);
    errorNotification = TestBed.inject(ErrorNotificationService);

    vi.spyOn(inventoryService, 'getAllParts').mockReturnValue(of(mockParts));
    vi.spyOn(inventoryService, 'getUnitsOfMeasure').mockReturnValue(of(mockUoMs as any));
    vi.spyOn(inventoryService, 'getPartCategories').mockReturnValue(of(mockCategories));
    vi.spyOn(harnessPartsService, 'getPinTypes').mockReturnValue(of(mockPinTypes as any));

    fixture = TestBed.createComponent(PartEditDialog);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PartEditDialog],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        { provide: MAT_DIALOG_DATA, useValue: {} },
        { provide: MatDialogRef, useValue: { close: vi.fn() } as any },
      ],
    }).compileComponents();
  });

  describe('create mode', () => {
    beforeEach(() => {
      createComponent({});
    });

    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should not be in edit mode', () => {
      expect(component.isEditMode).toBe(false);
    });

    it('should suggest next part number', () => {
      expect(component.suggestedPartNumber).toBe('000002');
    });

    it('should load categories on init', () => {
      expect(inventoryService.getPartCategories).toHaveBeenCalled();
    });
  });

  describe('edit mode', () => {
    const existingPart: Part = {
      id: 1, name: '000001', description: 'Test', internalPart: false,
      vendor: 'Digi-Key', sku: 'DK-001', link: 'http://example.com',
      minimumOrderQuantity: 5, partCategoryID: 1, activeFlag: true,
      serialNumberRequired: false, lotNumberRequired: false,
      defaultUnitOfMeasureID: 1, manufacturer: 'TE', manufacturerPN: 'TE-001',
      createdAt: '2026-01-01', updatedAt: '2026-01-01',
      PartCategory: { id: 1, name: 'Connector', tagColorHex: '#FF0000', activeFlag: true, createdAt: '', updatedAt: '' },
    };

    beforeEach(() => {
      createComponent({ part: existingPart });
    });

    it('should be in edit mode', () => {
      expect(component.isEditMode).toBe(true);
    });

    it('should populate form with part data', () => {
      expect(component.form.get('name')?.value).toBe('000001');
      expect(component.form.get('vendor')?.value).toBe('Digi-Key');
      expect(component.form.get('minimumOrderQuantity')?.value).toBe(5);
    });
  });

  describe('locked category', () => {
    beforeEach(() => {
      createComponent({ lockedCategory: 'Harness' });
    });

    it('should set lockedCategoryName', () => {
      expect(component.lockedCategoryName).toBe('Harness');
    });

    it('should set internalPart to true for Harness', () => {
      expect(component.form.get('internalPart')?.value).toBe(true);
    });
  });

  describe('getCategoryName', () => {
    beforeEach(() => createComponent({}));

    it('should return category name for valid id', () => {
      expect(component.getCategoryName(1)).toBe('Connector');
    });

    it('should return empty string for null', () => {
      expect(component.getCategoryName(null)).toBe('');
    });

    it('should return empty string for unknown id', () => {
      expect(component.getCategoryName(999)).toBe('');
    });
  });

  describe('category type detection', () => {
    beforeEach(() => createComponent({}));

    it('isConnector returns true for Connector category', () => {
      component.form.patchValue({ partCategoryID: 1 });
      expect(component.isConnector()).toBe(true);
    });

    it('isWire returns true for Wire category', () => {
      component.form.patchValue({ partCategoryID: 2 });
      expect(component.isWire()).toBe(true);
    });

    it('isCable returns true for Cable category', () => {
      component.form.patchValue({ partCategoryID: 3 });
      expect(component.isCable()).toBe(true);
    });

    it('isHarness returns true for Harness category', () => {
      component.form.patchValue({ partCategoryID: 4 });
      expect(component.isHarness()).toBe(true);
    });

    it('isComponent returns true for Electrical Component category', () => {
      component.form.patchValue({ partCategoryID: 5 });
      expect(component.isComponent()).toBe(true);
    });
  });

  describe('getNextAvailablePartNumber', () => {
    beforeEach(() => createComponent({}));

    it('should return padded next id', () => {
      component.allParts = mockParts;
      expect(component.getNextAvailablePartNumber()).toBe('000002');
    });

    it('should return 000001 for empty parts', () => {
      component.allParts = [];
      expect(component.getNextAvailablePartNumber()).toBe('000001');
    });
  });

  describe('isPartNameTaken', () => {
    beforeEach(() => createComponent({}));

    it('should detect duplicate name', () => {
      component.allParts = mockParts;
      component.form.patchValue({ name: '000001' });
      expect(component.isPartNameTaken()).toBe(true);
    });

    it('should be case insensitive', () => {
      component.allParts = [{ ...mockParts[0], name: 'TestPart' }];
      component.form.patchValue({ name: 'testpart' });
      expect(component.isPartNameTaken()).toBe(true);
    });

    it('should return false for unique name', () => {
      component.allParts = mockParts;
      component.form.patchValue({ name: 'UniqueName' });
      expect(component.isPartNameTaken()).toBe(false);
    });

    it('should return false for empty name', () => {
      component.form.patchValue({ name: '' });
      expect(component.isPartNameTaken()).toBe(false);
    });
  });

  describe('getPartNameError', () => {
    beforeEach(() => createComponent({}));

    it('should return required error', () => {
      component.form.patchValue({ name: '' });
      component.form.get('name')?.markAsTouched();
      expect(component.getPartNameError()).toBe('Part name is required');
    });

    it('should return maxlength error', () => {
      component.form.patchValue({ name: 'x'.repeat(33) });
      expect(component.getPartNameError()).toBe('Part name must be 32 characters or less');
    });

    it('should return taken error', () => {
      component.allParts = mockParts;
      component.form.patchValue({ name: '000001' });
      expect(component.getPartNameError()).toBe('This part name is already in use');
    });

    it('should return empty string when valid', () => {
      component.form.patchValue({ name: 'Valid' });
      expect(component.getPartNameError()).toBe('');
    });
  });

  describe('image management', () => {
    beforeEach(() => createComponent({}));

    it('removeConnectorImage should clear all state', () => {
      component.connectorImage.set('data');
      component.connectorImageFile.set(new File([], 'test.png'));
      component.connectorImageFileID.set(1);
      component.removeConnectorImage();
      expect(component.connectorImage()).toBeNull();
      expect(component.connectorImageFile()).toBeNull();
      expect(component.connectorImageFileID()).toBeNull();
    });

    it('removePinoutDiagram should clear all state', () => {
      component.pinoutDiagramImage.set('data');
      component.pinoutDiagramFile.set(new File([], 'test.png'));
      component.pinoutDiagramFileID.set(1);
      component.removePinoutDiagram();
      expect(component.pinoutDiagramImage()).toBeNull();
      expect(component.pinoutDiagramFile()).toBeNull();
      expect(component.pinoutDiagramFileID()).toBeNull();
    });

    it('removeCableDiagram should clear all state', () => {
      component.cableDiagramImage.set('data');
      component.cableDiagramFile.set(new File([], 'test.png'));
      component.cableDiagramFileID.set(1);
      component.removeCableDiagram();
      expect(component.cableDiagramImage()).toBeNull();
      expect(component.cableDiagramFile()).toBeNull();
      expect(component.cableDiagramFileID()).toBeNull();
    });

    it('removeComponentImage should clear all state', () => {
      component.componentImage.set('data');
      component.componentImageFile.set(new File([], 'test.png'));
      component.componentImageFileID.set(1);
      component.removeComponentImage();
      expect(component.componentImage()).toBeNull();
      expect(component.componentImageFile()).toBeNull();
      expect(component.componentImageFileID()).toBeNull();
    });

    it('removeComponentPinout should clear all state', () => {
      component.componentPinoutImage.set('data');
      component.componentPinoutFile.set(new File([], 'test.png'));
      component.componentPinoutFileID.set(1);
      component.removeComponentPinout();
      expect(component.componentPinoutImage()).toBeNull();
      expect(component.componentPinoutFile()).toBeNull();
      expect(component.componentPinoutFileID()).toBeNull();
    });
  });

  describe('component pin groups', () => {
    beforeEach(() => createComponent({}));

    it('addPinGroup should add a group', () => {
      component.addPinGroup();
      expect(component.componentPinGroups().length).toBe(1);
      expect(component.componentPinGroups()[0].pins.length).toBe(1);
    });

    it('removePinGroup should remove at index', () => {
      component.addPinGroup();
      component.addPinGroup();
      component.removePinGroup(0);
      expect(component.componentPinGroups().length).toBe(1);
    });

    it('updatePinGroupName should update name', () => {
      component.addPinGroup();
      component.updatePinGroupName(0, 'Power');
      expect(component.componentPinGroups()[0].name).toBe('Power');
    });

    it('updatePinGroupType should set type metadata', () => {
      component.addPinGroup();
      component.updatePinGroupType(0, 1);
      const group = component.componentPinGroups()[0];
      expect(group.pinTypeID).toBe(1);
      expect(group.pinTypeName).toBe('Standard Pin');
    });

    it('addPinToGroup should add pin', () => {
      component.addPinGroup();
      component.addPinToGroup(0);
      expect(component.componentPinGroups()[0].pins.length).toBe(2);
    });

    it('removePinFromGroup should remove pin but keep at least one', () => {
      component.addPinGroup();
      component.addPinToGroup(0);
      component.removePinFromGroup(0, 1);
      expect(component.componentPinGroups()[0].pins.length).toBe(1);
      // Should not remove the last pin
      component.removePinFromGroup(0, 0);
      expect(component.componentPinGroups()[0].pins.length).toBe(1);
    });

    it('updatePinNumber and updatePinLabel should work', () => {
      component.addPinGroup();
      component.updatePinNumber(0, 0, 'A1');
      component.updatePinLabel(0, 0, 'VCC');
      expect(component.componentPinGroups()[0].pins[0].number).toBe('A1');
      expect(component.componentPinGroups()[0].pins[0].label).toBe('VCC');
    });

    it('getTotalPinCount should sum all pins', () => {
      component.addPinGroup();
      component.addPinToGroup(0);
      component.addPinGroup();
      expect(component.getTotalPinCount()).toBe(3);
    });
  });

  describe('cable wire colors', () => {
    beforeEach(() => createComponent({}));

    it('updateCableWireColors should create colors', () => {
      component.updateCableWireColors(3);
      expect(component.cableWireColors().length).toBe(3);
    });

    it('updateCableWireColors should preserve existing', () => {
      component.updateCableWireColors(2);
      const first = component.cableWireColors()[0].color;
      component.updateCableWireColors(4);
      expect(component.cableWireColors()[0].color).toBe(first);
      expect(component.cableWireColors().length).toBe(4);
    });

    it('getWireColorHex should return hex or fallback', () => {
      expect(component.getWireColorHex('UNKNOWN')).toBe('#808080');
      const knownHex = component.getWireColorHex('BK');
      expect(knownHex).not.toBe('#808080');
    });
  });

  describe('getFormValidationErrors', () => {
    beforeEach(() => createComponent({}));

    it('should return errors for invalid form', () => {
      component.form.patchValue({ name: '', partCategoryID: null });
      component.form.get('name')?.markAsTouched();
      component.form.get('partCategoryID')?.markAsTouched();
      const errors = component.getFormValidationErrors();
      expect(errors).toContain('Part number is required');
      expect(errors).toContain('Category is required');
    });
  });

  describe('selectedCategoryName computed', () => {
    beforeEach(() => createComponent({}));

    it('should return category name', () => {
      component.form.patchValue({ partCategoryID: 2 });
      expect(component.selectedCategoryName()).toBe('Wire');
    });

    it('should return empty when no category', () => {
      component.form.patchValue({ partCategoryID: null });
      expect(component.selectedCategoryName()).toBe('');
    });
  });

  describe('save', () => {
    beforeEach(() => createComponent({}));

    it('should show error when part name is taken', () => {
      vi.spyOn(errorNotification, 'showError');
      component.allParts = mockParts;
      component.form.patchValue({
        name: '000001',
        partCategoryID: 1,
        vendor: 'Test',
        manufacturer: 'M',
        manufacturerPN: 'MP',
      });
      component.save();
      expect(errorNotification.showError).toHaveBeenCalledWith(
        expect.stringContaining('already in use')
      );
    });

    it('should show error when form is invalid', () => {
      vi.spyOn(errorNotification, 'showError');
      component.form.patchValue({ name: '', partCategoryID: null });
      component.save();
      expect(errorNotification.showError).toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should do nothing in create mode', () => {
      createComponent({});
      vi.spyOn(inventoryService, 'deletePart');
      component.delete();
      expect(inventoryService.deletePart).not.toHaveBeenCalled();
    });

    it('should do nothing without part data', () => {
      createComponent({ part: undefined });
      component.isEditMode = true;
      vi.spyOn(inventoryService, 'deletePart');
      component.delete();
      expect(inventoryService.deletePart).not.toHaveBeenCalled();
    });
  });
});
