import { Component, OnInit, inject, signal } from '@angular/core';
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
import { MatDialog } from '@angular/material/dialog';
import { FormsModule } from '@angular/forms';
import { TrackingService } from '../../../services/tracking.service';
import { ShipmentTracking, CarrierType } from '../../../models/tracking.model';
import { ErrorNotificationService } from '../../../services/error-notification.service';
import { TrackingAddDialog } from '../tracking-add-dialog/tracking-add-dialog';

@Component({
    selector: 'app-tracking-list-view',
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
        FormsModule
    ],
    templateUrl: './tracking-list-view.html',
    styleUrl: './tracking-list-view.css'
})
export class TrackingListView implements OnInit {
    private trackingService = inject(TrackingService);
    private errorNotification = inject(ErrorNotificationService);
    private router = inject(Router);
    private route = inject(ActivatedRoute);
    private dialog = inject(MatDialog);

    allTrackings = signal<ShipmentTracking[]>([]);
    displayedTrackings = signal<ShipmentTracking[]>([]);
    searchText = signal<string>('');
    showInactive = signal<boolean>(false);
    refreshingIds = signal<Set<number>>(new Set());

    displayedColumns: string[] = ['trackingNumber', 'carrier', 'status', 'order', 'lastCheckedAt', 'estimatedDelivery', 'actions'];

    // Pagination
    pageSize = signal<number>(25);
    pageIndex = signal<number>(0);
    pageSizeOptions = [10, 25, 50, 100];

    // Sorting
    sortColumn = signal<string>('updatedAt');
    sortDirection = signal<'asc' | 'desc'>('desc');

    private initializedFromQuery = false;

    ngOnInit() {
        this.applyQueryParams();
        this.fetchTrackings();
    }

    private applyQueryParams() {
        const params = this.route.snapshot.queryParams;
        if (params['search']) this.searchText.set(params['search']);
        if (params['inactive'] === 'true') this.showInactive.set(true);
        if (params['sort']) this.sortColumn.set(params['sort']);
        if (params['dir'] === 'asc' || params['dir'] === 'desc') this.sortDirection.set(params['dir']);
        if (params['page']) this.pageIndex.set(parseInt(params['page'], 10) || 0);
        if (params['pageSize']) this.pageSize.set(parseInt(params['pageSize'], 10) || 25);
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
        if (sortCol !== 'updatedAt' || sortDir !== 'desc') {
            params['sort'] = sortCol;
            params['dir'] = sortDir;
        }
        if (this.pageIndex() > 0) params['page'] = String(this.pageIndex());
        if (this.pageSize() !== 25) params['pageSize'] = String(this.pageSize());
        this.router.navigate([], { relativeTo: this.route, queryParams: params, replaceUrl: true });
    }

    fetchTrackings() {
        this.trackingService.getAll(this.showInactive()).subscribe({
            next: (trackings) => {
                this.allTrackings.set(trackings);
                this.applyFiltersAndSort();
            },
            error: (err) => {
                this.errorNotification.showHttpError(err, 'Error loading trackings');
            }
        });
    }

    applyFiltersAndSort() {
        let filtered = [...this.allTrackings()];

        if (!this.showInactive()) {
            filtered = filtered.filter(t => t.activeFlag);
        }

        const search = this.searchText().toLowerCase();
        if (search) {
            filtered = filtered.filter(t =>
                t.trackingNumber?.toLowerCase().includes(search) ||
                t.carrier?.toLowerCase().includes(search) ||
                t.status?.toLowerCase().includes(search) ||
                t.Order?.vendor?.toLowerCase().includes(search) ||
                t.Order?.description?.toLowerCase().includes(search)
            );
        }

        const sortCol = this.sortColumn();
        const sortDir = this.sortDirection();
        filtered.sort((a, b) => {
            let aVal: any, bVal: any;
            if (sortCol === 'order') {
                aVal = a.Order?.vendor || '';
                bVal = b.Order?.vendor || '';
            } else {
                aVal = (a as any)[sortCol];
                bVal = (b as any)[sortCol];
            }
            if (aVal == null) aVal = '';
            if (bVal == null) bVal = '';
            const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
            return sortDir === 'asc' ? comparison : -comparison;
        });

        const startIndex = this.pageIndex() * this.pageSize();
        const endIndex = startIndex + this.pageSize();
        this.displayedTrackings.set(filtered.slice(startIndex, endIndex));
    }

    getTotalCount(): number {
        let filtered = [...this.allTrackings()];
        if (!this.showInactive()) {
            filtered = filtered.filter(t => t.activeFlag);
        }
        const search = this.searchText().toLowerCase();
        if (search) {
            filtered = filtered.filter(t =>
                t.trackingNumber?.toLowerCase().includes(search) ||
                t.carrier?.toLowerCase().includes(search) ||
                t.status?.toLowerCase().includes(search) ||
                t.Order?.vendor?.toLowerCase().includes(search)
            );
        }
        return filtered.length;
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
        this.trackingService.clearCache();
        this.pageIndex.set(0);
        this.fetchTrackings();
        this.updateQueryParams();
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

    getStatusClass(status: string | null): string {
        if (!status) return 'status-unknown';
        switch (status) {
            case 'Delivered': return 'status-delivered';
            case 'In Transit': return 'status-in-transit';
            case 'Out for Delivery': return 'status-out-for-delivery';
            case 'Exception': return 'status-exception';
            case 'Pre-Shipment': return 'status-pre-shipment';
            case 'Accepted': return 'status-accepted';
            default: return 'status-unknown';
        }
    }

    refreshTracking(tracking: ShipmentTracking, event: Event) {
        event.stopPropagation();
        const ids = new Set(this.refreshingIds());
        ids.add(tracking.id);
        this.refreshingIds.set(ids);

        this.trackingService.refresh(tracking.id).subscribe({
            next: (updated) => {
                const all = this.allTrackings().map(t => t.id === updated.id ? updated : t);
                this.allTrackings.set(all);
                this.applyFiltersAndSort();
                const ids2 = new Set(this.refreshingIds());
                ids2.delete(tracking.id);
                this.refreshingIds.set(ids2);
            },
            error: (err) => {
                this.errorNotification.showHttpError(err, 'Error refreshing tracking');
                const ids2 = new Set(this.refreshingIds());
                ids2.delete(tracking.id);
                this.refreshingIds.set(ids2);
            }
        });
    }

    deleteTracking(tracking: ShipmentTracking, event: Event) {
        event.stopPropagation();
        if (!confirm(`Delete tracking ${tracking.trackingNumber}?`)) return;

        this.trackingService.delete(tracking.id).subscribe({
            next: () => {
                this.errorNotification.showSuccess('Tracking deleted');
                this.fetchTrackings();
            },
            error: (err) => {
                this.errorNotification.showHttpError(err, 'Error deleting tracking');
            }
        });
    }

    openAddDialog() {
        const dialogRef = this.dialog.open(TrackingAddDialog, {
            width: '500px'
        });

        dialogRef.afterClosed().subscribe(result => {
            if (result) {
                this.trackingService.clearCache();
                this.fetchTrackings();
            }
        });
    }

    viewOrder(orderId: number, event: Event) {
        event.stopPropagation();
        this.router.navigate(['/orders', orderId]);
    }
}
