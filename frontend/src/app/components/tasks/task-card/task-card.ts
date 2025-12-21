import { Component, inject, Input } from '@angular/core';
import { Task } from '../../../models/task.model';
import { CommonModule } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { TaskCardDialog } from '../task-card-dialog/task-card-dialog';

@Component({
  selector: 'app-task-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './task-card.html',
  styleUrl: './task-card.css',
})
export class TaskCard {
  @Input({ required: true }) task!: Task;

  private dialog = inject(MatDialog);

  openDialog(): void {
    this.dialog.open(TaskCardDialog, {
      data: { task: this.task },
      width: '768px',
      maxWidth: '95vw',
      panelClass: 'trello-dialog-container',
    });
  }
}
