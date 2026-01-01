import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { InventoryService, Order } from '../../../services/inventory.service';
import { ErrorNotificationService } from '../../../services/error-notification.service';
import { Router } from '@angular/router';

export interface OrderEditDialogData {
  order?: Order;
}

@Component({
  selector: 'app-order-edit-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule
  ],
  templateUrl: './order-edit-dialog.html',
  styleUrl: './order-edit-dialog.css'
})
export class OrderEditDialog implements OnInit {
  private fb = inject(FormBuilder);
  private inventoryService = inject(InventoryService);
  private errorNotification = inject(ErrorNotificationService);
  private dialogRef = inject(MatDialogRef<OrderEditDialog>);
  private router = inject(Router);
  data = inject<OrderEditDialogData>(MAT_DIALOG_DATA, { optional: true });

  orderStatuses = signal([
    { id: 1, name: 'Pending' },
    { id: 2, name: 'Placed' },
    { id: 3, name: 'Shipped' },
    { id: 4, name: 'Received' }
  ]);

  form = this.fb.group({
    vendor: [''],
    link: [''],
    placedDate: [new Date(), Validators.required],
    receivedDate: [null as Date | null],
    orderStatusID: [1, Validators.required],
    description: ['']
  });

  isEditMode = signal<boolean>(false);

  ngOnInit() {
    if (this.data?.order) {
      this.isEditMode.set(true);
      const order = this.data.order;
      this.form.patchValue({
        vendor: order.vendor,
        link: order.link,
        placedDate: order.placedDate ? new Date(order.placedDate) : new Date(),
        receivedDate: order.receivedDate ? new Date(order.receivedDate) : null,
        orderStatusID: order.orderStatusID,
        description: order.description || ''
      });
    }
  }

  save() {
    if (!this.form.valid) {
      this.errorNotification.showError('Please fill in all required fields');
      return;
    }

    const formValue = this.form.value;
    const orderData = {
      vendor: formValue.vendor,
      link: formValue.link,
      placedDate: formValue.placedDate?.toISOString(),
      receivedDate: formValue.receivedDate?.toISOString() || null,
      orderStatusID: formValue.orderStatusID!,
      description: formValue.description || null
    };

    if (this.isEditMode() && this.data?.order) {
      this.inventoryService.updateOrder(this.data.order.id, orderData).subscribe({
        next: () => {
          this.errorNotification.showSuccess('Order updated successfully');
          this.dialogRef.close(true);
        },
        error: (err) => {
          this.errorNotification.showHttpError(err, 'Failed to update order');
        }
      });
    } else {
      this.inventoryService.createOrder(orderData).subscribe({
        next: (order) => {
          this.errorNotification.showSuccess('Order created successfully');
          this.dialogRef.close(order);
        },
        error: (err) => {
          this.errorNotification.showHttpError(err, 'Failed to create order');
        }
      });
    }
  }

  cancel() {
    this.dialogRef.close(false);
  }
}
