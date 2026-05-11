import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { InventoryService } from '../../../services/inventory.service';
import { AuthService } from '../../../services/auth.service';
import { Order, OrderStatus } from '../../../models';
import { ErrorNotificationService } from '../../../services/error-notification.service';
import { OrderEditDialog } from '../order-edit-dialog/order-edit-dialog';
import { DataTable, DataTableColumnDef, ColumnDef, FilterSection } from '../../common/data-table/data-table';
import { CategoryBadge } from '../../common/category-badge/category-badge';

@Component({
  selector: 'app-orders-list-view',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    DataTable,
    DataTableColumnDef,
    CategoryBadge,
  ],
  templateUrl: './orders-list-view.html',
  styleUrl: './orders-list-view.css',
})
export class OrdersListView implements OnInit {
  private inventoryService = inject(InventoryService);
  private authService = inject(AuthService);
  private errorNotification = inject(ErrorNotificationService);
  private router = inject(Router);
  private dialog = inject(MatDialog);
  canWrite = computed(() => this.authService.hasPermission('orders', 'write'));

  allOrders = signal<Order[]>([]);
  statuses = signal<OrderStatus[]>([]);
  statusesLoaded = signal<boolean>(false);

  columns: ColumnDef<Order>[] = [
    { key: 'orderID', header: 'Order #', sortable: true, sortValue: o => o.id },
    { key: 'vendor', header: 'Vendor', sortable: true },
    { key: 'description', header: 'Description', sortable: true },
    { key: 'placedDate', header: 'Placed Date', sortable: true, sortValue: o => o.placedDate ? new Date(o.placedDate).getTime() : null },
    { key: 'status', header: 'Status', sortable: true, sortValue: o => o.OrderStatus?.name?.toLowerCase() ?? null },
    { key: 'itemCount', header: 'Items' },
    { key: 'totalPrice', header: 'Total' },
    { key: 'actions', header: 'Actions' },
  ];

  filterSections = computed<FilterSection<Order>[]>(() => [
    {
      type: 'multiSelect',
      key: 'statuses',
      label: 'Status',
      options: this.statuses().map(s => ({
        id: s.id,
        label: s.name,
        colorHex: s.tagColor || '#808080',
      })),
      accessor: (o: Order) => o.orderStatusID,
    },
    {
      type: 'toggle',
      key: 'inactive',
      label: 'Show Inactive',
      default: false,
      predicate: (o, on) => on || o.activeFlag === true,
    },
  ]);

  searchKeys = ['id', 'vendor', 'description', 'OrderStatus.name'];

  ngOnInit() {
    this.loadOrders();
  }

  loadOrders() {
    this.inventoryService.getOrderStatuses().subscribe({
      next: (statuses) => {
        this.statuses.set(statuses);
        this.statusesLoaded.set(true);
        this.fetchOrders();
      },
      error: (err) => {
        this.errorNotification.showHttpError(err, 'Error loading order statuses');
        this.statusesLoaded.set(true);
        this.fetchOrders();
      },
    });
  }

  fetchOrders() {
    this.inventoryService.getAllOrders().subscribe({
      next: (orders) => this.allOrders.set(orders),
      error: (err) => this.errorNotification.showHttpError(err, 'Error loading orders'),
    });
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

  rowHref = (o: Order) => `/orders/${o.id}`;

  createNewOrder() {
    const dialogRef = this.dialog.open(OrderEditDialog, { width: '600px', data: {} });
    dialogRef.afterClosed().subscribe(result => {
      if (result && result.id) {
        this.router.navigate(['/orders', result.id]);
      } else if (result) {
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
