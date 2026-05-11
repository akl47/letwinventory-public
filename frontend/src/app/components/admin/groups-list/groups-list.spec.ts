import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, Router, ActivatedRoute } from '@angular/router';
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
        { provide: ActivatedRoute, useValue: { queryParams: of({}), snapshot: { queryParams: {} } } },
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

  it('creates', () => {
    expect(component).toBeTruthy();
  });

  it('loads groups on init', () => {
    expect(adminService.getGroups).toHaveBeenCalled();
    expect(component.groups()).toEqual(mockGroups);
  });

  it('sets empty array on error', () => {
    vi.spyOn(adminService, 'getGroups').mockReturnValue(throwError(() => new Error('fail')));
    component.loadGroups();
    expect(component.groups()).toEqual([]);
  });

  it('renders via <app-data-table>', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('app-data-table')).toBeTruthy();
  });

  it('navigates to new group', () => {
    component.navigateToNew();
    expect(router.navigate).toHaveBeenCalledWith(['/admin/groups/new']);
  });

  it('navigates to edit group', () => {
    component.navigateToEdit(5);
    expect(router.navigate).toHaveBeenCalledWith(['/admin/groups', 5]);
  });

  it('deletes group and reloads', () => {
    vi.spyOn(adminService, 'getGroups').mockReturnValue(of([mockGroups[1]]));
    component.deleteGroup(1);
    expect(adminService.deleteGroup).toHaveBeenCalledWith(1);
    expect(component.groups()!.length).toBe(1);
  });
});
