import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { Location } from '@angular/common';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { BulkUploadComponent } from './bulk-upload';
import { InventoryService } from '../../../services/inventory.service';

describe('BulkUploadComponent', () => {
  let component: BulkUploadComponent;
  let fixture: ComponentFixture<BulkUploadComponent>;
  let inventoryService: InventoryService;
  let location: Location;

  const mockCategories = [
    { id: 1, name: 'Parts', tagColorHex: '#4caf50' },
    { id: 2, name: 'Equipment', tagColorHex: '#2196f3' },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BulkUploadComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
      ],
    }).compileComponents();

    inventoryService = TestBed.inject(InventoryService);
    location = TestBed.inject(Location);
    vi.spyOn(inventoryService, 'getPartCategories').mockReturnValue(of(mockCategories as any));

    fixture = TestBed.createComponent(BulkUploadComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load categories on construction', () => {
    expect(component.categories().length).toBe(2);
  });

  describe('computed signals', () => {
    it('orderTotal should sum quantity * price', () => {
      component.editableItems.set([
        { index: 0, partName: 'A', description: '', quantity: 5, price: 2.0, lineTotal: 10, isNew: true } as any,
        { index: 1, partName: 'B', description: '', quantity: 3, price: 4.0, lineTotal: 12, isNew: false } as any,
      ]);
      expect(component.orderTotal()).toBe(22);
    });

    it('newPartsCount should count new parts', () => {
      component.editableItems.set([
        { index: 0, isNew: true } as any,
        { index: 1, isNew: false } as any,
        { index: 2, isNew: true } as any,
      ]);
      expect(component.newPartsCount()).toBe(2);
    });

    it('existingPartsCount should count existing parts', () => {
      component.editableItems.set([
        { index: 0, isNew: true } as any,
        { index: 1, isNew: false } as any,
        { index: 2, isNew: true } as any,
      ]);
      expect(component.existingPartsCount()).toBe(1);
    });
  });

  describe('preview', () => {
    it('should set error when no CSV content', () => {
      component.preview();
      expect(component.error()).toBe('Please select a CSV file first');
    });

    it('should call bulkImportOrder and set editable items', () => {
      const mockResult = {
        order: { vendor: 'TestVendor', description: 'Test' },
        orderItems: [
          { partName: 'Resistor', description: '100 ohm', quantity: 10, price: 0.5, lineTotal: 5, isNew: true },
        ],
      };
      vi.spyOn(inventoryService, 'bulkImportOrder').mockReturnValue(of(mockResult as any));

      component.csvContent.set('some,csv,content');
      component.preview();

      expect(inventoryService.bulkImportOrder).toHaveBeenCalled();
      expect(component.editableItems().length).toBe(1);
      expect(component.editableItems()[0].index).toBe(0);
      expect(component.vendor()).toBe('TestVendor');
    });
  });

  describe('executeImport', () => {
    it('should set error when no items', () => {
      component.executeImport();
      expect(component.error()).toBe('No items to import');
    });
  });

  describe('reset', () => {
    it('should clear all state', () => {
      component.vendor.set('Test');
      component.csvContent.set('data');
      component.editableItems.set([{ index: 0, partName: 'A' } as any]);
      component.error.set('some error');
      component.editingIndex.set(0);

      component.reset();

      expect(component.selectedFile()).toBeNull();
      expect(component.csvContent()).toBe('');
      expect(component.previewResult()).toBeNull();
      expect(component.editableItems().length).toBe(0);
      expect(component.error()).toBeNull();
      expect(component.vendor()).toBe('');
      expect(component.orderDescription()).toBe('');
      expect(component.placedDate()).toBeNull();
      expect(component.trackingNumber()).toBe('');
      expect(component.orderLink()).toBe('');
      expect(component.notes()).toBe('');
      expect(component.editingIndex()).toBeNull();
    });
  });

  describe('goBack', () => {
    it('should call location.back', () => {
      vi.spyOn(location, 'back');
      component.goBack();
      expect(location.back).toHaveBeenCalled();
    });
  });

  describe('inline editing', () => {
    beforeEach(() => {
      component.editableItems.set([
        { index: 0, partName: 'PartA', description: 'Desc A', quantity: 5, price: 1.5, lineTotal: 7.5, isNew: true, partCategoryID: 1 } as any,
        { index: 1, partName: 'PartB', description: 'Desc B', quantity: 3, price: 2.0, lineTotal: 6, isNew: false, partCategoryID: 2 } as any,
      ]);
    });

    it('startEdit should set editing signals from item', () => {
      component.startEdit(0);
      expect(component.editingIndex()).toBe(0);
      expect(component.editingPartName()).toBe('PartA');
      expect(component.editingDescription()).toBe('Desc A');
      expect(component.editingQuantity()).toBe(5);
      expect(component.editingPrice()).toBe(1.5);
      expect(component.editingPartCategoryID()).toBe(1);
    });

    it('startEdit should save pending edits before switching rows', () => {
      component.startEdit(0);
      component.editingPartName.set('Modified');
      component.startEdit(1);
      // First row should have been saved
      expect(component.editableItems()[0].partName).toBe('Modified');
      expect(component.editingIndex()).toBe(1);
    });

    it('saveEdit should update item and clear editing state', () => {
      component.startEdit(0);
      component.editingPartName.set('NewName');
      component.editingQuantity.set(10);
      component.editingPrice.set(3.0);
      component.saveEdit();

      expect(component.editableItems()[0].partName).toBe('NewName');
      expect(component.editableItems()[0].quantity).toBe(10);
      expect(component.editableItems()[0].price).toBe(3.0);
      expect(component.editableItems()[0].lineTotal).toBe(30);
      expect(component.editingIndex()).toBeNull();
    });

    it('saveEdit should do nothing when not editing', () => {
      component.editingIndex.set(null);
      component.saveEdit();
      expect(component.editableItems()[0].partName).toBe('PartA');
    });
  });

  describe('onQuantityChange / onPriceChange', () => {
    it('should parse quantity value', () => {
      component.onQuantityChange('10');
      expect(component.editingQuantity()).toBe(10);
    });

    it('should default to 0 for invalid quantity', () => {
      component.onQuantityChange('abc');
      expect(component.editingQuantity()).toBe(0);
    });

    it('should parse price value', () => {
      component.onPriceChange('5.99');
      expect(component.editingPrice()).toBe(5.99);
    });
  });

  describe('removeItem', () => {
    beforeEach(() => {
      component.editableItems.set([
        { index: 0, partName: 'A' } as any,
        { index: 1, partName: 'B' } as any,
      ]);
    });

    it('should remove item at index', () => {
      component.removeItem(0);
      expect(component.editableItems().length).toBe(1);
      expect(component.editableItems()[0].partName).toBe('B');
    });

    it('should clear editing index if removing edited item', () => {
      component.editingIndex.set(0);
      component.removeItem(0);
      expect(component.editingIndex()).toBeNull();
    });
  });

  describe('getStatusLabel', () => {
    it('should return "New Part" for new items', () => {
      expect(component.getStatusLabel({ isNew: true } as any)).toBe('New Part');
    });

    it('should return "Existing" for existing items', () => {
      expect(component.getStatusLabel({ isNew: false } as any)).toBe('Existing');
    });
  });

  describe('formatPrice / formatTotal', () => {
    it('should format price with 5 decimals', () => {
      expect(component.formatPrice(1.5)).toBe('$1.50000');
    });

    it('should format total with 2 decimals', () => {
      expect(component.formatTotal(12.5)).toBe('$12.50');
    });
  });

  describe('isEditing', () => {
    it('should return true for current editing index', () => {
      component.editingIndex.set(2);
      expect(component.isEditing(2)).toBe(true);
      expect(component.isEditing(0)).toBe(false);
    });
  });

  describe('category helpers', () => {
    it('getCategory should find by id', () => {
      const cat = component.getCategory(1);
      expect(cat?.name).toBe('Parts');
    });

    it('getCategory should return undefined for unknown id', () => {
      expect(component.getCategory(99)).toBeUndefined();
    });

    it('getCategory should return undefined for undefined', () => {
      expect(component.getCategory(undefined)).toBeUndefined();
    });

    it('getCategoryName should return name or dash', () => {
      expect(component.getCategoryName(1)).toBe('Parts');
      expect(component.getCategoryName(undefined)).toBe('-');
    });

    it('getCategoryBgColor should return rgba for valid hex', () => {
      expect(component.getCategoryBgColor('#ff0000')).toBe('rgba(255, 0, 0, 0.2)');
    });

    it('getCategoryBgColor should return default for null', () => {
      expect(component.getCategoryBgColor(null)).toBe('rgba(255, 255, 255, 0.2)');
    });

    it('getCategoryTextColor should return hex or fallback', () => {
      expect(component.getCategoryTextColor('#00ff00')).toBe('#00ff00');
      expect(component.getCategoryTextColor(null)).toBe('#808080');
    });
  });
});
