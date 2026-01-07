import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
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
        const token = localStorage.getItem('auth_token');
        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`
        });
        return this.http.get<TaskList[]>(this.apiUrl, { headers });
    }
    createTask(task: Partial<Task>): Observable<Task> {
        const token = localStorage.getItem('auth_token');
        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`
        });
        return this.http.post<Task>(`${environment.apiUrl}/planning/task`, task, { headers });
    }

    moveTask(taskId: number, taskListId: number, newIndex: number): Observable<Task> {
        const token = localStorage.getItem('auth_token');
        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`
        });
        return this.http.put<Task>(`${environment.apiUrl}/planning/task/${taskId}/move`, { taskListId, newIndex }, { headers });
    }

    updateTask(taskId: number, updates: Partial<Task>): Observable<Task> {
        const token = localStorage.getItem('auth_token');
        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`
        });
        return this.http.put<Task>(`${environment.apiUrl}/planning/task/${taskId}`, updates, { headers });
    }

    getTask(taskId: number): Observable<Task> {
        const token = localStorage.getItem('auth_token');
        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`
        });
        return this.http.get<Task>(`${environment.apiUrl}/planning/task/${taskId}`, { headers });
    }

    getSubtasks(parentTaskId: number): Observable<Task[]> {
        const token = localStorage.getItem('auth_token');
        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`
        });
        return this.http.get<Task[]>(`${environment.apiUrl}/planning/task?parentTaskID=${parentTaskId}`, { headers });
    }

    getAllTasks(): Observable<Task[]> {
        const token = localStorage.getItem('auth_token');
        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`
        });
        return this.http.get<Task[]>(`${environment.apiUrl}/planning/task`, { headers });
    }
}
