import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { MatChipsModule } from '@angular/material/chips';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { ManufacturingService } from '../../../services/manufacturing.service';
import { AuthService } from '../../../services/auth.service';
import { WorkOrder } from '../../../models/work-order.model';

@Component({
  selector: 'app-work-order-list-view',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatTableModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
    MatProgressSpinnerModule, MatTooltipModule, MatChipsModule, MatSlideToggleModule,
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
  searchText = signal('');
  statusFilter = signal<string>('');
  showDeleted = signal(false);
  displayedColumns = computed(() => {
    const cols = ['id', 'masterName', 'revision', 'status', 'progress', 'quantity', 'location', 'createdAt'];
    if (this.showDeleted()) cols.push('deletionInfo', 'restore');
    return cols;
  });

  displayedWorkOrders = computed(() => {
    let filtered = this.workOrders();
    const status = this.statusFilter();
    if (status) {
      filtered = filtered.filter(wo => wo.status === status);
    }
    const search = this.searchText().toLowerCase();
    if (search) {
      filtered = filtered.filter(wo =>
        wo.master?.name?.toLowerCase().includes(search) ||
        String(wo.id).includes(search)
      );
    }
    return filtered;
  });

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

  onSearchChange(value: string) {
    this.searchText.set(value);
  }

  createWorkOrder() {
    // Will open a dialog — for now navigate to create page
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
