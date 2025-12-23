import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, Subject } from 'rxjs';
import { TaskList } from '../models/task-list.model';
import { Task } from '../models/task.model';

@Injectable({
    providedIn: 'root'
})
export class TaskService {
    private apiUrl = 'http://localhost:3000/api/planning/tasklist';
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
        return this.http.post<Task>('http://localhost:3000/api/planning/task', task, { headers });
    }

    moveTask(taskId: number, taskListId: number, newIndex: number): Observable<Task> {
        const token = localStorage.getItem('auth_token');
        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`
        });
        return this.http.put<Task>(`http://localhost:3000/api/planning/task/${taskId}/move`, { taskListId, newIndex }, { headers });
    }

    updateTask(taskId: number, updates: Partial<Task>): Observable<Task> {
        const token = localStorage.getItem('auth_token');
        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`
        });
        return this.http.put<Task>(`http://localhost:3000/api/planning/task/${taskId}`, updates, { headers });
    }

    getTask(taskId: number): Observable<Task> {
        const token = localStorage.getItem('auth_token');
        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`
        });
        return this.http.get<Task>(`http://localhost:3000/api/planning/task/${taskId}`, { headers });
    }
}
