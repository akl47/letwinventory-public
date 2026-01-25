export interface InventoryTag {
    id: number;
    barcode: string;
    parentBarcodeID: number;
    barcodeCategoryID: number;
    activeFlag: boolean;
    name: string;
    description?: string;
    quantity?: number; // For Trace items
    // properties from backend query
    type: 'Location' | 'Box' | 'Trace' | 'Equipment';
    item_id: number;

    children?: InventoryTag[]; // For tree structure
}
