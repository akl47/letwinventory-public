import { ComponentFixture, TestBed } from '@angular/core/testing';

import { InventoryHigherarchyView } from './inventory-higherarchy-view';

describe('InventoryHigherarchyView', () => {
  let component: InventoryHigherarchyView;
  let fixture: ComponentFixture<InventoryHigherarchyView>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InventoryHigherarchyView]
    })
    .compileComponents();

    fixture = TestBed.createComponent(InventoryHigherarchyView);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
