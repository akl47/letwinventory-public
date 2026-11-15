import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Observable, of } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { InventoryService } from '../../../services/inventory.service';
import { ProjectService } from '../../../services/project.service';
import { AuthService } from '../../../services/auth.service';
import { ErrorNotificationService } from '../../../services/error-notification.service';
import { CategoryBadge } from '../../common/category-badge/category-badge';
import { Part } from '../../../models';
import { Project } from '../../../models/project.model';

/**
 * REQ 1073 — the Part info sidebar of the CAD editor (part, assembly and
 * harness modes). Shows the document's part record; opens locked, and a user
 * with parts write permission can unlock it to edit the description, the
 * projects and the common mark.
 */
@Component({
  selector: 'app-cad-part-info-panel',
  standalone: true,
  imports: [FormsModule, RouterLink, MatIconModule, MatTooltipModule, CategoryBadge],
  template: `
    <div class="tool-panel part-info-panel" data-testid="part-info-panel">
      <h3 class="panel-title">
        <mat-icon>info</mat-icon>
        <span class="title-text">Part info</span>
        @if (part()) {
          <span [matTooltip]="lockTooltip()">
            <button class="icon-btn" data-testid="part-info-lock" [class.unlocked]="editing()"
                    [disabled]="!canWrite() || saving()" (click)="toggleEdit()" [attr.aria-label]="lockTooltip()">
              <mat-icon>{{ editing() ? 'lock_open' : 'lock' }}</mat-icon>
            </button>
          </span>
        }
        <button class="icon-btn" data-testid="part-info-close" matTooltip="Close" aria-label="Close" (click)="closed.emit()">
          <mat-icon>close</mat-icon>
        </button>
      </h3>

      @if (partID() === null) {
        <p class="panel-hint" data-testid="part-info-none">This document is not linked to a part.</p>
      } @else if (loading()) {
        <p class="panel-hint">Loading…</p>
      } @else if (part(); as p) {
        <div class="info-field">
          <span class="info-label">Part number</span>
          <span class="info-value" data-testid="part-info-number">{{ p.name }}</span>
        </div>
        <div class="info-field">
          <span class="info-label">Revision</span>
          <span class="info-value">
            {{ p.revision }}
            @if (p.revisionLocked) { <mat-icon class="rev-lock" matTooltip="This revision is locked">lock</mat-icon> }
          </span>
        </div>
        <div class="info-field">
          <span class="info-label">Category</span>
          <span class="info-value">
            <app-category-badge [label]="p.PartCategory?.name || '-'" [colorHex]="p.PartCategory?.tagColorHex" />
          </span>
        </div>

        <div class="info-field">
          <span class="info-label">Description</span>
          @if (editing()) {
            <textarea class="panel-input" data-testid="part-info-description" rows="3" maxlength="62"
                      [ngModel]="description()" (ngModelChange)="description.set($event)"
                      [disabled]="p.revisionLocked"></textarea>
            @if (p.revisionLocked) { <span class="info-note">Revision is locked — the description cannot be changed.</span> }
          } @else {
            <span class="info-value" data-testid="part-info-description">{{ p.description || '-' }}</span>
          }
        </div>

        <div class="info-field">
          <span class="info-label">Projects</span>
          @if (editing()) {
            <div class="project-list" data-testid="part-info-projects-edit">
              @for (project of projectChoices(); track project.id) {
                <label class="project-check">
                  <input type="checkbox" [checked]="projectIDs().includes(project.id)" (change)="toggleProject(project.id)" />
                  {{ project.name }}
                </label>
              }
              @if (projectChoices().length === 0) { <span class="info-note">No projects available.</span> }
            </div>
          } @else {
            <span class="info-value badges" data-testid="part-info-projects">
              @for (project of selectedProjects(); track project.id) {
                <app-category-badge [label]="project.name" [colorHex]="project.tagColorHex" />
              }
              @if (selectedProjects().length === 0) { - }
            </span>
          }
        </div>

        <div class="info-field">
          <span class="info-label">Common part</span>
          @if (editing()) {
            <label class="project-check">
              <input type="checkbox" data-testid="part-info-common" [checked]="common()" (change)="common.set(!common())" />
              Available to every project
            </label>
          } @else {
            <span class="info-value" data-testid="part-info-common">{{ common() ? 'Yes — available to every project' : 'No' }}</span>
          }
        </div>

        @if (editing()) {
          <div class="panel-actions">
            <button class="btn btn-primary" data-testid="part-info-save" [disabled]="saving() || !changed()" (click)="save()">Save</button>
            <button class="btn" data-testid="part-info-cancel" [disabled]="saving()" (click)="cancel()">Cancel</button>
          </div>
        }

        <a class="part-link" [routerLink]="['/parts', p.id, 'edit']" data-testid="part-info-open">
          <mat-icon>open_in_new</mat-icon> Open part record
        </a>
      } @else {
        <p class="panel-hint">The part could not be loaded.</p>
      }
    </div>
  `,
  styles: [`
    :host { display: flex; flex: 0 0 auto; }
    .part-info-panel { width: 280px; border-left: 1px solid #444; background: #25253a; padding: 12px; box-sizing: border-box; overflow-y: auto; color: #ddd; }
    .panel-title { display: flex; align-items: center; gap: 6px; margin: 0 0 12px; font-size: 14px; font-weight: 500; }
    .panel-title > mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .title-text { flex: 1; }
    .panel-hint { font-size: 12px; opacity: 0.7; margin: 0 0 8px; }
    .icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; color: #ddd; background: transparent; border: 1px solid transparent; border-radius: 3px; cursor: pointer; }
    .icon-btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.08); }
    .icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .icon-btn.unlocked { color: #42a5f5; border-color: #42a5f5; background: rgba(66, 165, 245, 0.15); }
    .icon-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .info-field { display: flex; flex-direction: column; gap: 3px; margin-bottom: 12px; }
    .info-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.55; }
    .info-value { font-size: 13px; display: flex; align-items: center; gap: 4px; overflow-wrap: anywhere; }
    .info-value.badges { flex-wrap: wrap; }
    .info-note { font-size: 11px; opacity: 0.6; }
    .rev-lock { font-size: 14px; width: 14px; height: 14px; opacity: 0.7; }
    .panel-input { box-sizing: border-box; width: 100%; padding: 6px 8px; font: inherit; font-size: 13px; color: #ddd; background: #1e1e2e; border: 1px solid #555; border-radius: 3px; resize: vertical; }
    .panel-input:focus { outline: none; border-color: #42a5f5; }
    .panel-input:disabled { opacity: 0.5; }
    .project-list { display: flex; flex-direction: column; gap: 2px; max-height: 220px; overflow-y: auto; }
    .project-check { display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; }
    .panel-actions { display: flex; gap: 8px; margin: 4px 0 14px; }
    .btn { min-height: 30px; padding: 4px 12px; font: inherit; font-size: 13px; color: #ddd; background: #2a2a3a; border: 1px solid #555; border-radius: 3px; cursor: pointer; }
    .btn:hover:not(:disabled) { background: #353548; border-color: #777; }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn.btn-primary { background: #1976d2; border-color: #1976d2; color: #fff; }
    .part-link { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: #42a5f5; text-decoration: none; }
    .part-link:hover { text-decoration: underline; }
    .part-link mat-icon { font-size: 14px; width: 14px; height: 14px; }
  `],
})
export class CadPartInfoPanelComponent {
  private inventory = inject(InventoryService);
  private projectApi = inject(ProjectService);
  private auth = inject(AuthService);
  private errors = inject(ErrorNotificationService);

