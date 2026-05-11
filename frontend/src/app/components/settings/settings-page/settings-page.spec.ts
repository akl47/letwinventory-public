import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { Location } from '@angular/common';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { SettingsPage } from './settings-page';
import { NotificationService } from '../../../services/notification.service';
import { AuthService, ApiKey } from '../../../services/auth.service';
import { MatDialog } from '@angular/material/dialog';
import { PushSubscriptionRecord } from '../../../models/notification.model';
import { ApiKeyRegenerateDialog } from '../api-key-regenerate-dialog/api-key-regenerate-dialog';

describe('SettingsPage', () => {
  let component: SettingsPage;
  let fixture: ComponentFixture<SettingsPage>;
  let notificationService: NotificationService;
  let location: Location;

  const mockSubscriptions: PushSubscriptionRecord[] = [
    { id: 1, userID: 1, endpoint: 'https://push.example.com/sub1', userAgent: 'Mozilla/5.0 (iPhone)', createdAt: new Date() },
    { id: 2, userID: 1, endpoint: 'https://push.example.com/sub2', userAgent: 'Mozilla/5.0 (Windows NT)', createdAt: new Date() },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAnimationsAsync(),
        provideRouter([]),
      ],
    }).compileComponents();

    notificationService = TestBed.inject(NotificationService);
    location = TestBed.inject(Location);

    vi.spyOn(notificationService, 'getPermissionState').mockReturnValue('default');
    vi.spyOn(notificationService, 'getSubscriptions').mockReturnValue(of(mockSubscriptions));

    fixture = TestBed.createComponent(SettingsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load permission state on init', () => {
    expect(notificationService.getPermissionState).toHaveBeenCalled();
    expect(component.permissionState()).toBe('default');
  });

  it('should load subscriptions on init', () => {
    expect(notificationService.getSubscriptions).toHaveBeenCalled();
    expect(component.subscriptions().length).toBe(2);
  });

  describe('goBack', () => {
    it('should call location.back', () => {
      vi.spyOn(location, 'back');
      component.goBack();
      expect(location.back).toHaveBeenCalled();
    });
  });

  describe('getDeviceLabel', () => {
    it('should return "iOS Device" for iPhone', () => {
      expect(component.getDeviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS)')).toBe('iOS Device');
    });

    it('should return "iOS Device" for iPad', () => {
      expect(component.getDeviceLabel('Mozilla/5.0 (iPad; CPU OS)')).toBe('iOS Device');
    });

    it('should return "Android Device" for Android', () => {
      expect(component.getDeviceLabel('Mozilla/5.0 (Linux; Android 12)')).toBe('Android Device');
    });

    it('should return "Windows" for Windows', () => {
      expect(component.getDeviceLabel('Mozilla/5.0 (Windows NT 10.0)')).toBe('Windows');
    });

    it('should return "macOS" for Mac', () => {
      expect(component.getDeviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X)')).toBe('macOS');
    });

    it('should return "Linux" for Linux', () => {
      expect(component.getDeviceLabel('Mozilla/5.0 (X11; Linux x86_64)')).toBe('Linux');
    });

    it('should return "Browser" for unknown user agent', () => {
      expect(component.getDeviceLabel('Mozilla/5.0 (Other)')).toBe('Browser');
    });

    it('should return "Unknown device" for undefined', () => {
      expect(component.getDeviceLabel(undefined)).toBe('Unknown device');
    });
  });

  describe('removeDevice', () => {
    it('should remove subscription and update list', () => {
      vi.spyOn(notificationService, 'deleteSubscription').mockReturnValue(of({}));

      component.removeDevice(mockSubscriptions[0]);

      expect(notificationService.deleteSubscription).toHaveBeenCalledWith(1);
      expect(component.subscriptions().length).toBe(1);
      expect(component.subscriptions()[0].id).toBe(2);
    });
  });

  describe('sendTestNotification', () => {
    it('should set testSending and handle success', () => {
      vi.spyOn(notificationService, 'sendTestNotification').mockReturnValue(of({ sent: 1 }));

      component.sendTestNotification();

      expect(component.testSending()).toBe(false);
      expect(component.testResult()).toBe('sent');
    });

    it('should handle zero sent as error', () => {
      vi.spyOn(notificationService, 'sendTestNotification').mockReturnValue(of({ sent: 0 }));

      component.sendTestNotification();

      expect(component.testResult()).toBe('error');
    });

    it('should handle send failure', () => {
      vi.spyOn(notificationService, 'sendTestNotification').mockReturnValue(throwError(() => new Error('fail')));

      component.sendTestNotification();

      expect(component.testSending()).toBe(false);
      expect(component.testResult()).toBe('error');
    });
  });

  describe('enableNotifications', () => {
    it('should set loading during subscribe and update state', async () => {
      vi.spyOn(notificationService, 'subscribeToPush').mockResolvedValue({ id: 3, userID: 1, endpoint: 'https://new', createdAt: new Date() });

      await component.enableNotifications();

      expect(component.loading()).toBe(false);
      expect(notificationService.getPermissionState).toHaveBeenCalled();
    });

    it('should set loading false even when subscribeToPush returns null', async () => {
      vi.spyOn(notificationService, 'subscribeToPush').mockResolvedValue(null);

      await component.enableNotifications();

      expect(component.loading()).toBe(false);
    });
  });

  describe('initial signal states', () => {
    it('should have loading as false', () => {
      expect(component.loading()).toBe(false);
    });

    it('should have testSending as false', () => {
      expect(component.testSending()).toBe(false);
    });

    it('should have testResult as empty', () => {
      expect(component.testResult()).toBe('');
    });

    it('should have thisDeviceRegistered as false initially', () => {
      // Without service worker, this stays false
      expect(component.thisDeviceRegistered()).toBe(false);
    });
  });

  describe('API key expand & regenerate', () => {
    const mockApiKeys: ApiKey[] = [
      {
        id: 1, name: 'CI Bot', lastUsedAt: null, expiresAt: null,
        createdAt: '2026-01-01T00:00:00Z',
        permissions: [
          { id: 11, resource: 'tasks', action: 'read' },
          { id: 12, resource: 'tasks', action: 'write' },
          { id: 13, resource: 'parts', action: 'read' },
        ],
      },
      {
        id: 2, name: 'Read-only', lastUsedAt: null, expiresAt: null,
        createdAt: '2026-01-02T00:00:00Z',
        permissions: [{ id: 11, resource: 'tasks', action: 'read' }],
      },
    ];

    let openSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
      const authService = TestBed.inject(AuthService);
      vi.spyOn(authService, 'getApiKeys').mockReturnValue(of(mockApiKeys));
      // Spy on the component's own injected dialog reference — TestBed.inject(MatDialog)
      // can resolve to a different instance than the one the component captured via
      // inject() during construction.
      const dialog = (component as unknown as { dialog: MatDialog }).dialog;
      openSpy = vi.spyOn(dialog, 'open').mockReturnValue({
        afterClosed: () => of(false),
      } as any);
      // Component already created; reload api keys with the new mock.
      (component as unknown as { loadApiKeys: () => void })['loadApiKeys']();
      await fixture.whenStable();
      fixture.detectChanges();
    });

    it('starts with all keys collapsed', () => {
      expect(component.isApiKeyExpanded(1)).toBe(false);
      expect(component.isApiKeyExpanded(2)).toBe(false);
    });

    it('toggleApiKeyExpanded flips a single row independently', () => {
      component.toggleApiKeyExpanded(1);
      expect(component.isApiKeyExpanded(1)).toBe(true);
      expect(component.isApiKeyExpanded(2)).toBe(false);
      component.toggleApiKeyExpanded(2);
      expect(component.isApiKeyExpanded(1)).toBe(true);
      expect(component.isApiKeyExpanded(2)).toBe(true);
      component.toggleApiKeyExpanded(1);
      expect(component.isApiKeyExpanded(1)).toBe(false);
      expect(component.isApiKeyExpanded(2)).toBe(true);
    });

    it('renders permission chips only when row is expanded', () => {
      component.apiKeys.set(mockApiKeys);
      fixture.detectChanges();
      // Collapsed: no permission lists rendered
      expect(fixture.nativeElement.querySelectorAll('.permission-chip').length).toBe(0);

      component.toggleApiKeyExpanded(1);
      fixture.detectChanges();
      const chipsAfterFirstExpand = fixture.nativeElement.querySelectorAll('.permission-chip');
      expect(chipsAfterFirstExpand.length).toBe(3);
      const labels = Array.from(chipsAfterFirstExpand).map((c: any) => c.textContent.trim());
      expect(labels).toContain('tasks.read');
      expect(labels).toContain('tasks.write');
      expect(labels).toContain('parts.read');

      component.toggleApiKeyExpanded(2);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelectorAll('.permission-chip').length).toBe(4);
    });

    it('regenerateApiKey opens ApiKeyRegenerateDialog with the key id and name', () => {
      component.regenerateApiKey(mockApiKeys[0]);
      expect(openSpy).toHaveBeenCalled();
      const call = openSpy.mock.calls[openSpy.mock.calls.length - 1];
      expect(call[0]).toBe(ApiKeyRegenerateDialog);
      expect((call[1] as any).data).toEqual({ id: 1, name: 'CI Bot', expiresAt: null });
    });

    it('regenerateApiKey reloads the api key list when the dialog reports success', () => {
      const authService = TestBed.inject(AuthService);
      // Re-mock the dialog to report a successful regenerate this time.
      openSpy.mockReturnValue({ afterClosed: () => of(true) } as any);
      const getKeysSpy = vi.spyOn(authService, 'getApiKeys').mockReturnValue(of(mockApiKeys));
      component.regenerateApiKey(mockApiKeys[0]);
      expect(getKeysSpy).toHaveBeenCalled();
    });
  });
});
