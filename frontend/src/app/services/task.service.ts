import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject } from 'rxjs';
import { TaskList } from '../models/task-list.model';
import { Task } from '../models/task.model';
import { environment } from '../../environments/environment';

@Injectable({
    providedIn: 'root'
})
export class TaskService {
    private apiUrl = `${environment.apiUrl}/planning/tasklist`;
    private refreshTaskListsSubject = new Subject<void>();
    refreshTaskLists$ = this.refreshTaskListsSubject.asObservable();

    constructor(private http: HttpClient) { }

    triggerRefresh(): void {
        this.refreshTaskListsSubject.next();
    }

    getTaskLists(): Observable<TaskList[]> {
        return this.http.get<TaskList[]>(this.apiUrl);
    }

    createTask(task: Partial<Task>): Observable<Task> {
        return this.http.post<Task>(`${environment.apiUrl}/planning/task`, task);
    }

    moveTask(taskId: number, taskListId: number, newIndex: number): Observable<Task> {
        return this.http.put<Task>(`${environment.apiUrl}/planning/task/${taskId}/move`, { taskListId, newIndex });
    }

    updateTask(taskId: number, updates: Partial<Task>): Observable<Task> {
        return this.http.put<Task>(`${environment.apiUrl}/planning/task/${taskId}`, updates);
    }

    getTask(taskId: number): Observable<Task> {
        return this.http.get<Task>(`${environment.apiUrl}/planning/task/${taskId}`);
    }

    getSubtasks(parentTaskId: number): Observable<Task[]> {
        return this.http.get<Task[]>(`${environment.apiUrl}/planning/task?parentTaskID=${parentTaskId}`);
    }

    getAllTasks(): Observable<Task[]> {
        return this.http.get<Task[]>(`${environment.apiUrl}/planning/task`);
    }
}
