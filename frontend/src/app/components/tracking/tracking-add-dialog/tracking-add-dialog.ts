import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { TrackingService } from '../../../services/tracking.service';
import { InventoryService } from '../../../services/inventory.service';
import { ErrorNotificationService } from '../../../services/error-notification.service';
import { Order } from '../../../models/order.model';
import { CarrierType } from '../../../models/tracking.model';

@Component({
    selector: 'app-tracking-add-dialog',
    standalone: true,
    imports: [
        CommonModule,
        ReactiveFormsModule,
        MatDialogModule,
        MatButtonModule,
        MatFormFieldModule,
        MatInputModule,
        MatSelectModule,
        MatIconModule
    ],
    templateUrl: './tracking-add-dialog.html',
    styleUrl: './tracking-add-dialog.css'
})
export class TrackingAddDialog implements OnInit {
    private fb = inject(FormBuilder);
    private dialogRef = inject(MatDialogRef<TrackingAddDialog>);
    private trackingService = inject(TrackingService);
    private inventoryService = inject(InventoryService);
    private errorNotification = inject(ErrorNotificationService);

    orders = signal<Order[]>([]);
    detectedCarrier = signal<CarrierType>('unknown');
    saving = signal(false);

    form = this.fb.group({
        trackingNumber: ['', Validators.required],
        orderID: [null as number | null]
    });

    ngOnInit() {
        this.inventoryService.getAllOrders().subscribe({
            next: (orders) => {
                this.orders.set(orders.filter(o => o.activeFlag));
            }
        });

        this.form.get('trackingNumber')?.valueChanges.subscribe(value => {
            this.detectedCarrier.set(this.detectCarrier(value || ''));
        });
    }

    detectCarrier(trackingNumber: string): CarrierType {
        if (!trackingNumber) return 'unknown';
        const tn = trackingNumber.trim().toUpperCase();
        if (/^1Z[A-Z0-9]{16,18}$/i.test(tn)) return 'ups';
        if (/^(92|94|93|95)\d{18,22}$/.test(tn)) return 'usps';
        if (/^\d{20,22}$/.test(tn)) return 'usps';
        if (/^[A-Z]{2}\d{9}US$/i.test(tn)) return 'usps';
        if (/^\d{12}$/.test(tn) || /^\d{15}$/.test(tn) || /^\d{20}$/.test(tn)) return 'fedex';
        if (/^\d{10}$/.test(tn)) return 'dhl';
        if (/^(JD|JJD)\d{18,}$/i.test(tn)) return 'dhl';
        return 'unknown';
    }

    getCarrierIcon(carrier: CarrierType): string {
        switch (carrier) {
            case 'usps': return 'local_post_office';
            case 'ups': return 'local_shipping';
            case 'fedex': return 'flight';
            case 'dhl': return 'public';
            default: return 'help_outline';
        }
    }

    getCarrierLabel(carrier: CarrierType): string {
        switch (carrier) {
            case 'usps': return 'USPS';
            case 'ups': return 'UPS';
            case 'fedex': return 'FedEx';
            case 'dhl': return 'DHL';
            default: return 'Unknown';
        }
    }

    save() {
        if (!this.form.valid) return;
        this.saving.set(true);

        const data = {
            trackingNumber: this.form.value.trackingNumber!.trim(),
            orderID: this.form.value.orderID || undefined
        };

        this.trackingService.create(data).subscribe({
            next: (tracking) => {
                this.saving.set(false);
                this.errorNotification.showSuccess('Tracking added');
                this.dialogRef.close(tracking);
            },
            error: (err) => {
                this.saving.set(false);
                this.errorNotification.showHttpError(err, 'Error adding tracking');
            }
        });
    }

    cancel() {
        this.dialogRef.close();
    }
}
