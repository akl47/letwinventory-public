import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, shareReplay } from 'rxjs';
import { Project } from '../models/project.model';

@Injectable({
    providedIn: 'root'
})
export class ProjectService {
    private apiUrl = 'http://localhost:3000/api/planning/project';
    private projects$?: Observable<Project[]>;

    constructor(private http: HttpClient) { }

    getProjects(): Observable<Project[]> {
        if (!this.projects$) {
            const token = localStorage.getItem('auth_token');
            const headers = new HttpHeaders({
                'Authorization': `Bearer ${token}`
            });
            this.projects$ = this.http.get<Project[]>(this.apiUrl, { headers }).pipe(
                shareReplay(1)
            );
        }
        return this.projects$;
    }

    clearCache(): void {
        this.projects$ = undefined;
    }
}
