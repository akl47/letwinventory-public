import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
    { path: '', redirectTo: 'home', pathMatch: 'full' },
    {
        path: 'page1',
        loadComponent: () =>
            import('./components/pages/page1/page1.component').then((m) => m.Page1Component),
    },
    {
        path: 'tasks',
        loadComponent: () =>
            import('./components/tasks/task-list-view/task-list-view').then((m) => m.TaskListViewComponent),
    },
    {
        path: 'page3',
        loadComponent: () =>
            import('./components/pages/page3/page3.component').then((m) => m.Page3Component),
        canActivate: [authGuard],
    },
];
