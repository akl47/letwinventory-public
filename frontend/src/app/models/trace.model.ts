import { Barcode } from './barcode.model';
import { Part } from './part.model';

export interface UnitOfMeasure {
    id: number;
    name: string;
    description: string | null;
}

export interface Trace {
    id: number;
    partID: number;
    quantity: number;
    unitOfMeasureID: number | null;
    orderItemID: number | null;
    barcodeID: number;
    activeFlag: boolean;
    serialNumber: string | null;
    lotNumber: string | null;
    createdAt: string;
    updatedAt: string;
    Barcode?: Barcode;
    Part?: Part;
    UnitOfMeasure?: UnitOfMeasure;
}
