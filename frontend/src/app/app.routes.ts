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
    }
];
