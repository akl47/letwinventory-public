import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { BarcodeDialog } from '../barcode-dialog/barcode-dialog';

@Component({
  selector: 'app-barcode-tag',
  standalone: true,
  imports: [],
  templateUrl: './barcode-tag.html',
  styleUrl: './barcode-tag.css',
})
export class BarcodeTag {
  @Input({ required: true }) barcode!: string;
  @Output() barcodeClicked = new EventEmitter<void>();
  private dialog = inject(MatDialog);

  openBarcodeDialog(event: Event) {
    event.stopPropagation();
    this.barcodeClicked.emit();
    this.dialog.open(BarcodeDialog, {
      data: { barcode: this.barcode }
    });
  }
}
