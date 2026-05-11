import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AdminService } from '../../../services/admin.service';
import { AdminUser } from '../../../models/permission.model';
import { UserCreateDialog } from '../user-create-dialog/user-create-dialog';
import { DataTable, DataTableColumnDef, ColumnDef, FilterSection } from '../../common/data-table/data-table';

@Component({
  selector: 'app-users-list',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatDialogModule,
    MatTooltipModule,
    DataTable,
    DataTableColumnDef,
  ],
  templateUrl: './users-list.html',
  styleUrl: './users-list.css',
})
export class UsersList implements OnInit {
  private adminService = inject(AdminService);
  private router = inject(Router);
  private dialog = inject(MatDialog);

  users = signal<AdminUser[]>([]);
  isLoading = signal(true);

  columns: ColumnDef<AdminUser>[] = [
    { key: 'displayName', header: 'Name', sortable: true },
    { key: 'email', header: 'Email', sortable: true },
    { key: 'groups', header: 'Groups' },
    { key: 'actions', header: 'Actions' },
  ];

  filterSections: FilterSection<AdminUser>[] = [
    {
      type: 'toggle',
      key: 'inactive',
      label: 'Show Inactive',
      default: false,
      predicate: (u, on) => on || u.activeFlag !== false,
    },
  ];

  searchKeys = ['displayName', 'email'];

  ngOnInit() {
    this.loadUsers();
  }

  loadUsers() {
    this.isLoading.set(true);
    this.adminService.getUsers().subscribe({
      next: (users) => {
        this.users.set(users);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  navigateToUser(id: number) {
    this.router.navigate(['/admin/users', id]);
  }

  getGroupNames(user: AdminUser): string {
    if (!user.groups || user.groups.length === 0) return '-';
    return user.groups.map(g => g.name).join(', ');
  }

  openCreateDialog() {
    const ref = this.dialog.open(UserCreateDialog, { width: '440px' });
    ref.afterClosed().subscribe((created) => {
      if (created) this.loadUsers();
    });
  }
}
