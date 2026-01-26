import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormControl } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CdkDragDrop, CdkDropList, CdkDrag, CdkDragHandle, CdkDragPlaceholder, moveItemInArray } from '@angular/cdk/drag-drop';
import { HarnessCable, HarnessWire, DbHarnessCable } from '../../../models/harness.model';
import { Part } from '../../../models';
import { InventoryService } from '../../../services/inventory.service';
import { HarnessPartsService } from '../../../services/harness-parts.service';
import { WIRE_COLORS, AWG_GAUGES } from '../../../utils/harness/wire-color-map';
import { debounceTime, distinctUntilChanged, switchMap, of } from 'rxjs';

interface DialogData {
  existingCables?: HarnessCable[];
  editCable?: HarnessCable;
}

@Component({
  selector: 'app-harness-add-cable-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule,
    MatAutocompleteModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    CdkDragPlaceholder
  ],
  templateUrl: './harness-add-cable-dialog.html',
  styleUrls: ['./harness-add-cable-dialog.scss']
})
export class HarnessAddCableDialog implements OnInit {
  private dialogRef = inject(MatDialogRef<HarnessAddCableDialog>);
  private data = inject<DialogData>(MAT_DIALOG_DATA, { optional: true });
  private inventoryService = inject(InventoryService);
  private harnessPartsService = inject(HarnessPartsService);

  wireColors = WIRE_COLORS;
  awgGauges = AWG_GAUGES;

  // Part search
  partSearchControl = new FormControl('');
  filteredParts = signal<Part[]>([]);
  isLoading = signal(false);
  selectedPart = signal<Part | null>(null);
  linkedCable = signal<DbHarnessCable | null>(null);

  // Form fields
  label = '';
  gaugeAWG = '22';
  lengthMm: number | undefined = undefined;
  wires = signal<HarnessWire[]>([]);
  cableDiagramImage: string | undefined = undefined;

  isEdit = signal<boolean>(false);
  private editId: string | null = null;
  private editPosition: { x: number; y: number } = { x: 300, y: 200 };
  private editPartName: string | undefined = undefined;
  private editPartId: number | undefined = undefined;
  private editDbId: number | undefined = undefined;

  constructor() {
    if (this.data?.editCable) {
      // Edit mode - preserve all existing properties
      this.isEdit.set(true);
      const cable = this.data.editCable;
      this.editId = cable.id;
      this.label = cable.label;
      this.gaugeAWG = cable.gaugeAWG || '22';
      this.lengthMm = cable.lengthMm;
      this.wires.set([...cable.wires]);
      this.editPosition = cable.position || { x: 300, y: 200 };
      this.editPartName = cable.partName;
      this.editPartId = cable.partId;
      this.editDbId = cable.dbId;
      this.cableDiagramImage = cable.cableDiagramImage;
    }
  }

  ngOnInit() {
    // Set up autocomplete search
    this.partSearchControl.valueChanges.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(value => {
        if (typeof value === 'string' && value.length >= 1) {
          this.isLoading.set(true);
          return this.inventoryService.searchPartsByCategory('Cable', value);
        }
        return of([]);
      })
    ).subscribe(parts => {
      this.filteredParts.set(parts);
      this.isLoading.set(false);
    });
  }

  displayPart(part: Part): string {
    return part ? part.name : '';
  }

  onPartSelected(part: Part) {
    this.selectedPart.set(part);

    // Load the harness cable data linked to this part
    this.harnessPartsService.getCableByPartId(part.id).subscribe({
      next: (cable) => {
        if (cable) {
          this.linkedCable.set(cable);
          // Populate form with cable data (read-only fields from part)
          this.gaugeAWG = cable.gaugeAWG || '22';
          // Generate unique label
          this.label = this.generateUniqueLabel(cable.label);
          // Set up wires
          this.wires.set(cable.wires.map((w, i) => ({
            id: `wire-${Date.now()}-${i + 1}`,
            color: w.color,
            colorCode: w.colorCode,
            label: ''
          })));
          // Pull cable diagram image from the database record
          this.cableDiagramImage = cable.cableDiagramImage || undefined;
        } else {
          // No linked cable data - use defaults
          this.label = part.name;
          this.gaugeAWG = '22';
          this.wires.set([{ id: 'wire-1', color: 'Black', colorCode: 'BK', label: '' }]);
          this.cableDiagramImage = undefined;
        }
      }
    });
  }

  private generateUniqueLabel(baseLabel: string): string {
    if (!this.data?.existingCables) return baseLabel;

    const existingLabels = new Set(this.data.existingCables.map(c => c.label));
    if (!existingLabels.has(baseLabel)) return baseLabel;

    // Try incrementing a number suffix
    let counter = 2;
    while (existingLabels.has(`${baseLabel}-${counter}`)) {
      counter++;
    }
    return `${baseLabel}-${counter}`;
  }

  clearSelectedPart() {
    this.selectedPart.set(null);
    this.linkedCable.set(null);
    this.partSearchControl.setValue('');
    this.wires.set([]);
    this.cableDiagramImage = undefined;
  }

  getWireHex(colorCode: string): string {
    const color = this.wireColors.find(c => c.code === colorCode || c.name === colorCode);
    return color?.hex || '#808080';
  }

  onWireDrop(event: CdkDragDrop<HarnessWire[]>) {
    const currentWires = [...this.wires()];
    moveItemInArray(currentWires, event.previousIndex, event.currentIndex);
    this.wires.set(currentWires);
  }

  isValid(): boolean {
    if (!this.label.trim()) return false;
    if (!this.selectedPart() && !this.isEdit()) return false;

    // Check for duplicate label (only if not editing)
    if (!this.isEdit() && this.data?.existingCables) {
      const exists = this.data.existingCables.some(c => c.label === this.label.trim());
      if (exists) return false;
    }

    return true;
  }

  save() {
    if (!this.isValid()) return;

    const linked = this.linkedCable();
    const cable: HarnessCable = {
      id: this.editId || `cable-${Date.now()}`,
      label: this.label.trim(),
      wireCount: this.wires().length,
      gaugeAWG: this.gaugeAWG || undefined,
      wires: this.wires(),
      position: this.editPosition,
      lengthMm: this.lengthMm,
      dbId: linked?.id || this.editDbId,
      partId: this.selectedPart()?.id || this.editPartId,
      partName: this.selectedPart()?.name || this.editPartName,
      cableDiagramImage: this.cableDiagramImage
    };

    this.dialogRef.close(cable);
  }
}
