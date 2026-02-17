import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { UsersList } from './users-list';
import { AdminService } from '../../../services/admin.service';
import { AdminUser } from '../../../models/permission.model';

describe('UsersList', () => {
  let component: UsersList;
  let fixture: ComponentFixture<UsersList>;
  let adminService: AdminService;
  let router: Router;

  const mockUsers: AdminUser[] = [
    { id: 1, displayName: 'Alice', email: 'alice@test.com', activeFlag: true, groups: [{ id: 1, name: 'Admin' }, { id: 2, name: 'Editors' }] },
    { id: 2, displayName: 'Bob', email: 'bob@test.com', activeFlag: true, groups: [] },
    { id: 3, displayName: 'Charlie', email: 'charlie@test.com', activeFlag: false, groups: [{ id: 1, name: 'Admin' }] },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UsersList],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
      ],
    }).compileComponents();

    adminService = TestBed.inject(AdminService);
    router = TestBed.inject(Router);

    vi.spyOn(adminService, 'getUsers').mockReturnValue(of(mockUsers));

    fixture = TestBed.createComponent(UsersList);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load users on init', () => {
    expect(adminService.getUsers).toHaveBeenCalled();
    expect(component.users().length).toBe(3);
    expect(component.isLoading()).toBe(false);
  });

  describe('filteredUsers', () => {
    it('should filter inactive when showInactive is false', () => {
      component.showInactive.set(false);
      const filtered = component.filteredUsers();
      expect(filtered.length).toBe(2);
      expect(filtered.every(u => u.activeFlag !== false)).toBe(true);
    });

    it('should include inactive when showInactive is true', () => {
      component.showInactive.set(true);
      const filtered = component.filteredUsers();
      expect(filtered.length).toBe(3);
    });

    it('should filter by search query on displayName', () => {
      component.searchQuery.set('alice');
      const filtered = component.filteredUsers();
      expect(filtered.length).toBe(1);
      expect(filtered[0].displayName).toBe('Alice');
    });

    it('should filter by search query on email', () => {
      component.searchQuery.set('bob@test');
      const filtered = component.filteredUsers();
      expect(filtered.length).toBe(1);
      expect(filtered[0].email).toBe('bob@test.com');
    });
  });

  describe('getGroupNames', () => {
    it('should return comma-separated names', () => {
      expect(component.getGroupNames(mockUsers[0])).toBe('Admin, Editors');
    });

    it('should return "-" for no groups', () => {
      expect(component.getGroupNames(mockUsers[1])).toBe('-');
    });

    it('should return "-" for undefined groups', () => {
      expect(component.getGroupNames({ id: 99, displayName: 'X', email: 'x@x.com' })).toBe('-');
    });
  });

  describe('navigateToUser', () => {
    it('should navigate to /admin/users/:id', () => {
      vi.spyOn(router, 'navigate').mockResolvedValue(true);
      component.navigateToUser(42);
      expect(router.navigate).toHaveBeenCalledWith(['/admin/users', 42]);
    });
  });
});
