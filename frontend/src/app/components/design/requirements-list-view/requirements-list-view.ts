import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { DesignRequirementService } from '../../../services/design-requirement.service';
import { ProjectService } from '../../../services/project.service';
import { DesignRequirement } from '../../../models/design-requirement.model';
import { Project } from '../../../models/project.model';

interface TreeRow {
    requirement: DesignRequirement;
    level: number;
    expanded: boolean;
    hasChildren: boolean;
    visible: boolean;
}

@Component({
    selector: 'app-requirements-list-view',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        MatButtonModule,
        MatIconModule,
        MatInputModule,
        MatFormFieldModule,
        MatProgressSpinnerModule,
        MatTooltipModule,
        MatSelectModule,
        MatExpansionModule,
        MatSlideToggleModule,
    ],
    templateUrl: './requirements-list-view.html',
    styleUrl: './requirements-list-view.css'
})
export class RequirementsListView implements OnInit {
    private router = inject(Router);
    private route = inject(ActivatedRoute);
    private requirementService = inject(DesignRequirementService);
    private projectService = inject(ProjectService);

    allRequirements = signal<DesignRequirement[]>([]);
    treeRows = signal<TreeRow[]>([]);
    displayedRows = signal<TreeRow[]>([]);
    projects = signal<Project[]>([]);
    isLoading = signal(true);
    searchText = signal('');
    selectedProjectID = signal<number | null>(null);
    approvedOnly = signal(false);
    hideChildren = signal(false);
    private initializedFromQuery = false;

    ngOnInit() {
        this.applyQueryParams();
        this.projectService.getProjects().subscribe(projects => {
            this.projects.set(projects);
        });
        this.loadRequirements();
    }

    private applyQueryParams() {
        const params = this.route.snapshot.queryParams;
        if (params['search']) this.searchText.set(params['search']);
        if (params['projectID']) this.selectedProjectID.set(parseInt(params['projectID'], 10) || null);
        if (params['approvedOnly'] === 'true') this.approvedOnly.set(true);
        if (params['hideChildren'] === 'true') this.hideChildren.set(true);
        this.initializedFromQuery = true;
    }

    private updateQueryParams() {
        if (!this.initializedFromQuery) return;
        const params: Record<string, string> = {};
        if (this.searchText()) params['search'] = this.searchText();
        if (this.selectedProjectID()) params['projectID'] = String(this.selectedProjectID());
        if (this.approvedOnly()) params['approvedOnly'] = 'true';
        if (this.hideChildren()) params['hideChildren'] = 'true';
        this.router.navigate([], { relativeTo: this.route, queryParams: params, replaceUrl: true });
    }

    loadRequirements() {
        this.isLoading.set(true);
        const projectID = this.selectedProjectID() ?? undefined;
        this.requirementService.getAll(projectID).subscribe({
            next: (requirements) => {
                this.allRequirements.set(requirements);
                this.buildTree();
                this.isLoading.set(false);
            },
            error: () => {
                this.isLoading.set(false);
            }
        });
    }

    buildTree() {
        const all = this.allRequirements();
        const search = this.searchText().toLowerCase();
        const approvedOnly = this.approvedOnly();
        const hideChildren = this.hideChildren();

        // Build a map of children
        const childrenMap = new Map<number | null, DesignRequirement[]>();
        for (const req of all) {
            const parentId = req.parentRequirementID ?? null;
            if (!childrenMap.has(parentId)) {
                childrenMap.set(parentId, []);
            }
            childrenMap.get(parentId)!.push(req);
        }

        // Build flat tree rows
        const rows: TreeRow[] = [];
        const prevStateMap = new Map<number, boolean>();
        for (const row of this.treeRows()) {
            prevStateMap.set(row.requirement.id, row.expanded);
        }

        const addChildren = (parentId: number | null, level: number) => {
            const children = childrenMap.get(parentId) || [];
            for (const req of children) {
                if (approvedOnly && !req.approved) continue;

                const hasChildren = (childrenMap.get(req.id) || []).length > 0;
                const matchesSearch = !search ||
                    req.description.toLowerCase().includes(search) ||
                    req.rationale?.toLowerCase().includes(search) ||
                    req.category?.name.toLowerCase().includes(search) ||
                    req.owner?.displayName.toLowerCase().includes(search);

                if (!matchesSearch && !hasChildren) continue;

                // Default expanded based on hideChildren toggle; preserve user's manual toggle if set
                const defaultExpanded = !hideChildren;
                const expanded = prevStateMap.has(req.id) ? prevStateMap.get(req.id)! : defaultExpanded;
                rows.push({
                    requirement: req,
                    level,
                    expanded,
                    hasChildren,
                    visible: true,
                });

                if (expanded || search) {
                    addChildren(req.id, level + 1);
                }
            }
        };

        addChildren(null, 0);
        this.treeRows.set(rows);
        this.displayedRows.set(rows.filter(r => r.visible));
    }

    toggleExpand(row: TreeRow) {
        row.expanded = !row.expanded;
        this.buildTree();
    }

    onSearchChange(value: string) {
        this.searchText.set(value);
        this.buildTree();
        this.updateQueryParams();
    }

    onProjectFilterChange(projectID: number | null) {
        this.selectedProjectID.set(projectID);
        this.requirementService.clearCache();
        this.loadRequirements();
        this.updateQueryParams();
    }

    toggleApprovedOnly() {
        this.approvedOnly.set(!this.approvedOnly());
        this.buildTree();
        this.updateQueryParams();
    }

    toggleHideChildren() {
        this.hideChildren.set(!this.hideChildren());
        this.treeRows.set([]); // Clear expand state so new default applies
        this.buildTree();
        this.updateQueryParams();
    }

    createNew() {
        this.router.navigate(['/requirements/new']);
    }

    openRequirement(req: DesignRequirement) {
        this.router.navigate(['/requirements', req.id, 'edit']);
    }

    getIndentPx(level: number): string {
        return `${level * 24}px`;
    }

    formatDate(date: Date | string): string {
        return new Date(date).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    }
}
