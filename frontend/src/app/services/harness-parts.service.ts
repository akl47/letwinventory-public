import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import {
  DbElectricalConnector,
  DbWire,
  DbCable,
  DbElectricalComponent,
  ElectricalPinType,
  WireEnd,
  ComponentPinGroup,
  UploadedFileRef
} from '../models/harness.model';
import { environment } from '../../environments/environment';

// Response type for file upload
export interface UploadedFileResponse {
  id: number;
  filename: string;
  mimeType: string;
  fileSize: number;
  createdAt: string;
}

@Injectable({
  providedIn: 'root'
})
export class HarnessPartsService {
  private http = inject(HttpClient);
  private baseUrl = environment.apiUrl;

  // === File Upload ===

  uploadFile(file: File): Observable<UploadedFileResponse> {
    return new Observable(observer => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1]; // Remove data URI prefix
        this.http.post<UploadedFileResponse>(`${this.baseUrl}/files`, {
          filename: file.name,
          mimeType: file.type,
          data: base64
        }).subscribe({
          next: (response) => observer.next(response),
          error: (err) => observer.error(err),
          complete: () => observer.complete()
        });
      };
      reader.onerror = (error) => observer.error(error);
      reader.readAsDataURL(file);
    });
  }

  deleteFile(fileId: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.baseUrl}/files/${fileId}`);
  }

  // Helper to extract image data from file reference
  private extractImageData(fileRef: UploadedFileRef | null | undefined): string | null {
    if (!fileRef?.data) return null;
    return fileRef.data;
  }

  // Transform connector to include backward-compatible image fields
  private transformConnector(connector: DbElectricalConnector): DbElectricalConnector {
    return {
      ...connector,
      pinoutDiagramImage: this.extractImageData(connector.pinoutDiagramFile),
      connectorImage: this.extractImageData(connector.connectorImageFile)
    };
  }

  // Transform cable to include backward-compatible image fields
  private transformCable(cable: DbCable): DbCable {
    return {
      ...cable,
      cableDiagramImage: this.extractImageData(cable.cableDiagramFile)
    };
  }

  // Transform component to include backward-compatible image fields
  private transformComponent(component: DbElectricalComponent): DbElectricalComponent {
    return {
      ...component,
      pinoutDiagramImage: this.extractImageData(component.pinoutDiagramFile),
      componentImage: this.extractImageData(component.componentImageFile)
    };
  }

  // === Pin Types ===

  getPinTypes(): Observable<ElectricalPinType[]> {
    return this.http.get<ElectricalPinType[]>(`${this.baseUrl}/parts/connector/pin-types`);
  }

  // === Wire Ends (Termination Types) ===

  getWireEnds(includeInactive = false): Observable<WireEnd[]> {
    const params = includeInactive ? '?includeInactive=true' : '';
    return this.http.get<WireEnd[]>(`${this.baseUrl}/parts/wire-end${params}`);
  }

  getWireEndByCode(code: string): Observable<WireEnd | null> {
    return this.http.get<WireEnd | null>(`${this.baseUrl}/parts/wire-end/by-code/${code}`);
  }

  createWireEnd(data: { code: string; name: string; description?: string }): Observable<WireEnd> {
    return this.http.post<WireEnd>(`${this.baseUrl}/parts/wire-end`, data);
  }

  updateWireEnd(id: number, data: { code?: string; name?: string; description?: string }): Observable<WireEnd> {
    return this.http.put<WireEnd>(`${this.baseUrl}/parts/wire-end/${id}`, data);
  }

  deleteWireEnd(id: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.baseUrl}/parts/wire-end/${id}`);
  }

  // === Connectors ===

  getConnectors(includeInactive = false): Observable<DbElectricalConnector[]> {
    const params = includeInactive ? '?includeInactive=true' : '';
    return this.http.get<DbElectricalConnector[]>(`${this.baseUrl}/parts/connector${params}`).pipe(
      map(connectors => connectors.map(c => this.transformConnector(c)))
    );
  }

  getConnectorById(id: number): Observable<DbElectricalConnector> {
    return this.http.get<DbElectricalConnector>(`${this.baseUrl}/parts/connector/${id}`).pipe(
      map(c => this.transformConnector(c))
    );
  }

  getConnectorByPartId(partId: number): Observable<DbElectricalConnector | null> {
    return this.http.get<DbElectricalConnector | null>(`${this.baseUrl}/parts/connector/by-part/${partId}`).pipe(
      map(c => c ? this.transformConnector(c) : null)
    );
  }

  createConnector(data: {
    label: string;
    type: 'male' | 'female' | 'terminal' | 'splice';
    pinCount?: number;
    color?: string;
    pins?: { id: string; number: string; label?: string }[];
    partID?: number;
    pinoutDiagramFileID?: number | null;
    connectorImageFileID?: number | null;
    electricalPinTypeID?: number | null;
  }): Observable<DbElectricalConnector> {
    return this.http.post<DbElectricalConnector>(`${this.baseUrl}/parts/connector`, data).pipe(
      map(c => this.transformConnector(c))
    );
  }

  updateConnector(id: number, data: {
    label?: string;
    type?: 'male' | 'female' | 'terminal' | 'splice';
    pinCount?: number;
    color?: string;
    pins?: { id: string; number: string; label?: string }[];
    partID?: number;
    pinoutDiagramFileID?: number | null;
    connectorImageFileID?: number | null;
    electricalPinTypeID?: number | null;
  }): Observable<DbElectricalConnector> {
    return this.http.put<DbElectricalConnector>(`${this.baseUrl}/parts/connector/${id}`, data).pipe(
      map(c => this.transformConnector(c))
    );
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
    return this.http.get<DbCable[]>(`${this.baseUrl}/parts/cable${params}`).pipe(
      map(cables => cables.map(c => this.transformCable(c)))
    );
  }

  getCableById(id: number): Observable<DbCable> {
    return this.http.get<DbCable>(`${this.baseUrl}/parts/cable/${id}`).pipe(
      map(c => this.transformCable(c))
    );
  }

  getCableByPartId(partId: number): Observable<DbCable | null> {
    return this.http.get<DbCable | null>(`${this.baseUrl}/parts/cable/by-part/${partId}`).pipe(
      map(c => c ? this.transformCable(c) : null)
    );
  }

  createCable(data: {
    label: string;
    wireCount?: number;
    gaugeAWG?: string;
    wires?: { id: string; color: string; colorCode?: string }[];
    partID?: number;
    cableDiagramFileID?: number | null;
  }): Observable<DbCable> {
    return this.http.post<DbCable>(`${this.baseUrl}/parts/cable`, data).pipe(
      map(c => this.transformCable(c))
    );
  }

  updateCable(id: number, data: {
    label?: string;
    wireCount?: number;
    gaugeAWG?: string;
    wires?: { id: string; color: string; colorCode?: string }[];
    partID?: number;
    cableDiagramFileID?: number | null;
  }): Observable<DbCable> {
    return this.http.put<DbCable>(`${this.baseUrl}/parts/cable/${id}`, data).pipe(
      map(c => this.transformCable(c))
    );
  }

  deleteCable(id: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.baseUrl}/parts/cable/${id}`);
  }

  // === Components ===

  getComponents(includeInactive = false): Observable<DbElectricalComponent[]> {
    const params = includeInactive ? '?includeInactive=true' : '';
    return this.http.get<DbElectricalComponent[]>(`${this.baseUrl}/parts/component${params}`).pipe(
      map(components => components.map(c => this.transformComponent(c)))
    );
  }

  getComponentById(id: number): Observable<DbElectricalComponent> {
    return this.http.get<DbElectricalComponent>(`${this.baseUrl}/parts/component/${id}`).pipe(
      map(c => this.transformComponent(c))
    );
  }

  getComponentByPartId(partId: number): Observable<DbElectricalComponent | null> {
    return this.http.get<DbElectricalComponent | null>(`${this.baseUrl}/parts/component/by-part/${partId}`).pipe(
      map(c => c ? this.transformComponent(c) : null)
    );
  }

  createComponent(data: {
    label: string;
    pinCount?: number;
    pins?: ComponentPinGroup[];
    partID?: number;
    pinoutDiagramFileID?: number | null;
    componentImageFileID?: number | null;
  }): Observable<DbElectricalComponent> {
    return this.http.post<DbElectricalComponent>(`${this.baseUrl}/parts/component`, data).pipe(
      map(c => this.transformComponent(c))
    );
  }

  updateComponent(id: number, data: {
    label?: string;
    pinCount?: number;
    pins?: ComponentPinGroup[];
    partID?: number;
    pinoutDiagramFileID?: number | null;
    componentImageFileID?: number | null;
  }): Observable<DbElectricalComponent> {
    return this.http.put<DbElectricalComponent>(`${this.baseUrl}/parts/component/${id}`, data).pipe(
      map(c => this.transformComponent(c))
    );
  }

  deleteComponent(id: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.baseUrl}/parts/component/${id}`);
  }
}
