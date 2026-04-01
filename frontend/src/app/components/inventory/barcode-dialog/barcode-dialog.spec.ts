import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';

import { BarcodeDialog } from './barcode-dialog';
import { InventoryService } from '../../../services/inventory.service';
import { of } from 'rxjs';

describe('BarcodeDialog', () => {
  let component: BarcodeDialog;
  let fixture: ComponentFixture<BarcodeDialog>;
  let dialogRef: any;

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

    const inventoryService = TestBed.inject(InventoryService);
    vi.spyOn(inventoryService, 'lookupBarcode').mockReturnValue(of({ id: 1, barcode: 'LOC-001' } as any));
    vi.spyOn(inventoryService, 'getTagById').mockReturnValue(of({ id: 1, barcode: 'LOC-001', type: 'Location', name: 'Shelf A' } as any));
    vi.spyOn(inventoryService, 'getTagChain').mockReturnValue(of([]));
    vi.spyOn(inventoryService, 'getBarcodeZPL').mockReturnValue(of('^XA^XZ'));

    fixture = TestBed.createComponent(BarcodeDialog);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should pass barcode to embedded mobile scanner', () => {
    expect(component.data.barcode).toBe('LOC-001');
  });

  it('should expose dialogRef for close events', () => {
    component.dialogRef.close(true);
    expect(dialogRef.close).toHaveBeenCalledWith(true);
  });
});
