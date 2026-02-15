import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { ProjectEditDialog } from './project-edit-dialog';
import { ProjectService } from '../../../services/project.service';
import { ErrorNotificationService } from '../../../services/error-notification.service';
import { Project } from '../../../models/project.model';

describe('ProjectEditDialog', () => {
  let component: ProjectEditDialog;
  let fixture: ComponentFixture<ProjectEditDialog>;
  let projectService: ProjectService;
  let errorNotification: ErrorNotificationService;
  let dialogRef: any;

  const mockProjects: Project[] = [
    { id: 1, ownerUserID: 1, tagColorHex: 'ff0000', name: 'A', shortName: 'A', activeFlag: true, keyboardShortcut: '1', createdAt: new Date(), updatedAt: new Date() },
    { id: 2, ownerUserID: 1, tagColorHex: '00ff00', name: 'B', shortName: 'B', activeFlag: true, keyboardShortcut: '3', createdAt: new Date(), updatedAt: new Date() },
  ];

  function createComponent(dialogData: any = {}) {
    dialogRef = { close: vi.fn() } as any;

    TestBed.configureTestingModule({
      imports: [ProjectEditDialog],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
        { provide: MAT_DIALOG_DATA, useValue: dialogData },
        { provide: MatDialogRef, useValue: dialogRef },
      ],
    }).compileComponents();

    projectService = TestBed.inject(ProjectService);
    errorNotification = TestBed.inject(ErrorNotificationService);
    vi.spyOn(projectService, 'getProjects').mockReturnValue(of(mockProjects));

    fixture = TestBed.createComponent(ProjectEditDialog);
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

    it('should load existing shortcuts', () => {
      expect(projectService.getProjects).toHaveBeenCalled();
      expect(component.usedShortcuts()).toEqual(['1', '3']);
    });

    it('should have default form values', () => {
      expect(component.form.value.name).toBe('');
      expect(component.form.value.shortName).toBe('');
      expect(component.form.value.tagColorHex).toBe('#6366f1');
      expect(component.form.value.keyboardShortcut).toBeNull();
    });

    describe('availableShortcuts', () => {
      it('should exclude used shortcuts', () => {
        const available = component.availableShortcuts();
        expect(available).not.toContain('1');
        expect(available).not.toContain('3');
        expect(available).toContain('2');
        expect(available).toContain('4');
      });
    });

    describe('onColorChange', () => {
      it('should update form tagColorHex', () => {
        const event = { target: { value: '#ff00ff' } } as any;
        component.onColorChange(event);
        expect(component.form.value.tagColorHex).toBe('#ff00ff');
      });
    });

    describe('getFormValidationErrors', () => {
      it('should return errors for empty required fields', () => {
        component.form.patchValue({ name: '', shortName: '' });
        component.form.get('name')?.markAsTouched();
        component.form.get('shortName')?.markAsTouched();
        const errors = component.getFormValidationErrors();
        expect(errors).toContain('Name is required');
        expect(errors).toContain('Short name is required');
      });

      it('should return maxlength error', () => {
        component.form.patchValue({ name: 'a'.repeat(101) });
        component.form.get('name')?.markAsTouched();
        const errors = component.getFormValidationErrors();
        expect(errors).toContain('Name must be 100 characters or less');
      });

      it('should return empty array for valid form', () => {
        component.form.patchValue({ name: 'Test', shortName: 'T', tagColorHex: '#123456' });
        const errors = component.getFormValidationErrors();
        expect(errors.length).toBe(0);
      });
    });

    describe('save', () => {
      it('should show error when form is invalid', () => {
        vi.spyOn(errorNotification, 'showError');
        component.save();
        expect(errorNotification.showError).toHaveBeenCalled();
      });

      it('should create project on valid form', () => {
        vi.spyOn(projectService, 'createProject').mockReturnValue(of({} as any));
        vi.spyOn(errorNotification, 'showSuccess');

        component.form.patchValue({ name: 'New Project', shortName: 'NP', tagColorHex: '#abcdef' });
        component.save();

        expect(projectService.createProject).toHaveBeenCalledWith(expect.objectContaining({
          name: 'New Project',
          shortName: 'NP',
          tagColorHex: 'abcdef', // # stripped
        }));
        expect(dialogRef.close).toHaveBeenCalledWith(true);
      });

      it('should strip # from color hex', () => {
        vi.spyOn(projectService, 'createProject').mockReturnValue(of({} as any));
        component.form.patchValue({ name: 'Test', shortName: 'T', tagColorHex: '#ff0000' });
        component.save();

        const callArg = vi.mocked(projectService.createProject).mock.calls[0][0];
        expect(callArg.tagColorHex).toBe('ff0000');
      });
    });

    describe('delete', () => {
      it('should not delete in create mode', () => {
        vi.spyOn(projectService, 'deleteProject');
        component.delete();
        expect(projectService.deleteProject).not.toHaveBeenCalled();
      });
    });
  });

  describe('edit mode', () => {
    const existingProject: Project = {
      id: 2, ownerUserID: 1, tagColorHex: '00ff00', name: 'Existing',
      shortName: 'EX', description: 'Desc', keyboardShortcut: '3',
      activeFlag: true, createdAt: new Date(), updatedAt: new Date(),
    };

    beforeEach(() => createComponent({ project: existingProject }));

    it('should be in edit mode', () => {
      expect(component.isEditMode).toBe(true);
    });

    it('should populate form with project data', () => {
      expect(component.form.value.name).toBe('Existing');
      expect(component.form.value.shortName).toBe('EX');
      expect(component.form.value.description).toBe('Desc');
      expect(component.form.value.tagColorHex).toBe('#00ff00');
      expect(component.form.value.keyboardShortcut).toBe('3');
    });

    it('should include current project shortcut in available shortcuts', () => {
      const available = component.availableShortcuts();
      expect(available).toContain('3'); // current project's shortcut should be available
      expect(available).not.toContain('1'); // other project's shortcut should not
    });

    it('should update project on save', () => {
      vi.spyOn(projectService, 'updateProject').mockReturnValue(of({} as any));
      vi.spyOn(errorNotification, 'showSuccess');

      component.save();

      expect(projectService.updateProject).toHaveBeenCalledWith(2, expect.any(Object));
      expect(dialogRef.close).toHaveBeenCalledWith(true);
    });

    it('should show error on update failure', () => {
      vi.spyOn(projectService, 'updateProject').mockReturnValue(throwError(() => ({ error: {} })));
      vi.spyOn(errorNotification, 'showHttpError');

      component.save();

      expect(errorNotification.showHttpError).toHaveBeenCalled();
    });

    it('should delete project with confirmation', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      vi.spyOn(projectService, 'deleteProject').mockReturnValue(of({} as any));
      vi.spyOn(errorNotification, 'showSuccess');

      component.delete();

      expect(projectService.deleteProject).toHaveBeenCalledWith(2);
      expect(dialogRef.close).toHaveBeenCalledWith(true);
    });

    it('should not delete when confirmation is cancelled', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      vi.spyOn(projectService, 'deleteProject');

      component.delete();

      expect(projectService.deleteProject).not.toHaveBeenCalled();
    });
  });
});
