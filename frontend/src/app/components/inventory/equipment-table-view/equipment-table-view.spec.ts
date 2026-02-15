import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, Router } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { EquipmentTableView } from './equipment-table-view';
import { InventoryService } from '../../../services/inventory.service';
import { Equipment } from '../../../models/equipment.model';

const mockEquipment: Equipment[] = [
  {
    id: 1, name: 'Oscilloscope', description: 'Tektronix 4-ch', serialNumber: 'SN-001',
    commissionDate: '2025-06-01', barcodeID: 10, partID: null, activeFlag: true,
    createdAt: '2025-01-01', updatedAt: '2025-06-01',
    Barcode: { id: 10, barcode: 'EQP-001', barcodeCategoryID: 4, parentBarcodeID: 1, activeFlag: true, createdAt: '', updatedAt: '' },
  },
  {
    id: 2, name: 'Multimeter', description: 'Fluke 87V', serialNumber: 'SN-002',
    commissionDate: '2025-07-01', barcodeID: 11, partID: null, activeFlag: true,
    createdAt: '2025-02-01', updatedAt: '2025-07-01',
    Barcode: { id: 11, barcode: 'EQP-002', barcodeCategoryID: 4, parentBarcodeID: 1, activeFlag: true, createdAt: '', updatedAt: '' },
  },
  {
    id: 3, name: 'Old Scope', description: 'Decommissioned', serialNumber: 'SN-003',
    commissionDate: '2020-01-01', barcodeID: 12, partID: null, activeFlag: false,
    createdAt: '2020-01-01', updatedAt: '2024-12-01',
  },
];

describe('EquipmentTableView', () => {
  let component: EquipmentTableView;
  let fixture: ComponentFixture<EquipmentTableView>;
  let inventoryService: InventoryService;
  let router: Router;
  let dialog: MatDialog;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EquipmentTableView],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { queryParams: of({}), snapshot: { queryParams: {} } } },
      ],
    }).compileComponents();

    inventoryService = TestBed.inject(InventoryService);
    router = TestBed.inject(Router);
    dialog = TestBed.inject(MatDialog);

    vi.spyOn(inventoryService, 'getAllEquipment').mockReturnValue(of(mockEquipment));
    vi.spyOn(router, 'navigate').mockReturnValue(Promise.resolve(true));

    fixture = TestBed.createComponent(EquipmentTableView);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('data loading', () => {
    it('should load equipment on init', () => {
      expect(inventoryService.getAllEquipment).toHaveBeenCalled();
      expect(component.allEquipment().length).toBe(3);
    });

    it('should display only active equipment by default', () => {
      const displayed = component.displayedEquipment();
      expect(displayed.every(e => e.activeFlag === true)).toBe(true);
      expect(displayed.length).toBe(2);
    });
  });

  describe('filtering', () => {
    it('should filter inactive equipment by default', () => {
      expect(component.displayedEquipment().length).toBe(2);
    });

    it('should show inactive when toggle is on', () => {
      component.onToggleInactive(true);
      expect(component.displayedEquipment().length).toBe(3);
    });

    it('should filter by search text matching name', () => {
      component.onSearchChange('oscilloscope');
      expect(component.displayedEquipment().length).toBe(1);
      expect(component.displayedEquipment()[0].name).toBe('Oscilloscope');
    });

    it('should filter by search text matching serial number', () => {
      component.onSearchChange('SN-002');
      expect(component.displayedEquipment().length).toBe(1);
    });

    it('should filter by search text matching barcode', () => {
      component.onSearchChange('EQP-001');
      expect(component.displayedEquipment().length).toBe(1);
    });

    it('should filter by search text matching description', () => {
      component.onSearchChange('fluke');
      expect(component.displayedEquipment().length).toBe(1);
    });

    it('should reset page index on search', () => {
      component.pageIndex.set(3);
      component.onSearchChange('test');
      expect(component.pageIndex()).toBe(0);
    });

    it('should reset page index on toggle inactive', () => {
      component.pageIndex.set(3);
      component.onToggleInactive(true);
      expect(component.pageIndex()).toBe(0);
    });
  });

  describe('sorting', () => {
    it('should update sort state', () => {
      component.onSortChange({ active: 'serialNumber', direction: 'desc' });
      expect(component.sortColumn()).toBe('serialNumber');
      expect(component.sortDirection()).toBe('desc');
    });

    it('default sort should be name asc', () => {
      expect(component.sortColumn()).toBe('name');
      expect(component.sortDirection()).toBe('asc');
    });
  });

  describe('pagination', () => {
    it('onPageChange should update pageIndex and pageSize', () => {
      component.onPageChange({ pageIndex: 2, pageSize: 50, length: 100 });
      expect(component.pageIndex()).toBe(2);
      expect(component.pageSize()).toBe(50);
    });

    it('should have correct pageSizeOptions', () => {
      expect(component.pageSizeOptions).toEqual([5, 10, 25, 50, 100]);
    });
  });

  describe('getTotalCount', () => {
    it('should return count of active equipment', () => {
      expect(component.getTotalCount()).toBe(2);
    });

    it('should return count of all equipment when showing inactive', () => {
      component.showInactive.set(true);
      expect(component.getTotalCount()).toBe(3);
    });

    it('should reflect search filtering', () => {
      component.searchText.set('oscilloscope');
      expect(component.getTotalCount()).toBe(1);
    });
  });

  describe('formatDate', () => {
    it('should format valid date', () => {
      const result = component.formatDate('2025-06-01');
      expect(result).toBeTruthy();
      expect(result).not.toBe('-');
    });

    it('should return dash for null', () => {
      expect(component.formatDate(null)).toBe('-');
    });
  });

  describe('dialog methods', () => {
    it('openNewEquipmentDialog should open dialog and reload on close', () => {
      vi.spyOn(dialog, 'open').mockReturnValue({
        afterClosed: () => of(true)
      } as MatDialogRef<any>);
      component.openNewEquipmentDialog();
      expect(dialog.open).toHaveBeenCalled();
      // getAllEquipment called again (reload)
      expect(inventoryService.getAllEquipment).toHaveBeenCalledTimes(2);
    });

    it('editEquipment should open dialog with equipment data', () => {
      vi.spyOn(dialog, 'open').mockReturnValue({
        afterClosed: () => of(true)
      } as MatDialogRef<any>);
      component.editEquipment(mockEquipment[0]);
      expect(dialog.open).toHaveBeenCalledWith(expect.any(Function), {
        width: '500px',
        data: { equipment: mockEquipment[0] }
      });
    });

    it('should not reload if dialog returns falsy', () => {
      vi.spyOn(dialog, 'open').mockReturnValue({
        afterClosed: () => of(null)
      } as MatDialogRef<any>);
      const callCount = vi.mocked(inventoryService.getAllEquipment).mock.calls.length;
      component.openNewEquipmentDialog();
      expect(vi.mocked(inventoryService.getAllEquipment).mock.calls.length).toBe(callCount);
    });
  });

  describe('displayedColumns', () => {
    it('should have expected columns', () => {
      expect(component.displayedColumns).toEqual(['name', 'serialNumber', 'barcode', 'commissionDate', 'actions']);
    });
  });
});
