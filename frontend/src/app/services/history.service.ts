import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';

export enum TaskActionID {
    MOVE_LIST = 1,
    ADD_TO_PROJECT = 2,
    ADD_PRIORITY = 3,
    CHANGE_STATUS = 4
}

export interface TaskHistory {
    id: number;
    taskID: number;
    userID: number;
    actionID: TaskActionID;
    fromID: number;
    toID: number;
    createdAt: string;
    task?: {
        id: number;
        name: string;
    };
    user?: {
        id: number;
        displayName: string;
        photoURL?: string;
    };
}

@Injectable({
    providedIn: 'root'
})
export class HistoryService {
    private apiUrl = 'http://localhost:3000/api/planning/taskhistory';
    private http = inject(HttpClient);

    getAllHistory(): Observable<TaskHistory[]> {
        const token = localStorage.getItem('auth_token');
        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`
        });
        return this.http.get<TaskHistory[]>(this.apiUrl, { headers });
    }

    getTaskHistory(taskId: number): Observable<TaskHistory[]> {
        const token = localStorage.getItem('auth_token');
        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`
        });
        return this.http.get<TaskHistory[]>(`${this.apiUrl}/task/${taskId}`, { headers });
    }
}
