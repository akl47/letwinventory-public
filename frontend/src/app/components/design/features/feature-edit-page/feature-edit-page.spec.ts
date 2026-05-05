import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';

import { FeatureEditPage } from './feature-edit-page';
import { DesignFeatureService } from '../../../../services/design-feature.service';
import { DesignRequirementService } from '../../../../services/design-requirement.service';
import { ProjectService } from '../../../../services/project.service';
import { AuthService } from '../../../../services/auth.service';
import { DesignFeature } from '../../../../models/design-feature.model';

describe('FeatureEditPage', () => {
    let component: FeatureEditPage;
    let fixture: ComponentFixture<FeatureEditPage>;
    let featureService: DesignFeatureService;

    const mockFeature: DesignFeature = {
        id: 1, name: 'Kitting', slug: 'kitting',
        description: 'A kitting feature',
        markdownBody: '# Kitting\n\nBody.',
        projectID: 1, ownerUserID: 1, reviewState: 'draft',
        branchName: 'feature/kitting',
        prURL: 'https://github.com/akl47/letwinventory/pull/1',
        commitRefs: [{ sha: 'abc1234', url: 'https://github.com/akl47/letwinventory/commit/abc1234' }],
        activeFlag: true, createdAt: new Date(), updatedAt: new Date(),
        requirements: [],
    };

    function setup(featureOverrides: Partial<DesignFeature> = {}, hasPermission = true) {
        const feature: DesignFeature = { ...mockFeature, ...featureOverrides };
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            imports: [FeatureEditPage],
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                provideAnimationsAsync(),
                provideRouter([]),
                {
                    provide: ActivatedRoute,
                    useValue: { snapshot: { params: { id: '1' }, queryParams: {} } },
                },
                {
                    provide: DesignFeatureService,
                    useValue: {
                        getById: () => of(feature),
                        update: () => of(feature),
                        submit: () => of({ ...feature, reviewState: 'in_review' }),
                        approve: () => of({ ...feature, reviewState: 'approved' }),
                        reject: () => of({ ...feature, reviewState: 'draft' }),
                        release: () => of({ ...feature, reviewState: 'released' }),
                        linkRequirement: () => of({ success: true }),
                        unlinkRequirement: () => of({ success: true }),
                        getHistory: () => of([]),
                    },
                },
                {
                    provide: DesignRequirementService,
                    useValue: { getAll: () => of([]) },
                },
                {
                    provide: ProjectService,
                    useValue: { getProjects: () => of([]), getAll: () => of([]) },
                },
                {
                    provide: AuthService,
                    useValue: {
                        hasPermission: () => hasPermission,
                        currentUser: () => ({ id: 1, displayName: 'Test', email: 't@t.com' }),
                    },
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(FeatureEditPage);
        component = fixture.componentInstance;
        featureService = TestBed.inject(DesignFeatureService);
        fixture.detectChanges();
    }

    it('creates and loads the feature', () => {
        setup();
        expect(component).toBeTruthy();
        expect(fixture.nativeElement.textContent).toContain('Kitting');
    });

    it('renders the markdown body section', () => {
        setup();
        const body = fixture.nativeElement.querySelector('[data-test="markdown-body"], .markdown-body');
        expect(body).not.toBeNull();
    });

    it('renders the GitHub links panel with branch and PR', () => {
        setup();
        const panel = fixture.nativeElement.querySelector('[data-test="github-links"], .github-links');
        expect(panel).not.toBeNull();
        expect(panel.textContent).toContain('feature/kitting');
    });

    it('renders the Linked Requirements panel', () => {
        setup();
        const panel = fixture.nativeElement.querySelector('[data-test="linked-requirements"], .linked-requirements');
        expect(panel).not.toBeNull();
    });

    it('shows Submit button on a draft feature', () => {
        setup({ reviewState: 'draft' });
        const submit = fixture.nativeElement.querySelector('[data-test="action-submit"]');
        expect(submit).not.toBeNull();
    });

    it('shows Approve and Reject buttons on an in_review feature', () => {
        setup({ reviewState: 'in_review' });
        expect(fixture.nativeElement.querySelector('[data-test="action-approve"]')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('[data-test="action-reject"]')).not.toBeNull();
    });

    it('shows Release button on an approved feature', () => {
        setup({ reviewState: 'approved' });
        expect(fixture.nativeElement.querySelector('[data-test="action-release"]')).not.toBeNull();
    });

    it('disables Approve button without features.approve permission', () => {
        setup({ reviewState: 'in_review' }, /* hasPermission */ false);
        const approve = fixture.nativeElement.querySelector('[data-test="action-approve"]') as HTMLButtonElement;
        expect(approve).not.toBeNull();
        expect(approve.disabled).toBe(true);
    });

    it('shows a read-only banner on a released feature', () => {
        setup({ reviewState: 'released' });
        const banner = fixture.nativeElement.querySelector('[data-test="readonly-banner"], .readonly-banner');
        expect(banner).not.toBeNull();
    });

    it('renders the history timeline section', () => {
        setup();
        const timeline = fixture.nativeElement.querySelector('[data-test="history-timeline"], .history-timeline');
        expect(timeline).not.toBeNull();
    });
});
