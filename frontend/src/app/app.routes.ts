import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
    { path: '', redirectTo: 'home', pathMatch: 'full' },
    {
        path: 'home',
        title: 'Home',
        loadComponent: () =>
            import('./components/pages/home/home.component').then((m) => m.HomeComponent),
    },
    {
        path: 'tasks',
        title: 'Tasks',
        loadComponent: () =>
            import('./components/tasks/task-list-view/task-list-view').then((m) => m.TaskListViewComponent),
        canActivate: [authGuard],
    },
    {
        path: 'projects',
        title: 'Projects',
        loadComponent: () =>
            import('./components/projects/projects-list-view/projects-list-view').then((m) => m.ProjectsListView),
        canActivate: [authGuard],
    },
    {
        path: 'inventory/barcode-history/:id',
        title: 'Barcode History',
        loadComponent: () =>
            import('./components/inventory/barcode-history/barcode-history').then((m) => m.BarcodeHistoryComponent),
        canActivate: [authGuard],
    },
    {
        path: 'inventory',
        title: 'Inventory',
        loadComponent: () =>
            import('./components/inventory/inventory-higherarchy-view/inventory-higherarchy-view').then((m) => m.InventoryHigherarchyView),
        canActivate: [authGuard],
    },
    {
        path: 'parts',
        title: 'Parts',
        loadComponent: () =>
            import('./components/inventory/parts-table-view/parts-table-view').then((m) => m.PartsTableView),
        canActivate: [authGuard],
    },
    {
        path: 'parts/new',
        title: 'New Part',
        loadComponent: () =>
            import('./components/inventory/part-edit-page/part-edit-page').then((m) => m.PartEditPage),
        canActivate: [authGuard],
    },
    {
        path: 'parts/:id/edit',
        title: 'Edit Part',
        loadComponent: () =>
            import('./components/inventory/part-edit-page/part-edit-page').then((m) => m.PartEditPage),
        canActivate: [authGuard],
    },
    {
        path: 'equipment',
        title: 'Equipment',
        loadComponent: () =>
            import('./components/inventory/equipment-table-view/equipment-table-view').then((m) => m.EquipmentTableView),
        canActivate: [authGuard],
    },
    {
        path: 'orders/:id',
        title: 'Order Details',
        loadComponent: () =>
            import('./components/orders/order-view/order-view').then((m) => m.OrderView),
        canActivate: [authGuard],
    },
    {
        path: 'orders',
        title: 'Orders',
        loadComponent: () =>
            import('./components/orders/orders-list-view/orders-list-view').then((m) => m.OrdersListView),
        canActivate: [authGuard],
    },
    {
        path: 'harness',
        title: 'Wire Harnesses',
        loadComponent: () =>
            import('./components/harness/harness-list-view/harness-list-view').then((m) => m.HarnessListView),
        canActivate: [authGuard],
    },
    {
        path: 'harness/editor',
        title: 'Harness Editor',
        loadComponent: () =>
            import('./components/harness/harness-page/harness-page').then((m) => m.HarnessPage),
        canActivate: [authGuard],
    },
    {
        path: 'harness/editor/:id',
        title: 'Harness Editor',
        loadComponent: () =>
            import('./components/harness/harness-page/harness-page').then((m) => m.HarnessPage),
        canActivate: [authGuard],
    }
];
