import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Task, TaskList, TaskType, TaskPriority, TaskStatus } from '../../../models/common/task.model';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PlanningService } from '../../../services/planning/planning.service';
import { catchError, forkJoin, of } from 'rxjs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TaskCardComponent } from '../task-card/task-card.component';

@Component({
    selector: 'app-task-list-view',
    templateUrl: './task-list-view.component.html',
    styleUrls: ['./task-list-view.component.scss'],
    standalone: true,
    imports: [
        CommonModule,
        MatCardModule,
        MatChipsModule,
        MatIconModule,
        MatButtonModule,
        DragDropModule,
        MatTooltipModule,
        MatProgressSpinnerModule,
        TaskCardComponent
    ]
})
export class TaskListViewComponent implements OnInit {
    tasks: Task[] = [];
    taskLists: TaskList[] = [];
    loading = true;
    error: string | null = null;

    constructor(private planningService: PlanningService) { }

    ngOnInit(): void {
        this.loadData();
    }

    loadData(): void {
        this.loading = true;
        this.error = null;

        forkJoin({
            tasks: this.planningService.getAllTasks().pipe(
                catchError(error => {
                    console.error('Error loading tasks:', error);
                    return of([]);
                })
            ),
            taskLists: this.planningService.getAllTaskLists().pipe(
                catchError(error => {
                    console.error('Error loading task lists:', error);
                    return of([]);
                })
            )
        }).subscribe({
            next: ({ tasks, taskLists }) => {
                this.tasks = tasks;
                this.taskLists = taskLists;
                this.loading = false;
            },
            error: (error) => {
                console.error('Error loading data:', error);
                this.error = 'Failed to load tasks and task lists';
                this.loading = false;
            }
        });
    }

    getTasksByList(taskListId: number): Task[] {
        return this.tasks.filter(task => task.taskListID === taskListId);
    }

    onTaskDrop(event: any, targetTaskListId: number) {
        const taskId = event.item.data.id;
        this.planningService.moveTask(taskId, targetTaskListId).subscribe({
            next: (updatedTask) => {
                // Update the task in the local array
                const index = this.tasks.findIndex(t => t.id === taskId);
                if (index !== -1) {
                    this.tasks[index] = updatedTask;
                }
            },
            error: (error) => {
                console.error('Error moving task:', error);
                // Reload all tasks to ensure consistency
                this.loadData();
            }
        });
    }

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