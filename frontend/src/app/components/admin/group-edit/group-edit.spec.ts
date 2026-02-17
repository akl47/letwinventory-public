import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, Router, ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { GroupEdit } from './group-edit';
import { AdminService } from '../../../services/admin.service';
import { Permission, UserGroup, AdminUser } from '../../../models/permission.model';

describe('GroupEdit', () => {
  let component: GroupEdit;
  let fixture: ComponentFixture<GroupEdit>;
  let adminService: AdminService;
  let router: Router;

  const mockPermissions: Permission[] = [
    { id: 1, resource: 'tasks', action: 'read' },
    { id: 2, resource: 'tasks', action: 'write' },
    { id: 3, resource: 'parts', action: 'read' },
  ];

  const mockUsers: AdminUser[] = [
    { id: 10, displayName: 'Alice', email: 'alice@test.com', activeFlag: true },
    { id: 20, displayName: 'Bob', email: 'bob@test.com', activeFlag: true },
    { id: 30, displayName: 'Charlie', email: 'charlie@test.com', activeFlag: false },
  ];

  const mockGroup: UserGroup = {
    id: 1,
    name: 'Editors',
    description: 'Can edit things',
    members: [{ id: 10, displayName: 'Alice', email: 'alice@test.com' }],
    permissions: [mockPermissions[0], mockPermissions[1]],
  };

  function setupTestBed(routeParams: Record<string, string> = {}) {
    return TestBed.configureTestingModule({
      imports: [GroupEdit],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { params: of(routeParams) } },
      ],
    }).compileComponents().then(() => {
      adminService = TestBed.inject(AdminService);
      router = TestBed.inject(Router);

      vi.spyOn(adminService, 'getGroup').mockReturnValue(of(mockGroup));
      vi.spyOn(adminService, 'getPermissions').mockReturnValue(of(mockPermissions));
      vi.spyOn(adminService, 'getUsers').mockReturnValue(of(mockUsers));
      vi.spyOn(adminService, 'createGroup').mockReturnValue(of({ id: 99, name: 'New' }));
      vi.spyOn(adminService, 'updateGroup').mockReturnValue(of(mockGroup));
      vi.spyOn(adminService, 'addMember').mockReturnValue(of({}));
      vi.spyOn(adminService, 'removeMember').mockReturnValue(of({}));
      vi.spyOn(router, 'navigate').mockResolvedValue(true);

      fixture = TestBed.createComponent(GroupEdit);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });
  }

  describe('new group (no route id)', () => {
    beforeEach(async () => {
      await setupTestBed({});
      await fixture.whenStable();
    });

    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should start in loading state then finish', () => {
      // After init completes, loading should be false
      expect(component.loading()).toBe(false);
    });

    it('isNew should be true when no group loaded', () => {
      expect(component.isNew()).toBe(true);
      expect(component.group()).toBeNull();
    });

    it('should load reference data for new group', () => {
      expect(adminService.getPermissions).toHaveBeenCalled();
      expect(adminService.getUsers).toHaveBeenCalled();
      expect(adminService.getGroup).not.toHaveBeenCalled();
      expect(component.allPermissions().length).toBe(3);
      expect(component.allUsers().length).toBe(3);
    });

    it('should be in edit mode for new group', () => {
      expect(component.isFormEditMode()).toBe(true);
    });
  });

  describe('existing group (route id present)', () => {
    beforeEach(async () => {
      await setupTestBed({ id: '1' });
      await fixture.whenStable();
    });

    it('isNew should be false when group loaded', () => {
      expect(component.isNew()).toBe(false);
      expect(component.group()).toEqual(mockGroup);
    });

    it('should populate name and description from group', () => {
      expect(component.name()).toBe('Editors');
      expect(component.description()).toBe('Can edit things');
    });

    it('should populate selectedPermissionIds from group', () => {
      const ids = component.selectedPermissionIds();
      expect(ids.has(1)).toBe(true);
      expect(ids.has(2)).toBe(true);
      expect(ids.has(3)).toBe(false);
    });

    it('should not be in edit mode for existing group', () => {
      expect(component.isFormEditMode()).toBe(false);
    });
  });

  describe('memberColumns', () => {
    beforeEach(async () => {
      await setupTestBed({ id: '1' });
      await fixture.whenStable();
    });

    it('should not include actions when not editing', () => {
      expect(component.isFormEditMode()).toBe(false);
      expect(component.memberColumns()).toEqual(['displayName', 'email']);
    });

    it('should include actions when editing', () => {
      component.enableEdit();
      expect(component.memberColumns()).toEqual(['displayName', 'email', 'actions']);
    });
  });

  describe('goBack', () => {
    beforeEach(async () => {
      await setupTestBed({});
      await fixture.whenStable();
    });

    it('should navigate to /admin/groups', () => {
      component.goBack();
      expect(router.navigate).toHaveBeenCalledWith(['/admin/groups']);
    });
  });

  describe('availableUsers', () => {
    beforeEach(async () => {
      await setupTestBed({ id: '1' });
      await fixture.whenStable();
    });

    it('should filter out existing members and inactive users', () => {
      // mockGroup has member id=10 (Alice). Charlie (id=30) is inactive.
      const available = component.availableUsers();
      const ids = available.map(u => u.id);
      expect(ids).toContain(20); // Bob: active, not a member
      expect(ids).not.toContain(10); // Alice: already a member
      expect(ids).not.toContain(30); // Charlie: inactive
    });

    it('should return all active users when no group', () => {
      component.group.set(null);
      const available = component.availableUsers();
      const ids = available.map(u => u.id);
      expect(ids).toContain(10);
      expect(ids).toContain(20);
      expect(ids).not.toContain(30); // inactive
    });
  });
});
