import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Task, TaskList, TaskType, TaskPriority, TaskStatus } from '../../models/common/task.model';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { MatTooltipModule } from '@angular/material/tooltip';

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
        MatTooltipModule
    ]
})
export class TaskListViewComponent implements OnInit {
    tasks: Task[] = [];
    taskLists: TaskList[] = [];

    constructor() { }

    ngOnInit(): void {
        // TODO: Replace with actual task data from a service
        this.tasks = [
            {
                id: 1,
                projectID: 1,
                taskListID: 1,
                name: 'Implement user authentication',
                description: 'Add login and registration functionality',
                doneFlag: false,
                completeWithChildren: false,
                taskTypeEnum: TaskType.NORMAL,
                activeFlag: true,
                createdAt: new Date(),
                updatedAt: new Date()
            },
            {
                id: 2,
                projectID: 1,
                taskListID: 2,
                name: 'Design database schema',
                description: 'Create ERD for the application',
                doneFlag: false,
                completeWithChildren: false,
                taskTypeEnum: TaskType.NORMAL,
                activeFlag: true,
                createdAt: new Date(),
                updatedAt: new Date()
            }
        ];

        this.taskLists = [
            { id: 1, name: 'To Do', activeFlag: true, createdAt: new Date(), updatedAt: new Date() },
            { id: 2, name: 'In Progress', activeFlag: true, createdAt: new Date(), updatedAt: new Date() },
            { id: 3, name: 'Review', activeFlag: true, createdAt: new Date(), updatedAt: new Date() },
            { id: 4, name: 'Done', activeFlag: true, createdAt: new Date(), updatedAt: new Date() }
        ];
    }

    getTasksByList(taskListId: number): Task[] {
        return this.tasks.filter(task => task.taskListID === taskListId);
    }

    onTaskDrop(event: any, targetTaskListId: number) {
        // TODO: Implement drag and drop functionality
        console.log('Task dropped in list:', targetTaskListId);
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