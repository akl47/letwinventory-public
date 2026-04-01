import { Component, OnInit, OnDestroy, inject, ChangeDetectorRef, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Location } from '@angular/common';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { Subscription } from 'rxjs';
import { BarcodeHistoryService, BarcodeHistory } from '../../../services/history.service';
import { InventoryService } from '../../../services/inventory.service';
import { BarcodeMovementDialog, BarcodeActionType, BarcodeMovementDialogResult } from '../barcode-movement-dialog/barcode-movement-dialog';
import { BarcodeTag } from '../barcode-tag/barcode-tag';

@Component({
  selector: 'app-barcode-history',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatPaginatorModule,
    MatSortModule,
    MatInputModule,
    MatFormFieldModule,
    MatTooltipModule,
    BarcodeTag
  ],
  templateUrl: './barcode-history.html',
  styleUrl: './barcode-history.css',
})
export class BarcodeHistoryComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private barcodeHistoryService = inject(BarcodeHistoryService);
  private inventoryService = inject(InventoryService);
  private cdr = inject(ChangeDetectorRef);
  private dialog = inject(MatDialog);
  private paramSubscription?: Subscription;

  barcodeId: number | null = null;
  barcodeInfo: any = null;
  allHistory = signal<BarcodeHistory[]>([]);
  filteredHistory = signal<BarcodeHistory[]>([]);
  displayedHistory = signal<BarcodeHistory[]>([]);
  displayedColumns: string[] = ['action', 'from', 'to', 'user', 'date'];

  // Pagination
  pageSize = signal<number>(25);
  pageIndex = signal<number>(0);
  pageSizeOptions = [10, 25, 50, 100];

  // Sorting
  sortDirection = signal<'asc' | 'desc'>('desc');

  // Search
  searchText = signal<string>('');

  // Barcode type
  isTrace = signal<boolean>(false);

  isLoading = true;
  error: string | null = null;

  ngOnInit() {
    // Subscribe to route param changes to handle navigation to different barcodes
    this.paramSubscription = this.route.paramMap.subscribe(params => {
      const idParam = params.get('id');
      if (idParam) {
        this.barcodeId = parseInt(idParam, 10);
        this.loadData();
      } else {
        this.error = 'No barcode ID provided';
        this.isLoading = false;
      }
    });
  }

  ngOnDestroy() {
    this.paramSubscription?.unsubscribe();
  }

  loadData() {
    this.isLoading = true;

    // Load current barcode's tag info
    this.inventoryService.getTagById(this.barcodeId!, true).subscribe({
      next: (tag) => {
        this.barcodeInfo = tag;

        // Set columns based on barcode type - show trace columns only for traces
        const isTraceBarcode = tag.type === 'Trace';
        this.isTrace.set(isTraceBarcode);
        if (isTraceBarcode) {
          this.displayedColumns = ['action', 'qty', 'serialNumber', 'lotNumber', 'from', 'to', 'user', 'date'];
        } else {
          this.displayedColumns = ['action', 'from', 'to', 'user', 'date'];
        }

        // Load history for this barcode
        this.loadHistory();
      },
      error: (err) => {
        this.error = 'Failed to load barcode info: ' + err.message;
        this.isLoading = false;
      }
    });
  }

  loadHistory() {
    if (!this.barcodeId) {
      this.isLoading = false;
      return;
    }

    this.barcodeHistoryService.getBarcodeHistory(this.barcodeId).subscribe({
      next: (history) => {
        this.allHistory.set(history);
        this.applyFiltersAndSort();
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.error = 'Failed to load history: ' + err.message;
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  applyFiltersAndSort() {
    let filtered = [...this.allHistory()];

    // Apply search filter
    const search = this.searchText().toLowerCase();
    if (search) {
      filtered = filtered.filter(item =>
        item.actionType?.label?.toLowerCase().includes(search) ||
        item.actionType?.code?.toLowerCase().includes(search) ||
        item.user?.displayName?.toLowerCase().includes(search) ||
        item.serialNumber?.toLowerCase().includes(search) ||
        item.lotNumber?.toLowerCase().includes(search) ||
        item.fromBarcode?.barcode?.toLowerCase().includes(search) ||
        item.toBarcode?.barcode?.toLowerCase().includes(search)
      );
    }

    // Apply sorting by date
    const sortDir = this.sortDirection();
    filtered.sort((a, b) => {
      const aDate = new Date(a.createdAt).getTime();
      const bDate = new Date(b.createdAt).getTime();
      return sortDir === 'asc' ? aDate - bDate : bDate - aDate;
    });

    this.filteredHistory.set(filtered);

    // Apply pagination
    const startIndex = this.pageIndex() * this.pageSize();
    const endIndex = startIndex + this.pageSize();
    this.displayedHistory.set(filtered.slice(startIndex, endIndex));
  }

  onSearchChange(value: string) {
    this.searchText.set(value);
    this.pageIndex.set(0);
    this.applyFiltersAndSort();
  }

  onSortChange(sort: Sort) {
    if (sort.active === 'date') {
      this.sortDirection.set(sort.direction as 'asc' | 'desc' || 'desc');
      this.applyFiltersAndSort();
    }
  }

  toggleDateSort() {
    this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');
    this.applyFiltersAndSort();
  }

  onPageChange(event: PageEvent) {
    this.pageIndex.set(event.pageIndex);
    this.pageSize.set(event.pageSize);
    this.applyFiltersAndSort();
  }

  getTotalCount(): number {
    return this.filteredHistory().length;
  }

  goBack() {
    this.location.back();
  }

  // Action handlers
  openActionDialog(action: BarcodeActionType) {
    if (!this.barcodeId || !this.barcodeInfo) return;

    const dialogRef = this.dialog.open(BarcodeMovementDialog, {
      width: '450px',
      data: {
        action,
        barcodeId: this.barcodeId,
        barcode: this.barcodeInfo.barcode,
        isTrace: this.isTrace(),
        allowDecimal: this.barcodeInfo.allowDecimal ?? false
      }
    });

    dialogRef.afterClosed().subscribe((result: BarcodeMovementDialogResult) => {
      if (result?.success) {
        // Reload history after successful action
        this.loadHistory();
      }
    });
  }

  onMove() {
    this.openActionDialog('move');
  }

  onMerge() {
    this.openActionDialog('merge');
  }

  onSplit() {
    this.openActionDialog('split');
  }

  onAdjust() {
    this.openActionDialog('adjust');
  }

  onKit() {
    this.openActionDialog('kit');
  }

  onDelete() {
    this.openActionDialog('delete');
  }

  getActionLabel(item: BarcodeHistory): string {
    const actionCode = item.actionType?.code;
    switch (actionCode) {
      case 'CREATED': return 'Created';
      case 'MOVED': return 'Moved';
      case 'RECEIVED': return 'Received';
      case 'SPLIT': return 'Split';
      case 'MERGED': return 'Merged';
      case 'DELETED': return 'Deleted';
      case 'ADJUSTED': return 'Adjusted';
      case 'KITTED': return 'Kitted';
      case 'UNKITTED': return 'Unkitted';
      default: return item.actionType?.label || 'Unknown Action';
    }
  }

  getActionIcon(item: BarcodeHistory): string {
    const actionCode = item.actionType?.code;
    switch (actionCode) {
      case 'CREATED': return 'add_circle';
      case 'MOVED': return 'swap_horiz';
      case 'RECEIVED': return 'inventory';
      case 'SPLIT': return 'call_split';
      case 'MERGED': return 'call_merge';
      case 'DELETED': return 'delete';
      case 'ADJUSTED': return 'tune';
      case 'KITTED': return 'inventory_2';
      case 'UNKITTED': return 'output';
      default: return 'history';
    }
  }

  getLocationLabel(item: BarcodeHistory, type: 'from' | 'to'): string {
    const bc = type === 'from' ? item.fromBarcode : item.toBarcode;
    if (!bc) return 'None';
    return bc.barcode;
  }
}
