import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SubToolbarComponent } from './sub-toolbar';

describe('SubToolbar', () => {
  let component: SubToolbarComponent;
  let fixture: ComponentFixture<SubToolbarComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SubToolbarComponent]
    })
      .compileComponents();

    fixture = TestBed.createComponent(SubToolbarComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
