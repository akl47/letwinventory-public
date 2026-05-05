import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { NotificationService } from '../../../services/notification.service';
import { AuthService, ApiKey, Session } from '../../../services/auth.service';
import { AdminService } from '../../../services/admin.service';
import { PushSubscriptionRecord } from '../../../models/notification.model';
import { Permission } from '../../../models/permission.model';
import { ApiKeyCreateDialog } from '../api-key-create-dialog/api-key-create-dialog';
import { PermissionGridComponent } from '../../admin/permission-grid/permission-grid';

@Component({
    selector: 'app-settings-page',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        MatButtonModule,
        MatIconModule,
        MatExpansionModule,
        MatTooltipModule,
        MatDialogModule,
        MatFormFieldModule,
        MatInputModule,
        PermissionGridComponent,
    ],
    templateUrl: './settings-page.html',
    styleUrl: './settings-page.css',
})
export class SettingsPage implements OnInit {
    private location = inject(Location);
    private notificationService = inject(NotificationService);
    private authService = inject(AuthService);
    private adminService = inject(AdminService);
    private dialog = inject(MatDialog);

    permissionState = signal<NotificationPermission>('default');
    subscriptions = signal<PushSubscriptionRecord[]>([]);
    loading = signal(false);
    thisDeviceRegistered = signal(false);
    testSending = signal(false);
    testResult = signal<string>('');

    sessions = signal<Session[]>([]);
    currentSessionId = signal<number | null>(null);

    apiKeys = signal<ApiKey[]>([]);
    allPermissions = signal<Permission[]>([]);
    totalPermissions = signal(0);

    myPermissionIds = signal<Set<number>>(new Set());
    myPermissionCount = computed(() => this.myPermissionIds().size);
    permissionTooltips = signal<Record<string, string>>({});

    githubPATConfigured = signal(false);
    githubPATInput = signal('');
    githubPATSaving = signal(false);
    githubPATError = signal<string | null>(null);

    ngOnInit() {
        this.permissionState.set(this.notificationService.getPermissionState());
        this.loadSubscriptions();
        this.loadSessions();
        this.loadApiKeys();
        this.loadGithubPATStatus();
        this.adminService.getPermissions().subscribe({
            next: (perms) => {
                this.allPermissions.set(perms);
                this.totalPermissions.set(perms.length);
                const userPerms = this.authService.permissions();
                const ids = new Set<number>();
                for (const p of perms) {
                    if (userPerms.has(`${p.resource}.${p.action}`)) {
                        ids.add(p.id);
                    }
                }
                this.myPermissionIds.set(ids);
            }
        });
        this.authService.getMyPermissionSources().subscribe({
            next: (sourceMap) => {
                const tooltips: Record<string, string> = {};
                for (const [key, sources] of Object.entries(sourceMap)) {
                    tooltips[key] = 'Granted by: ' + sources.join(', ');
                }
                this.permissionTooltips.set(tooltips);
            }
        });
    }

    private loadSubscriptions() {
        this.notificationService.getSubscriptions().subscribe({
            next: (subs) => {
                this.subscriptions.set(subs);
                this.checkThisDevice(subs);
            }
        });
    }

    private async checkThisDevice(subs: PushSubscriptionRecord[]) {
        if (!('serviceWorker' in navigator)) return;
        const reg = await navigator.serviceWorker.ready;
        const browserSub = await reg.pushManager.getSubscription();
        if (!browserSub) {
            this.thisDeviceRegistered.set(false);
            return;
        }
        const match = subs.some(s => s.endpoint === browserSub.endpoint);
        this.thisDeviceRegistered.set(match);
    }

    goBack() {
        this.location.back();
    }

    async enableNotifications() {
        this.loading.set(true);
        try {
            const record = await this.notificationService.subscribeToPush();
            this.permissionState.set(this.notificationService.getPermissionState());
            if (record) {
                this.loadSubscriptions();
            }
        } finally {
            this.loading.set(false);
        }
    }

    sendTestNotification() {
        this.testSending.set(true);
        this.testResult.set('');
        this.notificationService.sendTestNotification().subscribe({
            next: (result: any) => {
                this.testResult.set(result.sent > 0 ? 'sent' : 'error');
                this.testSending.set(false);
            },
            error: () => {
                this.testResult.set('error');
                this.testSending.set(false);
            }
        });
    }

    removeDevice(sub: PushSubscriptionRecord) {
        this.notificationService.deleteSubscription(sub.id).subscribe({
            next: () => {
                this.subscriptions.update(subs => subs.filter(s => s.id !== sub.id));
                this.checkThisDevice(this.subscriptions());
            }
        });
    }

    getDeviceLabel(userAgent: string | undefined): string {
        if (!userAgent) return 'Unknown device';
        if (userAgent.includes('iPhone') || userAgent.includes('iPad')) return 'iOS Device';
        if (userAgent.includes('Android')) return 'Android Device';
        if (userAgent.includes('Windows')) return 'Windows';
        if (userAgent.includes('Mac')) return 'macOS';
        if (userAgent.includes('Linux')) return 'Linux';
        return 'Browser';
    }

    private loadSessions() {
        this.currentSessionId.set(this.authService.getCurrentSessionId());
        this.authService.getSessions().subscribe({
            next: (sessions) => this.sessions.set(sessions)
        });
    }

    revokeSession(id: number) {
        this.authService.revokeSession(id).subscribe({
            next: () => this.sessions.update(s => s.filter(sess => sess.id !== id))
        });
    }

    isCurrentSession(session: Session): boolean {
        return session.id === this.currentSessionId();
    }

    private loadApiKeys() {
        this.authService.getApiKeys().subscribe({
            next: (keys) => this.apiKeys.set(keys)
        });
    }

    openCreateKeyDialog() {
        const ref = this.dialog.open(ApiKeyCreateDialog, {
            maxHeight: '90vh',
        });
        ref.afterClosed().subscribe((created: boolean) => {
            if (created) {
                this.loadApiKeys();
            }
        });
    }

    revokeApiKey(id: number) {
        this.authService.revokeApiKey(id).subscribe({
            next: () => this.loadApiKeys()
        });
    }

    isExpired(key: ApiKey): boolean {
        return !!key.expiresAt && new Date(key.expiresAt) < new Date();
    }

    private loadGithubPATStatus() {
        this.authService.getGithubPATStatus().subscribe({
            next: (s) => this.githubPATConfigured.set(!!s.configured),
            error: () => this.githubPATConfigured.set(false),
        });
    }

    saveGithubPAT() {
        const pat = this.githubPATInput().trim();
        if (!pat) return;
        this.githubPATSaving.set(true);
        this.githubPATError.set(null);
        this.authService.setGithubPAT(pat).subscribe({
            next: () => {
                this.githubPATConfigured.set(true);
                this.githubPATInput.set('');
                this.githubPATSaving.set(false);
            },
            error: (err) => {
                this.githubPATError.set(err?.error?.error || 'Failed to save token');
                this.githubPATSaving.set(false);
            },
        });
    }

    clearGithubPAT() {
        this.githubPATSaving.set(true);
        this.githubPATError.set(null);
        this.authService.clearGithubPAT().subscribe({
            next: () => {
                this.githubPATConfigured.set(false);
                this.githubPATInput.set('');
                this.githubPATSaving.set(false);
            },
            error: (err) => {
                this.githubPATError.set(err?.error?.error || 'Failed to clear token');
                this.githubPATSaving.set(false);
            },
        });
    }
}
