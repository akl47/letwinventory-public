import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { forkJoin, take } from 'rxjs';
import { AdminService } from '../../../services/admin.service';
import { AuthService } from '../../../services/auth.service';
import { Permission, AdminUser, UserGroup } from '../../../models/permission.model';
import { PermissionGridComponent } from '../permission-grid/permission-grid';

@Component({
    selector: 'app-user-permissions',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        RouterModule,
        MatFormFieldModule,
        MatButtonModule,
        MatIconModule,
        MatCardModule,
        MatChipsModule,
        MatProgressSpinnerModule,
        MatTooltipModule,
        MatSelectModule,
        PermissionGridComponent,
    ],
    templateUrl: './user-permissions.html',
    styleUrl: './user-permissions.css'
})
export class UserPermissions implements OnInit {
    private adminService = inject(AdminService);
    private authService = inject(AuthService);
    private route = inject(ActivatedRoute);
    private router = inject(Router);

    user = signal<AdminUser | null>(null);
    allPermissions = signal<Permission[]>([]);
    allGroups = signal<UserGroup[]>([]);
    selectedPermissionIds = signal<Set<number>>(new Set());
    selectedGroupId = signal<number | null>(null);
    loading = signal(true);
    isFormEditMode = signal(false);
    canImpersonate = computed(() => this.authService.hasPermission('admin', 'impersonate'));

    ngOnInit() {
        this.route.params.pipe(take(1)).subscribe(params => {
            if (params['id']) {
                this.loadData(+params['id']);
            }
        });
    }

    private loadData(userId: number) {
        forkJoin({
            user: this.adminService.getUser(userId),
            permissions: this.adminService.getPermissions(),
            groups: this.adminService.getGroups(),
        }).subscribe({
            next: (results) => {
                this.user.set(results.user);
                this.allPermissions.set(results.permissions);
                this.allGroups.set(results.groups);
                const ids = new Set<number>(
                    (results.user.directPermissions || []).map(p => p.id)
                );
                this.selectedPermissionIds.set(ids);
                this.isFormEditMode.set(false);
                this.loading.set(false);
            }
        });
    }

    availableGroups(): UserGroup[] {
        const userGroupIds = new Set((this.user()?.groups || []).map(g => g.id));
        return this.allGroups().filter(g => !userGroupIds.has(g.id));
    }

    addToGroup(groupId: number | null) {
        if (!groupId) return;
        const u = this.user();
        if (!u) return;
        this.adminService.addMember(groupId, u.id).subscribe({
            next: () => {
                this.selectedGroupId.set(null);
                this.loadData(u.id);
            }
        });
    }

    removeFromGroup(groupId: number) {
        const u = this.user();
        if (!u) return;
        this.adminService.removeMember(groupId, u.id).subscribe({
            next: () => this.loadData(u.id)
        });
    }

    enableEdit() {
        this.isFormEditMode.set(true);
    }

    cancelEdit() {
        const u = this.user();
        if (u) {
            this.loadData(u.id);
        }
    }

    save() {
        const u = this.user();
        if (!u) return;
        this.adminService.setUserPermissions(u.id, Array.from(this.selectedPermissionIds())).subscribe({
            next: () => {
                this.loadData(u.id);
            }
        });
    }

    toggleActive() {
        const u = this.user();
        if (!u) return;
        const action = u.activeFlag === false
            ? this.adminService.activateUser(u.id)
            : this.adminService.deactivateUser(u.id);
        action.subscribe(() => this.loadData(u.id));
    }

    impersonate() {
        const u = this.user();
        if (!u) return;
        this.adminService.impersonateUser(u.id).subscribe({
            next: (res) => this.authService.startImpersonation(res.token, res.user, res.permissions)
        });
    }

    goBack() {
        this.router.navigate(['/admin/users']);
    }
}
