import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { DOCUMENT } from '@angular/common';

@Component({
    selector: 'app-nav',
    templateUrl: './nav.component.html',
    styleUrl: './nav.component.css',
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
    ],
})
export class NavComponent {
    private readonly document = inject(DOCUMENT);
    protected readonly isSidenavOpen = signal(true);

    toggleSidenav() {
        this.isSidenavOpen.update((open) => !open);
    }

    login() {
        this.document.location.href = 'http://localhost:3000/api/auth/google';
    }
}

