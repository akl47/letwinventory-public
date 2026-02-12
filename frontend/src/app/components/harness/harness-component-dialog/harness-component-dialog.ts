import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormControl } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  HarnessComponent,
  HarnessComponentPinGroup,
  DbElectricalComponent
} from '../../../models/harness.model';
import { Part } from '../../../models';
import { InventoryService } from '../../../services/inventory.service';
import { HarnessPartsService } from '../../../services/harness-parts.service';
import { debounceTime, distinctUntilChanged, switchMap, of } from 'rxjs';

interface DialogData {
  existingComponents?: HarnessComponent[];
  editComponent?: HarnessComponent;
  isLocked?: boolean;
}

@Component({
  selector: 'app-harness-component-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatAutocompleteModule,
    MatProgressSpinnerModule,
    MatTooltipModule
  ],
  templateUrl: './harness-component-dialog.html',
  styleUrls: ['./harness-component-dialog.scss']
})
export class HarnessComponentDialog implements OnInit {
  private dialogRef = inject(MatDialogRef<HarnessComponentDialog>);
  private data = inject<DialogData>(MAT_DIALOG_DATA, { optional: true });
  private inventoryService = inject(InventoryService);
  private harnessPartsService = inject(HarnessPartsService);

  // Part search
  partSearchControl = new FormControl('');
  filteredParts = signal<Part[]>([]);
  isLoading = signal(false);
  selectedPart = signal<Part | null>(null);
  linkedComponent = signal<DbElectricalComponent | null>(null);

  // Form fields
  label = '';
  pinCount = 0;
  pinGroups = signal<HarnessComponentPinGroup[]>([]);

  isEdit = signal<boolean>(false);
  isLocked = signal<boolean>(false);
  private editId: string | null = null;
  private editPosition: { x: number; y: number } = { x: 200, y: 200 };
  private editRotation: 0 | 90 | 180 | 270 = 0;
  private editFlipped: boolean = false;
  private editPartName: string | undefined = undefined;
  private editPartId: number | undefined = undefined;
  private editDbId: number | undefined = undefined;
  private editComponentImage: string | undefined = undefined;
  private editPinoutDiagramImage: string | undefined = undefined;

  constructor() {
    if (this.data?.isLocked) {
      this.isLocked.set(true);
    }
    if (this.data?.editComponent) {
      // Edit mode - preserve all existing properties
      this.isEdit.set(true);
      const component = this.data.editComponent;
      this.editId = component.id;
      this.label = component.label;
      this.pinCount = component.pinCount;
      this.pinGroups.set([...component.pinGroups]);
      this.editPosition = component.position || { x: 200, y: 200 };
      this.editRotation = component.rotation || 0;
      this.editFlipped = component.flipped || false;
      this.editPartName = component.partName;
      this.editPartId = component.partId;
      this.editDbId = component.dbId;
      this.editComponentImage = component.componentImage;
      this.editPinoutDiagramImage = component.pinoutDiagramImage;
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
          return this.inventoryService.searchPartsByCategory('Electrical Component', value);
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

    // Load the electrical component data linked to this part
    this.harnessPartsService.getComponentByPartId(part.id).subscribe({
      next: (component) => {
        if (component) {
          this.linkedComponent.set(component);
          // Populate form with component data
          this.pinCount = component.pinCount;
          // Generate unique label
          this.label = this.generateUniqueLabel(component.label);
          // Set up pin groups - convert from DB format to harness format
          this.pinGroups.set(component.pins.map((group, gi) => ({
            id: `group-${Date.now()}-${gi + 1}`,
            name: group.name,
            pinTypeID: group.pinTypeID,
            pinTypeName: group.pinTypeName,
            pins: group.pins.map((p, pi) => ({
              id: `pin-${Date.now()}-${gi}-${pi + 1}`,
              number: p.number || String(pi + 1),
              label: p.label || ''
            }))
          })));
        } else {
          // No linked component data - use defaults
          this.label = part.name;
          this.pinCount = 0;
          this.pinGroups.set([]);
        }
      }
    });
  }

  private generateUniqueLabel(baseLabel: string): string {
    if (!this.data?.existingComponents) return baseLabel;

    const existingLabels = new Set(this.data.existingComponents.map(c => c.label));
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
    this.linkedComponent.set(null);
    this.partSearchControl.setValue('');
    this.pinGroups.set([]);
  }

  getTotalPinCount(): number {
    return this.pinGroups().reduce((total, group) => total + group.pins.length, 0);
  }

  isValid(): boolean {
    if (!this.label.trim()) return false;
    if (!this.selectedPart() && !this.isEdit()) return false;

    // Check for duplicate label (only if not editing)
    if (!this.isEdit() && this.data?.existingComponents) {
      const exists = this.data.existingComponents.some(c => c.label === this.label.trim());
      if (exists) return false;
    }

    return true;
  }

  save() {
    if (!this.isValid()) return;

    const linked = this.linkedComponent();
    const component: HarnessComponent = {
      id: this.editId || `component-${Date.now()}`,
      label: this.label.trim(),
      pinCount: this.getTotalPinCount(),
      pinGroups: this.pinGroups(),
      position: this.editPosition,
      rotation: this.editRotation,
      flipped: this.editFlipped,
      dbId: linked?.id || this.editDbId,
      partId: this.selectedPart()?.id || this.editPartId,
      partName: this.selectedPart()?.name || this.editPartName,
      // Use Part image, fall back to linked component image or preserved edit image
      componentImage: this.selectedPart()?.imageFile?.data || linked?.componentImage || this.editComponentImage,
      pinoutDiagramImage: linked?.pinoutDiagramImage || this.editPinoutDiagramImage
    };

    this.dialogRef.close(component);
  }
}
