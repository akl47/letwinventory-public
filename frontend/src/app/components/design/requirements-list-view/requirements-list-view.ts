import { Component, OnInit, inject, signal, computed } from '@angular/core';
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
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { DesignRequirementService } from '../../../services/design-requirement.service';
import { AuthService } from '../../../services/auth.service';
import { matchesSearch } from '../../../utils/search';
import { ProjectService } from '../../../services/project.service';
import { DesignRequirement } from '../../../models/design-requirement.model';
import { Project } from '../../../models/project.model';

interface TreeRow {
    requirement: DesignRequirement;
    level: number;
    expanded: boolean;
    hasChildren: boolean;
    childCount: number;
    visible: boolean;
    childrenAllApproved: boolean;
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
        MatCheckboxModule,
        MatMenuModule,
        MatDividerModule,
        MatSlideToggleModule,
    ],
    templateUrl: './requirements-list-view.html',
    styleUrl: './requirements-list-view.css'
})
export class RequirementsListView implements OnInit {
    private router = inject(Router);
    private route = inject(ActivatedRoute);
    private requirementService = inject(DesignRequirementService);
    private authService = inject(AuthService);
    private projectService = inject(ProjectService);
    canWrite = computed(() => this.authService.hasPermission('requirements', 'write'));

    allRequirements = signal<DesignRequirement[]>([]);
    treeRows = signal<TreeRow[]>([]);
    displayedRows = signal<TreeRow[]>([]);
    projects = signal<Project[]>([]);
    isLoading = signal(true);
    searchText = signal('');
    selectedProjectID = signal<number | null>(null);
    selectedStatuses = signal<Set<string>>(new Set(['unapproved', 'approved', 'not_implemented', 'implemented', 'validated']));
    hideChildren = signal(false);

    statusOptions = [
        { value: 'unapproved', label: 'Unapproved', icon: 'pending', cssClass: 'status-icon-draft' },
        { value: 'approved', label: 'Approved', icon: 'check_circle', cssClass: 'status-icon-approved' },
        { value: 'not_implemented', label: 'Not Implemented', icon: 'code_off', cssClass: 'status-icon-not-implemented' },
        { value: 'implemented', label: 'Implemented', icon: 'build', cssClass: 'status-icon-implemented' },
        { value: 'validated', label: 'Validated', icon: 'verified', cssClass: 'status-icon-validated' },
    ];

