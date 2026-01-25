import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DOCUMENT } from '@angular/common';
import { AuthService } from '../../../services/auth.service';
import { TaskViewPreferencesService } from '../../../services/task-view-preferences.service';
import { environment } from '../../../../environments/environment';

@Component({
    selector: 'app-nav',
    templateUrl: './nav.component.html',
    styleUrl: './nav.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        RouterOutlet,
        RouterLink,
        RouterLinkActive,
        MatSidenavModule,
        MatListModule,
        MatIconModule,
        MatToolbarModule,
        MatButtonModule,
        MatTooltipModule,
    ],
})
export class NavComponent {
    private readonly document = inject(DOCUMENT);
    private readonly authService = inject(AuthService);
    private readonly router = inject(Router);
    private readonly taskViewPreferences = inject(TaskViewPreferencesService);
    protected readonly isSidenavCollapsed = signal(false);
    protected readonly isAuthenticated = this.authService.isAuthenticated;
    protected readonly currentUser = this.authService.currentUser;
    protected readonly isDev = !environment.production;

    toggleSidenav() {
        this.isSidenavCollapsed.update((collapsed) => !collapsed);
    }

    navigateToTasks(event: Event) {
        event.preventDefault();
        const defaultParams = this.taskViewPreferences.getDefaultViewQueryParams();
        if (defaultParams) {
            this.router.navigate(['/tasks'], { queryParams: defaultParams });
        } else {
            this.router.navigate(['/tasks']);
        }
    }

    login() {
        this.document.location.href = `${environment.apiUrl}/auth/google`;
    }

    logout() {
        this.authService.logout();
    }
}

