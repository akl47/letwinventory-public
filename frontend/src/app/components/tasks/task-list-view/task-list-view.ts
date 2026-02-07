import { Component, OnInit, ViewChild, ElementRef, NgZone, signal, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { TaskService } from '../../../services/task.service';
import { TaskList } from '../../../models/task-list.model';
import { Observable, map, startWith, switchMap, shareReplay } from 'rxjs';
import { TaskListComponent } from '../task-list/task-list';
import { SubToolbarComponent } from '../sub-toolbar/sub-toolbar';
import { HistoryDrawerComponent } from '../history-drawer/history-drawer';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { TaskViewPreferencesService } from '../../../services/task-view-preferences.service';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-task-list-view',
  standalone: true,
  imports: [CommonModule, FormsModule, TaskListComponent, SubToolbarComponent, HistoryDrawerComponent, DragDropModule, ScrollingModule, MatIconModule],
  templateUrl: './task-list-view.html',
  styleUrl: './task-list-view.css',
})
export class TaskListViewComponent implements OnInit {
  taskLists$!: Observable<TaskList[]>;
  connectedListIds$!: Observable<string[]>;
  isHistoryOpen = signal(false);
  isEditMode = signal(false);
  isAddingList = signal(false);
  isDragging = signal(false);
  newListName = '';

  @ViewChild('boardContainer') boardContainerRef?: ElementRef<HTMLElement>;
  private readonly ngZone = inject(NgZone);
  private autoScrollId = 0;
  private pointerX = -1;

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

  // Current URL params for default view comparison
  currentProjectsParam = signal<string>('');
  currentNoProjectParam = signal<string>('true');
  currentSubtasksParam = signal<string>('true');

  constructor(
    private taskService: TaskService,
    private router: Router,
    private route: ActivatedRoute,
    private preferencesService: TaskViewPreferencesService
  ) {
    effect((onCleanup) => {
      if (this.isDragging()) {
        this.startAutoScroll();
        onCleanup(() => this.stopAutoScroll());
      }
    });
  }

  ngOnInit(): void {
    // Subscribe to query param changes (handles initial load and navigation)
    this.route.queryParams.subscribe(params => {
      this.applyUrlParams(params);
    });

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
      map(lists => lists.map(list => `${list.id}`))
    );
  }

  private applyUrlParams(params: { [key: string]: string }): void {
    // Parse projects param (comma-separated IDs)
    if (params['projects'] !== undefined) {
      const projectsStr = params['projects'];
      this.currentProjectsParam.set(projectsStr);
      if (projectsStr === '') {
        this.initialProjectIds.set([]);
        this.selectedProjectIds.set([]);
      } else {
        const ids = projectsStr.split(',').map((id: string) => parseInt(id, 10)).filter((id: number) => !isNaN(id));
        this.initialProjectIds.set(ids);
        this.selectedProjectIds.set(ids);
      }
    }

    // Parse noProject param
    if (params['noProject'] !== undefined) {
      this.currentNoProjectParam.set(params['noProject']);
      const showNoProj = params['noProject'] === 'true';
      this.initialShowNoProject.set(showNoProj);
      this.showNoProject.set(showNoProj);
    }

    // Parse subtasks param
    if (params['subtasks'] !== undefined) {
      this.currentSubtasksParam.set(params['subtasks']);
      const showSubtasks = params['subtasks'] === 'true';
      this.initialShowChildTasks.set(showSubtasks);
      this.showChildTasks.set(showSubtasks);
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

    // Update current param signals for default view comparison
    this.currentProjectsParam.set(queryParams['projects'] || '');
    this.currentNoProjectParam.set(queryParams['noProject'] || 'true');
    this.currentSubtasksParam.set(queryParams['subtasks'] || 'true');

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

  onRevertToDefault() {
    const defaults = this.preferencesService.getDefaultViewQueryParams();
    if (defaults) {
      this.router.navigate(['/tasks'], { queryParams: defaults });
    }
  }

  onSaveAsDefault() {
    this.preferencesService.saveDefaultView({
      projects: this.currentProjectsParam(),
      noProject: this.currentNoProjectParam(),
      subtasks: this.currentSubtasksParam()
    });
  }

  private readonly onPointerMove = (e: TouchEvent | MouseEvent) => {
    this.pointerX = 'touches' in e ? e.touches[0].clientX : e.clientX;
  };

  private startAutoScroll() {
    this.pointerX = -1;
    this.ngZone.runOutsideAngular(() => {
      document.addEventListener('touchmove', this.onPointerMove, { passive: true });
      document.addEventListener('mousemove', this.onPointerMove);
      const loop = () => {
        const el = this.boardContainerRef?.nativeElement;
        if (el && this.pointerX >= 0) {
          const rect = el.getBoundingClientRect();
          const edge = 48;
          const maxSpeed = 12;
          if (this.pointerX < rect.left + edge) {
            const intensity = 1 - (this.pointerX - rect.left) / edge;
            el.scrollLeft -= maxSpeed * Math.max(0, intensity);
          } else if (this.pointerX > rect.right - edge) {
            const intensity = 1 - (rect.right - this.pointerX) / edge;
            el.scrollLeft += maxSpeed * Math.max(0, intensity);
          }
        }
        this.autoScrollId = requestAnimationFrame(loop);
      };
      this.autoScrollId = requestAnimationFrame(loop);
    });
  }

  private stopAutoScroll() {
    document.removeEventListener('touchmove', this.onPointerMove);
    document.removeEventListener('mousemove', this.onPointerMove);
    cancelAnimationFrame(this.autoScrollId);
    this.autoScrollId = 0;
  }
}
