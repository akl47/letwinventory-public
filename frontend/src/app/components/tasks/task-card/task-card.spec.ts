import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { TaskCard } from './task-card';
import { TaskService } from '../../../services/task.service';
import { ProjectService } from '../../../services/project.service';

describe('TaskCard', () => {
  let component: TaskCard;
  let fixture: ComponentFixture<TaskCard>;
  let taskService: TaskService;
  let projectService: ProjectService;

  const baseTask = {
    id: 1, name: 'Test Task', doneFlag: false, taskListID: 1,
    ownerUserID: 1, projectID: null as any, rank: 1000, taskTypeEnum: 'normal' as const,
    activeFlag: true, createdAt: new Date(), updatedAt: new Date(),
    completeWithChildren: false
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaskCard],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    taskService = TestBed.inject(TaskService);
    projectService = TestBed.inject(ProjectService);
    vi.spyOn(projectService, 'getProjects').mockReturnValue(of([]));

    fixture = TestBed.createComponent(TaskCard);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('task', baseTask);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('checklistProgress', () => {
    it('should return progress string when checklist exists', () => {
      fixture.componentRef.setInput('task', {
        ...baseTask,
        checklist: [
          { id: 'a', text: 'A', checked: true },
          { id: 'b', text: 'B', checked: false },
          { id: 'c', text: 'C', checked: true },
        ]
      });
      fixture.detectChanges();
      expect(component.checklistProgress()).toBe('2/3');
    });

    it('should return null when no checklist', () => {
      expect(component.checklistProgress()).toBeNull();
    });

    it('should return null for empty checklist', () => {
      fixture.componentRef.setInput('task', { ...baseTask, checklist: [] });
      fixture.detectChanges();
      expect(component.checklistProgress()).toBeNull();
    });
  });

  describe('formatEstimate', () => {
    it('should return empty string for undefined', () => {
      expect(component.formatEstimate(undefined)).toBe('');
    });

    it('should format minutes', () => {
      expect(component.formatEstimate(30)).toBe('30m');
    });

    it('should format hours', () => {
      expect(component.formatEstimate(120)).toBe('2h');
    });

    it('should format hours with minutes', () => {
      expect(component.formatEstimate(90)).toBe('1h 30m');
    });

    it('should format 1 day', () => {
      expect(component.formatEstimate(1440)).toBe('1 day');
    });

    it('should format multiple days', () => {
      expect(component.formatEstimate(2880)).toBe('2 days');
    });

    it('should format 1 week', () => {
      expect(component.formatEstimate(10080)).toBe('1 week');
    });

    it('should format multiple weeks', () => {
      expect(component.formatEstimate(20160)).toBe('2 weeks');
    });

    it('should format 1 month', () => {
      expect(component.formatEstimate(43200)).toBe('1 month');
    });
  });

  describe('displayDone', () => {
    it('should return task.doneFlag when no override', () => {
      expect(component.displayDone()).toBe(false);
    });

    it('should return override value when set', () => {
      component.isDoneOverride.set(true);
      expect(component.displayDone()).toBe(true);
    });
  });

  describe('projectColor', () => {
    it('should return null when no projects loaded', () => {
      expect(component.projectColor()).toBeNull();
    });

    it('should return color hex when project matches', () => {
      component.projects.set([{ id: 5, name: 'P1', tagColorHex: 'ff0000', shortName: 'P1', activeFlag: true } as any]);
      fixture.componentRef.setInput('task', { ...baseTask, projectID: 5 });
      fixture.detectChanges();
      expect(component.projectColor()).toBe('#ff0000');
    });

    it('should return null when project not found', () => {
      component.projects.set([{ id: 5, name: 'P1', tagColorHex: 'ff0000' } as any]);
      fixture.componentRef.setInput('task', { ...baseTask, projectID: 999 });
      fixture.detectChanges();
      expect(component.projectColor()).toBeNull();
    });
  });

  describe('sortedProjects', () => {
    it('should sort projects alphabetically', () => {
      component.projects.set([
        { id: 1, name: 'Zebra' } as any,
        { id: 2, name: 'Apple' } as any,
        { id: 3, name: 'Mango' } as any,
      ]);
      const sorted = component.sortedProjects();
      expect(sorted.map(p => p.name)).toEqual(['Apple', 'Mango', 'Zebra']);
    });
  });

  describe('isDueToday', () => {
    it('should return false when no due date', () => {
      expect(component.isDueToday()).toBe(false);
    });

    it('should return true when due date is today', () => {
      const today = new Date();
      fixture.componentRef.setInput('task', { ...baseTask, dueDate: today.toISOString() });
      fixture.detectChanges();
      expect(component.isDueToday()).toBe(true);
    });

    it('should return false when task is done', () => {
      const today = new Date();
      fixture.componentRef.setInput('task', { ...baseTask, doneFlag: true, dueDate: today.toISOString() });
      fixture.detectChanges();
      expect(component.isDueToday()).toBe(false);
    });
  });

  describe('isOverdue', () => {
    it('should return false when no due date', () => {
      expect(component.isOverdue()).toBe(false);
    });

    it('should return true when due date is in the past', () => {
      const past = new Date('2020-01-01');
      fixture.componentRef.setInput('task', { ...baseTask, dueDate: past.toISOString() });
      fixture.detectChanges();
      expect(component.isOverdue()).toBe(true);
    });

    it('should return false when due date is today', () => {
      const today = new Date();
      fixture.componentRef.setInput('task', { ...baseTask, dueDate: today.toISOString() });
      fixture.detectChanges();
      expect(component.isOverdue()).toBe(false);
    });
  });

  describe('toggleComplete', () => {
    it('should optimistically toggle done state and call API', () => {
      vi.spyOn(taskService, 'updateTask').mockReturnValue(of({} as any));
      vi.spyOn(taskService, 'triggerRefresh');

      const event = new Event('click');
      vi.spyOn(event, 'stopPropagation');

      component.toggleComplete(event);

      expect(event.stopPropagation).toHaveBeenCalled();
      expect(component.isDoneOverride()).toBe(true);
      expect(taskService.updateTask).toHaveBeenCalledWith(1, { doneFlag: true });
    });

    it('should revert override on API error', () => {
      vi.spyOn(taskService, 'updateTask').mockReturnValue(throwError(() => new Error('fail')));

      component.toggleComplete(new Event('click'));

      expect(component.isDoneOverride()).toBeNull();
    });
  });

  describe('hover state', () => {
    it('should set isHovered on mouse enter/leave', () => {
      expect(component.isHovered()).toBe(false);
      component.onMouseEnter();
      expect(component.isHovered()).toBe(true);
      component.onMouseLeave();
      expect(component.isHovered()).toBe(false);
    });
  });

  describe('keyboard shortcuts', () => {
    it('should ignore key events when not hovered', () => {
      vi.spyOn(taskService, 'updateTask');
      component.onKeyDown(new KeyboardEvent('keydown', { key: 'c' }));
      expect(taskService.updateTask).not.toHaveBeenCalled();
    });

    it('should toggle complete on "c" when hovered', () => {
      component.isHovered.set(true);
      vi.spyOn(taskService, 'updateTask').mockReturnValue(of({} as any));

      component.onKeyDown(new KeyboardEvent('keydown', { key: 'c' }));

      expect(taskService.updateTask).toHaveBeenCalledWith(1, { doneFlag: true });
    });

    it('should clear project on "0" when hovered', () => {
      component.isHovered.set(true);
      fixture.componentRef.setInput('task', { ...baseTask, projectID: 5 });
      fixture.detectChanges();

      vi.spyOn(taskService, 'updateTask').mockReturnValue(of({} as any));
      vi.spyOn(taskService, 'triggerRefresh');

      component.onKeyDown(new KeyboardEvent('keydown', { key: '0' }));

      expect(taskService.updateTask).toHaveBeenCalledWith(1, { projectID: null as any });
    });

    it('should assign project by keyboard shortcut when hovered', () => {
      component.isHovered.set(true);
      component.projects.set([
        { id: 10, name: 'Proj', keyboardShortcut: '1' } as any
      ]);
      vi.spyOn(taskService, 'updateTask').mockReturnValue(of({} as any));
      vi.spyOn(taskService, 'triggerRefresh');

      component.onKeyDown(new KeyboardEvent('keydown', { key: '1' }));

      expect(taskService.updateTask).toHaveBeenCalledWith(1, { projectID: 10 as any });
    });

    it('should toggle project off when same shortcut pressed', () => {
      component.isHovered.set(true);
      component.projects.set([
        { id: 10, name: 'Proj', keyboardShortcut: '1' } as any
      ]);
      fixture.componentRef.setInput('task', { ...baseTask, projectID: 10 });
      fixture.detectChanges();

      vi.spyOn(taskService, 'updateTask').mockReturnValue(of({} as any));
      vi.spyOn(taskService, 'triggerRefresh');

      component.onKeyDown(new KeyboardEvent('keydown', { key: '1' }));

      expect(taskService.updateTask).toHaveBeenCalledWith(1, { projectID: null as any });
    });
  });
});
