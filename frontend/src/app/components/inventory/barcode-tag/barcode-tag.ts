import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
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
  @Output() dataChanged = new EventEmitter<void>();
  private dialog = inject(MatDialog);
  private router = inject(Router);

  openBarcodeDialog(event: Event) {
    event.stopPropagation();
    this.barcodeClicked.emit();

    if (window.innerWidth <= 768) {
      this.router.navigate(['/mobile'], { queryParams: { barcode: this.barcode } });
      return;
    }

    const dialogRef = this.dialog.open(BarcodeDialog, {
      data: { barcode: this.barcode },
      panelClass: 'scanner-dialog-panel',
      width: '480px',
      maxHeight: '90vh',
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.dataChanged.emit();
      }
    });
  }
}
