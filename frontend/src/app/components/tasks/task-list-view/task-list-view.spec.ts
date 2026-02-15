import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, Router } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { TaskListViewComponent } from './task-list-view';
import { TaskService } from '../../../services/task.service';
import { TaskViewPreferencesService } from '../../../services/task-view-preferences.service';

describe('TaskListViewComponent', () => {
  let component: TaskListViewComponent;
  let fixture: ComponentFixture<TaskListViewComponent>;
  let taskService: TaskService;
  let preferencesService: TaskViewPreferencesService;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaskListViewComponent],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideAnimationsAsync(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { queryParams: of({}), snapshot: { queryParams: {} } } },
      ],
    }).compileComponents();

    taskService = TestBed.inject(TaskService);
    preferencesService = TestBed.inject(TaskViewPreferencesService);
    router = TestBed.inject(Router);

    vi.spyOn(taskService, 'getTaskLists').mockReturnValue(of([]));

    fixture = TestBed.createComponent(TaskListViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('initial state', () => {
    it('should have history closed', () => {
      expect(component.isHistoryOpen()).toBe(false);
    });

    it('should not be in edit mode', () => {
      expect(component.isEditMode()).toBe(false);
    });

    it('should not be adding list', () => {
      expect(component.isAddingList()).toBe(false);
    });

    it('should show child tasks', () => {
      expect(component.showChildTasks()).toBe(true);
    });

    it('should show no-project tasks', () => {
      expect(component.showNoProject()).toBe(true);
    });
  });

  describe('toggleHistory', () => {
    it('should toggle history open state', () => {
      component.toggleHistory();
      expect(component.isHistoryOpen()).toBe(true);
      component.toggleHistory();
      expect(component.isHistoryOpen()).toBe(false);
    });
  });

  describe('toggleEditMode', () => {
    it('should enter edit mode', () => {
      component.toggleEditMode();
      expect(component.isEditMode()).toBe(true);
    });

    it('should trigger refresh when exiting edit mode', () => {
      vi.spyOn(taskService, 'triggerRefresh');
      component.isEditMode.set(true);
      component.toggleEditMode();
      expect(component.isEditMode()).toBe(false);
      expect(taskService.triggerRefresh).toHaveBeenCalled();
    });

    it('should reset add list state when exiting edit mode', () => {
      component.isEditMode.set(true);
      component.isAddingList.set(true);
      component.newListName = 'draft';
      vi.spyOn(taskService, 'triggerRefresh');
      component.toggleEditMode();
      expect(component.isAddingList()).toBe(false);
      expect(component.newListName).toBe('');
    });
  });

  describe('startAddingList / cancelAddingList', () => {
    it('should set adding list state', () => {
      component.startAddingList();
      expect(component.isAddingList()).toBe(true);
    });

    it('should cancel and clear name', () => {
      component.isAddingList.set(true);
      component.newListName = 'draft';
      component.cancelAddingList();
      expect(component.isAddingList()).toBe(false);
      expect(component.newListName).toBe('');
    });
  });

  describe('confirmAddList', () => {
    it('should create list via service', () => {
      vi.spyOn(taskService, 'createTaskList').mockReturnValue(of({} as any));
      vi.spyOn(taskService, 'triggerRefresh');

      component.newListName = 'New List';
      component.confirmAddList();

      expect(taskService.createTaskList).toHaveBeenCalledWith({ name: 'New List' });
    });

    it('should cancel for empty name', () => {
      vi.spyOn(taskService, 'createTaskList');
      component.newListName = '  ';
      component.confirmAddList();
      expect(taskService.createTaskList).not.toHaveBeenCalled();
    });
  });

  describe('onListRenamed', () => {
    it('should call updateTaskList', () => {
      vi.spyOn(taskService, 'updateTaskList').mockReturnValue(of({} as any));
      vi.spyOn(taskService, 'triggerRefresh');
      component.onListRenamed(1, 'Renamed');
      expect(taskService.updateTaskList).toHaveBeenCalledWith(1, { name: 'Renamed' });
    });
  });

  describe('onListDeleted', () => {
    it('should call deleteTaskList and remove from local', () => {
      vi.spyOn(taskService, 'deleteTaskList').mockReturnValue(of({} as any));
      vi.spyOn(taskService, 'triggerRefresh');
      // Mock getTaskLists to return the remaining list after refresh
      vi.spyOn(taskService, 'getTaskLists').mockReturnValue(of([{ id: 2, name: 'L2' }] as any));
      component.taskListsLocal.set([{ id: 1, name: 'L1' }, { id: 2, name: 'L2' }] as any);

      component.onListDeleted(1);

      expect(taskService.deleteTaskList).toHaveBeenCalledWith(1);
      expect(component.taskListsLocal().length).toBe(1);
    });
  });

  describe('filter handlers', () => {
    it('should update selected project IDs on filter change', () => {
      vi.spyOn(router, 'navigate');
      component.onProjectFilterChanged([1, 2]);
      expect(component.selectedProjectIds()).toEqual([1, 2]);
    });

    it('should update showNoProject', () => {
      vi.spyOn(router, 'navigate');
      component.onShowNoProjectChanged(false);
      expect(component.showNoProject()).toBe(false);
    });

    it('should update showChildTasks', () => {
      vi.spyOn(router, 'navigate');
      component.onShowChildTasksChanged(false);
      expect(component.showChildTasks()).toBe(false);
    });
  });

  describe('onSaveAsDefault', () => {
    it('should save current params as default', () => {
      vi.spyOn(preferencesService, 'saveDefaultView');
      component.currentProjectsParam.set('1,2');
      component.currentNoProjectParam.set('true');
      component.currentSubtasksParam.set('false');

      component.onSaveAsDefault();

      expect(preferencesService.saveDefaultView).toHaveBeenCalledWith({
        projects: '1,2',
        noProject: 'true',
        subtasks: 'false'
      });
    });
  });

  describe('onRevertToDefault', () => {
    it('should navigate to tasks with default params', () => {
      vi.spyOn(preferencesService, 'getDefaultViewQueryParams').mockReturnValue({ projects: '1', noProject: 'true', subtasks: 'true' });
      vi.spyOn(router, 'navigate');

      component.onRevertToDefault();

      expect(router.navigate).toHaveBeenCalledWith(['/tasks'], { queryParams: { projects: '1', noProject: 'true', subtasks: 'true' } });
    });
  });

  describe('URL param parsing', () => {
    it('should parse projects from query params', () => {
      // Create component with URL params
      const fixture2 = TestBed.createComponent(TaskListViewComponent);
      const comp2 = fixture2.componentInstance;
      // Manually call the private method
      (comp2 as any).applyUrlParams({ projects: '1,3', noProject: 'false', subtasks: 'false' });

      expect(comp2.selectedProjectIds()).toEqual([1, 3]);
      expect(comp2.showNoProject()).toBe(false);
      expect(comp2.showChildTasks()).toBe(false);
    });

    it('should handle empty projects string', () => {
      (component as any).applyUrlParams({ projects: '' });
      expect(component.selectedProjectIds()).toEqual([]);
    });
  });
});
