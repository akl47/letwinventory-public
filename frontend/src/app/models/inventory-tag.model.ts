export interface InventoryTag {
    id: number;
    barcode: string;
    parentBarcodeID: number;
    barcodeCategoryID: number;
    activeFlag: boolean;
    name: string;
    description?: string;
    quantity?: number; // For Trace items
    partID?: number; // For Trace items
    revision?: string; // For Trace items — from Part
    manufacturer?: string; // For Trace items
    manufacturerPN?: string; // For Trace items
    unitOfMeasureID?: number; // For Trace items
    allowDecimal?: boolean; // For Trace items — from UoM
    wip?: boolean; // For Trace items — work in progress (WO output)
    createdAt?: string;
    // properties from backend query
    type: 'Location' | 'Box' | 'Trace' | 'Equipment';
    item_id: number;

    children?: InventoryTag[]; // For tree structure
}
