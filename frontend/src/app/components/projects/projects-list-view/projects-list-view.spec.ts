import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, ActivatedRoute } from '@angular/router';
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
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProjectsListView],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { queryParams: of({}), snapshot: { queryParams: {} } } },
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

  it('creates', () => {
    expect(component).toBeTruthy();
  });

  it('loads projects on init', () => {
    expect(projectService.clearCache).toHaveBeenCalled();
    expect(projectService.getProjects).toHaveBeenCalled();
    expect(component.allProjects().length).toBe(2);
  });

  it('renders via <app-data-table>', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('app-data-table')).toBeTruthy();
  });

  it('goBack calls location.back', () => {
    vi.spyOn(location, 'back');
    component.goBack();
    expect(location.back).toHaveBeenCalled();
  });
});
