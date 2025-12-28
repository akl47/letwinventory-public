import { ComponentFixture, TestBed } from '@angular/core/testing';

import { InventoryHigherarchyItem } from './inventory-higherarchy-item';

describe('InventoryHigherarchyItem', () => {
  let component: InventoryHigherarchyItem;
  let fixture: ComponentFixture<InventoryHigherarchyItem>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InventoryHigherarchyItem]
    })
    .compileComponents();

    fixture = TestBed.createComponent(InventoryHigherarchyItem);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
