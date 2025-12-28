import { Barcode } from './barcode.model';
import { Part } from './part.model';

export interface Trace {
    id: number;
    partID: number;
    quantity: number;
    orderItemID: number | null;
    barcodeID: number;
    activeFlag: boolean;
    createdAt: string;
    updatedAt: string;
    Barcode?: Barcode;
    Part?: Part;
}
