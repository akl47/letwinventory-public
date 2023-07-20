import { Barcode } from "./barcode.model";
import { Part } from "./part.model";

export class Trace {
    id: number;
    partID: number;
    part: Part;
    quantity: number;
    barcodeID: number;
    barcode?: Barcode;
    parentBarcodeID: number;
    parentBarcode?: Barcode;
    orderItemID?: number;
    activeFlag: boolean;
    
  }
  