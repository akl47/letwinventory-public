import { Component, Input, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Barcode } from 'src/app/models/inventory/barcode.model';
import { Tag } from 'src/app/models/inventory/tag.model';
import { InventoryService } from 'src/app/services/inventory/inventory.service';
import { BarcodeDisplayDialogComponent } from '../barcode-display-dialog/barcode-display-dialog.component';

@Component({
  selector: 'app-barcode-tag',
  templateUrl: './barcode-tag.component.html',
  styleUrls: ['./barcode-tag.component.scss']
})
export class BarcodeTagComponent implements OnInit {

  @Input() barcode: Barcode

  constructor(
    private inventoryService: InventoryService,
    public dialog: MatDialog,

  ) { }


  tag: Tag
  ngOnInit(): void {
    console.log("BarcodeTag Display")
    console.log(this.barcode)
    this.inventoryService.getTagByID(92).subscribe(
      data => {
        this.tag = data
      },
      error => {
        console.log(error)
      }
    )
  }

  displayBarcode(tag) {
    const dialogRef = this.dialog.open(BarcodeDisplayDialogComponent, {
      data: {
        barcodeID: tag.barcodeID
      }
    });
  }

}
