import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { FeatureNewPage } from './feature-new-page';
import { DesignFeatureService } from '../../../../services/design-feature.service';
import { ProjectService } from '../../../../services/project.service';

describe('FeatureNewPage', () => {
    let component: FeatureNewPage;
    let fixture: ComponentFixture<FeatureNewPage>;
    let featureService: DesignFeatureService;
    let router: Router;

    beforeEach(async () => {
        const createSpy = vi.fn().mockReturnValue(of({ id: 99, name: 'New', slug: 'new', projectID: 1, reviewState: 'draft' }));

        await TestBed.configureTestingModule({
            imports: [FeatureNewPage],
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                provideAnimationsAsync(),
                provideRouter([]),
                {
                    provide: DesignFeatureService,
                    useValue: { create: createSpy },
                },
                {
                    provide: ProjectService,
                    useValue: {
                        getProjects: () => of([{ id: 1, name: 'Letwinventory', shortName: 'Inv', activeFlag: true }]),
                        getAll: () => of([{ id: 1, name: 'Letwinventory', shortName: 'Inv', activeFlag: true }]),
                    },
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(FeatureNewPage);
        component = fixture.componentInstance;
        featureService = TestBed.inject(DesignFeatureService);
        router = TestBed.inject(Router);
        fixture.detectChanges();
    });

    it('creates the component', () => {
        expect(component).toBeTruthy();
    });

    it('renders name and project inputs', () => {
        expect(fixture.nativeElement.querySelector('input[name="name"], [data-test="input-name"]')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('mat-select, select, [data-test="select-project"]')).not.toBeNull();
    });

    it('disables submit when name is empty', () => {
        const submit = fixture.nativeElement.querySelector('[data-test="submit"]') as HTMLButtonElement;
        expect(submit).not.toBeNull();
        expect(submit.disabled).toBe(true);
    });

    it('navigates to /features/:id/edit on successful create', async () => {
        const navSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
        (component as any).name?.set('My Feature');
        (component as any).projectID?.set(1);
        await (component as any).submit?.();
        expect(navSpy).toHaveBeenCalledWith(['/features', 99, 'edit']);
    });
});
