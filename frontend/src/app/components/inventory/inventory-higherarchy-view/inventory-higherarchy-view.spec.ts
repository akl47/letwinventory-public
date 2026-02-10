import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';

import { InventoryHigherarchyView } from './inventory-higherarchy-view';

describe('InventoryHigherarchyView', () => {
  let component: InventoryHigherarchyView;
  let fixture: ComponentFixture<InventoryHigherarchyView>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InventoryHigherarchyView],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InventoryHigherarchyView);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
