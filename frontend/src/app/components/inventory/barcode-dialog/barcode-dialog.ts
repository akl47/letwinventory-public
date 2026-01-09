import { Component, Inject, OnInit, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { CommonModule } from '@angular/common';
import { inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InventoryService } from '../../../services/inventory.service';

@Component({
  selector: 'app-barcode-dialog',
  standalone: true,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatFormFieldModule,
    MatInputModule,
    CommonModule,
    FormsModule
  ],
  templateUrl: './barcode-dialog.html',
  styleUrl: './barcode-dialog.css',
})
export class BarcodeDialog implements OnInit {
  private inventoryService = inject(InventoryService);
  private dialogRef = inject(MatDialogRef<BarcodeDialog>);
  barcodeImageUrl = signal<string | null>(null);
  isLoading = signal(true);
  error = signal<string | null>(null);
  barcodeId = signal<number | null>(null);
  selectedPreviewSize = signal<string>('3x1');
  selectedLabelSize = signal<string>('3x1');
  selectedPrinterIP = signal<string>('10.10.10.37');
  isPrinting = signal(false);
  showPrintOptions = signal(false);

  labelSizes = [
    { value: '3x1', label: '3" x 1"' },
    { value: '1.5x1', label: '1.5" x 1"' }
  ];

  printers = [
    { ip: '10.10.10.37', name: 'Default Printer (10.10.10.37)' },
    { ip: '10.10.10.38', name: 'Printer 2 (10.10.10.38)' },
    { ip: '10.10.10.39', name: 'Printer 3 (10.10.10.39)' }
  ];

  constructor(@Inject(MAT_DIALOG_DATA) public data: { barcode: string }) { }

  ngOnInit() {
    this.fetchAndRenderBarcode();
  }

  private fetchAndRenderBarcode() {
    this.inventoryService.getAllBarcodes().subscribe({
      next: (barcodes) => {
        const barcode = barcodes.find((b: any) => b.barcode === this.data.barcode);
        if (barcode) {
          this.barcodeId.set(barcode.id);
          this.fetchZPL(barcode.id);
        } else {
          this.error.set('Barcode not found');
          this.isLoading.set(false);
        }
      },
      error: (err) => {
        this.error.set('Failed to fetch barcode: ' + err.message);
        this.isLoading.set(false);
      }
    });
  }

  moveBarcode() {
    const barcodeId = this.barcodeId();
    if (!barcodeId) {
      alert('Barcode ID not found');
      return;
    }

    const newLocationBarcode = prompt('Enter the destination barcode (LOC-XXXXXX or BOX-XXXXXX):');
    if (!newLocationBarcode) {
      return;
    }

    this.inventoryService.getAllBarcodes().subscribe({
      next: (barcodes) => {
        const destBarcode = barcodes.find((b: any) => b.barcode === newLocationBarcode);
        if (!destBarcode) {
          alert('Destination barcode not found: ' + newLocationBarcode);
          return;
        }

        this.inventoryService.moveBarcode(barcodeId, destBarcode.id).subscribe({
          next: () => {
            alert(`Successfully moved ${this.data.barcode} to ${newLocationBarcode}`);
            this.dialogRef.close(true);
          },
          error: (err) => {
            alert('Error moving barcode: ' + (err.error?.message || err.message || 'Unknown error'));
          }
        });
      },
      error: (err) => {
        alert('Error fetching barcodes: ' + err.message);
      }
    });
  }

  private fetchZPL(barcodeId: number, labelSize?: string) {
    const size = labelSize || this.selectedPreviewSize();
    this.inventoryService.getBarcodeZPL(barcodeId, size).subscribe({
      next: (zpl) => {
        this.renderBarcodeImage(zpl, size);
      },
      error: (err) => {
        this.error.set('Failed to fetch barcode ZPL: ' + err.message);
        this.isLoading.set(false);
      }
    });
  }

  private renderBarcodeImage(zpl: string, labelSize: string) {
    const encodedZPL = encodeURIComponent(zpl);
    const labelaryUrl = `https://api.labelary.com/v1/printers/8dpmm/labels/${labelSize}/0/${encodedZPL}`;
    this.barcodeImageUrl.set(labelaryUrl);
  }

  onPreviewSizeChange() {
    const barcodeId = this.barcodeId();
    if (barcodeId) {
      this.isLoading.set(true);
      this.error.set(null);
      this.fetchZPL(barcodeId, this.selectedPreviewSize());
    }
  }

  onImageLoad() {
    this.isLoading.set(false);
  }

  onImageError() {
    this.error.set('Failed to load barcode image from Labelary');
    this.isLoading.set(false);
  }

  togglePrintOptions() {
    this.showPrintOptions.set(!this.showPrintOptions());
  }

  printLabel() {
    const barcodeId = this.barcodeId();
    if (!barcodeId) {
      alert('Barcode ID not found');
      return;
    }

    this.isPrinting.set(true);
    const labelSize = this.selectedLabelSize();
    const printerIP = this.selectedPrinterIP();

    this.inventoryService.printBarcode(barcodeId, labelSize, printerIP).subscribe({
      next: () => {
        this.isPrinting.set(false);
        alert('Label printed successfully!');
      },
      error: (err) => {
        this.isPrinting.set(false);
        alert('Error printing label: ' + (err.error?.message || err.message || 'Unknown error'));
      }
    });
  }
}
