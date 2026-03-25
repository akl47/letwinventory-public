export interface ParsedOrderItem {
    name: string;
    description: string;
    quantity: number;
    unitPrice: number;
    originalUnitPrice: number | null;
    discount: number;
    lineTotal: number;
    orderLineTypeID: number; // 1=Part, 2=Shipping, 3=Taxes
}

export interface ParsedOrder {
    vendor: string;
    orderNumber: string;
    placedDate: string | null;
    items: ParsedOrderItem[];
    subtotal: number;
    shipping: number;
    tax: number;
    taxDescription: string;
    total: number;
    notes: string;
}

export interface VendorParser {
    vendorName: string;
    detect(text: string): boolean;
    parse(text: string): ParsedOrder;
}
