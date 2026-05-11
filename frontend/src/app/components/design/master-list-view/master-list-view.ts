import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ManufacturingService } from '../../../services/manufacturing.service';
import { AuthService } from '../../../services/auth.service';
import { EngineeringMaster } from '../../../models/engineering-master.model';
import { DataTable, DataTableColumnDef, ColumnDef } from '../../common/data-table/data-table';

@Component({
  selector: 'app-master-list-view',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    DataTable,
    DataTableColumnDef,
  ],
  templateUrl: './master-list-view.html',
  styleUrl: './master-list-view.css',
})
export class MasterListView implements OnInit {
  private router = inject(Router);
  private manufacturingService = inject(ManufacturingService);
  private authService = inject(AuthService);

  canWrite = computed(() => this.authService.hasPermission('manufacturing_planning', 'write'));

  masters = signal<EngineeringMaster[]>([]);
  isLoading = signal(true);

  columns: ColumnDef<EngineeringMaster>[] = [
    { key: 'name', header: 'Name', sortable: true },
    { key: 'revision', header: 'EM Rev', sortable: true },
    { key: 'releaseState', header: 'State', sortable: true },
    { key: 'outputParts', header: 'Output' },
    { key: 'steps', header: 'Steps', sortable: true, sortValue: m => m.stepCount },
    { key: 'createdAt', header: 'Created', sortable: true, sortValue: m => m.createdAt ? new Date(m.createdAt).getTime() : null },
  ];

  searchKeys = ['name', 'description'];

  rowHref = (m: EngineeringMaster) => `/design/masters/${m.id}/edit`;

  ngOnInit() {
    this.loadMasters();
  }

  loadMasters() {
    this.isLoading.set(true);
    this.manufacturingService.getMasters().subscribe({
      next: (masters) => {
        this.masters.set(masters);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  createMaster() {
    this.router.navigate(['/design/masters/new']);
  }

  openMaster(master: EngineeringMaster) {
    this.router.navigate(['/design/masters', master.id, 'edit']);
  }

  getStateColor(state: string): string {
    switch (state) {
      case 'draft': return '#9e9e9e';
      case 'review': return '#ff9800';
      case 'released': return '#4caf50';
      default: return '#9e9e9e';
    }
  }
}
