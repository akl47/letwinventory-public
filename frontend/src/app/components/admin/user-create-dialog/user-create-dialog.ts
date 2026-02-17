import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { AdminService } from '../../../services/admin.service';

@Component({
    selector: 'app-user-create-dialog',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        MatDialogModule,
        MatButtonModule,
        MatFormFieldModule,
        MatInputModule,
        MatIconModule,
    ],
    templateUrl: './user-create-dialog.html',
    styleUrl: './user-create-dialog.css'
})
export class UserCreateDialog {
    private dialogRef = inject(MatDialogRef<UserCreateDialog>);
    private adminService = inject(AdminService);

    email = '';
    displayName = '';
    creating = signal(false);
    error = signal<string | null>(null);

    create() {
        if (!this.email.trim() || !this.displayName.trim()) return;
        this.creating.set(true);
        this.error.set(null);

        this.adminService.createUser({
            email: this.email.trim(),
            displayName: this.displayName.trim()
        }).subscribe({
            next: () => {
                this.dialogRef.close(true);
            },
            error: (err) => {
                this.creating.set(false);
                this.error.set(err.error?.error || 'Failed to create user');
            }
        });
    }

    cancel() {
        this.dialogRef.close(false);
    }
}
