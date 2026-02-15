import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialog } from '@angular/material/dialog';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { BarcodeDialog } from './barcode-dialog';
import { InventoryService } from '../../../services/inventory.service';
import { ErrorNotificationService } from '../../../services/error-notification.service';

const mockBarcodes = [
  { id: 1, barcode: 'LOC-001', BarcodeCategory: { name: 'Location' } },
  { id: 2, barcode: 'BOX-001', BarcodeCategory: { name: 'Box' } },
  { id: 3, barcode: 'TRC-001', BarcodeCategory: { name: 'Trace' } },
];

describe('BarcodeDialog', () => {
  let component: BarcodeDialog;
  let fixture: ComponentFixture<BarcodeDialog>;
  let inventoryService: InventoryService;
  let errorNotification: ErrorNotificationService;
  let dialogRef: any;
  let router: Router;

  beforeEach(async () => {
    dialogRef = { close: vi.fn() } as any;

    await TestBed.configureTestingModule({
      imports: [BarcodeDialog],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
        { provide: MAT_DIALOG_DATA, useValue: { barcode: 'LOC-001' } },
        { provide: MatDialogRef, useValue: dialogRef },
      ],
    }).compileComponents();

    inventoryService = TestBed.inject(InventoryService);
    errorNotification = TestBed.inject(ErrorNotificationService);
    router = TestBed.inject(Router);

    vi.spyOn(inventoryService, 'getAllBarcodes').mockReturnValue(of(mockBarcodes as any));
    vi.spyOn(inventoryService, 'getBarcodeZPL').mockReturnValue(of('^XA^FO50,50^A0N,50,50^FDTest^FS^XZ'));

    fixture = TestBed.createComponent(BarcodeDialog);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('initialization', () => {
    it('should set barcode data from dialog data', () => {
      expect(component.data.barcode).toBe('LOC-001');
    });

    it('should fetch barcodes on init', () => {
      expect(inventoryService.getAllBarcodes).toHaveBeenCalled();
    });

    it('should set barcodeId when barcode is found', () => {
      expect(component.barcodeId()).toBe(1);
    });

    it('should set barcodeObject when barcode is found', () => {
      expect(component.barcodeObject()).toBeTruthy();
      expect(component.barcodeObject().barcode).toBe('LOC-001');
    });

    it('should fetch ZPL after finding barcode', () => {
      expect(inventoryService.getBarcodeZPL).toHaveBeenCalledWith(1, '3x1');
    });

    it('should set barcodeImageUrl after rendering', () => {
      expect(component.barcodeImageUrl()).toBeTruthy();
      expect(component.barcodeImageUrl()).toContain('labelary.com');
    });
  });

  describe('barcode not found', () => {
    it('should set error when barcode not in list', async () => {
      vi.mocked(inventoryService.getAllBarcodes).mockReturnValue(of([]));
      component.ngOnInit();
      await fixture.whenStable();
      expect(component.error()).toBe('Barcode not found');
      expect(component.isLoading()).toBe(false);
    });
  });

  describe('fetch error', () => {
    it('should set error on barcodes fetch failure', async () => {
      vi.mocked(inventoryService.getAllBarcodes).mockReturnValue(
        throwError(() => new Error('Network error'))
      );
      component.ngOnInit();
      await fixture.whenStable();
      expect(component.error()).toContain('Failed to fetch barcode');
      expect(component.isLoading()).toBe(false);
    });
  });

  describe('signal defaults', () => {
    it('should have default preview size 3x1', () => {
      expect(component.selectedPreviewSize()).toBe('3x1');
    });

    it('should have default label size 3x1', () => {
      expect(component.selectedLabelSize()).toBe('3x1');
    });

    it('should not show print options by default', () => {
      expect(component.showPrintOptions()).toBe(false);
    });

    it('should not be printing by default', () => {
      expect(component.isPrinting()).toBe(false);
    });
  });

  describe('onPreviewSizeChange', () => {
    it('should re-fetch ZPL with new size', () => {
      component.selectedPreviewSize.set('1.5x1');
      component.onPreviewSizeChange();
      expect(component.isLoading()).toBe(true);
      expect(inventoryService.getBarcodeZPL).toHaveBeenCalledWith(1, '1.5x1');
    });

    it('should do nothing if no barcodeId', () => {
      component.barcodeId.set(null);
      const callCount = vi.mocked(inventoryService.getBarcodeZPL).mock.calls.length;
      component.onPreviewSizeChange();
      expect(vi.mocked(inventoryService.getBarcodeZPL).mock.calls.length).toBe(callCount);
    });
  });

  describe('onImageLoad', () => {
    it('should set isLoading to false', () => {
      component.isLoading.set(true);
      component.onImageLoad();
      expect(component.isLoading()).toBe(false);
    });
  });

  describe('onImageError', () => {
    it('should set error and stop loading', () => {
      component.onImageError();
      expect(component.error()).toBe('Failed to load barcode image from Labelary');
      expect(component.isLoading()).toBe(false);
    });
  });

  describe('togglePrintOptions', () => {
    it('should toggle showPrintOptions', () => {
      expect(component.showPrintOptions()).toBe(false);
      component.togglePrintOptions();
      expect(component.showPrintOptions()).toBe(true);
      component.togglePrintOptions();
      expect(component.showPrintOptions()).toBe(false);
    });
  });

  describe('onLabelSizeToggle', () => {
    it('should set 3x1 when checked is true', () => {
      component.onLabelSizeToggle({ checked: true } as any);
      expect(component.selectedLabelSize()).toBe('3x1');
      expect(component.selectedPreviewSize()).toBe('3x1');
    });

    it('should set 1.5x1 when checked is false', () => {
      component.onLabelSizeToggle({ checked: false } as any);
      expect(component.selectedLabelSize()).toBe('1.5x1');
      expect(component.selectedPreviewSize()).toBe('1.5x1');
    });
  });

  describe('printLabel', () => {
    it('should show error if no barcodeId', () => {
      vi.spyOn(errorNotification, 'showError');
      component.barcodeId.set(null);
      component.printLabel();
      expect(errorNotification.showError).toHaveBeenCalledWith('Barcode ID not found');
    });

    it('should call printBarcode service', () => {
      vi.spyOn(inventoryService, 'printBarcode').mockReturnValue(of({ message: 'Printed' }));
      vi.spyOn(errorNotification, 'showSuccess');
      component.printLabel();
      expect(component.isPrinting()).toBe(false); // resolved
      expect(inventoryService.printBarcode).toHaveBeenCalledWith(1, '3x1');
      expect(errorNotification.showSuccess).toHaveBeenCalled();
    });

    it('should handle print error', () => {
      vi.spyOn(inventoryService, 'printBarcode').mockReturnValue(
        throwError(() => ({ error: { message: 'Printer offline' } }))
      );
      vi.spyOn(errorNotification, 'showHttpError');
      component.printLabel();
      expect(component.isPrinting()).toBe(false);
      expect(errorNotification.showHttpError).toHaveBeenCalled();
    });
  });

  describe('moveBarcode', () => {
    it('should show error if no barcodeId', () => {
      vi.spyOn(errorNotification, 'showError');
      component.barcodeId.set(null);
      component.moveBarcode();
      expect(errorNotification.showError).toHaveBeenCalledWith('Barcode ID not found');
    });
  });

  describe('viewHistory', () => {
    it('should close dialog and navigate', () => {
      vi.spyOn(router, 'navigate');
      component.viewHistory();
      expect(dialogRef.close).toHaveBeenCalled();
      expect(router.navigate).toHaveBeenCalledWith(['/inventory/barcode-history', 1]);
    });

    it('should do nothing if no barcodeId', () => {
      component.barcodeId.set(null);
      vi.spyOn(router, 'navigate');
      component.viewHistory();
      expect(router.navigate).not.toHaveBeenCalled();
    });
  });

  describe('labelSizes', () => {
    it('should have 2 label sizes', () => {
      expect(component.labelSizes.length).toBe(2);
      expect(component.labelSizes[0].value).toBe('3x1');
      expect(component.labelSizes[1].value).toBe('1.5x1');
    });
  });
});
