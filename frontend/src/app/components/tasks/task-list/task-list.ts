import { Component, Input, inject, signal, ViewChild, ElementRef } from '@angular/core';
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
export class TaskListComponent {
  @Input({ required: true }) taskList!: TaskList;
  @Input() connectedLists: string[] = []; // IDs of other lists
  private readonly taskService = inject(TaskService);

  protected isAddingTask = signal(false);
  protected newTaskName = '';

  @ViewChild('taskInput') taskInput?: ElementRef;

  drop(event: CdkDragDrop<Task[] | undefined>) {
    if (!event.container.data || !event.previousContainer.data) return;

    if (event.previousContainer === event.container) {
      moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
      // Update backend for in-list reordering
      const task = event.container.data[event.currentIndex];
      this.taskService.moveTask(task.id, this.taskList.id, event.currentIndex).subscribe();
    } else {
      transferArrayItem(
        event.previousContainer.data,
        event.container.data,
        event.previousIndex,
        event.currentIndex,
      );
      // Update backend for moving between lists
      const task = event.container.data[event.currentIndex];
      this.taskService.moveTask(task.id, this.taskList.id, event.currentIndex).subscribe();
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
}
