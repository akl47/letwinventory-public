import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, shareReplay, tap } from 'rxjs';
import { ShipmentTracking } from '../models/tracking.model';
import { environment } from '../../environments/environment';

@Injectable({
    providedIn: 'root'
})
export class TrackingService {
    private http = inject(HttpClient);
    private apiUrl = `${environment.apiUrl}/inventory/tracking`;
    private cache$?: Observable<ShipmentTracking[]>;

    getAll(includeInactive = false): Observable<ShipmentTracking[]> {
        if (includeInactive) {
            return this.http.get<ShipmentTracking[]>(`${this.apiUrl}?includeInactive=true`);
        }
        if (!this.cache$) {
            this.cache$ = this.http.get<ShipmentTracking[]>(this.apiUrl).pipe(
                shareReplay(1)
            );
        }
        return this.cache$;
    }

    getById(id: number): Observable<ShipmentTracking> {
        return this.http.get<ShipmentTracking>(`${this.apiUrl}/${id}`);
    }

    create(data: { trackingNumber: string; orderID?: number }): Observable<ShipmentTracking> {
        return this.http.post<ShipmentTracking>(this.apiUrl, data).pipe(
            tap(() => this.clearCache())
        );
    }

    update(id: number, data: Partial<ShipmentTracking>): Observable<ShipmentTracking> {
        return this.http.put<ShipmentTracking>(`${this.apiUrl}/${id}`, data).pipe(
            tap(() => this.clearCache())
        );
    }

    delete(id: number): Observable<any> {
        return this.http.delete(`${this.apiUrl}/${id}`).pipe(
            tap(() => this.clearCache())
        );
    }

    refresh(id: number): Observable<ShipmentTracking> {
        return this.http.post<ShipmentTracking>(`${this.apiUrl}/${id}/refresh`, {}).pipe(
            tap(() => this.clearCache())
        );
    }

    clearCache(): void {
        this.cache$ = undefined;
    }
}
