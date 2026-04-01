import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { of, Subject } from 'rxjs';
import { vi } from 'vitest';

import { BuildView } from './build-view';
import { InventoryService } from '../../../services/inventory.service';
import { BarcodeHistoryService } from '../../../services/history.service';

const mockTag = { id: 1, barcodeID: 10, barcode: 'AKL-000010', type: 'Trace', name: 'Motor Kit', description: 'Test kit', partID: 1, activeFlag: true };
const mockKitStatus = {
  status: 'partial',
  bomLines: [
    { partID: 2, partName: 'Bolt', requiredQty: 5, kittedQty: 3 },
    { partID: 3, partName: 'Washer', requiredQty: 10, kittedQty: 10 },
  ]
};

describe('BuildView', () => {
  let component: BuildView;
  let fixture: ComponentFixture<BuildView>;
  let inventoryService: InventoryService;
  let historyService: BarcodeHistoryService;
  let paramsSubject: Subject<any>;

  beforeEach(async () => {
    paramsSubject = new Subject();

    await TestBed.configureTestingModule({
      imports: [BuildView],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            params: paramsSubject.asObservable(),
            snapshot: { params: {} },
          }
        },
      ],
    }).compileComponents();

    inventoryService = TestBed.inject(InventoryService);
    historyService = TestBed.inject(BarcodeHistoryService);
    vi.spyOn(inventoryService, 'getTagById').mockReturnValue(of(mockTag as any));
    vi.spyOn(inventoryService, 'getKitStatus').mockReturnValue(of(mockKitStatus));
    vi.spyOn(inventoryService, 'getPartById').mockReturnValue(of({ id: 1, name: 'Motor Kit', imageFile: null } as any));
    vi.spyOn(historyService, 'getBarcodeHistory').mockReturnValue(of([
      { id: 1, barcodeID: 10, actionID: 1, userID: 1, createdAt: '2026-03-31T00:00:00Z', actionType: { id: 1, code: 'CREATED', name: 'Created' }, user: { id: 1, displayName: 'Alex Letwin' } }
    ] as any));

    fixture = TestBed.createComponent(BuildView);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load build data when route param is set', () => {
    paramsSubject.next({ barcodeId: '10' });
    expect(inventoryService.getTagById).toHaveBeenCalledWith(10);
    expect(inventoryService.getKitStatus).toHaveBeenCalledWith(10);
  });

  it('should display BOM lines from kit status', () => {
    paramsSubject.next({ barcodeId: '10' });
    expect(component.kitStatus()?.bomLines.length).toBe(2);
  });

  it('should compute overall status as partial', () => {
    paramsSubject.next({ barcodeId: '10' });
    expect(component.overallStatus()).toBe('partial');
  });

  it('should compute overall status as complete when all fulfilled', () => {
    vi.mocked(inventoryService.getKitStatus).mockReturnValue(of({
      status: 'complete',
      bomLines: [
        { partID: 2, partName: 'Bolt', requiredQty: 5, kittedQty: 5 },
      ]
    }));
    paramsSubject.next({ barcodeId: '10' });
    expect(component.overallStatus()).toBe('complete');
  });

  it('getLineStatus returns correct status', () => {
    expect(component.getLineStatus({ kittedQty: 5, requiredQty: 5 })).toBe('fulfilled');
    expect(component.getLineStatus({ kittedQty: 3, requiredQty: 5 })).toBe('partial');
    expect(component.getLineStatus({ kittedQty: 0, requiredQty: 5 })).toBe('empty');
  });

  it('should include actions column in BOM table', () => {
    expect(component.bomColumns).toContain('actions');
  });
});
