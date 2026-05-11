import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { ProjectService } from '../../../services/project.service';
import { Project } from '../../../models/project.model';
import { ProjectEditDialog } from '../project-edit-dialog/project-edit-dialog';
import { DataTable, DataTableColumnDef, ColumnDef, FilterSection } from '../../common/data-table/data-table';

@Component({
  selector: 'app-projects-list-view',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatDialogModule,
    DataTable,
    DataTableColumnDef,
  ],
  templateUrl: './projects-list-view.html',
  styleUrl: './projects-list-view.css',
})
export class ProjectsListView implements OnInit {
  private projectService = inject(ProjectService);
  private dialog = inject(MatDialog);
  private location = inject(Location);

  allProjects = signal<Project[]>([]);

  columns: ColumnDef<Project>[] = [
    { key: 'shortName', header: 'Tag', sortable: true },
    { key: 'name', header: 'Project Name', sortable: true },
    { key: 'description', header: 'Description', sortable: true },
    { key: 'keyboardShortcut', header: 'Shortcut', sortable: true },
    { key: 'createdAt', header: 'Created', sortable: true, sortValue: p => p.createdAt ? new Date(p.createdAt).getTime() : null },
  ];

  filterSections: FilterSection<Project>[] = [
    {
      type: 'toggle',
      key: 'inactive',
      label: 'Show Inactive',
      default: false,
      predicate: (p, on) => on || p.activeFlag === true,
    },
  ];

  searchKeys = ['name', 'shortName', 'description'];

  ngOnInit() {
    this.loadData();
  }

  goBack() {
    this.location.back();
  }

  loadData() {
    this.projectService.clearCache();
    this.projectService.getProjects().subscribe({
      next: (projects) => this.allProjects.set(projects),
      error: (err) => console.error('Error loading projects:', err),
    });
  }

  openNewProjectDialog() {
    const dialogRef = this.dialog.open(ProjectEditDialog, { width: '500px', data: {} });
    dialogRef.afterClosed().subscribe(result => { if (result) this.loadData(); });
  }

  editProject(project: Project) {
    const dialogRef = this.dialog.open(ProjectEditDialog, { width: '500px', data: { project } });
    dialogRef.afterClosed().subscribe(result => { if (result) this.loadData(); });
  }
}
