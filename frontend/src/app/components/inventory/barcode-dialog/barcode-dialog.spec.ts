import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BarcodeDialog } from './barcode-dialog';

describe('BarcodeDialog', () => {
  let component: BarcodeDialog;
  let fixture: ComponentFixture<BarcodeDialog>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BarcodeDialog]
    })
    .compileComponents();

    fixture = TestBed.createComponent(BarcodeDialog);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
