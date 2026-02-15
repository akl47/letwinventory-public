import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { TaskListComponent } from './task-list';
import { TaskService } from '../../../services/task.service';

describe('TaskList', () => {
  let component: TaskListComponent;
  let fixture: ComponentFixture<TaskListComponent>;
  let taskService: TaskService;

  const tasks = [
    { id: 1, name: 'Task 1', doneFlag: false, projectID: 1, parentTaskID: null },
    { id: 2, name: 'Task 2', doneFlag: false, projectID: 2, parentTaskID: null },
    { id: 3, name: 'Task 3', doneFlag: true, projectID: 1, parentTaskID: null },
    { id: 4, name: 'Subtask', doneFlag: false, projectID: 1, parentTaskID: 1 },
    { id: 5, name: 'No Project', doneFlag: false, projectID: null, parentTaskID: null },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaskListComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    taskService = TestBed.inject(TaskService);

    fixture = TestBed.createComponent(TaskListComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('taskList', { id: 1, name: 'Test List', tasks: [...tasks] });
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('updateFilteredTasks', () => {
    it('should exclude done tasks', () => {
      component.updateFilteredTasks();
      expect(component.filteredTasks.find(t => t.id === 3)).toBeUndefined();
    });

    it('should include all non-done tasks by default', () => {
      component.updateFilteredTasks();
      // IDs 1, 2, 4, 5 should be included (3 is done)
      expect(component.filteredTasks.length).toBe(4);
    });

    it('should filter by project IDs when set', () => {
      component.filterProjectIds = [1];
      component.updateFilteredTasks();
      const ids = component.filteredTasks.map(t => t.id);
      expect(ids).toContain(1);
      expect(ids).toContain(4);
      expect(ids).toContain(5); // no project, showNoProject is true
      expect(ids).not.toContain(2); // project 2 not in filter
    });

    it('should hide no-project tasks when showNoProject is false', () => {
      component.showNoProject = false;
      component.updateFilteredTasks();
      expect(component.filteredTasks.find(t => t.id === 5)).toBeUndefined();
    });

    it('should hide subtasks when showChildTasks is false', () => {
      component.showChildTasks = false;
      component.updateFilteredTasks();
      expect(component.filteredTasks.find(t => t.id === 4)).toBeUndefined();
    });
  });

  describe('startAddingTask / cancelAddingTask', () => {
    it('should toggle adding state', () => {
      expect(component['isAddingTask']()).toBe(false);
      component.startAddingTask();
      expect(component['isAddingTask']()).toBe(true);
      component.cancelAddingTask();
      expect(component['isAddingTask']()).toBe(false);
    });

    it('should clear task name on cancel', () => {
      component['newTaskName'] = 'draft';
      component.cancelAddingTask();
      expect(component['newTaskName']).toBe('');
    });
  });

  describe('confirmAddTask', () => {
    it('should create task via service', () => {
      const created = { id: 10, name: 'New Task', taskListID: 1 };
      vi.spyOn(taskService, 'createTask').mockReturnValue(of(created as any));
      vi.spyOn(taskService, 'triggerRefresh');

      component['newTaskName'] = 'New Task';
      component.confirmAddTask();

      expect(taskService.createTask).toHaveBeenCalled();
      expect(taskService.triggerRefresh).toHaveBeenCalled();
    });

    it('should cancel when name is empty', () => {
      vi.spyOn(taskService, 'createTask');
      component['newTaskName'] = '  ';
      component.confirmAddTask();
      expect(taskService.createTask).not.toHaveBeenCalled();
    });
  });

  describe('startEditingTitle / confirmEditTitle / cancelEditingTitle', () => {
    it('should not enter edit mode when not in edit mode', () => {
      component.isEditMode = false;
      component.startEditingTitle();
      expect(component['isEditingTitle']()).toBe(false);
    });

    it('should enter edit mode and copy title', () => {
      component.isEditMode = true;
      component.startEditingTitle();
      expect(component['isEditingTitle']()).toBe(true);
      expect(component['editedTitle']).toBe('Test List');
    });

    it('should emit renamed event on confirm', () => {
      vi.spyOn(component.listRenamed, 'emit');
      component.isEditMode = true;
      component.startEditingTitle();
      component['editedTitle'] = 'New Name';
      component.confirmEditTitle();
      expect(component.listRenamed.emit).toHaveBeenCalledWith('New Name');
      expect(component['isEditingTitle']()).toBe(false);
    });

    it('should cancel when name unchanged', () => {
      vi.spyOn(component.listRenamed, 'emit');
      component.isEditMode = true;
      component.startEditingTitle();
      component.confirmEditTitle(); // same name as 'Test List'
      expect(component.listRenamed.emit).not.toHaveBeenCalled();
    });

    it('should reset on cancel', () => {
      component['isEditingTitle'].set(true);
      component.cancelEditingTitle();
      expect(component['isEditingTitle']()).toBe(false);
    });
  });

  describe('confirmDelete', () => {
    it('should emit listDeleted when confirmed', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      vi.spyOn(component.listDeleted, 'emit');
      const event = new Event('click');
      vi.spyOn(event, 'stopPropagation');

      component.confirmDelete(event);

      expect(event.stopPropagation).toHaveBeenCalled();
      expect(component.listDeleted.emit).toHaveBeenCalled();
    });

    it('should not emit when cancelled', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      vi.spyOn(component.listDeleted, 'emit');

      component.confirmDelete(new Event('click'));

      expect(component.listDeleted.emit).not.toHaveBeenCalled();
    });
  });

  describe('dragDelay', () => {
    it('should have correct touch and mouse delays', () => {
      expect(component.dragDelay).toEqual({ touch: 500, mouse: 0 });
    });
  });
});
