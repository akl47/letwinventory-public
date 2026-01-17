import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { TaskService } from '../../../services/task.service';
import { TaskList } from '../../../models/task-list.model';
import { Observable, map, startWith, switchMap, shareReplay, tap } from 'rxjs';
import { TaskListComponent } from '../task-list/task-list';
import { SubToolbarComponent } from '../sub-toolbar/sub-toolbar';
import { HistoryDrawerComponent } from '../history-drawer/history-drawer';
import { signal } from '@angular/core';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';

@Component({
  selector: 'app-task-list-view',
  standalone: true,
  imports: [CommonModule, FormsModule, TaskListComponent, SubToolbarComponent, HistoryDrawerComponent, DragDropModule],
  templateUrl: './task-list-view.html',
  styleUrl: './task-list-view.css',
})
export class TaskListViewComponent implements OnInit {
  taskLists$!: Observable<TaskList[]>;
  connectedListIds$!: Observable<string[]>;
  isHistoryOpen = signal(false);
  isEditMode = signal(false);
  isAddingList = signal(false);
  newListName = '';

  // Filter state
  selectedProjectIds = signal<number[]>([]);
  showNoProject = signal(true);
  showChildTasks = signal(true);

  // Initial filter values from URL (null means not set, use defaults)
  initialProjectIds = signal<number[] | null>(null);
  initialShowNoProject = signal<boolean | null>(null);
  initialShowChildTasks = signal<boolean | null>(null);

  // Local copy for drag/drop manipulation
  taskListsLocal = signal<TaskList[]>([]);

  constructor(
    private taskService: TaskService,
    private router: Router,
    private route: ActivatedRoute
  ) { }

  ngOnInit(): void {
    // Read initial filter values from URL
    this.parseUrlParams();

    this.taskLists$ = this.taskService.refreshTaskLists$.pipe(
      startWith(undefined),
      switchMap(() => this.taskService.getTaskLists()),
      shareReplay(1)
    );

    // Keep local copy in sync
    this.taskLists$.subscribe(lists => {
      this.taskListsLocal.set([...lists]);
    });

    this.connectedListIds$ = this.taskLists$.pipe(
      map(lists => lists.map(list => `${list.id}`)),
      tap(ids => console.log('Connected list IDs:', ids))
    );
  }

  private parseUrlParams(): void {
    const params = this.route.snapshot.queryParams;

    // Parse projects param (comma-separated IDs)
    if (params['projects'] !== undefined) {
      const projectsStr = params['projects'];
      if (projectsStr === '') {
        this.initialProjectIds.set([]);
      } else {
        const ids = projectsStr.split(',').map((id: string) => parseInt(id, 10)).filter((id: number) => !isNaN(id));
        this.initialProjectIds.set(ids);
      }
    }

    // Parse noProject param
    if (params['noProject'] !== undefined) {
      this.initialShowNoProject.set(params['noProject'] === 'true');
    }

    // Parse subtasks param
    if (params['subtasks'] !== undefined) {
      this.initialShowChildTasks.set(params['subtasks'] === 'true');
    }
  }

  private updateUrlParams(): void {
    const queryParams: { [key: string]: string | null } = {};

    // Only add params if they differ from defaults (all selected)
    const projectIds = this.selectedProjectIds();
    const noProject = this.showNoProject();
    const subtasks = this.showChildTasks();

    // Projects param - only set if not all projects selected
    if (projectIds.length > 0) {
      queryParams['projects'] = projectIds.join(',');
    } else {
      queryParams['projects'] = '';
    }

    // noProject param
    queryParams['noProject'] = noProject ? 'true' : 'false';

    // subtasks param
    queryParams['subtasks'] = subtasks ? 'true' : 'false';

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  toggleHistory() {
    this.isHistoryOpen.update(open => !open);
  }

  toggleEditMode() {
    const wasEditMode = this.isEditMode();
    this.isEditMode.update(mode => !mode);
    if (wasEditMode) {
      // Exiting edit mode - refresh to sync any reordering changes
      this.isAddingList.set(false);
      this.newListName = '';
      this.taskService.triggerRefresh();
    }
  }

  dropList(event: CdkDragDrop<TaskList[]>) {
    const lists = this.taskListsLocal();
    moveItemInArray(lists, event.previousIndex, event.currentIndex);
    this.taskListsLocal.set([...lists]);

    // Save the new order to backend
    const orderedIds = lists.map(list => list.id);
    this.taskService.reorderTaskLists(orderedIds).subscribe();
  }

  startAddingList() {
    this.isAddingList.set(true);
  }

  cancelAddingList() {
    this.isAddingList.set(false);
    this.newListName = '';
  }

  confirmAddList() {
    if (!this.newListName.trim()) {
      this.cancelAddingList();
      return;
    }

    this.taskService.createTaskList({ name: this.newListName.trim() }).subscribe({
      next: () => {
        this.taskService.triggerRefresh();
        this.cancelAddingList();
      },
      error: (err) => {
        console.error('Failed to create task list', err);
      }
    });
  }

  onListRenamed(listId: number, newName: string) {
    this.taskService.updateTaskList(listId, { name: newName }).subscribe({
      next: () => {
        this.taskService.triggerRefresh();
      },
      error: (err) => {
        console.error('Failed to rename task list', err);
      }
    });
  }

  onListDeleted(listId: number) {
    this.taskService.deleteTaskList(listId).subscribe({
      next: () => {
        // Remove from local copy immediately for responsive UI
        this.taskListsLocal.update(lists => lists.filter(l => l.id !== listId));
        this.taskService.triggerRefresh();
      },
      error: (err) => {
        console.error('Failed to delete task list', err);
      }
    });
  }

  onProjectFilterChanged(projectIds: number[]) {
    this.selectedProjectIds.set(projectIds);
    this.updateUrlParams();
  }

  onShowNoProjectChanged(show: boolean) {
    this.showNoProject.set(show);
    this.updateUrlParams();
  }

  onShowChildTasksChanged(show: boolean) {
    this.showChildTasks.set(show);
    this.updateUrlParams();
  }
}
