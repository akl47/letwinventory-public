import { Component, Input, Output, EventEmitter, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PartLink } from '../part-link/part-link';

export interface BomItem {
  partID: number;
  quantity: number;
  partName: string;
  partRevision?: string;
  partDescription?: string;
  partImageFileId?: number | null;
  categoryName?: string;
  categoryColor?: string;
  uomName?: string;
  allowDecimal?: boolean;
  /** Extra display-only info, e.g. step numbers */
  extra?: string;
  /** Label for the type badge */
  typeBadge?: string;
  /** CSS class for the type badge */
  typeBadgeClass?: string;
  /** Pin letter (A-Z) for marker placement */
  pinLetter?: string;
  /** Warning flag — shows warning icon */
  warning?: boolean;
}

@Component({
  selector: 'app-bom-table',
  standalone: true,
  imports: [CommonModule, MatTableModule, MatButtonModule, MatIconModule, MatTooltipModule, PartLink],
  templateUrl: './bom-table.html',
  styleUrl: './bom-table.css',
})
export class BomTable implements OnChanges {
  @Input() items: BomItem[] = [];
  @Input() editable = false;
  @Input() showCategory = true;
  @Input() showDescription = false;
  @Input() showType = false;
  @Input() showExtra = false;
  @Input() extraHeader = '';
  @Input() compact = false;
  @Input() showPin = false;
  @Output() quantityChanged = new EventEmitter<{ index: number; quantity: number }>();
  @Output() removed = new EventEmitter<number>();
  @Output() pinDragStarted = new EventEmitter<{ event: MouseEvent; item: BomItem; index: number }>();

  columns: string[] = [];

  ngOnChanges() {
    this.updateColumns();
  }

  private updateColumns() {
    const cols: string[] = [];
    if (this.showType) cols.push('type');
    cols.push('name');
    if (this.showCategory) cols.push('category');
    if (this.showDescription) cols.push('description');
    cols.push('quantity');
    if (this.showPin) cols.push('pin');
    if (this.showExtra) cols.push('extra');
    if (this.editable) cols.push('actions');
    this.columns = cols;
  }

  getCategoryBgColor(hex: string | null | undefined): string {
    if (!hex) return 'rgba(255, 255, 255, 0.2)';
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, 0.2)`;
  }

  formatQty(item: BomItem): number {
    const val = Number(item.quantity);
    return item.allowDecimal ? val : Math.round(val);
  }

  displayQty(item: BomItem): string {
    const val = Number(item.quantity);
    return item.allowDecimal ? String(val) : String(Math.round(val));
  }

  onRemoveClick(index: number) {
    this.removed.emit(index);
  }

  getPinSrc(item: BomItem): string {
    return `assets/pin-${item.pinLetter || 'A'}.svg`;
  }

  trackByPartId(_index: number, item: BomItem): string {
    return `${item.partID}-${item.typeBadgeClass || ''}`;
  }

  onPinMouseDown(event: MouseEvent, item: BomItem, index: number) {
    event.preventDefault();
    this.pinDragStarted.emit({ event, item, index });
  }

  onQtyChange(index: number, value: number) {
    if (isNaN(value) || value < 0) return;
    this.quantityChanged.emit({ index, quantity: value });
  }
}
