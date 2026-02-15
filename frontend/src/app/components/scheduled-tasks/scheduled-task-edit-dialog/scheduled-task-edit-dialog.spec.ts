import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { ScheduledTaskEditDialog } from './scheduled-task-edit-dialog';
import { ScheduledTaskService } from '../../../services/scheduled-task.service';
import { TaskService } from '../../../services/task.service';
import { ProjectService } from '../../../services/project.service';
import { ErrorNotificationService } from '../../../services/error-notification.service';
import { ScheduledTask } from '../../../models/scheduled-task.model';

describe('ScheduledTaskEditDialog', () => {
  let component: ScheduledTaskEditDialog;
  let fixture: ComponentFixture<ScheduledTaskEditDialog>;
  let scheduledTaskService: ScheduledTaskService;
  let taskService: TaskService;
  let projectService: ProjectService;
  let errorNotification: ErrorNotificationService;
  let dialogRef: any;

  const mockTaskLists = [
    { id: 1, name: 'To Do' },
    { id: 2, name: 'In Progress' },
  ];

  const mockProjects = [
    { id: 1, name: 'Project A', shortName: 'PA', tagColorHex: 'ff0000', activeFlag: true },
  ];

  function createComponent(dialogData: any = {}) {
    dialogRef = { close: vi.fn() } as any;

    TestBed.configureTestingModule({
      imports: [ScheduledTaskEditDialog],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
        { provide: MAT_DIALOG_DATA, useValue: dialogData },
        { provide: MatDialogRef, useValue: dialogRef },
      ],
    }).compileComponents();

    scheduledTaskService = TestBed.inject(ScheduledTaskService);
    taskService = TestBed.inject(TaskService);
    projectService = TestBed.inject(ProjectService);
    errorNotification = TestBed.inject(ErrorNotificationService);

    vi.spyOn(taskService, 'getTaskLists').mockReturnValue(of(mockTaskLists as any));
    vi.spyOn(projectService, 'getProjects').mockReturnValue(of(mockProjects as any));

    fixture = TestBed.createComponent(ScheduledTaskEditDialog);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('create mode', () => {
    beforeEach(() => createComponent({}));

    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should not be in edit mode', () => {
      expect(component.isEditMode).toBe(false);
    });

    it('should load dropdowns', () => {
      expect(taskService.getTaskLists).toHaveBeenCalled();
      expect(projectService.getProjects).toHaveBeenCalled();
      expect(component.taskLists().length).toBe(2);
      expect(component.projects().length).toBe(1);
    });

    it('should have supported timezones', () => {
      expect(component.timezones.length).toBeGreaterThan(0);
      expect(component.timezones).toContain('America/Los_Angeles');
    });

    it('should have default form values', () => {
      expect(component.form.value.name).toBe('');
      expect(component.form.value.cronExpression).toBe('');
      expect(component.form.value.timezone).toBe('America/Los_Angeles');
      expect(component.form.value.notifyOnCreate).toBe(true);
      expect(component.form.value.activeFlag).toBe(true);
    });

    describe('cronDescription', () => {
      it('should be empty for blank expression', () => {
        expect(component.cronDescription()).toBe('');
      });

      it('should update when cron expression changes', () => {
        component.form.patchValue({ cronExpression: '0 9 * * 1' });
        expect(component.cronDescription()).toBe('At 9:00 on Mon');
      });

      it('should show invalid for bad expression', () => {
        component.form.patchValue({ cronExpression: 'bad input' });
        expect(component.cronDescription()).toBe('Invalid cron expression');
      });

      it('should handle hourly expression', () => {
        component.form.patchValue({ cronExpression: '0 * * * *' });
        expect(component.cronDescription()).toBe('Every hour');
      });

      it('should handle every-minute expression', () => {
        component.form.patchValue({ cronExpression: '* * * * *' });
        expect(component.cronDescription()).toBe('Every minute');
      });

      it('should include day of month', () => {
        component.form.patchValue({ cronExpression: '0 9 15 * *' });
        expect(component.cronDescription()).toBe('At 9:00 on day 15');
      });

      it('should include month', () => {
        component.form.patchValue({ cronExpression: '0 9 * 6 *' });
        expect(component.cronDescription()).toBe('At 9:00 of month 6');
      });
    });

    describe('save', () => {
      it('should show error when form is invalid', () => {
        vi.spyOn(errorNotification, 'showError');
        component.save();
        expect(errorNotification.showError).toHaveBeenCalledWith('Please fill in all required fields');
      });

      it('should create scheduled task on valid form', () => {
        vi.spyOn(scheduledTaskService, 'create').mockReturnValue(of({} as any));
        vi.spyOn(errorNotification, 'showSuccess');

        component.form.patchValue({
          name: 'Test Task',
          taskListID: 1,
          cronExpression: '0 9 * * 1',
          timezone: 'UTC',
        });

        component.save();

        expect(scheduledTaskService.create).toHaveBeenCalledWith(expect.objectContaining({
          name: 'Test Task',
          taskListID: 1,
          cronExpression: '0 9 * * 1',
          timezone: 'UTC',
          taskTypeEnum: 'scheduled',
        }));
        expect(dialogRef.close).toHaveBeenCalledWith(true);
      });

      it('should handle create failure', () => {
        vi.spyOn(scheduledTaskService, 'create').mockReturnValue(throwError(() => ({ error: {} })));
        vi.spyOn(errorNotification, 'showHttpError');

        component.form.patchValue({
          name: 'Test',
          taskListID: 1,
          cronExpression: '0 9 * * *',
          timezone: 'UTC',
        });

        component.save();
        expect(errorNotification.showHttpError).toHaveBeenCalled();
      });
    });

    describe('delete', () => {
      it('should not delete in create mode', () => {
        vi.spyOn(scheduledTaskService, 'delete');
        component.delete();
        expect(scheduledTaskService.delete).not.toHaveBeenCalled();
      });
    });
  });

  describe('edit mode', () => {
    const existingTask: ScheduledTask = {
      id: 5, ownerUserID: 1, name: 'Existing Task', description: 'Desc',
      taskListID: 1, projectID: 1, taskTypeEnum: 'scheduled',
      timeEstimate: 30, cronExpression: '0 14 * * 5', timezone: 'UTC',
      nextRunAt: new Date(), notifyOnCreate: false, activeFlag: true,
      createdAt: new Date(), updatedAt: new Date(),
    };

    beforeEach(() => createComponent({ scheduledTask: existingTask }));

    it('should be in edit mode', () => {
      expect(component.isEditMode).toBe(true);
    });

    it('should populate form with existing data', () => {
      expect(component.form.value.name).toBe('Existing Task');
      expect(component.form.value.description).toBe('Desc');
      expect(component.form.value.taskListID).toBe(1);
      expect(component.form.value.projectID).toBe(1);
      expect(component.form.value.timeEstimate).toBe(30);
      expect(component.form.value.cronExpression).toBe('0 14 * * 5');
      expect(component.form.value.timezone).toBe('UTC');
      expect(component.form.value.notifyOnCreate).toBe(false);
      expect(component.form.value.activeFlag).toBe(true);
    });

    it('should set initial cron description', () => {
      expect(component.cronDescription()).toBe('At 14:00 on Fri');
    });

    it('should update existing task on save', () => {
      vi.spyOn(scheduledTaskService, 'update').mockReturnValue(of({} as any));
      vi.spyOn(errorNotification, 'showSuccess');

      component.save();

      expect(scheduledTaskService.update).toHaveBeenCalledWith(5, expect.any(Object));
      expect(dialogRef.close).toHaveBeenCalledWith(true);
    });

    it('should delete with confirmation', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      vi.spyOn(scheduledTaskService, 'delete').mockReturnValue(of({} as any));
      vi.spyOn(errorNotification, 'showSuccess');

      component.delete();

      expect(scheduledTaskService.delete).toHaveBeenCalledWith(5);
      expect(dialogRef.close).toHaveBeenCalledWith(true);
    });

    it('should not delete when confirmation cancelled', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      vi.spyOn(scheduledTaskService, 'delete');

      component.delete();

      expect(scheduledTaskService.delete).not.toHaveBeenCalled();
    });
  });

  describe('ngOnDestroy', () => {
    beforeEach(() => createComponent({}));

    it('should unsubscribe from cron subscription', () => {
      // Should not throw
      expect(() => component.ngOnDestroy()).not.toThrow();
    });
  });
});
