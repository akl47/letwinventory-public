import { Component, OnInit, ViewChild } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatPaginator } from '@angular/material/paginator';
import { MatTableDataSource } from '@angular/material/table';
import { Part } from 'src/app/models/inventory/part.model';
import { InventoryService } from 'src/app/services/inventory/inventory.service';
import { ViewTraceDialogComponent } from '../../trace/view-trace-dialog/view-trace-dialog.component';
import { PartEditDialogComponent } from '../part-edit-dialog/part-edit-dialog.component';

@Component({
  selector: 'app-parts-table',
  templateUrl: './parts-table.component.html',
  styleUrls: ['./parts-table.component.scss']
})
export class PartsTableComponent implements OnInit {

  constructor(
    private inventoryService: InventoryService,
    public dialog: MatDialog
  ) { }

  dataSource = new MatTableDataSource<Part>();
  @ViewChild(MatPaginator) paginator: MatPaginator;
  columnsToDisplay = [
    'name',
    'description',
    'vendor',
    'edit',
  ];
  ngOnInit(): void {
    this.inventoryService.getAllParts().subscribe(
      data => {
        this.dataSource.data = data
        this.dataSource.paginator = this.paginator
      },
      error => {
        console.log("Error:", error)
      }
    )
  }

  addTrace(part) {
    // const dialogRef = this.dialog.open(AddTraceOrderDialogComponent, {
    //   disableClose: true,
    //   autoFocus: false,
    //   data: {
    //     part: part
    //   }
    // });
    // dialogRef.afterClosed().subscribe(
    //   data => {
    //     part.Traces.push(data)
    //   },
    //   error => {
    //     console.log("Error:", error)
    //   }
    // )
  }

  editPart(part) {
    const dialogRef = this.dialog.open(PartEditDialogComponent, {
      disableClose: true,
      autoFocus: false,
      data: {
        part: part
      }
    });
  }

  newPart() {
    const dialogRef = this.dialog.open(PartEditDialogComponent, {
      disableClose: true,
      autoFocus: false,
    });
  }

  showTraces(part) {
    const dialogRef = this.dialog.open(ViewTraceDialogComponent, {
      autoFocus: false,
      data: {
        part: part
      }
    });
  }

}
