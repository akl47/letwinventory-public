import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  DbElectricalConnector,
  DbWire,
  DbCable,
  DbElectricalComponent,
  ElectricalPinType,
  ComponentPinGroup
} from '../models/harness.model';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class HarnessPartsService {
  private http = inject(HttpClient);
  private baseUrl = environment.apiUrl;

  // === Pin Types ===

  getPinTypes(): Observable<ElectricalPinType[]> {
    return this.http.get<ElectricalPinType[]>(`${this.baseUrl}/parts/connector/pin-types`);
  }

  // === Connectors ===

  getConnectors(includeInactive = false): Observable<DbElectricalConnector[]> {
    const params = includeInactive ? '?includeInactive=true' : '';
    return this.http.get<DbElectricalConnector[]>(`${this.baseUrl}/parts/connector${params}`);
  }

  getConnectorById(id: number): Observable<DbElectricalConnector> {
    return this.http.get<DbElectricalConnector>(`${this.baseUrl}/parts/connector/${id}`);
  }

  getConnectorByPartId(partId: number): Observable<DbElectricalConnector | null> {
    return this.http.get<DbElectricalConnector | null>(`${this.baseUrl}/parts/connector/by-part/${partId}`);
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
    electricalPinTypeID?: number | null;
  }): Observable<DbElectricalConnector> {
    return this.http.post<DbElectricalConnector>(`${this.baseUrl}/parts/connector`, data);
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
    electricalPinTypeID?: number | null;
  }): Observable<DbElectricalConnector> {
    return this.http.put<DbElectricalConnector>(`${this.baseUrl}/parts/connector/${id}`, data);
  }

  deleteConnector(id: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.baseUrl}/parts/connector/${id}`);
  }

  // === Wires ===

  getWires(includeInactive = false): Observable<DbWire[]> {
    const params = includeInactive ? '?includeInactive=true' : '';
    return this.http.get<DbWire[]>(`${this.baseUrl}/parts/wire${params}`);
  }

  getWireById(id: number): Observable<DbWire> {
    return this.http.get<DbWire>(`${this.baseUrl}/parts/wire/${id}`);
  }

  getWireByPartId(partId: number): Observable<DbWire | null> {
    return this.http.get<DbWire | null>(`${this.baseUrl}/parts/wire/by-part/${partId}`);
  }

  createWire(data: {
    label: string;
    color: string;
    colorCode?: string;
    gaugeAWG?: string;
    partID?: number;
  }): Observable<DbWire> {
    return this.http.post<DbWire>(`${this.baseUrl}/parts/wire`, data);
  }

  updateWire(id: number, data: {
    label?: string;
    color?: string;
    colorCode?: string;
    gaugeAWG?: string;
    partID?: number;
  }): Observable<DbWire> {
    return this.http.put<DbWire>(`${this.baseUrl}/parts/wire/${id}`, data);
  }

  deleteWire(id: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.baseUrl}/parts/wire/${id}`);
  }

  // === Cables ===

  getCables(includeInactive = false): Observable<DbCable[]> {
    const params = includeInactive ? '?includeInactive=true' : '';
    return this.http.get<DbCable[]>(`${this.baseUrl}/parts/cable${params}`);
  }

  getCableById(id: number): Observable<DbCable> {
    return this.http.get<DbCable>(`${this.baseUrl}/parts/cable/${id}`);
  }

  getCableByPartId(partId: number): Observable<DbCable | null> {
    return this.http.get<DbCable | null>(`${this.baseUrl}/parts/cable/by-part/${partId}`);
  }

  createCable(data: {
    label: string;
    wireCount?: number;
    gaugeAWG?: string;
    wires?: { id: string; color: string; colorCode?: string }[];
    partID?: number;
    cableDiagramImage?: string | null;
  }): Observable<DbCable> {
    return this.http.post<DbCable>(`${this.baseUrl}/parts/cable`, data);
  }

  updateCable(id: number, data: {
    label?: string;
    wireCount?: number;
    gaugeAWG?: string;
    wires?: { id: string; color: string; colorCode?: string }[];
    partID?: number;
    cableDiagramImage?: string | null;
  }): Observable<DbCable> {
    return this.http.put<DbCable>(`${this.baseUrl}/parts/cable/${id}`, data);
  }

  deleteCable(id: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.baseUrl}/parts/cable/${id}`);
  }

  // === Components ===

  getComponents(includeInactive = false): Observable<DbElectricalComponent[]> {
    const params = includeInactive ? '?includeInactive=true' : '';
    return this.http.get<DbElectricalComponent[]>(`${this.baseUrl}/parts/component${params}`);
  }

  getComponentById(id: number): Observable<DbElectricalComponent> {
    return this.http.get<DbElectricalComponent>(`${this.baseUrl}/parts/component/${id}`);
  }

  getComponentByPartId(partId: number): Observable<DbElectricalComponent | null> {
    return this.http.get<DbElectricalComponent | null>(`${this.baseUrl}/parts/component/by-part/${partId}`);
  }

  createComponent(data: {
    label: string;
    pinCount?: number;
    pins?: ComponentPinGroup[];
    partID?: number;
    pinoutDiagramImage?: string | null;
    componentImage?: string | null;
  }): Observable<DbElectricalComponent> {
    return this.http.post<DbElectricalComponent>(`${this.baseUrl}/parts/component`, data);
  }

  updateComponent(id: number, data: {
    label?: string;
    pinCount?: number;
    pins?: ComponentPinGroup[];
    partID?: number;
    pinoutDiagramImage?: string | null;
    componentImage?: string | null;
  }): Observable<DbElectricalComponent> {
    return this.http.put<DbElectricalComponent>(`${this.baseUrl}/parts/component/${id}`, data);
  }

  deleteComponent(id: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.baseUrl}/parts/component/${id}`);
  }
}
