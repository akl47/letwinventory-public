import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BarcodeTagComponent } from './barcode-tag.component';

describe('BarcodeTagComponent', () => {
  let component: BarcodeTagComponent;
  let fixture: ComponentFixture<BarcodeTagComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ BarcodeTagComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(BarcodeTagComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
