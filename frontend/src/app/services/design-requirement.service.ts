import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, shareReplay, tap } from 'rxjs';
import { DesignRequirement, RequirementHistoryEntry } from '../models/design-requirement.model';
import { environment } from '../../environments/environment';

@Injectable({
    providedIn: 'root'
})
export class DesignRequirementService {
    private http = inject(HttpClient);
    private apiUrl = `${environment.apiUrl}/design/requirement`;
    private requirements$?: Observable<DesignRequirement[]>;

    getAll(projectID?: number): Observable<DesignRequirement[]> {
        const url = projectID ? `${this.apiUrl}?projectID=${projectID}` : this.apiUrl;
        // Only cache when fetching all (no filter)
        if (!projectID) {
            if (!this.requirements$) {
                this.requirements$ = this.http.get<DesignRequirement[]>(url).pipe(
                    shareReplay(1)
                );
            }
            return this.requirements$;
        }
        return this.http.get<DesignRequirement[]>(url);
    }

    getById(id: number): Observable<DesignRequirement> {
        return this.http.get<DesignRequirement>(`${this.apiUrl}/${id}`);
    }

    create(data: Partial<DesignRequirement>): Observable<DesignRequirement> {
        return this.http.post<DesignRequirement>(this.apiUrl, data).pipe(
            tap(() => this.clearCache())
        );
    }

    update(id: number, data: Partial<DesignRequirement>): Observable<DesignRequirement> {
        return this.http.put<DesignRequirement>(`${this.apiUrl}/${id}`, data).pipe(
            tap(() => this.clearCache())
        );
    }

    delete(id: number): Observable<any> {
        return this.http.delete(`${this.apiUrl}/${id}`).pipe(
            tap(() => this.clearCache())
        );
    }

    approve(id: number): Observable<DesignRequirement> {
        return this.http.put<DesignRequirement>(`${this.apiUrl}/${id}/approve`, {}).pipe(
            tap(() => this.clearCache())
        );
    }

    unapprove(id: number): Observable<DesignRequirement> {
        return this.http.put<DesignRequirement>(`${this.apiUrl}/${id}/unapprove`, {}).pipe(
            tap(() => this.clearCache())
        );
    }

    takeOwnership(id: number): Observable<DesignRequirement> {
        return this.http.put<DesignRequirement>(`${this.apiUrl}/${id}/take-ownership`, {}).pipe(
            tap(() => this.clearCache())
        );
    }

    getHistory(id: number): Observable<RequirementHistoryEntry[]> {
        return this.http.get<RequirementHistoryEntry[]>(`${this.apiUrl}/${id}/history`);
    }

    clearCache(): void {
        this.requirements$ = undefined;
    }
}
