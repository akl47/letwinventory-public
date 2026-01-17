import { Component, Input, Output, EventEmitter, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatDividerModule } from '@angular/material/divider';
import { Project } from '../../../models/project.model';
import { ProjectService } from '../../../services/project.service';

@Component({
  selector: 'app-sub-toolbar',
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatCheckboxModule,
    MatSlideToggleModule,
    MatDividerModule
  ],
  templateUrl: './sub-toolbar.html',
  styleUrl: './sub-toolbar.css',
})
export class SubToolbarComponent implements OnInit {
  @Input() isEditMode = false;
  @Input() initialProjectIds: number[] | null = null;
  @Input() initialShowNoProject: boolean | null = null;
  @Input() initialShowChildTasks: boolean | null = null;
  @Output() toggleHistory = new EventEmitter<void>();
  @Output() toggleEditMode = new EventEmitter<void>();
  @Output() projectFilterChanged = new EventEmitter<number[]>();
  @Output() showNoProjectChanged = new EventEmitter<boolean>();
  @Output() showChildTasksChanged = new EventEmitter<boolean>();

  private projectService = inject(ProjectService);

  // Special ID for "No Project" category
  static readonly NO_PROJECT_ID = 0;

  projects = signal<Project[]>([]);
  selectedProjectIds = signal<Set<number>>(new Set());
  showNoProject = signal(true);
  showChildTasks = signal(true);

  // Computed to check if all projects are selected (including "no project")
  allProjectsSelected = computed(() => {
    const projects = this.projects();
    const selected = this.selectedProjectIds();
    return projects.length > 0 && projects.every(p => selected.has(p.id)) && this.showNoProject();
  });

  // Computed to check if some but not all projects are selected
  someProjectsSelected = computed(() => {
    const projects = this.projects();
    const selected = this.selectedProjectIds();
    const selectedCount = projects.filter(p => selected.has(p.id)).length;
    const noProjectSelected = this.showNoProject();
    const totalSelected = selectedCount + (noProjectSelected ? 1 : 0);
    const totalOptions = projects.length + 1; // +1 for "no project"
    return totalSelected > 0 && totalSelected < totalOptions;
  });

  // Count of active filters (how many are hidden)
  activeFilterCount = computed(() => {
    const projects = this.projects();
    const selected = this.selectedProjectIds();
    const unselectedProjectCount = projects.filter(p => !selected.has(p.id)).length;
    const noProjectHidden = this.showNoProject() ? 0 : 1;
    return unselectedProjectCount + noProjectHidden;
  });

  // Get selected projects for chip display
  selectedProjects = computed(() => {
    const projects = this.projects();
    const selected = this.selectedProjectIds();
    return projects.filter(p => selected.has(p.id));
  });

  ngOnInit(): void {
    // Apply initial subtasks setting from URL if provided
    if (this.initialShowChildTasks !== null) {
      this.showChildTasks.set(this.initialShowChildTasks);
      this.showChildTasksChanged.emit(this.initialShowChildTasks);
    }

    this.projectService.getProjects().subscribe(projects => {
      this.projects.set(projects);

      // Apply initial values from URL or use defaults
      let projectIds: Set<number>;
      let showNoProj: boolean;

      if (this.initialProjectIds !== null) {
        // Use URL params
        projectIds = new Set(this.initialProjectIds);
      } else {
        // Default: select all projects
        projectIds = new Set(projects.map(p => p.id));
      }

      if (this.initialShowNoProject !== null) {
        showNoProj = this.initialShowNoProject;
      } else {
        showNoProj = true;
      }

      this.selectedProjectIds.set(projectIds);
      this.showNoProject.set(showNoProj);

      // Emit initial state so parent knows what's selected
      this.projectFilterChanged.emit(Array.from(projectIds));
      this.showNoProjectChanged.emit(showNoProj);
    });
  }

  isProjectSelected(projectId: number): boolean {
    return this.selectedProjectIds().has(projectId);
  }

  toggleProject(projectId: number): void {
    const current = this.selectedProjectIds();
    const newSet = new Set(current);
    if (newSet.has(projectId)) {
      newSet.delete(projectId);
    } else {
      newSet.add(projectId);
    }
    this.selectedProjectIds.set(newSet);
    this.projectFilterChanged.emit(Array.from(newSet));
  }

  toggleAllProjects(): void {
    const projects = this.projects();
    if (this.allProjectsSelected()) {
      // Deselect all
      this.selectedProjectIds.set(new Set());
      this.showNoProject.set(false);
    } else {
      // Select all
      this.selectedProjectIds.set(new Set(projects.map(p => p.id)));
      this.showNoProject.set(true);
    }
    this.projectFilterChanged.emit(Array.from(this.selectedProjectIds()));
    this.showNoProjectChanged.emit(this.showNoProject());
  }

  toggleNoProject(): void {
    this.showNoProject.update(v => !v);
    this.showNoProjectChanged.emit(this.showNoProject());
  }

  onShowChildTasksChange(checked: boolean): void {
    this.showChildTasks.set(checked);
    this.showChildTasksChanged.emit(checked);
  }
}
