import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Task, TaskList, TaskType } from '../../../models/common/task.model';
import { Project } from '../../../models/common/project.model';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { FormsModule } from '@angular/forms';
import { PlanningService } from '../../../services/planning/planning.service';
import { MatMenuModule } from '@angular/material/menu';

@Component({
    selector: 'app-task-details-dialog',
    templateUrl: './task-details-dialog.component.html',
    styleUrls: ['./task-details-dialog.component.scss'],
    imports: [
        CommonModule,
        MatDialogModule,
        MatButtonModule,
        MatIconModule,
        MatChipsModule,
        MatFormFieldModule,
        MatInputModule,
        MatSelectModule,
        FormsModule,
        MatMenuModule
    ],
    standalone: true
})
export class TaskDetailsDialogComponent implements OnInit {
    public readonly TaskType = TaskType; // Make the enum available in the template
    taskLists: TaskList[] = [];
    projects: Project[] = [];
    description: string = '';
    projectName: string | null = null;

    constructor(
        public dialogRef: MatDialogRef<TaskDetailsDialogComponent>,
        @Inject(MAT_DIALOG_DATA) public data: { task: Task },
        private planningService: PlanningService
    ) {
        this.description = data.task.description || '';
    }

    ngOnInit() {
        this.loadTaskLists();
        this.loadProjects();
        if (this.data.task.projectID) {
            this.loadProjectName();
        }
    }

    loadTaskLists() {
        this.planningService.getAllTaskLists().subscribe(lists => {
            this.taskLists = lists;
        });
    }

    loadProjects() {
        this.planningService.getAllProjects().subscribe(projects => {
            this.projects = projects;
        });
    }

    loadProjectName() {
        this.planningService.getProject(this.data.task.projectID).subscribe({
            next: (project) => {
                this.projectName = project.name;
            },
            error: (error) => {
                console.error('Error loading project:', error);
                this.projectName = null;
            }
        });
    }

    getCurrentListName(): string {
        const currentList = this.taskLists.find(list => list.id === this.data.task.taskListID);
        return currentList ? currentList.name : 'Loading...';
    }

    getCurrentProjectName(): string {
        if (!this.data.task.projectID) return 'No Project';
        const currentProject = this.projects.find(p => p.id === this.data.task.projectID);
        return currentProject ? currentProject.name : 'Loading...';
    }

    getCurrentProjectColor(): string {
        if (!this.data.task.projectID) return 'primary';
        const currentProject = this.projects.find(p => p.id === this.data.task.projectID);
        return currentProject ? `#${currentProject.tagColorHex}` : 'primary';
    }

    onListChange(newListId: number) {
        this.planningService.moveTask(this.data.task.id, newListId).subscribe({
            next: (updatedTask) => {
                this.data.task = updatedTask;
                this.planningService.notifyTaskUpdated();
            },
            error: (error) => {
                console.error('Error moving task:', error);
            }
        });
    }

    onProjectChange(newProjectId: number) {
        this.planningService.updateTask(this.data.task.id, { projectID: newProjectId }).subscribe({
            next: (updatedTask) => {
                this.data.task = updatedTask;
                this.loadProjectName();
                this.planningService.notifyTaskUpdated();
            },
            error: (error) => {
                console.error('Error updating project:', error);
            }
        });
    }

    onPriorityChange(newPriority: TaskType) {
        this.planningService.updateTask(this.data.task.id, { taskTypeEnum: newPriority }).subscribe({
            next: (updatedTask) => {
                this.data.task = updatedTask;
                this.planningService.notifyTaskUpdated();
            },
            error: (error) => {
                console.error('Error updating priority:', error);
            }
        });
    }

    onDescriptionChange() {
        // Here you would typically call a service to update the task description
        // For now, we'll just update the local task object
        this.data.task.description = this.description;
    }

    close(): void {
        this.dialogRef.close();
    }
} 