import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatSelectModule } from '@angular/material/select';
import { MatCardModule } from '@angular/material/card';
import { forkJoin, take } from 'rxjs';
import { AdminService } from '../../../services/admin.service';
import { Permission, UserGroup, AdminUser } from '../../../models/permission.model';
import { PermissionGridComponent } from '../permission-grid/permission-grid';

@Component({
    selector: 'app-group-edit',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        MatFormFieldModule,
        MatInputModule,
        MatButtonModule,
        MatIconModule,
        MatTableModule,
        MatSelectModule,
        MatCardModule,
        PermissionGridComponent,
    ],
    templateUrl: './group-edit.html',
    styleUrl: './group-edit.css'
})
export class GroupEdit implements OnInit {
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private adminService = inject(AdminService);

    group = signal<UserGroup | null>(null);
    allPermissions = signal<Permission[]>([]);
    allUsers = signal<AdminUser[]>([]);
    loading = signal(true);

    name = signal('');
    description = signal('');
    selectedPermissionIds = signal<Set<number>>(new Set());
    selectedUserId = signal<number | null>(null);
    isFormEditMode = signal(false);

    memberColumns = computed(() => {
        const cols = ['displayName', 'email'];
        if (this.isFormEditMode()) cols.push('actions');
        return cols;
    });

    isNew = computed(() => {
        const g = this.group();
        return !g;
    });

    ngOnInit() {
        this.route.params.pipe(take(1)).subscribe(params => {
            if (params['id']) {
                this.loadData(+params['id']);
            } else {
                this.loadReferenceData();
            }
        });
    }

    private loadData(groupId: number) {
        forkJoin({
            group: this.adminService.getGroup(groupId),
            permissions: this.adminService.getPermissions(),
            users: this.adminService.getUsers(),
        }).subscribe({
            next: (results) => {
                this.group.set(results.group);
                this.allPermissions.set(results.permissions);
                this.allUsers.set(results.users);
                this.name.set(results.group.name);
                this.description.set(results.group.description || '');
                const ids = new Set<number>(
                    (results.group.permissions || []).map(p => p.id)
                );
                this.selectedPermissionIds.set(ids);
                this.isFormEditMode.set(false);
                this.loading.set(false);
            }
        });
    }

    private loadReferenceData() {
        forkJoin({
            permissions: this.adminService.getPermissions(),
            users: this.adminService.getUsers(),
        }).subscribe({
            next: (results) => {
                this.allPermissions.set(results.permissions);
                this.allUsers.set(results.users);
                this.isFormEditMode.set(true);
                this.loading.set(false);
            }
        });
    }

    enableEdit() {
        this.isFormEditMode.set(true);
    }

    cancelEdit() {
        const g = this.group();
        if (g) {
            this.loadData(g.id);
        }
    }

    save() {
        const data: any = {
            name: this.name(),
            description: this.description(),
            permissionIds: Array.from(this.selectedPermissionIds()),
        };

        if (this.isNew()) {
            this.adminService.createGroup(data).subscribe({
                next: (created) => {
                    this.router.navigate(['/admin/groups', created.id]);
                }
            });
        } else {
            const g = this.group()!;
            this.adminService.updateGroup(g.id, data).subscribe({
                next: () => {
                    this.loadData(g.id);
                }
            });
        }
    }

    addMember(userId: number | null) {
        if (!userId) return;
        const g = this.group();
        if (!g) return;
        this.adminService.addMember(g.id, userId).subscribe({
            next: () => {
                this.selectedUserId.set(null);
                this.loadData(g.id);
            }
        });
    }

    removeMember(userId: number) {
        const g = this.group();
        if (!g) return;
        this.adminService.removeMember(g.id, userId).subscribe({
            next: () => {
                this.loadData(g.id);
            }
        });
    }

    availableUsers(): AdminUser[] {
        const members = this.group()?.members || [];
        const memberIds = new Set(members.map(m => m.id));
        return this.allUsers().filter(u => u.activeFlag !== false && !memberIds.has(u.id));
    }

    goBack() {
        this.router.navigate(['/admin/groups']);
    }
}
