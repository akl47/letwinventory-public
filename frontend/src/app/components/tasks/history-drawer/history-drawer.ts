import { Component, Input, Output, EventEmitter, inject, OnInit, ViewChild, ElementRef, OnDestroy } from '@angular/core';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { HistoryService, TaskHistory } from '../../../services/history.service';
import { ProjectService } from '../../../services/project.service';
import { TaskService } from '../../../services/task.service';
import { Project } from '../../../models/project.model';
import { TaskList } from '../../../models/task-list.model';
import { TaskCardDialog } from '../task-card-dialog/task-card-dialog';
import { Observable, forkJoin, Subscription } from 'rxjs';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

@Component({
  selector: 'app-history-drawer',
  imports: [CommonModule, MatIconModule, MatButtonModule, MatDialogModule, MatProgressSpinnerModule],
  templateUrl: './history-drawer.html',
  styleUrl: './history-drawer.css',
})
export class HistoryDrawerComponent implements OnInit, OnDestroy {
  @Input() isOpen = false;
  @Output() close = new EventEmitter<void>();
  @ViewChild('drawerBody') drawerBody!: ElementRef;

  private historyService = inject(HistoryService);
  private projectService = inject(ProjectService);
  private taskService = inject(TaskService);
  private dialog = inject(MatDialog);

  history: TaskHistory[] = [];
  projects: Project[] = [];
  taskLists: TaskList[] = [];

  offset = 0;
  limit = 10;
  isLoading = false;
  hasMore = true;

  private refreshSub?: Subscription;

  ngOnInit() {
    this.loadMetadata();
    this.refreshHistory();
    this.refreshSub = this.taskService.refreshTaskLists$.subscribe(() => {
      this.refreshHistory();
    });
  }

  ngOnDestroy() {
    this.refreshSub?.unsubscribe();
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
    this.offset = 0;
    this.history = [];
    this.hasMore = true;
    this.loadMoreHistory();
  }

  loadMoreHistory() {
    if (this.isLoading || !this.hasMore) return;

    this.isLoading = true;
    this.historyService.getAllHistory(this.offset, this.limit).subscribe({
      next: (items) => {
        this.history = [...this.history, ...items];
        this.offset += this.limit;
        this.isLoading = false;
        if (items.length < this.limit) {
          this.hasMore = false;
        }
      },
      error: (err) => {
        console.error('Failed to load history', err);
        this.isLoading = false;
      }
    });
  }

  onScroll(event: any) {
    const element = event.target;
    if (element.scrollHeight - element.scrollTop <= element.clientHeight + 50) {
      this.loadMoreHistory();
    }
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

  isCreatedAction(item: TaskHistory): boolean {
    return item.actionType?.code === 'CREATED';
  }

  getLabel(item: TaskHistory, type: 'from' | 'to'): string {
    const id = type === 'from' ? item.fromID : item.toID;
    const actionCode = item.actionType?.code;

    switch (actionCode) {
      case 'MOVE_LIST':
        const list = this.taskLists.find(l => l.id === id);
        return list ? list.name : `List ${id}`;

      case 'ADD_TO_PROJECT':
        if (id === 0) return 'None';
        const project = this.projects.find(p => p.id === id);
        return project ? project.name : `Project ${id}`;

      case 'ADD_PRIORITY':
        const priorities = ['Normal', 'Tracking', 'Critical Path'];
        return priorities[id] || 'Unknown';

      case 'CHANGE_STATUS':
        return id === 1 ? 'Completed' : 'Pending';

      default:
        return id?.toString() || '';
    }
  }

  getActionLabel(item: TaskHistory): string {
    const actionCode = item.actionType?.code;

    switch (actionCode) {
      case 'MOVE_LIST': return 'moved a card';
      case 'ADD_TO_PROJECT': return 'added card to project';
      case 'ADD_PRIORITY': return 'set priority';
      case 'CHANGE_STATUS': return 'changed status';
      case 'CREATED': return 'created a card';
      default: return 'updated card';
    }
  }
}
