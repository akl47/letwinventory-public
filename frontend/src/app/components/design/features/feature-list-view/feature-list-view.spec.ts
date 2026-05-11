import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';

import { FeatureListView } from './feature-list-view';
import { DesignFeatureService } from '../../../../services/design-feature.service';
import { ProjectService } from '../../../../services/project.service';
import { AuthService } from '../../../../services/auth.service';
import { DesignFeature } from '../../../../models/design-feature.model';
import { Project } from '../../../../models/project.model';

describe('FeatureListView', () => {
  let component: FeatureListView;
  let fixture: ComponentFixture<FeatureListView>;

  const mockProjects: Project[] = [
    { id: 1, ownerUserID: 1, tagColorHex: 'ff0000', name: 'Project A', shortName: 'A', activeFlag: true, createdAt: new Date(), updatedAt: new Date() },
    { id: 2, ownerUserID: 1, tagColorHex: '00ff00', name: 'Project B', shortName: 'B', activeFlag: true, createdAt: new Date(), updatedAt: new Date() },
  ];

  const mockFeatures: DesignFeature[] = [
    {
      id: 1, name: 'Kitting', slug: 'kitting', description: 'BOM kitting',
      projectID: 1, ownerUserID: 1, reviewState: 'released',
      commitRefs: [], activeFlag: true,
      createdAt: new Date(), updatedAt: new Date(),
    },
    {
      id: 2, name: 'Build', slug: 'build', description: 'Build flow',
      projectID: 1, ownerUserID: 1, reviewState: 'in_review',
      commitRefs: [], activeFlag: true,
      createdAt: new Date(), updatedAt: new Date(),
    },
    {
      id: 3, name: 'Outline', slug: 'outline', description: 'Tool outline',
      projectID: 2, ownerUserID: 2, reviewState: 'draft',
      commitRefs: [], activeFlag: true,
      createdAt: new Date(), updatedAt: new Date(),
    },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FeatureListView],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParams: {} }, queryParams: of({}) } },
        { provide: DesignFeatureService, useValue: { getAll: () => of(mockFeatures) } },
        { provide: ProjectService, useValue: { getProjects: () => of(mockProjects), getAll: () => of(mockProjects) } },
        { provide: AuthService, useValue: { hasPermission: () => true, currentUser: () => ({ id: 1, displayName: 'Test', email: 't@t.com' }) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FeatureListView);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('creates', () => {
    expect(component).toBeTruthy();
  });

  it('loads features and projects on init', () => {
    expect(component.features().length).toBe(3);
    expect(component.projects().length).toBe(2);
    expect(component.loading()).toBe(false);
  });

  it('renders via <app-data-table>', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('app-data-table')).toBeTruthy();
  });

  it('exposes a multiSelect filter section for projects', () => {
    const projectSection = component.filterSections().find(s => s.key === 'projects');
    if (!projectSection || projectSection.type !== 'multiSelect') {
      throw new Error('expected multiSelect projects section');
    }
    expect(projectSection.options.map(o => o.id)).toEqual([1, 2]);
    expect(projectSection.accessor(mockFeatures[0])).toBe(1);
  });

  it('exposes a multiSelect filter section for reviewState', () => {
    const stateSection = component.filterSections().find(s => s.key === 'reviewState');
    if (!stateSection || stateSection.type !== 'multiSelect') {
      throw new Error('expected multiSelect reviewState section');
    }
    expect(stateSection.options.map(o => o.id)).toEqual(['draft', 'in_review', 'approved', 'released']);
    expect(stateSection.accessor(mockFeatures[0])).toBe('released');
  });

  it('projectName resolves names via the projectMap', () => {
    expect(component.projectName(1)).toBe('Project A');
    expect(component.projectName(999)).toBe('—');
  });

  it('stateVariant maps review states to badge variants', () => {
    expect(component.stateVariant('approved')).toBe('success');
    expect(component.stateVariant('released')).toBe('info');
    expect(component.stateVariant('draft')).toBe('neutral');
    expect(component.stateVariant('in_review')).toBe('warning');
  });
});
