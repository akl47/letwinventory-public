import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { EngineeringMaster, EngineeringMasterHistory } from '../models/engineering-master.model';
import { WorkOrder, WorkOrderStepCompletion, WorkOrderKitStatus } from '../models/work-order.model';

@Injectable({ providedIn: 'root' })
export class ManufacturingService {
  private http = inject(HttpClient);
  private masterUrl = `${environment.apiUrl}/manufacturing/master`;
  private stepUrl = `${environment.apiUrl}/manufacturing/master-step`;
  private woUrl = `${environment.apiUrl}/manufacturing/work-order`;

  // Engineering Masters
  getMasters(): Observable<EngineeringMaster[]> {
    return this.http.get<EngineeringMaster[]>(this.masterUrl);
  }

  getMaster(id: number): Observable<EngineeringMaster> {
    return this.http.get<EngineeringMaster>(`${this.masterUrl}/${id}`);
  }

  createMaster(data: any): Observable<EngineeringMaster> {
    return this.http.post<EngineeringMaster>(this.masterUrl, data);
  }

  updateMaster(id: number, data: any): Observable<EngineeringMaster> {
    return this.http.put<EngineeringMaster>(`${this.masterUrl}/${id}`, data);
  }

  deleteMaster(id: number): Observable<any> {
    return this.http.delete(`${this.masterUrl}/${id}`);
  }

  submitForReview(id: number): Observable<EngineeringMaster> {
    return this.http.post<EngineeringMaster>(`${this.masterUrl}/${id}/submit-review`, {});
  }

  reject(id: number): Observable<EngineeringMaster> {
    return this.http.post<EngineeringMaster>(`${this.masterUrl}/${id}/reject`, {});
  }

  release(id: number): Observable<EngineeringMaster> {
    return this.http.post<EngineeringMaster>(`${this.masterUrl}/${id}/release`, {});
  }

  newRevision(id: number): Observable<EngineeringMaster> {
    return this.http.post<EngineeringMaster>(`${this.masterUrl}/${id}/new-revision`, {});
  }

  getHistory(id: number): Observable<EngineeringMasterHistory[]> {
    return this.http.get<EngineeringMasterHistory[]>(`${this.masterUrl}/${id}/history`);
  }

  getRevisions(id: number): Observable<EngineeringMaster[]> {
    return this.http.get<EngineeringMaster[]>(`${this.masterUrl}/${id}/revisions`);
  }

  updateBom(id: number, items: { partID: number; quantity: number; isTool: boolean }[]): Observable<EngineeringMaster> {
    return this.http.put<EngineeringMaster>(`${this.masterUrl}/${id}/bom`, { items });
  }

  // Steps
  createStep(data: any): Observable<any> {
    return this.http.post(this.stepUrl, data);
  }

  updateStep(id: number, data: any): Observable<any> {
    return this.http.put(`${this.stepUrl}/${id}`, data);
  }

  deleteStep(id: number): Observable<any> {
    return this.http.delete(`${this.stepUrl}/${id}`);
  }

  reorderStep(id: number, stepNumber: number): Observable<any> {
    return this.http.put(`${this.stepUrl}/${id}/reorder`, { stepNumber });
  }

  uploadStepImage(masterId: number, stepId: number, data: { filename: string; mimeType: string; data: string }): Observable<any> {
    return this.http.post(`${this.stepUrl}/${masterId}/upload-image/${stepId}`, data);
  }

  deleteStepImage(stepId: number): Observable<any> {
    return this.http.delete(`${this.stepUrl}/${stepId}/image`);
  }

  // Work Orders
  getWorkOrders(status?: string): Observable<WorkOrder[]> {
    const url = status ? `${this.woUrl}?status=${status}` : this.woUrl;
    return this.http.get<WorkOrder[]>(url);
  }

  getWorkOrder(id: number): Observable<WorkOrder> {
    return this.http.get<WorkOrder>(`${this.woUrl}/${id}`);
  }

  createWorkOrder(data: any): Observable<WorkOrder> {
    return this.http.post<WorkOrder>(this.woUrl, data);
  }

  getWorkOrderKitStatus(id: number): Observable<WorkOrderKitStatus> {
    return this.http.get<WorkOrderKitStatus>(`${this.woUrl}/${id}/kit-status`);
  }

  deleteWorkOrder(id: number): Observable<any> {
    return this.http.delete(`${this.woUrl}/${id}`);
  }

  completeStep(workOrderId: number, stepID: number): Observable<WorkOrderStepCompletion> {
    return this.http.post<WorkOrderStepCompletion>(`${this.woUrl}/${workOrderId}/complete-step`, { stepID });
  }

  uncompleteStep(workOrderId: number, stepID: number): Observable<any> {
    return this.http.post(`${this.woUrl}/${workOrderId}/uncomplete-step`, { stepID });
  }

  completeWorkOrder(id: number): Observable<WorkOrder> {
    return this.http.post<WorkOrder>(`${this.woUrl}/${id}/complete`, {});
  }
}
