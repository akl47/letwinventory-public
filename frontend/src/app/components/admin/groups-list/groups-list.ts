import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AdminService } from '../../../services/admin.service';
import { UserGroup } from '../../../models/permission.model';
import { DataTable, DataTableColumnDef, ColumnDef } from '../../common/data-table/data-table';

@Component({
  selector: 'app-groups-list',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    DataTable,
    DataTableColumnDef,
  ],
  templateUrl: './groups-list.html',
  styleUrl: './groups-list.css',
})
export class GroupsList implements OnInit {
  private adminService = inject(AdminService);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);

  groups = signal<UserGroup[] | null>(null);
  groupsList = computed(() => this.groups() ?? []);

  columns: ColumnDef<UserGroup>[] = [
    { key: 'name', header: 'Name', sortable: true },
    { key: 'description', header: 'Description', sortable: true },
    { key: 'memberCount', header: 'Members', sortable: true },
    { key: 'actions', header: 'Actions' },
  ];

  searchKeys = ['name', 'description'];

  ngOnInit() {
    this.loadGroups();
  }

  loadGroups() {
    this.adminService.getGroups().subscribe({
      next: (groups) => this.groups.set(groups),
      error: () => {
        this.snackBar.open('Failed to load groups', 'Close', { duration: 3000 });
        this.groups.set([]);
      },
    });
  }

  deleteGroup(id: number) {
    this.adminService.deleteGroup(id).subscribe({
      next: () => this.loadGroups(),
      error: () => this.snackBar.open('Failed to delete group', 'Close', { duration: 3000 }),
    });
  }

  navigateToNew() {
    this.router.navigate(['/admin/groups/new']);
  }

  navigateToEdit(id: number) {
    this.router.navigate(['/admin/groups', id]);
  }
}
