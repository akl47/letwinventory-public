import { Injectable, inject, NgZone } from '@angular/core';
import { environment } from '../../environments/environment';
import { TaskService } from './task.service';
import { TAB_ID } from '../utils/tab-id';

@Injectable({
    providedIn: 'root'
})
export class TaskSyncService {
    private readonly taskService = inject(TaskService);
    private readonly ngZone = inject(NgZone);
    private eventSource: EventSource | null = null;

    connect(): void {
        this.disconnect();

        const token = localStorage.getItem('auth_token');
        if (!token) {
            console.log('[TaskSync] connect() — no token, skipping');
            return;
        }

        const url = `${environment.apiUrl}/planning/task/events?token=${encodeURIComponent(token)}&tabId=${encodeURIComponent(TAB_ID)}`;
        console.log('[TaskSync] connect() — opening EventSource, tabId=' + TAB_ID);

        this.ngZone.runOutsideAngular(() => {
            this.eventSource = new EventSource(url);

            this.eventSource.onopen = () => {
                console.log('[TaskSync] EventSource opened, readyState=' + this.eventSource?.readyState);
            };

            this.eventSource.onerror = (err) => {
                console.log('[TaskSync] EventSource error, readyState=' + this.eventSource?.readyState, err);
            };

            this.eventSource.addEventListener('connected', () => {
                console.log('[TaskSync] Received "connected" event from server');
            });

            this.eventSource.addEventListener('tasks-changed', (event: MessageEvent) => {
                const data = JSON.parse(event.data);
                console.log('[TaskSync] Received "tasks-changed" event, sourceTabId=' + data.sourceTabId + ', myTabId=' + TAB_ID);
                if (data.sourceTabId !== TAB_ID) {
                    console.log('[TaskSync] Triggering refresh');
                    this.ngZone.run(() => {
                        this.taskService.triggerRefresh();
                    });
                } else {
                    console.log('[TaskSync] Skipping (own tab)');
                }
            });
        });
    }

    disconnect(): void {
        if (this.eventSource) {
            console.log('[TaskSync] disconnect() — closing EventSource');
            this.eventSource.close();
            this.eventSource = null;
        }
    }
}
