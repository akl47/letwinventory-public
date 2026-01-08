import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
    InventoryTag,
    Part,
    PartCategory,
    Order,
    OrderItem,
    OrderStatus,
    OrderLineType,
    Barcode,
    BarcodeCategory,
    Location,
    Box,
    Trace
} from '../models';
import { environment } from '../../environments/environment';

@Injectable({
    providedIn: 'root'
})
export class InventoryService {
    private http = inject(HttpClient);
    private apiUrl = `${environment.apiUrl}/inventory`;

    getAllTags(): Observable<InventoryTag[]> {
        return this.http.get<InventoryTag[]>(`${this.apiUrl}/barcode/tag/`);
    }

    updateItem(item: InventoryTag, data: { name: string; description?: string | null }): Observable<any> {
        if (item.type === 'Location') {
            return this.http.put(`${this.apiUrl}/location/${item.item_id}`, data);
        } else if (item.type === 'Box') {
            return this.http.put(`${this.apiUrl}/box/${item.item_id}`, data);
        } else {
            return new Observable(observer => observer.error('Update not implemented for ' + item.type));
        }
    }

    createItem(type: 'Location' | 'Box', data: { name: string; description?: string | null; parentBarcodeID: number }): Observable<any> {
        if (type === 'Location') {
            return this.http.post(`${this.apiUrl}/location`, data);
        } else if (type === 'Box') {
            return this.http.post(`${this.apiUrl}/box`, data);
        } else {
            return new Observable(observer => observer.error('Create not implemented for ' + type));
        }
    }

    deleteItem(item: InventoryTag): Observable<any> {
        return this.http.delete(`${this.apiUrl}/barcode/${item.id}`);
    }

    getAllBarcodes(): Observable<Barcode[]> {
        return this.http.get<Barcode[]>(`${this.apiUrl}/barcode/`);
    }

    getBarcodeZPL(barcodeId: number): Observable<string> {
        return this.http.get(`${this.apiUrl}/barcode/display/${barcodeId}`, {
            responseType: 'text'
        });
    }

    printBarcode(barcodeId: number, labelSize: string, printerIP: string): Observable<any> {
        return this.http.post(`${this.apiUrl}/barcode/print/${barcodeId}`, { labelSize, printerIP });
    }

    createTrace(data: { partID: number; quantity: number; parentBarcodeID: number }): Observable<any> {
        return this.http.post(`${this.apiUrl}/trace`, data);
    }

    getAllParts(): Observable<Part[]> {
        return this.http.get<Part[]>(`${this.apiUrl}/part`);
    }

    moveBarcode(barcodeId: number, newLocationID: number): Observable<any> {
        return this.http.post(`${this.apiUrl}/barcode/move/${barcodeId}`, { newLocationID });
    }

    createPart(data: any): Observable<any> {
        return this.http.post(`${this.apiUrl}/part`, data);
    }

    updatePart(partId: number, data: any): Observable<any> {
        return this.http.put(`${this.apiUrl}/part/${partId}`, data);
    }

    deletePart(partId: number): Observable<any> {
        return this.http.delete(`${this.apiUrl}/part/${partId}`);
    }

    // Order methods
    getAllOrders(): Observable<Order[]> {
        return this.http.get<Order[]>(`${this.apiUrl}/order`);
    }

    getOrderById(orderId: number): Observable<Order> {
        return this.http.get<Order>(`${this.apiUrl}/order/${orderId}`);
    }

    createOrder(data: Partial<Order>): Observable<Order> {
        return this.http.post<Order>(`${this.apiUrl}/order`, data);
    }

    updateOrder(orderId: number, data: Partial<Order>): Observable<Order> {
        return this.http.put<Order>(`${this.apiUrl}/order/${orderId}`, data);
    }

    deleteOrder(orderId: number): Observable<any> {
        return this.http.delete(`${this.apiUrl}/order/${orderId}`);
    }

    // OrderItem methods
    createOrderItem(data: Partial<OrderItem>): Observable<OrderItem> {
        return this.http.post<OrderItem>(`${this.apiUrl}/orderitem`, data);
    }

    updateOrderItem(itemId: number, data: Partial<OrderItem>): Observable<OrderItem> {
        return this.http.put<OrderItem>(`${this.apiUrl}/orderitem/${itemId}`, data);
    }

    deleteOrderItem(itemId: number): Observable<any> {
        return this.http.delete(`${this.apiUrl}/orderitem/${itemId}`);
    }
}

// Re-export models for backward compatibility
export type {
    InventoryTag,
    Part,
    PartCategory,
    Order,
    OrderItem,
    OrderStatus,
    OrderLineType,
    Barcode,
    BarcodeCategory,
    Location,
    Box,
    Trace
};
