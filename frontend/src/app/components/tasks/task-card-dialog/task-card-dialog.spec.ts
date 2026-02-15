import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideNativeDateAdapter } from '@angular/material/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { TaskCardDialog } from './task-card-dialog';
import { TaskService } from '../../../services/task.service';
import { ProjectService } from '../../../services/project.service';

describe('TaskCardDialog', () => {
  let component: TaskCardDialog;
  let fixture: ComponentFixture<TaskCardDialog>;
  let taskService: TaskService;

  const baseTask = {
    id: 1, name: 'Test Task', doneFlag: false, taskListID: 1,
    ownerUserID: 1, projectID: null as any, rank: 1000, taskTypeEnum: 'normal' as const,
    activeFlag: true, createdAt: new Date(), updatedAt: new Date(),
    completeWithChildren: false
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaskCardDialog],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideAnimationsAsync(), provideNativeDateAdapter(), provideRouter([]),
        { provide: MAT_DIALOG_DATA, useValue: { task: baseTask } },
        { provide: MatDialogRef, useValue: {} },
      ],
    }).compileComponents();

    taskService = TestBed.inject(TaskService);
    const projectService = TestBed.inject(ProjectService);
    vi.spyOn(taskService, 'getTaskTypes').mockReturnValue(of([]));
    vi.spyOn(taskService, 'getTaskLists').mockReturnValue(of([]));
    vi.spyOn(taskService, 'getSubtasks').mockReturnValue(of([]));
    vi.spyOn(taskService, 'getAllTasks').mockReturnValue(of([]));
    vi.spyOn(projectService, 'getProjects').mockReturnValue(of([]));

    fixture = TestBed.createComponent(TaskCardDialog);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('checklist computed properties', () => {
    it('should return empty checklist by default', () => {
      expect(component.checklist()).toEqual([]);
    });

    it('should return progress string', () => {
      component.task.set({
        ...baseTask,
        checklist: [
          { id: 'x1', text: 'First', checked: false },
          { id: 'x2', text: 'Second', checked: true },
        ]
      });
      expect(component.checklistProgress()).toBe('1/2');
      expect(component.checklistProgressPercent()).toBe(50);
    });

    it('should return empty string for no items', () => {
      expect(component.checklistProgress()).toBe('');
      expect(component.checklistProgressPercent()).toBe(0);
    });
  });

  describe('currentListName', () => {
    it('should return list name when found', () => {
      component.taskLists.set([{ id: 1, name: 'To Do' } as any]);
      expect(component.currentListName()).toBe('To Do');
    });

    it('should return empty string when list not found', () => {
      component.taskLists.set([{ id: 99, name: 'Other' } as any]);
      expect(component.currentListName()).toBe('');
    });
  });

  describe('currentProject', () => {
    it('should return matching project', () => {
      component.task.set({ ...baseTask, projectID: 5 });
      component.projects.set([{ id: 5, name: 'Proj A' } as any]);
      expect(component.currentProject()?.name).toBe('Proj A');
    });

    it('should return undefined when no project assigned', () => {
      expect(component.currentProject()).toBeUndefined();
    });
  });

  describe('filteredAvailableTasks', () => {
    it('should filter tasks by search query', () => {
      component.availableTasks.set([
        { id: 10, name: 'Build frontend' } as any,
        { id: 11, name: 'Fix backend' } as any,
        { id: 12, name: 'Build API' } as any,
      ]);
      component.searchQuery.set('build');
      const filtered = component.filteredAvailableTasks();
      expect(filtered.length).toBe(2);
      expect(filtered.map(t => t.id)).toEqual([10, 12]);
    });
  });

  describe('addChecklistItem', () => {
    it('should add item and clear draft', () => {
      vi.spyOn(taskService, 'updateTask').mockReturnValue(of(baseTask as any));
      vi.spyOn(taskService, 'triggerRefresh');

      component.checklistDraft.set('New item');
      component.addChecklistItem();

      expect(component.checklist().length).toBe(1);
      expect(component.checklist()[0].text).toBe('New item');
      expect(component.checklist()[0].checked).toBe(false);
      expect(component.checklistDraft()).toBe('');
    });

    it('should not add empty item', () => {
      vi.spyOn(taskService, 'updateTask');
      component.checklistDraft.set('   ');
      component.addChecklistItem();
      expect(taskService.updateTask).not.toHaveBeenCalled();
    });
  });

  describe('toggleChecklistItem', () => {
    it('should toggle checked state', () => {
      vi.spyOn(taskService, 'updateTask').mockReturnValue(of(baseTask as any));
      vi.spyOn(taskService, 'triggerRefresh');

      component.task.set({
        ...baseTask,
        checklist: [{ id: 'a', text: 'Item', checked: false }]
      });

      component.toggleChecklistItem('a');
      expect(component.checklist()[0].checked).toBe(true);
    });
  });

  describe('deleteChecklistItem', () => {
    it('should remove item from checklist', () => {
      vi.spyOn(taskService, 'updateTask').mockReturnValue(of(baseTask as any));
      vi.spyOn(taskService, 'triggerRefresh');

      component.task.set({
        ...baseTask,
        checklist: [
          { id: 'a', text: 'Item 1', checked: false },
          { id: 'b', text: 'Item 2', checked: true },
        ]
      });

      component.deleteChecklistItem('a');
      expect(component.checklist().length).toBe(1);
      expect(component.checklist()[0].id).toBe('b');
    });
  });

  describe('toggleEditTitle', () => {
    it('should set editing state and draft', () => {
      component.toggleEditTitle();
      expect(component.isEditingTitle()).toBe(true);
      expect(component.titleDraft()).toBe('Test Task');
    });
  });

  describe('updateTitle', () => {
    it('should update title via service', () => {
      vi.spyOn(taskService, 'updateTask').mockReturnValue(of({ ...baseTask, name: 'New Title' } as any));
      vi.spyOn(taskService, 'triggerRefresh');

      component.isEditingTitle.set(true);
      component.titleDraft.set('New Title');
      component.updateTitle();

      expect(taskService.updateTask).toHaveBeenCalledWith(1, { name: 'New Title' });
      expect(component.isEditingTitle()).toBe(false);
    });

    it('should cancel when title is empty', () => {
      vi.spyOn(taskService, 'updateTask');
      component.isEditingTitle.set(true);
      component.titleDraft.set('');
      component.updateTitle();

      expect(taskService.updateTask).not.toHaveBeenCalled();
      expect(component.isEditingTitle()).toBe(false);
    });

    it('should cancel when title unchanged', () => {
      vi.spyOn(taskService, 'updateTask');
      component.isEditingTitle.set(true);
      component.titleDraft.set('Test Task');
      component.updateTitle();

      expect(taskService.updateTask).not.toHaveBeenCalled();
    });
  });

  describe('description editing', () => {
    it('should toggle edit description', () => {
      component.toggleEditDescription();
      expect(component.isEditingDescription()).toBe(true);
    });

    it('should cancel edit description', () => {
      component.isEditingDescription.set(true);
      component.cancelEditDescription();
      expect(component.isEditingDescription()).toBe(false);
    });

    it('should save description', () => {
      vi.spyOn(taskService, 'updateTask').mockReturnValue(of({ ...baseTask, description: 'New desc' } as any));
      vi.spyOn(taskService, 'triggerRefresh');

      component.descriptionDraft.set('New desc');
      component.saveDescription();

      expect(taskService.updateTask).toHaveBeenCalledWith(1, { description: 'New desc' });
    });
  });

  describe('formatEstimate', () => {
    it('should return empty for undefined', () => {
      expect(component.formatEstimate(undefined)).toBe('');
    });

    it('should format minutes', () => {
      expect(component.formatEstimate(45)).toBe('45m');
    });

    it('should format hours', () => {
      expect(component.formatEstimate(60)).toBe('1h');
    });

    it('should format hours and minutes', () => {
      expect(component.formatEstimate(90)).toBe('1h 30m');
    });

    it('should format days', () => {
      expect(component.formatEstimate(1440)).toBe('1 day');
      expect(component.formatEstimate(4320)).toBe('3 days');
    });

    it('should format weeks', () => {
      expect(component.formatEstimate(10080)).toBe('1 week');
    });

    it('should format months', () => {
      expect(component.formatEstimate(43200)).toBe('1 month');
    });
  });

  describe('formatReminder', () => {
    it('should return empty for no value', () => {
      expect(component.formatReminder(undefined)).toBe('');
    });

    it('should format minutes', () => {
      expect(component.formatReminder(30)).toBe('30m before');
    });

    it('should format hours', () => {
      expect(component.formatReminder(60)).toBe('1h before');
    });

    it('should format days', () => {
      expect(component.formatReminder(1440)).toBe('1d before');
    });
  });

  describe('isDueToday', () => {
    it('should return false with no due date', () => {
      expect(component.isDueToday()).toBe(false);
    });

    it('should return true for today', () => {
      component.task.set({ ...baseTask, dueDate: new Date().toISOString() as any });
      expect(component.isDueToday()).toBe(true);
    });
  });

  describe('isOverdue', () => {
    it('should return false with no due date', () => {
      expect(component.isOverdue()).toBe(false);
    });

    it('should return true for past date', () => {
      component.task.set({ ...baseTask, dueDate: '2020-01-01' as any });
      expect(component.isOverdue()).toBe(true);
    });
  });

  describe('moveToList', () => {
    it('should call moveTask when list changes', () => {
      vi.spyOn(taskService, 'moveTask').mockReturnValue(of({} as any));
      vi.spyOn(taskService, 'triggerRefresh');

      component.moveToList({ id: 2, name: 'Done' } as any);

      expect(taskService.moveTask).toHaveBeenCalledWith(1, 2, 0);
    });

    it('should skip when same list', () => {
      vi.spyOn(taskService, 'moveTask');
      component.moveToList({ id: 1, name: 'Same' } as any);
      expect(taskService.moveTask).not.toHaveBeenCalled();
    });
  });

  describe('selectProject', () => {
    it('should update project', () => {
      vi.spyOn(taskService, 'updateTask').mockReturnValue(of({ ...baseTask, projectID: 5 } as any));
      vi.spyOn(taskService, 'triggerRefresh');

      component.selectProject({ id: 5, name: 'P' } as any);

      expect(taskService.updateTask).toHaveBeenCalledWith(1, { projectID: 5 as any });
    });

    it('should clear project when null passed', () => {
      component.task.set({ ...baseTask, projectID: 5 });
      vi.spyOn(taskService, 'updateTask').mockReturnValue(of({ ...baseTask, projectID: null } as any));
      vi.spyOn(taskService, 'triggerRefresh');

      component.selectProject(null);

      expect(taskService.updateTask).toHaveBeenCalledWith(1, { projectID: null as any });
    });
  });

  describe('toggleSubtasks/toggleChecklist', () => {
    it('should show subtasks panel', () => {
      expect(component.showSubtasks()).toBe(false);
      component.toggleSubtasks();
      expect(component.showSubtasks()).toBe(true);
    });

    it('should show checklist panel', () => {
      expect(component.showChecklist()).toBe(false);
      component.toggleChecklist();
      expect(component.showChecklist()).toBe(true);
    });
  });

  describe('addSubtask', () => {
    it('should create subtask via service', () => {
      const newTask = { ...baseTask, id: 2, name: 'Sub' };
      vi.spyOn(taskService, 'createTask').mockReturnValue(of(newTask as any));
      vi.spyOn(taskService, 'triggerRefresh');

      component.subtaskDraft.set('Sub');
      component.addSubtask();

      expect(taskService.createTask).toHaveBeenCalled();
      expect(component.subtasks().length).toBe(1);
      expect(component.subtaskDraft()).toBe('');
    });

    it('should not create empty subtask', () => {
      vi.spyOn(taskService, 'createTask');
      component.subtaskDraft.set('');
      component.addSubtask();
      expect(taskService.createTask).not.toHaveBeenCalled();
    });
  });
});
