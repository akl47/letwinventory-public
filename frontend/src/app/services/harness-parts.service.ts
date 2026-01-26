import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  DbHarnessConnector,
  DbHarnessWire,
  DbHarnessCable
} from '../models/harness.model';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class HarnessPartsService {
  private http = inject(HttpClient);
  private baseUrl = environment.apiUrl;

  // === Connectors ===

  getConnectors(includeInactive = false): Observable<DbHarnessConnector[]> {
    const params = includeInactive ? '?includeInactive=true' : '';
    return this.http.get<DbHarnessConnector[]>(`${this.baseUrl}/parts/connector${params}`);
  }

  getConnectorById(id: number): Observable<DbHarnessConnector> {
    return this.http.get<DbHarnessConnector>(`${this.baseUrl}/parts/connector/${id}`);
  }

  getConnectorByPartId(partId: number): Observable<DbHarnessConnector | null> {
    return this.http.get<DbHarnessConnector | null>(`${this.baseUrl}/parts/connector/by-part/${partId}`);
  }

  createConnector(data: {
    label: string;
    type: 'male' | 'female' | 'terminal' | 'splice';
    pinCount?: number;
    color?: string;
    pins?: { id: string; number: string; label?: string }[];
    partID?: number;
    pinoutDiagramImage?: string | null;
    connectorImage?: string | null;
  }): Observable<DbHarnessConnector> {
    return this.http.post<DbHarnessConnector>(`${this.baseUrl}/parts/connector`, data);
  }

  updateConnector(id: number, data: {
    label?: string;
    type?: 'male' | 'female' | 'terminal' | 'splice';
    pinCount?: number;
    color?: string;
    pins?: { id: string; number: string; label?: string }[];
    partID?: number;
    pinoutDiagramImage?: string | null;
    connectorImage?: string | null;
  }): Observable<DbHarnessConnector> {
    return this.http.put<DbHarnessConnector>(`${this.baseUrl}/parts/connector/${id}`, data);
  }

  deleteConnector(id: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.baseUrl}/parts/connector/${id}`);
  }

  // === Wires ===

  getWires(includeInactive = false): Observable<DbHarnessWire[]> {
    const params = includeInactive ? '?includeInactive=true' : '';
    return this.http.get<DbHarnessWire[]>(`${this.baseUrl}/parts/wire${params}`);
  }

  getWireById(id: number): Observable<DbHarnessWire> {
    return this.http.get<DbHarnessWire>(`${this.baseUrl}/parts/wire/${id}`);
  }

  getWireByPartId(partId: number): Observable<DbHarnessWire | null> {
    return this.http.get<DbHarnessWire | null>(`${this.baseUrl}/parts/wire/by-part/${partId}`);
  }

  createWire(data: {
    label: string;
    color: string;
    colorCode?: string;
    gaugeAWG?: string;
    partID?: number;
  }): Observable<DbHarnessWire> {
    return this.http.post<DbHarnessWire>(`${this.baseUrl}/parts/wire`, data);
  }

  updateWire(id: number, data: {
    label?: string;
    color?: string;
    colorCode?: string;
    gaugeAWG?: string;
    partID?: number;
  }): Observable<DbHarnessWire> {
    return this.http.put<DbHarnessWire>(`${this.baseUrl}/parts/wire/${id}`, data);
  }

  deleteWire(id: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.baseUrl}/parts/wire/${id}`);
  }

  // === Cables ===

  getCables(includeInactive = false): Observable<DbHarnessCable[]> {
    const params = includeInactive ? '?includeInactive=true' : '';
    return this.http.get<DbHarnessCable[]>(`${this.baseUrl}/parts/cable${params}`);
  }

  getCableById(id: number): Observable<DbHarnessCable> {
    return this.http.get<DbHarnessCable>(`${this.baseUrl}/parts/cable/${id}`);
  }

  getCableByPartId(partId: number): Observable<DbHarnessCable | null> {
    return this.http.get<DbHarnessCable | null>(`${this.baseUrl}/parts/cable/by-part/${partId}`);
  }

  createCable(data: {
    label: string;
    wireCount?: number;
    gaugeAWG?: string;
    wires?: { id: string; color: string; colorCode?: string }[];
    partID?: number;
    cableDiagramImage?: string | null;
  }): Observable<DbHarnessCable> {
    return this.http.post<DbHarnessCable>(`${this.baseUrl}/parts/cable`, data);
  }

  updateCable(id: number, data: {
    label?: string;
    wireCount?: number;
    gaugeAWG?: string;
    wires?: { id: string; color: string; colorCode?: string }[];
    partID?: number;
    cableDiagramImage?: string | null;
  }): Observable<DbHarnessCable> {
    return this.http.put<DbHarnessCable>(`${this.baseUrl}/parts/cable/${id}`, data);
  }

  deleteCable(id: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.baseUrl}/parts/cable/${id}`);
  }
}
