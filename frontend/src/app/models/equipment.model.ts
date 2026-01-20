import { Barcode } from './barcode.model';
import { Part } from './part.model';

export interface Equipment {
    id: number;
    name: string;
    description: string | null;
    serialNumber: string | null;
    commissionDate: string | null;
    barcodeID: number;
    partID: number | null;
    activeFlag: boolean;
    createdAt: string;
    updatedAt: string;
    Barcode?: Barcode;
    Part?: Part;
}
