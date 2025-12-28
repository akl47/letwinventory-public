import { Component, Inject, OnInit, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { inject } from '@angular/core';
import { InventoryService } from '../../../services/inventory.service';

@Component({
  selector: 'app-barcode-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatProgressSpinnerModule, CommonModule],
  templateUrl: './barcode-dialog.html',
  styleUrl: './barcode-dialog.css',
})
export class BarcodeDialog implements OnInit {
  private http = inject(HttpClient);
  private inventoryService = inject(InventoryService);
  private dialogRef = inject(MatDialogRef<BarcodeDialog>);
  barcodeImageUrl = signal<string | null>(null);
  isLoading = signal(true);
  error = signal<string | null>(null);
  barcodeId = signal<number | null>(null);

  constructor(@Inject(MAT_DIALOG_DATA) public data: { barcode: string }) { }

  ngOnInit() {
    this.fetchAndRenderBarcode();
  }

  private fetchAndRenderBarcode() {
    // First, find the barcode ID from the barcode string
    this.http
      .get<any>(`http://localhost:3000/api/inventory/barcode/`)
      .subscribe({
        next: (barcodes) => {
          const barcode = barcodes.find((b: any) => b.barcode === this.data.barcode);
          if (barcode) {
            this.barcodeId.set(barcode.id);
            this.fetchZPL(barcode.id);
          } else {
            console.warn('Barcode not found:', this.data.barcode);
            this.error.set('Barcode not found');
            this.isLoading.set(false);
          }
        },
        error: (err) => {
          console.error('Failed to fetch barcodes:', err);
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

    // Find the destination barcode ID
    this.http.get<any>(`http://localhost:3000/api/inventory/barcode/`).subscribe({
      next: (barcodes) => {
        const destBarcode = barcodes.find((b: any) => b.barcode === newLocationBarcode);
        if (!destBarcode) {
          alert('Destination barcode not found: ' + newLocationBarcode);
          return;
        }

        // Perform the move
        this.inventoryService.moveBarcode(barcodeId, destBarcode.id).subscribe({
          next: (response) => {
            console.log('Move successful:', response);
            alert(`Successfully moved ${this.data.barcode} to ${newLocationBarcode}`);
            this.dialogRef.close(true);
          },
          error: (err) => {
            console.error('Move failed:', err);
            alert('Error moving barcode: ' + (err.error?.message || err.message || 'Unknown error'));
          }
        });
      },
      error: (err) => {
        console.error('Failed to fetch barcodes:', err);
        alert('Error fetching barcodes: ' + err.message);
      }
    });
  }

  private fetchZPL(barcodeId: number) {
    this.http.get(`http://localhost:3000/api/inventory/barcode/display/${barcodeId}`, {
      responseType: 'text'
    }).subscribe({
      next: (zpl) => {
        console.log('ZPL fetched successfully');
        this.renderBarcodeImage(zpl);
      },
      error: (err) => {
        console.error('Failed to fetch barcode ZPL:', err);
        this.error.set('Failed to fetch barcode ZPL: ' + err.message);
        this.isLoading.set(false);
      }
    });
  }

  private renderBarcodeImage(zpl: string) {
    // Encode ZPL for URL
    console.log('Rendering barcode image with ZPL');
    const encodedZPL = encodeURIComponent(zpl);
    // Use CORS proxy to bypass CORS issues
    console.log(`https://api.labelary.com/v1/printers/8dpmm/labels/3x1/0/${encodedZPL}`)
    const labelaryUrl = `https://api.labelary.com/v1/printers/8dpmm/labels/3x1/0/${encodedZPL}`;

    console.log('Generated Labelary URL (length: ' + labelaryUrl.length + ')');
    this.barcodeImageUrl.set(labelaryUrl);
    // Don't set isLoading to false here - wait for image to actually load
  }

  onImageLoad() {
    console.log('Barcode image loaded successfully');
    this.isLoading.set(false);
  }

  onImageError() {
    console.error('Failed to load barcode image');
    this.error.set('Failed to load barcode image from Labelary');
    this.isLoading.set(false);
  }
}
