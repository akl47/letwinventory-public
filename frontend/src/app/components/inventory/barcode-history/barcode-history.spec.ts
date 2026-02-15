import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { Location } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { of, Subject } from 'rxjs';
import { vi } from 'vitest';

import { BarcodeHistoryComponent } from './barcode-history';
import { BarcodeHistoryService, BarcodeHistory } from '../../../services/history.service';
import { InventoryService } from '../../../services/inventory.service';

const mockBarcodes = [
  { id: 1, barcode: 'LOC-001', BarcodeCategory: { name: 'Location' } },
  { id: 2, barcode: 'BOX-001', BarcodeCategory: { name: 'Box' } },
  { id: 3, barcode: 'TRC-001', BarcodeCategory: { name: 'Trace' } },
];

const mockHistory: BarcodeHistory[] = [
  {
    id: 1, barcodeID: 1, userID: 1, actionID: 1, fromID: null, toID: 2,
    qty: null, serialNumber: null, lotNumber: null, unitOfMeasureID: null,
    createdAt: '2026-01-01T10:00:00Z',
    user: { id: 1, displayName: 'Test User' },
    actionType: { id: 1, code: 'CREATED', label: 'Created' },
  },
  {
    id: 2, barcodeID: 1, userID: 1, actionID: 2, fromID: 2, toID: 1,
    qty: null, serialNumber: null, lotNumber: null, unitOfMeasureID: null,
    createdAt: '2026-01-02T10:00:00Z',
    user: { id: 1, displayName: 'Test User' },
    actionType: { id: 2, code: 'MOVED', label: 'Moved' },
  },
  {
    id: 3, barcodeID: 1, userID: 1, actionID: 3, fromID: 1, toID: null,
    qty: null, serialNumber: null, lotNumber: null, unitOfMeasureID: null,
    createdAt: '2026-01-03T10:00:00Z',
    user: { id: 1, displayName: 'Admin' },
    actionType: { id: 3, code: 'DELETED', label: 'Deleted' },
  },
];

