import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { ApiKeyRegenerateDialog, ApiKeyRegenerateDialogData } from './api-key-regenerate-dialog';
import { AuthService } from '../../../services/auth.service';

function setup(data: ApiKeyRegenerateDialogData): { component: ApiKeyRegenerateDialog; fixture: ComponentFixture<ApiKeyRegenerateDialog>; authService: AuthService; dialogRef: MatDialogRef<ApiKeyRegenerateDialog> } {
  const dialogRef = { close: vi.fn() } as unknown as MatDialogRef<ApiKeyRegenerateDialog>;

  TestBed.configureTestingModule({
    imports: [ApiKeyRegenerateDialog],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideAnimationsAsync(),
      provideRouter([]),
      { provide: MatDialogRef, useValue: dialogRef },
      { provide: MAT_DIALOG_DATA, useValue: data },
    ],
  });

  const fixture = TestBed.createComponent(ApiKeyRegenerateDialog);
  const component = fixture.componentInstance;
  const authService = TestBed.inject(AuthService);
  fixture.detectChanges();
  return { component, fixture, authService, dialogRef };
}

function daysFromNow(days: number): number {
  return Date.now() + days * 86400000;
}

describe('ApiKeyRegenerateDialog', () => {
  it('creates', () => {
    const { component } = setup({ id: 1, name: 'X', expiresAt: null });
    expect(component).toBeTruthy();
  });

  it('defaults the picker to never when the original key has no expiration', () => {
    const { component } = setup({ id: 1, name: 'X', expiresAt: null });
    expect(component.expirationMode).toBe('never');
    expect(component.customExpiresAt).toBeNull();
  });

  it('defaults the picker to a custom date matching the original expiration', () => {
    const orig = '2027-09-12T00:00:00Z';
    const { component } = setup({ id: 1, name: 'X', expiresAt: orig });
    expect(component.expirationMode).toBe('date');
    // Compare by epoch ms to ignore millisecond serialization variants.
    expect(component.customExpiresAt?.getTime()).toBe(new Date(orig).getTime());
  });

  it.each([
    ['7d', 7],
    ['30d', 30],
    ['60d', 60],
    ['90d', 90],
  ])('sends expiresAt ~%s days for mode %s', (mode, days) => {
    const { component, authService } = setup({ id: 42, name: 'Y', expiresAt: null });
    const spy = vi.spyOn(authService, 'regenerateApiKey').mockReturnValue(
      of({ id: 99, name: 'Y', key: 'lwinv_new', createdAt: '2026-01-01', expiresAt: null, permissions: [] })
    );
    component.expirationMode = mode as any;
    component.regenerate();

    expect(spy).toHaveBeenCalled();
    const [id, body] = spy.mock.calls[0];
    expect(id).toBe(42);
    expect(body?.expiresAt).toBeDefined();
    const actualMs = new Date(body!.expiresAt!).getTime();
    expect(Math.abs(actualMs - daysFromNow(days))).toBeLessThan(5000);
  });

  it('sends expiresAt=null for mode never', () => {
    const { component, authService } = setup({ id: 5, name: 'Z', expiresAt: '2027-01-01T00:00:00Z' });
    const spy = vi.spyOn(authService, 'regenerateApiKey').mockReturnValue(
      of({ id: 6, name: 'Z', key: 'lwinv_new', createdAt: '2026-01-01', expiresAt: null, permissions: [] })
    );
    component.expirationMode = 'never';
    component.regenerate();

    expect(spy.mock.calls[0][1]).toEqual({ expiresAt: null });
  });

  it('sends the picked custom date in ISO form for mode date', () => {
    const { component, authService } = setup({ id: 3, name: 'C', expiresAt: null });
    const spy = vi.spyOn(authService, 'regenerateApiKey').mockReturnValue(
      of({ id: 4, name: 'C', key: 'lwinv_new', createdAt: '2026-01-01', expiresAt: null, permissions: [] })
    );
    component.expirationMode = 'date';
    const picked = new Date('2027-06-15T12:00:00Z');
    component.customExpiresAt = picked;
    component.regenerate();

    expect(spy.mock.calls[0][1]).toEqual({ expiresAt: picked.toISOString() });
  });

  it('stores the new raw key after success and reveals it', () => {
    const { component, authService } = setup({ id: 7, name: 'K', expiresAt: null });
    vi.spyOn(authService, 'regenerateApiKey').mockReturnValue(
      of({ id: 8, name: 'K', key: 'lwinv_after', createdAt: '2026-01-01', expiresAt: null, permissions: [] })
    );
    component.regenerate();
    expect(component.newKey()).toBe('lwinv_after');
    expect(component.busy()).toBe(false);
  });
});
