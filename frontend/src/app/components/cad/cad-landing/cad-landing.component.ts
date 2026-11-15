import { Component, HostListener, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { CadNewPartDialogComponent } from '../cad-new-part-dialog/cad-new-part-dialog.component';
import { CadPartTabsComponent } from '../cad-part-tabs/cad-part-tabs.component';
import { CadTabsService } from '../../../services/cad-tabs.service';
import { harnessLink } from '../../../cad/lib/cadTabs';
import { CadClipboardService } from '../../../services/cad-clipboard.service';
import { CadModelService } from '../../../services/cad-model.service';
import { AssemblyService } from '../../../services/assembly.service';
import { HarnessService } from '../../../services/harness.service';
import { PartEditDialog } from '../../inventory/part-edit-dialog/part-edit-dialog';
import { Part } from '../../../models';
import { createEmptyHarnessData } from '../../../models/harness.model';
import { PartWithCadSummary } from '../../../models/cad-model.model';
import { EligiblePart } from '../../../cad/lib/assembly.types';
import { AuthService } from '../../../services/auth.service';
import { ErrorNotificationService } from '../../../services/error-notification.service';
import { DataTable, DataTableColumnDef, ColumnDef, FilterSection } from '../../common/data-table/data-table';
import { ProjectService } from '../../../services/project.service';
import { Project } from '../../../models/project.model';

/** A landing row: a part / assembly CAD model, or (REQ 1068) a wire harness. */
type LandingRow = PartWithCadSummary & { harnessID?: number };

@Component({
  selector: 'app-cad-landing',
  standalone: true,
  imports: [
    CommonModule, RouterLink, FormsModule,
    MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatProgressSpinnerModule, MatTooltipModule, MatDialogModule,
    DataTable, DataTableColumnDef, CadPartTabsComponent,
  ],
  template: `
    <!-- REQ 1002 — keep the editor's open-parts tabs reachable from here. -->
    @if (cadTabs.tabs().length) { <app-cad-part-tabs /> }
    <div class="cad-landing" data-testid="cad-landing">
      <header class="page-header">
        <mat-icon class="page-icon">view_in_ar</mat-icon>
        <h2>CAD Models</h2>
      </header>

      @if (showPicker()) {
        <section class="picker">
          <p class="hint">Pick an <strong>Assembly-category</strong> part to start an assembly for:</p>
          <mat-form-field appearance="outline" class="picker-search">
            <mat-label>Search parts</mat-label>
            <input matInput [ngModel]="partSearch()" (ngModelChange)="partSearch.set($event)" placeholder="name or revision" />
          </mat-form-field>
          <div class="part-list">
            @for (p of filteredParts(); track p.partID) {
              <button mat-button class="part-row" (click)="startAssembly(p.partID)">
                <mat-icon>account_tree</mat-icon> {{ p.part.name }} <span class="sku">{{ p.part.revision }}</span>
                @if (p.hasAssembly) { <span class="has">has assembly</span> }
              </button>
            }
            @if (filteredParts().length === 0) {
              <p class="empty-parts">No parts in the Assembly category. Set a part's category to “Assembly” to make it eligible.</p>
            }
          </div>
        </section>
      }

      <div *ngIf="loading()" class="loading">
        <mat-spinner diameter="32"></mat-spinner>
      </div>

      <app-data-table *ngIf="!loading()"
        [data]="rows()"
        [columns]="columns"
        [filterSections]="filterSections()"
        [searchKeys]="searchKeys"
        [defaultSort]="{ key: 'updated', dir: 'desc' }"
        searchPlaceholder="Filter by part name, description, or revision"
        (rowClick)="openLatest($event)"
        data-testid="cad-landing-table">

        <div dataTableToolbar>
          <input #lwcadFile type="file" accept=".lwcad,application/json" hidden data-testid="cad-import-file"
                 (change)="importPartFile(lwcadFile)" />
          <button mat-stroked-button (click)="lwcadFile.click()" data-testid="cad-import-part"
                  matTooltip="Create a new part from a .lwcad file. You can also press Ctrl+V here to paste a copied part.">
            <mat-icon>upload_file</mat-icon>
            Import part
          </button>
          @if (canHarness) {
          <button mat-stroked-button (click)="newHarness()" data-testid="cad-new-harness"
                  matTooltip="Create a new wire harness and open it.">
            <mat-icon>cable</mat-icon>
            New harness
          </button>
          }
          <button mat-stroked-button (click)="newPart('assembly')"
                  matTooltip="Create a new assembly part and open it.">
            <mat-icon>account_tree</mat-icon>
            New assembly
          </button>
          <button mat-flat-button color="primary" (click)="newPart('part')"
                  matTooltip="Create a new CAD part and open it.">
            <mat-icon>add</mat-icon>
            New Part
          </button>
        </div>

        <ng-template appColumn="part" let-r>
          <a [routerLink]="r.harnessID ? harnessLink(r.harnessID, r.partID).commands : ['/parts', r.partID, 'cad']"
             [queryParams]="r.harnessID ? harnessLink(r.harnessID, r.partID).queryParams : null" class="part-link" (click)="$event.stopPropagation()">
            <strong>{{ r.part?.name || '(unnamed)' }}</strong>
            <span class="part-rev">·  Rev {{ r.part?.revision }}</span>
          </a>
          <div class="part-desc" *ngIf="r.part?.description">{{ r.part!.description }}</div>
        </ng-template>

        <ng-template appColumn="type" let-r>
          <span class="type-chip" [class.assembly]="r.isAssembly" [class.harness]="!!r.harnessID">
            <mat-icon>{{ r.harnessID ? 'cable' : r.isAssembly ? 'account_tree' : 'view_in_ar' }}</mat-icon>
            {{ r.harnessID ? 'Harness' : r.isAssembly ? 'Assembly' : 'Part' }}
          </span>
        </ng-template>

        <ng-template appColumn="latest" let-r>
          <span class="rev-tag">Rev {{ r.latestRevision }}</span>
          <span class="state-badge"
                [class.draft]="r.latestReleaseState==='draft'"
                [class.review]="r.latestReleaseState==='review'"
                [class.released]="r.latestReleaseState==='released'">
            {{ r.latestReleaseState }}
          </span>
        </ng-template>

        <ng-template appColumn="projects" let-r>
          @if (r.commonPart) { <span class="project-chip common" matTooltip="Common part — available to every project">Common</span> }
          @for (p of rowProjects(r); track p.id) {
            <span class="project-chip" [style.border-color]="'#' + p.tagColorHex" [matTooltip]="p.name">{{ p.shortName || p.name }}</span>
          }
          @if (!r.commonPart && rowProjects(r).length === 0) { <span class="muted">—</span> }
        </ng-template>

        <ng-template appColumn="updated" let-r>{{ r.latestUpdatedAt | date:'short' }}</ng-template>

        <ng-template appColumn="actions" let-r>
          <div class="row-actions" (click)="$event.stopPropagation()">
            <a mat-icon-button *ngIf="!r.harnessID"
               [routerLink]="['/parts', r.partID, 'cad']"
               aria-label="Show history"
               matTooltip="View the version history — graph, branches, diffs">
              <mat-icon>history</mat-icon>
            </a>
            <a mat-stroked-button
               [routerLink]="r.harnessID ? harnessLink(r.harnessID, r.partID).commands : r.isAssembly ? ['/parts', r.partID, 'assembly', 'editor'] : ['/parts', r.partID, 'cad', 'editor']"
               [queryParams]="r.harnessID ? harnessLink(r.harnessID, r.partID).queryParams : r.isAssembly ? null : { revisionID: r.latestRevisionID }"
               [matTooltip]="r.harnessID ? 'Open in the harness editor' : r.isAssembly ? 'Open in the assembly editor' : 'Open the latest revision in the CAD editor'">
              <mat-icon>open_in_new</mat-icon> Open
            </a>
          </div>
        </ng-template>
      </app-data-table>
    </div>
  `,
  styles: [`
    /* The app shell's .content host is overflow:hidden — each page owns its
       own vertical scroll. Matches cad-revision-list. */
    :host { display: block; height: 100%; overflow-y: auto; }
    .cad-landing { padding: 24px; max-width: 1200px; margin: 0 auto; }
    .page-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
    .page-header h2 { margin: 0; }
    .page-icon { font-size: 28px; width: 28px; height: 28px; opacity: 0.8; }
    .loading { display: flex; justify-content: center; padding: 32px; }
    .part-link { text-decoration: none; color: inherit; }
    .part-link strong { font-weight: 600; }
    .part-rev { opacity: 0.6; font-size: 12px; }
    .part-desc { font-size: 12px; opacity: 0.6; max-width: 380px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .rev-tag { display: inline-block; padding: 2px 8px; background: #e8eaf0; color: #2a2a3a; border: 1px solid #c8ccd8; border-radius: 4px; font-family: ui-monospace, monospace; font-size: 12px; font-weight: 600; margin-right: 8px; }
    .row-actions { display: flex; gap: 8px; justify-content: flex-end; align-items: center; }
    .state-badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; text-transform: uppercase; font-weight: 600; white-space: nowrap; display: inline-block; }
    .state-badge.draft { background: #fff3e0; color: #e65100; }
    .state-badge.review { background: #e3f2fd; color: #1565c0; }
    .state-badge.released { background: #e8f5e9; color: #2e7d32; }
    .muted { opacity: 0.4; }
    .type-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 500; background: #e8eaf0; color: #2a2a3a; }
    .type-chip mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .type-chip.assembly { background: #e3f2fd; color: #1565c0; }
    .type-chip.harness { background: #fff3e0; color: #e65100; }
    .project-chip { display: inline-block; margin-right: 4px; padding: 1px 8px; border: 1px solid #9e9e9e; border-left-width: 4px; border-radius: 4px; font-size: 12px; white-space: nowrap; }
    .project-chip.common { border-color: #1565c0; font-weight: 500; }
    .picker { border: 1px solid #ccc; border-radius: 8px; padding: 1rem; margin-bottom: 16px; }
    .picker .hint { margin: 0 0 .5rem; }
    .picker-search { width: 320px; max-width: 100%; }
    .part-list { display: flex; flex-direction: column; max-height: 280px; overflow: auto; }
    .part-row { justify-content: flex-start; }
    .sku { color: #888; margin-left: .5rem; font-size: .85em; }
    .has { margin-left: auto; font-size: .72em; color: #2e7d32; background: #e8f5e9; padding: 1px 6px; border-radius: 8px; }
    .empty-parts { color: #888; padding: .5rem; }
  `],
})
export class CadLandingComponent implements OnInit {
  private cadApi = inject(CadModelService);
  private assemblyApi = inject(AssemblyService);
  private harnessApi = inject(HarnessService);
  private projectApi = inject(ProjectService);
  private auth = inject(AuthService);
  // REQ 1068 — the harness backend is separate, with its own permissions.
  readonly canCad = this.auth.hasAnyPermission('cad');
  readonly canHarness = this.auth.hasAnyPermission('harness');
  private errors = inject(ErrorNotificationService);
  private router = inject(Router);
  private dialog = inject(MatDialog);
  readonly cadTabs = inject(CadTabsService);
  private clipboard = inject(CadClipboardService);

  /** REQ 1013 — Ctrl+V anywhere on the page pastes a copied part, even with
   * the search box focused (a CAD bundle is never meant as a search term). */
  @HostListener('document:paste', ['$event'])
  onPaste(e: ClipboardEvent) {
    if (this.dialog.openDialogs.length) return;
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (this.clipboard.pasteAsNewPart(text)) { e.preventDefault(); return; }
    if (!this.clipboard.isFieldPaste(e)) {
      this.errors.showInfo('The clipboard does not hold a copied CAD part — use Copy part in the part editor first');
    }
  }

  /** REQ 1013 — Import part (.lwcad). */
  importPartFile(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    file.text().then(
      text => { if (!this.clipboard.pasteAsNewPart(text)) this.errors.showError(`${file.name} is not a CAD part file`); },
      () => this.errors.showError(`Could not read ${file.name}`),
    );
  }

  /** Open the reduced new-part dialog (CAD part or assembly), then refresh on
   * close in case the user cancels navigation. */
  newPart(mode: 'part' | 'assembly') {
    this.dialog.open(CadNewPartDialogComponent, { data: { mode }, autoFocus: false });
  }

  /** REQ 1068 — create a Harness-category part, then its harness, and open it. */
  newHarness() {
    this.dialog.open(PartEditDialog, { width: '500px', data: { lockedCategory: 'Harness' } })
      .afterClosed().subscribe((part: boolean | Part | undefined) => {
        if (!part || typeof part !== 'object') return;
        const harnessData = createEmptyHarnessData(part.name);
        harnessData.description = part.description || '';
        this.harnessApi.createHarness({ name: part.name, description: part.description || '', harnessData, partID: part.id }).subscribe({
          next: h => this.openHarness(h.id, part.id),
          error: e => this.errors.showError(e?.error?.error || 'Failed to create harness'),
        });
      });
  }

  readonly harnessLink = harnessLink;
  private openHarness(harnessID: number, partID?: number | null) {
    const { commands, queryParams } = harnessLink(harnessID, partID);
    this.router.navigate(commands, { queryParams });
  }

  private cadRows = signal<LandingRow[]>([]);
  private harnessRows = signal<LandingRow[]>([]);
  rows = computed<LandingRow[]>(() => [...this.cadRows(), ...this.harnessRows()]);
  loading = signal<boolean>(true);

  columns: ColumnDef<LandingRow>[] = [
    // String sortValues are lowercased — DataTable's default comparator only
    // lowercases on its fallback path, so raw values would sort 'Zebra' < 'anchor'.
    { key: 'part', header: 'Part', sortable: true, sortValue: r => (r.part?.name ?? '').toLowerCase() },
    { key: 'type', header: 'Type', sortable: true, sortValue: r => r.harnessID ? 'harness' : r.isAssembly ? 'assembly' : 'part' },
    { key: 'latest', header: 'Latest CAD Revision', sortable: true, sortValue: r => (r.latestRevision ?? '').toLowerCase() },
    { key: 'projects', header: 'Projects', sortable: true, sortValue: r => this.projectSortValue(r) },
    { key: 'updated', header: 'Updated', sortable: true, sortValue: r => r.latestUpdatedAt ?? '' },
    { key: 'actions', header: '', sortable: false },
  ];
  searchKeys = ['part.name', 'part.description', 'part.revision'];

  // REQ 1071 — narrow the list by kind of document, release state and project.
  private projects = signal<Project[]>([]);
  private projectsById = computed(() => new Map(this.projects().map(p => [p.id, p])));

  /** The projects a row's part belongs to, by name. */
  rowProjects(row: LandingRow): Project[] {
    const byId = this.projectsById();
    return (row.projectIDs ?? []).map(id => byId.get(id)).filter((p): p is Project => !!p)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Common parts first, then by project name; rows with no project last. */
  private projectSortValue(row: LandingRow): string {
    if (row.commonPart) return ' common';
    return this.rowProjects(row).map(p => p.name.toLowerCase()).join(',') || '\uffff';
  }
  filterSections = computed<FilterSection<LandingRow>[]>(() => [
    {
      type: 'multiSelect',
      key: 'type',
      label: 'Type',
      options: [
        { id: 'part', label: 'Part' },
        { id: 'assembly', label: 'Assembly' },
        { id: 'harness', label: 'Harness' },
      ],
      accessor: (r: LandingRow) => r.harnessID ? 'harness' : r.isAssembly ? 'assembly' : 'part',
    },
    {
      type: 'multiSelect',
      key: 'state',
      label: 'State',
      options: [
        { id: 'draft', label: 'Draft' },
        { id: 'released', label: 'Released' },
      ],
      accessor: (r: LandingRow) => r.latestReleaseState === 'released' ? 'released' : 'draft',
    },
    {
      type: 'multiSelect',
      key: 'projects',
      label: 'Projects',
      options: this.projects().map(p => ({ id: p.id, label: p.name, colorHex: p.tagColorHex ? `#${p.tagColorHex}` : '#808080' })),
      // A common part belongs to every project.
      accessor: (r: LandingRow) => r.commonPart ? this.projects().map(p => p.id) : (r.projectIDs ?? []),
    },
  ]);

  // "New assembly" picker — Assembly-category parts eligible to start one.
  showPicker = signal(false);
  eligibleParts = signal<EligiblePart[]>([]);
  partSearch = signal('');
  filteredParts = computed(() => {
    const q = this.partSearch().trim().toLowerCase();
    if (!q) return this.eligibleParts();
    return this.eligibleParts().filter((p) =>
      `${p.part?.name || ''} ${p.part?.revision || ''}`.toLowerCase().includes(q));
  });

  ngOnInit() {
    // A user without project access gets no project options.
    this.projectApi.getProjects().subscribe({
      next: ps => this.projects.set(ps.filter(p => p.activeFlag)),
      error: () => this.projects.set([]),
    });
    if (this.canCad) {
      this.cadApi.listPartsWithCad().subscribe({
        next: rs => { this.cadRows.set(rs); this.loading.set(false); },
        error: err => { this.errors.showError(err?.error?.error || 'Failed to load CAD landing'); this.loading.set(false); },
      });
      this.assemblyApi.eligibleParts().subscribe({
        next: rows => this.eligibleParts.set(rows),
        error: () => {},
      });
    } else {
      this.loading.set(false);
    }
    // REQ 1068 — harnesses are listed alongside parts and assemblies.
    if (this.canHarness) {
      this.harnessApi.getAllHarnesses(1, 1000).subscribe({
        next: res => this.harnessRows.set(res.harnesses.map(h => {
          const released = h.releaseState === 'released';
          return {
            harnessID: h.id,
            commonPart: h.commonPart,
            projectIDs: h.projectIDs,
            partID: h.partID ?? 0,
            part: { id: 0, name: h.partNumber || h.name, revision: h.revision, description: h.partNumber ? h.name : h.description },
            revisionCount: 1,
            latestRevisionID: null,
            latestRevision: h.revision,
            latestReleaseState: released ? 'released' : 'draft',
            latestUpdatedAt: h.updatedAt,
            hasReleased: released,
            releasedRevisionID: null,
            releasedRevision: released ? h.revision : null,
          };
        })),
        error: err => this.errors.showError(err?.error?.error || 'Failed to load harnesses'),
      });
    }
  }

  openLatest(row: LandingRow) {
    if (row.harnessID) {
      this.openHarness(row.harnessID, row.partID);
      return;
    }
    if (row.isAssembly) {
      this.router.navigate(['/parts', row.partID, 'assembly', 'editor']);
      return;
    }
    if (!row.latestRevisionID) return;
    this.router.navigate(['/parts', row.partID, 'cad', 'editor'], { queryParams: { revisionID: row.latestRevisionID } });
  }

  startAssembly(partID: number) {
    const existing = this.eligibleParts().find(p => p.partID === partID);
    if (existing?.hasAssembly) {
      this.router.navigate(['/parts', partID, 'assembly', 'editor']);
      return;
    }
    this.cadApi.checkoutCreated(this.assemblyApi.createForPart(partID)).subscribe({
      next: () => this.router.navigate(['/parts', partID, 'assembly', 'editor']),
      error: e => this.errors.showError(e?.error?.error || 'Failed to create assembly'),
    });
  }
}
