import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { WorkOrderListView } from './work-order-list-view';
import { ManufacturingService } from '../../../services/manufacturing.service';

const mockWorkOrders = [
  {
    id: 1, engineeringMasterID: 1, status: 'in_progress', quantity: 5,
    completedSteps: 2, totalSteps: 5,
    master: { id: 1, name: 'PCB Assembly', revision: 'A' },
    createdAt: '2026-04-07T10:00:00Z',
  },
  {
    id: 2, engineeringMasterID: 1, status: 'not_started', quantity: 10,
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
      ],
    }).compileComponents();

    manufacturingService = TestBed.inject(ManufacturingService);
    vi.spyOn(manufacturingService, 'getWorkOrders').mockReturnValue(of(mockWorkOrders as any));

    fixture = TestBed.createComponent(WorkOrderListView);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load work orders on init', () => {
    expect(manufacturingService.getWorkOrders).toHaveBeenCalled();
    expect(component.workOrders().length).toBe(2);
    expect(component.isLoading()).toBe(false);
  });

  it('should display all work orders when no filter', () => {
    expect(component.displayedWorkOrders().length).toBe(2);
  });

  it('should filter by status', () => {
    component.statusFilter.set('in_progress');
    expect(component.displayedWorkOrders().length).toBe(1);
    expect(component.displayedWorkOrders()[0].status).toBe('in_progress');
  });

  it('should filter by search text', () => {
    component.onSearchChange('pcb');
    expect(component.displayedWorkOrders().length).toBe(2); // Both have same master
  });

  it('should show progress as completedSteps/totalSteps', () => {
    const wo = component.workOrders()[0];
    expect(wo.completedSteps).toBe(2);
    expect(wo.totalSteps).toBe(5);
  });
});
