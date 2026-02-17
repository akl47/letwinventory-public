import { ChangeDetectionStrategy, Component, inject, signal, computed, OnInit, OnDestroy, ElementRef, HostListener } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet, NavigationEnd } from '@angular/router';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DOCUMENT } from '@angular/common';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { AuthService } from '../../../services/auth.service';
import { TaskViewPreferencesService } from '../../../services/task-view-preferences.service';
import { environment } from '../../../../environments/environment';
import { APP_VERSION } from '../../../../environments/version';

type NavGroup = 'inventory' | 'design' | 'admin';

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
export class NavComponent implements OnInit, OnDestroy {
    private readonly document = inject(DOCUMENT);
    private readonly authService = inject(AuthService);
    private readonly router = inject(Router);
    private readonly taskViewPreferences = inject(TaskViewPreferencesService);
    private readonly elementRef = inject(ElementRef);
    private routerSub?: Subscription;
    protected readonly isSidenavCollapsed = signal(false);
    protected readonly isMobileRoute = signal(false);
    protected readonly isAuthenticated = this.authService.isAuthenticated;
    protected readonly currentUser = this.authService.currentUser;
    protected readonly isDev = !environment.production;
    protected readonly appVersion = APP_VERSION;
    protected readonly openGroup = signal<NavGroup | null>(null);

    private readonly inventoryPrefixes = ['/inventory', '/parts', '/equipment', '/orders'];
    private readonly designPrefixes = ['/requirements', '/harness'];
    private readonly adminPrefixes = ['/admin'];
    protected readonly hasTasksAccess = computed(() => this.authService.hasAnyPermission('tasks'));
    protected readonly hasProjectsAccess = computed(() => this.authService.hasAnyPermission('projects'));
    protected readonly hasPartsAccess = computed(() => this.authService.hasAnyPermission('parts'));
    protected readonly hasInventoryAccess = computed(() => this.authService.hasAnyPermission('inventory'));
    protected readonly hasEquipmentAccess = computed(() => this.authService.hasAnyPermission('equipment'));
    protected readonly hasOrdersAccess = computed(() => this.authService.hasAnyPermission('orders'));
    protected readonly hasDesignAccess = computed(() => this.authService.hasAnyPermission('requirements'));
    protected readonly hasHarnessAccess = computed(() => this.authService.hasAnyPermission('harness'));
    protected readonly hasAdminAccess = computed(() => this.authService.hasAnyPermission('admin'));
    protected readonly hasInventoryGroupAccess = computed(() => this.hasPartsAccess() || this.hasInventoryAccess() || this.hasEquipmentAccess() || this.hasOrdersAccess());
    protected readonly hasDesignGroupAccess = computed(() => this.hasDesignAccess() || this.hasHarnessAccess());
    protected readonly isImpersonating = this.authService.isImpersonating;

    ngOnInit() {
        if (window.innerWidth <= 768) {
            this.isSidenavCollapsed.set(true);
        }
        this.isMobileRoute.set(this.router.url.startsWith('/mobile'));
        this.routerSub = this.router.events
            .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
            .subscribe((e) => {
                this.isMobileRoute.set(e.urlAfterRedirects.startsWith('/mobile'));
                this.openGroup.set(null);
            });
    }

    ngOnDestroy() {
        this.routerSub?.unsubscribe();
    }

    @HostListener('document:click', ['$event'])
    onDocumentClick(event: MouseEvent) {
        if (this.openGroup() && !this.elementRef.nativeElement.querySelector('.nav-rail-wrapper')?.contains(event.target as Node)) {
            this.openGroup.set(null);
        }
    }

    toggleSidenav() {
        this.isSidenavCollapsed.update((collapsed) => !collapsed);
        if (this.isSidenavCollapsed()) {
            this.openGroup.set(null);
        }
    }

    toggleGroup(group: NavGroup) {
        this.openGroup.update(current => current === group ? null : group);
    }

    closePanel() {
        this.openGroup.set(null);
    }

    isGroupActive(group: NavGroup): boolean {
        const url = this.router.url;
        const prefixMap = { inventory: this.inventoryPrefixes, design: this.designPrefixes, admin: this.adminPrefixes };
        return prefixMap[group].some(p => url.startsWith(p));
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

    stopImpersonating() {
        this.authService.stopImpersonating();
    }

    openSettings() {
        this.router.navigate(['/settings']);
    }
}
