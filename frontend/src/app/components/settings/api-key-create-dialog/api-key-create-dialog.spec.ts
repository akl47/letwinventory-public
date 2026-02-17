import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { MatDialogRef } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { ApiKeyCreateDialog } from './api-key-create-dialog';
import { AdminService } from '../../../services/admin.service';
import { AuthService } from '../../../services/auth.service';
import { Permission } from '../../../models/permission.model';

describe('ApiKeyCreateDialog', () => {
    let component: ApiKeyCreateDialog;
    let fixture: ComponentFixture<ApiKeyCreateDialog>;
    let adminService: AdminService;
    let authService: AuthService;
    let dialogRef: MatDialogRef<ApiKeyCreateDialog>;

    const mockPermissions: Permission[] = [
        { id: 1, resource: 'tasks', action: 'read' },
        { id: 2, resource: 'tasks', action: 'write' },
        { id: 3, resource: 'inventory', action: 'read' },
    ];

    beforeEach(async () => {
        dialogRef = { close: vi.fn() } as any;

        await TestBed.configureTestingModule({
            imports: [ApiKeyCreateDialog],
            providers: [
                provideHttpClient(),
                provideHttpClientTesting(),
                provideAnimationsAsync(),
                provideRouter([]),
                { provide: MatDialogRef, useValue: dialogRef },
            ],
        }).compileComponents();

        adminService = TestBed.inject(AdminService);
        authService = TestBed.inject(AuthService);

        vi.spyOn(adminService, 'getPermissions').mockReturnValue(of(mockPermissions));

        fixture = TestBed.createComponent(ApiKeyCreateDialog);
        component = fixture.componentInstance;
        fixture.detectChanges();
        await fixture.whenStable();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should load permissions on init and pre-select all', () => {
        expect(adminService.getPermissions).toHaveBeenCalled();
        expect(component.allPermissions()).toEqual(mockPermissions);
        expect(component.selectedPermissionIds().size).toBe(3);
        expect(component.selectedPermissionIds().has(1)).toBe(true);
        expect(component.selectedPermissionIds().has(2)).toBe(true);
        expect(component.selectedPermissionIds().has(3)).toBe(true);
    });

    it('canCreate should be false with empty name', () => {
        component.name.set('');
        expect(component.canCreate()).toBe(false);
    });

    it('canCreate should be false with no permissions selected', () => {
        component.name.set('Test Key');
        component.selectedPermissionIds.set(new Set());
        expect(component.canCreate()).toBe(false);
    });

    it('canCreate should be true with name and permissions', () => {
        component.name.set('Test Key');
        expect(component.canCreate()).toBe(true);
    });

    it('create should not proceed with empty name', () => {
        const spy = vi.spyOn(authService, 'createApiKey');
        component.name.set('   ');

        component.create();

        expect(spy).not.toHaveBeenCalled();
        expect(component.creating()).toBe(false);
    });

    it('create should call authService.createApiKey', () => {
        vi.spyOn(authService, 'createApiKey').mockReturnValue(
            of({ id: 1, name: 'Test', key: 'abc123', createdAt: '2026-01-01' })
        );
        component.name.set('Test Key');

        component.create();

        expect(authService.createApiKey).toHaveBeenCalledWith({
            name: 'Test Key',
            permissionIds: expect.any(Array),
        });
    });

    it('create should set createdKey on success', () => {
        vi.spyOn(authService, 'createApiKey').mockReturnValue(
            of({ id: 1, name: 'Test', key: 'secret-key-value', createdAt: '2026-01-01' })
        );
        component.name.set('Test Key');

        component.create();

        expect(component.createdKey()).toBe('secret-key-value');
        expect(component.creating()).toBe(false);
    });

    it('close should close dialog with false when no key created', () => {
        component.close();

        expect(dialogRef.close).toHaveBeenCalledWith(false);
    });

    it('close should close dialog with true when key was created', () => {
        vi.spyOn(authService, 'createApiKey').mockReturnValue(
            of({ id: 1, name: 'Test', key: 'abc', createdAt: '2026-01-01' })
        );
        component.name.set('Test');
        component.create();

        component.close();

        expect(dialogRef.close).toHaveBeenCalledWith(true);
    });
});
