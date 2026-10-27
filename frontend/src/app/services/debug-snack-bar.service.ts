import { Component, Injectable, inject, signal } from '@angular/core';
import {
  MAT_SNACK_BAR_DATA,
  MatSnackBar,
  MatSnackBarAction,
  MatSnackBarActions,
  MatSnackBarConfig,
  MatSnackBarLabel,
  MatSnackBarRef,
  TextOnlySnackBar,
} from '@angular/material/snack-bar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

/** Snackbar body used while debug mode is on: the usual message + action,
 * plus a copy button that puts the message text on the clipboard (REQ 898). */
@Component({
  selector: 'app-copy-snack-bar',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatSnackBarLabel, MatSnackBarActions, MatSnackBarAction],
  template: `
    <div matSnackBarLabel>{{ data.message }}</div>
    <div matSnackBarActions class="copy-snack-actions">
      <button mat-icon-button matSnackBarAction (click)="copy()"
              aria-label="Copy message" data-testid="snackbar-copy">
        <mat-icon>{{ copied() ? 'check' : 'content_copy' }}</mat-icon>
      </button>
      @if (data.action) {
        <button mat-button matSnackBarAction (click)="snackBarRef.dismissWithAction()">
          {{ data.action }}
        </button>
      }
    </div>
  `,
  styles: [`
    .copy-snack-actions { display: flex; align-items: center; }
  `],
})
export class CopySnackBarComponent {
  readonly snackBarRef = inject<MatSnackBarRef<CopySnackBarComponent>>(MatSnackBarRef);
  readonly data = inject<{ message: string; action: string | undefined }>(MAT_SNACK_BAR_DATA);
  readonly copied = signal(false);

  copy(): void {
    const text = this.data.message;
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(fallback);
    } else {
      fallback();
    }
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 1500);
  }
}

/** Drop-in MatSnackBar replacement (provided in app.config.ts) so every
 * snackbar in the app — the ErrorNotificationService ones and the direct
 * MatSnackBar injections alike — goes through one chokepoint (REQ 898):
 * - every message is logged to the console, severity picked from the
 *   panel class the callers already set (error-/warning-snackbar);
 * - while debug mode is on (the same localStorage switch the CAD debug
 *   footer uses), the snackbar gains a copy-message button. */
@Injectable()
export class DebugSnackBar extends MatSnackBar {
  override open(
    message: string,
    action?: string,
    config?: MatSnackBarConfig,
  ): MatSnackBarRef<TextOnlySnackBar> {
    const classes = Array.isArray(config?.panelClass)
      ? config.panelClass
      : config?.panelClass ? [config.panelClass] : [];
    if (classes.includes('error-snackbar')) {
      console.error('[snackbar]', message);
    } else if (classes.includes('warning-snackbar')) {
      console.warn('[snackbar]', message);
    } else {
      console.log('[snackbar]', message);
    }

    if (localStorage.getItem('cadDebugVisible') === '1') {
      return this.openFromComponent(CopySnackBarComponent, {
        ...config,
        data: { message, action },
      }) as unknown as MatSnackBarRef<TextOnlySnackBar>;
    }
    return super.open(message, action, config);
  }
}
