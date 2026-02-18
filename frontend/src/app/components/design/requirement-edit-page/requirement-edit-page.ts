import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { forkJoin, take } from 'rxjs';
import { combineLatest } from 'rxjs';
import { DesignRequirementService } from '../../../services/design-requirement.service';
import { RequirementCategoryService } from '../../../services/requirement-category.service';
import { ProjectService } from '../../../services/project.service';
import { DesignRequirement, RequirementCategory, RequirementHistoryEntry } from '../../../models/design-requirement.model';
import { Project } from '../../../models/project.model';
import { CategoryManageDialog } from '../category-manage-dialog/category-manage-dialog';
import { AuthService } from '../../../services/auth.service';

@Component({
    selector: 'app-requirement-edit-page',
    standalone: true,
    imports: [
        CommonModule,
        ReactiveFormsModule,
        MatButtonModule,
        MatFormFieldModule,
        MatInputModule,
        MatSelectModule,
        MatAutocompleteModule,
        MatIconModule,
        MatProgressSpinnerModule,
        MatTooltipModule,
        MatCardModule,
    ],
    templateUrl: './requirement-edit-page.html',
    styleUrl: './requirement-edit-page.css'
})
export class RequirementEditPage implements OnInit {
    private fb = inject(FormBuilder);
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private dialog = inject(MatDialog);
    private requirementService = inject(DesignRequirementService);
    private categoryService = inject(RequirementCategoryService);
    private projectService = inject(ProjectService);
    private authService = inject(AuthService);
    canWrite = computed(() => this.authService.hasPermission('requirements', 'write'));

    isEditMode = false;
    isFormEditMode = signal(false);
    isDataLoaded = signal(false);
    currentRequirement: DesignRequirement | null = null;

    projects = signal<Project[]>([]);
    categories = signal<RequirementCategory[]>([]);
    allRequirements = signal<DesignRequirement[]>([]);
    history = signal<RequirementHistoryEntry[]>([]);
    showHistory = signal(false);
    parentSearchText = signal('');
    filteredParentOptions = computed(() => {
        const search = this.parentSearchText().toLowerCase();
        const options = this.getParentOptions();
        if (!search) return options.slice(0, 20);
        return options.filter(r =>
            `#${r.id}`.includes(search) || r.description.toLowerCase().includes(search)
        ).slice(0, 20);
    });

    form = this.fb.group({
        projectID: [null as number | null, Validators.required],
        categoryID: [null as number | null],
        description: ['', Validators.required],
        rationale: [''],
        parameter: [''],
        parentRequirementID: [null as number | null],
        verification: [''],
        validation: [''],
    });

    ngOnInit() {
        this.loadReferenceData();
    }

    private loadReferenceData() {
        combineLatest([
            this.route.params.pipe(take(1)),
            forkJoin({
                projects: this.projectService.getProjects(),
                categories: this.categoryService.getAll(),
                requirements: this.requirementService.getAll(),
            })
        ]).subscribe({
            next: ([params, results]) => {
                this.projects.set(results.projects);
                this.categories.set(results.categories);
                this.allRequirements.set(results.requirements);

                if (params['id']) {
                    this.isEditMode = true;
                    this.isFormEditMode.set(false);
                    this.form.disable();
                    this.loadRequirement(+params['id']);
                } else {
                    this.isFormEditMode.set(true);
                    this.form.enable();
                    this.isDataLoaded.set(true);
                }
            }
        });
    }

    private loadRequirement(id: number) {
        this.requirementService.getById(id).subscribe({
            next: (req) => {
                this.currentRequirement = req;
                this.form.patchValue({
                    projectID: req.projectID,
                    categoryID: req.categoryID ?? null,
                    description: req.description,
                    rationale: req.rationale ?? '',
                    parameter: req.parameter ?? '',
                    parentRequirementID: req.parentRequirementID ?? null,
                    verification: req.verification ?? '',
                    validation: req.validation ?? '',
                });
                this.isDataLoaded.set(true);
            },
            error: () => {
                this.router.navigate(['/requirements']);
            }
        });
    }

    /** Filter out the current requirement from parent options */
    getParentOptions(): DesignRequirement[] {
        return this.allRequirements().filter(r =>
            !this.currentRequirement || r.id !== this.currentRequirement.id
        );
    }

    onParentSearch(event: Event) {
        this.parentSearchText.set((event.target as HTMLInputElement).value);
    }

    displayParentFn = (id: number | null): string => {
        if (!id) return '';
        const req = this.allRequirements().find(r => r.id === id);
        return req ? `#${req.id} — ${req.description.slice(0, 60)}` : '';
    };

    onParentSelected(event: MatAutocompleteSelectedEvent) {
        this.form.get('parentRequirementID')?.setValue(event.option.value);
        this.parentSearchText.set('');
    }

    clearParent() {
        this.form.get('parentRequirementID')?.setValue(null);
        this.parentSearchText.set('');
    }

