import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  WireHarness,
  HarnessListResponse,
  HarnessData,
  HarnessValidationResult
} from '../models/harness.model';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class HarnessService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/parts/harness`;

  // Get all harnesses with pagination
  getAllHarnesses(page: number = 1, limit: number = 20, includeInactive: boolean = false): Observable<HarnessListResponse> {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
      includeInactive: includeInactive.toString()
    });
    return this.http.get<HarnessListResponse>(`${this.apiUrl}?${params.toString()}`);
  }

  // Get single harness by ID with full data
  getHarnessById(id: number): Observable<WireHarness> {
    return this.http.get<WireHarness>(`${this.apiUrl}/${id}`);
  }

  // Get next available internal part number
  getNextPartNumber(): Observable<{ partNumber: string; nextId: number }> {
    return this.http.get<{ partNumber: string; nextId: number }>(`${this.apiUrl}/next-part-number`);
  }

  // Create new harness
  createHarness(data: {
    name: string;
    revision?: string;
    description?: string;
    harnessData?: HarnessData;
    thumbnailBase64?: string;
    createPart?: boolean;
    partID?: number;
  }): Observable<WireHarness> {
    return this.http.post<WireHarness>(this.apiUrl, data);
  }

  // Update existing harness
  updateHarness(id: number, data: {
    name?: string;
    revision?: string;
    description?: string;
    harnessData?: HarnessData;
    thumbnailBase64?: string;
  }): Observable<WireHarness> {
    return this.http.put<WireHarness>(`${this.apiUrl}/${id}`, data);
  }

  // Delete harness (soft delete)
  deleteHarness(id: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/${id}`);
  }

  // Validate harness JSON without saving
  validateHarness(harnessData: HarnessData): Observable<HarnessValidationResult> {
    return this.http.post<HarnessValidationResult>(`${this.apiUrl}/validate`, { harnessData });
  }
}
