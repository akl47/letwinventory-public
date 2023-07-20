export class Tag {
  id: number;
  barcodeID: number;
  parentBarcodeID: number;
  barcode: String;
  barcodeCategoryID: number;
  type: String;
  name?: string;
  description?: string;
  quantity?: number;
  partID?:number;
}
  