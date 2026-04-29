import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { WorkOrderListView } from './work-order-list-view';
import { ManufacturingService } from '../../../services/manufacturing.service';
import { AuthService } from '../../../services/auth.service';

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

const mockDeletedWorkOrder = {
  id: 3, engineeringMasterID: 1, status: 'not_started', quantity: 1, activeFlag: false,
  deletionReason: 'Test deletion', deletedByUserID: 1, deletedAt: '2026-04-29T10:00:00Z',
  completedSteps: 0, totalSteps: 5,
  master: { id: 1, name: 'PCB Assembly', revision: 'A' },
  createdAt: '2026-04-07T11:00:00Z',
};

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

  describe('Show Deleted toggle', () => {
    it('defaults to hiding deleted work orders', () => {
      expect(component.showDeleted()).toBe(false);
    });

    it('refetches with includeDeleted=true when toggled on', () => {
      const spy = vi.spyOn(manufacturingService, 'getWorkOrders').mockReturnValue(
        of([...mockWorkOrders, mockDeletedWorkOrder] as any),
      );

      component.toggleShowDeleted();

      expect(spy).toHaveBeenCalledWith(undefined, true);
      expect(component.workOrders().some(w => w.activeFlag === false)).toBe(true);
    });

    it('refetches without includeDeleted when toggled off', () => {
      component.toggleShowDeleted();
      const spy = vi.spyOn(manufacturingService, 'getWorkOrders').mockReturnValue(of(mockWorkOrders as any));

      component.toggleShowDeleted();

      expect(spy).toHaveBeenCalledWith(undefined, false);
    });
  });

  describe('Restore action', () => {
    let authService: AuthService;

    beforeEach(() => {
      authService = TestBed.inject(AuthService);
    });

    it('exposes restore visibility based on undelete permission', () => {
      vi.spyOn(authService, 'hasPermission').mockImplementation(
        (r, a) => r === 'manufacturing_execution' && a === 'work_order_undelete',
      );

      expect(component.canUndelete()).toBe(true);
    });

    it('hides restore when undelete permission is missing', () => {
      vi.spyOn(authService, 'hasPermission').mockReturnValue(false);

      expect(component.canUndelete()).toBe(false);
    });
  });
});
