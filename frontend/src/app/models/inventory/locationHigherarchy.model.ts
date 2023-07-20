import { Barcode } from "./barcode.model";

export class LocationHigherarchy {
    id: number;
    name: string;
    description: string;
    barcodeID: number;
    Barcode: Barcode
    parentBarcodeID:number;
    children
    
  }
  