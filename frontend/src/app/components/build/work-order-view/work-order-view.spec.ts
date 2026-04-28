import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { WorkOrderView } from './work-order-view';
import { ManufacturingService } from '../../../services/manufacturing.service';

const mockWorkOrder = {
  id: 1,
  engineeringMasterID: 1,
  status: 'in_progress',
  quantity: 5,
  locationBarcodeID: null,
  master: {
    id: 1, name: 'PCB Assembly', revision: '01',
    steps: [
      { id: 1, stepNumber: 10, title: 'Step 1', instructions: 'Do step 1', parts: [], tooling: [], markers: [] },
      { id: 2, stepNumber: 20, title: 'Step 2', instructions: 'Do step 2', parts: [], tooling: [], markers: [] },
      { id: 3, stepNumber: 30, title: 'Step 3', instructions: 'Do step 3', parts: [], tooling: [], markers: [] },
    ],
  },
  stepCompletions: [
    { id: 1, stepID: 1, completedByUserID: 3, completedAt: '2026-04-07T10:00:00Z', user: { displayName: 'John' } },
  ],
  outputTraces: [],
  createdByUserID: 1,
  createdAt: '2026-04-07T09:00:00Z',
};

describe('WorkOrderView', () => {
  let component: WorkOrderView;
  let fixture: ComponentFixture<WorkOrderView>;
  let manufacturingService: ManufacturingService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WorkOrderView],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { params: of({ id: '1' }) },
        },
      ],
    }).compileComponents();

    manufacturingService = TestBed.inject(ManufacturingService);
    vi.spyOn(manufacturingService, 'getWorkOrder').mockReturnValue(of(mockWorkOrder as any));

    fixture = TestBed.createComponent(WorkOrderView);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load work order on init', () => {
    expect(manufacturingService.getWorkOrder).toHaveBeenCalledWith(1);
    expect(component.workOrder()).toBeTruthy();
  });

  it('should show step completion status', () => {
    const wo = component.workOrder()!;
    expect(wo.stepCompletions.length).toBe(1);
    expect(wo.stepCompletions[0].stepID).toBe(1);
  });

  it('should identify the next step to complete', () => {
    // Step 1 is completed, so next should be step 2
    expect(component.nextStepID()).toBe(2);
  });

  it('should show master name and revision', () => {
    const wo = component.workOrder()!;
    expect(wo.master.name).toBe('PCB Assembly');
    expect(wo.master.revision).toBe('01');
  });

  it('should show quantity', () => {
    expect(component.workOrder()!.quantity).toBe(5);
  });

  it('should identify completed steps', () => {
    expect(component.isStepCompleted(1)).toBe(true);
    expect(component.isStepCompleted(2)).toBe(false);
  });

  it('should show steps in order', () => {
    const steps = component.workOrder()!.master.steps;
    expect(steps[0].stepNumber).toBe(10);
    expect(steps[1].stepNumber).toBe(20);
    expect(steps[2].stepNumber).toBe(30);
  });
});
