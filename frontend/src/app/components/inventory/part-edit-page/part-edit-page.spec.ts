import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, Router } from '@angular/router';
import { Location } from '@angular/common';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { PartEditPage } from './part-edit-page';
import { InventoryService } from '../../../services/inventory.service';
import { HarnessPartsService } from '../../../services/harness-parts.service';
import { HarnessService } from '../../../services/harness.service';
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
  {
    id: 2, name: '000002', description: 'Another Part', internalPart: true,
    vendor: '', sku: null, link: null, minimumOrderQuantity: 1,
    partCategoryID: 2, activeFlag: true, serialNumberRequired: false,
    lotNumberRequired: false, defaultUnitOfMeasureID: 1, manufacturer: null,
    manufacturerPN: null, createdAt: '2026-01-02', updatedAt: '2026-01-02',
  },
];

const mockUoMs = [
  { id: 1, name: 'ea', description: 'each' },
  { id: 2, name: 'ft', description: 'feet' },
];

const mockPinTypes = [
  { id: 1, name: 'Standard Pin', matingConnector: false },
  { id: 2, name: 'Blade', matingConnector: true },
];

describe('PartEditPage', () => {
  let component: PartEditPage;
  let fixture: ComponentFixture<PartEditPage>;
  let inventoryService: InventoryService;
  let harnessPartsService: HarnessPartsService;
  let errorNotification: ErrorNotificationService;
  let location: Location;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PartEditPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
      ],
    }).compileComponents();

    inventoryService = TestBed.inject(InventoryService);
    harnessPartsService = TestBed.inject(HarnessPartsService);
    errorNotification = TestBed.inject(ErrorNotificationService);
    location = TestBed.inject(Location);

    vi.spyOn(inventoryService, 'getPartCategories').mockReturnValue(of(mockCategories));
    vi.spyOn(inventoryService, 'getUnitsOfMeasure').mockReturnValue(of(mockUoMs));
    vi.spyOn(inventoryService, 'getAllParts').mockReturnValue(of(mockParts));
    vi.spyOn(harnessPartsService, 'getPinTypes').mockReturnValue(of(mockPinTypes as any));

    fixture = TestBed.createComponent(PartEditPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('initialization', () => {
    it('should load categories', () => {
      expect(inventoryService.getPartCategories).toHaveBeenCalled();
      expect(component.categories().length).toBe(5);
    });

    it('should load units of measure', () => {
      expect(inventoryService.getUnitsOfMeasure).toHaveBeenCalled();
      expect(component.unitsOfMeasure().length).toBe(2);
    });

    it('should load pin types', () => {
      expect(harnessPartsService.getPinTypes).toHaveBeenCalled();
      expect(component.pinTypes().length).toBe(2);
    });

    it('should load all parts', () => {
      expect(inventoryService.getAllParts).toHaveBeenCalled();
      expect(component.allParts.length).toBe(2);
    });

    it('should be in create mode by default', () => {
      expect(component.isEditMode).toBe(false);
      expect(component.isFormEditMode()).toBe(true);
    });

    it('should suggest next part number in create mode', () => {
      // Max existing part ID is 2, so next is 000003
      expect(component.suggestedPartNumber).toBe('000003');
    });
  });

  describe('form', () => {
    it('should have required name field', () => {
      component.form.patchValue({ name: '' });
      expect(component.form.get('name')?.valid).toBe(false);
      component.form.patchValue({ name: 'TestPart' });
      expect(component.form.get('name')?.valid).toBe(true);
    });

    it('should enforce name maxlength of 32', () => {
      component.form.patchValue({ name: 'a'.repeat(33) });
      expect(component.form.get('name')?.hasError('maxlength')).toBe(true);
    });

    it('should have required partCategoryID', () => {
      component.form.patchValue({ partCategoryID: null });
      expect(component.form.get('partCategoryID')?.valid).toBe(false);
    });

    it('should enforce minimumOrderQuantity min of 1', () => {
      component.form.patchValue({ minimumOrderQuantity: 0 });
      expect(component.form.get('minimumOrderQuantity')?.hasError('min')).toBe(true);
    });
  });

  describe('getCategoryName', () => {
    it('should return category name for valid id', () => {
      expect(component.getCategoryName(1)).toBe('Connector');
      expect(component.getCategoryName(3)).toBe('Cable');
    });

    it('should return empty string for null/undefined', () => {
      expect(component.getCategoryName(null)).toBe('');
      expect(component.getCategoryName(undefined)).toBe('');
    });

    it('should return empty string for unknown id', () => {
      expect(component.getCategoryName(999)).toBe('');
    });
  });

  describe('category type detection', () => {
    it('isConnector should be true when Connector category selected', () => {
      component.form.patchValue({ partCategoryID: 1 });
      expect(component.isConnector()).toBe(true);
      expect(component.isWire()).toBe(false);
    });

    it('isWire should be true when Wire category selected', () => {
      component.form.patchValue({ partCategoryID: 2 });
      expect(component.isWire()).toBe(true);
    });

    it('isCable should be true when Cable category selected', () => {
      component.form.patchValue({ partCategoryID: 3 });
      expect(component.isCable()).toBe(true);
    });

    it('isHarness should be true when Harness category selected', () => {
      component.form.patchValue({ partCategoryID: 4 });
      expect(component.isHarness()).toBe(true);
    });

    it('isComponent should be true when Electrical Component category selected', () => {
      component.form.patchValue({ partCategoryID: 5 });
      expect(component.isComponent()).toBe(true);
    });
  });

  describe('getNextAvailablePartNumber', () => {
    it('should return next id padded to 6 digits', () => {
      component.allParts = mockParts;
      expect(component.getNextAvailablePartNumber()).toBe('000003');
    });

    it('should return 000001 when no parts exist', () => {
      component.allParts = [];
      expect(component.getNextAvailablePartNumber()).toBe('000001');
    });
  });

  describe('isPartNameTaken', () => {
    it('should return true when name is already used', () => {
      component.allParts = mockParts;
      component.form.patchValue({ name: '000001' });
      expect(component.isPartNameTaken()).toBe(true);
    });

    it('should be case insensitive', () => {
      component.allParts = [{ ...mockParts[0], name: 'TestPart' }];
      component.form.patchValue({ name: 'testpart' });
      expect(component.isPartNameTaken()).toBe(true);
    });

    it('should return false when name is unique', () => {
      component.allParts = mockParts;
      component.form.patchValue({ name: 'UniquePartName' });
      expect(component.isPartNameTaken()).toBe(false);
    });

    it('should return false for empty name', () => {
      component.form.patchValue({ name: '' });
      expect(component.isPartNameTaken()).toBe(false);
    });

    it('should ignore own name in edit mode', () => {
      component.isEditMode = true;
      component.currentPart = mockParts[0] as any;
      component.allParts = mockParts;
      component.form.patchValue({ name: '000001' });
      expect(component.isPartNameTaken()).toBe(false);
    });
  });

  describe('getPartNameError', () => {
    it('should return required error when name empty', () => {
      component.form.patchValue({ name: '' });
      component.form.get('name')?.markAsTouched();
      expect(component.getPartNameError()).toBe('Part name is required');
    });

    it('should return maxlength error', () => {
      component.form.patchValue({ name: 'a'.repeat(33) });
      expect(component.getPartNameError()).toBe('Part name must be 32 characters or less');
    });

    it('should return taken error when name exists', () => {
      component.allParts = mockParts;
      component.form.patchValue({ name: '000001' });
      expect(component.getPartNameError()).toBe('This part name is already in use');
    });

    it('should return empty string when no errors', () => {
      component.form.patchValue({ name: 'ValidName' });
      expect(component.getPartNameError()).toBe('');
    });
  });

  describe('image management', () => {
    it('removePartImage should clear all part image state', () => {
      component.partImage.set('base64data');
      component.partImageFile.set(new File([], 'test.png'));
      component.partImageFileID.set(5);
      component.removePartImage();
      expect(component.partImage()).toBeNull();
      expect(component.partImageFile()).toBeNull();
      expect(component.partImageFileID()).toBeNull();
    });

    it('removePinoutDiagram should clear all pinout state', () => {
      component.pinoutDiagramImage.set('base64data');
      component.pinoutDiagramFile.set(new File([], 'test.png'));
      component.pinoutDiagramFileID.set(5);
      component.removePinoutDiagram();
      expect(component.pinoutDiagramImage()).toBeNull();
      expect(component.pinoutDiagramFile()).toBeNull();
      expect(component.pinoutDiagramFileID()).toBeNull();
    });

    it('removeCableDiagram should clear all cable diagram state', () => {
      component.cableDiagramImage.set('base64data');
      component.cableDiagramFile.set(new File([], 'test.png'));
      component.cableDiagramFileID.set(5);
      component.removeCableDiagram();
      expect(component.cableDiagramImage()).toBeNull();
      expect(component.cableDiagramFile()).toBeNull();
      expect(component.cableDiagramFileID()).toBeNull();
    });

    it('removeComponentPinout should clear all component pinout state', () => {
      component.componentPinoutImage.set('base64data');
      component.componentPinoutFile.set(new File([], 'test.png'));
      component.componentPinoutFileID.set(5);
      component.removeComponentPinout();
      expect(component.componentPinoutImage()).toBeNull();
      expect(component.componentPinoutFile()).toBeNull();
      expect(component.componentPinoutFileID()).toBeNull();
    });
  });

  describe('component pin group management', () => {
    it('addPinGroup should add a new group with one pin', () => {
      expect(component.componentPinGroups().length).toBe(0);
      component.addPinGroup();
      expect(component.componentPinGroups().length).toBe(1);
      expect(component.componentPinGroups()[0].pins.length).toBe(1);
      expect(component.componentPinGroups()[0].name).toBe('Group 1');
    });

    it('removePinGroup should remove group at index', () => {
      component.addPinGroup();
      component.addPinGroup();
      expect(component.componentPinGroups().length).toBe(2);
      component.removePinGroup(0);
      expect(component.componentPinGroups().length).toBe(1);
    });

    it('updatePinGroupName should set group name', () => {
      component.addPinGroup();
      component.updatePinGroupName(0, 'Power');
      expect(component.componentPinGroups()[0].name).toBe('Power');
    });

    it('updatePinGroupName should do nothing for invalid index', () => {
      component.addPinGroup();
      component.updatePinGroupName(5, 'Invalid');
      expect(component.componentPinGroups()[0].name).toBe('Group 1');
    });

    it('updatePinGroupType should set pin type and metadata', () => {
      component.addPinGroup();
      component.updatePinGroupType(0, 2);
      const group = component.componentPinGroups()[0];
      expect(group.pinTypeID).toBe(2);
      expect(group.pinTypeName).toBe('Blade');
      expect(group.matingConnector).toBe(true);
    });

    it('addPinToGroup should add a pin', () => {
      component.addPinGroup();
      component.addPinToGroup(0);
      expect(component.componentPinGroups()[0].pins.length).toBe(2);
      expect(component.componentPinGroups()[0].pins[1].number).toBe('2');
    });

    it('removePinFromGroup should remove a pin but not the last one', () => {
      component.addPinGroup();
      component.addPinToGroup(0);
      expect(component.componentPinGroups()[0].pins.length).toBe(2);
      component.removePinFromGroup(0, 1);
      expect(component.componentPinGroups()[0].pins.length).toBe(1);
    });

    it('removePinFromGroup should not remove the last pin', () => {
      component.addPinGroup();
      expect(component.componentPinGroups()[0].pins.length).toBe(1);
      component.removePinFromGroup(0, 0);
      expect(component.componentPinGroups()[0].pins.length).toBe(1);
    });

    it('updatePinNumber should update pin number', () => {
      component.addPinGroup();
      component.updatePinNumber(0, 0, 'A1');
      expect(component.componentPinGroups()[0].pins[0].number).toBe('A1');
    });

    it('updatePinLabel should update pin label', () => {
      component.addPinGroup();
      component.updatePinLabel(0, 0, 'VCC');
      expect(component.componentPinGroups()[0].pins[0].label).toBe('VCC');
    });

    it('getTotalPinCount should sum all pins across groups', () => {
      component.addPinGroup();
      component.addPinToGroup(0);
      component.addPinGroup();
      expect(component.getTotalPinCount()).toBe(3); // 2 + 1
    });
  });

  describe('cable wire colors', () => {
    it('updateCableWireColors should initialize colors for given count', () => {
      component.updateCableWireColors(3);
      expect(component.cableWireColors().length).toBe(3);
    });

    it('updateCableWireColors should preserve existing colors when expanding', () => {
      component.updateCableWireColors(2);
      const firstColor = component.cableWireColors()[0].color;
      component.updateCableWireColors(3);
      expect(component.cableWireColors()[0].color).toBe(firstColor);
      expect(component.cableWireColors().length).toBe(3);
    });

    it('updateCableWireColors should truncate when reducing', () => {
      component.updateCableWireColors(5);
      component.updateCableWireColors(2);
      expect(component.cableWireColors().length).toBe(2);
    });
  });

  describe('getWireColorHex', () => {
    it('should return hex for known color code', () => {
      const hex = component.getWireColorHex('BK');
      expect(hex).toBeTruthy();
      expect(hex).not.toBe('#808080');
    });

    it('should return fallback for unknown color code', () => {
      expect(component.getWireColorHex('UNKNOWN')).toBe('#808080');
    });
  });

  describe('getUomName', () => {
    it('should return uom name for valid id', () => {
      expect(component.getUomName(1)).toBe('ea');
    });

    it('should return dash for null', () => {
      expect(component.getUomName(null)).toBe('-');
    });

    it('should return dash for unknown id', () => {
      expect(component.getUomName(999)).toBe('-');
    });
  });

  describe('getPinTypeName', () => {
    it('should return pin type name for valid id', () => {
      expect(component.getPinTypeName(1)).toBe('Standard Pin');
    });

    it('should return dash for null', () => {
      expect(component.getPinTypeName(null)).toBe('-');
    });
  });

  describe('getFormValidationErrors', () => {
    it('should return name required error', () => {
      component.form.patchValue({ name: '' });
      component.form.get('name')?.markAsTouched();
      component.form.get('name')?.updateValueAndValidity();
      const errors = component.getFormValidationErrors();
      expect(errors).toContain('Part number is required');
    });

    it('should return category required error', () => {
      component.form.patchValue({ partCategoryID: null });
      component.form.get('partCategoryID')?.markAsTouched();
      component.form.get('partCategoryID')?.updateValueAndValidity();
      const errors = component.getFormValidationErrors();
      expect(errors).toContain('Category is required');
    });
  });

  describe('edit mode controls', () => {
    it('enableEdit should set isFormEditMode to true', () => {
      component.isFormEditMode.set(false);
      component.enableEdit();
      expect(component.isFormEditMode()).toBe(true);
    });

    it('cancelEdit should restore form values and exit edit mode', () => {
      component.currentPart = {
        ...mockParts[0],
        PartCategory: mockCategories[0],
      } as any;
      component.isFormEditMode.set(true);
      component.form.patchValue({ name: 'Changed' });
      component.cancelEdit();
      expect(component.isFormEditMode()).toBe(false);
      expect(component.form.get('name')?.value).toBe('000001');
    });

    it('cancel should call location.back', () => {
      vi.spyOn(location, 'back');
      component.cancel();
      expect(location.back).toHaveBeenCalled();
    });
  });

  describe('selectedCategoryName computed', () => {
    it('should return category name when set', () => {
      component.form.patchValue({ partCategoryID: 1 });
      expect(component.selectedCategoryName()).toBe('Connector');
    });

    it('should return empty string when no category', () => {
      component.form.patchValue({ partCategoryID: null });
      expect(component.selectedCategoryName()).toBe('');
    });
  });

  describe('delete', () => {
    it('should do nothing when not in edit mode', () => {
      component.isEditMode = false;
      vi.spyOn(inventoryService, 'deletePart');
      component.delete();
      expect(inventoryService.deletePart).not.toHaveBeenCalled();
    });

    it('should do nothing when no current part', () => {
      component.isEditMode = true;
      component.currentPart = null;
      vi.spyOn(inventoryService, 'deletePart');
      component.delete();
      expect(inventoryService.deletePart).not.toHaveBeenCalled();
    });
  });
});
