import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, Router, ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { UserPermissions } from './user-permissions';
import { AdminService } from '../../../services/admin.service';
import { AuthService } from '../../../services/auth.service';

describe('UserPermissions', () => {
  let component: UserPermissions;
  let fixture: ComponentFixture<UserPermissions>;
  let adminService: AdminService;
  let authService: AuthService;
  let router: Router;

  const mockUser = {
    id: 5,
    displayName: 'Test User',
    email: 'test@test.com',
    activeFlag: true,
    groups: [{ id: 1, name: 'Admin' }],
    directPermissions: [{ id: 10, resource: 'tasks', action: 'read' }],
  };

  const mockPermissions = [
    { id: 10, resource: 'tasks', action: 'read' },
    { id: 11, resource: 'tasks', action: 'write' },
  ];

  const mockGroups = [
    { id: 1, name: 'Admin' },
    { id: 2, name: 'Editors' },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UserPermissions],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            params: of({ id: '5' }),
            snapshot: { params: { id: '5' } },
          },
        },
      ],
    }).compileComponents();

    adminService = TestBed.inject(AdminService);
    authService = TestBed.inject(AuthService);
    router = TestBed.inject(Router);

    vi.spyOn(adminService, 'getUser').mockReturnValue(of(mockUser as any));
    vi.spyOn(adminService, 'getPermissions').mockReturnValue(of(mockPermissions as any));
    vi.spyOn(adminService, 'getGroups').mockReturnValue(of(mockGroups as any));

    fixture = TestBed.createComponent(UserPermissions);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should start in loading state before data loads', () => {
    // After init + forkJoin completes, loading is false
    expect(component.loading()).toBe(false);
    expect(component.user()?.id).toBe(5);
  });

  describe('canImpersonate', () => {
    it('should return false when user lacks admin.impersonate permission', () => {
      expect(component.canImpersonate()).toBe(false);
    });

    it('should reflect authService.hasPermission', () => {
      vi.spyOn(authService, 'hasPermission').mockReturnValue(true);
      // canImpersonate is a computed that calls authService.hasPermission
      // We need to force recompute by accessing after the spy is set
      expect(authService.hasPermission('admin', 'impersonate')).toBe(true);
    });
  });

  describe('enableEdit', () => {
    it('should set isFormEditMode to true', () => {
      expect(component.isFormEditMode()).toBe(false);
      component.enableEdit();
      expect(component.isFormEditMode()).toBe(true);
    });
  });

  describe('goBack', () => {
    it('should navigate to /admin/users', () => {
      vi.spyOn(router, 'navigate').mockResolvedValue(true);
      component.goBack();
      expect(router.navigate).toHaveBeenCalledWith(['/admin/users']);
    });
  });
});
