import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { DebugSnackBar } from './debug-snack-bar.service';

// REQ 898 — all snackbars log to the console (severity from panel class);
// debug mode adds a copy-message button.
describe('DebugSnackBar', () => {
  let snackBar: DebugSnackBar;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        { provide: MatSnackBar, useClass: DebugSnackBar },
      ],
    });
    snackBar = TestBed.inject(MatSnackBar) as DebugSnackBar;
    localStorage.removeItem('cadDebugVisible');
  });

  afterEach(() => {
    snackBar.dismiss();
    localStorage.removeItem('cadDebugVisible');
    vi.restoreAllMocks();
  });

  it('logs plain messages via console.log', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    snackBar.open('Saved', 'Close', { duration: 1000 });
    expect(log).toHaveBeenCalledWith('[snackbar]', 'Saved');
  });

  it('logs error-snackbar messages via console.error', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    snackBar.open('Boom', 'Dismiss', { panelClass: ['error-snackbar'] });
    expect(err).toHaveBeenCalledWith('[snackbar]', 'Boom');
  });

  it('logs warning-snackbar messages via console.warn (string panelClass)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    snackBar.open('Careful', undefined, { panelClass: 'warning-snackbar' });
    expect(warn).toHaveBeenCalledWith('[snackbar]', 'Careful');
  });

  it('shows no copy button when debug mode is off', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    snackBar.open('Hello', 'Close');
    expect(document.querySelector('[data-testid="snackbar-copy"]')).toBeNull();
    expect(document.body.textContent).toContain('Hello');
  });

  it('shows a copy button in debug mode that copies the message', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    localStorage.setItem('cadDebugVisible', '1');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    snackBar.open('Copy me', 'Close');
    const btn = document.querySelector('[data-testid="snackbar-copy"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    btn.click();
    expect(writeText).toHaveBeenCalledWith('Copy me');
    // Original action button still present alongside the copy button.
    expect(document.body.textContent).toContain('Close');
  });

  it('keeps the action button working in debug mode', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    localStorage.setItem('cadDebugVisible', '1');
    const ref = snackBar.open('With action', 'Undo');
    const dismissed = vi.fn();
    ref.onAction().subscribe(dismissed);
    const buttons = Array.from(document.querySelectorAll('button'));
    const actionBtn = buttons.find(b => b.textContent?.includes('Undo'));
    expect(actionBtn).toBeTruthy();
    actionBtn!.click();
    expect(dismissed).toHaveBeenCalled();
  });
});
