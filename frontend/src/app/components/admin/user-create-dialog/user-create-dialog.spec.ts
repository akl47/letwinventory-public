import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { MatDialogRef } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { UserCreateDialog } from './user-create-dialog';
import { AdminService } from '../../../services/admin.service';

describe('UserCreateDialog', () => {
  let component: UserCreateDialog;
  let fixture: ComponentFixture<UserCreateDialog>;
  let adminService: AdminService;
  let dialogRef: MatDialogRef<UserCreateDialog>;

  beforeEach(async () => {
    const mockDialogRef = { close: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [UserCreateDialog],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
        { provide: MatDialogRef, useValue: mockDialogRef },
      ],
    }).compileComponents();

    adminService = TestBed.inject(AdminService);
    dialogRef = TestBed.inject(MatDialogRef);

    fixture = TestBed.createComponent(UserCreateDialog);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('create', () => {
    it('should not call adminService when fields are empty', () => {
      vi.spyOn(adminService, 'createUser');
      component.email = '';
      component.displayName = '';
      component.create();
      expect(adminService.createUser).not.toHaveBeenCalled();
    });

    it('should not call adminService when email is whitespace only', () => {
      vi.spyOn(adminService, 'createUser');
      component.email = '   ';
      component.displayName = 'Test';
      component.create();
      expect(adminService.createUser).not.toHaveBeenCalled();
    });

    it('should call adminService.createUser with trimmed data', () => {
      vi.spyOn(adminService, 'createUser').mockReturnValue(of({ id: 1, displayName: 'Test', email: 'test@test.com' }));
      component.email = '  test@test.com  ';
      component.displayName = '  Test  ';
      component.create();
      expect(adminService.createUser).toHaveBeenCalledWith({
        email: 'test@test.com',
        displayName: 'Test',
      });
    });

    it('should close dialog with true on success', () => {
      vi.spyOn(adminService, 'createUser').mockReturnValue(of({ id: 1, displayName: 'Test', email: 'test@test.com' }));
      component.email = 'test@test.com';
      component.displayName = 'Test';
      component.create();
      expect(dialogRef.close).toHaveBeenCalledWith(true);
    });

    it('should set error on failure', () => {
      vi.spyOn(adminService, 'createUser').mockReturnValue(
        throwError(() => ({ error: { error: 'Email already exists' } }))
      );
      component.email = 'test@test.com';
      component.displayName = 'Test';
      component.create();
      expect(component.error()).toBe('Email already exists');
      expect(component.creating()).toBe(false);
      expect(dialogRef.close).not.toHaveBeenCalled();
    });

    it('should use fallback error message when error.error.error is missing', () => {
      vi.spyOn(adminService, 'createUser').mockReturnValue(
        throwError(() => ({ error: {} }))
      );
      component.email = 'test@test.com';
      component.displayName = 'Test';
      component.create();
      expect(component.error()).toBe('Failed to create user');
    });
  });

  describe('cancel', () => {
    it('should close dialog with false', () => {
      component.cancel();
      expect(dialogRef.close).toHaveBeenCalledWith(false);
    });
  });
});
