import { Component, HostListener, Inject, OnInit } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { Part } from 'src/app/models/inventory/part.model';
import { InventoryService } from 'src/app/services/inventory/inventory.service';

@Component({
  selector: 'app-part-edit-dialog',
  templateUrl: './part-edit-dialog.component.html',
  styleUrls: ['./part-edit-dialog.component.scss']
})
export class PartEditDialogComponent implements OnInit {

  @HostListener('document:keydown.escape', ['$event']) onKeydownHandler(event: KeyboardEvent) {
    this.dialogRef.close('close');
  }

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: any,
    private inventoryService: InventoryService,
    private dialogRef: MatDialogRef<PartEditDialogComponent>
  ) { }


  title
  newPart
  partEditForm: FormGroup
  name: FormControl
  description: FormControl
  vendor: FormControl
  link: FormControl
  internalPart: FormControl
  minimumOrderQuantity: FormControl

  part: Part
  loading = true;

  ngOnInit(): void {
    this.formControl()
    console.log(this.data)
    if (!!this.data) {
      this.newPart = false
      this.title = "Edit Part"
      this.loading = false;
      this.part = this.data.part
    } else {
      this.part = new Part();
      this.title = "New Part"
      this.newPart = true
      this.loading = false

    }

  }

  onSubmit() {
  }

  updatePart() {
    this.inventoryService.updatePart(this.part).subscribe(
      data => {
        this.dialogRef.close()
      },
      error => {
        console.log("Error:", error)
      }
    )
  }

  createPart() {
    this.inventoryService.createPart(this.part).subscribe(
      data => {
        this.dialogRef.close()
        // TODO add to part list
      },
      error => {
        console.log("Error:", error)
      }
    )
  }



  deletePart() {
    this.inventoryService.deletePart(this.part).subscribe(
      data => {
        this.dialogRef.close()
        // TODO remove from part list
      },
      error => {
        console.log("Error:", error)
      }
    )
  }

  close() {
    this.dialogRef.close('close');
  }

  formControl() {
    this.name = new FormControl(''); //TODO add validation
    this.description = new FormControl(''); //TODO add validation
    this.vendor = new FormControl(''); //TODO add validation
    this.link = new FormControl(''); //TODO add validation
    this.internalPart = new FormControl(''); //TODO add validation
    this.minimumOrderQuantity = new FormControl(''); //TODO add validation
    this.partEditForm = new FormGroup({
      name: this.name,
      description: this.description,
      vendor: this.vendor,
      link: this.link,
      internalPart: this.internalPart,
      minimumOrderQuantity: this.minimumOrderQuantity,

    });
  }
}
