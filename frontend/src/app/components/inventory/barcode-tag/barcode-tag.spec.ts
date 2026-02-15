import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { BarcodeTag } from './barcode-tag';
import { BarcodeDialog } from '../barcode-dialog/barcode-dialog';

describe('BarcodeTag', () => {
  let component: BarcodeTag;
  let fixture: ComponentFixture<BarcodeTag>;
  let dialog: MatDialog;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BarcodeTag],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
      ],
    }).compileComponents();

    dialog = TestBed.inject(MatDialog);

    fixture = TestBed.createComponent(BarcodeTag);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('barcode', 'LOC-001');
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should have barcode input set', () => {
    expect(component.barcode).toBe('LOC-001');
  });

  describe('openBarcodeDialog', () => {
    it('should stop event propagation', () => {
      const event = new MouseEvent('click');
      vi.spyOn(event, 'stopPropagation');
      vi.spyOn(dialog, 'open').mockReturnValue({
        afterClosed: () => of(null)
      } as MatDialogRef<BarcodeDialog>);

      component.openBarcodeDialog(event);
      expect(event.stopPropagation).toHaveBeenCalled();
    });

    it('should emit barcodeClicked', () => {
      vi.spyOn(component.barcodeClicked, 'emit');
      vi.spyOn(dialog, 'open').mockReturnValue({
        afterClosed: () => of(null)
      } as MatDialogRef<BarcodeDialog>);

      component.openBarcodeDialog(new MouseEvent('click'));
      expect(component.barcodeClicked.emit).toHaveBeenCalled();
    });

    it('should open BarcodeDialog with correct data', () => {
      vi.spyOn(dialog, 'open').mockReturnValue({
        afterClosed: () => of(null)
      } as MatDialogRef<BarcodeDialog>);

      component.openBarcodeDialog(new MouseEvent('click'));
      expect(dialog.open).toHaveBeenCalledWith(BarcodeDialog, {
        data: { barcode: 'LOC-001' }
      });
    });

    it('should emit dataChanged when dialog returns truthy result', () => {
      vi.spyOn(component.dataChanged, 'emit');
      vi.spyOn(dialog, 'open').mockReturnValue({
        afterClosed: () => of(true)
      } as MatDialogRef<BarcodeDialog>);

      component.openBarcodeDialog(new MouseEvent('click'));
      expect(component.dataChanged.emit).toHaveBeenCalled();
    });

    it('should not emit dataChanged when dialog returns falsy', () => {
      vi.spyOn(component.dataChanged, 'emit');
      vi.spyOn(dialog, 'open').mockReturnValue({
        afterClosed: () => of(null)
      } as MatDialogRef<BarcodeDialog>);

      component.openBarcodeDialog(new MouseEvent('click'));
      expect(component.dataChanged.emit).not.toHaveBeenCalled();
    });
  });
});
