import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, shareReplay, tap } from 'rxjs';
import { ScheduledTask } from '../models/scheduled-task.model';
import { environment } from '../../environments/environment';

@Injectable({
    providedIn: 'root'
})
export class ScheduledTaskService {
    private http = inject(HttpClient);
    private apiUrl = `${environment.apiUrl}/planning/scheduled-task`;
    private cache$?: Observable<ScheduledTask[]>;

    getAll(includeInactive = false): Observable<ScheduledTask[]> {
        if (includeInactive) {
            return this.http.get<ScheduledTask[]>(`${this.apiUrl}?includeInactive=true`);
        }
        if (!this.cache$) {
            this.cache$ = this.http.get<ScheduledTask[]>(this.apiUrl).pipe(
                shareReplay(1)
            );
        }
        return this.cache$;
    }

    getById(id: number): Observable<ScheduledTask> {
        return this.http.get<ScheduledTask>(`${this.apiUrl}/${id}`);
    }

    create(data: Partial<ScheduledTask>): Observable<ScheduledTask> {
        return this.http.post<ScheduledTask>(this.apiUrl, data).pipe(
            tap(() => this.clearCache())
        );
    }

    update(id: number, data: Partial<ScheduledTask>): Observable<ScheduledTask> {
        return this.http.put<ScheduledTask>(`${this.apiUrl}/${id}`, data).pipe(
            tap(() => this.clearCache())
        );
    }

    delete(id: number): Observable<any> {
        return this.http.delete(`${this.apiUrl}/${id}`).pipe(
            tap(() => this.clearCache())
        );
    }

    clearCache(): void {
        this.cache$ = undefined;
    }
}
