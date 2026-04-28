import { Component, Input, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PartNumberPipe } from '../../../pipes/part-number.pipe';
import { AuthImgDirective } from '../../../directives/auth-img.directive';
import { InventoryService } from '../../../services/inventory.service';

@Component({
  selector: 'app-part-link',
  standalone: true,
  imports: [RouterLink, AuthImgDirective],
  template: `
    <span class="part-link-wrapper"
          (mouseenter)="onMouseEnter($event)"
          (mouseleave)="showTooltip.set(false)">
      <a [routerLink]="['/parts', partId, 'edit']" class="part-link">{{ displayValue }}</a>
      @if (effectiveImageFileId() && showTooltip()) {
        <div class="image-preview-tooltip" [style.top.px]="tooltipTop()" [style.left.px]="tooltipLeft()">
          <img [appAuthImg]="effectiveImageFileId()!" [alt]="name">
        </div>
      }
    </span>
  `,
  styles: [`
    :host { display: inline; }
    .part-link-wrapper {
      position: relative;
      display: inline;
    }
    .part-link {
      color: var(--mat-sys-primary);
      text-decoration: none;
      font-weight: 500;
      cursor: pointer;
    }
    .part-link:hover {
      text-decoration: underline;
    }
    .image-preview-tooltip {
      position: fixed;
      z-index: 10000;
      background: var(--mat-sys-surface-container);
      border-radius: 8px;
      padding: 4px;
      box-shadow: 0 4px 12px rgba(0,0,0,.3);
      max-width: 200px;
      pointer-events: none;
    }
    .image-preview-tooltip img {
      max-width: 100%;
      border-radius: 4px;
      display: block;
    }
  `]
})
export class PartLink {
  private inventoryService = inject(InventoryService);

  /** Shared cache across all PartLink instances — avoids re-fetching the same part */
  private static imageCache = new Map<number, number | null>();

  @Input({ required: true }) partId!: number;
  @Input({ required: true }) name!: string;
  @Input() revision?: string;
  @Input() imageFileId?: number | null;
  @Input() hasOtherRevisions = false;

  showTooltip = signal(false);
  tooltipTop = signal(0);
  tooltipLeft = signal(0);
  private resolvedImageFileId = signal<number | null | undefined>(undefined);
  private fetching = false;

  effectiveImageFileId = signal<number | null | undefined>(undefined);

  private partNumberPipe = new PartNumberPipe();

  get displayValue(): string {
    return this.partNumberPipe.transform(this.name, this.revision, this.hasOtherRevisions);
  }

  private updateEffective() {
    if (this.imageFileId != null) {
      this.effectiveImageFileId.set(this.imageFileId);
    } else {
      this.effectiveImageFileId.set(this.resolvedImageFileId());
    }
  }

  onMouseEnter(event: MouseEvent) {
    const el = event.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    this.tooltipTop.set(rect.top - 8);
    this.tooltipLeft.set(rect.left);
    this.showTooltip.set(true);

    // If imageFileId was provided by caller, use it directly
    if (this.imageFileId != null) {
      this.effectiveImageFileId.set(this.imageFileId);
      return;
    }

    // Check static cache
    if (PartLink.imageCache.has(this.partId)) {
      this.resolvedImageFileId.set(PartLink.imageCache.get(this.partId)!);
      this.updateEffective();
      return;
    }

    // Fetch once
    if (this.fetching) return;
    this.fetching = true;
    this.inventoryService.getPartById(this.partId).subscribe({
      next: (part: any) => {
        const fileId = part.imageFileID ?? part.imageFile?.id ?? null;
        PartLink.imageCache.set(this.partId, fileId);
        this.resolvedImageFileId.set(fileId);
        this.updateEffective();
        this.fetching = false;
      },
      error: () => {
        PartLink.imageCache.set(this.partId, null);
        this.resolvedImageFileId.set(null);
        this.updateEffective();
        this.fetching = false;
      },
    });
  }
}
