import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, shareReplay, tap } from 'rxjs';
import { RequirementCategory } from '../models/design-requirement.model';
import { environment } from '../../environments/environment';

@Injectable({
    providedIn: 'root'
})
export class RequirementCategoryService {
    private http = inject(HttpClient);
    private apiUrl = `${environment.apiUrl}/design/requirement-category`;
    private categories$?: Observable<RequirementCategory[]>;

    getAll(): Observable<RequirementCategory[]> {
        if (!this.categories$) {
            this.categories$ = this.http.get<RequirementCategory[]>(this.apiUrl).pipe(
                shareReplay(1)
            );
        }
        return this.categories$;
    }

    create(data: Partial<RequirementCategory>): Observable<RequirementCategory> {
        return this.http.post<RequirementCategory>(this.apiUrl, data).pipe(
            tap(() => this.clearCache())
        );
    }

    update(id: number, data: Partial<RequirementCategory>): Observable<RequirementCategory> {
        return this.http.put<RequirementCategory>(`${this.apiUrl}/${id}`, data).pipe(
            tap(() => this.clearCache())
        );
    }

    delete(id: number): Observable<any> {
        return this.http.delete(`${this.apiUrl}/${id}`).pipe(
            tap(() => this.clearCache())
        );
    }

    clearCache(): void {
        this.categories$ = undefined;
    }
}
