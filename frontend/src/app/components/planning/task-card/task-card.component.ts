import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Task, TaskPriority, TaskStatus, TaskType } from '../../../models/common/task.model';

@Component({
    selector: 'app-task-card',
    templateUrl: './task-card.component.html',
    styleUrls: ['./task-card.component.scss'],
    imports: [
        CommonModule,
        MatCardModule,
        MatChipsModule,
        MatIconModule,
        MatButtonModule,
        MatTooltipModule
    ],
    standalone: true
})
export class TaskCardComponent {
    @Input() task!: Task;

    getTaskStatus(task: Task): TaskStatus {
        if (task.doneFlag) {
            return TaskStatus.COMPLETED;
        }
        return task.activeFlag ? TaskStatus.ACTIVE : TaskStatus.BLOCKED;
    }

    getTaskPriority(task: Task): TaskPriority {
        switch (task.taskTypeEnum) {
            case TaskType.CRITICAL_PATH:
                return TaskPriority.HIGH;
            case TaskType.TRACKING:
                return TaskPriority.MEDIUM;
            default:
                return TaskPriority.LOW;
        }
    }

    getPriorityColor(task: Task): string {
        switch (this.getTaskPriority(task)) {
            case TaskPriority.HIGH:
                return 'warn';
            case TaskPriority.MEDIUM:
                return 'accent';
            default:
                return 'primary';
        }
    }

    getStatusColor(task: Task): string {
        switch (this.getTaskStatus(task)) {
            case TaskStatus.COMPLETED:
                return 'primary';
            case TaskStatus.BLOCKED:
                return 'warn';
            default:
                return 'accent';
        }
    }
} 