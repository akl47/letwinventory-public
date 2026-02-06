import { Component, inject, input, signal, computed, OnInit, OnDestroy, HostListener } from '@angular/core';
import { TaskService } from '../../../services/task.service';
import { Task } from '../../../models/task.model';
import { CommonModule } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { TaskCardDialog } from '../task-card-dialog/task-card-dialog';
import { ProjectService } from '../../../services/project.service';
import { Project } from '../../../models/project.model';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-task-card',
  standalone: true,
  imports: [CommonModule, MatTooltipModule, MatIconModule],
  templateUrl: './task-card.html',
  styleUrl: './task-card.scss',
})
export class TaskCard implements OnInit, OnDestroy {
  task = input.required<Task>();

  private dialog = inject(MatDialog);
  private projectService = inject(ProjectService);
  private taskService = inject(TaskService);
  private pendingRefresh: any;

  isDoneOverride = signal<boolean | null>(null);
  displayDone = computed(() => this.isDoneOverride() ?? this.task().doneFlag);

  projects = signal<Project[]>([]);
  isHovered = signal(false);

  projectColor = computed(() => {
    const project = this.projects().find(p => p.id === this.task().projectID);
    return project ? '#' + project.tagColorHex : null;
  });

  sortedProjects = computed(() => {
    return [...this.projects()].sort((a, b) => a.name.localeCompare(b.name));
  });

  isDueToday = computed(() => {
    const task = this.task();
    if (!task.dueDate || this.displayDone()) return false;
    const due = new Date(task.dueDate);
    const now = new Date();
    return due.getFullYear() === now.getFullYear() && due.getMonth() === now.getMonth() && due.getDate() === now.getDate();
  });

  isOverdue = computed(() => {
    const task = this.task();
    if (!task.dueDate || this.displayDone()) return false;
    if (this.isDueToday()) return false;
    const due = new Date(task.dueDate);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return due < now;
  });

  formatEstimate(minutes?: number): string {
    if (minutes === undefined || minutes === null) return '';

    // Month (30 days)
    if (minutes >= 43200) {
      const months = Math.floor(minutes / 43200);
      return months === 1 ? '1 month' : `${months} months`;
    }
    // Weeks (7 days)
    if (minutes >= 10080) {
      const weeks = Math.floor(minutes / 10080);
      return weeks === 1 ? '1 week' : `${weeks} weeks`;
    }
    // Days (24 hours)
    if (minutes >= 1440) {
      const days = Math.floor(minutes / 1440);
      return days === 1 ? '1 day' : `${days} days`;
    }
    // Hours and minutes
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }

  ngOnInit(): void {
    this.projectService.getProjects().subscribe(projects => {
      this.projects.set(projects);
    });
  }

  ngOnDestroy(): void {
    if (this.pendingRefresh) {
      clearTimeout(this.pendingRefresh);
      this.taskService.triggerRefresh();
    }
  }

  toggleComplete(event: Event): void {
    event.stopPropagation();
    if (this.pendingRefresh) {
      clearTimeout(this.pendingRefresh);
      this.pendingRefresh = null;
    }

    const newDoneFlag = !this.displayDone();
    this.isDoneOverride.set(newDoneFlag);

    this.taskService.updateTask(this.task().id, { doneFlag: newDoneFlag }).subscribe({
      next: () => {
        if (newDoneFlag) {
          // Marking as done: wait before removing from view
          this.pendingRefresh = setTimeout(() => {
            this.taskService.triggerRefresh();
            this.pendingRefresh = null;
            this.isDoneOverride.set(null);
          }, 3000);
        } else {
          // Unmarking: refresh immediately and reset override
          this.isDoneOverride.set(null);
          this.taskService.triggerRefresh();
        }
      },
      error: (err) => {
        console.error('Failed to update task status', err);
        // Revert on error
        this.isDoneOverride.set(null);
      }
    });
  }

  openDialog(): void {
    this.dialog.open(TaskCardDialog, {
      data: { task: this.task() },
      width: '768px',
      maxWidth: '95vw',
      panelClass: 'trello-dialog-container',
    });
  }

  onMouseEnter(): void {
    this.isHovered.set(true);
  }

  onMouseLeave(): void {
    this.isHovered.set(false);
  }

  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (!this.isHovered()) return;

    const key = event.key.toLowerCase();

    // 'c' toggles completion
    if (key === 'c') {
      this.toggleComplete(event);
      return;
    }

    // Check for number keys 0-9
    if (!/^[0-9]$/.test(event.key)) return;

    if (event.key === '0') {
      // Clear project assignment
      this.assignProject(null);
    } else {
      // Find project with this keyboard shortcut
      const project = this.projects().find(p => p.keyboardShortcut === event.key);
      if (project) {
        // Toggle: if already assigned to this project, clear it
        if (this.task().projectID === project.id) {
          this.assignProject(null);
        } else {
          this.assignProject(project.id);
        }
      }
    }
  }

  private assignProject(projectId: number | null): void {
    const task = this.task();
    if (task.projectID === projectId) return;

    this.taskService.updateTask(task.id, { projectID: projectId as any }).subscribe({
      next: () => {
        this.taskService.triggerRefresh();
      },
      error: (err) => console.error('Failed to assign project', err)
    });
  }
}