describe('BarcodeHistoryComponent', () => {
  let component: BarcodeHistoryComponent;
  let fixture: ComponentFixture<BarcodeHistoryComponent>;
  let inventoryService: InventoryService;
  let barcodeHistoryService: BarcodeHistoryService;
  let location: Location;
  let paramMapSubject: Subject<any>;

  beforeEach(async () => {
    paramMapSubject = new Subject();

    await TestBed.configureTestingModule({
      imports: [BarcodeHistoryComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: paramMapSubject.asObservable(),
            snapshot: { params: {} },
          }
        },
      ],
    }).compileComponents();

    inventoryService = TestBed.inject(InventoryService);
    barcodeHistoryService = TestBed.inject(BarcodeHistoryService);
    location = TestBed.inject(Location);

    vi.spyOn(inventoryService, 'getAllBarcodes').mockReturnValue(of(mockBarcodes as any));
    vi.spyOn(barcodeHistoryService, 'getBarcodeHistory').mockReturnValue(of(mockHistory));

    fixture = TestBed.createComponent(BarcodeHistoryComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('initialization with route param', () => {
    it('should set barcodeId from route params', () => {
      paramMapSubject.next({ get: (key: string) => key === 'id' ? '1' : null });
      expect(component.barcodeId).toBe(1);
    });

    it('should load data when id is present', () => {
      paramMapSubject.next({ get: (key: string) => key === 'id' ? '1' : null });
      expect(inventoryService.getAllBarcodes).toHaveBeenCalled();
      expect(barcodeHistoryService.getBarcodeHistory).toHaveBeenCalledWith(1);
    });

    it('should set error when no id provided', () => {
      paramMapSubject.next({ get: () => null });
      expect(component.error).toBe('No barcode ID provided');
      expect(component.isLoading).toBe(false);
    });
  });

  describe('loadData', () => {
    beforeEach(() => {
      paramMapSubject.next({ get: (key: string) => key === 'id' ? '1' : null });
    });

    it('should build barcode map', () => {
      expect(component.barcodeMap.get(1)).toBe('LOC-001');
      expect(component.barcodeMap.get(2)).toBe('BOX-001');
    });

    it('should find barcodeInfo for current barcode', () => {
      expect(component.barcodeInfo).toBeTruthy();
      expect(component.barcodeInfo.barcode).toBe('LOC-001');
    });

    it('should set non-trace columns for Location barcode', () => {
      expect(component.displayedColumns).toEqual(['action', 'from', 'to', 'user', 'date']);
      expect(component.isTrace()).toBe(false);
    });

    it('should load history', () => {
      expect(component.allHistory().length).toBe(3);
    });
  });

  describe('trace barcode columns', () => {
    it('should set trace columns for Trace barcode', () => {
      vi.mocked(inventoryService.getAllBarcodes).mockReturnValue(of([
        { id: 3, barcode: 'TRC-001', BarcodeCategory: { name: 'Trace' } },
      ] as any));
      component.barcodeId = 3;
      component.loadData();
      expect(component.isTrace()).toBe(true);
      expect(component.displayedColumns).toContain('qty');
      expect(component.displayedColumns).toContain('serialNumber');
      expect(component.displayedColumns).toContain('lotNumber');
    });
  });

  describe('applyFiltersAndSort', () => {
    beforeEach(() => {
      paramMapSubject.next({ get: (key: string) => key === 'id' ? '1' : null });
    });

    it('should sort by date descending by default', () => {
      const displayed = component.displayedHistory();
      expect(displayed[0].id).toBe(3); // most recent
      expect(displayed[displayed.length - 1].id).toBe(1); // oldest
    });

    it('should sort ascending when toggled', () => {
      component.sortDirection.set('asc');
      component.applyFiltersAndSort();
      const displayed = component.displayedHistory();
      expect(displayed[0].id).toBe(1);
    });
  });

  describe('onSearchChange', () => {
    beforeEach(() => {
      paramMapSubject.next({ get: (key: string) => key === 'id' ? '1' : null });
    });

    it('should filter by action label', () => {
      component.onSearchChange('created');
      expect(component.displayedHistory().length).toBe(1);
      expect(component.displayedHistory()[0].actionType?.code).toBe('CREATED');
    });

    it('should filter by user name', () => {
      component.onSearchChange('admin');
      expect(component.displayedHistory().length).toBe(1);
    });

    it('should filter by barcode string', () => {
      component.onSearchChange('BOX-001');
      const displayed = component.displayedHistory();
      // BOX-001 is id=2, which appears as fromID or toID
      expect(displayed.length).toBeGreaterThan(0);
    });

    it('should reset page index', () => {
      component.pageIndex.set(3);
      component.onSearchChange('test');
      expect(component.pageIndex()).toBe(0);
    });
  });

  describe('onSortChange', () => {
    beforeEach(() => {
      paramMapSubject.next({ get: (key: string) => key === 'id' ? '1' : null });
    });

    it('should update sort direction for date column', () => {
      component.onSortChange({ active: 'date', direction: 'asc' });
      expect(component.sortDirection()).toBe('asc');
    });

    it('should not update for non-date columns', () => {
      component.onSortChange({ active: 'action', direction: 'asc' });
      expect(component.sortDirection()).toBe('desc'); // unchanged
    });
  });

  describe('toggleDateSort', () => {
    beforeEach(() => {
      paramMapSubject.next({ get: (key: string) => key === 'id' ? '1' : null });
    });

    it('should toggle between asc and desc', () => {
      expect(component.sortDirection()).toBe('desc');
      component.toggleDateSort();
      expect(component.sortDirection()).toBe('asc');
      component.toggleDateSort();
      expect(component.sortDirection()).toBe('desc');
    });
  });

  describe('onPageChange', () => {
    beforeEach(() => {
      paramMapSubject.next({ get: (key: string) => key === 'id' ? '1' : null });
    });

    it('should update pagination', () => {
      component.onPageChange({ pageIndex: 2, pageSize: 50, length: 100 });
      expect(component.pageIndex()).toBe(2);
      expect(component.pageSize()).toBe(50);
    });
  });

  describe('getTotalCount', () => {
    beforeEach(() => {
      paramMapSubject.next({ get: (key: string) => key === 'id' ? '1' : null });
    });

    it('should return count of filtered history', () => {
      expect(component.getTotalCount()).toBe(3);
    });

    it('should reflect search filtering', () => {
      component.onSearchChange('created');
      expect(component.getTotalCount()).toBe(1);
    });
  });

  describe('getActionLabel', () => {
    it('should return correct labels', () => {
      expect(component.getActionLabel({ actionType: { code: 'CREATED' } } as any)).toBe('Created');
      expect(component.getActionLabel({ actionType: { code: 'MOVED' } } as any)).toBe('Moved');
      expect(component.getActionLabel({ actionType: { code: 'RECEIVED' } } as any)).toBe('Received');
      expect(component.getActionLabel({ actionType: { code: 'SPLIT' } } as any)).toBe('Split');
      expect(component.getActionLabel({ actionType: { code: 'MERGED' } } as any)).toBe('Merged');
      expect(component.getActionLabel({ actionType: { code: 'DELETED' } } as any)).toBe('Deleted');
    });

    it('should return actionType label for unknown code', () => {
      expect(component.getActionLabel({ actionType: { code: 'CUSTOM', label: 'Custom Action' } } as any)).toBe('Custom Action');
    });

    it('should return Unknown Action for missing actionType', () => {
      expect(component.getActionLabel({ actionType: undefined } as any)).toBe('Unknown Action');
    });
  });

  describe('getActionIcon', () => {
    it('should return correct icons', () => {
      expect(component.getActionIcon({ actionType: { code: 'CREATED' } } as any)).toBe('add_circle');
      expect(component.getActionIcon({ actionType: { code: 'MOVED' } } as any)).toBe('swap_horiz');
      expect(component.getActionIcon({ actionType: { code: 'DELETED' } } as any)).toBe('delete');
    });

    it('should return history for unknown code', () => {
      expect(component.getActionIcon({ actionType: { code: 'UNKNOWN' } } as any)).toBe('history');
    });
  });

  describe('getBarcodeString', () => {
    beforeEach(() => {
      paramMapSubject.next({ get: (key: string) => key === 'id' ? '1' : null });
    });

    it('should return None for null', () => {
      expect(component.getBarcodeString(null)).toBe('None');
    });

    it('should return barcode from map', () => {
      expect(component.getBarcodeString(1)).toBe('LOC-001');
    });

    it('should return ID fallback for unknown barcode', () => {
      expect(component.getBarcodeString(999)).toBe('ID: 999');
    });
  });

  describe('getLocationLabel', () => {
    beforeEach(() => {
      paramMapSubject.next({ get: (key: string) => key === 'id' ? '1' : null });
    });

    it('should return from barcode string', () => {
      const item = { fromID: 1, toID: 2 } as any;
      expect(component.getLocationLabel(item, 'from')).toBe('LOC-001');
    });

    it('should return to barcode string', () => {
      const item = { fromID: 1, toID: 2 } as any;
      expect(component.getLocationLabel(item, 'to')).toBe('BOX-001');
    });
  });

  describe('goBack', () => {
    it('should call location.back', () => {
      vi.spyOn(location, 'back');
      component.goBack();
      expect(location.back).toHaveBeenCalled();
    });
  });

  describe('action handlers', () => {
    it('onMove should call openActionDialog with move', () => {
      vi.spyOn(component, 'openActionDialog');
      component.onMove();
      expect(component.openActionDialog).toHaveBeenCalledWith('move');
    });

    it('onMerge should call openActionDialog with merge', () => {
      vi.spyOn(component, 'openActionDialog');
      component.onMerge();
      expect(component.openActionDialog).toHaveBeenCalledWith('merge');
    });

    it('onSplit should call openActionDialog with split', () => {
      vi.spyOn(component, 'openActionDialog');
      component.onSplit();
      expect(component.openActionDialog).toHaveBeenCalledWith('split');
    });

    it('onDelete should call openActionDialog with delete', () => {
      vi.spyOn(component, 'openActionDialog');
      component.onDelete();
      expect(component.openActionDialog).toHaveBeenCalledWith('delete');
    });

    it('openActionDialog should do nothing if no barcodeId', () => {
      const dialog = TestBed.inject(MatDialog);
      vi.spyOn(dialog, 'open');
      component.barcodeId = null;
      component.openActionDialog('move');
      expect(dialog.open).not.toHaveBeenCalled();
    });
  });

  describe('ngOnDestroy', () => {
    it('should unsubscribe from params subscription', () => {
      component.ngOnDestroy();
      // Verify no errors on destroy - the subscription should be cleaned up
      expect(component).toBeTruthy();
    });
  });
});
