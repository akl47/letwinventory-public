import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { FormsModule } from '@angular/forms';
import { InventoryService } from '../../../services/inventory.service';
import { Order } from '../../../models';
import { ErrorNotificationService } from '../../../services/error-notification.service';
import { OrderEditDialog } from '../order-edit-dialog/order-edit-dialog';

@Component({
  selector: 'app-orders-list-view',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatPaginatorModule,
    MatSortModule,
    MatInputModule,
    MatFormFieldModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatSlideToggleModule,
    MatChipsModule,
    FormsModule
  ],
  templateUrl: './orders-list-view.html',
  styleUrl: './orders-list-view.css'
})
export class OrdersListView implements OnInit {
  private inventoryService = inject(InventoryService);
  private errorNotification = inject(ErrorNotificationService);
  private router = inject(Router);
  private dialog = inject(MatDialog);

  allOrders = signal<Order[]>([]);
  displayedOrders = signal<Order[]>([]);
  searchText = signal<string>('');
  showInactive = signal<boolean>(false);
  hideReceived = signal<boolean>(false);

  displayedColumns: string[] = ['orderID', 'vendor', 'placedDate', 'status', 'itemCount', 'totalPrice'];

  // Pagination
  pageSize = signal<number>(25);
  pageIndex = signal<number>(0);
  pageSizeOptions = [10, 25, 50, 100];

  // Sorting
  sortColumn = signal<string>('placedDate');
  sortDirection = signal<'asc' | 'desc'>('desc');

  ngOnInit() {
    this.loadOrders();
  }

  loadOrders() {
    this.inventoryService.getAllOrders().subscribe({
      next: (orders) => {
        this.allOrders.set(orders);
        this.applyFiltersAndSort();
      },
      error: (err) => {
        this.errorNotification.showHttpError(err, 'Error loading orders');
      }
    });
  }

  applyFiltersAndSort() {
    let filtered = [...this.allOrders()];

    // Filter by active flag
    if (!this.showInactive()) {
      filtered = filtered.filter(order => order.activeFlag === true);
    }

    // Filter out received orders if hideReceived is enabled
    if (this.hideReceived()) {
      filtered = filtered.filter(order => order.orderStatusID !== 4);
    }

    // Apply search filter
    const search = this.searchText().toLowerCase();
    if (search) {
      filtered = filtered.filter(order =>
        order.id?.toString().includes(search) ||
        order.vendor?.toLowerCase().includes(search) ||
        order.description?.toLowerCase().includes(search) ||
        order.OrderStatus?.name.toLowerCase().includes(search)
      );
    }

    // Apply sorting
    const sortCol = this.sortColumn();
    const sortDir = this.sortDirection();
    filtered.sort((a, b) => {
      let aVal, bVal;
      if (sortCol === 'status') {
        aVal = a.OrderStatus?.name || '';
        bVal = b.OrderStatus?.name || '';
      } else {
        aVal = (a as any)[sortCol];
        bVal = (b as any)[sortCol];
      }
      const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortDir === 'asc' ? comparison : -comparison;
    });

    // Apply pagination
    const startIndex = this.pageIndex() * this.pageSize();
    const endIndex = startIndex + this.pageSize();
    this.displayedOrders.set(filtered.slice(startIndex, endIndex));
  }

  onSearchChange(value: string) {
    this.searchText.set(value);
    this.pageIndex.set(0);
    this.applyFiltersAndSort();
  }

  onPageChange(event: PageEvent) {
    this.pageIndex.set(event.pageIndex);
    this.pageSize.set(event.pageSize);
    this.applyFiltersAndSort();
  }

  onSortChange(sort: Sort) {
    this.sortColumn.set(sort.active);
    this.sortDirection.set(sort.direction as 'asc' | 'desc' || 'asc');
    this.applyFiltersAndSort();
  }

  onToggleInactive(checked: boolean) {
    this.showInactive.set(checked);
    this.pageIndex.set(0);
    this.applyFiltersAndSort();
  }

  onToggleHideReceived(checked: boolean) {
    this.hideReceived.set(checked);
    this.pageIndex.set(0);
    this.applyFiltersAndSort();
  }

  getTotalCount(): number {
    let filtered = [...this.allOrders()];
    if (!this.showInactive()) {
      filtered = filtered.filter(order => order.activeFlag === true);
    }
    if (this.hideReceived()) {
      filtered = filtered.filter(order => order.orderStatusID !== 4);
    }
    const search = this.searchText().toLowerCase();
    if (search) {
      filtered = filtered.filter(order =>
        order.id?.toString().includes(search) ||
        order.vendor?.toLowerCase().includes(search) ||
        order.description?.toLowerCase().includes(search) ||
        order.OrderStatus?.name.toLowerCase().includes(search)
      );
    }
    return filtered.length;
  }

  getStatusClass(statusName: string): string {
    switch (statusName) {
      case 'Pending': return 'status-pending';
      case 'Placed': return 'status-placed';
      case 'Shipped': return 'status-shipped';
      case 'Received': return 'status-received';
      default: return '';
    }
  }

  getContrastColor(hexColor: string): string {
    // Remove # if present
    const hex = hexColor.replace('#', '');

    // Convert to RGB
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);

    // Calculate relative luminance
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    // Return black for light backgrounds, white for dark backgrounds
    return luminance > 0.5 ? '#000000' : '#ffffff';
  }

  calculateItemCount(order: Order): number {
    return order.OrderItems?.filter(item => item.activeFlag).length || 0;
  }

  calculateTotalPrice(order: Order): number {
    return order.OrderItems?.filter(item => item.activeFlag)
      .reduce((sum, item) => {
        const price = typeof item.price === 'string' ? parseFloat(item.price) : item.price;
        return sum + (item.quantity * price);
      }, 0) || 0;
  }

  viewOrder(order: Order) {
    this.router.navigate(['/orders', order.id]);
  }

  createNewOrder() {
    const dialogRef = this.dialog.open(OrderEditDialog, {
      width: '600px',
      data: {}
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result && result.id) {
        // Order was created, navigate to the detail view
        this.router.navigate(['/orders', result.id]);
      } else if (result) {
        // Order was created, reload the list
        this.loadOrders();
      }
    });
  }

  openOrderLink(link: string) {
    window.open(link, '_blank');
  }
}
