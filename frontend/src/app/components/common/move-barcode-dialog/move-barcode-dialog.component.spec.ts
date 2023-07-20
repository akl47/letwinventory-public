import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MoveBarcodeDialogComponent } from './move-barcode-dialog.component';

describe('MoveBarcodeDialogComponent', () => {
  let component: MoveBarcodeDialogComponent;
  let fixture: ComponentFixture<MoveBarcodeDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ MoveBarcodeDialogComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MoveBarcodeDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
