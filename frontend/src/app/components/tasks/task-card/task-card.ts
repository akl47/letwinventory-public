import { Component, inject, input, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { TaskService } from '../../../services/task.service';
import { Task } from '../../../models/task.model';
import { CommonModule } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { TaskCardDialog } from '../task-card-dialog/task-card-dialog';
import { ProjectService } from '../../../services/project.service';
import { Project } from '../../../models/project.model';
import { MatTooltipModule } from '@angular/material/tooltip';

@Component({
  selector: 'app-task-card',
  standalone: true,
  imports: [CommonModule, MatTooltipModule],
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
  projectColor = computed(() => {
    const project = this.projects().find(p => p.id === this.task().projectID);
    return project ? '#' + project.tagColorHex : null;
  });

  isOverdue = computed(() => {
    const task = this.task();
    if (!task.dueDate || this.displayDone()) return false;
    return new Date(task.dueDate) < new Date();
  });

  formatEstimate(minutes?: number): string {
    if (minutes === undefined || minutes === null) return '';
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
}
