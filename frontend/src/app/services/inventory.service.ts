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

    createTrace(data: { partID: number; quantity: number; parentBarcodeID: number }): Observable<any> {
        const token = localStorage.getItem('auth_token');
        return this.http.post(`${this.apiUrl}/trace`, data, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
    }

    getAllParts(): Observable<Part[]> {
        const token = localStorage.getItem('auth_token');
        return this.http.get<Part[]>(`${this.apiUrl}/part`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
    }

    moveBarcode(barcodeId: number, newLocationID: number): Observable<any> {
        const token = localStorage.getItem('auth_token');
        return this.http.post(`${this.apiUrl}/barcode/move/${barcodeId}`, { newLocationID }, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
    }

    createPart(data: any): Observable<any> {
        const token = localStorage.getItem('auth_token');
        return this.http.post(`${this.apiUrl}/part`, data, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
    }

    updatePart(partId: number, data: any): Observable<any> {
        const token = localStorage.getItem('auth_token');
        return this.http.put(`${this.apiUrl}/part/${partId}`, data, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
    }

    deletePart(partId: number): Observable<any> {
        const token = localStorage.getItem('auth_token');
        return this.http.delete(`${this.apiUrl}/part/${partId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
    }

    // Order methods
    getAllOrders(): Observable<Order[]> {
        const token = localStorage.getItem('auth_token');
        return this.http.get<Order[]>(`${this.apiUrl}/order`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
    }

    getOrderById(orderId: number): Observable<Order> {
        const token = localStorage.getItem('auth_token');
        return this.http.get<Order>(`${this.apiUrl}/order/${orderId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
    }

    createOrder(data: Partial<Order>): Observable<Order> {
        const token = localStorage.getItem('auth_token');
        return this.http.post<Order>(`${this.apiUrl}/order`, data, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
    }

    updateOrder(orderId: number, data: Partial<Order>): Observable<Order> {
        const token = localStorage.getItem('auth_token');
        return this.http.put<Order>(`${this.apiUrl}/order/${orderId}`, data, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
    }

    deleteOrder(orderId: number): Observable<any> {
        const token = localStorage.getItem('auth_token');
        return this.http.delete(`${this.apiUrl}/order/${orderId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
    }

    // OrderItem methods
    createOrderItem(data: Partial<OrderItem>): Observable<OrderItem> {
        const token = localStorage.getItem('auth_token');
        return this.http.post<OrderItem>(`${this.apiUrl}/orderitem`, data, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
    }

    updateOrderItem(itemId: number, data: Partial<OrderItem>): Observable<OrderItem> {
        const token = localStorage.getItem('auth_token');
        return this.http.put<OrderItem>(`${this.apiUrl}/orderitem/${itemId}`, data, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
    }

    deleteOrderItem(itemId: number): Observable<any> {
        const token = localStorage.getItem('auth_token');
        return this.http.delete(`${this.apiUrl}/orderitem/${itemId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
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
