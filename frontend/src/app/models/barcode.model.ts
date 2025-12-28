import { BarcodeCategory } from './barcode-category.model';

export interface Barcode {
    id: number;
    barcode: string;
    parentBarcodeID: number;
    barcodeCategoryID: number;
    activeFlag: boolean;
    createdAt: string;
    updatedAt: string;
    BarcodeCategory?: BarcodeCategory;
}
