import { Component, Input, Output, EventEmitter, OnInit, OnChanges, SimpleChanges, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Project } from '../../../models/project.model';
import { ProjectService } from '../../../services/project.service';
import { TaskViewPreferencesService } from '../../../services/task-view-preferences.service';

@Component({
  selector: 'app-sub-toolbar',
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatCheckboxModule,
    MatSlideToggleModule,
    MatDividerModule,
    MatTooltipModule
  ],
  templateUrl: './sub-toolbar.html',
  styleUrl: './sub-toolbar.css',
})
export class SubToolbarComponent implements OnInit, OnChanges {
  @Input() isEditMode = false;
  @Input() initialProjectIds: number[] | null = null;
  @Input() initialShowNoProject: boolean | null = null;
  @Input() initialShowChildTasks: boolean | null = null;
  @Input() currentProjects: string = '';
  @Input() currentNoProject: string = 'true';
  @Input() currentSubtasks: string = 'true';
  @Output() toggleHistory = new EventEmitter<void>();
  @Output() toggleEditMode = new EventEmitter<void>();
  @Output() projectFilterChanged = new EventEmitter<number[]>();
  @Output() showNoProjectChanged = new EventEmitter<boolean>();
  @Output() showChildTasksChanged = new EventEmitter<boolean>();
  @Output() revertToDefault = new EventEmitter<void>();
  @Output() saveAsDefault = new EventEmitter<void>();

  private projectService = inject(ProjectService);
  private preferencesService = inject(TaskViewPreferencesService);
  private router = inject(Router);

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

  // Check if a default view exists
  hasDefaultView(): boolean {
    return this.preferencesService.hasDefaultView();
  }

  // Check if current view matches saved default
  isCurrentViewDefault(): boolean {
    return this.preferencesService.isCurrentViewDefault(
      this.currentProjects,
      this.currentNoProject,
      this.currentSubtasks
    );
  }

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
      this.applyInitialValues(projects);
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    // React to input changes (e.g., when reverting to default view)
    const projects = this.projects();
    if (projects.length === 0) return; // Wait for projects to load first

    if (changes['initialProjectIds'] || changes['initialShowNoProject'] || changes['initialShowChildTasks']) {
      this.applyInitialValues(projects);
    }
  }

  private applyInitialValues(projects: Project[]): void {
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

    if (this.initialShowChildTasks !== null) {
      this.showChildTasks.set(this.initialShowChildTasks);
    }

    this.selectedProjectIds.set(projectIds);
    this.showNoProject.set(showNoProj);

    // Emit state so parent knows what's selected
    this.projectFilterChanged.emit(Array.from(projectIds));
    this.showNoProjectChanged.emit(showNoProj);
    this.showChildTasksChanged.emit(this.showChildTasks());
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

  openEditProjects(): void {
    this.router.navigate(['/projects']);
  }

  openScheduledTasks(): void {
    this.router.navigate(['/scheduled-tasks']);
  }
}
