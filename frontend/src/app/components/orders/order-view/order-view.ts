import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, FormsModule, Validators } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { InventoryService } from '../../../services/inventory.service';
import { Order, OrderItem, Part } from '../../../models';
import { ErrorNotificationService } from '../../../services/error-notification.service';
import { OrderItemDialog } from '../order-item-dialog/order-item-dialog';

@Component({
  selector: 'app-order-view',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    DragDropModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatTableModule,
    MatTooltipModule,
  ],
  templateUrl: './order-view.html',
  styleUrl: './order-view.css'
})
export class OrderView implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private fb = inject(FormBuilder);
  private inventoryService = inject(InventoryService);
  private errorNotification = inject(ErrorNotificationService);
  private dialog = inject(MatDialog);

  orderId = signal<number | null>(null);
  orderID = signal<number | null>(null);
  isEditMode = signal<boolean>(false);
  isFormEditMode = signal<boolean>(false);
  orderItems = signal<OrderItem[]>([]);
  currentOrder = signal<Order | null>(null);
  parts = signal<Part[]>([]);

  // Inline editing signals
  editingItemId = signal<number | null>(null);
  editingQuantity = 1;
  editingPrice = 0;
  editingLineTypeId = 1;
  editingPartId: number | null = null;
  editingDescription = '';

  orderStatuses = signal([
    { id: 1, name: 'Pending' },
    { id: 2, name: 'Placed' },
    { id: 3, name: 'Shipped' },
    { id: 4, name: 'Received' }
  ]);

  orderLineTypes = signal([
    { id: 1, name: 'Part' },
    { id: 2, name: 'Shipping' },
    { id: 3, name: 'Taxes' },
    { id: 4, name: 'Services' },
    { id: 5, name: 'Other' }
  ]);

  get displayedColumns(): string[] {
    if (this.isFormEditMode()) {
      return ['dragHandle', 'lineNumber', 'lineType', 'part', 'quantity', 'price', 'total', 'actions'];
    }
    return ['lineNumber', 'lineType', 'part', 'quantity', 'price', 'total'];
  }

  form = this.fb.group({
    placedDate: [new Date(), Validators.required],
    receivedDate: [null as Date | null],
    orderStatusID: [1, Validators.required],
    vendor: [''],
    trackingNumber: [''],
    link: [''],
    description: ['']
  });

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id === 'new') {
      this.isEditMode.set(false);
    } else {
      this.orderId.set(Number(id));
      this.isEditMode.set(true);
      this.loadOrder();
    }

    // Load parts for part selector
    this.loadParts();
  }

  loadParts() {
    this.inventoryService.getAllParts().subscribe({
      next: (parts) => {
        this.parts.set(parts);
      },
      error: (err) => {
        this.errorNotification.showHttpError(err, 'Error loading parts');
      }
    });
  }

  loadOrder() {
    const id = this.orderId();
    if (!id) return;

    this.inventoryService.getOrderById(id).subscribe({
      next: (order) => {
        this.currentOrder.set(order);
        this.orderID.set(order.id);
        this.form.patchValue({
          placedDate: order.placedDate ? new Date(order.placedDate) : new Date(),
          receivedDate: order.receivedDate ? new Date(order.receivedDate) : null,
          orderStatusID: order.orderStatusID,
          vendor: order.vendor,
          trackingNumber: order.trackingNumber,
          link: order.link,
          description: order.description
        });
        this.orderItems.set(order.OrderItems || []);
        this.isFormEditMode.set(false);
      },
      error: (err) => {
        this.errorNotification.showHttpError(err, 'Error loading order');
        this.router.navigate(['/orders']);
      }
    });
  }

  enableEdit() {
    this.isFormEditMode.set(true);
  }

  cancelEdit() {
    this.isFormEditMode.set(false);
    this.loadOrder();
  }

  save() {
    if (!this.form.valid) {
      this.errorNotification.showError('Please fill in all required fields');
      return;
    }

    const formValue = this.form.value;
    const orderData = {
      placedDate: formValue.placedDate?.toISOString(),
      receivedDate: formValue.receivedDate?.toISOString() || null,
      orderStatusID: formValue.orderStatusID!,
      vendor: formValue.vendor || null,
      trackingNumber: formValue.trackingNumber || null,
      link: formValue.link || null,
      description: formValue.description
    };

    if (this.isEditMode() && this.orderId()) {
      this.inventoryService.updateOrder(this.orderId()!, orderData).subscribe({
        next: () => {
          this.errorNotification.showSuccess('Order updated successfully');
          this.loadOrder();
        },
        error: (err) => {
          this.errorNotification.showHttpError(err, 'Failed to update order');
        }
      });
    } else {
      this.inventoryService.createOrder(orderData).subscribe({
        next: (order) => {
          this.errorNotification.showSuccess('Order created successfully');
          this.router.navigate(['/orders', order.id]);
        },
        error: (err) => {
          this.errorNotification.showHttpError(err, 'Failed to create order');
        }
      });
    }
  }

  delete() {
    const id = this.orderId();
    if (!id) return;

    const confirmed = confirm('Are you sure you want to delete this order?');
    if (!confirmed) return;

    this.inventoryService.deleteOrder(id).subscribe({
      next: () => {
        this.errorNotification.showSuccess('Order deleted successfully');
        this.router.navigate(['/orders']);
      },
      error: (err) => {
        this.errorNotification.showHttpError(err, 'Failed to delete order');
      }
    });
  }

  goBack() {
    this.router.navigate(['/orders']);
  }

  getPrice(item: OrderItem): number {
    if (item.price == null) return 0;
    return typeof item.price === 'string' ? parseFloat(item.price) : item.price;
  }

  calculateLineTotal(item: OrderItem): number {
    return item.quantity * this.getPrice(item);
  }

  calculateOrderTotal(): number {
    return this.orderItems().reduce((sum, item) => sum + this.calculateLineTotal(item), 0);
  }

  getTotalQuantity(): number {
    return this.orderItems().reduce((sum, item) => sum + item.quantity, 0);
  }

  getStatusName(statusId: number): string {
    return this.orderStatuses().find(s => s.id === statusId)?.name || '';
  }

  formatDate(date: string | null): string {
    if (!date) return '-';
    return new Date(date).toLocaleDateString();
  }

  addLineItem() {
    const orderIDValue = this.orderID();
    if (!orderIDValue) {
      this.errorNotification.showError('Please save the order first before adding line items');
      return;
    }

    const dialogRef = this.dialog.open(OrderItemDialog, {
      width: '600px',
      data: { orderID: orderIDValue }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.loadOrder();
      }
    });
  }

  editLineItem(item: OrderItem) {
    const dialogRef = this.dialog.open(OrderItemDialog, {
      width: '600px',
      data: { orderID: item.orderID, orderItem: item }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.loadOrder();
      }
    });
  }

  deleteLineItem(item: OrderItem) {
    const confirmed = confirm('Delete this line item?');
    if (!confirmed) return;

    this.inventoryService.deleteOrderItem(item.id).subscribe({
      next: () => {
        this.errorNotification.showSuccess('Line item deleted');
        this.loadOrder();
      },
      error: (err) => {
        this.errorNotification.showHttpError(err, 'Failed to delete line item');
      }
    });
  }

  startEditLineItem(item: OrderItem) {
    this.editingItemId.set(item.id);
    this.editingQuantity = item.quantity;
    this.editingPrice = this.getPrice(item);
    this.editingLineTypeId = item.orderLineTypeID;
    this.editingPartId = item.partID;
    this.editingDescription = item.name || '';
  }

  saveLineItem(item: OrderItem) {
    if (this.editingQuantity < 1) {
      this.errorNotification.showError('Quantity must be at least 1');
      return;
    }

    if (this.editingPrice < 0) {
      this.errorNotification.showError('Price cannot be negative');
      return;
    }

    const updateData: any = {
      quantity: this.editingQuantity,
      price: this.editingPrice,
      orderLineTypeID: this.editingLineTypeId
    };

    // If line type is Part (id=1), set partID and clear name
    // Otherwise, set name and clear partID
    if (this.editingLineTypeId === 1) {
      updateData.partID = this.editingPartId;
      updateData.name = null;
    } else {
      updateData.partID = null;
      updateData.name = this.editingDescription;
    }

    this.inventoryService.updateOrderItem(item.id, updateData).subscribe({
      next: () => {
        this.errorNotification.showSuccess('Line item updated');
        this.editingItemId.set(null);
        this.loadOrder();
      },
      error: (err) => {
        this.errorNotification.showHttpError(err, 'Failed to update line item');
      }
    });
  }

  cancelLineItemEdit() {
    this.editingItemId.set(null);
  }

  dropLineItem(event: CdkDragDrop<OrderItem[]>) {
    const items = [...this.orderItems()];
    moveItemInArray(items, event.previousIndex, event.currentIndex);

    // Update line numbers for all items
    const updates = items.map((item, index) => ({
      id: item.id,
      lineNumber: index + 1,
      item: { ...item, lineNumber: index + 1 }
    }));

    // Update the local state immediately for better UX
    const updatedItems = updates.map(u => u.item);
    this.orderItems.set(updatedItems);

    // Send updates to backend
    const updatePromises = updates.map(update =>
      this.inventoryService.updateOrderItem(update.id, { lineNumber: update.lineNumber }).toPromise()
    );

    Promise.all(updatePromises).then(() => {
      this.errorNotification.showSuccess('Line items reordered');
      // Don't reload - just keep the updated state and stay in edit mode
    }).catch(err => {
      this.errorNotification.showError('Failed to reorder line items');
      // Reload to reset to original order if the update failed
      this.loadOrder();
    });
  }
}
