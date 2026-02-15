import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { ReceiveLineItemDialog, ReceiveLineItemDialogData } from './receive-line-item-dialog';
import { InventoryService } from '../../../services/inventory.service';
import { OrderItem } from '../../../models';

describe('ReceiveLineItemDialog', () => {
  let component: ReceiveLineItemDialog;
  let fixture: ComponentFixture<ReceiveLineItemDialog>;
  let inventoryService: InventoryService;
  let dialogRef: any;

  const mockLocations = [
    { id: 1, barcode: 'LOC-001', type: 'Location', name: 'Shelf A', description: null },
    { id: 2, barcode: 'BOX-001', type: 'Box', name: 'Box 1', description: null },
  ];

  const baseDialogData: ReceiveLineItemDialogData = {
    orderItem: {
      id: 10, orderID: 1, partID: 1, orderLineTypeID: 1, lineNumber: 1,
      quantity: 10, receivedQuantity: 3, price: 5.0, name: null,
      activeFlag: true, createdAt: '', updatedAt: '',
      Part: { name: 'Resistor' },
    } as OrderItem,
    remainingQuantity: 7,
    isEquipment: false,
  };

  function createComponent(data: ReceiveLineItemDialogData = baseDialogData) {
    dialogRef = { close: vi.fn() } as any;

    TestBed.configureTestingModule({
      imports: [ReceiveLineItemDialog],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: dialogRef },
      ],
    }).compileComponents();

    inventoryService = TestBed.inject(InventoryService);
    vi.spyOn(inventoryService, 'getLocationBarcodes').mockReturnValue(of(mockLocations as any));

    fixture = TestBed.createComponent(ReceiveLineItemDialog);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('part receiving', () => {
    beforeEach(() => createComponent());

    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should load locations on init', () => {
      expect(inventoryService.getLocationBarcodes).toHaveBeenCalled();
      expect(component.locations().length).toBe(2);
      expect(component.loadingLocations()).toBe(false);
    });

    it('should not be equipment', () => {
      expect(component.isEquipment).toBe(false);
    });

    it('should default to full receipt type', () => {
      expect(component.receiptType()).toBe('full');
    });

    describe('receivedQuantity', () => {
      it('should return remaining quantity for full receipt', () => {
        expect(component.receivedQuantity).toBe(7);
      });

      it('should return partial quantity for partial receipt', () => {
        component.receiptType.set('partial');
        component.partialQuantity.set(3);
        expect(component.receivedQuantity).toBe(3);
      });
    });

    describe('canSubmit', () => {
      it('should be false when no location selected', () => {
        expect(component.canSubmit).toBe(false);
      });

      it('should be true for full receipt with location', () => {
        component.selectedLocationId.set(1);
        expect(component.canSubmit).toBe(true);
      });

      it('should be true for valid partial receipt', () => {
        component.selectedLocationId.set(1);
        component.receiptType.set('partial');
        component.partialQuantity.set(5);
        expect(component.canSubmit).toBe(true);
      });

      it('should be false for partial receipt with zero quantity', () => {
        component.selectedLocationId.set(1);
        component.receiptType.set('partial');
        component.partialQuantity.set(0);
        expect(component.canSubmit).toBe(false);
      });

      it('should be false for partial receipt exceeding remaining', () => {
        component.selectedLocationId.set(1);
        component.receiptType.set('partial');
        component.partialQuantity.set(8); // remaining is 7
        expect(component.canSubmit).toBe(false);
      });
    });

    describe('onCancel', () => {
      it('should close dialog with null', () => {
        component.onCancel();
        expect(dialogRef.close).toHaveBeenCalledWith(null);
      });
    });

    describe('onSubmit', () => {
      it('should not submit when canSubmit is false', () => {
        component.onSubmit();
        expect(dialogRef.close).not.toHaveBeenCalled();
      });

      it('should submit full receipt result', () => {
        component.selectedLocationId.set(1);
        component.printBarcode.set(true);
        component.barcodeSize.set('1.5x1');
        component.onSubmit();

        expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining({
          success: true,
          receivedQuantity: 7,
          printBarcode: true,
          barcodeSize: '1.5x1',
          parentBarcodeID: 1,
          equipmentName: null,
          serialNumber: null,
        }));
      });

      it('should submit partial receipt result', () => {
        component.selectedLocationId.set(2);
        component.receiptType.set('partial');
        component.partialQuantity.set(3);
        component.onSubmit();

        expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining({
          receivedQuantity: 3,
          parentBarcodeID: 2,
        }));
      });
    });

    describe('barcodeSizes', () => {
      it('should have two size options', () => {
        expect(component.barcodeSizes.length).toBe(2);
        expect(component.barcodeSizes[0].value).toBe('3x1');
        expect(component.barcodeSizes[1].value).toBe('1.5x1');
      });

      it('should default to 3x1', () => {
        expect(component.barcodeSize()).toBe('3x1');
      });
    });
  });

  describe('equipment receiving', () => {
    const equipmentData: ReceiveLineItemDialogData = {
      orderItem: {
        id: 20, orderID: 1, partID: 5, orderLineTypeID: 2, lineNumber: 1,
        quantity: 1, receivedQuantity: 0, price: 500, name: null,
        activeFlag: true, createdAt: '', updatedAt: '',
        Part: { name: 'Oscilloscope' },
      } as OrderItem,
      remainingQuantity: 1,
      isEquipment: true,
    };

    beforeEach(() => createComponent(equipmentData));

    it('should be in equipment mode', () => {
      expect(component.isEquipment).toBe(true);
    });

    it('should pre-fill equipment name from part', () => {
      expect(component.equipmentName()).toBe('Oscilloscope');
    });

    it('should always receive quantity of 1 for equipment', () => {
      expect(component.receivedQuantity).toBe(1);
    });

    describe('canSubmit for equipment', () => {
      it('should require non-empty equipment name', () => {
        component.selectedLocationId.set(1);
        expect(component.canSubmit).toBe(true);

        component.equipmentName.set('');
        expect(component.canSubmit).toBe(false);

        component.equipmentName.set('   ');
        expect(component.canSubmit).toBe(false);
      });
    });

    it('should submit with equipment name and serial number', () => {
      component.selectedLocationId.set(1);
      component.equipmentName.set('My Scope');
      component.serialNumber.set('SN-12345');
      component.onSubmit();

      expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining({
        equipmentName: 'My Scope',
        serialNumber: 'SN-12345',
        receivedQuantity: 1,
      }));
    });
  });
});
