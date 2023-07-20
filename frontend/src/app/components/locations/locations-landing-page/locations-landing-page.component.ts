import {
  NestedTreeControl
} from '@angular/cdk/tree';
import {
  Component,
  OnInit
} from '@angular/core';
import {
  MatDialog
} from '@angular/material/dialog';
import {
  MatTreeNestedDataSource
} from '@angular/material/tree';
import {
  InventoryService
} from 'src/app/services/inventory/inventory.service';
import {
  BarcodeDisplayDialogComponent
} from '../../common/barcode-display-dialog/barcode-display-dialog.component';
import {
  LocationEditDialogComponent
} from '../location-edit-dialog/location-edit-dialog.component';


@Component({
  selector: 'app-locations-landing-page',
  templateUrl: './locations-landing-page.component.html',
  styleUrls: ['./locations-landing-page.component.scss']
})
export class LocationsLandingPageComponent implements OnInit {


  constructor(
    public inventoryService: InventoryService,
    public dialog: MatDialog
  ) { }

  barcodeZPL

  ngOnInit(): void {
    this.updateHigherarchy()
  }

  updateHigherarchy() {
    this.inventoryService.getAllLocations().subscribe(
      data => {
        this.dataSource.data = [data]
        // console.log("Locations:",this.list)
      },
      error => {
        console.log(error)
      }
    )
  }
  treeControl = new NestedTreeControl<any>(node => node.children);
  dataSource = new MatTreeNestedDataSource();



  hasChild = (_: number, node) => !!node.children && node.children.length > 0;



  printBarcode(barcodeID) {
    if (confirm("This will print 1 barcode. Do you want to print?")) {
      this.inventoryService.printBarcode(barcodeID).subscribe(
        data => {
          console.log(data)
        },
        error => {
          console.log("Error:", error)
        }
      )
    }
  }

  addChildBarcode(barcodeID) {
    const dialogRef = this.dialog.open(LocationEditDialogComponent, {
      disableClose: true,
      autoFocus: false,
      // width:'',
      // height:'',
      data: {
        parentBarcodeID: barcodeID
      }
    })
    dialogRef.afterClosed().subscribe(result => {
      this.updateHigherarchy()
    });
  }

  editBarcode(barcodeID) {

    const dialogRef = this.dialog.open(LocationEditDialogComponent, {
      disableClose: true,
      autoFocus: false,
      // width:'',
      // height:''
      data: {
        barcodeID: barcodeID
      }
    })

    dialogRef.afterClosed().subscribe(result => {
      if (result != 'close') {
        this.updateHigherarchy()
      }

    });
  }

}
