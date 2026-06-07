import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  Assembly, AssemblyListItem, AssemblyInstance, AssemblyRegenResponse, BomLine, Placement, Mate, MateType, MateRef, EligiblePart,
  AssemblyPattern, PatternKind, ExplodeConfig, DisplayState, MassProperties, InterferencePair,
} from '../cad/lib/assembly.types';
import { CadBranch, CadCommit, CadWorkflow, CadVersionGraph } from '../models/cad-model.model';

@Injectable({ providedIn: 'root' })
export class AssemblyService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/design/assembly`;

  list(): Observable<AssemblyListItem[]> {
    return this.http.get<AssemblyListItem[]>(`${this.apiUrl}/parts-with-assembly`);
  }

  /** Parts in the "Assembly" category — candidates for an assembly CAD model. */
  eligibleParts(): Observable<EligiblePart[]> {
    return this.http.get<EligiblePart[]>(`${this.apiUrl}/eligible-parts`);
  }

  getActiveByPart(partID: number): Observable<Assembly> {
    return this.http.get<Assembly>(`${this.apiUrl}/by-part/${partID}/active`);
  }

  createForPart(partID: number, body: { name?: string } = {}): Observable<Assembly> {
    return this.http.post<Assembly>(`${this.apiUrl}/by-part/${partID}`, body);
  }

  getById(id: number): Observable<Assembly> {
    return this.http.get<Assembly>(`${this.apiUrl}/${id}`);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }

  insertInstance(id: number, body: { partID: number; placement?: Placement; grounded?: boolean }):
    Observable<{ instance: AssemblyInstance; assembly: Assembly }> {
    return this.http.post<{ instance: AssemblyInstance; assembly: Assembly }>(`${this.apiUrl}/${id}/instances`, body);
  }

  updateInstance(id: number, instanceId: string, patch: Partial<Pick<AssemblyInstance, 'placement' | 'grounded' | 'suppressed' | 'visible'>>):
    Observable<{ instance: AssemblyInstance; assembly: Assembly }> {
    return this.http.put<{ instance: AssemblyInstance; assembly: Assembly }>(`${this.apiUrl}/${id}/instances/${instanceId}`, patch);
  }

  removeInstance(id: number, instanceId: string): Observable<Assembly> {
    return this.http.delete<Assembly>(`${this.apiUrl}/${id}/instances/${instanceId}`);
  }

  replaceInstance(id: number, instanceId: string, partID: number): Observable<{ instance: AssemblyInstance; assembly: Assembly }> {
    return this.http.put<{ instance: AssemblyInstance; assembly: Assembly }>(`${this.apiUrl}/${id}/instances/${instanceId}/replace`, { partID });
  }

  addPattern(id: number, body: { kind: PatternKind; seedInstanceId: string } & Partial<AssemblyPattern>):
    Observable<{ pattern: AssemblyPattern; assembly: Assembly }> {
    return this.http.post<{ pattern: AssemblyPattern; assembly: Assembly }>(`${this.apiUrl}/${id}/patterns`, body);
  }

  removePattern(id: number, patternId: string): Observable<Assembly> {
    return this.http.delete<Assembly>(`${this.apiUrl}/${id}/patterns/${patternId}`);
  }

  addMate(id: number, body: { type: MateType; a: MateRef; b: MateRef; value?: number; flip?: boolean }):
    Observable<{ mate: Mate; assembly: Assembly }> {
    return this.http.post<{ mate: Mate; assembly: Assembly }>(`${this.apiUrl}/${id}/mates`, body);
  }

  removeMate(id: number, mateId: string): Observable<Assembly> {
    return this.http.delete<Assembly>(`${this.apiUrl}/${id}/mates/${mateId}`);
  }

  autoExplode(id: number, spread = 1.5): Observable<{ explode: ExplodeConfig; assembly: Assembly }> {
    return this.http.post<{ explode: ExplodeConfig; assembly: Assembly }>(`${this.apiUrl}/${id}/explode/auto`, { spread });
  }

  setExplode(id: number, factor: number): Observable<{ explode: ExplodeConfig; assembly: Assembly }> {
    return this.http.put<{ explode: ExplodeConfig; assembly: Assembly }>(`${this.apiUrl}/${id}/explode`, { factor });
  }

  saveDisplayState(id: number, name: string): Observable<{ state: DisplayState; assembly: Assembly }> {
    return this.http.post<{ state: DisplayState; assembly: Assembly }>(`${this.apiUrl}/${id}/display-states`, { name });
  }

  applyDisplayState(id: number, stateId: string): Observable<Assembly> {
    return this.http.post<Assembly>(`${this.apiUrl}/${id}/display-states/${stateId}/apply`, {});
  }

  deleteDisplayState(id: number, stateId: string): Observable<Assembly> {
    return this.http.delete<Assembly>(`${this.apiUrl}/${id}/display-states/${stateId}`);
  }

  regenerate(id: number): Observable<AssemblyRegenResponse> {
    return this.http.post<AssemblyRegenResponse>(`${this.apiUrl}/${id}/regenerate`, {});
  }

  bom(id: number): Observable<BomLine[]> {
    return this.http.get<BomLine[]>(`${this.apiUrl}/${id}/bom`);
  }

  massProperties(id: number): Observable<MassProperties> {
    return this.http.get<MassProperties>(`${this.apiUrl}/${id}/mass-properties`);
  }

  interference(id: number): Observable<{ pairs: InterferencePair[]; errors: string[] }> {
    return this.http.post<{ pairs: InterferencePair[]; errors: string[] }>(`${this.apiUrl}/${id}/interference`, {});
  }

  syncBom(id: number): Observable<{ count: number; items: Array<{ componentPartID: number; quantity: number }> }> {
    return this.http.post<{ count: number; items: Array<{ componentPartID: number; quantity: number }> }>(`${this.apiUrl}/${id}/bom/sync`, {});
  }

  checkout(id: number): Observable<Assembly> {
    return this.http.post<Assembly>(`${this.apiUrl}/${id}/checkout`, {});
  }

  checkin(id: number, message: string): Observable<{ commitHash: string; model: Assembly }> {
    return this.http.post<{ commitHash: string; model: Assembly }>(`${this.apiUrl}/${id}/checkin`, { message });
  }

  undoCheckout(id: number): Observable<Assembly> {
    return this.http.post<Assembly>(`${this.apiUrl}/${id}/undo-checkout`, {});
  }

  // ── branches / workflow / graph (shared VCS machinery) ──────────────────────
  getCommits(id: number): Observable<CadCommit[]> {
    return this.http.get<CadCommit[]>(`${this.apiUrl}/${id}/commits`);
  }
  listBranches(id: number): Observable<CadBranch[]> {
    return this.http.get<CadBranch[]>(`${this.apiUrl}/${id}/branches`);
  }
  createBranch(id: number, name: string, fromCommit?: string): Observable<CadBranch> {
    return this.http.post<CadBranch>(`${this.apiUrl}/${id}/branches`, { name, fromCommit });
  }
  switchBranch(id: number, name: string): Observable<Assembly> {
    return this.http.post<Assembly>(`${this.apiUrl}/${id}/switch-branch`, { name });
  }
  archiveBranch(id: number, name: string): Observable<{ archived: string }> {
    return this.http.delete<{ archived: string }>(`${this.apiUrl}/${id}/branches/${encodeURIComponent(name)}`);
  }
  getWorkflow(id: number): Observable<CadWorkflow> {
    return this.http.get<CadWorkflow>(`${this.apiUrl}/${id}/workflow`);
  }
  transitionWorkflow(id: number, action: string): Observable<CadWorkflow & { model?: Assembly }> {
    return this.http.post<CadWorkflow & { model?: Assembly }>(`${this.apiUrl}/${id}/workflow`, { action });
  }
  getGraph(id: number): Observable<CadVersionGraph> {
    return this.http.get<CadVersionGraph>(`${this.apiUrl}/${id}/graph`);
  }

  exportStep(id: number): Observable<string> {
    return this.http.get(`${this.apiUrl}/${id}/export/step`, { responseType: 'text' });
  }

  exportStl(id: number): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/${id}/export/stl`, { responseType: 'blob' });
  }
}
