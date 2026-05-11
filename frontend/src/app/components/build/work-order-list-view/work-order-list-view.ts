import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ManufacturingService } from '../../../services/manufacturing.service';
import { AuthService } from '../../../services/auth.service';
import { WorkOrder } from '../../../models/work-order.model';
import { DataTable, DataTableColumnDef, ColumnDef } from '../../common/data-table/data-table';

@Component({
  selector: 'app-work-order-list-view',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    DataTable,
    DataTableColumnDef,
  ],
  templateUrl: './work-order-list-view.html',
  styleUrl: './work-order-list-view.css',
})
export class WorkOrderListView implements OnInit {
  private router = inject(Router);
  private manufacturingService = inject(ManufacturingService);
  private authService = inject(AuthService);

  canWrite = computed(() => this.authService.hasPermission('manufacturing_execution', 'write'));
  canUndelete = computed(() => this.authService.hasPermission('manufacturing_execution', 'work_order_undelete'));

  workOrders = signal<WorkOrder[]>([]);
  isLoading = signal(true);
  statusFilter = signal<string>('');
  showDeleted = signal(false);

  columns = computed<ColumnDef<WorkOrder>[]>(() => {
    const base: ColumnDef<WorkOrder>[] = [
      { key: 'id', header: 'WO #', sortable: true },
      { key: 'masterName', header: 'Master', sortable: true, sortValue: w => w.master?.name?.toLowerCase() ?? null },
      { key: 'revision', header: 'EM Rev', sortable: true, sortValue: w => w.master?.revision ?? null },
      { key: 'status', header: 'Status', sortable: true },
      { key: 'progress', header: 'Progress' },
      { key: 'quantity', header: 'Qty', sortable: true },
      { key: 'location', header: 'Location' },
      { key: 'createdAt', header: 'Created', sortable: true, sortValue: w => w.createdAt ? new Date(w.createdAt).getTime() : null },
    ];
    if (this.showDeleted()) {
      base.push({ key: 'deletionInfo', header: 'Deleted' });
      base.push({ key: 'restore', header: '' });
    }
    return base;
  });

  filteredWorkOrders = computed(() => {
    const status = this.statusFilter();
    if (!status) return this.workOrders();
    return this.workOrders().filter(wo => wo.status === status);
  });

  searchKeys = ['id', 'master.name'];

  rowHref = (w: WorkOrder) => `/build/work-orders/${w.id}`;

  ngOnInit() {
    this.loadWorkOrders();
  }

  loadWorkOrders() {
    this.isLoading.set(true);
    this.manufacturingService.getWorkOrders(undefined, this.showDeleted()).subscribe({
      next: (workOrders) => {
        this.workOrders.set(workOrders);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  toggleShowDeleted() {
    this.showDeleted.set(!this.showDeleted());
    this.loadWorkOrders();
  }

  restoreWorkOrder(wo: WorkOrder, event?: Event) {
    event?.stopPropagation();
    this.manufacturingService.undeleteWorkOrder(wo.id).subscribe({
      next: () => this.loadWorkOrders(),
    });
  }

  createWorkOrder() {
    this.router.navigate(['/build/work-orders/new']);
  }

  openWorkOrder(wo: WorkOrder) {
    this.router.navigate(['/build/work-orders', wo.id]);
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'not_started': return '#9e9e9e';
      case 'in_progress': return '#ff9800';
      case 'complete': return '#4caf50';
      default: return '#9e9e9e';
    }
  }

  formatStatus(status: string): string {
    switch (status) {
      case 'not_started': return 'Not Started';
      case 'in_progress': return 'In Progress';
      case 'complete': return 'Complete';
      default: return status;
    }
  }
}
