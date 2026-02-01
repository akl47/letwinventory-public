import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, shareReplay, tap } from 'rxjs';
import { Project } from '../models/project.model';
import { environment } from '../../environments/environment';

@Injectable({
    providedIn: 'root'
})
export class ProjectService {
    private http = inject(HttpClient);
    private apiUrl = `${environment.apiUrl}/planning/project`;
    private projects$?: Observable<Project[]>;

    getProjects(): Observable<Project[]> {
        if (!this.projects$) {
            this.projects$ = this.http.get<Project[]>(this.apiUrl).pipe(
                shareReplay(1)
            );
        }
        return this.projects$;
    }

    getProjectById(id: number): Observable<Project> {
        return this.http.get<Project>(`${this.apiUrl}/${id}`);
    }

    createProject(project: Partial<Project>): Observable<Project> {
        return this.http.post<Project>(this.apiUrl, project).pipe(
            tap(() => this.clearCache())
        );
    }

    updateProject(id: number, project: Partial<Project>): Observable<Project> {
        return this.http.put<Project>(`${this.apiUrl}/${id}`, project).pipe(
            tap(() => this.clearCache())
        );
    }

    deleteProject(id: number): Observable<any> {
        return this.http.delete(`${this.apiUrl}/${id}`).pipe(
            tap(() => this.clearCache())
        );
    }

    clearCache(): void {
        this.projects$ = undefined;
    }
}