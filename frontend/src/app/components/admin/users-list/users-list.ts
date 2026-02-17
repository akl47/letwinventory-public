import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { AdminService } from '../../../services/admin.service';
import { AdminUser } from '../../../models/permission.model';
import { UserCreateDialog } from '../user-create-dialog/user-create-dialog';

@Component({
    selector: 'app-users-list',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        MatTableModule,
        MatButtonModule,
        MatIconModule,
        MatProgressSpinnerModule,
        MatDialogModule,
        MatTooltipModule,
        MatFormFieldModule,
        MatInputModule,
        MatSlideToggleModule,
    ],
    templateUrl: './users-list.html',
    styleUrl: './users-list.css'
})
export class UsersList implements OnInit {
    private adminService = inject(AdminService);
    private router = inject(Router);
    private dialog = inject(MatDialog);

    users = signal<AdminUser[]>([]);
    isLoading = signal(true);
    searchQuery = signal('');
    showInactive = signal(false);

    filteredUsers = computed(() => {
        let result = this.users();
        if (!this.showInactive()) {
            result = result.filter(u => u.activeFlag !== false);
        }
        const q = this.searchQuery().toLowerCase().trim();
        if (q) {
            result = result.filter(u =>
                u.displayName.toLowerCase().includes(q) ||
                u.email.toLowerCase().includes(q)
            );
        }
        return result;
    });

    displayedColumns: string[] = ['displayName', 'email', 'groups', 'actions'];

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
            error: () => {
                this.isLoading.set(false);
            }
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
