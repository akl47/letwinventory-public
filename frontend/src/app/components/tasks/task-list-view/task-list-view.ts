import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TaskService } from '../../../services/task.service';
import { TaskList } from '../../../models/task-list.model';
import { Observable, map, merge, startWith, switchMap, shareReplay } from 'rxjs';
import { TaskListComponent } from '../task-list/task-list';
import { SubToolbarComponent } from '../sub-toolbar/sub-toolbar';
import { HistoryDrawerComponent } from '../history-drawer/history-drawer';
import { signal } from '@angular/core';

@Component({
  selector: 'app-task-list-view',
  standalone: true,
  imports: [CommonModule, TaskListComponent, SubToolbarComponent, HistoryDrawerComponent],
  templateUrl: './task-list-view.html',
  styleUrl: './task-list-view.css',
})
export class TaskListViewComponent implements OnInit {
  taskLists$!: Observable<TaskList[]>;
  connectedListIds$!: Observable<string[]>;
  isHistoryOpen = signal(false);

  constructor(private taskService: TaskService) { }

  ngOnInit(): void {
    this.taskLists$ = this.taskService.refreshTaskLists$.pipe(
      startWith(undefined),
      switchMap(() => this.taskService.getTaskLists()),
      shareReplay(1)
    );

    this.connectedListIds$ = this.taskLists$.pipe(
      map(lists => lists.map(list => `${list.id}`))
    );
  }

  toggleHistory() {
    this.isHistoryOpen.update(open => !open);
  }
}
