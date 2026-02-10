import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';

import { InventoryHigherarchyItem } from './inventory-higherarchy-item';

describe('InventoryHigherarchyItem', () => {
  let component: InventoryHigherarchyItem;
  let fixture: ComponentFixture<InventoryHigherarchyItem>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InventoryHigherarchyItem],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InventoryHigherarchyItem);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('item', { id: 1, name: 'test', type: 'Location', barcode: 'LOC-001', parentBarcodeID: 0, children: [] });
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
