import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { CadModel, CadModelHistoryEntry, PartWithCadSummary } from '../models/cad-model.model';
import { environment } from '../../environments/environment';

/** Server-side regeneration response (Phase 1 — see backend cadRegenService.js). */
export interface RegenerateResponse {
  modelId: number;
  revision: string;
  features: Array<{
    featureId: string;
    faces: Array<{
      faceId: string;
      persistentName: string;
      isFlat: boolean;
      positions: number[];
      normals: number[];
      indices: number[];
    }>;
    error?: string;
    cached: boolean;
  }>;
  errors: string[];
}

@Injectable({ providedIn: 'root' })
export class CadModelService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/design/cad-model`;

  listPartsWithCad(): Observable<PartWithCadSummary[]> {
    return this.http.get<PartWithCadSummary[]>(`${this.apiUrl}/parts-with-cad`);
  }

  listByPart(partID: number): Observable<CadModel[]> {
    return this.http.get<CadModel[]>(`${this.apiUrl}/by-part/${partID}`);
  }

  getActiveByPart(partID: number): Observable<CadModel> {
    return this.http.get<CadModel>(`${this.apiUrl}/by-part/${partID}/active`);
  }

  createForPart(partID: number, body: { name?: string } = {}): Observable<CadModel> {
    return this.http.post<CadModel>(`${this.apiUrl}/by-part/${partID}`, body);
  }

  getById(id: number): Observable<CadModel> {
    return this.http.get<CadModel>(`${this.apiUrl}/${id}`);
  }

  update(id: number, patch: Partial<Pick<CadModel, 'name' | 'featureTree' | 'sketchDoc'>>): Observable<CadModel> {
    return this.http.put<CadModel>(`${this.apiUrl}/${id}`, patch);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }

  submit(id: number): Observable<CadModel> {
    return this.http.post<CadModel>(`${this.apiUrl}/${id}/submit`, {});
  }

  release(id: number): Observable<CadModel> {
    return this.http.post<CadModel>(`${this.apiUrl}/${id}/release`, {});
  }

  newRevision(id: number): Observable<CadModel> {
    return this.http.post<CadModel>(`${this.apiUrl}/${id}/new-revision`, {});
  }

  getHistory(id: number): Observable<CadModelHistoryEntry[]> {
    return this.http.get<CadModelHistoryEntry[]>(`${this.apiUrl}/${id}/history`);
  }

  // Phase 1 — server-side regen. POSTs the current model id; the server walks
  // the featureTree, hits the Postgres BRep cache, falls through to the Rust
  // kernel on miss, and streams the merged geometry back as JSON. Phase 1.5
  // will replace this with the cadStreamService WebSocket for incremental
  // updates during live editing.
  regenerate(id: number): Observable<RegenerateResponse> {
    return this.http.post<RegenerateResponse>(`${this.apiUrl}/${id}/regenerate`, {});
  }
}
