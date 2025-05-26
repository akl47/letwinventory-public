import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Task, TaskList, TaskType } from '../../models/common/task.model';
import { Project } from '../../models/common/project.model';

@Injectable({
    providedIn: 'root'
})
export class PlanningService {
    private apiUrl = `${environment.apiUrl}/planning`;
    private taskUpdated = new Subject<void>();

    taskUpdated$ = this.taskUpdated.asObservable();

    constructor(private http: HttpClient) { }

    // Task List Methods
    getAllTaskLists(): Observable<TaskList[]> {
        return this.http.get<TaskList[]>(`${this.apiUrl}/tasklist`);
    }

    // Task Methods
    getAllTasks(projectId?: number, taskListId?: number): Observable<Task[]> {
        let url = `${this.apiUrl}/task`;
        const params: any = {};

        if (projectId) params.projectId = projectId;
        if (taskListId) params.taskListId = taskListId;

        return this.http.get<Task[]>(url, { params });
    }

    createTask(task: Partial<Task>): Observable<Task> {
        return this.http.post<Task>(`${this.apiUrl}/task`, task);
    }

    updateTask(taskId: number, task: Partial<Task>): Observable<Task> {
        return this.http.put<Task>(`${this.apiUrl}/task/${taskId}`, task);
    }

    deleteTask(taskId: number): Observable<void> {
        return this.http.delete<void>(`${this.apiUrl}/task/${taskId}`);
    }

    moveTask(taskId: number, taskListId: number): Observable<Task> {
        return this.http.put<Task>(`${this.apiUrl}/task/${taskId}/move`, { taskListId });
    }

    // Project Methods
    getProject(projectId: number): Observable<Project> {
        return this.http.get<Project>(`${this.apiUrl}/project/${projectId}`);
    }

    getAllProjects(): Observable<Project[]> {
        return this.http.get<Project[]>(`${this.apiUrl}/project`);
    }

    // Notify subscribers that a task has been updated
    notifyTaskUpdated(): void {
        this.taskUpdated.next();
    }
} 