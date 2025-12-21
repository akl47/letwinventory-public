import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Task } from '../../../models/task.model';
import { CommonModule } from '@angular/common';

export interface TaskCardDialogData {
  task: Task;
}

@Component({
  selector: 'app-task-card-dialog',
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  templateUrl: './task-card-dialog.html',
  styleUrl: './task-card-dialog.css',
})
export class TaskCardDialog {
  data = inject<TaskCardDialogData>(MAT_DIALOG_DATA);

  get task(): Task {
    return this.data.task;
  }

  isOverdue(): boolean {
    if (!this.task.dueDate) return false;
    return new Date(this.task.dueDate) < new Date();
  }
}
