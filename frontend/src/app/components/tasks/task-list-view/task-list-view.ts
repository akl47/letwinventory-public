import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TaskService } from '../../../services/task.service';
import { TaskList } from '../../../models/task-list.model';
import { Observable, map } from 'rxjs';
import { TaskListComponent } from '../task-list/task-list';

@Component({
  selector: 'app-task-list-view',
  standalone: true,
  imports: [CommonModule, TaskListComponent],
  templateUrl: './task-list-view.html',
  styleUrl: './task-list-view.css',
})
export class TaskListViewComponent implements OnInit {
  taskLists$!: Observable<TaskList[]>;
  connectedListIds$!: Observable<string[]>;

  constructor(private taskService: TaskService) { }

  ngOnInit(): void {
    this.taskLists$ = this.taskService.getTaskLists();
    this.connectedListIds$ = this.taskLists$.pipe(
      map(lists => lists.map(list => `${list.id}`))
    );
  }
}
