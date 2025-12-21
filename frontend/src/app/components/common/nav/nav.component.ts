import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DOCUMENT } from '@angular/common';
import { AuthService } from '../../../services/auth.service';

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
    protected readonly isSidenavCollapsed = signal(false);
    protected readonly isAuthenticated = this.authService.isAuthenticated;
    protected readonly currentUser = this.authService.currentUser;

    toggleSidenav() {
        this.isSidenavCollapsed.update((collapsed) => !collapsed);
    }

    login() {
        this.document.location.href = 'http://localhost:3000/api/auth/google';
    }

    logout() {
        this.authService.logout();
    }
}