    hasFormChanges(): boolean {
        if (!this.currentRequirement) return false;
        const raw = this.form.getRawValue();
        const req = this.currentRequirement;
        return raw.description !== req.description
            || raw.rationale !== (req.rationale ?? '')
            || raw.parameter !== (req.parameter ?? '')
            || raw.verification !== (req.verification ?? '')
            || raw.validation !== (req.validation ?? '')
            || raw.projectID !== req.projectID
            || raw.categoryID !== (req.categoryID ?? null)
            || raw.parentRequirementID !== (req.parentRequirementID ?? null);
    }

    enableEdit() {
        this.isFormEditMode.set(true);
        this.form.enable();
    }

    cancelEdit() {
        if (this.isEditMode && this.currentRequirement) {
            this.isFormEditMode.set(false);
            this.form.disable();
            this.loadRequirement(this.currentRequirement.id);
        } else {
            this.goBack();
        }
    }

    save() {
        if (this.form.invalid) return;

        const raw = this.form.getRawValue();
        const data: Partial<DesignRequirement> = {
            projectID: raw.projectID ?? undefined,
            categoryID: raw.categoryID ?? undefined,
            description: raw.description ?? undefined,
            rationale: raw.rationale ?? undefined,
            parameter: raw.parameter ?? undefined,
            parentRequirementID: raw.parentRequirementID ?? undefined,
            verification: raw.verification ?? undefined,
            validation: raw.validation ?? undefined,
        };

        if (this.isEditMode && this.currentRequirement) {
            this.requirementService.update(this.currentRequirement.id, data).subscribe({
                next: () => {
                    this.isFormEditMode.set(false);
                    this.form.disable();
                    this.loadRequirement(this.currentRequirement!.id);
                    if (this.showHistory()) this.loadHistory();
                }
            });
        } else {
            this.requirementService.create(data).subscribe({
                next: (created) => {
                    this.router.navigate(['/requirements', created.id, 'edit'], {
                        queryParams: this.route.snapshot.queryParams,
                    });
                }
            });
        }
    }

    deleteRequirement() {
        if (!this.currentRequirement) return;
        this.requirementService.delete(this.currentRequirement.id).subscribe({
            next: () => {
                this.router.navigate(['/requirements'], {
                    queryParams: this.route.snapshot.queryParams,
                });
            }
        });
    }

    approve() {
        if (!this.currentRequirement) return;
        this.requirementService.approve(this.currentRequirement.id).subscribe({
            next: () => {
                this.loadRequirement(this.currentRequirement!.id);
                if (this.showHistory()) this.loadHistory();
            }
        });
    }

    unapprove() {
        if (!this.currentRequirement) return;
        this.requirementService.unapprove(this.currentRequirement.id).subscribe({
            next: () => {
                this.loadRequirement(this.currentRequirement!.id);
                if (this.showHistory()) this.loadHistory();
            }
        });
    }

    isOwner(): boolean {
        const user = this.authService.currentUser();
        return !!user && !!this.currentRequirement && user.id === this.currentRequirement.ownerUserID;
    }

    takeOwnership() {
        if (!this.currentRequirement) return;
        if (!confirm('Are you sure? You are taking responsibility for this requirement.')) return;
        this.requirementService.takeOwnership(this.currentRequirement.id).subscribe({
            next: () => {
                this.loadRequirement(this.currentRequirement!.id);
                if (this.showHistory()) this.loadHistory();
            }
        });
    }

    openCategoryManager() {
        const dialogRef = this.dialog.open(CategoryManageDialog, {
            width: '500px',
        });

        dialogRef.afterClosed().subscribe(() => {
            this.categoryService.clearCache();
            this.categoryService.getAll().subscribe(cats => {
                this.categories.set(cats);
            });
        });
    }

    toggleHistory() {
        this.showHistory.set(!this.showHistory());
        if (this.showHistory() && this.history().length === 0 && this.currentRequirement) {
            this.loadHistory();
        }
    }

    loadHistory() {
        if (!this.currentRequirement) return;
        this.requirementService.getHistory(this.currentRequirement.id).subscribe({
            next: (entries) => this.history.set(entries)
        });
    }

    getChangeTypeIcon(type: string): string {
        const icons: Record<string, string> = {
            created: 'add_circle',
            updated: 'edit',
            approved: 'check_circle',
            unapproved: 'undo',
            deleted: 'delete',
        };
        return icons[type] || 'info';
    }

    getChangeTypeLabel(type: string): string {
        const labels: Record<string, string> = {
            created: 'Created',
            updated: 'Updated',
            approved: 'Approved',
            unapproved: 'Unapproved',
            deleted: 'Deleted',
        };
        return labels[type] || type;
    }

    getFieldLabel(field: string): string {
        const labels: Record<string, string> = {
            description: 'Description',
            rationale: 'Rationale',
            parameter: 'Parameter',
            verification: 'Verification',
            validation: 'Validation',
            parentRequirementID: 'Parent Requirement',
            projectID: 'Project',
            categoryID: 'Category',
            approved: 'Approved',
            ownerUserID: 'Owner',
            approvedByUserID: 'Approved By',
            activeFlag: 'Active',
        };
        return labels[field] || field;
    }

    getChangedFields(changes: Record<string, { from: any; to: any }>): string[] {
        return Object.keys(changes || {});
    }

    goBack() {
        this.router.navigate(['/requirements'], {
            queryParams: this.route.snapshot.queryParams,
        });
    }
}
