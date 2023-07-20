import { Barcode } from "./barcode.model";

export class Box {
  id: number;
  name: String;
  description: String;
  barcodeID: number;
  barcode: Barcode;
  parentBarcodeID: number;
  parentBarcode: Barcode;
  activeFlag: Boolean;
  createdAt: Date
  updatedAt: Date
  }
  