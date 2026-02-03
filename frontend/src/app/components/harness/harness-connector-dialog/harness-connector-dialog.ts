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
import { HarnessConnector, HarnessPin, DbHarnessConnector } from '../../../models/harness.model';
import { Part } from '../../../models';
import { InventoryService } from '../../../services/inventory.service';
import { HarnessPartsService } from '../../../services/harness-parts.service';
import { CONNECTOR_COLORS } from '../../../utils/harness/wire-color-map';
import { debounceTime, distinctUntilChanged, switchMap, of } from 'rxjs';

interface DialogData {
  existingConnectors?: HarnessConnector[];
  editConnector?: HarnessConnector;
  isLocked?: boolean;
}

@Component({
  selector: 'app-harness-connector-dialog',
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
    MatTooltipModule
  ],
  templateUrl: './harness-connector-dialog.html',
  styleUrls: ['./harness-connector-dialog.scss']
})
export class HarnessConnectorDialog implements OnInit {
  private dialogRef = inject(MatDialogRef<HarnessConnectorDialog>);
  private data = inject<DialogData>(MAT_DIALOG_DATA, { optional: true });
  private inventoryService = inject(InventoryService);
  private harnessPartsService = inject(HarnessPartsService);

  connectorColors = CONNECTOR_COLORS;

  // Part search
  partSearchControl = new FormControl('');
  filteredParts = signal<Part[]>([]);
  isLoading = signal(false);
  selectedPart = signal<Part | null>(null);
  linkedConnector = signal<DbHarnessConnector | null>(null);

  // Form fields
  label = '';
  connectorType: 'male' | 'female' | 'terminal' | 'splice' = 'male';
  pinCount = 4;
  color = 'GY';
  pins = signal<HarnessPin[]>([]);

  isEdit = signal<boolean>(false);
  isLocked = signal<boolean>(false);
  private editId: string | null = null;
  private editPosition: { x: number; y: number } = { x: 200, y: 200 };
  private editRotation: 0 | 90 | 180 | 270 = 0;
  private editFlipped: boolean = false;
  private editPartName: string | undefined = undefined;
  private editPartId: number | undefined = undefined;
  private editDbId: number | undefined = undefined;
  private editConnectorImage: string | undefined = undefined;
  private editPinoutDiagramImage: string | undefined = undefined;

  constructor() {
    if (this.data?.isLocked) {
      this.isLocked.set(true);
    }
    if (this.data?.editConnector) {
      // Edit mode - preserve all existing properties
      this.isEdit.set(true);
      const connector = this.data.editConnector;
      this.editId = connector.id;
      this.label = connector.label;
      this.connectorType = connector.type;
      this.pinCount = connector.pinCount;
      this.color = connector.color || 'GY';
      this.pins.set([...connector.pins]);
      this.editPosition = connector.position || { x: 200, y: 200 };
      this.editRotation = connector.rotation || 0;
      this.editFlipped = connector.flipped || false;
      this.editPartName = connector.partName;
      this.editPartId = connector.partId;
      this.editDbId = connector.dbId;
      this.editConnectorImage = connector.connectorImage;
      this.editPinoutDiagramImage = connector.pinoutDiagramImage;
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
          return this.inventoryService.searchPartsByCategory('Connector', value);
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

    // Load the harness connector data linked to this part
    this.harnessPartsService.getConnectorByPartId(part.id).subscribe({
      next: (connector) => {
        if (connector) {
          this.linkedConnector.set(connector);
          // Populate form with connector data (read-only fields from part)
          this.connectorType = connector.type;
          this.pinCount = connector.pinCount;
          this.color = connector.color || 'GY';
          // Generate unique label
          this.label = this.generateUniqueLabel(connector.label);
          // Set up pins
          this.pins.set(connector.pins.map((p, i) => ({
            id: `pin-${Date.now()}-${i + 1}`,
            number: p.number || String(i + 1),
            label: p.label || ''
          })));
        } else {
          // No linked connector data - use defaults
          this.label = part.name;
          this.connectorType = 'male';
          this.pinCount = 1;
          this.color = 'GY';
          this.pins.set([{ id: 'pin-1', number: '1', label: '' }]);
        }
      }
    });
  }

  private generateUniqueLabel(baseLabel: string): string {
    if (!this.data?.existingConnectors) return baseLabel;

    const existingLabels = new Set(this.data.existingConnectors.map(c => c.label));
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
    this.linkedConnector.set(null);
    this.partSearchControl.setValue('');
    this.pins.set([]);
  }

  getTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      'male': 'Male',
      'female': 'Female',
      'terminal': 'Terminal',
      'splice': 'Splice'
    };
    return labels[type] || type;
  }

  getColorHex(code: string): string {
    const color = this.connectorColors.find(c => c.code === code);
    return color?.hex || '#808080';
  }

  getColorName(code: string): string {
    const color = this.connectorColors.find(c => c.code === code);
    return color?.name || code;
  }

  isValid(): boolean {
    if (!this.label.trim()) return false;
    if (!this.selectedPart() && !this.isEdit()) return false;

    // Check for duplicate label (only if not editing)
    if (!this.isEdit() && this.data?.existingConnectors) {
      const exists = this.data.existingConnectors.some(c => c.label === this.label.trim());
      if (exists) return false;
    }

    return true;
  }

  save() {
    if (!this.isValid()) return;

    const linked = this.linkedConnector();
    const connector: HarnessConnector = {
      id: this.editId || `connector-${Date.now()}`,
      label: this.label.trim(),
      type: this.connectorType,
      pinCount: this.pinCount,
      pins: this.pins(),
      position: this.editPosition,
      color: this.color,
      rotation: this.editRotation,
      flipped: this.editFlipped,
      dbId: linked?.id || this.editDbId,
      partId: this.selectedPart()?.id || this.editPartId,
      partName: this.selectedPart()?.name || this.editPartName,
      // Include images from linked connector or preserve from edit
      connectorImage: linked?.connectorImage || this.editConnectorImage,
      pinoutDiagramImage: linked?.pinoutDiagramImage || this.editPinoutDiagramImage
    };

    this.dialogRef.close(connector);
  }
}
