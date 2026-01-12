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
    }
];
