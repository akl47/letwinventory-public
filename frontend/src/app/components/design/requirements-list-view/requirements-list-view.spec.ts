import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { RequirementsListView } from './requirements-list-view';
import { DesignRequirementService } from '../../../services/design-requirement.service';
import { ProjectService } from '../../../services/project.service';
import { AuthService } from '../../../services/auth.service';
import { DesignRequirement } from '../../../models/design-requirement.model';
import { Project } from '../../../models/project.model';

describe('RequirementsListView', () => {
    let component: RequirementsListView;
    let fixture: ComponentFixture<RequirementsListView>;
    let requirementService: DesignRequirementService;
    let projectService: ProjectService;
    let authService: AuthService;
    let router: Router;

    const mockProjects: Project[] = [
        { id: 1, ownerUserID: 1, tagColorHex: 'ff0000', name: 'Project Alpha', shortName: 'PA', activeFlag: true, createdAt: new Date(), updatedAt: new Date() },
        { id: 2, ownerUserID: 1, tagColorHex: '00ff00', name: 'Project Beta', shortName: 'PB', activeFlag: true, createdAt: new Date(), updatedAt: new Date() },
    ];

    const mockRequirements: DesignRequirement[] = [
        {
            id: 1, description: 'System shall support login', rationale: 'Security', parameter: '',
            projectID: 1, ownerUserID: 1, approved: true, activeFlag: true,
            createdAt: new Date(), updatedAt: new Date(),
            category: { id: 1, name: 'Functional', activeFlag: true },
            owner: { id: 1, displayName: 'Alice', email: 'alice@test.com' },
            approvedBy: { id: 2, displayName: 'Bob', email: 'bob@test.com' },
        },
        {
            id: 2, description: 'Login shall use OAuth', rationale: 'Standards', parameter: '',
            parentRequirementID: 1, projectID: 1, ownerUserID: 1, approved: false, activeFlag: true,
            createdAt: new Date(), updatedAt: new Date(),
            category: { id: 1, name: 'Functional', activeFlag: true },
            owner: { id: 1, displayName: 'Alice', email: 'alice@test.com' },
        },
        {
            id: 3, description: 'System shall handle errors', rationale: 'Reliability', parameter: '',
            projectID: 2, ownerUserID: 2, approved: false, activeFlag: true,
            createdAt: new Date(), updatedAt: new Date(),
        },
    ];

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [RequirementsListView],
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                provideAnimationsAsync(),
                provideRouter([]),
                { provide: ActivatedRoute, useValue: { snapshot: { queryParams: {} } } },
            ],
        }).compileComponents();

        requirementService = TestBed.inject(DesignRequirementService);
        projectService = TestBed.inject(ProjectService);
        authService = TestBed.inject(AuthService);
        router = TestBed.inject(Router);

        vi.spyOn(requirementService, 'getAll').mockReturnValue(of(mockRequirements));
        vi.spyOn(requirementService, 'clearCache').mockImplementation(() => {});
        vi.spyOn(projectService, 'getProjects').mockReturnValue(of(mockProjects));
        vi.spyOn(authService, 'hasPermission').mockReturnValue(true);
        vi.spyOn(router, 'navigate').mockResolvedValue(true);

        fixture = TestBed.createComponent(RequirementsListView);
        component = fixture.componentInstance;
        fixture.detectChanges();
        await fixture.whenStable();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should load requirements and projects on init', () => {
        expect(requirementService.getAll).toHaveBeenCalled();
        expect(projectService.getProjects).toHaveBeenCalled();
        expect(component.allRequirements().length).toBe(3);
        expect(component.projects().length).toBe(2);
        expect(component.isLoading()).toBe(false);
    });

    it('should build tree rows with parent-child hierarchy', () => {
        const rows = component.displayedRows();
        // req 1 is root, req 2 is child of 1, req 3 is root
        expect(rows.length).toBe(3);
        expect(rows[0].requirement.id).toBe(1);
        expect(rows[0].level).toBe(0);
        expect(rows[0].hasChildren).toBe(true);
        expect(rows[1].requirement.id).toBe(2);
        expect(rows[1].level).toBe(1);
        expect(rows[2].requirement.id).toBe(3);
        expect(rows[2].level).toBe(0);
    });

    it('should filter by search text', () => {
        component.onSearchChange('OAuth');
        const rows = component.displayedRows();
        // parent (id:1) is included because it has a matching child, child (id:2) matches
        const ids = rows.map(r => r.requirement.id);
        expect(ids).toContain(2);
    });

    it('should filter approved only', () => {
        component.toggleApprovedOnly();
        const rows = component.displayedRows();
        expect(rows.every(r => r.requirement.approved)).toBe(true);
    });

    it('should toggle hideChildren and collapse tree', () => {
        expect(component.hideChildren()).toBe(false);
        component.toggleHideChildren();
        expect(component.hideChildren()).toBe(true);
        // After hideChildren, tree rows are rebuilt with default collapsed
        const rows = component.displayedRows();
        // Only root rows visible (children of expanded=false parents are hidden)
        const rootRows = rows.filter(r => r.level === 0);
        expect(rootRows.length).toBe(2);
    });

    it('should toggle expand on a row', () => {
        const row = component.displayedRows()[0];
        expect(row.expanded).toBe(true);
        component.toggleExpand(row);
        // After rebuild, the parent should be collapsed
        const updatedRow = component.displayedRows().find(r => r.requirement.id === 1);
        expect(updatedRow!.expanded).toBe(false);
    });

    it('should reload requirements when project filter changes', () => {
        component.onProjectFilterChange(1);
        expect(requirementService.clearCache).toHaveBeenCalled();
        expect(requirementService.getAll).toHaveBeenCalledTimes(2);
    });

    it('should navigate to new requirement page with query params', () => {
        component.createNew();
        expect(router.navigate).toHaveBeenCalledWith(['/requirements/new'], expect.objectContaining({ queryParams: {} }));
    });

    it('should navigate to edit requirement page with query params', () => {
        component.openRequirement(mockRequirements[0]);
        expect(router.navigate).toHaveBeenCalledWith(['/requirements', 1, 'edit'], expect.objectContaining({ queryParams: {} }));
    });

    it('should return correct indent pixels', () => {
        expect(component.getIndentPx(0)).toBe('0px');
        expect(component.getIndentPx(2)).toBe('48px');
        expect(component.getIndentPx(3)).toBe('72px');
    });

    it('should format date correctly', () => {
        const result = component.formatDate('2026-03-15');
        expect(result).toContain('Mar');
        expect(result).toContain('15');
        expect(result).toContain('2026');
    });

    it('should apply query params from route on init', async () => {
        // Re-create with query params
        TestBed.resetTestingModule();
        await TestBed.configureTestingModule({
            imports: [RequirementsListView],
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                provideAnimationsAsync(),
                provideRouter([]),
                { provide: ActivatedRoute, useValue: { snapshot: { queryParams: { search: 'test', approvedOnly: 'true' } } } },
            ],
        }).compileComponents();

        requirementService = TestBed.inject(DesignRequirementService);
        projectService = TestBed.inject(ProjectService);
        vi.spyOn(requirementService, 'getAll').mockReturnValue(of(mockRequirements));
        vi.spyOn(projectService, 'getProjects').mockReturnValue(of(mockProjects));

        const fix = TestBed.createComponent(RequirementsListView);
        const comp = fix.componentInstance;
        fix.detectChanges();
        await fix.whenStable();

        expect(comp.searchText()).toBe('test');
        expect(comp.approvedOnly()).toBe(true);
    });
});
