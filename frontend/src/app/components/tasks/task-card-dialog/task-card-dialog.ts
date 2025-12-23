import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { Task } from '../../../models/task.model';
import { CommonModule } from '@angular/common';
import { TaskService } from '../../../services/task.service';
import { TaskList } from '../../../models/task-list.model';
import { ProjectService } from '../../../services/project.service';
import { Project } from '../../../models/project.model';

export interface TaskCardDialogData {
  task: Task;
}

export type TaskTypeEnum = 'normal' | 'tracking' | 'critical_path';

export interface LabelOption {
  value: TaskTypeEnum;
  label: string;
  colorClass: string;
}

@Component({
  selector: 'app-task-card-dialog',
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, MatMenuModule],
  templateUrl: './task-card-dialog.html',
  styleUrl: './task-card-dialog.css',
})
export class TaskCardDialog implements OnInit {
  data = inject<TaskCardDialogData>(MAT_DIALOG_DATA);
  private taskService = inject(TaskService);
  private projectService = inject(ProjectService);

  labelOptions: LabelOption[] = [
    { value: 'normal', label: 'Normal', colorClass: 'label-blue' },
    { value: 'tracking', label: 'Tracking', colorClass: 'label-yellow' },
    { value: 'critical_path', label: 'Critical Path', colorClass: 'label-red' },
  ];

  taskLists = signal<TaskList[]>([]);
  projects = signal<Project[]>([]);

  currentListName = computed(() => {
    const lists = this.taskLists();
    const currentList = lists.find(l => l.id === this.task.taskListID);
    return currentList ? currentList.name : '';
  });

  currentProject = computed(() => {
    const projects = this.projects();
    return projects.find(p => p.id === this.task.projectID);
  });

  ngOnInit(): void {
    this.loadTaskLists();
    this.loadProjects();
  }

  loadTaskLists(): void {
    this.taskService.getTaskLists().subscribe({
      next: (lists) => {
        this.taskLists.set(lists);
      },
      error: (err) => console.error('Failed to load task lists', err)
    });
  }

  loadProjects(): void {
    this.projectService.getProjects().subscribe({
      next: (projects) => {
        this.projects.set(projects);
      },
      error: (err) => console.error('Failed to load projects', err)
    });
  }

  get task(): Task {
    return this.data.task;
  }

  isOverdue(): boolean {
    if (!this.task.dueDate) return false;
    return new Date(this.task.dueDate) < new Date();
  }

  selectLabel(option: LabelOption): void {
    this.task.taskTypeEnum = option.value;
    // TODO: Call API to update task when backend endpoint is ready
    // this.taskService.updateTask(this.task.id, { taskTypeEnum: option.value }).subscribe();
  }

  toggleComplete(): void {
    const newDoneFlag = !this.task.doneFlag;
    this.taskService.updateTask(this.task.id, { doneFlag: newDoneFlag }).subscribe({
      next: (updatedTask) => {
        this.task.doneFlag = updatedTask.doneFlag;
        this.taskService.triggerRefresh();
      },
      error: (err) => console.error('Failed to toggle completion status', err)
    });
  }

  moveToList(list: TaskList): void {
    if (list.id === this.task.taskListID) return;

    this.taskService.moveTask(this.task.id, list.id, 0).subscribe({
      next: (updatedTask) => {
        this.task.taskListID = list.id;
        this.taskService.triggerRefresh();
        // The computed signal currentListName will update automatically 
        // if we make taskListID a signal or trigger a re-dependency.
        // For now, since task is a plain object, let's manually refresh lists
        // or just accept that the computed won't see the nested change.
        // Actually, we can just trigger a refresh of the signal if needed.
        this.taskLists.set([...this.taskLists()]);
      },
      error: (err) => console.error('Failed to move task', err)
    });
  }

  selectProject(project: Project | null): void {
    const newProjectId = project ? project.id : null;
    if (newProjectId === this.task.projectID) return;

    this.taskService.updateTask(this.task.id, { projectID: newProjectId as any }).subscribe({
      next: (updatedTask) => {
        this.task.projectID = newProjectId as any;
        this.taskService.triggerRefresh();
        // Trigger re-dependency for computed signals
        this.projects.set([...this.projects()]);
      },
      error: (err) => console.error('Failed to update project', err)
    });
  }
}
