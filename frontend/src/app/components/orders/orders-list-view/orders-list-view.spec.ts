import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { OrdersListView } from './orders-list-view';
import { InventoryService } from '../../../services/inventory.service';
import { Order, OrderStatus } from '../../../models';

describe('OrdersListView', () => {
  let component: OrdersListView;
  let fixture: ComponentFixture<OrdersListView>;
  let inventoryService: InventoryService;

  const mockStatuses: OrderStatus[] = [
    { id: 1, name: 'Pending', tagColor: '#ccc', nextStatusID: 2, activeFlag: true, createdAt: '', updatedAt: '' },
    { id: 2, name: 'Placed', tagColor: '#00f', nextStatusID: 3, activeFlag: true, createdAt: '', updatedAt: '' },
    { id: 3, name: 'Shipped', tagColor: '#ff0', nextStatusID: 4, activeFlag: true, createdAt: '', updatedAt: '' },
    { id: 4, name: 'Received', tagColor: '#0f0', nextStatusID: null, activeFlag: true, createdAt: '', updatedAt: '' },
  ];

  const mockOrders: Order[] = [
    {
      id: 1, placedDate: '2026-01-01', receivedDate: null, orderStatusID: 1,
      vendor: 'Digi-Key', trackingNumber: null, link: null,
      description: 'Test order', notes: null, activeFlag: true,
      createdAt: '2026-01-01', updatedAt: '2026-01-01',
      OrderStatus: mockStatuses[0],
      OrderItems: [
        { id: 1, orderID: 1, partID: 1, orderLineTypeID: 1, lineNumber: 1, quantity: 5, receivedQuantity: 0, price: 1.5, name: null, activeFlag: true, createdAt: '', updatedAt: '' },
        { id: 2, orderID: 1, partID: 2, orderLineTypeID: 1, lineNumber: 2, quantity: 10, receivedQuantity: 0, price: '2.25', name: null, activeFlag: true, createdAt: '', updatedAt: '' },
      ]
    },
    {
      id: 2, placedDate: '2026-02-01', receivedDate: null, orderStatusID: 2,
      vendor: 'Mouser', trackingNumber: 'TRK123', link: null,
      description: 'Second order', notes: null, activeFlag: true,
      createdAt: '2026-02-01', updatedAt: '2026-02-01',
      OrderStatus: mockStatuses[1],
      OrderItems: []
    },
    {
      id: 3, placedDate: '2025-12-01', receivedDate: null, orderStatusID: 1,
      vendor: 'Amazon', trackingNumber: null, link: null,
      description: 'Inactive order', notes: null, activeFlag: false,
      createdAt: '2025-12-01', updatedAt: '2025-12-01',
      OrderStatus: mockStatuses[0],
      OrderItems: []
    },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OrdersListView],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParams: {} }, queryParams: of({}) } },
      ],
    }).compileComponents();

    inventoryService = TestBed.inject(InventoryService);
    vi.spyOn(inventoryService, 'getOrderStatuses').mockReturnValue(of(mockStatuses));
    vi.spyOn(inventoryService, 'getAllOrders').mockReturnValue(of(mockOrders));

    fixture = TestBed.createComponent(OrdersListView);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load statuses and orders on init', () => {
    expect(inventoryService.getOrderStatuses).toHaveBeenCalled();
    expect(inventoryService.getAllOrders).toHaveBeenCalled();
    expect(component.statuses().length).toBe(4);
    expect(component.allOrders().length).toBe(3);
  });

  it('should initialize all statuses as selected', () => {
    const selected = component.selectedStatusIds();
    expect(selected.size).toBe(4);
    mockStatuses.forEach(s => expect(selected.has(s.id)).toBe(true));
  });

  describe('allStatusesSelected', () => {
    it('should return true when all statuses are selected', () => {
      expect(component.allStatusesSelected()).toBe(true);
    });

    it('should return false when some statuses are deselected', () => {
      component.toggleStatus(1);
      expect(component.allStatusesSelected()).toBe(false);
    });
  });

  describe('someStatusesSelected', () => {
    it('should return false when all are selected', () => {
      expect(component.someStatusesSelected()).toBe(false);
    });

    it('should return true when some but not all are selected', () => {
      component.toggleStatus(1);
      expect(component.someStatusesSelected()).toBe(true);
    });

    it('should return false when none are selected', () => {
      component.toggleAllStatuses(); // deselect all
      expect(component.someStatusesSelected()).toBe(false);
    });
  });

  describe('hiddenStatusCount', () => {
    it('should return 0 when all are selected', () => {
      expect(component.hiddenStatusCount()).toBe(0);
    });

    it('should return correct count after toggling', () => {
      component.toggleStatus(1);
      component.toggleStatus(2);
      expect(component.hiddenStatusCount()).toBe(2);
    });
  });

  describe('applyFiltersAndSort', () => {
    it('should filter out inactive orders by default', () => {
      const displayed = component.displayedOrders();
      expect(displayed.every(o => o.activeFlag === true)).toBe(true);
    });

    it('should include inactive orders when showInactive is true', () => {
      component.onToggleInactive(true);
      expect(component.displayedOrders().length).toBe(3);
    });

    it('should filter by search text on vendor', () => {
      component.onSearchChange('mouser');
      const displayed = component.displayedOrders();
      expect(displayed.length).toBe(1);
      expect(displayed[0].vendor).toBe('Mouser');
    });

    it('should filter by search text on description', () => {
      component.onSearchChange('test order');
      expect(component.displayedOrders().length).toBe(1);
    });

    it('should filter by status selection', () => {
      component.toggleStatus(1); // deselect Pending
      const displayed = component.displayedOrders();
      expect(displayed.every(o => o.orderStatusID !== 1)).toBe(true);
    });

    it('should show empty when no statuses selected', () => {
      component.toggleAllStatuses(); // deselect all
      expect(component.displayedOrders().length).toBe(0);
    });
  });

  describe('onSearchChange', () => {
    it('should set search text and reset page index', () => {
      component.pageIndex.set(2);
      component.onSearchChange('test');
      expect(component.searchText()).toBe('test');
      expect(component.pageIndex()).toBe(0);
    });
  });

  describe('onPageChange', () => {
    it('should update page index and page size', () => {
      component.onPageChange({ pageIndex: 1, pageSize: 50, length: 100 });
      expect(component.pageIndex()).toBe(1);
      expect(component.pageSize()).toBe(50);
    });
  });

  describe('onSortChange', () => {
    it('should update sort column and direction', () => {
      component.onSortChange({ active: 'vendor', direction: 'asc' });
      expect(component.sortColumn()).toBe('vendor');
      expect(component.sortDirection()).toBe('asc');
    });
  });

  describe('toggleStatus', () => {
    it('should toggle a status off', () => {
      expect(component.isStatusSelected(1)).toBe(true);
      component.toggleStatus(1);
      expect(component.isStatusSelected(1)).toBe(false);
    });

    it('should toggle a status back on', () => {
      component.toggleStatus(1);
      component.toggleStatus(1);
      expect(component.isStatusSelected(1)).toBe(true);
    });

    it('should reset page index to 0', () => {
      component.pageIndex.set(3);
      component.toggleStatus(1);
      expect(component.pageIndex()).toBe(0);
    });
  });

  describe('toggleAllStatuses', () => {
    it('should deselect all when all are selected', () => {
      component.toggleAllStatuses();
      expect(component.selectedStatusIds().size).toBe(0);
    });

    it('should select all when none are selected', () => {
      component.toggleAllStatuses(); // deselect all
      component.toggleAllStatuses(); // select all
      expect(component.selectedStatusIds().size).toBe(4);
    });
  });

  describe('getTotalCount', () => {
    it('should return count of active filtered orders', () => {
      expect(component.getTotalCount()).toBe(2); // only active orders
    });

    it('should include inactive when showInactive is true', () => {
      component.showInactive.set(true);
      expect(component.getTotalCount()).toBe(3);
    });

    it('should respect search filter', () => {
      component.searchText.set('mouser');
      expect(component.getTotalCount()).toBe(1);
    });
  });

  describe('getStatusClass', () => {
    it('should return correct class for known statuses', () => {
      expect(component.getStatusClass('Pending')).toBe('status-pending');
      expect(component.getStatusClass('Placed')).toBe('status-placed');
      expect(component.getStatusClass('Shipped')).toBe('status-shipped');
      expect(component.getStatusClass('Received')).toBe('status-received');
    });

    it('should return empty string for unknown status', () => {
      expect(component.getStatusClass('Unknown')).toBe('');
    });
  });

  describe('getContrastColor', () => {
    it('should return black for light backgrounds', () => {
      expect(component.getContrastColor('#ffffff')).toBe('#000000');
      expect(component.getContrastColor('#ffff00')).toBe('#000000');
    });

    it('should return white for dark backgrounds', () => {
      expect(component.getContrastColor('#000000')).toBe('#ffffff');
      expect(component.getContrastColor('#333333')).toBe('#ffffff');
    });

    it('should handle hex without # prefix', () => {
      expect(component.getContrastColor('ffffff')).toBe('#000000');
    });
  });

  describe('calculateItemCount', () => {
    it('should count active items', () => {
      expect(component.calculateItemCount(mockOrders[0])).toBe(2);
    });

    it('should return 0 when no items', () => {
      expect(component.calculateItemCount(mockOrders[1])).toBe(0);
    });
  });

  describe('calculateTotalPrice', () => {
    it('should sum quantity * price for active items', () => {
      // 5 * 1.5 + 10 * 2.25 = 7.5 + 22.5 = 30
      expect(component.calculateTotalPrice(mockOrders[0])).toBe(30);
    });

    it('should handle string prices', () => {
      const order: Order = {
        ...mockOrders[0],
        OrderItems: [
          { id: 1, orderID: 1, partID: 1, orderLineTypeID: 1, lineNumber: 1, quantity: 3, receivedQuantity: 0, price: '4.50', name: null, activeFlag: true, createdAt: '', updatedAt: '' }
        ]
      };
      expect(component.calculateTotalPrice(order)).toBe(13.5);
    });

    it('should return 0 for empty items', () => {
      expect(component.calculateTotalPrice(mockOrders[1])).toBe(0);
    });
  });

  describe('onRowMouseDown', () => {
    it('should prevent default for middle-click', () => {
      const event = new MouseEvent('mousedown', { button: 1 });
      vi.spyOn(event, 'preventDefault');
      component.onRowMouseDown(event);
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it('should not prevent default for left-click', () => {
      const event = new MouseEvent('mousedown', { button: 0 });
      vi.spyOn(event, 'preventDefault');
      component.onRowMouseDown(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
    });
  });
});
