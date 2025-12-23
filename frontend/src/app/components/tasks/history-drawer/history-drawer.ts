import { Component, Input, Output, EventEmitter, inject, OnInit } from '@angular/core';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { HistoryService, TaskHistory, TaskActionID } from '../../../services/history.service';
import { ProjectService } from '../../../services/project.service';
import { TaskService } from '../../../services/task.service';
import { Project } from '../../../models/project.model';
import { TaskList } from '../../../models/task-list.model';
import { TaskCardDialog } from '../task-card-dialog/task-card-dialog';
import { Observable, forkJoin } from 'rxjs';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-history-drawer',
  imports: [CommonModule, MatIconModule, MatButtonModule, MatDialogModule],
  templateUrl: './history-drawer.html',
  styleUrl: './history-drawer.css',
})
export class HistoryDrawerComponent {
  @Input() isOpen = false;
  @Output() close = new EventEmitter<void>();

  private historyService = inject(HistoryService);
  private projectService = inject(ProjectService);
  private taskService = inject(TaskService);
  private dialog = inject(MatDialog);

  history$!: Observable<TaskHistory[]>;
  projects: Project[] = [];
  taskLists: TaskList[] = [];

  ngOnInit() {
    this.loadMetadata();
    this.refreshHistory();
    this.taskService.refreshTaskLists$.subscribe(() => {
      this.refreshHistory();
    });
  }

  loadMetadata() {
    forkJoin({
      projects: this.projectService.getProjects(),
      lists: this.taskService.getTaskLists()
    }).subscribe(({ projects, lists }) => {
      this.projects = projects;
      this.taskLists = lists;
    });
  }

  refreshHistory() {
    this.history$ = this.historyService.getAllHistory();
  }

  openTaskCard(taskID: number) {
    this.taskService.getTask(taskID).subscribe({
      next: (task) => {
        this.dialog.open(TaskCardDialog, {
          data: { task },
          width: '768px',
          maxWidth: '95vw',
          panelClass: 'trello-dialog-container',
        });
      },
      error: (err) => console.error('Failed to load task details', err)
    });
  }

  getLabel(item: TaskHistory, type: 'from' | 'to'): string {
    const id = type === 'from' ? item.fromID : item.toID;

    switch (item.actionID) {
      case TaskActionID.MOVE_LIST:
        const list = this.taskLists.find(l => l.id === id);
        return list ? list.name : `List ${id}`;

      case TaskActionID.ADD_TO_PROJECT:
        if (id === 0) return 'None';
        const project = this.projects.find(p => p.id === id);
        return project ? project.name : `Project ${id}`;

      case TaskActionID.ADD_PRIORITY:
        const priorities = ['Normal', 'Tracking', 'Critical Path'];
        return priorities[id] || 'Unknown';

      case TaskActionID.CHANGE_STATUS:
        return id === 1 ? 'Completed' : 'Pending';

      default:
        return id?.toString() || '';
    }
  }

  getActionLabel(actionID: number): string {
    switch (actionID) {
      case TaskActionID.MOVE_LIST: return 'moved a card';
      case TaskActionID.ADD_TO_PROJECT: return 'added card to project';
      case TaskActionID.ADD_PRIORITY: return 'set priority';
      case TaskActionID.CHANGE_STATUS: return 'changed status';
      case 5: return 'created a card';
      default: return 'updated card';
    }
  }
}
