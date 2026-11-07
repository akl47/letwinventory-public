import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { CadNewPartDialogComponent } from '../components/cad/cad-new-part-dialog/cad-new-part-dialog.component';
import { ClipboardBundle, parseBundle, serializeBundle } from '../cad/lib/clipboard';
import { ErrorNotificationService } from './error-notification.service';
import { CadModelService } from './cad-model.service';

/** REQ 1011–1013 — OS-clipboard transport + paste-as-new-part. Uses the DOM
 * copy/paste events (not navigator.clipboard) so it works on plain-http
 * origins, which lets a copy move between prod and dev. */
@Injectable({ providedIn: 'root' })
export class CadClipboardService {
  private dialog = inject(MatDialog);
  private errors = inject(ErrorNotificationService);
  private cadApi = inject(CadModelService);

  /** Server NAMING_VERSION, stamped into copies and compared on paste. */
  namingVersion: number | null = null;
  constructor() { void this.loadNamingVersion(); }

  private async loadNamingVersion(): Promise<number | null> {
    if (this.namingVersion === null) {
      try { this.namingVersion = (await firstValueFrom(this.cadApi.getKernelStatus())).namingVersion ?? null; } catch { /* unknown → no warning */ }
    }
    return this.namingVersion;
  }

  /** Must run inside a user gesture (click). */
  copy(bundle: ClipboardBundle): boolean {
    const text = serializeBundle(bundle);
    const onCopy = (e: ClipboardEvent) => { e.clipboardData?.setData('text/plain', text); e.preventDefault(); };
    document.addEventListener('copy', onCopy);
    try { return document.execCommand('copy'); } catch { return false; } finally { document.removeEventListener('copy', onCopy); }
  }

  /** Paste events from inputs/textareas belong to the field, not the CAD clipboard. */
  isFieldPaste(e: ClipboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  /** Parse pasted/imported text. Null = not a CAD bundle at all (the caller
   * decides whether to say so); errors are already shown. */
  parse(text: string): { bundle: ClipboardBundle; warning?: string } | null {
    const r = parseBundle(text, this.namingVersion);
    if (!r) return null;
    if ('error' in r) { this.errors.showError(r.error); return null; }
    return r;
  }

  /** Open the Paste part dialog for a parsed bundle. */
  async openPasteDialog(bundle: ClipboardBundle): Promise<void> {
    const r = parseBundle(serializeBundle(bundle), await this.loadNamingVersion());
    if (r && 'warning' in r && r.warning) this.errors.showInfo(r.warning, 8000);
    this.dialog.open(CadNewPartDialogComponent, { data: { mode: 'part', seed: bundle }, autoFocus: false });
  }

  /** Landing page: pasted/imported text → Paste part dialog. False when the
   * text isn't a CAD bundle. */
  pasteAsNewPart(text: string): boolean {
    const r = parseBundle(text, null);
    if (!r) return false;
    if ('error' in r) { this.errors.showError(r.error); return true; }
    void this.openPasteDialog(r.bundle);
    return true;
  }
}
