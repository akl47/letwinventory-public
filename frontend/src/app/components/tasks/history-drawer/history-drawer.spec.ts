import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HistoryDrawer } from './history-drawer';

describe('HistoryDrawer', () => {
  let component: HistoryDrawer;
  let fixture: ComponentFixture<HistoryDrawer>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HistoryDrawer]
    })
    .compileComponents();

    fixture = TestBed.createComponent(HistoryDrawer);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
