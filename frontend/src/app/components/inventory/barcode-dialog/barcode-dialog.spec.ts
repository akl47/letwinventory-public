import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';

import { BarcodeDialog } from './barcode-dialog';
import { InventoryService } from '../../../services/inventory.service';

describe('BarcodeDialog', () => {
  let component: BarcodeDialog;
  let fixture: ComponentFixture<BarcodeDialog>;
  let inventoryServiceSpy: jasmine.SpyObj<InventoryService>;
  let dialogRefSpy: jasmine.SpyObj<MatDialogRef<BarcodeDialog>>;

  const mockDialogData = {
    item: {
      id: 1,
      item_id: 1,
      type: 'Location' as const,
      name: 'Test Location',
      barcode: 'LOC-001',
      description: 'Test Description'
    },
    mode: 'edit' as const
  };

  beforeEach(async () => {
    inventoryServiceSpy = jasmine.createSpyObj('InventoryService', [
      'updateItem',
      'createItem',
      'deleteItem'
    ]);
    dialogRefSpy = jasmine.createSpyObj('MatDialogRef', ['close']);

    await TestBed.configureTestingModule({
      imports: [BarcodeDialog, NoopAnimationsModule],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: InventoryService, useValue: inventoryServiceSpy },
        { provide: MatDialogRef, useValue: dialogRefSpy },
        { provide: MAT_DIALOG_DATA, useValue: mockDialogData }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(BarcodeDialog);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('initialization', () => {
    it('should initialize with item data in edit mode', () => {
      expect(component.name).toBe('Test Location');
      expect(component.description).toBe('Test Description');
    });

    it('should set mode from dialog data', () => {
      expect(component.mode).toBe('edit');
    });
  });

  describe('form validation', () => {
    it('should require name field', () => {
      component.name = '';
      expect(component.isValid()).toBeFalse();
    });

    it('should be valid with name filled', () => {
      component.name = 'Valid Name';
      expect(component.isValid()).toBeTrue();
    });
  });

  describe('save', () => {
    it('should call updateItem in edit mode', () => {
      inventoryServiceSpy.updateItem.and.returnValue(of({ success: true }));

      component.name = 'Updated Name';
      component.description = 'Updated Description';
      component.save();

      expect(inventoryServiceSpy.updateItem).toHaveBeenCalledWith(
        mockDialogData.item,
        { name: 'Updated Name', description: 'Updated Description' }
      );
    });

    it('should close dialog after successful save', () => {
      inventoryServiceSpy.updateItem.and.returnValue(of({ success: true }));

      component.save();

      expect(dialogRefSpy.close).toHaveBeenCalledWith(true);
    });
  });

  describe('cancel', () => {
    it('should close dialog without saving', () => {
      component.cancel();
      expect(dialogRefSpy.close).toHaveBeenCalledWith(false);
    });
  });

  describe('delete', () => {
    it('should call deleteItem and close dialog', () => {
      inventoryServiceSpy.deleteItem.and.returnValue(of({ success: true }));

      component.delete();

      expect(inventoryServiceSpy.deleteItem).toHaveBeenCalledWith(mockDialogData.item);
      expect(dialogRefSpy.close).toHaveBeenCalledWith(true);
    });
  });
});
