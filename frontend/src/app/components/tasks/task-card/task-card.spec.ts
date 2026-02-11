import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { TaskCard } from './task-card';

describe('TaskCard', () => {
  let component: TaskCard;
  let fixture: ComponentFixture<TaskCard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaskCard],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TaskCard);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('task', { id: 1, name: 'Test', doneFlag: false, taskListID: 1 });
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should display checklist badge when task has checklist items', () => {
    fixture.componentRef.setInput('task', {
      id: 2, name: 'CL Task', doneFlag: false, taskListID: 1,
      checklist: [
        { id: 'a', text: 'Item 1', checked: true },
        { id: 'b', text: 'Item 2', checked: false },
      ]
    });
    fixture.detectChanges();
    expect(component.checklistProgress()).toBe('1/2');
  });

  it('should not display checklist badge when no checklist', () => {
    fixture.componentRef.setInput('task', { id: 3, name: 'No CL', doneFlag: false, taskListID: 1 });
    fixture.detectChanges();
    expect(component.checklistProgress()).toBeNull();
  });
});
