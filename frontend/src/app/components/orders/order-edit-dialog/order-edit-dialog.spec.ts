import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { OrderEditDialog } from './order-edit-dialog';
import { InventoryService } from '../../../services/inventory.service';
import { ErrorNotificationService } from '../../../services/error-notification.service';

describe('OrderEditDialog', () => {
  let component: OrderEditDialog;
  let fixture: ComponentFixture<OrderEditDialog>;
  let inventoryService: InventoryService;
  let errorNotification: ErrorNotificationService;
  let dialogRef: any;

  const mockStatuses = [
    { id: 1, name: 'Pending' },
    { id: 2, name: 'Placed' },
  ];

  function createComponent(dialogData: any = {}) {
    dialogRef = { close: vi.fn() } as any;

    TestBed.configureTestingModule({
      imports: [OrderEditDialog],
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
    vi.spyOn(inventoryService, 'getOrderStatuses').mockReturnValue(of(mockStatuses as any));

    fixture = TestBed.createComponent(OrderEditDialog);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('create mode', () => {
    beforeEach(() => createComponent({}));

    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should load order statuses', () => {
      expect(inventoryService.getOrderStatuses).toHaveBeenCalled();
      expect(component.orderStatuses().length).toBe(2);
    });

    it('should not be in edit mode', () => {
      expect(component.isEditMode()).toBe(false);
    });

    it('should have default form values', () => {
      expect(component.form.value.orderStatusID).toBe(1);
      expect(component.form.value.vendor).toBe('');
    });

    it('should create order on save', () => {
      vi.spyOn(inventoryService, 'createOrder').mockReturnValue(of({ id: 5 } as any));
      vi.spyOn(errorNotification, 'showSuccess');

      component.form.patchValue({
        vendor: 'TestVendor',
        placedDate: new Date('2026-01-01'),
        orderStatusID: 1,
      });

      component.save();

      expect(inventoryService.createOrder).toHaveBeenCalled();
      expect(dialogRef.close).toHaveBeenCalledWith({ id: 5 } as any);
    });

    it('should show error when form is invalid', () => {
      vi.spyOn(errorNotification, 'showError');
      component.form.patchValue({ placedDate: null, orderStatusID: null });
      component.save();
      expect(errorNotification.showError).toHaveBeenCalledWith('Please fill in all required fields');
    });

    it('should close with false on cancel', () => {
      component.cancel();
      expect(dialogRef.close).toHaveBeenCalledWith(false);
    });
  });

  describe('edit mode', () => {
    const mockOrder = {
      id: 10,
      vendor: 'Mouser',
      link: 'http://example.com',
      placedDate: '2026-01-15',
      receivedDate: null,
      orderStatusID: 2,
      description: 'Test desc',
    };

    beforeEach(() => createComponent({ order: mockOrder }));

    it('should be in edit mode', () => {
      expect(component.isEditMode()).toBe(true);
    });

    it('should populate form with order data', () => {
      expect(component.form.value.vendor).toBe('Mouser');
      expect(component.form.value.link).toBe('http://example.com');
      expect(component.form.value.orderStatusID).toBe(2);
      expect(component.form.value.description).toBe('Test desc');
    });

    it('should update order on save', () => {
      vi.spyOn(inventoryService, 'updateOrder').mockReturnValue(of({} as any));
      vi.spyOn(errorNotification, 'showSuccess');

      component.save();

      expect(inventoryService.updateOrder).toHaveBeenCalledWith(10, expect.any(Object));
      expect(dialogRef.close).toHaveBeenCalledWith(true);
    });

    it('should show error notification on update failure', () => {
      vi.spyOn(inventoryService, 'updateOrder').mockReturnValue(throwError(() => ({ error: { message: 'fail' } })));
      vi.spyOn(errorNotification, 'showHttpError');

      component.save();

      expect(errorNotification.showHttpError).toHaveBeenCalled();
    });
  });
});
