import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { InventoryService } from 'src/app/services/inventory/inventory.service';

@Component({
  selector: 'app-barcode-display-dialog',
  templateUrl: './barcode-display-dialog.component.html',
  styleUrls: ['./barcode-display-dialog.component.scss']
})
export class BarcodeDisplayDialogComponent implements OnInit {


  constructor(
    @Inject(MAT_DIALOG_DATA) public data: any,
    private inventoryService: InventoryService
  ) {

  }

  barcodeZPL: any

  ngOnInit(): void {
    console.log("Dialog Data", this.data.barcodeID)
    this.inventoryService.getBarcodeZPL(this.data.barcodeID).subscribe(
      data => {

        this.barcodeZPL = data
        console.log(this.barcodeZPL)

      },
      error => {
        console.log("ERROR:", error)
      }
    )
  }

  printBarcode() {

  }

  moveBarcode() { }

}
