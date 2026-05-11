import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { WorkOrderListView } from './work-order-list-view';
import { ManufacturingService } from '../../../services/manufacturing.service';
import { WorkOrder } from '../../../models/work-order.model';

const mockWorkOrders = [
  {
    id: 1, engineeringMasterID: 1, status: 'in_progress', quantity: 5, activeFlag: true,
    completedSteps: 2, totalSteps: 5,
    master: { id: 1, name: 'PCB Assembly', revision: 'A' },
    createdAt: '2026-04-07T10:00:00Z',
  },
  {
    id: 2, engineeringMasterID: 1, status: 'not_started', quantity: 10, activeFlag: true,
    completedSteps: 0, totalSteps: 5,
    master: { id: 1, name: 'PCB Assembly', revision: 'A' },
    createdAt: '2026-04-07T11:00:00Z',
  },
];

describe('WorkOrderListView', () => {
  let component: WorkOrderListView;
  let fixture: ComponentFixture<WorkOrderListView>;
  let manufacturingService: ManufacturingService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WorkOrderListView],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParams: {} }, queryParams: of({}) } },
      ],
    }).compileComponents();

    manufacturingService = TestBed.inject(ManufacturingService);
    vi.spyOn(manufacturingService, 'getWorkOrders').mockReturnValue(of(mockWorkOrders as unknown as WorkOrder[]));

    fixture = TestBed.createComponent(WorkOrderListView);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('creates', () => {
    expect(component).toBeTruthy();
  });

  it('loads work orders on init', () => {
    expect(manufacturingService.getWorkOrders).toHaveBeenCalled();
    expect(component.workOrders().length).toBe(2);
    expect(component.isLoading()).toBe(false);
  });

  it('renders via <app-data-table>', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('app-data-table')).toBeTruthy();
  });

  it('filteredWorkOrders narrows by statusFilter', () => {
    component.statusFilter.set('in_progress');
    expect(component.filteredWorkOrders().length).toBe(1);
    expect(component.filteredWorkOrders()[0].status).toBe('in_progress');
  });

  it('columns includes deletionInfo and restore only when showDeleted is true', () => {
    expect(component.columns().some(c => c.key === 'deletionInfo')).toBe(false);
    component.showDeleted.set(true);
    expect(component.columns().some(c => c.key === 'deletionInfo')).toBe(true);
    expect(component.columns().some(c => c.key === 'restore')).toBe(true);
  });

  it('rowHref returns the work-order URL', () => {
    expect(component.rowHref(mockWorkOrders[0] as unknown as WorkOrder)).toBe('/build/work-orders/1');
  });

  it('getStatusColor returns expected colors', () => {
    expect(component.getStatusColor('not_started')).toBe('#9e9e9e');
    expect(component.getStatusColor('in_progress')).toBe('#ff9800');
    expect(component.getStatusColor('complete')).toBe('#4caf50');
  });

  it('formatStatus returns human labels', () => {
    expect(component.formatStatus('not_started')).toBe('Not Started');
    expect(component.formatStatus('in_progress')).toBe('In Progress');
    expect(component.formatStatus('complete')).toBe('Complete');
  });
});
