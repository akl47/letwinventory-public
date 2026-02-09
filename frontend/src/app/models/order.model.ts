import { OrderStatus } from './order-status.model';
import { OrderItem } from './order-item.model';
import { ShipmentTracking } from './tracking.model';

export interface Order {
    id: number;
    placedDate: string | null;
    receivedDate: string | null;
    orderStatusID: number;
    vendor: string | null;
    trackingNumber: string | null;
    link: string | null;
    description: string | null;
    notes: string | null;
    activeFlag: boolean;
    createdAt: string;
    updatedAt: string;
    OrderStatus?: OrderStatus;
    OrderItems?: OrderItem[];
    ShipmentTracking?: ShipmentTracking;
}
