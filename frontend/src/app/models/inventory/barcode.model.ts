import { BarcodeCategory } from "./barcodeCategory.model";

export class Barcode {
  id: number;
  barcode: String;
  barcodeCategoryID: number;
  barodeCategory: BarcodeCategory;
  name?: string;
  description?: string;
  activeFlag: boolean;
  createdAt: Date;
  updatedAt: Date;
}
  