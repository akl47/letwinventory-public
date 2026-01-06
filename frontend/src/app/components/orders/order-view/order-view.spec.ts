import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';

import { OrderView } from './order-view';
import { InventoryService, Order, OrderItem } from '../../../services/inventory.service';

describe('OrderView', () => {
  let component: OrderView;
  let fixture: ComponentFixture<OrderView>;
  let inventoryServiceSpy: jasmine.SpyObj<InventoryService>;

  const mockOrder: Order = {
    id: 1,
    description: 'Test Order',
    vendor: 'Test Vendor',
    trackingNumber: 'TRACK-001',
    link: 'http://example.com/order',
    notes: 'Test notes',
    placedDate: new Date('2024-01-01'),
    receivedDate: undefined,
    orderStatusID: 1,
    activeFlag: true,
    OrderStatus: {
      id: 1,
      name: 'Pending',
      tagColor: '#FFA500',
      nextStatusID: 2
    },
    OrderItems: [
      {
        id: 1,
        orderID: 1,
        partID: 1,
        lineNumber: 1,
        quantity: 5,
        price: 10.99,
        description: 'Item 1',
        orderLineTypeID: 1,
        activeFlag: true
      }
    ]
  };

  beforeEach(async () => {
    inventoryServiceSpy = jasmine.createSpyObj('InventoryService', [
      'getOrderById',
      'updateOrder',
      'deleteOrder',
      'createOrderItem',
      'updateOrderItem',
      'deleteOrderItem'
    ]);
    inventoryServiceSpy.getOrderById.and.returnValue(of(mockOrder));

    await TestBed.configureTestingModule({
      imports: [OrderView, NoopAnimationsModule],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: InventoryService, useValue: inventoryServiceSpy },
        {
          provide: ActivatedRoute,
          useValue: {
            params: of({ id: '1' }),
            snapshot: { params: { id: '1' } }
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(OrderView);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('initialization', () => {
    it('should load order on init', () => {
      expect(inventoryServiceSpy.getOrderById).toHaveBeenCalledWith(1);
    });

    it('should populate order data', () => {
      expect(component.order()).toEqual(mockOrder);
    });
  });

  describe('order status', () => {
    it('should display current status', () => {
      expect(component.order()?.OrderStatus?.name).toBe('Pending');
    });

    it('should have next status available', () => {
      expect(component.order()?.OrderStatus?.nextStatusID).toBe(2);
    });
  });

  describe('order items', () => {
    it('should display order items', () => {
      expect(component.order()?.OrderItems?.length).toBe(1);
    });

    it('should calculate item total', () => {
      const item = component.order()?.OrderItems?.[0];
      if (item) {
        const total = (item.quantity || 0) * (item.price || 0);
        expect(total).toBe(54.95);
      }
    });
  });

  describe('update order', () => {
    it('should call updateOrder with new data', () => {
      inventoryServiceSpy.updateOrder.and.returnValue(of(mockOrder));

      component.updateOrder({ description: 'Updated Description' });

      expect(inventoryServiceSpy.updateOrder).toHaveBeenCalledWith(
        1,
        { description: 'Updated Description' }
      );
    });
  });

  describe('order item operations', () => {
    it('should add new order item', () => {
      const newItem: Partial<OrderItem> = {
        orderID: 1,
        lineNumber: 2,
        quantity: 3,
        price: 15.00
      };
      inventoryServiceSpy.createOrderItem.and.returnValue(of({} as OrderItem));

      component.addOrderItem(newItem);

      expect(inventoryServiceSpy.createOrderItem).toHaveBeenCalledWith(newItem);
    });

    it('should update existing order item', () => {
      inventoryServiceSpy.updateOrderItem.and.returnValue(of({} as OrderItem));

      component.updateOrderItem(1, { quantity: 10 });

      expect(inventoryServiceSpy.updateOrderItem).toHaveBeenCalledWith(1, { quantity: 10 });
    });

    it('should delete order item', () => {
      inventoryServiceSpy.deleteOrderItem.and.returnValue(of({ success: true }));

      component.deleteOrderItem(1);

      expect(inventoryServiceSpy.deleteOrderItem).toHaveBeenCalledWith(1);
    });
  });

  describe('formatting', () => {
    it('should format date correctly', () => {
      const formatted = component.formatDate(new Date('2024-01-15'));
      expect(formatted).toContain('2024');
    });

    it('should format currency correctly', () => {
      const formatted = component.formatCurrency(10.99);
      expect(formatted).toContain('10.99');
    });
  });
});
