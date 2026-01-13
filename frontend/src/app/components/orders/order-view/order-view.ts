import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
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
import { ReceiveLineItemDialog, ReceiveLineItemDialogResult } from '../receive-line-item-dialog/receive-line-item-dialog';
import { BarcodeDialog } from '../../inventory/barcode-dialog/barcode-dialog';
import { BarcodeTag } from '../../inventory/barcode-tag/barcode-tag';

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
    BarcodeTag,
  ],
  templateUrl: './order-view.html',
  styleUrl: './order-view.css'
})
export class OrderView implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private fb = inject(FormBuilder);
  private inventoryService = inject(InventoryService);
  private errorNotification = inject(ErrorNotificationService);
  private dialog = inject(MatDialog);
  private paramSubscription?: Subscription;

  orderId = signal<number | null>(null);
  orderID = signal<number | null>(null);
  isEditMode = signal<boolean>(false);
  isFormEditMode = signal<boolean>(false);
  orderItems = signal<OrderItem[]>([]);
  currentOrder = signal<Order | null>(null);
  parts = signal<Part[]>([]);

  // Inline editing signals
  editingItemId = signal<number | null>(null);
  editingQuantity = signal<number>(1);
  editingPrice = signal<number>(0);
  editingLineTypeId = signal<number>(1);
  editingPartId = signal<number | null>(null);
  editingDescription = signal<string>('');

  // Receive mode signals
  isReceiveMode = signal<boolean>(false);
  receivingQuantities = signal<Map<number, number>>(new Map());

  orderStatuses = signal<any[]>([]);

  orderLineTypes = signal<any[]>([]);

  printers = signal<any[]>([]);

  hasNextStatus = computed(() => {
    const order = this.currentOrder();
    return order?.OrderStatus?.nextStatusID != null;
  });

  nextStatusName = computed(() => {
    const order = this.currentOrder();
    const nextStatusID = order?.OrderStatus?.nextStatusID;
    if (nextStatusID == null) return '';
    return this.orderStatuses().find(s => s.id === nextStatusID)?.name || '';
  });

  // Check if the order is in a state that can be received (Shipped or Partially Received)
  canReceive = computed(() => {
    const order = this.currentOrder();
    const statusId = order?.orderStatusID;
    return statusId === 3 || statusId === 5; // Shipped or Partially Received
  });

  // Check if we should show "Receive" button instead of "Mark as X"
  showReceiveButton = computed(() => {
    const order = this.currentOrder();
    return order?.orderStatusID === 3; // Shipped
  });

  get displayedColumns(): string[] {
    if (this.isFormEditMode()) {
      return ['dragHandle', 'lineNumber', 'lineType', 'part', 'quantity', 'price', 'total', 'actions'];
    }
    if (this.isReceiveMode()) {
      return ['lineNumber', 'lineType', 'part', 'barcode', 'ordered', 'received', 'remaining', 'actions'];
    }
    return ['lineNumber', 'lineType', 'part', 'barcode', 'quantity', 'received', 'price', 'total'];
  }

  form = this.fb.group({
    placedDate: [new Date(), Validators.required],
    receivedDate: [null as Date | null],
    orderStatusID: [1, Validators.required],
    vendor: [''],
    trackingNumber: [''],
    link: [''],
    description: [''],
    notes: ['']
  });

  ngOnInit() {
    // Load order statuses and line types from API
    this.inventoryService.getOrderStatuses().subscribe({
      next: (statuses) => {
        this.orderStatuses.set(statuses);
      },
      error: (err) => {
        this.errorNotification.showHttpError(err, 'Failed to load order statuses');
      }
    });

    this.inventoryService.getOrderLineTypes().subscribe({
      next: (lineTypes) => {
        this.orderLineTypes.set(lineTypes);
      },
      error: (err) => {
        this.errorNotification.showHttpError(err, 'Failed to load order line types');
      }
    });

    this.inventoryService.getPrinters().subscribe({
      next: (printers) => {
        this.printers.set(printers);
      },
      error: (err) => {
        this.errorNotification.showHttpError(err, 'Failed to load printers');
      }
    });

    // Subscribe to route param changes to handle navigation to different orders
    this.paramSubscription = this.route.paramMap.subscribe(params => {
      const id = params.get('id');
      if (id === 'new') {
        this.isEditMode.set(false);
        this.orderId.set(null);
        this.currentOrder.set(null);
        this.orderItems.set([]);
        this.form.reset({
          placedDate: new Date(),
          receivedDate: null,
          orderStatusID: 1,
          vendor: '',
          trackingNumber: '',
          link: '',
          description: '',
          notes: ''
        });
      } else {
        this.orderId.set(Number(id));
        this.isEditMode.set(true);
        this.loadOrder();
      }
    });

    // Load parts for part selector
    this.loadParts();
  }

  ngOnDestroy() {
    this.paramSubscription?.unsubscribe();
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

  loadOrder(preserveEditMode = false) {
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
          description: order.description,
          notes: order.notes
        });
        // Sort items by lineNumber to ensure correct order
        const sortedItems = (order.OrderItems || []).sort((a, b) => a.lineNumber - b.lineNumber);
        this.orderItems.set(sortedItems);
        if (!preserveEditMode) {
          this.isFormEditMode.set(false);
        }
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

    // If a line item is being edited, save it first
    const editingId = this.editingItemId();
    if (editingId !== null) {
      const editingItem = this.orderItems().find(item => item.id === editingId);
      if (editingItem) {
        // Validate the line item being edited
        // Convert to numbers in case they're strings
        const quantity = Number(this.editingQuantity());
        const price = Number(this.editingPrice());

        if (quantity < 1 || isNaN(quantity)) {
          this.errorNotification.showError('Quantity must be at least 1');
          return;
        }
        if (price < 0 || isNaN(price)) {
          this.errorNotification.showError('Price cannot be negative');
          return;
        }

        const updateData: any = {
          quantity: quantity,
          price: price,
          orderLineTypeID: this.editingLineTypeId()
        };

        if (this.editingLineTypeId() === 1) {
          updateData.partID = this.editingPartId();
          updateData.name = null;
        } else {
          updateData.partID = null;
          updateData.name = this.editingDescription();
        }

        // Save the line item first, then save the order
        this.inventoryService.updateOrderItem(editingId, updateData).subscribe({
          next: () => {
            this.editingItemId.set(null);
            this.saveOrder();
          },
          error: (err) => {
            this.errorNotification.showHttpError(err, 'Failed to save line item');
          }
        });
        return;
      }
    }

    // No line item being edited, proceed with saving the order
    this.saveOrder();
  }

  private saveOrder() {
    const formValue = this.form.value;
    const orderData = {
      placedDate: formValue.placedDate?.toISOString(),
      receivedDate: formValue.receivedDate?.toISOString() || null,
      orderStatusID: formValue.orderStatusID!,
      vendor: formValue.vendor || null,
      trackingNumber: formValue.trackingNumber || null,
      link: formValue.link || null,
      description: formValue.description,
      notes: formValue.notes || null
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

  moveToNextStatus() {
    const order = this.currentOrder();
    const nextStatusID = order?.OrderStatus?.nextStatusID;

    if (!order || !nextStatusID) {
      return;
    }

    // Preserve all existing order data, only update the status
    const orderData = {
      placedDate: order.placedDate,
      receivedDate: order.receivedDate,
      orderStatusID: nextStatusID,
      vendor: order.vendor,
      trackingNumber: order.trackingNumber,
      link: order.link,
      description: order.description,
      notes: order.notes
    };

    this.inventoryService.updateOrder(order.id, orderData).subscribe({
      next: () => {
        this.errorNotification.showSuccess('Order status updated successfully');
        this.loadOrder();
      },
      error: (err) => {
        this.errorNotification.showHttpError(err, 'Failed to update order status');
      }
    });
  }

  // Receive mode methods
  enterReceiveMode() {
    // Initialize receiving quantities with remaining quantities for Part line items
    const quantities = new Map<number, number>();
    this.orderItems().forEach(item => {
      // Only Part line items (id=1) can be received
      if (item.orderLineTypeID === 1) {
        const remaining = item.quantity - (item.receivedQuantity || 0);
        quantities.set(item.id, remaining);
      }
    });
    this.receivingQuantities.set(quantities);
    this.isReceiveMode.set(true);
  }

  cancelReceiveMode() {
    this.isReceiveMode.set(false);
    this.receivingQuantities.set(new Map());
  }

  updateReceivingQuantity(itemId: number, quantity: number) {
    const quantities = new Map(this.receivingQuantities());
    quantities.set(itemId, quantity);
    this.receivingQuantities.set(quantities);
  }

  getReceivingQuantity(itemId: number): number {
    return this.receivingQuantities().get(itemId) || 0;
  }

  getRemainingQuantity(item: OrderItem): number {
    return item.quantity - (item.receivedQuantity || 0);
  }

  receiveLineItem(item: OrderItem) {
    const remaining = this.getRemainingQuantity(item);
    if (remaining <= 0) {
      this.errorNotification.showError('This item is already fully received');
      return;
    }

    const dialogRef = this.dialog.open(ReceiveLineItemDialog, {
      width: '450px',
      data: {
        orderItem: item,
        remainingQuantity: remaining
      }
    });

    dialogRef.afterClosed().subscribe((result: ReceiveLineItemDialogResult) => {
      if (result?.success && item.partID) {
        const newReceivedQty = (item.receivedQuantity || 0) + result.receivedQuantity;

        // First create a trace (which creates a barcode)
        this.inventoryService.receiveOrderItem({
          partID: item.partID,
          quantity: result.receivedQuantity,
          parentBarcodeID: result.parentBarcodeID,
          orderItemID: item.id
        }).subscribe({
          next: (trace) => {
            // Then update the order item's received quantity
            this.inventoryService.updateOrderItem(item.id, {
              receivedQuantity: newReceivedQty
            }).subscribe({
              next: () => {
                this.checkAndUpdateOrderStatus();
                this.loadOrder(true);

                // Get the barcode string from the trace
                const barcodeString = trace.Barcode?.barcode || trace.barcode;

                // Print the barcode if requested
                if (result.printBarcode && trace.barcodeID) {
                  const defaultPrinter = this.printers().find(p => p.isDefault);
                  const printerIP = defaultPrinter?.ipAddress || '10.10.10.37';
                  this.inventoryService.printBarcode(
                    trace.barcodeID,
                    result.barcodeSize,
                    printerIP
                  ).subscribe({
                    next: () => {
                      this.errorNotification.showSuccess(`Received ${result.receivedQuantity} of ${item.Part?.name || 'item'} - Label printed`);
                    },
                    error: (err) => {
                      this.errorNotification.showHttpError(err, 'Received item but failed to print label');
                    }
                  });
                } else {
                  this.errorNotification.showSuccess(`Received ${result.receivedQuantity} of ${item.Part?.name || 'item'}`);
                }

              },
              error: (err) => {
                this.errorNotification.showHttpError(err, 'Created barcode but failed to update order item');
              }
            });
          },
          error: (err) => {
            this.errorNotification.showHttpError(err, 'Failed to create barcode for received item');
          }
        });
      } else if (result?.success) {
        // Non-part item, just update the received quantity
        const newReceivedQty = (item.receivedQuantity || 0) + result.receivedQuantity;
        this.inventoryService.updateOrderItem(item.id, {
          receivedQuantity: newReceivedQty
        }).subscribe({
          next: () => {
            this.checkAndUpdateOrderStatus();
            this.errorNotification.showSuccess(`Received ${result.receivedQuantity} of ${item.name || 'item'}`);
            this.loadOrder(true);
          },
          error: (err) => {
            this.errorNotification.showHttpError(err, 'Failed to update item');
          }
        });
      }
    });
  }

  private checkAndUpdateOrderStatus() {
    const order = this.currentOrder();
    if (!order) return;

    // Reload items to get latest state and then check status
    this.inventoryService.getOrderById(order.id).subscribe({
      next: (updatedOrder) => {
        const items = updatedOrder.OrderItems || [];
        let allFullyReceived = true;
        let anyReceived = false;

        items.forEach(item => {
          if (item.orderLineTypeID === 1) { // Only check Part line items
            const received = item.receivedQuantity || 0;
            if (received < item.quantity) {
              allFullyReceived = false;
            }
            if (received > 0) {
              anyReceived = true;
            }
          }
        });

        // Determine new status
        let newStatusId = order.orderStatusID;
        if (allFullyReceived) {
          newStatusId = 4; // Received
        } else if (anyReceived) {
          newStatusId = 5; // Partially Received
        }

        // Only update if status changed
        if (newStatusId !== order.orderStatusID) {
          const orderData = {
            placedDate: order.placedDate,
            receivedDate: allFullyReceived ? new Date().toISOString() : order.receivedDate,
            orderStatusID: newStatusId,
            vendor: order.vendor,
            trackingNumber: order.trackingNumber,
            link: order.link,
            description: order.description,
            notes: order.notes
          };

          this.inventoryService.updateOrder(order.id, orderData).subscribe({
            next: () => {
              if (allFullyReceived) {
                this.errorNotification.showSuccess('Order fully received!');
                this.isReceiveMode.set(false);
              }
              this.loadOrder();
            },
            error: (err) => {
              // Silently fail status update - item was already received
            }
          });
        }
      }
    });
  }

  completeReceipt() {
    const order = this.currentOrder();
    if (!order) return;

    // Check if there are any part lines (orderLineTypeID === 1)
    const items = this.orderItems();
    const hasPartLines = items.some(item => item.orderLineTypeID === 1);

    // If there are no part lines, mark the order as received
    if (!hasPartLines) {
      const orderData = {
        placedDate: order.placedDate,
        receivedDate: new Date().toISOString(),
        orderStatusID: 4, // Received
        vendor: order.vendor,
        trackingNumber: order.trackingNumber,
        link: order.link,
        description: order.description,
        notes: order.notes
      };

      this.inventoryService.updateOrder(order.id, orderData).subscribe({
        next: () => {
          this.errorNotification.showSuccess('Order marked as received');
          this.isReceiveMode.set(false);
          this.receivingQuantities.set(new Map());
          this.loadOrder();
        },
        error: (err) => {
          this.errorNotification.showHttpError(err, 'Failed to mark order as received');
        }
      });
    } else {
      // Just exit receive mode - receiving is done via individual line item "Receive" buttons
      // Backend automatically calculates order status when receivedQuantity is updated
      this.isReceiveMode.set(false);
      this.receivingQuantities.set(new Map());
      this.loadOrder(); // Reload to show latest status from backend
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
    this.editingQuantity.set(item.quantity);
    this.editingPrice.set(this.getPrice(item));
    this.editingLineTypeId.set(item.orderLineTypeID);
    this.editingPartId.set(item.partID);
    this.editingDescription.set(item.name || '');
  }

  saveLineItem(item: OrderItem) {
    // Convert to numbers in case they're strings
    const quantity = Number(this.editingQuantity());
    const price = Number(this.editingPrice());

    if (quantity < 1 || isNaN(quantity)) {
      this.errorNotification.showError('Quantity must be at least 1');
      return;
    }

    if (price < 0 || isNaN(price)) {
      this.errorNotification.showError('Price cannot be negative');
      return;
    }

    const updateData: any = {
      quantity: quantity,
      price: price,
      orderLineTypeID: this.editingLineTypeId()
    };

    // If line type is Part (id=1), set partID and clear name
    // Otherwise, set name and clear partID
    if (this.editingLineTypeId() === 1) {
      updateData.partID = this.editingPartId();
      updateData.name = null;
    } else {
      updateData.partID = null;
      updateData.name = this.editingDescription();
    }

    this.inventoryService.updateOrderItem(item.id, updateData).subscribe({
      next: () => {
        this.errorNotification.showSuccess('Line item updated');
        this.editingItemId.set(null);
        this.loadOrder(true); // Preserve edit mode after saving line item
      },
      error: (err) => {
        this.errorNotification.showHttpError(err, 'Failed to update line item');
      }
    });
  }

  cancelLineItemEdit() {
    this.editingItemId.set(null);
  }

  onQuantityChange(value: any) {
    this.editingQuantity.set(value);
  }

  onPriceChange(value: any) {
    this.editingPrice.set(value);
  }

  openBarcodeDialog(barcodeString?: string) {
    if (barcodeString) {
      this.dialog.open(BarcodeDialog, {
        width: '500px',
        data: { barcode: barcodeString }
      });
    }
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