  /** The part of the open document; null when it has none (a harness without a part). */
  partID = input<number | null>(null);
  closed = output<void>();
  /** Emitted with the fresh part after a save, so the editor can refresh what it shows. */
  partSaved = output<Part>();

  part = signal<Part | null>(null);
  loading = signal(false);
  editing = signal(false);
  saving = signal(false);
  private allProjects = signal<Project[]>([]);

  // Edit buffer
  description = signal('');
  projectIDs = signal<number[]>([]);
  common = signal(false);

  canWrite = computed(() => this.auth.hasPermission('parts', 'write'));
  lockTooltip = computed(() => !this.canWrite() ? 'You do not have permission to edit parts'
    : this.editing() ? 'Lock — stop editing without saving' : 'Unlock to edit the part info');

  /** Every active project, plus any the part carries that this user cannot list. */
  projectChoices = computed(() => {
    const known = this.allProjects();
    const extra = (this.part()?.projects ?? []).filter(p => !known.some(k => k.id === p.id));
    return [...known, ...extra].sort((a, b) => a.name.localeCompare(b.name));
  });
  selectedProjects = computed(() => this.projectChoices().filter(p => this.projectIDs().includes(p.id)));

  private descriptionChanged = computed(() => this.description() !== (this.part()?.description || ''));
  private projectsChanged = computed(() => {
    const p = this.part();
    const saved = (p?.projects ?? []).map(x => x.id).sort().join(',');
    return saved !== [...this.projectIDs()].sort().join(',') || !!p?.commonPart !== this.common();
  });
  changed = computed(() => this.descriptionChanged() || this.projectsChanged());

