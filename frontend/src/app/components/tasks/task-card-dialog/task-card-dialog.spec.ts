import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TaskCardDialog } from './task-card-dialog';

describe('TaskCardDialog', () => {
  let component: TaskCardDialog;
  let fixture: ComponentFixture<TaskCardDialog>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaskCardDialog]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TaskCardDialog);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