    activeStatusFilterCount = computed(() => {
        return this.statusOptions.length - this.selectedStatuses().size;
    });
    private expandedFromQuery = new Set<number>();
    private initializedFromQuery = false;
    private lastSearch = '';

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
        if (params['statuses']) {
            this.selectedStatuses.set(new Set(params['statuses'].split(',')));
        }
        if (params['hideChildren'] === 'true') this.hideChildren.set(true);
        if (params['expanded']) {
            for (const id of params['expanded'].split(',')) {
                const num = parseInt(id, 10);
                if (!isNaN(num)) this.expandedFromQuery.add(num);
            }
        }
        this.initializedFromQuery = true;
    }

    private updateQueryParams() {
        if (!this.initializedFromQuery) return;
        const params: Record<string, string> = {};
        if (this.searchText()) params['search'] = this.searchText();
        if (this.selectedProjectID()) params['projectID'] = String(this.selectedProjectID());
        if (this.selectedStatuses().size < this.statusOptions.length) {
            params['statuses'] = Array.from(this.selectedStatuses()).join(',');
        }
        if (this.hideChildren()) params['hideChildren'] = 'true';
        const expandedIds = this.treeRows()
            .filter(r => r.expanded && r.hasChildren)
            .map(r => r.requirement.id);
        if (expandedIds.length > 0) params['expanded'] = expandedIds.join(',');
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
        const search = this.searchText();
        const statuses = this.selectedStatuses();
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

        const allDescendantsApproved = (id: number): boolean => {
            const children = childrenMap.get(id) || [];
            return children.every(c => c.approved && allDescendantsApproved(c.id));
        };

        // Build flat tree rows
        const rows: TreeRow[] = [];
        const searchChanged = search !== this.lastSearch;
        this.lastSearch = search;
        const prevStateMap = new Map<number, boolean>();
        if (!searchChanged) {
            for (const row of this.treeRows()) {
                prevStateMap.set(row.requirement.id, row.expanded);
            }
        }

        // When searching, pre-compute which nodes have a matching descendant (or match themselves)
        const hasMatchingDescendant = new Set<number>();
        if (search) {
            const markAncestors = (id: number | null) => {
                if (id == null || hasMatchingDescendant.has(id)) return;
                hasMatchingDescendant.add(id);
                const req = all.find(r => r.id === id);
                if (req?.parentRequirementID != null) markAncestors(req.parentRequirementID);
            };
            for (const req of all) {
                if (matchesSearch(req, search, ['description', 'category.name', 'owner.displayName'])) {
                    markAncestors(req.id);
                }
            }
        }

        const matchesStatus = (req: DesignRequirement): boolean => {
            const approvalStatus = req.approved ? 'approved' : 'unapproved';
            return statuses.has(approvalStatus) && statuses.has(req.implementationStatus);
        };

        // Pre-compute which nodes have a status-matching descendant
        const hasMatchingStatusDescendant = new Map<number, boolean>();
        const checkStatusDescendants = (id: number): boolean => {
            if (hasMatchingStatusDescendant.has(id)) return hasMatchingStatusDescendant.get(id)!;
            const children = childrenMap.get(id) || [];
            const result = children.some(c => matchesStatus(c) || checkStatusDescendants(c.id));
            hasMatchingStatusDescendant.set(id, result);
            return result;
        };
        for (const req of all) checkStatusDescendants(req.id);

        const addChildren = (parentId: number | null, level: number, showAll: boolean) => {
            const children = childrenMap.get(parentId) || [];
            for (const req of children) {
                const matches = matchesStatus(req);
                const hasDescendantMatch = hasMatchingStatusDescendant.get(req.id) || false;
                // Skip if neither this node nor any descendant matches the status filter
                if (!matches && !hasDescendantMatch) continue;

                const inMatchPath = !!search && hasMatchingDescendant.has(req.id);
                // Skip nodes not relevant to the search (unless parent was manually expanded)
                if (search && !showAll && !inMatchPath) continue;

                const nodeChildren = childrenMap.get(req.id) || [];
                const childCount = nodeChildren.length;
                const hasChildren = childCount > 0;

                const isDirectMatch = !!search && matchesSearch(req, search, ['description', 'category.name', 'owner.displayName']);

                let expanded: boolean;
                if (prevStateMap.has(req.id)) {
                    expanded = prevStateMap.get(req.id)!;
                } else if (!search && this.expandedFromQuery.size > 0) {
                    expanded = this.expandedFromQuery.has(req.id);
                } else if (search) {
                    // Ancestors auto-expand to reveal matches; direct matches default collapsed
                    expanded = inMatchPath && !isDirectMatch && hasChildren;
                } else {
                    expanded = !hideChildren;
                }

                // Only add the row if it matches the status filter itself
                if (matches) {
                    rows.push({
                        requirement: req,
                        level,
                        expanded,
                        hasChildren,
                        childCount,
                        visible: true,
                        childrenAllApproved: allDescendantsApproved(req.id),
                    });
                }

                if (expanded || !matches) {
                    // When user manually expands a node during search, show all children
                    const userExpanded = !!search && prevStateMap.has(req.id) && prevStateMap.get(req.id)!;
                    addChildren(req.id, level + (matches ? 1 : 0), showAll || userExpanded);
                }
            }
        };
        addChildren(null, 0, false);
        this.treeRows.set(rows);
        this.displayedRows.set(rows.filter(r => r.visible));
    }

    toggleExpand(row: TreeRow) {
        row.expanded = !row.expanded;
        this.buildTree();
        this.updateQueryParams();
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

    isStatusSelected(value: string): boolean {
        return this.selectedStatuses().has(value);
    }

    toggleStatus(value: string): void {
        const current = this.selectedStatuses();
        const newSet = new Set(current);
        if (newSet.has(value)) {
            newSet.delete(value);
        } else {
            newSet.add(value);
        }
        this.selectedStatuses.set(newSet);
        this.buildTree();
        this.updateQueryParams();
    }

    allStatusesSelected(): boolean {
        return this.selectedStatuses().size === this.statusOptions.length;
    }

    someStatusesSelected(): boolean {
        const size = this.selectedStatuses().size;
        return size > 0 && size < this.statusOptions.length;
    }

    toggleAllStatuses(): void {
        if (this.allStatusesSelected()) {
            this.selectedStatuses.set(new Set());
        } else {
            this.selectedStatuses.set(new Set(this.statusOptions.map(s => s.value)));
        }
        this.buildTree();
        this.updateQueryParams();
    }

    toggleHideChildren() {
        this.hideChildren.set(!this.hideChildren());
        this.expandedFromQuery.clear();
        this.treeRows.set([]); // Clear expand state so new default applies
        this.buildTree();
        this.updateQueryParams();
    }

    createNew() {
        this.router.navigate(['/requirements/new'], {
            queryParams: this.route.snapshot.queryParams,
        });
    }

    openRequirement(req: DesignRequirement) {
        this.router.navigate(['/requirements', req.id, 'edit'], {
            queryParams: this.route.snapshot.queryParams,
        });
    }

    childLabel(count: number): string {
        return count === 1 ? '1 child' : `${count} children`;
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
