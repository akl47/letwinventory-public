import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatRadioModule } from '@angular/material/radio';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { AdminService } from '../../../services/admin.service';
import { AuthService } from '../../../services/auth.service';
import { Permission } from '../../../models/permission.model';
import { PermissionGridComponent } from '../../admin/permission-grid/permission-grid';

@Component({
    selector: 'app-api-key-create-dialog',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        MatDialogModule,
        MatButtonModule,
        MatFormFieldModule,
        MatInputModule,
        MatIconModule,
        MatRadioModule,
        MatDatepickerModule,
        MatNativeDateModule,
        PermissionGridComponent,
    ],
    templateUrl: './api-key-create-dialog.html',
    styleUrl: './api-key-create-dialog.css'
})
export class ApiKeyCreateDialog implements OnInit {
    private dialogRef = inject(MatDialogRef<ApiKeyCreateDialog>);
    private adminService = inject(AdminService);
    private authService = inject(AuthService);

    name = signal('');
    expirationMode: 'never' | 'date' = 'never';
    expiresAt: Date | null = null;
    minDate = new Date();

    allPermissions = signal<Permission[]>([]);
    selectedPermissionIds = signal<Set<number>>(new Set());
    createdKey = signal<string | null>(null);
    creating = signal(false);

    canCreate = computed(() => {
        return this.name().trim().length > 0
            && this.selectedPermissionIds().size > 0
            && !this.creating();
    });

    ngOnInit() {
        this.adminService.getPermissions().subscribe({
            next: (perms) => {
                this.allPermissions.set(perms);
                this.selectedPermissionIds.set(new Set(perms.map(p => p.id)));
            }
        });
    }

    create() {
        if (!this.name().trim()) return;
        this.creating.set(true);

        const data: any = {
            name: this.name().trim(),
            permissionIds: Array.from(this.selectedPermissionIds()),
        };
        if (this.expirationMode === 'date' && this.expiresAt) {
            data.expiresAt = this.expiresAt.toISOString();
        }

        this.authService.createApiKey(data).subscribe({
            next: (result) => {
                this.createdKey.set(result.key);
                this.creating.set(false);
            },
            error: () => {
                this.creating.set(false);
            }
        });
    }

    copyKey() {
        const key = this.createdKey();
        if (key) {
            navigator.clipboard.writeText(key);
        }
    }

    close() {
        this.dialogRef.close(!!this.createdKey());
    }
}
