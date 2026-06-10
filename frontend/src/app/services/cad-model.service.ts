import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { CadModel, CadBranch, CadCommit, CadCommitDiff, CadBodyDiff, CadFaceDiff, CadWorkflow, CadVersionGraph, CadCommitGeometry, CadDefaultView, CadModelHistoryEntry, PartWithCadSummary } from '../models/cad-model.model';
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

  /** Development release (self-service): freeze + tag the numeric revision + lock. */
  devRelease(id: number): Observable<{ commitHash: string; revision: string; model: CadModel }> {
    return this.http.post<{ commitHash: string; revision: string; model: CadModel }>(`${this.apiUrl}/${id}/dev-release`, {});
  }

  /** Create the next numeric revision + a fresh editable model copy. Returns it. */
  newRevision(id: number): Observable<CadModel> {
    return this.http.post<CadModel>(`${this.apiUrl}/${id}/new-revision`, {});
  }

  /** Promote a dev-released, approved design to a production (letter) revision. */
  productionRelease(id: number): Observable<{ revision: string; prodModelID: number; model: CadModel }> {
    return this.http.post<{ revision: string; prodModelID: number; model: CadModel }>(`${this.apiUrl}/${id}/production-release`, {});
  }

  /** Download a released revision's frozen STEP (text). */
  exportReleaseStep(id: number): Observable<string> {
    return this.http.get(`${this.apiUrl}/${id}/release/step`, { responseType: 'text' });
  }

  /** Download a released revision's frozen STL (binary blob). */
  exportReleaseStl(id: number): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/${id}/release/stl`, { responseType: 'blob' });
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
  regenerate(id: number, rollbackBeforeIndex: number | null = null, regenId?: string): Observable<RegenerateResponse> {
    const body: { rollbackBeforeIndex?: number; regenId?: string } = {};
    if (rollbackBeforeIndex !== null) body.rollbackBeforeIndex = rollbackBeforeIndex;
    if (regenId) body.regenId = regenId;
    return this.http.post<RegenerateResponse>(`${this.apiUrl}/${id}/regenerate`, body);
  }

  // ── VCS: checkout / check-in / lock / commit log (Phase 1) ──────────────────

  /** Acquire the exclusive edit lock; returns the updated model. */
  checkout(id: number): Observable<CadModel> {
    return this.http.post<CadModel>(`${this.apiUrl}/${id}/checkout`, {});
  }

  /** Commit the working copy with a message; returns the new commit hash. An
   * optional low-res PNG data URL (captured from the default view) is stored
   * with the commit for the version-history preview. */
  checkin(id: number, message: string, thumbnail?: string | null): Observable<{ commitHash: string; model: CadModel }> {
    return this.http.post<{ commitHash: string; model: CadModel }>(`${this.apiUrl}/${id}/checkin`, { message, thumbnail: thumbnail || undefined });
  }

  /** Persist the model's default camera view (not lock-gated). */
  setDefaultView(id: number, view: CadDefaultView): Observable<CadModel> {
    return this.http.post<CadModel>(`${this.apiUrl}/${id}/default-view`, view);
  }

  /** The stored low-res commit thumbnail as a Blob (via the auth interceptor),
   * for use as an `<img>` poster. 404s when no thumbnail was captured. */
  getCommitThumbnail(id: number, hash: string): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/${id}/commits/${hash}/thumbnail`, { responseType: 'blob' });
  }

  /** Undo checkout: discard uncommitted changes, roll back to the last
   * check-in, and release the lock. */
  undoCheckout(id: number): Observable<CadModel> {
    return this.http.post<CadModel>(`${this.apiUrl}/${id}/undo-checkout`, {});
  }

  /** Admin override: force-release whoever holds the lock (needs cad.approve). */
  forceUnlock(id: number): Observable<CadModel> {
    return this.http.post<CadModel>(`${this.apiUrl}/${id}/force-unlock`, {});
  }

  /** Commit history for the model's branch, newest first. */
  getCommits(id: number): Observable<CadCommit[]> {
    return this.http.get<CadCommit[]>(`${this.apiUrl}/${id}/commits`);
  }

  /** Full version graph (all branches) for the part's CAD history view. */
  getGraph(id: number): Observable<CadVersionGraph> {
    return this.http.get<CadVersionGraph>(`${this.apiUrl}/${id}/graph`);
  }

  /** A single commit's face meshes for the lightweight 3D preview. */
  getCommitGeometry(id: number, hash: string): Observable<CadCommitGeometry> {
    return this.http.get<CadCommitGeometry>(`${this.apiUrl}/${id}/commits/${hash}/geometry`);
  }

  /** Real CAD-kernel health probe (pings the Rust/OCCT kernel). Drives the
   * editor's accurate "kernel offline" state — independent of the best-effort
   * WebSocket progress stream. Always resolves 200; `online` carries the truth. */
  getKernelStatus(): Observable<{ online: boolean; namingVersion?: number }> {
    return this.http.get<{ online: boolean; namingVersion?: number }>(`${this.apiUrl}/kernel/status`);
  }

  /** A historical commit's CAD document (featureTree/sketchDoc/equations),
   * reconstructed from the object store. Powers the editor's read-only
   * "Open version" view (REQ 743) without touching the working copy. */
  getCommitDoc(id: number, hash: string): Observable<{ featureTree: unknown; sketchDoc: unknown; equations: unknown; hash: string; message: string | null }> {
    return this.http.get<{ featureTree: unknown; sketchDoc: unknown; equations: unknown; hash: string; message: string | null }>(`${this.apiUrl}/${id}/commits/${hash}/doc`);
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

  /** Rebase a behind-main draft branch onto main's head (bumps its draft rev). */
  rebase(id: number): Observable<CadModel> {
    return this.http.post<CadModel>(`${this.apiUrl}/${id}/rebase`, {});
  }

  /** Merge main into the current branch, applying the selected branch changes —
   * features + sketches for part CAD, or instances + mates for assemblies. */
  reconcile(
    id: number,
    sel: string[] | { featureIds?: string[]; sketchIds?: string[]; instanceIds?: string[]; mateIds?: string[] },
    sketchIds: string[] = [],
  ): Observable<CadModel> {
    const body = Array.isArray(sel) ? { featureIds: sel, sketchIds } : sel;
    return this.http.post<CadModel>(`${this.apiUrl}/${id}/reconcile`, body);
  }

  /** The branch's changes vs main (assembly merge picker): instance/mate ids. */
  reconcileChanges(id: number): Observable<{ changes: Array<{ kind: string; id: string }> }> {
    return this.http.get<{ changes: Array<{ kind: string; id: string }> }>(`${this.apiUrl}/${id}/reconcile/preview`);
  }

  /** Geometry of the hypothetical merge result (main + selected branch features +
   * sketches), regenerated without committing — for the merge tool's 3D preview. */
  reconcilePreview(id: number, branch: string, featureIds: string[], sketchIds: string[] = []): Observable<CadCommitGeometry> {
    return this.http.post<CadCommitGeometry>(`${this.apiUrl}/${id}/reconcile/preview`, { branch, featureIds, sketchIds });
  }

  // ── VCS: diff (Phase 3) ─────────────────────────────────────────────────────

  /** Structural diff between two commits. */
  commitDiff(id: number, a: string, b: string): Observable<CadCommitDiff> {
    return this.http.get<CadCommitDiff>(`${this.apiUrl}/${id}/commits/${a}/diff/${b}`);
  }

  /** Uncommitted changes: the working copy diffed against its base commit. */
  workingDiff(id: number): Observable<{ baseCommitHash: string | null; entries: CadCommitDiff['entries'] }> {
    return this.http.get<{ baseCommitHash: string | null; entries: CadCommitDiff['entries'] }>(`${this.apiUrl}/${id}/working-diff`);
  }

  /** Body-level 3D diff between two commits (regenerates each). */
  bodyDiff3D(id: number, a: string, b: string): Observable<CadBodyDiff> {
    return this.http.post<CadBodyDiff>(`${this.apiUrl}/${id}/commits/${a}/diff/${b}/regen`, {});
  }

  /** Face-level diff (persistent face-name sets) for colouring the Compare previews. */
  faceDiff(id: number, a: string, b: string): Observable<CadFaceDiff> {
    return this.http.get<CadFaceDiff>(`${this.apiUrl}/${id}/commits/${a}/diff/${b}/faces`);
  }

  // ── VCS: review workflow (Phase 4) ──────────────────────────────────────────

  getWorkflow(id: number): Observable<CadWorkflow> {
    return this.http.get<CadWorkflow>(`${this.apiUrl}/${id}/workflow`);
  }

  /** Perform a workflow transition (submit/approve/reject/reopen). */
  transitionWorkflow(id: number, action: string): Observable<CadWorkflow> {
    return this.http.post<CadWorkflow>(`${this.apiUrl}/${id}/workflow`, { action });
  }

  /** Download the model's bodies as a STEP file (returns the file text). The
   * auth interceptor adds the token header, so this can't be a plain link.
   * `bodyIds` optionally restricts to a subset of bodies. */
  exportStep(id: number, bodyIds?: string[]): Observable<string> {
    const q = bodyIds && bodyIds.length ? `?bodyIds=${encodeURIComponent(bodyIds.join(','))}` : '';
    return this.http.get(`${this.apiUrl}/${id}/export/step${q}`, { responseType: 'text' });
  }
}
