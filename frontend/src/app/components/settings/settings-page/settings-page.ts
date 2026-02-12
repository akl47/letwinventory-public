import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { NotificationService } from '../../../services/notification.service';
import { PushSubscriptionRecord } from '../../../models/notification.model';

@Component({
    selector: 'app-settings-page',
    standalone: true,
    imports: [
        CommonModule,
        MatButtonModule,
        MatIconModule,
        MatListModule,
    ],
    templateUrl: './settings-page.html',
    styleUrl: './settings-page.css',
})
export class SettingsPage implements OnInit {
    private location = inject(Location);
    private notificationService = inject(NotificationService);

    permissionState = signal<NotificationPermission>('default');
    subscriptions = signal<PushSubscriptionRecord[]>([]);
    loading = signal(false);
    thisDeviceRegistered = signal(false);
    testSending = signal(false);
    testResult = signal<string>('');

    ngOnInit() {
        this.permissionState.set(this.notificationService.getPermissionState());
        this.loadSubscriptions();
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
}
