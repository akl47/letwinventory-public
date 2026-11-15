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
import { CadBranch, CadCommit, CadCommitDiff, CadModel, CadVersionGraph, CadWorkflow } from '../models/cad-model.model';
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

  // The harness to open for a part (the latest one when a part has several)
  getActiveByPart(partID: number): Observable<WireHarness> {
    return this.http.get<WireHarness>(`${this.apiUrl}/by-part/${partID}/active`);
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
    description?: string;
    harnessData?: HarnessData;
    thumbnailBase64?: string;
    /** The lastContentSavedAt this client last synced — a stale token is refused (409). */
    clientSavedAt?: string | null;
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

  // === Version control (REQ 1062–1066) ===
  // Same verbs and shapes as CadModelService, so the CAD editor's File tab
  // drives a harness through this service unchanged. Rows come back typed as
  // CadModel: they carry the same working-copy fields.

  getById(id: number): Observable<CadModel> {
    return this.http.get<CadModel>(`${this.apiUrl}/${id}`);
  }

  checkout(id: number, opts?: { takeover?: boolean }): Observable<CadModel & { stashedTo?: string }> {
    return this.http.post<CadModel & { stashedTo?: string }>(`${this.apiUrl}/${id}/checkout`, opts ?? {});
  }

  renewLock(id: number): Observable<{ lockExpiresAt: string }> {
    return this.http.post<{ lockExpiresAt: string }>(`${this.apiUrl}/${id}/renew-lock`, {});
  }

  checkin(id: number, message: string, _thumbnail?: string | null, keepCheckedOut = false): Observable<{ commitHash: string; model: CadModel }> {
    return this.http.post<{ commitHash: string; model: CadModel }>(`${this.apiUrl}/${id}/checkin`, { message, keepCheckedOut });
  }

  undoCheckout(id: number): Observable<CadModel> {
    return this.http.post<CadModel>(`${this.apiUrl}/${id}/undo-checkout`, {});
  }

  getCommits(id: number): Observable<CadCommit[]> {
    return this.http.get<CadCommit[]>(`${this.apiUrl}/${id}/commits`);
  }

  getGraph(id: number): Observable<CadVersionGraph> {
    return this.http.get<CadVersionGraph>(`${this.apiUrl}/${id}/graph`);
  }

  commitDiff(id: number, a: string, b: string): Observable<CadCommitDiff> {
    return this.http.get<CadCommitDiff>(`${this.apiUrl}/${id}/commits/${a}/diff/${b}`);
  }

  workingDiff(id: number): Observable<{ baseCommitHash: string | null; entries: CadCommitDiff['entries'] }> {
    return this.http.get<{ baseCommitHash: string | null; entries: CadCommitDiff['entries'] }>(`${this.apiUrl}/${id}/working-diff`);
  }

  listBranches(id: number): Observable<CadBranch[]> {
    return this.http.get<CadBranch[]>(`${this.apiUrl}/${id}/branches`);
  }

  createBranch(id: number, name: string, fromCommit?: string): Observable<CadBranch> {
    return this.http.post<CadBranch>(`${this.apiUrl}/${id}/branches`, { name, fromCommit });
  }

  switchBranch(id: number, name: string): Observable<CadModel> {
    return this.http.post<CadModel>(`${this.apiUrl}/${id}/switch-branch`, { name });
  }

  archiveBranch(id: number, name: string): Observable<{ archived: string }> {
    return this.http.delete<{ archived: string }>(`${this.apiUrl}/${id}/branches/${encodeURIComponent(name)}`);
  }

  getWorkflow(id: number): Observable<CadWorkflow> {
    return this.http.get<CadWorkflow>(`${this.apiUrl}/${id}/workflow`);
  }

  transitionWorkflow(id: number, action: string): Observable<CadWorkflow> {
    return this.http.post<CadWorkflow>(`${this.apiUrl}/${id}/workflow`, { action });
  }

  // Release the checked-in draft branch onto main as the next numeric revision
  release(id: number): Observable<{ commitHash: string; revision: string; model: CadModel }> {
    return this.http.post<{ commitHash: string; revision: string; model: CadModel }>(`${this.apiUrl}/${id}/release`, {});
  }

  // Promote the released revision to a production (letter) revision
  productionRelease(id: number): Observable<{ revision: string; model: CadModel }> {
    return this.http.post<{ revision: string; model: CadModel }>(`${this.apiUrl}/${id}/production-release`, {});
  }

  // Get revision history
  getHistory(id: number): Observable<HarnessHistoryEntry[]> {
    return this.http.get<HarnessHistoryEntry[]>(`${this.apiUrl}/${id}/history`);
  }

  // Get all revisions of a harness
  getAllRevisions(id: number): Observable<WireHarness[]> {
    return this.http.get<WireHarness[]>(`${this.apiUrl}/${id}/revisions`);
  }
}
