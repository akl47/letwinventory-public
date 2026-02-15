import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { SubToolbarComponent } from './sub-toolbar';
import { ProjectService } from '../../../services/project.service';

describe('SubToolbar', () => {
  let component: SubToolbarComponent;
  let fixture: ComponentFixture<SubToolbarComponent>;
  let router: Router;

  const mockProjects = [
    { id: 1, name: 'Alpha', shortName: 'A', tagColorHex: 'ff0000', activeFlag: true },
    { id: 2, name: 'Beta', shortName: 'B', tagColorHex: '00ff00', activeFlag: true },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SubToolbarComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    const projectService = TestBed.inject(ProjectService);
    vi.spyOn(projectService, 'getProjects').mockReturnValue(of(mockProjects as any));
    router = TestBed.inject(Router);

    fixture = TestBed.createComponent(SubToolbarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('initial state', () => {
    it('should load projects on init', () => {
      expect(component.projects().length).toBe(2);
    });

    it('should select all projects by default', () => {
      expect(component.selectedProjectIds().has(1)).toBe(true);
      expect(component.selectedProjectIds().has(2)).toBe(true);
    });

    it('should show no-project tasks by default', () => {
      expect(component.showNoProject()).toBe(true);
    });

    it('should show child tasks by default', () => {
      expect(component.showChildTasks()).toBe(true);
    });
  });

  describe('allProjectsSelected', () => {
    it('should return true when all selected and showNoProject is true', () => {
      expect(component.allProjectsSelected()).toBe(true);
    });

    it('should return false when one project deselected', () => {
      component.toggleProject(1);
      expect(component.allProjectsSelected()).toBe(false);
    });

    it('should return false when showNoProject is false', () => {
      component.toggleNoProject();
      expect(component.allProjectsSelected()).toBe(false);
    });
  });

  describe('someProjectsSelected', () => {
    it('should return false when all selected', () => {
      expect(component.someProjectsSelected()).toBe(false);
    });

    it('should return true when partially selected', () => {
      component.toggleProject(1);
      expect(component.someProjectsSelected()).toBe(true);
    });
  });

  describe('activeFilterCount', () => {
    it('should return 0 when all visible', () => {
      expect(component.activeFilterCount()).toBe(0);
    });

    it('should count hidden projects', () => {
      component.toggleProject(1);
      expect(component.activeFilterCount()).toBe(1);
    });

    it('should count hidden no-project', () => {
      component.toggleNoProject();
      expect(component.activeFilterCount()).toBe(1);
    });
  });

  describe('isProjectSelected', () => {
    it('should return true for selected project', () => {
      expect(component.isProjectSelected(1)).toBe(true);
    });

    it('should return false for deselected project', () => {
      component.toggleProject(1);
      expect(component.isProjectSelected(1)).toBe(false);
    });
  });

  describe('toggleProject', () => {
    it('should deselect a selected project', () => {
      vi.spyOn(component.projectFilterChanged, 'emit');
      component.toggleProject(1);
      expect(component.selectedProjectIds().has(1)).toBe(false);
      expect(component.projectFilterChanged.emit).toHaveBeenCalled();
    });

    it('should select a deselected project', () => {
      component.toggleProject(1);
      component.toggleProject(1);
      expect(component.selectedProjectIds().has(1)).toBe(true);
    });
  });

  describe('toggleAllProjects', () => {
    it('should deselect all when all selected', () => {
      vi.spyOn(component.projectFilterChanged, 'emit');
      vi.spyOn(component.showNoProjectChanged, 'emit');
      component.toggleAllProjects();
      expect(component.selectedProjectIds().size).toBe(0);
      expect(component.showNoProject()).toBe(false);
    });

    it('should select all when some deselected', () => {
      component.toggleProject(1);
      component.toggleAllProjects();
      expect(component.selectedProjectIds().size).toBe(2);
      expect(component.showNoProject()).toBe(true);
    });
  });

  describe('toggleNoProject', () => {
    it('should toggle showNoProject and emit', () => {
      vi.spyOn(component.showNoProjectChanged, 'emit');
      component.toggleNoProject();
      expect(component.showNoProject()).toBe(false);
      expect(component.showNoProjectChanged.emit).toHaveBeenCalledWith(false);
    });
  });

  describe('onShowChildTasksChange', () => {
    it('should set showChildTasks and emit', () => {
      vi.spyOn(component.showChildTasksChanged, 'emit');
      component.onShowChildTasksChange(false);
      expect(component.showChildTasks()).toBe(false);
      expect(component.showChildTasksChanged.emit).toHaveBeenCalledWith(false);
    });
  });

  describe('selectedProjects', () => {
    it('should return filtered list of selected projects', () => {
      component.toggleProject(2);
      expect(component.selectedProjects().length).toBe(1);
      expect(component.selectedProjects()[0].id).toBe(1);
    });
  });

  describe('navigation', () => {
    it('should navigate to /projects', () => {
      vi.spyOn(router, 'navigate');
      component.openEditProjects();
      expect(router.navigate).toHaveBeenCalledWith(['/projects']);
    });

    it('should navigate to /scheduled-tasks', () => {
      vi.spyOn(router, 'navigate');
      component.openScheduledTasks();
      expect(router.navigate).toHaveBeenCalledWith(['/scheduled-tasks']);
    });
  });

  describe('menuExpanded', () => {
    it('should default to false', () => {
      expect(component.menuExpanded()).toBe(false);
    });
  });

  describe('initial values from URL', () => {
    it('should apply initialProjectIds when set', () => {
      component.initialProjectIds = [1];
      component.initialShowNoProject = false;
      component.ngOnChanges({
        initialProjectIds: { currentValue: [1], previousValue: null, firstChange: true, isFirstChange: () => true },
      } as any);
      expect(component.selectedProjectIds().has(1)).toBe(true);
      expect(component.selectedProjectIds().has(2)).toBe(false);
      expect(component.showNoProject()).toBe(false);
    });
  });
});
