import { Component, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { InventoryService, InventoryTag } from '../../../services/inventory.service';
import { InventoryHigherarchyItem } from '../inventory-higherarchy-item/inventory-higherarchy-item';

@Component({
  selector: 'app-inventory-higherarchy-view',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatSlideToggleModule,
    InventoryHigherarchyItem
  ],
  templateUrl: './inventory-higherarchy-view.html',
  styleUrl: './inventory-higherarchy-view.css',
})
export class InventoryHigherarchyView implements OnInit {
  private inventoryService = inject(InventoryService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  treeData = signal<InventoryTag[]>([]);
  selectedBarcodeId = signal<number | null>(null);
  expandedPath = signal<number[]>([]);
  searchText = signal<string>('');
  showEquipment = signal<boolean>(true);
  private allTags: InventoryTag[] = [];
  private fullTree: InventoryTag[] = [];

  ngOnInit() {
    this.loadTags();
  }

  private loadTags() {
    this.inventoryService.getAllTags().subscribe(tags => {
      this.allTags = tags;
      this.rebuildTree();

      // Check if there's a barcode ID in the URL
      this.route.queryParams.subscribe(params => {
        const barcodeId = params['barcode'];
        if (barcodeId) {
          const id = parseInt(barcodeId);
          this.selectedBarcodeId.set(id);
          this.expandToBarcode(id);
        }
      });
    });
  }

  refreshData() {
    this.loadTags();
  }

  onSearchChange(value: string) {
    this.searchText.set(value);
    this.rebuildTree();
  }

  onShowEquipmentChange(show: boolean) {
    this.showEquipment.set(show);
    this.rebuildTree();
  }

  private rebuildTree() {
    const searchValue = this.searchText();
    if (!searchValue.trim()) {
      // No search - show full tree (with equipment filter applied)
      const filteredTags = this.showEquipment()
        ? this.allTags
        : this.allTags.filter(tag => tag.type !== 'Equipment');
      this.fullTree = this.buildTree(filteredTags);
      this.treeData.set(this.fullTree);
      this.expandedPath.set([]);
    } else {
      // Search and filter
      const filtered = this.filterTreeBySearch(searchValue.toLowerCase());
      this.treeData.set(filtered);

      // Expand all nodes in filtered results
      const expandIds = this.getAllIds(filtered);
      this.expandedPath.set(expandIds);
    }
  }

  private filterTreeBySearch(searchTerm: string): InventoryTag[] {
    // First filter out equipment if toggle is off
    const tagsToSearch = this.showEquipment()
      ? this.allTags
      : this.allTags.filter(tag => tag.type !== 'Equipment');

    // Find all matching tags
    const matches = tagsToSearch.filter(tag =>
      tag.name.toLowerCase().includes(searchTerm) ||
      tag.barcode.toLowerCase().includes(searchTerm) ||
      (tag.type === 'Trace' && tag.item_id && this.getPartNumber(tag.item_id)?.toLowerCase().includes(searchTerm))
    );

    if (matches.length === 0) {
      return [];
    }

    // Get all IDs that should be included (matches + their ancestors)
    const includedIds = new Set<number>();
    matches.forEach(match => {
      const path = this.findPathToBarcode(match.id);
      path.forEach(id => includedIds.add(id));
    });

    // Build filtered tree with only included tags (also respect equipment filter)
    return this.buildFilteredTree(Array.from(includedIds));
  }

  private buildFilteredTree(includedIds: number[]): InventoryTag[] {
    let tagsToInclude = this.allTags.filter(tag => includedIds.includes(tag.id));
    // Also filter out equipment if toggle is off
    if (!this.showEquipment()) {
      tagsToInclude = tagsToInclude.filter(tag => tag.type !== 'Equipment');
    }
    return this.buildTree(tagsToInclude);
  }

  private getAllIds(tree: InventoryTag[]): number[] {
    const ids: number[] = [];
    const traverse = (nodes: InventoryTag[]) => {
      nodes.forEach(node => {
        ids.push(node.id);
        if (node.children && node.children.length > 0) {
          traverse(node.children);
        }
      });
    };
    traverse(tree);
    return ids;
  }

  private getPartNumber(partId: number): string | null {
    // This would need to fetch from parts data if available
    // For now, returning null - you may want to load parts data in ngOnInit
    return null;
  }

  onBarcodeSelected(barcodeId: number) {
    this.selectedBarcodeId.set(barcodeId);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { barcode: barcodeId },
      queryParamsHandling: 'merge'
    });
  }

  private expandToBarcode(barcodeId: number) {
    // Find the path from root to the target barcode
    const path = this.findPathToBarcode(barcodeId);
    if (path.length > 0) {
      this.expandedPath.set(path);
    }
  }

  private findPathToBarcode(targetId: number): number[] {
    const tag = this.allTags.find(t => t.id === targetId);
    if (!tag) return [];

    const path: number[] = [targetId];
    let current = tag;

    while (current.parentBarcodeID && current.parentBarcodeID !== 0) {
      path.unshift(current.parentBarcodeID);
      const parent = this.allTags.find(t => t.id === current.parentBarcodeID);
      if (!parent) break;
      current = parent;
    }

    return path;
  }

  private buildTree(tags: InventoryTag[]): InventoryTag[] {
    const map = new Map<number, InventoryTag>();
    const roots: InventoryTag[] = [];

    // Initialize map and children array
    tags.forEach(tag => {
      tag.children = [];
      map.set(tag.id, tag);
    });

    // Build hierarchy
    tags.forEach(tag => {
      // The parentBarcodeID actually refers to the 'id' of the parent BARCODE, not the location ID.
      // Wait, let's verify data structure.
      // 'Barcodes' table has 'id' and 'parentBarcodeID'.
      // The 'tags' returned by getAllTags has 'id' as the BARCODE ID (b.id).
      // So parentBarcodeID refers to another tag.id.
      if (tag.parentBarcodeID === 0 || tag.parentBarcodeID === null) {
        roots.push(tag);
      } else {
        const parent = map.get(tag.parentBarcodeID);
        if (parent) {
          parent.children?.push(tag);
        } else {
          // If parent not found (maybe inactive), treat as root or orphan?
          // Treating as root for visibility is usually safer.
          roots.push(tag);
        }
      }
    });

    return roots;
  }
}
