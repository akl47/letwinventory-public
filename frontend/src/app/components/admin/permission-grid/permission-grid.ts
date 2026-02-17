import { Component, computed, input, model } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Permission } from '../../../models/permission.model';

@Component({
    selector: 'app-permission-grid',
    standalone: true,
    imports: [CommonModule, MatCheckboxModule, MatTooltipModule],
    templateUrl: './permission-grid.html',
    styleUrl: './permission-grid.css'
})
export class PermissionGridComponent {
    permissions = input.required<Permission[]>();
    selectedIds = model.required<Set<number>>();
    showAllColumn = input(false);
    showCount = input(false);
    disabled = input(false);
    tooltips = input<Record<string, string>>({});

    private readonly resourceOrder = [
        'tasks', 'projects', 'parts', 'inventory', 'equipment',
        'orders', 'harness', 'requirements', 'admin',
    ];

    permissionsByResource = computed(() => {
        const perms = this.permissions();
        const map = new Map<string, Permission[]>();
        for (const p of perms) {
            const list = map.get(p.resource) || [];
            list.push(p);
            map.set(p.resource, list);
        }
        const order = this.resourceOrder;
        return Array.from(map.entries())
            .map(([resource, permissions]) => ({ resource, permissions }))
            .sort((a, b) => {
                const ai = order.indexOf(a.resource);
                const bi = order.indexOf(b.resource);
                return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
            });
    });

    actions = computed(() => {
        const base = ['read', 'write', 'delete'];
        const allActions = new Set(this.permissions().map(p => p.action));
        for (const a of allActions) {
            if (!base.includes(a)) base.push(a);
        }
        return base;
    });

    getPermissionForCell(resource: string, action: string): Permission | undefined {
        return this.permissions().find(p => p.resource === resource && p.action === action);
    }

    getTooltip(resource: string, action: string): string {
        return this.tooltips()[`${resource}.${action}`] || '';
    }

    isPermissionSelected(id: number): boolean {
        return this.selectedIds().has(id);
    }

    togglePermission(id: number) {
        const current = new Set(this.selectedIds());
        if (current.has(id)) {
            current.delete(id);
        } else {
            current.add(id);
        }
        this.selectedIds.set(current);
    }

    isAllSelectedForResource(resource: string): boolean {
        const perms = this.permissions().filter(p => p.resource === resource);
        return perms.length > 0 && perms.every(p => this.selectedIds().has(p.id));
    }

    isSomeSelectedForResource(resource: string): boolean {
        const perms = this.permissions().filter(p => p.resource === resource);
        const selected = perms.filter(p => this.selectedIds().has(p.id));
        return selected.length > 0 && selected.length < perms.length;
    }

    toggleAllForResource(resource: string) {
        const perms = this.permissions().filter(p => p.resource === resource);
        const current = new Set(this.selectedIds());
        const allSelected = perms.every(p => current.has(p.id));
        for (const p of perms) {
            if (allSelected) {
                current.delete(p.id);
            } else {
                current.add(p.id);
            }
        }
        this.selectedIds.set(current);
    }
}
