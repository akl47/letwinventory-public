import { Component, HostListener, Inject, OnInit } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { Observable } from 'rxjs';
import { map, startWith } from 'rxjs/operators';
import { Barcode } from 'src/app/models/inventory/barcode.model';
import { Tag } from 'src/app/models/inventory/tag.model';
import { InventoryService } from 'src/app/services/inventory/inventory.service';

@Component({
  selector: 'app-move-barcode-dialog',
  templateUrl: './move-barcode-dialog.component.html',
  styleUrls: ['./move-barcode-dialog.component.scss']
})
export class MoveBarcodeDialogComponent implements OnInit {

  @HostListener('document:keydown.escape', ['$event']) onKeydownHandler(event: KeyboardEvent) {
    this.dialogRef.close('close');
  }

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: any,
    private inventoryService: InventoryService,
    private dialogRef: MatDialogRef<MoveBarcodeDialogComponent>
  ) {

    this.filteredBarcodeTags = this.barcodeControl.valueChanges
      .pipe(
        startWith(''),
        map(value => value ? this._filterBarcodeTags(value) : this.barcodeTagList.slice())
      );

    this.filteredNewLocationTags = this.newLocationControl.valueChanges
      .pipe(
        startWith(''),
        map(value => value ? this._filterNewLocationTags(value) : this.newLocationaTagList.slice())
      );
  }

  private _filterBarcodeTags(value: string): Tag[] {
    const filterValue = value.toLowerCase();
    return this.barcodeTagList.filter(tag => tag.barcode.toLowerCase().indexOf(filterValue) === 0);
  }

  private _filterNewLocationTags(value: string): Tag[] {
    const filterValue = value.toLowerCase();
    return this.newLocationaTagList.filter(tag => tag.barcode.toLowerCase().indexOf(filterValue) === 0);
  }

  newLocationControl: FormControl = new FormControl('', Validators.required)
  barcodeControl: FormControl = new FormControl('', Validators.required)
  fakeControl: FormControl = new FormControl('')
  newLocationTag: Tag
  barcodeTag: Tag
  moveBarcodeForm: FormGroup

  barcodeTagList: Tag[] = []
  newLocationaTagList: Tag[] = []
  filteredNewLocationTags: Observable<Tag[]>;
  filteredBarcodeTags: Observable<Tag[]>;
  ngOnInit(): void {
    this.formControl()
    this.getTags()
  }

  moveBarcode() {
    console.log(this.barcodeTag)
    console.log(this.newLocationTag)
    this.inventoryService.moveBarcode(this.barcodeTag.id, this.newLocationTag.id).subscribe(
      data => {
        console.log("UPDATED:", data)
        this.dialogRef.close()
      }, error => {
        console.log(error)
      }
    )
  }

  close() {
    console.log("Close")
    this.dialogRef.close('close');
  }

  formControl() {
    this.moveBarcodeForm = new FormGroup({
      barcode: this.barcodeControl,
      newLocationControl: this.newLocationControl,
      fakeControl: this.fakeControl
    });
  }

  getTags() {
    this.inventoryService.getAllTags().subscribe(
      data => {
        this.barcodeTagList = data
        this.newLocationaTagList = data
      },
      error => {
        console.log("Error:", error)
      }
    )
  }

  clearNewLocationControl() {
    this.newLocationControl.enable()
    this.newLocationControl.setValue('')
  }
  clearBarcodeControl() {
    this.barcodeControl.enable()
    this.barcodeControl.setValue('')
  }

  onSubmit() {
    // TODO Fix
  }


  selectNewLocationTag(tag) {
    this.newLocationTag = tag
    this.newLocationControl.disable()
  }
  selectBarcodeTag(tag) {
    this.barcodeTag = tag
    this.barcodeControl.disable()
  }

}
