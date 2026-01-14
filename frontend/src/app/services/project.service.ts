import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, shareReplay } from 'rxjs';
import { Project } from '../models/project.model';
import { environment } from '../../environments/environment';

@Injectable({
    providedIn: 'root'
})
export class ProjectService {
    private apiUrl = `${environment.apiUrl}/planning/project`;
    private projects$?: Observable<Project[]>;

    constructor(private http: HttpClient) { }

    getProjects(): Observable<Project[]> {
        if (!this.projects$) {
            this.projects$ = this.http.get<Project[]>(this.apiUrl).pipe(
                shareReplay(1)
            );
        }
        return this.projects$;
    }

    clearCache(): void {
        this.projects$ = undefined;
    }
}