import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { FormsModule } from '@angular/forms';
import { ProjectService } from '../../../services/project.service';
import { Project } from '../../../models/project.model';
import { ProjectEditDialog } from '../project-edit-dialog/project-edit-dialog';

@Component({
  selector: 'app-projects-list-view',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatPaginatorModule,
    MatSortModule,
    MatInputModule,
    MatFormFieldModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatSlideToggleModule,
    MatDialogModule,
    FormsModule
  ],
  templateUrl: './projects-list-view.html',
  styleUrl: './projects-list-view.css',
})
export class ProjectsListView implements OnInit {
  private projectService = inject(ProjectService);
  private dialog = inject(MatDialog);
  private location = inject(Location);

  allProjects = signal<Project[]>([]);
  displayedProjects = signal<Project[]>([]);
  searchText = signal<string>('');
  showInactive = signal<boolean>(false);

  displayedColumns: string[] = ['shortName', 'name', 'description', 'keyboardShortcut', 'createdAt'];

  // Pagination
  pageSize = signal<number>(10);
  pageIndex = signal<number>(0);
  pageSizeOptions = [5, 10, 25, 50, 100];

  // Sorting
  sortColumn = signal<string>('name');
  sortDirection = signal<'asc' | 'desc'>('asc');

  ngOnInit() {
    this.loadData();
  }

  goBack() {
    this.location.back();
  }

  loadData() {
    this.projectService.clearCache();
    this.projectService.getProjects().subscribe({
      next: (projects) => {
        this.allProjects.set(projects);
        this.applyFiltersAndSort();
      },
      error: (err) => {
        console.error('Error loading projects:', err);
      }
    });
  }

  applyFiltersAndSort() {
    let filtered = [...this.allProjects()];

    // Filter by active flag
    if (!this.showInactive()) {
      filtered = filtered.filter(project => project.activeFlag === true);
    }

    // Apply search filter
    const search = this.searchText().toLowerCase();
    if (search) {
      filtered = filtered.filter(project =>
        project.name.toLowerCase().includes(search) ||
        project.shortName.toLowerCase().includes(search) ||
        project.description?.toLowerCase().includes(search)
      );
    }

    // Apply sorting
    const sortCol = this.sortColumn();
    const sortDir = this.sortDirection();
    filtered.sort((a, b) => {
      const aVal = this.getSortValue(a, sortCol);
      const bVal = this.getSortValue(b, sortCol);

      // Handle nulls - sort nulls last
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return sortDir === 'asc' ? 1 : -1;
      if (bVal === null) return sortDir === 'asc' ? -1 : 1;

      const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortDir === 'asc' ? comparison : -comparison;
    });

    // Apply pagination
    const startIndex = this.pageIndex() * this.pageSize();
    const endIndex = startIndex + this.pageSize();
    this.displayedProjects.set(filtered.slice(startIndex, endIndex));
  }

  onSearchChange(value: string) {
    this.searchText.set(value);
    this.pageIndex.set(0);
    this.applyFiltersAndSort();
  }

  onPageChange(event: PageEvent) {
    this.pageIndex.set(event.pageIndex);
    this.pageSize.set(event.pageSize);
    this.applyFiltersAndSort();
  }

  onSortChange(sort: Sort) {
    this.sortColumn.set(sort.active);
    this.sortDirection.set(sort.direction as 'asc' | 'desc' || 'asc');
    this.applyFiltersAndSort();
  }

  onToggleInactive(checked: boolean) {
    this.showInactive.set(checked);
    this.pageIndex.set(0);
    this.applyFiltersAndSort();
  }

  getTotalCount(): number {
    let filtered = [...this.allProjects()];

    if (!this.showInactive()) {
      filtered = filtered.filter(project => project.activeFlag === true);
    }

    const search = this.searchText().toLowerCase();
    if (search) {
      filtered = filtered.filter(project =>
        project.name.toLowerCase().includes(search) ||
        project.shortName.toLowerCase().includes(search) ||
        project.description?.toLowerCase().includes(search)
      );
    }

    return filtered.length;
  }

  openNewProjectDialog() {
    const dialogRef = this.dialog.open(ProjectEditDialog, {
      width: '500px',
      data: {}
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.loadData();
      }
    });
  }

  editProject(project: Project) {
    const dialogRef = this.dialog.open(ProjectEditDialog, {
      width: '500px',
      data: { project }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.loadData();
      }
    });
  }

  private getSortValue(project: Project, column: string): string | number | null {
    switch (column) {
      case 'createdAt':
        return project.createdAt ? new Date(project.createdAt).getTime() : null;
      default:
        const val = (project as any)[column];
        if (val === undefined || val === null) return null;
        if (typeof val === 'string') return val.toLowerCase();
        return val;
    }
  }
}
