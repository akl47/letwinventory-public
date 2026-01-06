import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';
import { signal } from '@angular/core';

import { TaskCard } from './task-card';
import { TaskService } from '../../../services/task.service';
import { ProjectService } from '../../../services/project.service';
import { Task } from '../../../models/task.model';

describe('TaskCard', () => {
  let component: TaskCard;
  let fixture: ComponentFixture<TaskCard>;
  let taskServiceSpy: jasmine.SpyObj<TaskService>;
  let projectServiceSpy: jasmine.SpyObj<ProjectService>;
  let dialogSpy: jasmine.SpyObj<MatDialog>;

  const mockTask: Task = {
    id: 1,
    title: 'Test Task',
    description: 'Test Description',
    doneFlag: false,
    taskListID: 1,
    projectID: 1,
    sortOrder: 0,
    dueDate: undefined,
    estimatedMinutes: 90
  };

  beforeEach(async () => {
    taskServiceSpy = jasmine.createSpyObj('TaskService', ['updateTask', 'triggerRefresh']);
    projectServiceSpy = jasmine.createSpyObj('ProjectService', ['getProjects']);
    dialogSpy = jasmine.createSpyObj('MatDialog', ['open']);

    projectServiceSpy.getProjects.and.returnValue(of([
      { id: 1, name: 'Project 1', tagColorHex: 'FF0000' }
    ]));

    await TestBed.configureTestingModule({
      imports: [TaskCard],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: TaskService, useValue: taskServiceSpy },
        { provide: ProjectService, useValue: projectServiceSpy },
        { provide: MatDialog, useValue: dialogSpy }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(TaskCard);
    component = fixture.componentInstance;

    // Set required input
    fixture.componentRef.setInput('task', mockTask);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('initialization', () => {
    it('should load projects on init', () => {
      expect(projectServiceSpy.getProjects).toHaveBeenCalled();
    });

    it('should compute project color from projects', () => {
      expect(component.projectColor()).toBe('#FF0000');
    });

    it('should return null for project color when project not found', () => {
      fixture.componentRef.setInput('task', { ...mockTask, projectID: 999 });
      fixture.detectChanges();
      expect(component.projectColor()).toBeNull();
    });
  });

  describe('formatEstimate', () => {
    it('should return empty string for undefined minutes', () => {
      expect(component.formatEstimate(undefined)).toBe('');
    });

    it('should return empty string for null minutes', () => {
      expect(component.formatEstimate(null as any)).toBe('');
    });

    it('should format minutes less than 60', () => {
      expect(component.formatEstimate(30)).toBe('30m');
    });

    it('should format exactly 60 minutes as 1 hour', () => {
      expect(component.formatEstimate(60)).toBe('1h');
    });

    it('should format hours and minutes', () => {
      expect(component.formatEstimate(90)).toBe('1h 30m');
    });

    it('should format multiple hours without remainder', () => {
      expect(component.formatEstimate(120)).toBe('2h');
    });
  });

  describe('isOverdue', () => {
    it('should return false when no due date', () => {
      expect(component.isOverdue()).toBeFalse();
    });

    it('should return false when task is done', () => {
      fixture.componentRef.setInput('task', {
        ...mockTask,
        doneFlag: true,
        dueDate: new Date('2020-01-01')
      });
      fixture.detectChanges();
      expect(component.isOverdue()).toBeFalse();
    });

    it('should return true when due date is in the past', () => {
      fixture.componentRef.setInput('task', {
        ...mockTask,
        dueDate: new Date('2020-01-01')
      });
      fixture.detectChanges();
      expect(component.isOverdue()).toBeTrue();
    });

    it('should return false when due date is in the future', () => {
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);
      fixture.componentRef.setInput('task', {
        ...mockTask,
        dueDate: futureDate
      });
      fixture.detectChanges();
      expect(component.isOverdue()).toBeFalse();
    });
  });

  describe('toggleComplete', () => {
    it('should update task to done and trigger refresh after delay', fakeAsync(() => {
      taskServiceSpy.updateTask.and.returnValue(of({} as Task));

      const event = new Event('click');
      spyOn(event, 'stopPropagation');

      component.toggleComplete(event);

      expect(event.stopPropagation).toHaveBeenCalled();
      expect(taskServiceSpy.updateTask).toHaveBeenCalledWith(1, { doneFlag: true });
      expect(component.displayDone()).toBeTrue();

      tick(3000);
      expect(taskServiceSpy.triggerRefresh).toHaveBeenCalled();
    }));

    it('should update task to not done and trigger refresh immediately', fakeAsync(() => {
      fixture.componentRef.setInput('task', { ...mockTask, doneFlag: true });
      fixture.detectChanges();

      taskServiceSpy.updateTask.and.returnValue(of({} as Task));

      const event = new Event('click');
      component.toggleComplete(event);

      expect(taskServiceSpy.updateTask).toHaveBeenCalledWith(1, { doneFlag: false });
      expect(taskServiceSpy.triggerRefresh).toHaveBeenCalled();
    }));

    it('should revert on error', fakeAsync(() => {
      taskServiceSpy.updateTask.and.returnValue(throwError(() => new Error('Update failed')));

      const event = new Event('click');
      component.toggleComplete(event);

      expect(component.displayDone()).toBeFalse();
    }));
  });

  describe('openDialog', () => {
    it('should open task dialog with correct configuration', () => {
      component.openDialog();

      expect(dialogSpy.open).toHaveBeenCalledWith(
        jasmine.any(Function),
        jasmine.objectContaining({
          data: { task: mockTask },
          width: '768px',
          maxWidth: '95vw',
          panelClass: 'trello-dialog-container'
        })
      );
    });
  });

  describe('ngOnDestroy', () => {
    it('should trigger refresh if there is a pending refresh', fakeAsync(() => {
      taskServiceSpy.updateTask.and.returnValue(of({} as Task));

      const event = new Event('click');
      component.toggleComplete(event);

      // Don't wait for the full timeout
      tick(1000);

      component.ngOnDestroy();
      expect(taskServiceSpy.triggerRefresh).toHaveBeenCalled();
    }));
  });
});
