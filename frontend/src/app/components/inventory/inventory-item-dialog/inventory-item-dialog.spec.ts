import { ComponentFixture, TestBed } from '@angular/core/testing';

import { InventoryItemDialog } from './inventory-item-dialog';

describe('InventoryItemDialog', () => {
  let component: InventoryItemDialog;
  let fixture: ComponentFixture<InventoryItemDialog>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InventoryItemDialog]
    })
    .compileComponents();

    fixture = TestBed.createComponent(InventoryItemDialog);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
