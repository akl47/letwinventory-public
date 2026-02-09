import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';

import { BarcodeDialog } from './barcode-dialog';

describe('BarcodeDialog', () => {
  let component: BarcodeDialog;
  let fixture: ComponentFixture<BarcodeDialog>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BarcodeDialog],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
        { provide: MAT_DIALOG_DATA, useValue: { barcode: 'TEST-001' } },
        { provide: MatDialogRef, useValue: {} },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BarcodeDialog);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
