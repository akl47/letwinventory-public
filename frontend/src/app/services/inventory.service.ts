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
    Trace,
    UnitOfMeasure
} from '../models';
import { Equipment } from '../models/equipment.model';
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

    getAllBarcodes(includeInactive = false): Observable<Barcode[]> {
        const url = includeInactive
            ? `${this.apiUrl}/barcode/?includeInactive=true`
            : `${this.apiUrl}/barcode/`;
        return this.http.get<Barcode[]>(url);
    }

    getLocationBarcodes(): Observable<any[]> {
        return this.http.get<any[]>(`${this.apiUrl}/barcode/locations`);
    }

    lookupBarcode(barcodeString: string): Observable<Barcode> {
        return this.http.get<Barcode>(`${this.apiUrl}/barcode/lookup/${encodeURIComponent(barcodeString)}`);
    }

    getBarcodeZPL(barcodeId: number, labelSize?: string): Observable<string> {
        const url = labelSize
            ? `${this.apiUrl}/barcode/display/${barcodeId}?labelSize=${labelSize}`
            : `${this.apiUrl}/barcode/display/${barcodeId}`;
        return this.http.get(url, {
            responseType: 'text'
        });
    }

    printBarcode(barcodeId: number, labelSize: string, printerIP: string): Observable<any> {
        return this.http.post(`${this.apiUrl}/barcode/print/${barcodeId}`, { labelSize, printerIP });
    }

    createTrace(data: {
        partID: number;
        quantity: number;
        parentBarcodeID?: number | null;
        unitOfMeasureID?: number | null;
        serialNumber?: string | null;
        lotNumber?: string | null;
    }): Observable<any> {
        return this.http.post(`${this.apiUrl}/trace`, data);
    }

    receiveOrderItem(data: {
        partID: number;
        quantity: number;
        parentBarcodeID: number;
        orderItemID?: number;
        unitOfMeasureID?: number | null;
        serialNumber?: string | null;
        lotNumber?: string | null;
    }): Observable<any> {
        return this.http.post(`${this.apiUrl}/trace`, data);
    }

    getUnitsOfMeasure(): Observable<UnitOfMeasure[]> {
        return this.http.get<UnitOfMeasure[]>(`${this.apiUrl}/unitofmeasure`);
    }

    getAllParts(): Observable<Part[]> {
        return this.http.get<Part[]>(`${this.apiUrl}/part`);
    }

    getPartCategories(): Observable<PartCategory[]> {
        return this.http.get<PartCategory[]>(`${this.apiUrl}/part/categories`);
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

    searchPartsByCategory(categoryName: string, searchTerm: string): Observable<Part[]> {
        return this.http.get<Part[]>(`${this.apiUrl}/part/search`, {
            params: { category: categoryName, q: searchTerm }
        });
    }

    // Trace action methods
    splitTrace(barcodeId: number, splitQuantity: number): Observable<any> {
        return this.http.post(`${this.apiUrl}/trace/split/${barcodeId}`, { splitQuantity });
    }

    mergeTrace(targetBarcodeId: number, mergeBarcodeId: number): Observable<any> {
        return this.http.post(`${this.apiUrl}/trace/merge/${targetBarcodeId}`, { mergeBarcodeId });
    }

    deleteTrace(barcodeId: number, deleteQuantity?: number): Observable<any> {
        return this.http.delete(`${this.apiUrl}/trace/barcode/${barcodeId}`, {
            body: deleteQuantity !== undefined ? { deleteQuantity } : {}
        });
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

    getOrderStatuses(): Observable<OrderStatus[]> {
        return this.http.get<OrderStatus[]>(`${this.apiUrl}/order/statuses`);
    }

    getOrderLineTypes(): Observable<OrderLineType[]> {
        return this.http.get<OrderLineType[]>(`${this.apiUrl}/order/line-types`);
    }

    getPrinters(): Observable<any[]> {
        return this.http.get<any[]>(`${environment.apiUrl}/config/printers`);
    }

    // Equipment methods
    getAllEquipment(): Observable<Equipment[]> {
        return this.http.get<Equipment[]>(`${this.apiUrl}/equipment`);
    }

    getEquipmentById(equipmentId: number): Observable<Equipment> {
        return this.http.get<Equipment>(`${this.apiUrl}/equipment/${equipmentId}`);
    }

    createEquipment(data: Partial<Equipment>): Observable<Equipment> {
        return this.http.post<Equipment>(`${this.apiUrl}/equipment`, data);
    }

    updateEquipment(equipmentId: number, data: Partial<Equipment>): Observable<Equipment> {
        return this.http.put<Equipment>(`${this.apiUrl}/equipment/${equipmentId}`, data);
    }

    deleteEquipment(equipmentId: number): Observable<any> {
        return this.http.delete(`${this.apiUrl}/equipment/${equipmentId}`);
    }

    receiveEquipment(data: {
        name: string;
        description?: string | null;
        serialNumber?: string | null;
        commissionDate?: string | null;
        parentBarcodeID: number;
        orderItemID?: number;
        partID?: number | null;
    }): Observable<Equipment> {
        return this.http.post<Equipment>(`${this.apiUrl}/equipment/receive`, data);
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
    Trace,
    UnitOfMeasure,
    Equipment
};
