import { Barcode } from './barcode.model';

export interface Location {
    id: number;
    name: string | null;
    description: string | null;
    barcodeID: number;
    activeFlag: boolean;
    createdAt: string;
    updatedAt: string;
    Barcode?: Barcode;
}
