import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { CadModel, CadBranch, CadCommit, CadModelHistoryEntry, PartWithCadSummary } from '../models/cad-model.model';
import { environment } from '../../environments/environment';

/** Server-side regeneration response (Phase 1 — see backend cadRegenService.js). */
export interface RegenerateResponse {
  modelId: number;
  revision: string;
  features: Array<{
    featureId: string;
    /** Which body this feature contributed to. New for multi-body. */
    bodyId: string | null;
    faces: Array<{
      faceId: string;
      persistentName: string;
      isFlat: boolean;
      positions: number[];
      normals: number[];
      indices: number[];
      boundaryEdgeIds?: string[];
    }>;
    /** Per-feature topology — vertex/edge IDs are scoped `<featureId>#<loop>/<localId>`. */
    topology: {
      vertices: Array<{ id: string; position: [number, number, number] }>;
      edges: Array<{ id: string; isStraight: boolean; isTangent?: boolean; endpoints: [[number, number, number], [number, number, number]]; polyline?: Array<[number, number, number]> }>;
    };
    error?: string;
    cached: boolean;
  }>;
  /** Body roster in creation order. New for multi-body. */
  bodies?: Array<{ id: string; name: string | null }>;
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

  update(id: number, patch: Partial<Pick<CadModel, 'name' | 'featureTree' | 'sketchDoc' | 'equations'>>): Observable<CadModel> {
    return this.http.put<CadModel>(`${this.apiUrl}/${id}`, patch);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }

  /** Release the working copy as the Part's revision: commit + freeze + tag. */
  release(id: number): Observable<{ commitHash: string; revision: string; model: CadModel }> {
    return this.http.post<{ commitHash: string; revision: string; model: CadModel }>(`${this.apiUrl}/${id}/release`, {});
  }

  getHistory(id: number): Observable<CadModelHistoryEntry[]> {
    return this.http.get<CadModelHistoryEntry[]>(`${this.apiUrl}/${id}/history`);
  }

  // Phase 1 — server-side regen. POSTs the current model id; the server walks
  // the featureTree, hits the Postgres BRep cache, falls through to the Rust
  // kernel on miss, and streams the merged geometry back as JSON. Phase 1.5
  // will replace this with the cadStreamService WebSocket for incremental
  // updates during live editing.
  /** Trigger a server-side regen.
   * @param rollbackBeforeIndex when set, the backend skips features at
   *   or past this index entirely (no kernel work, no cache lookups).
   *   Mirrors the frontend's rollback-bar signal. */
  regenerate(id: number, rollbackBeforeIndex: number | null = null): Observable<RegenerateResponse> {
    const body = rollbackBeforeIndex !== null ? { rollbackBeforeIndex } : {};
    return this.http.post<RegenerateResponse>(`${this.apiUrl}/${id}/regenerate`, body);
  }

  // ── VCS: checkout / check-in / lock / commit log (Phase 1) ──────────────────

  /** Acquire the exclusive edit lock; returns the updated model. */
  checkout(id: number): Observable<CadModel> {
    return this.http.post<CadModel>(`${this.apiUrl}/${id}/checkout`, {});
  }

  /** Commit the working copy with a message; returns the new commit hash. */
  checkin(id: number, message: string): Observable<{ commitHash: string; model: CadModel }> {
    return this.http.post<{ commitHash: string; model: CadModel }>(`${this.apiUrl}/${id}/checkin`, { message });
  }

  /** Release the lock the current user holds. */
  releaseLock(id: number): Observable<CadModel> {
    return this.http.post<CadModel>(`${this.apiUrl}/${id}/release-lock`, {});
  }

  /** Admin override: force-release whoever holds the lock (needs cad.approve). */
  forceUnlock(id: number): Observable<CadModel> {
    return this.http.post<CadModel>(`${this.apiUrl}/${id}/force-unlock`, {});
  }

  /** Commit history for the model's branch, newest first. */
  getCommits(id: number): Observable<CadCommit[]> {
    return this.http.get<CadCommit[]>(`${this.apiUrl}/${id}/commits`);
  }

  // ── VCS: variant branches + cherry-pick (Phase 2) ───────────────────────────

  listBranches(id: number): Observable<CadBranch[]> {
    return this.http.get<CadBranch[]>(`${this.apiUrl}/${id}/branches`);
  }

  /** Create a variant branch (defaults to the current head). */
  createBranch(id: number, name: string, fromCommit?: string): Observable<CadBranch> {
    return this.http.post<CadBranch>(`${this.apiUrl}/${id}/branches`, { name, fromCommit });
  }

  /** Switch the working copy to another branch (rejected while dirty). */
  switchBranch(id: number, name: string): Observable<CadModel> {
    return this.http.post<CadModel>(`${this.apiUrl}/${id}/switch-branch`, { name });
  }

  /** Archive a branch (current + default are protected). */
  archiveBranch(id: number, name: string): Observable<{ archived: string }> {
    return this.http.delete<{ archived: string }>(`${this.apiUrl}/${id}/branches/${encodeURIComponent(name)}`);
  }

  /** Cherry-pick a single feature from a source commit into the working copy. */
  cherryPick(id: number, sourceCommit: string, featureId: string): Observable<CadModel> {
    return this.http.post<CadModel>(`${this.apiUrl}/${id}/cherry-pick`, { sourceCommit, featureId });
  }

  /** Download the model's bodies as a STEP file (returns the file text). The
   * auth interceptor adds the token header, so this can't be a plain link.
   * `bodyIds` optionally restricts to a subset of bodies. */
  exportStep(id: number, bodyIds?: string[]): Observable<string> {
    const q = bodyIds && bodyIds.length ? `?bodyIds=${encodeURIComponent(bodyIds.join(','))}` : '';
    return this.http.get(`${this.apiUrl}/${id}/export/step${q}`, { responseType: 'text' });
  }
}
