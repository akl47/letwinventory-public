import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { OrderItemDialog } from './order-item-dialog';
import { InventoryService } from '../../../services/inventory.service';
import { ErrorNotificationService } from '../../../services/error-notification.service';
import { Part, OrderItem } from '../../../models';

describe('OrderItemDialog', () => {
  let component: OrderItemDialog;
  let fixture: ComponentFixture<OrderItemDialog>;
  let inventoryService: InventoryService;
  let errorNotification: ErrorNotificationService;
  let dialogRef: any;

  const mockLineTypes = [
    { id: 1, name: 'Part', activeFlag: true, createdAt: '', updatedAt: '' },
    { id: 2, name: 'Equipment', activeFlag: true, createdAt: '', updatedAt: '' },
    { id: 3, name: 'Shipping', activeFlag: true, createdAt: '', updatedAt: '' },
    { id: 4, name: 'Taxes', activeFlag: true, createdAt: '', updatedAt: '' },
  ];

  const mockParts: Partial<Part>[] = [
    { id: 1, name: 'Resistor', sku: 'R100', description: '100 ohm', vendor: 'Digi-Key', activeFlag: true, PartCategory: { id: 1, name: 'Parts' } as any },
    { id: 2, name: 'Capacitor', sku: 'C100', description: '100uF', vendor: 'Mouser', activeFlag: true, PartCategory: { id: 1, name: 'Parts' } as any },
    { id: 3, name: 'Oscilloscope', sku: 'OSC1', description: 'Scope', vendor: 'Keysight', activeFlag: true, PartCategory: { id: 2, name: 'Equipment' } as any },
  ];

  function createComponent(dialogData: any = { orderID: 1 }) {
    dialogRef = { close: vi.fn() } as any;

    TestBed.configureTestingModule({
      imports: [OrderItemDialog],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
        { provide: MAT_DIALOG_DATA, useValue: dialogData },
        { provide: MatDialogRef, useValue: dialogRef },
      ],
    }).compileComponents();

    inventoryService = TestBed.inject(InventoryService);
    errorNotification = TestBed.inject(ErrorNotificationService);
    vi.spyOn(inventoryService, 'getAllParts').mockReturnValue(of(mockParts as Part[]));
    vi.spyOn(inventoryService, 'getOrderLineTypes').mockReturnValue(of(mockLineTypes as any));

    fixture = TestBed.createComponent(OrderItemDialog);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('create mode', () => {
    beforeEach(() => createComponent({ orderID: 1 }));

    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should load parts and line types', () => {
      expect(inventoryService.getAllParts).toHaveBeenCalled();
      expect(inventoryService.getOrderLineTypes).toHaveBeenCalled();
      expect(component.allParts().length).toBe(3);
      expect(component.orderLineTypes().length).toBe(4);
    });

    it('should have default form values', () => {
      expect(component.form.value.orderLineTypeID).toBe(1);
      expect(component.form.value.quantity).toBe(1);
      expect(component.form.value.price).toBe(0);
    });

    describe('currentLineTypeName', () => {
      it('should return Part for default line type', () => {
        expect(component.currentLineTypeName()).toBe('Part');
      });
    });

    describe('isPartLineType / isEquipmentLineType', () => {
      it('should detect Part line type', () => {
        expect(component.isPartLineType()).toBe(true);
        expect(component.isEquipmentLineType()).toBe(false);
      });

      it('should detect Equipment line type', () => {
        component.currentLineTypeID.set(2);
        expect(component.isEquipmentLineType()).toBe(true);
        expect(component.isPartLineType()).toBe(false);
      });
    });

    describe('showPartAutocomplete', () => {
      it('should show for Part or Equipment types', () => {
        component.currentLineTypeID.set(1);
        expect(component.showPartAutocomplete()).toBe(true);
        component.currentLineTypeID.set(2);
        expect(component.showPartAutocomplete()).toBe(true);
      });

      it('should not show for Shipping type', () => {
        component.currentLineTypeID.set(3);
        expect(component.showPartAutocomplete()).toBe(false);
      });
    });

    describe('showQuantityField', () => {
      it('should show only for Part type', () => {
        component.currentLineTypeID.set(1);
        expect(component.showQuantityField()).toBe(true);
        component.currentLineTypeID.set(2);
        expect(component.showQuantityField()).toBe(false);
      });
    });

    describe('availableParts', () => {
      it('should filter non-Equipment parts for Part type', () => {
        component.currentLineTypeID.set(1);
        const parts = component.availableParts();
        expect(parts.every(p => p.PartCategory?.name !== 'Equipment')).toBe(true);
      });

      it('should filter Equipment parts for Equipment type', () => {
        component.currentLineTypeID.set(2);
        const parts = component.availableParts();
        expect(parts.every(p => p.PartCategory?.name === 'Equipment')).toBe(true);
      });
    });

    describe('lineTotal', () => {
      it('should compute quantity * price', () => {
        component.currentQuantity.set(5);
        component.currentPrice.set(2.5);
        expect(component.lineTotal()).toBe(12.5);
      });
    });

    describe('formatPartDisplay', () => {
      it('should format part with sku and name', () => {
        const part = { sku: 'R100', name: 'Resistor' } as Part;
        expect(component.formatPartDisplay(part)).toBe('R100 - Resistor');
      });

      it('should return empty string for null', () => {
        expect(component.formatPartDisplay(null)).toBe('');
      });

      it('should return string as-is', () => {
        expect(component.formatPartDisplay('test')).toBe('test');
      });
    });

    describe('onPartSelected', () => {
      it('should set selected part and form partID', () => {
        const part = mockParts[0] as Part;
        component.onPartSelected(part);
        expect(component.selectedPart()).toBe(part);
        expect(component.form.value.partID).toBe(1);
      });
    });

    describe('save', () => {
      it('should show error when form invalid', () => {
        vi.spyOn(errorNotification, 'showError');
        // Form invalid because partID is required for Part type but not set
        component.save();
        expect(errorNotification.showError).toHaveBeenCalled();
      });

      it('should create new order item with correct line number', () => {
        const mockOrderWithItems = { OrderItems: [{ lineNumber: 2 }] };
        vi.spyOn(inventoryService, 'getOrderById').mockReturnValue(of(mockOrderWithItems as any));
        vi.spyOn(inventoryService, 'createOrderItem').mockReturnValue(of({} as any));
        vi.spyOn(errorNotification, 'showSuccess');

        component.form.patchValue({ partID: 1, quantity: 3, price: 2.5 });
        component.save();

        expect(inventoryService.createOrderItem).toHaveBeenCalledWith(expect.objectContaining({
          lineNumber: 3,
          orderID: 1,
        }));
        expect(dialogRef.close).toHaveBeenCalledWith(true);
      });
    });

    describe('cancel', () => {
      it('should close dialog with false', () => {
        component.cancel();
        expect(dialogRef.close).toHaveBeenCalledWith(false);
      });
    });
  });

  describe('edit mode', () => {
    const existingItem: Partial<OrderItem> = {
      id: 5,
      orderID: 1,
      orderLineTypeID: 1,
      partID: 1,
      lineNumber: 1,
      quantity: 10,
      price: 3.5,
      name: null,
      Part: { id: 1, name: 'Resistor', sku: 'R100' } as any,
    };

    beforeEach(() => createComponent({ orderID: 1, orderItem: existingItem }));

    it('should populate form with existing item data', () => {
      expect(component.form.value.quantity).toBe(10);
      expect(component.form.value.price).toBe(3.5);
      expect(component.form.value.partID).toBe(1);
    });

    it('should set selected part from existing item', () => {
      expect(component.selectedPart()?.id).toBe(1);
    });

    it('should update existing item on save', () => {
      vi.spyOn(inventoryService, 'updateOrderItem').mockReturnValue(of({} as any));
      vi.spyOn(errorNotification, 'showSuccess');

      component.save();

      expect(inventoryService.updateOrderItem).toHaveBeenCalledWith(5, expect.objectContaining({
        lineNumber: 1,
      }));
      expect(dialogRef.close).toHaveBeenCalledWith(true);
    });
  });
});
