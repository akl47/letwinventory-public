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
    let featureService: DesignFeatureService;

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
                { provide: ActivatedRoute, useValue: { snapshot: { queryParams: {} } } },
                {
                    provide: DesignFeatureService,
                    useValue: { getAll: () => of(mockFeatures) },
                },
                {
                    provide: ProjectService,
                    useValue: { getProjects: () => of(mockProjects), getAll: () => of(mockProjects) },
                },
                {
                    provide: AuthService,
                    useValue: {
                        hasPermission: () => true,
                        currentUser: () => ({ id: 1, displayName: 'Test', email: 't@t.com' }),
                    },
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(FeatureListView);
        component = fixture.componentInstance;
        featureService = TestBed.inject(DesignFeatureService);
        fixture.detectChanges();
    });

    it('creates the component', () => {
        expect(component).toBeTruthy();
    });

    it('renders all features in the table', () => {
        const rows = fixture.nativeElement.querySelectorAll('tr.feature-row, mat-row');
        expect(rows.length).toBeGreaterThanOrEqual(3);
    });

    it('groups features by project', () => {
        // Either groups visually present or component exposes a grouped() signal.
        const grouped = (component as any).groupedFeatures?.() || (component as any).featureGroups?.();
        expect(grouped).toBeDefined();
        expect(grouped.length).toBe(2); // two distinct projects in mock data
    });

    it('filters by review state', () => {
        (component as any).selectedReviewState?.set('in_review');
        fixture.detectChanges();
        const visible = (component as any).filteredFeatures?.() ?? [];
        expect(visible.length).toBe(1);
        expect(visible[0].slug).toBe('build');
    });

    it('shows empty state when there are no features', () => {
        TestBed.resetTestingModule();
        // Re-create with empty list
        TestBed.configureTestingModule({
            imports: [FeatureListView],
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                provideAnimationsAsync(),
                provideRouter([]),
                { provide: ActivatedRoute, useValue: { snapshot: { queryParams: {} } } },
                { provide: DesignFeatureService, useValue: { getAll: () => of([]) } },
                { provide: ProjectService, useValue: { getProjects: () => of(mockProjects), getAll: () => of(mockProjects) } },
                { provide: AuthService, useValue: { hasPermission: () => true, currentUser: () => null } },
            ],
        });
        const emptyFix = TestBed.createComponent(FeatureListView);
        emptyFix.detectChanges();
        const empty = emptyFix.nativeElement.querySelector('.empty-state, [data-test="empty"]');
        expect(empty).not.toBeNull();
    });
});
