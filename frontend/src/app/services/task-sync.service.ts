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

        if (typeof EventSource === 'undefined') return;

        const token = localStorage.getItem('auth_token');
        if (!token) return;

        const url = `${environment.apiUrl}/planning/task/events?token=${encodeURIComponent(token)}&tabId=${encodeURIComponent(TAB_ID)}`;

        this.ngZone.runOutsideAngular(() => {
            this.eventSource = new EventSource(url);

            this.eventSource.addEventListener('tasks-changed', (event: MessageEvent) => {
                const data = JSON.parse(event.data);
                if (data.sourceTabId !== TAB_ID) {
                    this.ngZone.run(() => {
                        this.taskService.triggerRefresh();
                    });
                }
            });
        });
    }

    disconnect(): void {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
    }
}
