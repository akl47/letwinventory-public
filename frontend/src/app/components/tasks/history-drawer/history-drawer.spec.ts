import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HistoryDrawerComponent } from './history-drawer';

describe('HistoryDrawerComponent', () => {
  let component: HistoryDrawerComponent;
  let fixture: ComponentFixture<HistoryDrawerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HistoryDrawerComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(HistoryDrawerComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
