import { Barcode } from "./barcode.model";

export class Location {
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
  