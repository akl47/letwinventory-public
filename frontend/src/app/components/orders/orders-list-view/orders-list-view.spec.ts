import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { OrdersListView } from './orders-list-view';
import { InventoryService } from '../../../services/inventory.service';
import { Order, OrderStatus } from '../../../models';

const mockStatuses: OrderStatus[] = [
  { id: 1, name: 'Pending', tagColor: '#ccc', nextStatusID: 2, activeFlag: true, createdAt: '', updatedAt: '' },
  { id: 2, name: 'Placed', tagColor: '#00f', nextStatusID: 3, activeFlag: true, createdAt: '', updatedAt: '' },
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
    ],
  },
];

describe('OrdersListView', () => {
  let component: OrdersListView;
  let fixture: ComponentFixture<OrdersListView>;
  let inventoryService: InventoryService;

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
    fixture.detectChanges();
  });

  it('creates', () => {
    expect(component).toBeTruthy();
  });

  it('loads statuses and orders on init', () => {
    expect(inventoryService.getOrderStatuses).toHaveBeenCalled();
    expect(inventoryService.getAllOrders).toHaveBeenCalled();
    expect(component.statuses().length).toBe(2);
    expect(component.allOrders().length).toBe(1);
  });

  it('renders via <app-data-table>', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('app-data-table')).toBeTruthy();
  });

  it('rowHref returns the order detail URL', () => {
    expect(component.rowHref(mockOrders[0])).toBe('/orders/1');
  });

  describe('calculations', () => {
    it('calculateItemCount returns the number of active line items', () => {
      expect(component.calculateItemCount(mockOrders[0])).toBe(2);
    });

    it('calculateTotalPrice handles numeric and string prices', () => {
      const total = component.calculateTotalPrice(mockOrders[0]);
      // 5 * 1.5 = 7.5, 10 * 2.25 = 22.5, total = 30
      expect(total).toBe(30);
    });
  });

});
