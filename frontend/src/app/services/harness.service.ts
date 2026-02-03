import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  WireHarness,
  HarnessListResponse,
  HarnessData,
  HarnessValidationResult,
  HarnessHistoryEntry
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
  validateHarness(harnessData: HarnessData, harnessId?: number): Observable<HarnessValidationResult> {
    return this.http.post<HarnessValidationResult>(`${this.apiUrl}/validate`, { harnessData, harnessId });
  }

  // Batch fetch harness data for sub-harnesses
  getSubHarnessData(ids: number[]): Observable<WireHarness[]> {
    if (ids.length === 0) return new Observable(subscriber => subscriber.next([]));
    const idsParam = ids.join(',');
    return this.http.get<WireHarness[]>(`${this.apiUrl}/sub-harness-data?ids=${idsParam}`);
  }

  // Get harnesses that contain this one as a sub-harness
  getParentHarnesses(id: number): Observable<{ id: number; name: string }[]> {
    return this.http.get<{ id: number; name: string }[]>(`${this.apiUrl}/${id}/parents`);
  }

  // === Revision Control Methods ===

  // Submit harness for review
  submitForReview(id: number): Observable<WireHarness> {
    return this.http.post<WireHarness>(`${this.apiUrl}/${id}/submit-review`, {});
  }

  // Reject harness back to draft
  reject(id: number, notes: string): Observable<WireHarness> {
    return this.http.post<WireHarness>(`${this.apiUrl}/${id}/reject`, { notes });
  }

  // Release harness
  release(id: number): Observable<WireHarness> {
    return this.http.post<WireHarness>(`${this.apiUrl}/${id}/release`, {});
  }

  // Get revision history
  getHistory(id: number): Observable<HarnessHistoryEntry[]> {
    return this.http.get<HarnessHistoryEntry[]>(`${this.apiUrl}/${id}/history`);
  }

  // Get all revisions of a harness
  getAllRevisions(id: number): Observable<WireHarness[]> {
    return this.http.get<WireHarness[]>(`${this.apiUrl}/${id}/revisions`);
  }

  // Revert to a snapshot
  revertToSnapshot(id: number, historyId: number): Observable<WireHarness> {
    return this.http.post<WireHarness>(`${this.apiUrl}/${id}/revert/${historyId}`, {});
  }
}
