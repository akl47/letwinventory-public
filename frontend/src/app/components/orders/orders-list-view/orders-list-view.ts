import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
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
import { MatMenuModule } from '@angular/material/menu';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialog } from '@angular/material/dialog';
import { FormsModule } from '@angular/forms';
import { InventoryService } from '../../../services/inventory.service';
import { Order, OrderStatus } from '../../../models';
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
    MatMenuModule,
    MatCheckboxModule,
    MatDividerModule,
    FormsModule
  ],
  templateUrl: './orders-list-view.html',
  styleUrl: './orders-list-view.css'
})
export class OrdersListView implements OnInit {
  private inventoryService = inject(InventoryService);
  private errorNotification = inject(ErrorNotificationService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private dialog = inject(MatDialog);

  allOrders = signal<Order[]>([]);
  displayedOrders = signal<Order[]>([]);
  searchText = signal<string>('');
  showInactive = signal<boolean>(false);

  // Status filter
  statuses = signal<OrderStatus[]>([]);
  selectedStatusIds = signal<Set<number>>(new Set());

  displayedColumns: string[] = ['orderID', 'vendor', 'description', 'placedDate', 'status', 'itemCount', 'totalPrice'];

  // Pagination
  pageSize = signal<number>(25);
  pageIndex = signal<number>(0);
  pageSizeOptions = [10, 25, 50, 100];

  // Sorting
  sortColumn = signal<string>('placedDate');
  sortDirection = signal<'asc' | 'desc'>('desc');

  // Computed: check if all statuses are selected
  allStatusesSelected = computed(() => {
    const sts = this.statuses();
    const selected = this.selectedStatusIds();
    return sts.length > 0 && sts.every(s => selected.has(s.id));
  });

  // Computed: check if some but not all statuses are selected
  someStatusesSelected = computed(() => {
    const sts = this.statuses();
    const selected = this.selectedStatusIds();
    const selectedCount = sts.filter(s => selected.has(s.id)).length;
    return selectedCount > 0 && selectedCount < sts.length;
  });

  // Computed: count of hidden statuses (for filter indicator)
  hiddenStatusCount = computed(() => {
    const sts = this.statuses();
    const selected = this.selectedStatusIds();
    return sts.filter(s => !selected.has(s.id)).length;
  });

  private initializedFromQuery = false;

  ngOnInit() {
    this.loadOrders();
  }

  loadOrders() {
    this.inventoryService.getOrderStatuses().subscribe({
      next: (statuses) => {
        this.statuses.set(statuses);
        this.selectedStatusIds.set(new Set(statuses.map(s => s.id)));
        this.applyQueryParams();
        this.fetchOrders();
      },
      error: (err) => {
        this.errorNotification.showHttpError(err, 'Error loading order statuses');
        this.applyQueryParams();
        this.fetchOrders();
      }
    });
  }

  private applyQueryParams() {
    const params = this.route.snapshot.queryParams;
    if (params['search']) this.searchText.set(params['search']);
    if (params['inactive'] === 'true') this.showInactive.set(true);
    if (params['sort']) this.sortColumn.set(params['sort']);
    if (params['dir'] === 'asc' || params['dir'] === 'desc') this.sortDirection.set(params['dir']);
    if (params['page']) this.pageIndex.set(parseInt(params['page'], 10) || 0);
    if (params['pageSize']) this.pageSize.set(parseInt(params['pageSize'], 10) || 25);
    if (params['statuses']) {
      const ids = params['statuses'].split(',').map((s: string) => parseInt(s, 10)).filter((n: number) => !isNaN(n));
      this.selectedStatusIds.set(new Set(ids));
    }
    this.initializedFromQuery = true;
  }

  private updateQueryParams() {
    if (!this.initializedFromQuery) return;
    const params: Record<string, string> = {};
    const search = this.searchText();
    if (search) params['search'] = search;
    if (this.showInactive()) params['inactive'] = 'true';
    const sortCol = this.sortColumn();
    const sortDir = this.sortDirection();
    if (sortCol !== 'placedDate' || sortDir !== 'desc') {
      params['sort'] = sortCol;
      params['dir'] = sortDir;
    }
    if (this.pageIndex() > 0) params['page'] = String(this.pageIndex());
    if (this.pageSize() !== 25) params['pageSize'] = String(this.pageSize());
    // Only include statuses param if not all selected
    const allStatuses = this.statuses();
    const selected = this.selectedStatusIds();
    if (allStatuses.length > 0 && selected.size < allStatuses.length) {
      params['statuses'] = Array.from(selected).join(',');
    }
    this.router.navigate([], { relativeTo: this.route, queryParams: params, replaceUrl: true });
  }

  fetchOrders() {
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

    // Filter by status
    const selectedStatuses = this.selectedStatusIds();
    if (selectedStatuses.size === 0) {
      filtered = [];
    } else if (selectedStatuses.size < this.statuses().length) {
      filtered = filtered.filter(order => selectedStatuses.has(order.orderStatusID));
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
    this.updateQueryParams();
  }

  onPageChange(event: PageEvent) {
    this.pageIndex.set(event.pageIndex);
    this.pageSize.set(event.pageSize);
    this.applyFiltersAndSort();
    this.updateQueryParams();
  }

  onSortChange(sort: Sort) {
    this.sortColumn.set(sort.active);
    this.sortDirection.set(sort.direction as 'asc' | 'desc' || 'asc');
    this.applyFiltersAndSort();
    this.updateQueryParams();
  }

  onToggleInactive(checked: boolean) {
    this.showInactive.set(checked);
    this.pageIndex.set(0);
    this.applyFiltersAndSort();
    this.updateQueryParams();
  }

  // Status filter methods
  isStatusSelected(statusId: number): boolean {
    return this.selectedStatusIds().has(statusId);
  }

  toggleStatus(statusId: number): void {
    const current = this.selectedStatusIds();
    const newSet = new Set(current);
    if (newSet.has(statusId)) {
      newSet.delete(statusId);
    } else {
      newSet.add(statusId);
    }
    this.selectedStatusIds.set(newSet);
    this.pageIndex.set(0);
    this.applyFiltersAndSort();
    this.updateQueryParams();
  }

  toggleAllStatuses(): void {
    const sts = this.statuses();
    if (this.allStatusesSelected()) {
      this.selectedStatusIds.set(new Set());
    } else {
      this.selectedStatusIds.set(new Set(sts.map(s => s.id)));
    }
    this.pageIndex.set(0);
    this.applyFiltersAndSort();
    this.updateQueryParams();
  }

  getTotalCount(): number {
    let filtered = [...this.allOrders()];
    if (!this.showInactive()) {
      filtered = filtered.filter(order => order.activeFlag === true);
    }
    const selectedStatuses = this.selectedStatusIds();
    if (selectedStatuses.size === 0) {
      filtered = [];
    } else if (selectedStatuses.size < this.statuses().length) {
      filtered = filtered.filter(order => selectedStatuses.has(order.orderStatusID));
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

  openBulkUpload() {
    this.router.navigate(['/orders/bulk-upload']);
  }

  openOrderLink(link: string) {
    window.open(link, '_blank');
  }
}
