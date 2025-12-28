import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BarcodeTag } from './barcode-tag';

describe('BarcodeTag', () => {
  let component: BarcodeTag;
  let fixture: ComponentFixture<BarcodeTag>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BarcodeTag]
    })
    .compileComponents();

    fixture = TestBed.createComponent(BarcodeTag);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
