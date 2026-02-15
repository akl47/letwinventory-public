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
import { PushSubscriptionRecord } from '../../../models/notification.model';

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
});
