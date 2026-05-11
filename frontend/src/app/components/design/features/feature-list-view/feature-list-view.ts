import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { DesignFeatureService } from '../../../../services/design-feature.service';
import { CategoryBadge } from '../../../common/category-badge/category-badge';
import { ProjectService } from '../../../../services/project.service';
import { DesignFeature, ReviewState } from '../../../../models/design-feature.model';
import { Project } from '../../../../models/project.model';
import { DataTable, DataTableColumnDef, ColumnDef, FilterSection } from '../../../common/data-table/data-table';

@Component({
  selector: 'app-feature-list-view',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    CategoryBadge,
    DataTable,
    DataTableColumnDef,
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
  ready = computed(() => !this.loading() && this.projects().length >= 0);

  columns: ColumnDef<DesignFeature>[] = [
    { key: 'name', header: 'Name', sortable: true },
    { key: 'project', header: 'Project', sortable: true, sortValue: f => this.projectName(f.projectID).toLowerCase() },
    { key: 'owner', header: 'Owner', sortable: true, sortValue: f => f.owner?.displayName?.toLowerCase() ?? null },
    { key: 'reviewState', header: 'State', sortable: true },
    { key: 'requirementCount', header: 'Reqs', sortable: true, sortValue: f => f.requirementCount || 0 },
    { key: 'branch', header: 'Branch', sortable: true, sortValue: f => f.branchName?.toLowerCase() ?? null },
    { key: 'updatedAt', header: 'Updated', sortable: true, sortValue: f => f.updatedAt ? new Date(f.updatedAt).getTime() : null },
  ];

  reviewStates: ReviewState[] = ['draft', 'in_review', 'approved', 'released'];

  filterSections = computed<FilterSection<DesignFeature>[]>(() => [
    {
      type: 'multiSelect',
      key: 'projects',
      label: 'Projects',
      options: this.projects().map(p => ({
        id: p.id,
        label: p.name,
        colorHex: p.tagColorHex ? `#${p.tagColorHex}` : undefined,
      })),
      accessor: (f: DesignFeature) => f.projectID,
    },
    {
      type: 'multiSelect',
      key: 'reviewState',
      label: 'State',
      options: this.reviewStates.map(s => ({ id: s, label: s })),
      accessor: (f: DesignFeature) => f.reviewState,
    },
  ]);

  projectMap = computed(() => {
    const m = new Map<number, Project>();
    for (const p of this.projects()) m.set(p.id, p);
    return m;
  });

  searchKeys = ['name', 'slug', 'description'];

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
    const svc = this.projectService as unknown as { getAll?: () => { subscribe: (cb: (p: Project[]) => void) => void }; getProjects?: () => { subscribe: (cb: (p: Project[]) => void) => void } };
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
}
