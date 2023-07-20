import { Component, HostListener, Inject, OnInit } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { BarcodeCategory } from 'src/app/models/inventory/barcodeCategory.model';
import { Tag } from 'src/app/models/inventory/tag.model';
import { InventoryService } from 'src/app/services/inventory/inventory.service';

@Component({
  selector: 'app-location-edit-dialog',
  templateUrl: './location-edit-dialog.component.html',
  styleUrls: ['./location-edit-dialog.component.scss']
})
export class LocationEditDialogComponent implements OnInit {

  @HostListener('document:keydown.escape', ['$event']) onKeydownHandler(event: KeyboardEvent) {
    this.dialogRef.close('close');
  }
  constructor(
    @Inject(MAT_DIALOG_DATA) public data: any,
    private inventoryService: InventoryService,
    private dialogRef: MatDialogRef<LocationEditDialogComponent>
  ) { }

  title
  newBarcode
  locationEditForm: FormGroup
  name: FormControl
  description: FormControl
  barcodeCategory: FormControl
  quantity: FormControl
  tag: Tag
  barcodeCategories: BarcodeCategory[]
  loading = true;

  ngOnInit(): void {
    this.formControl()
    this.inventoryService.getBarcodeCategories().subscribe(
      data => {
        this.barcodeCategories = data
      }, error => {
        console.log("ERROR:", error)
      }
    )
    if (typeof this.data.barcodeID == 'number') {
      this.newBarcode = false
      this.inventoryService.getTagByID(this.data.barcodeID).subscribe(
        data => {
          this.tag = data
          console.log(this.tag)
          this.title = `Edit ${data.type}`
          this.loading = false
        },
        error => {
          console.log("ERROR:", error)
        }
      )
    } else {
      this.tag = new Tag();
      console.log(this.data)
      this.tag.parentBarcodeID = this.data.parentBarcodeID
      this.title = "New Barcode"
      this.newBarcode = true
      this.loading = false
    }

  }

  onSubmit() {
  }

  updateBarcode() {
    this.inventoryService.updateByTag(this.tag).subscribe(
      data => {
        this.dialogRef.close();
      }, error => {
        console.log("Error:", error)
      })
  }

  createBarcode() {
    console.log("Create Barcode:", this.tag)
    this.inventoryService.createByTag(this.tag).subscribe(
      data => {
        this.dialogRef.close();
      }, error => {
        console.log("Error:", error)
      })
  }

  createAndPrintBarcode() {
    this.inventoryService.createByTag(this.tag).subscribe(
      data => {
        this.inventoryService.printBarcode(data.barcodeID).subscribe(
          data => {
            this.dialogRef.close();
          }, error => {
            console.log("Error:", error)
          })
      }, error => {
        console.log("Error:", error)
      })
  }

  deleteBarcode() {
    this.inventoryService.deleteByBarcodeID(this.tag.barcodeID).subscribe(
      data => {
        this.dialogRef.close()
      }, error => {
        console.log("Error:", error)
      }
    )
  }

  close() {
    this.dialogRef.close('close');
  }

  categorySelected(barcodeCategory) {
    this.tag.barcodeCategoryID = barcodeCategory.value
    this.tag.type = this.barcodeCategories.find(bc => bc.id === this.tag.barcodeCategoryID).name

  }

  formControl() {
    this.name = new FormControl(''); //TODO add validation
    this.description = new FormControl(''); //TODO add validation
    this.barcodeCategory = new FormControl(''); //TODO add validation
    this.quantity = new FormControl(''); //TODO add validation
    this.locationEditForm = new FormGroup({
      name: this.name,
      description: this.description,
      barcodeCategory: this.barcodeCategory,
      quantity: this.quantity,
    });
  }

}
