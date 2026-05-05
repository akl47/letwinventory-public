import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { DesignFeatureService } from '../../../../services/design-feature.service';
import { CategoryBadge } from '../../../common/category-badge/category-badge';
import { ProjectService } from '../../../../services/project.service';
import { DesignFeature, ReviewState } from '../../../../models/design-feature.model';
import { Project } from '../../../../models/project.model';

@Component({
    selector: 'app-feature-list-view',
    standalone: true,
    imports: [
        CommonModule, RouterModule, FormsModule,
        MatTableModule, MatPaginatorModule, MatFormFieldModule, MatInputModule,
        MatSelectModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule,
        CategoryBadge,
    ],
    templateUrl: './feature-list-view.html',
    styleUrl: './feature-list-view.css',
})
export class FeatureListView implements OnInit {
    private featureService = inject(DesignFeatureService);
    private projectService = inject(ProjectService);

    features = signal<DesignFeature[]>([]);
    projects = signal<Project[]>([]);
    loading = signal(true);
    error = signal<string | null>(null);

    selectedProjectID = signal<number | null>(null);
    selectedReviewState = signal<ReviewState | null>(null);
    selectedOwnerUserID = signal<number | null>(null);
    searchText = signal('');

    pageSize = signal(25);
    pageIndex = signal(0);
    pageSizeOptions = [10, 25, 50, 100];

    filteredFeatures = computed(() => {
        const search = this.searchText().toLowerCase();
        const state = this.selectedReviewState();
        const projectID = this.selectedProjectID();
        const ownerID = this.selectedOwnerUserID();
        return this.features().filter(f => {
            if (state && f.reviewState !== state) return false;
            if (projectID && f.projectID !== projectID) return false;
            if (ownerID && f.ownerUserID !== ownerID) return false;
            if (search) {
                const hay = `${f.name} ${f.slug} ${f.description || ''}`.toLowerCase();
                if (!hay.includes(search)) return false;
            }
            return true;
        });
    });

    displayedFeatures = computed(() => {
        const start = this.pageIndex() * this.pageSize();
        return this.filteredFeatures().slice(start, start + this.pageSize());
    });

    projectMap = computed(() => {
        const m = new Map<number, Project>();
        for (const p of this.projects()) m.set(p.id, p);
        return m;
    });

    reviewStates: ReviewState[] = ['draft', 'in_review', 'approved', 'released'];

    displayedColumns = ['name', 'project', 'owner', 'reviewState', 'requirementCount', 'branch', 'updatedAt'];

    ngOnInit() {
        this.featureService.getAll().subscribe({
            next: (features) => {
                this.features.set(features);
                this.loading.set(false);
            },
            error: (err) => {
                this.error.set(err?.error?.error || 'Failed to load features');
                this.loading.set(false);
            },
        });
        const svc: any = this.projectService as any;
        const obs = (svc.getAll && svc.getAll()) || (svc.getProjects && svc.getProjects()) || null;
        if (obs) obs.subscribe((p: Project[]) => this.projects.set(p));
    }

    stateVariant(state: ReviewState): 'neutral' | 'success' | 'warning' | 'info' | 'error' {
        switch (state) {
            case 'approved': return 'success';
            case 'released': return 'info';
            case 'draft': return 'neutral';
            case 'in_review': return 'warning';
            default: return 'neutral';
        }
    }

    projectName(projectID: number): string {
        return this.projectMap().get(projectID)?.name || '—';
    }

    onPageChange(event: PageEvent) {
        this.pageIndex.set(event.pageIndex);
        this.pageSize.set(event.pageSize);
    }

    // Reset to first page when filters change.
    onFilterChange<T>(setter: (v: T) => void, value: T) {
        setter(value);
        this.pageIndex.set(0);
    }
}
