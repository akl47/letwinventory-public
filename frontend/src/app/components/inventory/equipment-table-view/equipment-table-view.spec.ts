import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, ActivatedRoute } from '@angular/router';
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
];

describe('EquipmentTableView', () => {
  let component: EquipmentTableView;
  let fixture: ComponentFixture<EquipmentTableView>;
  let inventoryService: InventoryService;
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
    dialog = TestBed.inject(MatDialog);
    vi.spyOn(inventoryService, 'getAllEquipment').mockReturnValue(of(mockEquipment));

    fixture = TestBed.createComponent(EquipmentTableView);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('creates', () => {
    expect(component).toBeTruthy();
  });

  it('loads equipment on init', () => {
    expect(inventoryService.getAllEquipment).toHaveBeenCalled();
    expect(component.allEquipment().length).toBe(1);
  });

  it('renders via <app-data-table>', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('app-data-table')).toBeTruthy();
  });

  describe('formatDate', () => {
    it('formats valid date', () => {
      const result = component.formatDate('2025-06-01');
      expect(result).toBeTruthy();
      expect(result).not.toBe('-');
    });

    it('returns dash for null', () => {
      expect(component.formatDate(null)).toBe('-');
    });
  });

  describe('dialog methods', () => {
    it('openNewEquipmentDialog opens dialog and reloads on close', () => {
      vi.spyOn(dialog, 'open').mockReturnValue({
        afterClosed: () => of(true),
      } as MatDialogRef<unknown>);
      component.openNewEquipmentDialog();
      expect(dialog.open).toHaveBeenCalled();
      expect(inventoryService.getAllEquipment).toHaveBeenCalledTimes(2);
    });

    it('editEquipment opens dialog with equipment data', () => {
      vi.spyOn(dialog, 'open').mockReturnValue({
        afterClosed: () => of(true),
      } as MatDialogRef<unknown>);
      component.editEquipment(mockEquipment[0]);
      expect(dialog.open).toHaveBeenCalled();
    });
  });
});
