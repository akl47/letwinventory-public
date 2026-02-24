import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, ActivatedRoute, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { RequirementEditPage } from './requirement-edit-page';
import { DesignRequirementService } from '../../../services/design-requirement.service';
import { RequirementCategoryService } from '../../../services/requirement-category.service';
import { ProjectService } from '../../../services/project.service';
import { AuthService } from '../../../services/auth.service';
import { DesignRequirement, RequirementCategory, RequirementHistoryEntry } from '../../../models/design-requirement.model';
import { Project } from '../../../models/project.model';

describe('RequirementEditPage', () => {
    let component: RequirementEditPage;
    let fixture: ComponentFixture<RequirementEditPage>;
    let requirementService: DesignRequirementService;
    let categoryService: RequirementCategoryService;
    let projectService: ProjectService;
    let authService: AuthService;
    let router: Router;

    const mockProjects: Project[] = [
        { id: 1, ownerUserID: 1, tagColorHex: 'ff0000', name: 'Alpha', shortName: 'A', activeFlag: true, createdAt: new Date(), updatedAt: new Date() },
    ];

    const mockCategories: RequirementCategory[] = [
        { id: 1, name: 'Functional', activeFlag: true },
        { id: 2, name: 'Safety', activeFlag: true },
    ];

    const mockAllRequirements: DesignRequirement[] = [
        { id: 1, description: 'Parent req', projectID: 1, ownerUserID: 1, approved: false, activeFlag: true, createdAt: new Date(), updatedAt: new Date() },
        { id: 2, description: 'Child req', parentRequirementID: 1, projectID: 1, ownerUserID: 1, approved: false, activeFlag: true, createdAt: new Date(), updatedAt: new Date() },
    ];

    const mockRequirement: DesignRequirement = {
        id: 2, description: 'Child req', rationale: 'Because', parameter: 'P1',
        parentRequirementID: 1, projectID: 1, categoryID: 1,
        verification: 'Test it', validation: 'Review it',
        ownerUserID: 1, approved: false, activeFlag: true,
        createdAt: new Date(), updatedAt: new Date(),
        owner: { id: 1, displayName: 'Alice', email: 'alice@test.com' },
        category: { id: 1, name: 'Functional', activeFlag: true },
    };

    const mockHistory: RequirementHistoryEntry[] = [
        { id: 1, requirementID: 2, changedByUserID: 1, changeType: 'created', changes: { description: { from: null, to: 'Child req' } }, createdAt: '2026-01-01', changedBy: { id: 1, displayName: 'Alice', email: 'alice@test.com' } },
    ];

    function setupTestBed(routeParams: Record<string, string> = {}) {
        return TestBed.configureTestingModule({
            imports: [RequirementEditPage],
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                provideAnimationsAsync(),
                provideRouter([]),
                { provide: ActivatedRoute, useValue: { params: of(routeParams), snapshot: { params: routeParams, queryParams: {} } } },
            ],
        }).compileComponents();
    }

    describe('create mode (no id param)', () => {
        beforeEach(async () => {
            await setupTestBed({});

            requirementService = TestBed.inject(DesignRequirementService);
            categoryService = TestBed.inject(RequirementCategoryService);
            projectService = TestBed.inject(ProjectService);
            authService = TestBed.inject(AuthService);
            router = TestBed.inject(Router);

            vi.spyOn(projectService, 'getProjects').mockReturnValue(of(mockProjects));
            vi.spyOn(categoryService, 'getAll').mockReturnValue(of(mockCategories));
            vi.spyOn(requirementService, 'getAll').mockReturnValue(of(mockAllRequirements));
            vi.spyOn(authService, 'hasPermission').mockReturnValue(true);
            vi.spyOn(router, 'navigate').mockResolvedValue(true);

            fixture = TestBed.createComponent(RequirementEditPage);
            component = fixture.componentInstance;
            fixture.detectChanges();
            await fixture.whenStable();
        });

        it('should create', () => {
            expect(component).toBeTruthy();
        });

        it('should be in create mode', () => {
            expect(component.isEditMode).toBe(false);
            expect(component.isFormEditMode()).toBe(true);
            expect(component.isDataLoaded()).toBe(true);
        });

        it('should load reference data', () => {
            expect(component.projects().length).toBe(1);
            expect(component.categories().length).toBe(2);
            expect(component.allRequirements().length).toBe(2);
        });

        it('should have form enabled in create mode', () => {
            expect(component.form.enabled).toBe(true);
        });

        it('should not save when form is invalid', () => {
            const spy = vi.spyOn(requirementService, 'create');
            component.save();
            expect(spy).not.toHaveBeenCalled();
        });

        it('should create requirement and navigate on save', () => {
            const created = { ...mockRequirement, id: 10 };
            vi.spyOn(requirementService, 'create').mockReturnValue(of(created));

            component.form.patchValue({ projectID: 1, description: 'New requirement' });
            component.save();

            expect(requirementService.create).toHaveBeenCalled();
            expect(router.navigate).toHaveBeenCalledWith(['/requirements', 10, 'edit'], expect.objectContaining({ queryParams: {} }));
        });

        it('cancelEdit in create mode should navigate to list', () => {
            component.cancelEdit();
            expect(router.navigate).toHaveBeenCalledWith(['/requirements'], expect.objectContaining({ queryParams: {} }));
        });

        it('getParentOptions should return all requirements when no current', () => {
            expect(component.getParentOptions().length).toBe(2);
        });
    });

    describe('edit mode (with id param)', () => {
        beforeEach(async () => {
            await setupTestBed({ id: '2' });

            requirementService = TestBed.inject(DesignRequirementService);
            categoryService = TestBed.inject(RequirementCategoryService);
            projectService = TestBed.inject(ProjectService);
            authService = TestBed.inject(AuthService);
            router = TestBed.inject(Router);

            vi.spyOn(projectService, 'getProjects').mockReturnValue(of(mockProjects));
            vi.spyOn(categoryService, 'getAll').mockReturnValue(of(mockCategories));
            vi.spyOn(requirementService, 'getAll').mockReturnValue(of(mockAllRequirements));
            vi.spyOn(requirementService, 'getById').mockReturnValue(of(mockRequirement));
            vi.spyOn(authService, 'hasPermission').mockReturnValue(true);
            vi.spyOn(authService, 'currentUser').mockReturnValue({ id: 1, displayName: 'Alice', email: 'alice@test.com' });
            vi.spyOn(router, 'navigate').mockResolvedValue(true);

            fixture = TestBed.createComponent(RequirementEditPage);
            component = fixture.componentInstance;
            fixture.detectChanges();
            await fixture.whenStable();
        });

        it('should be in edit mode with form disabled (view mode)', () => {
            expect(component.isEditMode).toBe(true);
            expect(component.isFormEditMode()).toBe(false);
            expect(component.form.disabled).toBe(true);
            expect(component.isDataLoaded()).toBe(true);
        });

        it('should load the requirement by id', () => {
            expect(requirementService.getById).toHaveBeenCalledWith(2);
            expect(component.currentRequirement()).toBeTruthy();
            expect(component.currentRequirement()!.id).toBe(2);
        });

        it('should populate form with requirement data', () => {
            const raw = component.form.getRawValue();
            expect(raw.description).toBe('Child req');
            expect(raw.rationale).toBe('Because');
            expect(raw.projectID).toBe(1);
            expect(raw.categoryID).toBe(1);
            expect(raw.parentRequirementID).toBe(1);
        });

        it('enableEdit should enable the form', () => {
            component.enableEdit();
            expect(component.isFormEditMode()).toBe(true);
            expect(component.form.enabled).toBe(true);
        });

        it('cancelEdit in edit mode should disable form and reload', () => {
            component.enableEdit();
            component.cancelEdit();
            expect(component.isFormEditMode()).toBe(false);
            expect(component.form.disabled).toBe(true);
        });

        it('save in edit mode should call update', () => {
            vi.spyOn(requirementService, 'update').mockReturnValue(of(mockRequirement));
            component.enableEdit();
            component.form.patchValue({ description: 'Updated description' });
            component.save();
            expect(requirementService.update).toHaveBeenCalledWith(2, expect.objectContaining({ description: 'Updated description' }));
        });

        it('should call approve and reload', () => {
            vi.spyOn(requirementService, 'approve').mockReturnValue(of({ ...mockRequirement, approved: true }));
            component.approve();
            expect(requirementService.approve).toHaveBeenCalledWith(2);
        });

        it('should call unapprove and reload', () => {
            vi.spyOn(requirementService, 'unapprove').mockReturnValue(of({ ...mockRequirement, approved: false }));
            component.unapprove();
            expect(requirementService.unapprove).toHaveBeenCalledWith(2);
        });

        it('should call delete and navigate to list', () => {
            vi.spyOn(requirementService, 'delete').mockReturnValue(of({}));
            component.deleteRequirement();
            expect(requirementService.delete).toHaveBeenCalledWith(2);
            expect(router.navigate).toHaveBeenCalledWith(['/requirements'], expect.objectContaining({ queryParams: {} }));
        });

        it('isOwner should return true when current user is owner', () => {
            expect(component.isOwner()).toBe(true);
        });

        it('isOwner should return false when current user is not owner', () => {
            vi.spyOn(authService, 'currentUser').mockReturnValue({ id: 99, displayName: 'Other', email: 'other@test.com' });
            expect(component.isOwner()).toBe(false);
        });

        it('getParentOptions should exclude current requirement', () => {
            const options = component.getParentOptions();
            expect(options.find(r => r.id === 2)).toBeUndefined();
            expect(options.find(r => r.id === 1)).toBeTruthy();
        });

        it('hasFormChanges should detect description change', () => {
            component.enableEdit();
            expect(component.hasFormChanges()).toBe(false);
            component.form.patchValue({ description: 'Something different' });
            expect(component.hasFormChanges()).toBe(true);
        });

        it('displayParentFn should format parent requirement', () => {
            expect(component.displayParentFn(1)).toContain('#1');
            expect(component.displayParentFn(1)).toContain('Parent req');
        });

        it('displayParentFn should return empty string for null', () => {
            expect(component.displayParentFn(null)).toBe('');
        });

        it('clearParent should reset parentRequirementID', () => {
            component.enableEdit();
            component.clearParent();
            expect(component.form.get('parentRequirementID')!.value).toBeNull();
        });

        describe('history', () => {
            it('toggleHistory should load history on first toggle', () => {
                vi.spyOn(requirementService, 'getHistory').mockReturnValue(of(mockHistory));
                expect(component.showHistory()).toBe(false);
                component.toggleHistory();
                expect(component.showHistory()).toBe(true);
                expect(requirementService.getHistory).toHaveBeenCalledWith(2);
                expect(component.history().length).toBe(1);
            });

            it('toggleHistory should hide without reloading on second toggle', () => {
                vi.spyOn(requirementService, 'getHistory').mockReturnValue(of(mockHistory));
                component.toggleHistory(); // show
                component.toggleHistory(); // hide
                expect(component.showHistory()).toBe(false);
                expect(requirementService.getHistory).toHaveBeenCalledTimes(1);
            });
        });

        describe('helper methods', () => {
            it('getChangeTypeIcon should return correct icons', () => {
                expect(component.getChangeTypeIcon('created')).toBe('add_circle');
                expect(component.getChangeTypeIcon('updated')).toBe('edit');
                expect(component.getChangeTypeIcon('approved')).toBe('check_circle');
                expect(component.getChangeTypeIcon('unknown')).toBe('info');
            });

            it('getChangeTypeLabel should return correct labels', () => {
                expect(component.getChangeTypeLabel('created')).toBe('Created');
                expect(component.getChangeTypeLabel('deleted')).toBe('Deleted');
                expect(component.getChangeTypeLabel('other')).toBe('other');
            });

            it('getFieldLabel should return friendly names', () => {
                expect(component.getFieldLabel('description')).toBe('Description');
                expect(component.getFieldLabel('parentRequirementID')).toBe('Parent Requirement');
                expect(component.getFieldLabel('unknownField')).toBe('unknownField');
            });

            it('getChangedFields should return keys from changes object', () => {
                const changes = { description: { from: 'a', to: 'b' }, rationale: { from: '', to: 'c' } };
                expect(component.getChangedFields(changes)).toEqual(['description', 'rationale']);
            });

            it('getChangedFields should handle null/undefined', () => {
                expect(component.getChangedFields(null as any)).toEqual([]);
                expect(component.getChangedFields(undefined as any)).toEqual([]);
            });
        });
    });
});
