import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { PushSubscriptionRecord } from '../models/notification.model';
import { environment } from '../../environments/environment';

@Injectable({
    providedIn: 'root'
})
export class NotificationService {
    private http = inject(HttpClient);
    private configUrl = `${environment.apiUrl}/config`;

    getVapidPublicKey(): Observable<{ publicKey: string }> {
        return this.http.get<{ publicKey: string }>(`${this.configUrl}/vapid-public-key`);
    }

    getSubscriptions(): Observable<PushSubscriptionRecord[]> {
        return this.http.get<PushSubscriptionRecord[]>(`${this.configUrl}/push-subscription`);
    }

    saveSubscription(subscription: PushSubscription, userAgent: string): Observable<PushSubscriptionRecord> {
        const json = subscription.toJSON();
        return this.http.post<PushSubscriptionRecord>(`${this.configUrl}/push-subscription`, {
            endpoint: json.endpoint,
            keys: json.keys,
            userAgent
        });
    }

    deleteSubscription(id: number): Observable<any> {
        return this.http.delete(`${this.configUrl}/push-subscription/${id}`);
    }

    sendTestNotification(): Observable<any> {
        return this.http.post(`${this.configUrl}/test-notification`, {});
    }

    async subscribeToPush(): Promise<PushSubscriptionRecord | null> {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return null;

        const registration = await navigator.serviceWorker.ready;

        // Unsubscribe any existing subscription to ensure fresh VAPID key pairing
        const existing = await registration.pushManager.getSubscription();
        if (existing) {
            await existing.unsubscribe();
        }

        const keyResponse = await this.getVapidPublicKey().toPromise();
        if (!keyResponse) return null;

        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: this.urlBase64ToUint8Array(keyResponse.publicKey)
        });

        const record = await this.saveSubscription(subscription, navigator.userAgent).toPromise();
        return record || null;
    }

    async unsubscribeFromPush(): Promise<void> {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
            await subscription.unsubscribe();
        }
    }

    getPermissionState(): NotificationPermission {
        return typeof Notification !== 'undefined' ? Notification.permission : 'denied';
    }

    private urlBase64ToUint8Array(base64String: string): ArrayBuffer {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray.buffer as ArrayBuffer;
    }
}
