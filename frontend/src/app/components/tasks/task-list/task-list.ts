import { Component, Input, Output, EventEmitter, inject, signal, ViewChild, ElementRef, computed, OnChanges, SimpleChanges } from '@angular/core';
import { TaskList } from '../../../models/task-list.model';
import { TaskCard } from '../task-card/task-card';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TaskService } from '../../../services/task.service';
import { Task } from '../../../models/task.model';
import { CdkDragDrop, DragDropModule, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';

@Component({
  selector: 'app-task-list',
  standalone: true,
  imports: [CommonModule, TaskCard, FormsModule, DragDropModule],
  templateUrl: './task-list.html',
  styleUrl: './task-list.css',
})
export class TaskListComponent implements OnChanges {
  @Input({ required: true }) taskList!: TaskList;
  @Input() connectedLists: string[] = []; // IDs of other lists
  @Input() isEditMode = false;
  @Input() filterProjectIds: number[] = [];
  @Input() showNoProject = true;
  @Input() showChildTasks = true;
  @Output() listRenamed = new EventEmitter<string>();
  @Output() listDeleted = new EventEmitter<void>();

  private readonly taskService = inject(TaskService);

  protected isAddingTask = signal(false);
  protected newTaskName = '';
  protected isEditingTitle = signal(false);
  protected editedTitle = '';

  // Filtered tasks array - used by both template and cdkDropList
  filteredTasks: Task[] = [];

  @ViewChild('taskInput') taskInput?: ElementRef;
  @ViewChild('titleInput') titleInput?: ElementRef;

  ngOnChanges(changes: SimpleChanges): void {
    // Update filtered tasks when any filter input changes
    if (changes['taskList'] || changes['filterProjectIds'] || changes['showNoProject'] || changes['showChildTasks']) {
      this.updateFilteredTasks();
    }
  }

  // Update filtered tasks array
  updateFilteredTasks(): void {
    const tasks = this.taskList?.tasks || [];
    this.filteredTasks = tasks.filter(task => {
      // Skip completed tasks
      if (task.doneFlag) return false;

      // Handle tasks without a project
      const hasNoProject = !task.projectID;
      if (hasNoProject) {
        if (!this.showNoProject) return false;
      } else {
        // Filter by project if filter is set
        if (this.filterProjectIds.length > 0 && !this.filterProjectIds.includes(task.projectID)) {
          return false;
        }
      }

      // Filter child tasks (subtasks) if toggle is off
      if (!this.showChildTasks && task.parentTaskID) {
        return false;
      }

      return true;
    });
  }

  drop(event: CdkDragDrop<Task[], Task[], Task>) {
    if (!event.container.data || !event.previousContainer.data) {
      return;
    }

    // Get the actual task from cdkDragData
    const movedTask: Task = event.item.data;

    // Find the actual index in the unfiltered source array
    const sourceArray = event.previousContainer.data;
    const destArray = event.container.data;
    const actualSourceIndex = sourceArray.findIndex(t => t.id === movedTask.id);

    if (actualSourceIndex === -1) {
      return;
    }

    if (event.previousContainer === event.container) {
      // For same-list reorder, we need to calculate the target position in the unfiltered array
      // Use the filtered index to determine relative position
      const filteredTargetIndex = event.currentIndex;
      const targetTask = this.filteredTasks[filteredTargetIndex];
      const actualTargetIndex = targetTask ? destArray.findIndex(t => t.id === targetTask.id) : destArray.length;

      moveItemInArray(destArray, actualSourceIndex, actualTargetIndex);
      this.updateFilteredTasks();
      this.taskService.moveTask(movedTask.id, this.taskList.id, event.currentIndex).subscribe();
    } else {
      // Remove from source array
      sourceArray.splice(actualSourceIndex, 1);

      // Insert into destination array at the filtered position
      // Map the filtered currentIndex to actual position in dest array
      const filteredTargetIndex = event.currentIndex;
      let actualTargetIndex: number;

      if (filteredTargetIndex >= this.filteredTasks.length) {
        // Dropping at the end
        actualTargetIndex = destArray.length;
      } else {
        const targetTask = this.filteredTasks[filteredTargetIndex];
        actualTargetIndex = targetTask ? destArray.findIndex(t => t.id === targetTask.id) : destArray.length;
      }

      destArray.splice(actualTargetIndex, 0, movedTask);
      this.updateFilteredTasks();

      this.taskService.moveTask(movedTask.id, this.taskList.id, event.currentIndex).subscribe({
        next: () => {
          // Trigger full refresh to sync all lists
          this.taskService.triggerRefresh();
        }
      });
    }
  }

  startAddingTask() {
    this.isAddingTask.set(true);
    setTimeout(() => {
      this.taskInput?.nativeElement.focus();
    });
  }

  cancelAddingTask() {
    this.isAddingTask.set(false);
    this.newTaskName = '';
  }

  confirmAddTask() {
    if (!this.newTaskName.trim()) {
      this.cancelAddingTask();
      return;
    }

    const newTask: Partial<Task> = {
      name: this.newTaskName,
      taskListID: this.taskList.id,
      activeFlag: true
    };

    this.taskService.createTask(newTask).subscribe({
      next: (createdTask) => {
        if (!this.taskList.tasks) {
          this.taskList.tasks = [];
        }
        this.taskList.tasks.push(createdTask);
        this.taskService.triggerRefresh();
        this.cancelAddingTask();
      },
      error: (err) => {
        console.error('Failed to create task', err);
        // Optionally show user feedback
      }
    });
  }

  startEditingTitle() {
    if (!this.isEditMode) return;
    this.editedTitle = this.taskList.name;
    this.isEditingTitle.set(true);
    setTimeout(() => {
      this.titleInput?.nativeElement.focus();
      this.titleInput?.nativeElement.select();
    });
  }

  cancelEditingTitle() {
    this.isEditingTitle.set(false);
    this.editedTitle = '';
  }

  confirmEditTitle() {
    const newName = this.editedTitle.trim();
    if (!newName || newName === this.taskList.name) {
      this.cancelEditingTitle();
      return;
    }
    this.listRenamed.emit(newName);
    this.isEditingTitle.set(false);
  }

  confirmDelete(event: Event) {
    event.stopPropagation();
    const taskCount = this.taskList.tasks?.filter(t => !t.doneFlag).length || 0;
    const message = taskCount > 0
      ? `Delete "${this.taskList.name}" and its ${taskCount} task(s)?`
      : `Delete "${this.taskList.name}"?`;

    if (confirm(message)) {
      this.listDeleted.emit();
    }
  }
}
