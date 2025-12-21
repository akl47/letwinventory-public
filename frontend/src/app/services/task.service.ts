import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TaskList } from '../models/task-list.model';
import { Task } from '../models/task.model';

@Injectable({
    providedIn: 'root'
})
export class TaskService {
    private apiUrl = 'http://localhost:3000/api/planning/tasklist';

    constructor(private http: HttpClient) { }

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
}
