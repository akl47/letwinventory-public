import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BarcodeDisplayDialogComponent } from './barcode-display-dialog.component';

describe('BarcodeDisplayDialogComponent', () => {
  let component: BarcodeDisplayDialogComponent;
  let fixture: ComponentFixture<BarcodeDisplayDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ BarcodeDisplayDialogComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(BarcodeDisplayDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