  constructor() {
    this.projectApi.getProjects().subscribe({
      next: ps => this.allProjects.set(ps.filter(p => p.activeFlag)),
      error: () => this.allProjects.set([]),
    });
    effect(() => {
      const id = this.partID();
      untracked(() => this.load(id));
    });
  }

  private load(id: number | null) {
    this.editing.set(false);
    this.part.set(null);
    if (id === null) return;
    this.loading.set(true);
    this.inventory.getPartById(id).subscribe({
      next: p => { this.loading.set(false); this.adopt(p); },
      error: () => this.loading.set(false),
    });
  }

  private adopt(p: Part) {
    this.part.set(p);
    this.description.set(p.description || '');
    this.projectIDs.set((p.projects ?? []).map(x => x.id));
    this.common.set(!!p.commonPart);
  }

  toggleEdit() {
    if (this.editing()) this.cancel();
    else if (this.canWrite()) this.editing.set(true);
  }

  toggleProject(id: number) {
    this.projectIDs.update(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  }

  cancel() {
    const p = this.part();
    if (p) this.adopt(p);
    this.editing.set(false);
  }

  save() {
    const p = this.part();
    if (!p || !this.changed()) return;
    this.saving.set(true);
    // The description goes through the ordinary part save (refused on a locked
    // revision); projects and the common mark have their own call.
    const saveDescription$: Observable<unknown> = this.descriptionChanged() && !p.revisionLocked
      ? this.inventory.updatePart(p.id, {
          name: p.name, description: this.description(), internalPart: p.internalPart, vendor: p.vendor,
          sku: p.sku || '', link: p.link || '', minimumOrderQuantity: p.minimumOrderQuantity,
          minimumStockQuantity: p.minimumStockQuantity ?? null, partCategoryID: p.partCategoryID,
          serialNumberRequired: p.serialNumberRequired, lotNumberRequired: p.lotNumberRequired,
          defaultUnitOfMeasureID: p.defaultUnitOfMeasureID || 1, manufacturer: p.manufacturer || '',
          manufacturerPN: p.manufacturerPN || '', imageFileID: p.imageFileID ?? null,
        })
      : of(null);
    const saveProjects$: Observable<unknown> = this.projectsChanged()
      ? this.inventory.setPartProjects(p.id, { projectIDs: this.projectIDs(), commonPart: this.common() })
      : of(null);
    saveDescription$.pipe(
      switchMap(() => saveProjects$),
      switchMap(() => this.inventory.getPartById(p.id)),
    ).subscribe({
      next: fresh => {
        this.saving.set(false);
        this.adopt(fresh);
        this.editing.set(false);
        this.errors.showSuccess('Part info saved');
        this.partSaved.emit(fresh);
      },
      error: err => {
        this.saving.set(false);
        this.errors.showHttpError(err, 'Failed to save part info');
      },
    });
  }
}
