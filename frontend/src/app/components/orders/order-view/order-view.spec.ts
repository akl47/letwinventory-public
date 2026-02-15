import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { OrderView } from './order-view';
import { InventoryService } from '../../../services/inventory.service';
import { Order, OrderItem } from '../../../models';

describe('OrderView', () => {
  let component: OrderView;
  let fixture: ComponentFixture<OrderView>;
  let inventoryService: InventoryService;

  const mockStatuses = [
    { id: 1, name: 'Pending', tagColor: null, nextStatusID: 2, activeFlag: true },
    { id: 2, name: 'Placed', tagColor: null, nextStatusID: 3, activeFlag: true },
    { id: 3, name: 'Shipped', tagColor: null, nextStatusID: 4, activeFlag: true },
    { id: 4, name: 'Received', tagColor: null, nextStatusID: null, activeFlag: true },
    { id: 5, name: 'Partially Received', tagColor: null, nextStatusID: null, activeFlag: true },
  ];

  const mockLineTypes = [
    { id: 1, name: 'Part', activeFlag: true, createdAt: '', updatedAt: '' },
    { id: 2, name: 'Equipment', activeFlag: true, createdAt: '', updatedAt: '' },
    { id: 3, name: 'Shipping', activeFlag: true, createdAt: '', updatedAt: '' },
    { id: 4, name: 'Taxes', activeFlag: true, createdAt: '', updatedAt: '' },
  ];

  const mockOrder: Order = {
    id: 1, placedDate: '2026-01-01', receivedDate: null, orderStatusID: 1,
    vendor: 'Digi-Key', trackingNumber: null, link: null,
    description: 'Test order', notes: null, activeFlag: true,
    createdAt: '2026-01-01', updatedAt: '2026-01-01',
    OrderStatus: { id: 1, name: 'Pending', tagColor: null, nextStatusID: 2, activeFlag: true, createdAt: '', updatedAt: '' },
    OrderItems: [
      { id: 10, orderID: 1, partID: 1, orderLineTypeID: 1, lineNumber: 1, quantity: 5, receivedQuantity: 0, price: 1.5, name: null, activeFlag: true, createdAt: '', updatedAt: '', OrderLineType: { id: 1, name: 'Part', activeFlag: true, createdAt: '', updatedAt: '' }, Part: { name: 'Resistor', PartCategory: { name: 'Parts' } } as any },
      { id: 11, orderID: 1, partID: null, orderLineTypeID: 3, lineNumber: 2, quantity: 1, receivedQuantity: 0, price: '5.99', name: 'Shipping', activeFlag: true, createdAt: '', updatedAt: '', OrderLineType: { id: 3, name: 'Shipping', activeFlag: true, createdAt: '', updatedAt: '' } },
    ]
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OrderView],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of({ get: (key: string) => key === 'id' ? '1' : null }),
            snapshot: { params: { id: '1' }, queryParams: {} },
            params: of({ id: '1' }),
            queryParams: of({}),
          }
        },
      ],
    }).compileComponents();

    inventoryService = TestBed.inject(InventoryService);
    vi.spyOn(inventoryService, 'getOrderStatuses').mockReturnValue(of(mockStatuses as any));
    vi.spyOn(inventoryService, 'getOrderLineTypes').mockReturnValue(of(mockLineTypes as any));
    vi.spyOn(inventoryService, 'getPrinters').mockReturnValue(of([]));
    vi.spyOn(inventoryService, 'getAllParts').mockReturnValue(of([]));
    vi.spyOn(inventoryService, 'getOrderById').mockReturnValue(of(mockOrder));

    fixture = TestBed.createComponent(OrderView);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load order data on init', () => {
    expect(inventoryService.getOrderById).toHaveBeenCalledWith(1);
    expect(component.currentOrder()).toBeTruthy();
    expect(component.orderItems().length).toBe(2);
  });

  it('should set isEditMode true for existing order', () => {
    expect(component.isEditMode()).toBe(true);
  });

  describe('hasNextStatus', () => {
    it('should return true when next status exists', () => {
      expect(component.hasNextStatus()).toBe(true);
    });

    it('should return false when no next status', () => {
      component.currentOrder.set({
        ...mockOrder,
        OrderStatus: { id: 4, name: 'Received', tagColor: null, nextStatusID: null, activeFlag: true, createdAt: '', updatedAt: '' }
      });
      expect(component.hasNextStatus()).toBe(false);
    });
  });

  describe('nextStatusName', () => {
    it('should return name of next status', () => {
      expect(component.nextStatusName()).toBe('Placed');
    });

    it('should return empty string when no next status', () => {
      component.currentOrder.set({
        ...mockOrder,
        OrderStatus: { id: 4, name: 'Received', tagColor: null, nextStatusID: null, activeFlag: true, createdAt: '', updatedAt: '' }
      });
      expect(component.nextStatusName()).toBe('');
    });
  });

  describe('canReceive', () => {
    it('should be true for Shipped status (id 3)', () => {
      component.currentOrder.set({ ...mockOrder, orderStatusID: 3 });
      expect(component.canReceive()).toBe(true);
    });

    it('should be true for Partially Received status (id 5)', () => {
      component.currentOrder.set({ ...mockOrder, orderStatusID: 5 });
      expect(component.canReceive()).toBe(true);
    });

    it('should be false for Pending status', () => {
      expect(component.canReceive()).toBe(false);
    });
  });

  describe('showReceiveButton', () => {
    it('should be true only for Shipped status', () => {
      component.currentOrder.set({ ...mockOrder, orderStatusID: 3 });
      expect(component.showReceiveButton()).toBe(true);
    });

    it('should be false for non-Shipped status', () => {
      expect(component.showReceiveButton()).toBe(false);
    });
  });

  describe('displayedColumns', () => {
    it('should return view columns by default', () => {
      const cols = component.displayedColumns;
      expect(cols).toContain('lineNumber');
      expect(cols).toContain('quantity');
      expect(cols).not.toContain('dragHandle');
    });

    it('should return edit columns when in form edit mode', () => {
      component.isFormEditMode.set(true);
      const cols = component.displayedColumns;
      expect(cols).toContain('dragHandle');
      expect(cols).toContain('actions');
    });

    it('should return receive columns when in receive mode', () => {
      component.isReceiveMode.set(true);
      const cols = component.displayedColumns;
      expect(cols).toContain('ordered');
      expect(cols).toContain('remaining');
    });
  });

  describe('enableEdit / cancelEdit', () => {
    it('should set isFormEditMode to true', () => {
      component.enableEdit();
      expect(component.isFormEditMode()).toBe(true);
    });

    it('should set isFormEditMode to false and reload', () => {
      component.enableEdit();
      component.cancelEdit();
      expect(component.isFormEditMode()).toBe(false);
    });
  });

  describe('getPrice', () => {
    it('should return number price as-is', () => {
      const item = { price: 5.25 } as OrderItem;
      expect(component.getPrice(item)).toBe(5.25);
    });

    it('should parse string price', () => {
      const item = { price: '3.50' } as OrderItem;
      expect(component.getPrice(item)).toBe(3.5);
    });

    it('should return 0 for null price', () => {
      const item = { price: null } as any;
      expect(component.getPrice(item)).toBe(0);
    });
  });

  describe('formatPrice', () => {
    it('should format price with trailing zeros removed after 2 decimals', () => {
      const item = { price: 1.5 } as OrderItem;
      expect(component.formatPrice(item)).toBe('1.50');
    });

    it('should keep significant decimals beyond 2 places', () => {
      const item = { price: 1.12345 } as OrderItem;
      expect(component.formatPrice(item)).toBe('1.12345');
    });
  });

  describe('calculateLineTotal', () => {
    it('should multiply quantity by price and round up to 2 decimals', () => {
      const item = { quantity: 3, price: 1.333 } as OrderItem;
      // 3 * 1.333 = 3.999 -> ceil(399.9) / 100 = 4.00
      expect(component.calculateLineTotal(item)).toBe(4);
    });
  });

  describe('calculateOrderTotal', () => {
    it('should sum all line totals', () => {
      // item 1: 5 * 1.5 = 7.5, item 2: 1 * 5.99 = 5.99
      const total = component.calculateOrderTotal();
      expect(total).toBeCloseTo(13.49, 2);
    });
  });

  describe('getTotalQuantity', () => {
    it('should sum all item quantities', () => {
      expect(component.getTotalQuantity()).toBe(6); // 5 + 1
    });
  });

  describe('getStatusName', () => {
    it('should return status name for known id', () => {
      expect(component.getStatusName(1)).toBe('Pending');
      expect(component.getStatusName(3)).toBe('Shipped');
    });

    it('should return empty for unknown id', () => {
      expect(component.getStatusName(99)).toBe('');
    });
  });

  describe('formatDate', () => {
    it('should return formatted date for valid string', () => {
      const result = component.formatDate('2026-01-15');
      expect(result).toBeTruthy();
      expect(result).not.toBe('-');
    });

    it('should return dash for null', () => {
      expect(component.formatDate(null)).toBe('-');
    });
  });

  describe('getContrastColor', () => {
    it('should return black for white background', () => {
      expect(component.getContrastColor('#ffffff')).toBe('#000000');
    });

    it('should return white for black background', () => {
      expect(component.getContrastColor('#000000')).toBe('#ffffff');
    });
  });

  describe('receive mode', () => {
    it('should enter receive mode and initialize quantities', () => {
      component.enterReceiveMode();
      expect(component.isReceiveMode()).toBe(true);
      const quantities = component.receivingQuantities();
      // Only Part items (orderLineTypeID 1) should be in the map
      expect(quantities.has(10)).toBe(true);
      expect(quantities.get(10)).toBe(5); // quantity 5, received 0 => remaining 5
    });

    it('should cancel receive mode', () => {
      component.enterReceiveMode();
      component.cancelReceiveMode();
      expect(component.isReceiveMode()).toBe(false);
      expect(component.receivingQuantities().size).toBe(0);
    });
  });

  describe('updateReceivingQuantity / getReceivingQuantity', () => {
    it('should update and retrieve receiving quantity', () => {
      component.updateReceivingQuantity(10, 3);
      expect(component.getReceivingQuantity(10)).toBe(3);
    });

    it('should return 0 for unknown item', () => {
      expect(component.getReceivingQuantity(999)).toBe(0);
    });
  });

  describe('getRemainingQuantity', () => {
    it('should return quantity minus received', () => {
      const item = { quantity: 10, receivedQuantity: 3 } as OrderItem;
      expect(component.getRemainingQuantity(item)).toBe(7);
    });

    it('should handle null receivedQuantity', () => {
      const item = { quantity: 5, receivedQuantity: 0 } as OrderItem;
      expect(component.getRemainingQuantity(item)).toBe(5);
    });
  });

  describe('line type checks', () => {
    it('isPartLineType should check OrderLineType name', () => {
      const item = { OrderLineType: { name: 'Part' } } as any;
      expect(component.isPartLineType(item)).toBe(true);
    });

    it('isEquipmentLineType should check OrderLineType name', () => {
      const item = { OrderLineType: { name: 'Equipment' } } as any;
      expect(component.isEquipmentLineType(item)).toBe(true);
    });

    it('isReceivableLineType should be true for Part or Equipment', () => {
      const partItem = { OrderLineType: { name: 'Part' } } as any;
      const equipItem = { OrderLineType: { name: 'Equipment' } } as any;
      const shipItem = { OrderLineType: { name: 'Shipping' } } as any;
      expect(component.isReceivableLineType(partItem)).toBe(true);
      expect(component.isReceivableLineType(equipItem)).toBe(true);
      expect(component.isReceivableLineType(shipItem)).toBe(false);
    });
  });

  describe('getLineTypeName', () => {
    it('should return name for known type id', () => {
      expect(component.getLineTypeName(1)).toBe('Part');
      expect(component.getLineTypeName(3)).toBe('Shipping');
    });

    it('should return empty for unknown id', () => {
      expect(component.getLineTypeName(99)).toBe('');
    });
  });

  describe('isPartOrEquipmentTypeId', () => {
    it('should return true for Part and Equipment type ids', () => {
      expect(component.isPartOrEquipmentTypeId(1)).toBe(true);
      expect(component.isPartOrEquipmentTypeId(2)).toBe(true);
    });

    it('should return false for other type ids', () => {
      expect(component.isPartOrEquipmentTypeId(3)).toBe(false);
      expect(component.isPartOrEquipmentTypeId(4)).toBe(false);
    });
  });

  describe('startEditLineItem / cancelLineItemEdit', () => {
    it('should set editing state from item', () => {
      const item = mockOrder.OrderItems![0];
      component.startEditLineItem(item);
      expect(component.editingItemId()).toBe(10);
      expect(component.editingQuantity()).toBe(5);
      expect(component.editingPrice()).toBe(1.5);
      expect(component.editingLineTypeId()).toBe(1);
    });

    it('should clear editing state on cancel', () => {
      component.startEditLineItem(mockOrder.OrderItems![0]);
      component.cancelLineItemEdit();
      expect(component.editingItemId()).toBeNull();
    });
  });

  describe('onQuantityChange / onPriceChange', () => {
    it('should set editing quantity', () => {
      component.onQuantityChange(10);
      expect(component.editingQuantity()).toBe(10);
    });

    it('should set editing price', () => {
      component.onPriceChange(99.99);
      expect(component.editingPrice()).toBe(99.99);
    });
  });

  describe('isEquipmentPart', () => {
    it('should return true for Equipment category', () => {
      const item = { Part: { PartCategory: { name: 'Equipment' } } } as any;
      expect(component.isEquipmentPart(item)).toBe(true);
    });

    it('should return false for non-Equipment', () => {
      const item = { Part: { PartCategory: { name: 'Parts' } } } as any;
      expect(component.isEquipmentPart(item)).toBe(false);
    });
  });
});
