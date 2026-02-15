import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { vi } from 'vitest';
import { NotificationService } from './notification.service';

const API_URL = 'https://dev.letwin.co/api/config';

describe('NotificationService', () => {
    let service: NotificationService;
    let httpMock: HttpTestingController;

    beforeEach(() => {
        // Mock browser Notification API (not available in test environment)
        globalThis.Notification = {
            permission: 'default',
            requestPermission: vi.fn().mockResolvedValue('default'),
        } as unknown as typeof Notification;

        TestBed.configureTestingModule({
            providers: [provideHttpClient(), provideHttpClientTesting()]
        });
        service = TestBed.inject(NotificationService);
        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
        httpMock.verify();
    });

    describe('getVapidPublicKey', () => {
        it('should GET /config/vapid-public-key', () => {
            const mockResponse = { publicKey: 'test-vapid-key' };

            service.getVapidPublicKey().subscribe(result => {
                expect(result.publicKey).toBe('test-vapid-key');
            });

            const req = httpMock.expectOne(`${API_URL}/vapid-public-key`);
            expect(req.request.method).toBe('GET');
            req.flush(mockResponse);
        });
    });

    describe('getSubscriptions', () => {
        it('should GET /config/push-subscription', () => {
            const mockSubs = [{ id: 1, endpoint: 'https://push.example.com', userID: 1 }];

            service.getSubscriptions().subscribe(result => {
                expect(result.length).toBe(1);
            });

            const req = httpMock.expectOne(`${API_URL}/push-subscription`);
            expect(req.request.method).toBe('GET');
            req.flush(mockSubs);
        });
    });

    describe('saveSubscription', () => {
        it('should POST subscription data to /config/push-subscription', () => {
            const mockSubscription = {
                toJSON: () => ({
                    endpoint: 'https://push.example.com/sub/123',
                    keys: { p256dh: 'key1', auth: 'key2' }
                })
            } as unknown as PushSubscription;

            service.saveSubscription(mockSubscription, 'Mozilla/5.0 Test').subscribe(result => {
                expect(result.id).toBe(1);
            });

            const req = httpMock.expectOne(`${API_URL}/push-subscription`);
            expect(req.request.method).toBe('POST');
            expect(req.request.body).toEqual({
                endpoint: 'https://push.example.com/sub/123',
                keys: { p256dh: 'key1', auth: 'key2' },
                userAgent: 'Mozilla/5.0 Test'
            });
            req.flush({ id: 1, endpoint: 'https://push.example.com/sub/123', userID: 1 });
        });
    });

    describe('deleteSubscription', () => {
        it('should DELETE /config/push-subscription/:id', () => {
            service.deleteSubscription(5).subscribe();

            const req = httpMock.expectOne(`${API_URL}/push-subscription/5`);
            expect(req.request.method).toBe('DELETE');
            req.flush(null);
        });
    });

    describe('sendTestNotification', () => {
        it('should POST to /config/test-notification', () => {
            service.sendTestNotification().subscribe();

            const req = httpMock.expectOne(`${API_URL}/test-notification`);
            expect(req.request.method).toBe('POST');
            req.flush({ sent: 0, failed: 0 });
        });
    });

    describe('getPermissionState', () => {
        it('should return notification permission state', () => {
            const state = service.getPermissionState();
            expect(['granted', 'denied', 'default']).toContain(state);
        });
    });

    describe('subscribeToPush', () => {
        it('should return null when permission is denied', async () => {
            vi.spyOn(Notification, 'requestPermission').mockResolvedValue('denied');

            const result = await service.subscribeToPush();
            expect(result).toBeNull();
        });

        it('should subscribe and save when permission is granted', async () => {
            vi.spyOn(Notification, 'requestPermission').mockResolvedValue('granted');

            const mockSubscription = {
                toJSON: () => ({
                    endpoint: 'https://push.example.com/sub/new',
                    keys: { p256dh: 'p256dh-key', auth: 'auth-key' }
                })
            } as unknown as PushSubscription;

            const mockRegistration = {
                pushManager: {
                    getSubscription: () => Promise.resolve(null),
                    subscribe: () => Promise.resolve(mockSubscription)
                }
            };

            Object.defineProperty(navigator, 'serviceWorker', {
                value: { ready: Promise.resolve(mockRegistration) },
                configurable: true
            });

            const subscribePromise = service.subscribeToPush();

            // Flush the VAPID key request
            setTimeout(() => {
                const vapidReq = httpMock.expectOne(`${API_URL}/vapid-public-key`);
                vapidReq.flush({ publicKey: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkGs-GDq6QCyIzdmBV8CGs' });

                // Flush the save subscription request
                setTimeout(() => {
                    const saveReq = httpMock.expectOne(`${API_URL}/push-subscription`);
                    expect(saveReq.request.method).toBe('POST');
                    saveReq.flush({ id: 1, endpoint: 'https://push.example.com/sub/new', userID: 1 });
                }, 0);
            }, 0);

            const result = await subscribePromise;
            expect(result).toBeTruthy();
        });

        it('should unsubscribe existing subscription before creating new one', async () => {
            vi.spyOn(Notification, 'requestPermission').mockResolvedValue('granted');

            const existingUnsubscribe = vi.fn().mockResolvedValue(true);

            const newSubscription = {
                toJSON: () => ({
                    endpoint: 'https://push.example.com/sub/new',
                    keys: { p256dh: 'key', auth: 'auth' }
                })
            } as unknown as PushSubscription;

            const mockRegistration = {
                pushManager: {
                    getSubscription: () => Promise.resolve({ unsubscribe: existingUnsubscribe }),
                    subscribe: () => Promise.resolve(newSubscription)
                }
            };

            Object.defineProperty(navigator, 'serviceWorker', {
                value: { ready: Promise.resolve(mockRegistration) },
                configurable: true
            });

            const subscribePromise = service.subscribeToPush();

            setTimeout(() => {
                const vapidReq = httpMock.expectOne(`${API_URL}/vapid-public-key`);
                vapidReq.flush({ publicKey: 'BEl62iUYgUivxIkv69yViEuiBIa' });

                setTimeout(() => {
                    const saveReq = httpMock.expectOne(`${API_URL}/push-subscription`);
                    saveReq.flush({ id: 2, endpoint: 'https://push.example.com/sub/new', userID: 1 });
                }, 0);
            }, 0);

            await subscribePromise;
            expect(existingUnsubscribe).toHaveBeenCalled();
        });

        it('should return null when vapid key response is null', async () => {
            vi.spyOn(Notification, 'requestPermission').mockResolvedValue('granted');

            const mockRegistration = {
                pushManager: {
                    getSubscription: () => Promise.resolve(null),
                }
            };

            Object.defineProperty(navigator, 'serviceWorker', {
                value: { ready: Promise.resolve(mockRegistration) },
                configurable: true
            });

            const subscribePromise = service.subscribeToPush();

            setTimeout(() => {
                const vapidReq = httpMock.expectOne(`${API_URL}/vapid-public-key`);
                vapidReq.flush(null);
            }, 0);

            const result = await subscribePromise;
            expect(result).toBeNull();
        });
    });

    describe('unsubscribeFromPush', () => {
        it('should unsubscribe existing push subscription', async () => {
            const unsubscribeSpy = vi.fn().mockResolvedValue(true);
            const mockRegistration = {
                pushManager: {
                    getSubscription: () => Promise.resolve({ unsubscribe: unsubscribeSpy })
                }
            };

            Object.defineProperty(navigator, 'serviceWorker', {
                value: { ready: Promise.resolve(mockRegistration) },
                configurable: true
            });

            await service.unsubscribeFromPush();
            expect(unsubscribeSpy).toHaveBeenCalled();
        });

        it('should do nothing when no subscription exists', async () => {
            const mockRegistration = {
                pushManager: {
                    getSubscription: () => Promise.resolve(null)
                }
            };

            Object.defineProperty(navigator, 'serviceWorker', {
                value: { ready: Promise.resolve(mockRegistration) },
                configurable: true
            });

            await expect(service.unsubscribeFromPush()).resolves.toBeUndefined();
        });
    });
});
