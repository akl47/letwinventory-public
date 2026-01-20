import { Part } from './part.model';
import { OrderLineType } from './order-line-type.model';
import { Equipment } from './equipment.model';
import { Trace } from './trace.model';

export interface OrderItem {
    id: number;
    orderID: number;
    partID: number | null;
    orderLineTypeID: number;
    lineNumber: number;
    quantity: number;
    receivedQuantity: number;
    price: number | string;
    name: string | null;
    activeFlag: boolean;
    createdAt: string;
    updatedAt: string;
    Part?: Partial<Part>;
    Equipment?: Equipment[];
    Traces?: Trace[];
    OrderLineType?: OrderLineType;
}
