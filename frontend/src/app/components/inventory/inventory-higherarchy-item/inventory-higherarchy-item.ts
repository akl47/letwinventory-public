import { Component, Input, Output, EventEmitter, signal, inject, OnInit } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { InventoryTag } from '../../../services/inventory.service';
import { BarcodeDialog } from '../barcode-dialog/barcode-dialog';
import { BarcodeTag } from '../barcode-tag/barcode-tag';
import { InventoryItemDialog } from '../inventory-item-dialog/inventory-item-dialog';

@Component({
  selector: 'app-inventory-higherarchy-item',
  standalone: true,
  imports: [MatIconModule, MatButtonModule, MatTooltipModule, BarcodeTag, InventoryHigherarchyItem],
  templateUrl: './inventory-higherarchy-item.html',
  styleUrl: './inventory-higherarchy-item.css',
})
export class InventoryHigherarchyItem implements OnInit {
  @Input({ required: true }) item!: InventoryTag;
  @Input() expandedPath: number[] = [];
  @Output() barcodeSelected = new EventEmitter<number>();
  @Output() dataChanged = new EventEmitter<void>();
  isExpanded = signal(false);
  private dialog = inject(MatDialog);

  ngOnInit() {
    // Check if this item should be expanded on init
    if (this.expandedPath.includes(this.item.id)) {
      this.isExpanded.set(true);
    }
  }

  toggle() {
    const wasExpanded = this.isExpanded();
    this.isExpanded.update(v => !v);

    // If collapsing and has children, emit parent's barcode ID
    // Otherwise emit this item's barcode ID
    if (wasExpanded && this.item.children && this.item.children.length > 0) {
      // Collapsing - emit parent barcode ID (or this item's ID if it's a root)
      const parentId = this.item.parentBarcodeID || this.item.id;
      this.barcodeSelected.emit(parentId);
    } else {
      // Expanding or toggling item without children - emit this item's ID
      this.barcodeSelected.emit(this.item.id);
    }
  }

  onBarcodeTagClick() {
    this.barcodeSelected.emit(this.item.id);
  }

  openBarcode(event: Event) {
    event.stopPropagation();
    this.barcodeSelected.emit(this.item.id);
    const dialogRef = this.dialog.open(BarcodeDialog, {
      data: { barcode: this.item.barcode }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.dataChanged.emit();
      }
    });
  }

  openEdit(event: Event) {
    event.stopPropagation();
    const dialogRef = this.dialog.open(InventoryItemDialog, {
      data: { item: this.item }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.dataChanged.emit();
      }
    });
  }


  addChild(event: Event) {
    event.stopPropagation();
    const dialogRef = this.dialog.open(InventoryItemDialog, {
      data: { parentId: this.item.id } // Pass parent BARCODE ID? or ITEM ID?
      // Logic: if adding child to 'Workbench' (Location), parentBarcodeID of new item = Workbench's BARCODE ID.
      // So item.id (which is barcodeId) is correct.
    });
    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.dataChanged.emit();
      }
    });

  }

  onChildDataChanged() {
    this.dataChanged.emit();
  }
}
