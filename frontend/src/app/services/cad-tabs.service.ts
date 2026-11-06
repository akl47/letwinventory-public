import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CadTab, closeTab, moveTab, openTab, parseTabs, tabLink } from '../cad/lib/cadTabs';

const STORAGE_KEY = 'cad-editor-tabs';

/** REQ 1002 — open-parts tab strip state, persisted per browser. */
@Injectable({ providedIn: 'root' })
export class CadTabsService {
  private router = inject(Router);
  readonly tabs = signal<CadTab[]>(this.restore());

  open(tab: CadTab) { this.set(openTab(this.tabs(), tab)); }

  move(from: number, to: number) { this.set(moveTab(this.tabs(), from, to)); }

  close(partID: number, activePartID: number | null) {
    const r = closeTab(this.tabs(), partID, activePartID);
    this.set(r.tabs);
    if (partID !== activePartID) return;
    if (r.next) this.switchTo(r.next);
    else this.router.navigate(['/design/cad']);
  }

  /** The editor reads its route once per part, so hop through the landing
   * page (URL unchanged) to get a freshly constructed editor for the target. */
  switchTo(tab: CadTab) {
    const { commands, queryParams } = tabLink(tab);
    this.router.navigateByUrl('/design/cad', { skipLocationChange: true })
      .then(() => this.router.navigate(commands, { queryParams }));
  }

  private set(tabs: CadTab[]) {
    this.tabs.set(tabs);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs)); } catch { /* storage unavailable */ }
  }

  private restore(): CadTab[] {
    try { return parseTabs(localStorage.getItem(STORAGE_KEY)); } catch { return []; }
  }
}
