import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { Location } from '@angular/common';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { ProjectsListView } from './projects-list-view';
import { ProjectService } from '../../../services/project.service';
import { Project } from '../../../models/project.model';

describe('ProjectsListView', () => {
  let component: ProjectsListView;
  let fixture: ComponentFixture<ProjectsListView>;
  let projectService: ProjectService;
  let location: Location;

  const mockProjects: Project[] = [
    { id: 1, ownerUserID: 1, tagColorHex: 'ff0000', name: 'Project Alpha', shortName: 'PA', description: 'First project', keyboardShortcut: '1', activeFlag: true, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') },
    { id: 2, ownerUserID: 1, tagColorHex: '00ff00', name: 'Project Beta', shortName: 'PB', description: 'Second project', keyboardShortcut: '2', activeFlag: true, createdAt: new Date('2026-01-15'), updatedAt: new Date('2026-01-15') },
    { id: 3, ownerUserID: 1, tagColorHex: '0000ff', name: 'Inactive Project', shortName: 'IP', description: 'Archived', activeFlag: false, createdAt: new Date('2025-12-01'), updatedAt: new Date('2025-12-01') },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProjectsListView],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
      ],
    }).compileComponents();

    projectService = TestBed.inject(ProjectService);
    location = TestBed.inject(Location);
    vi.spyOn(projectService, 'clearCache');
    vi.spyOn(projectService, 'getProjects').mockReturnValue(of(mockProjects));

    fixture = TestBed.createComponent(ProjectsListView);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load projects on init', () => {
    expect(projectService.clearCache).toHaveBeenCalled();
    expect(projectService.getProjects).toHaveBeenCalled();
    expect(component.allProjects().length).toBe(3);
  });

  it('should filter inactive projects by default', () => {
    const displayed = component.displayedProjects();
    expect(displayed.every(p => p.activeFlag === true)).toBe(true);
    expect(displayed.length).toBe(2);
  });

  describe('goBack', () => {
    it('should call location.back', () => {
      vi.spyOn(location, 'back');
      component.goBack();
      expect(location.back).toHaveBeenCalled();
    });
  });

  describe('applyFiltersAndSort', () => {
    it('should include inactive when showInactive is true', () => {
      component.onToggleInactive(true);
      expect(component.displayedProjects().length).toBe(3);
    });

    it('should filter by search text on name', () => {
      component.onSearchChange('alpha');
      expect(component.displayedProjects().length).toBe(1);
      expect(component.displayedProjects()[0].name).toBe('Project Alpha');
    });

    it('should filter by search text on shortName', () => {
      component.onSearchChange('PB');
      expect(component.displayedProjects().length).toBe(1);
    });

    it('should filter by description', () => {
      component.onSearchChange('second');
      expect(component.displayedProjects().length).toBe(1);
    });

    it('should sort by name ascending by default', () => {
      const displayed = component.displayedProjects();
      expect(displayed[0].name).toBe('Project Alpha');
      expect(displayed[1].name).toBe('Project Beta');
    });

    it('should sort descending when set', () => {
      component.onSortChange({ active: 'name', direction: 'desc' });
      const displayed = component.displayedProjects();
      expect(displayed[0].name).toBe('Project Beta');
    });
  });

  describe('onSearchChange', () => {
    it('should reset page index', () => {
      component.pageIndex.set(3);
      component.onSearchChange('test');
      expect(component.pageIndex()).toBe(0);
    });
  });

  describe('onPageChange', () => {
    it('should update pagination', () => {
      component.onPageChange({ pageIndex: 2, pageSize: 5, length: 50 });
      expect(component.pageIndex()).toBe(2);
      expect(component.pageSize()).toBe(5);
    });
  });

  describe('onSortChange', () => {
    it('should update sort settings', () => {
      component.onSortChange({ active: 'createdAt', direction: 'desc' });
      expect(component.sortColumn()).toBe('createdAt');
      expect(component.sortDirection()).toBe('desc');
    });
  });

  describe('onToggleInactive', () => {
    it('should reset page index', () => {
      component.pageIndex.set(2);
      component.onToggleInactive(true);
      expect(component.pageIndex()).toBe(0);
    });
  });

  describe('getTotalCount', () => {
    it('should return count of active filtered projects', () => {
      expect(component.getTotalCount()).toBe(2);
    });

    it('should include inactive when showInactive is true', () => {
      component.showInactive.set(true);
      expect(component.getTotalCount()).toBe(3);
    });

    it('should respect search filter', () => {
      component.searchText.set('alpha');
      expect(component.getTotalCount()).toBe(1);
    });
  });

  describe('pagination', () => {
    it('should paginate correctly', () => {
      component.pageSize.set(1);
      component.applyFiltersAndSort();
      expect(component.displayedProjects().length).toBe(1);

      component.pageIndex.set(1);
      component.applyFiltersAndSort();
      expect(component.displayedProjects().length).toBe(1);
    });
  });

  describe('sorting edge cases', () => {
    it('should sort nulls last', () => {
      const projectsWithNulls: Project[] = [
        { ...mockProjects[0], keyboardShortcut: undefined },
        { ...mockProjects[1], keyboardShortcut: '5' },
      ];
      component.allProjects.set(projectsWithNulls);
      component.onSortChange({ active: 'keyboardShortcut', direction: 'asc' });
      const displayed = component.displayedProjects();
      // Non-null should come first in asc
      expect(displayed[0].keyboardShortcut).toBe('5');
    });
  });
});
