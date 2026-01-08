import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export enum TaskActionID {
    MOVE_LIST = 1,
    ADD_TO_PROJECT = 2,
    ADD_PRIORITY = 3,
    CHANGE_STATUS = 4,
    CREATED = 5
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
    private apiUrl = `${environment.apiUrl}/planning/taskhistory`;
    private http = inject(HttpClient);

    getAllHistory(offset: number = 0, limit: number = 10): Observable<TaskHistory[]> {
        return this.http.get<TaskHistory[]>(`${this.apiUrl}?offset=${offset}&limit=${limit}`);
    }

    getTaskHistory(taskId: number): Observable<TaskHistory[]> {
        return this.http.get<TaskHistory[]>(`${this.apiUrl}/task/${taskId}`);
    }
}
