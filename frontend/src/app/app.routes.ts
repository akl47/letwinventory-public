import { Routes, Router, CanActivateFn } from '@angular/router';
import { inject } from '@angular/core';
import { map } from 'rxjs';
import { authGuard } from './guards/auth.guard';
import { permissionGuard } from './guards/permission.guard';
import { AuthService } from './services/auth.service';

/** Redirects authenticated users to /tasks */
const guestGuard: CanActivateFn = () => {
    const authService = inject(AuthService);
    const router = inject(Router);

    if (authService.isAuthenticated()) {
        return router.createUrlTree(['/tasks']);
    }

    return authService.checkAuthStatus().pipe(
        map(isAuthenticated => isAuthenticated ? router.createUrlTree(['/tasks']) : true)
    );
};

export const routes: Routes = [
    { path: '', redirectTo: 'home', pathMatch: 'full' },
    {
        path: 'home',
        title: 'Home',
        loadComponent: () =>
            import('./components/pages/home/home.component').then((m) => m.HomeComponent),
        canActivate: [guestGuard],
    },
    {
        path: 'tasks',
        title: 'Tasks',
        loadComponent: () =>
            import('./components/tasks/task-list-view/task-list-view').then((m) => m.TaskListViewComponent),
        canActivate: [authGuard, permissionGuard],
        data: { resource: 'tasks' },
    },
    {
        path: 'projects',
        title: 'Projects',
        loadComponent: () =>
            import('./components/projects/projects-list-view/projects-list-view').then((m) => m.ProjectsListView),
        canActivate: [authGuard, permissionGuard],
        data: { resource: 'projects' },
    },
    {
        path: 'scheduled-tasks',
        title: 'Scheduled Tasks',
        loadComponent: () =>
            import('./components/scheduled-tasks/scheduled-tasks-list-view/scheduled-tasks-list-view').then((m) => m.ScheduledTasksListView),
        canActivate: [authGuard, permissionGuard],
        data: { resource: 'tasks' },
    },
    {
        path: 'inventory/barcode-history/:id',
        title: 'Barcode History',
        loadComponent: () =>
            import('./components/inventory/barcode-history/barcode-history').then((m) => m.BarcodeHistoryComponent),
        canActivate: [authGuard, permissionGuard],
        data: { resource: 'inventory' },
    },
    {
        path: 'inventory',
        title: 'Inventory',
        loadComponent: () =>
            import('./components/inventory/inventory-higherarchy-view/inventory-higherarchy-view').then((m) => m.InventoryHigherarchyView),
        canActivate: [authGuard, permissionGuard],
        data: { resource: 'inventory' },
    },
    {
        path: 'parts',
        title: 'Parts',
        loadComponent: () =>
            import('./components/inventory/parts-table-view/parts-table-view').then((m) => m.PartsTableView),
        canActivate: [authGuard, permissionGuard],
        data: { resource: 'parts' },
    },
    {
        path: 'parts/new',
        title: 'New Part',
        loadComponent: () =>
            import('./components/inventory/part-edit-page/part-edit-page').then((m) => m.PartEditPage),
        canActivate: [authGuard, permissionGuard],
        data: { resource: 'parts' },
    },
    {
        path: 'parts/:id/edit',
        title: 'Edit Part',
        loadComponent: () =>
            import('./components/inventory/part-edit-page/part-edit-page').then((m) => m.PartEditPage),
        canActivate: [authGuard, permissionGuard],
        data: { resource: 'parts' },
    },
    {
        path: 'equipment',
        title: 'Equipment',
        loadComponent: () =>
            import('./components/inventory/equipment-table-view/equipment-table-view').then((m) => m.EquipmentTableView),
        canActivate: [authGuard, permissionGuard],
        data: { resource: 'equipment' },
    },
    {
        path: 'orders/bulk-upload',
        title: 'Bulk Order Import',
        loadComponent: () =>
            import('./components/orders/bulk-upload/bulk-upload').then((m) => m.BulkUploadComponent),
        canActivate: [authGuard, permissionGuard],
        data: { resource: 'orders' },
    },
    {
        path: 'orders/:id',
        title: 'Order Details',
        loadComponent: () =>
            import('./components/orders/order-view/order-view').then((m) => m.OrderView),
        canActivate: [authGuard, permissionGuard],
        data: { resource: 'orders' },
    },
    {
        path: 'orders',
        title: 'Orders',
        loadComponent: () =>
            import('./components/orders/orders-list-view/orders-list-view').then((m) => m.OrdersListView),
        canActivate: [authGuard, permissionGuard],
        data: { resource: 'orders' },
    },
    {
        path: 'harness',
        title: 'Wire Harnesses',
        loadComponent: () =>
            import('./components/harness/harness-list-view/harness-list-view').then((m) => m.HarnessListView),
        canActivate: [authGuard, permissionGuard],
        data: { resource: 'harness' },
    },
    {
        path: 'harness/editor',
        title: 'Harness Editor',
        loadComponent: () =>
            import('./components/harness/harness-page/harness-page').then((m) => m.HarnessPage),
        canActivate: [authGuard, permissionGuard],
        data: { resource: 'harness' },
    },
    {
        path: 'harness/editor/:id',
        title: 'Harness Editor',
        loadComponent: () =>
            import('./components/harness/harness-page/harness-page').then((m) => m.HarnessPage),
        canActivate: [authGuard, permissionGuard],
        data: { resource: 'harness' },
    },
    {
        path: 'requirements',
        title: 'Design Requirements',
        loadComponent: () =>
            import('./components/design/requirements-list-view/requirements-list-view').then((m) => m.RequirementsListView),
        canActivate: [authGuard, permissionGuard],
        data: { resource: 'requirements' },
    },
    {
        path: 'requirements/new',
        title: 'New Requirement',
        loadComponent: () =>
            import('./components/design/requirement-edit-page/requirement-edit-page').then((m) => m.RequirementEditPage),
        canActivate: [authGuard, permissionGuard],
        data: { resource: 'requirements' },
    },
    {
        path: 'requirements/:id/edit',
        title: 'Edit Requirement',
        loadComponent: () =>
            import('./components/design/requirement-edit-page/requirement-edit-page').then((m) => m.RequirementEditPage),
        canActivate: [authGuard, permissionGuard],
        data: { resource: 'requirements' },
    },
    {
        path: 'admin/groups',
        title: 'User Groups',
        loadComponent: () =>
            import('./components/admin/groups-list/groups-list').then((m) => m.GroupsList),
        canActivate: [authGuard, permissionGuard],
        data: { resource: 'admin' },
    },
    {
        path: 'admin/groups/new',
        title: 'New Group',
        loadComponent: () =>
            import('./components/admin/group-edit/group-edit').then((m) => m.GroupEdit),
        canActivate: [authGuard, permissionGuard],
        data: { resource: 'admin' },
    },
    {
        path: 'admin/groups/:id',
        title: 'Edit Group',
        loadComponent: () =>
            import('./components/admin/group-edit/group-edit').then((m) => m.GroupEdit),
        canActivate: [authGuard, permissionGuard],
        data: { resource: 'admin' },
    },
    {
        path: 'admin/users',
        title: 'Users',
        loadComponent: () =>
            import('./components/admin/users-list/users-list').then((m) => m.UsersList),
        canActivate: [authGuard, permissionGuard],
        data: { resource: 'admin' },
    },
    {
        path: 'admin/users/:id',
        title: 'Edit User',
        loadComponent: () =>
            import('./components/admin/user-permissions/user-permissions').then((m) => m.UserPermissions),
        canActivate: [authGuard, permissionGuard],
        data: { resource: 'admin' },
    },
    {
        path: 'settings',
        title: 'Settings',
        loadComponent: () =>
            import('./components/settings/settings-page/settings-page').then((m) => m.SettingsPage),
        canActivate: [authGuard],
    },
    {
        path: 'mobile',
        title: 'Mobile Scanner',
        loadComponent: () =>
            import('./components/mobile/mobile-scanner/mobile-scanner').then((m) => m.MobileScanner),
        canActivate: [authGuard, permissionGuard],
        data: { resource: 'inventory' },
    }
];
