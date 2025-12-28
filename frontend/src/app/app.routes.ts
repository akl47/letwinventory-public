import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
    { path: '', redirectTo: 'home', pathMatch: 'full' },
    {
        path: 'home',
        loadComponent: () =>
            import('./components/pages/home/home.component').then((m) => m.HomeComponent),
    },
    {
        path: 'tasks',
        loadComponent: () =>
            import('./components/tasks/task-list-view/task-list-view').then((m) => m.TaskListViewComponent),
        canActivate: [authGuard],
    },
    {
        path: 'inventory',
        loadComponent: () =>
            import('./components/inventory/inventory-higherarchy-view/inventory-higherarchy-view').then((m) => m.InventoryHigherarchyView),
        canActivate: [authGuard],
    },
    {
        path: 'parts',
        loadComponent: () =>
            import('./components/inventory/parts-table-view/parts-table-view').then((m) => m.PartsTableView),
        canActivate: [authGuard],
    },
    {
        path: 'orders',
        loadComponent: () =>
            import('./components/orders/orders-list-view/orders-list-view').then((m) => m.OrdersListView),
        canActivate: [authGuard],
    },
    {
        path: 'orders/:id',
        loadComponent: () =>
            import('./components/orders/order-view/order-view').then((m) => m.OrderView),
        canActivate: [authGuard],
    }
];
