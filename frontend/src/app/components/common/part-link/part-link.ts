import { Component, Input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PartNumberPipe } from '../../../pipes/part-number.pipe';

@Component({
  selector: 'app-part-link',
  standalone: true,
  imports: [RouterLink],
  template: `
    <span class="part-link-wrapper" #wrapper
          (mouseenter)="positionTooltip(wrapper)">
      <a [routerLink]="['/parts', partId, 'edit']" class="part-link">{{ displayValue }}</a>
      @if (imageData) {
      <div class="image-preview-tooltip" [style.top.px]="tooltipTop" [style.left.px]="tooltipLeft">
        <img [src]="imageData" [alt]="name">
      </div>
      }
    </span>
  `,
  styles: [`
    .part-link-wrapper {
      position: relative;
      display: inline-block;
    }
    .part-link {
      color: var(--mat-sys-primary);
      text-decoration: none;
      font-weight: 500;
    }
    .part-link:hover {
      text-decoration: underline;
    }
    .image-preview-tooltip {
      display: none;
      position: fixed;
      z-index: 1000;
      background: var(--mat-sys-surface-container);
      border-radius: 8px;
      padding: 4px;
      box-shadow: 0 4px 12px rgba(0,0,0,.3);
      max-width: 200px;
      pointer-events: none;
      transform: translateY(-100%);
    }
    .part-link-wrapper:hover .image-preview-tooltip {
      display: block;
    }
    .image-preview-tooltip img {
      max-width: 100%;
      border-radius: 4px;
      display: block;
    }
  `]
})
export class PartLink {
  @Input({ required: true }) partId!: number;
  @Input({ required: true }) name!: string;
  @Input() revision?: string;
  @Input() imageData?: string | null;
  @Input() hasOtherRevisions = false;

  tooltipTop = 0;
  tooltipLeft = 0;

  private partNumberPipe = new PartNumberPipe();

  get displayValue(): string {
    return this.partNumberPipe.transform(this.name, this.revision, this.hasOtherRevisions);
  }

  positionTooltip(el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    this.tooltipTop = rect.top - 8;
    this.tooltipLeft = rect.left;
  }
}
