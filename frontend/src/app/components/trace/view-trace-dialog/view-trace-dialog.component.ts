import { Component, Inject, OnInit, ViewChild } from '@angular/core';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatPaginator } from '@angular/material/paginator';
import { MatTableDataSource } from '@angular/material/table';
import { OrderItem } from 'src/app/models/inventory/orderItem.model';
import { Part } from 'src/app/models/inventory/part.model';
import { Trace } from 'src/app/models/inventory/trace.model';
import { InventoryService } from 'src/app/services/inventory/inventory.service';

@Component({
  selector: 'app-view-trace-dialog',
  templateUrl: './view-trace-dialog.component.html',
  styleUrls: ['./view-trace-dialog.component.scss']
})
export class ViewTraceDialogComponent implements OnInit {


  constructor(
    @Inject(MAT_DIALOG_DATA) public data: any,
    private inventoryService: InventoryService,
  ) { }

  part: Part
  orderItem: OrderItem
  traceList: Trace[]
  dataSource = new MatTableDataSource<Trace>();
  @ViewChild(MatPaginator) paginator: MatPaginator;
  columnsToDisplay = [
    'qty',
    'barcode',
    'location',
  ];


  ngOnInit(): void {
    console.log(this.data)
    if (!!this.data) {
      if (!!this.data.part) {
        this.part = this.data.part
      }
      if (!!this.data.orderItem) {
        this.orderItem = this.data.orderItem
      }
      this.findTracesByPartID(this.part.id)
    }
  }


  findTracesByPartID(partID) {
    this.inventoryService.getTracesByPartID(partID).subscribe(
      data => {
        console.log("Found trace by partid")
        console.log(data)
        this.dataSource.data = data
        this.dataSource.paginator = this.paginator
      },
      error => {

      }
    )
  }
}
