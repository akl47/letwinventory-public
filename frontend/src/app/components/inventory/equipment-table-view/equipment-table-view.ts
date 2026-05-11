import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { InventoryService } from '../../../services/inventory.service';
import { AuthService } from '../../../services/auth.service';
import { Equipment } from '../../../models/equipment.model';
import { EquipmentEditDialog } from '../equipment-edit-dialog/equipment-edit-dialog';
import { BarcodeTag } from '../barcode-tag/barcode-tag';
import { DataTable, DataTableColumnDef, ColumnDef, FilterSection } from '../../common/data-table/data-table';

@Component({
  selector: 'app-equipment-table-view',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    BarcodeTag,
    DataTable,
    DataTableColumnDef,
  ],
  templateUrl: './equipment-table-view.html',
  styleUrl: './equipment-table-view.css',
})
export class EquipmentTableView implements OnInit {
  private inventoryService = inject(InventoryService);
  private authService = inject(AuthService);
  private dialog = inject(MatDialog);
  canWrite = computed(() => this.authService.hasPermission('equipment', 'write'));

  allEquipment = signal<Equipment[]>([]);

  columns: ColumnDef<Equipment>[] = [
    { key: 'name', header: 'Name', sortable: true },
    { key: 'serialNumber', header: 'Serial Number', sortable: true },
    { key: 'barcode', header: 'Barcode' },
    { key: 'commissionDate', header: 'Commission Date', sortable: true, sortValue: e => e.commissionDate ? new Date(e.commissionDate).getTime() : null },
    { key: 'actions', header: 'Actions' },
  ];

  filterSections: FilterSection<Equipment>[] = [
    {
      type: 'toggle',
      key: 'inactive',
      label: 'Show Inactive',
      default: false,
      predicate: (e, on) => on || e.activeFlag === true,
    },
  ];

  searchKeys = ['name', 'description', 'serialNumber', 'Barcode.barcode'];

  ngOnInit() {
    this.loadEquipment();
  }

  loadEquipment() {
    this.inventoryService.getAllEquipment().subscribe({
      next: (equipment) => this.allEquipment.set(equipment),
      error: (err) => console.error('Error loading equipment:', err),
    });
  }

  formatDate(dateStr: string | null): string {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString();
  }

  openNewEquipmentDialog() {
    const dialogRef = this.dialog.open(EquipmentEditDialog, { width: '500px', data: {} });
    dialogRef.afterClosed().subscribe(result => { if (result) this.loadEquipment(); });
  }

  editEquipment(equipment: Equipment) {
    const dialogRef = this.dialog.open(EquipmentEditDialog, { width: '500px', data: { equipment } });
    dialogRef.afterClosed().subscribe(result => { if (result) this.loadEquipment(); });
  }
}
