import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { InventoryService } from '../../../services/inventory.service';
import { BarcodeHistoryService } from '../../../services/history.service';
import { BarcodeTag } from '../../inventory/barcode-tag/barcode-tag';
import { KitLineDialog } from '../kit-line-dialog/kit-line-dialog';
import { Part } from '../../../models';
import { PartLink } from '../../common/part-link/part-link';

@Component({
  selector: 'app-build-view',
  standalone: true,
  imports: [
    CommonModule,
    DatePipe,
    MatCardModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    BarcodeTag,
    PartLink,
  ],
  templateUrl: './build-view.html',
  styleUrl: './build-view.css',
})
export class BuildView implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private inventoryService = inject(InventoryService);
  private historyService = inject(BarcodeHistoryService);
  private dialog = inject(MatDialog);

  barcodeId: number | null = null;
  isLoading = signal(true);
  traceInfo = signal<any>(null);
  partInfo = signal<Part | null>(null);
  kitStatus = signal<{ status: string; bomLines: any[] } | null>(null);
  createdBy = signal<string | null>(null);
  bomColumns = ['partName', 'requiredQty', 'kittedQty', 'status', 'actions'];

  // Part images keyed by partID
  partImages = signal<Record<number, number>>({});

  overallStatus = computed(() => this.kitStatus()?.status || 'partial');
  fulfilledCount = computed(() => {
    const lines = this.kitStatus()?.bomLines || [];
    return lines.filter(l => l.kittedQty >= l.requiredQty).length;
  });

  ngOnInit() {
    this.route.params.subscribe(params => {
      this.barcodeId = parseInt(params['barcodeId']);
      if (this.barcodeId) {
        this.loadBuildData();
      }
    });
  }

  loadBuildData() {
    if (!this.barcodeId) return;

    this.inventoryService.getTagById(this.barcodeId).subscribe({
      next: (tag) => {
        this.traceInfo.set(tag);
        if (tag.partID) {
          this.inventoryService.getPartById(tag.partID).subscribe({
            next: (part) => {
              this.partInfo.set(part);
              if (part.imageFile?.id) {
                this.partImages.update(m => ({ ...m, [part.id]: part.imageFile!.id }));
              }
            }
          });
        }
        this.loadCreatedBy();
        this.loadKitStatus();
      },
      error: () => {
        this.isLoading.set(false);
      }
    });
  }

  private loadCreatedBy() {
    if (!this.barcodeId) return;

    this.historyService.getBarcodeHistory(this.barcodeId).subscribe({
      next: (history) => {
        const created = history.find(h => h.actionType?.code === 'CREATED');
        if (created?.user?.displayName) {
          this.createdBy.set(created.user.displayName);
        }
      }
    });
  }

  loadKitStatus() {
    if (!this.barcodeId) return;

    this.inventoryService.getKitStatus(this.barcodeId).subscribe({
      next: (status) => {
        this.kitStatus.set(status);
        this.isLoading.set(false);
        this.loadBomPartImages(status.bomLines);
      },
      error: () => {
        this.isLoading.set(false);
      }
    });
  }

  private loadBomPartImages(bomLines: any[]) {
    const partIds = bomLines.map(l => l.partID).filter(id => !this.partImages()[id]);
    for (const partId of partIds) {
      this.inventoryService.getPartById(partId).subscribe({
        next: (part) => {
          if (part.imageFile?.id) {
            this.partImages.update(m => ({ ...m, [part.id]: part.imageFile!.id }));
          }
        }
      });
    }
  }

  openKitDialog(line: any) {
    const dialogRef = this.dialog.open(KitLineDialog, {
      data: {
        kitBarcodeId: this.barcodeId,
        partName: line.partName,
        requiredQty: line.requiredQty,
        kittedQty: line.kittedQty,
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result?.success) {
        this.loadKitStatus();
      }
    });
  }

  getLineStatus(line: any): string {
    if (line.kittedQty >= line.requiredQty) return 'fulfilled';
    if (line.kittedQty > 0) return 'partial';
    return 'empty';
  }

  goBack() {
    this.router.navigate(['/kits']);
  }
}
