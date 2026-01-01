import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PartsTableView } from './parts-table-view';

describe('PartsTableView', () => {
  let component: PartsTableView;
  let fixture: ComponentFixture<PartsTableView>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PartsTableView]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PartsTableView);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
