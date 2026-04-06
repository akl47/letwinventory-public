import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MobileScanner } from '../../mobile/mobile-scanner/mobile-scanner';

@Component({
  selector: 'app-barcode-dialog',
  standalone: true,
  imports: [MobileScanner],
  template: `
    <app-mobile-scanner
      [initialBarcode]="data.barcode"
      [embedded]="true"
      (closed)="dialogRef.close($event)">
    </app-mobile-scanner>
  `,
  styles: [`
    :host {
      display: block;
      height: 80vh;
      overflow: hidden;
    }
  `],
})
export class BarcodeDialog {
  constructor(
    @Inject(MAT_DIALOG_DATA) public data: { barcode: string },
    public dialogRef: MatDialogRef<BarcodeDialog>,
  ) {}
}
