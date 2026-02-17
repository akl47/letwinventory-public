import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { GroupsList } from './groups-list';
import { AdminService } from '../../../services/admin.service';
import { UserGroup } from '../../../models/permission.model';

describe('GroupsList', () => {
  let component: GroupsList;
  let fixture: ComponentFixture<GroupsList>;
  let adminService: AdminService;
  let router: Router;

  const mockGroups: UserGroup[] = [
    { id: 1, name: 'Admin', description: 'Administrators', memberCount: 3 },
    { id: 2, name: 'Viewers', description: 'Read-only users', memberCount: 5 },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GroupsList],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
      ],
    }).compileComponents();

    adminService = TestBed.inject(AdminService);
    router = TestBed.inject(Router);
    vi.spyOn(adminService, 'getGroups').mockReturnValue(of(mockGroups));
    vi.spyOn(adminService, 'deleteGroup').mockReturnValue(of({}));
    vi.spyOn(router, 'navigate').mockResolvedValue(true);

    fixture = TestBed.createComponent(GroupsList);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load groups on init', () => {
    expect(adminService.getGroups).toHaveBeenCalled();
    expect(component.groups()).toEqual(mockGroups);
    expect(component.groups()!.length).toBe(2);
  });

  it('should set empty array on error', () => {
    vi.spyOn(adminService, 'getGroups').mockReturnValue(throwError(() => new Error('fail')));
    component.loadGroups();
    expect(component.groups()).toEqual([]);
  });

  it('should navigate to new group', () => {
    component.navigateToNew();
    expect(router.navigate).toHaveBeenCalledWith(['/admin/groups/new']);
  });

  it('should navigate to edit group', () => {
    component.navigateToEdit(5);
    expect(router.navigate).toHaveBeenCalledWith(['/admin/groups', 5]);
  });

  it('should delete group and reload', () => {
    vi.spyOn(adminService, 'getGroups').mockReturnValue(of([mockGroups[1]]));
    component.deleteGroup(1);
    expect(adminService.deleteGroup).toHaveBeenCalledWith(1);
    // After delete, loadGroups is called again
    expect(component.groups()!.length).toBe(1);
  });
});
