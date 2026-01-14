import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface TaskHistoryActionType {
    id: number;
    code: string;
    label: string;
}

export interface TaskHistory {
    id: number;
    taskID: number;
    userID: number;
    actionID: number;
    fromID: number;
    toID: number;
    createdAt: string;
    task?: {
        id: number;
        name: string;
    };
    user?: {
        id: number;
        displayName: string;
        photoURL?: string;
    };
    actionType?: TaskHistoryActionType;
}

export interface BarcodeHistoryActionType {
    id: number;
    code: string;
    label: string;
}

export interface BarcodeHistoryUnitOfMeasure {
    id: number;
    name: string;
    description: string | null;
}

export interface BarcodeHistory {
    id: number;
    barcodeID: number;
    userID: number | null;
    actionID: number;
    fromID: number | null;
    toID: number | null;
    qty: number | null;
    serialNumber: string | null;
    lotNumber: string | null;
    unitOfMeasureID: number | null;
    createdAt: string;
    barcode?: {
        id: number;
        barcode: string;
        barcodeCategoryID: number;
        parentBarcodeID: number | null;
    };
    user?: {
        id: number;
        displayName: string;
        photoURL?: string;
    };
    actionType?: BarcodeHistoryActionType;
    unitOfMeasure?: BarcodeHistoryUnitOfMeasure;
    orderInfo?: {
        orderID: number;
        lineNumber: number;
    };
}

@Injectable({
    providedIn: 'root'
})
export class HistoryService {
    private apiUrl = `${environment.apiUrl}/planning/taskhistory`;
    private http = inject(HttpClient);

    getAllHistory(offset: number = 0, limit: number = 10): Observable<TaskHistory[]> {
        return this.http.get<TaskHistory[]>(`${this.apiUrl}?offset=${offset}&limit=${limit}`);
    }

    getTaskHistory(taskId: number): Observable<TaskHistory[]> {
        return this.http.get<TaskHistory[]>(`${this.apiUrl}/task/${taskId}`);
    }

    getActionTypes(): Observable<TaskHistoryActionType[]> {
        return this.http.get<TaskHistoryActionType[]>(`${this.apiUrl}/actiontypes`);
    }
}

@Injectable({
    providedIn: 'root'
})
export class BarcodeHistoryService {
    private apiUrl = `${environment.apiUrl}/inventory/barcodehistory`;
    private http = inject(HttpClient);

    getAllHistory(offset: number = 0, limit: number = 10): Observable<BarcodeHistory[]> {
        return this.http.get<BarcodeHistory[]>(`${this.apiUrl}?offset=${offset}&limit=${limit}`);
    }

    getBarcodeHistory(barcodeId: number): Observable<BarcodeHistory[]> {
        return this.http.get<BarcodeHistory[]>(`${this.apiUrl}/barcode/${barcodeId}`);
    }

    getActionTypes(): Observable<BarcodeHistoryActionType[]> {
        return this.http.get<BarcodeHistoryActionType[]>(`${this.apiUrl}/actiontypes`);
    }
}