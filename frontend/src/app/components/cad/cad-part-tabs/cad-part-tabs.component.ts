import { Component, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CadTabsService } from '../../../services/cad-tabs.service';
import { tabLabel } from '../../../cad/lib/cadTabs';

/** REQ 1002 — open parts/assemblies; click to switch, x / middle-click to
 * close, + opens the CAD landing page to create or find another part. */
@Component({
  selector: 'app-cad-part-tabs',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule],
  template: `
    <div class="part-tabs" data-testid="cad-part-tabs">
      @for (t of cadTabs.tabs(); track t.partID) {
        <div class="part-tab" [class.active]="t.partID === activePartID()" [attr.data-testid]="'cad-part-tab-' + t.partID"
             [matTooltip]="tabLabel(t)" matTooltipShowDelay="600"
             (click)="t.partID !== activePartID() && cadTabs.switchTo(t)"
             (auxclick)="$event.button === 1 && cadTabs.close(t.partID, activePartID())">
          <mat-icon>{{ t.assembly ? 'account_tree' : 'view_in_ar' }}</mat-icon>
          <span class="part-tab-name">{{ tabLabel(t) }}</span>
          <button class="part-tab-close" aria-label="Close tab"
                  (click)="$event.stopPropagation(); cadTabs.close(t.partID, activePartID())"><mat-icon>close</mat-icon></button>
        </div>
      }
      <button class="part-tab-add" [class.active]="activePartID() === null" data-testid="cad-part-tab-add"
              matTooltip="Open or create a part" (click)="openLanding()"><mat-icon>add</mat-icon></button>
    </div>
  `,
  styles: [`
    /* Fixed height: the strip must never change size as tabs come and go —
       a shifting viewer offsets every canvas click (sketch picks miss). */
    :host { display: block; flex: 0 0 auto; }
    .part-tabs { display: flex; box-sizing: border-box; height: 29px; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; background: #181825; border-bottom: 1px solid #333; }
    .part-tab, .part-tab-add { box-sizing: border-box; height: 28px; flex-shrink: 0; }
    .part-tab { display: flex; align-items: center; gap: 6px; max-width: 240px; padding: 4px 4px 4px 10px; font-size: 12px; color: #aaa; cursor: pointer; border-right: 1px solid #333; white-space: nowrap; }
    .part-tab:hover, .part-tab-add:hover { background: #24243a; color: #ddd; }
    .part-tab.active, .part-tab-add.active { background: #1e1e2e; color: #fff; box-shadow: inset 0 2px 0 #42a5f5; cursor: default; }
    .part-tab > mat-icon { font-size: 15px; width: 15px; height: 15px; flex-shrink: 0; }
    .part-tab-name { overflow: hidden; text-overflow: ellipsis; }
    .part-tab-close { display: flex; padding: 2px; border: 0; border-radius: 3px; background: none; color: inherit; cursor: pointer; opacity: 0.6; }
    .part-tab-close:hover { opacity: 1; background: #3a3a55; }
    .part-tab-close mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .part-tab-add { display: flex; align-items: center; padding: 4px 8px; border: 0; background: none; color: #aaa; cursor: pointer; }
    .part-tab-add mat-icon { font-size: 18px; width: 18px; height: 18px; }
  `],
})
export class CadPartTabsComponent {
  readonly cadTabs = inject(CadTabsService);
  private router = inject(Router);
  /** The part shown in the editor; null on the landing page (the + tab is active). */
  activePartID = input<number | null>(null);
  readonly tabLabel = tabLabel;

  openLanding() {
    if (this.activePartID() !== null) this.router.navigate(['/design/cad']);
  }
}
