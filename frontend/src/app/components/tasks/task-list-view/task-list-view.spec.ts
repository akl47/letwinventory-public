import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TaskListView } from './task-list-view';

describe('TaskListView', () => {
  let component: TaskListView;
  let fixture: ComponentFixture<TaskListView>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaskListView]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TaskListView);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
