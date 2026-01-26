import { Component, Inject, OnInit, inject, signal, computed, effect } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSelectModule } from '@angular/material/select';
import { CommonModule } from '@angular/common';
import { InventoryService } from '../../../services/inventory.service';
import { HarnessPartsService } from '../../../services/harness-parts.service';
import { HarnessService } from '../../../services/harness.service';
import { Part, PartCategory, UnitOfMeasure } from '../../../models';
import { DbHarnessConnector, DbHarnessWire, DbHarnessCable, createEmptyHarnessData } from '../../../models/harness.model';
import { ErrorNotificationService } from '../../../services/error-notification.service';
import { MatIconModule } from '@angular/material/icon';
import { WIRE_COLORS, WireColor } from '../../../utils/harness/wire-color-map';

@Component({
  selector: 'app-part-edit-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatCheckboxModule,
    MatSelectModule,
    MatIconModule
  ],
  templateUrl: './part-edit-dialog.html',
  styleUrl: './part-edit-dialog.css',
})
export class PartEditDialog implements OnInit {
  private fb = inject(FormBuilder);
  private inventoryService = inject(InventoryService);
  private harnessPartsService = inject(HarnessPartsService);
  private harnessService = inject(HarnessService);
  private errorNotification = inject(ErrorNotificationService);
  isEditMode = false;
  allParts: Part[] = [];
  suggestedPartNumber = '';
  lockedCategoryName: string | null = null;

  categories = signal<PartCategory[]>([]);
  unitsOfMeasure = signal<UnitOfMeasure[]>([]);

  // Harness-specific data
  existingConnector = signal<DbHarnessConnector | null>(null);
  existingWire = signal<DbHarnessWire | null>(null);
  existingCable = signal<DbHarnessCable | null>(null);

  // Connector images
  connectorImage = signal<string | null>(null);
  pinoutDiagramImage = signal<string | null>(null);

  // Cable diagram image
  cableDiagramImage = signal<string | null>(null);

  // Cable wire colors
  cableWireColors = signal<{ id: string; color: string; colorCode: string }[]>([]);
  wireColorOptions = WIRE_COLORS;

  // Computed property to get the selected category name
  selectedCategoryName = computed(() => {
    const categoryId = this.form.get('partCategoryID')?.value;
    const category = this.categories().find(c => c.id === categoryId);
    return category?.name || '';
  });

  form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(16)]],
    description: ['', Validators.maxLength(62)],
    internalPart: [false, Validators.required],
    vendor: [''],
    sku: [''],
    link: [''],
    minimumOrderQuantity: [1, [Validators.required, Validators.min(1)]],
    partCategoryID: [null as number | null, Validators.required],
    serialNumberRequired: [false],
    lotNumberRequired: [false],
    defaultUnitOfMeasureID: [1 as number | null],
    manufacturer: [''],
    manufacturerPN: [''],
    manufacturerSameAsVendor: [false],
    // Connector fields
    connectorType: ['male' as 'male' | 'female' | 'terminal' | 'splice'],
    connectorPinCount: [1, [Validators.min(1)]],
    connectorColor: [''],
    // Wire fields
    wireColor: ['Black'],
    wireColorCode: ['BK'],
    wireGauge: ['22'],
    // Cable fields
    cableWireCount: [1, [Validators.min(1)]],
    cableGauge: ['22']
  });

  constructor(
    public dialogRef: MatDialogRef<PartEditDialog>,
    @Inject(MAT_DIALOG_DATA) public data: { part?: Part; lockedCategory?: string }
  ) {
    // Store locked category if provided
    if (data.lockedCategory) {
      this.lockedCategoryName = data.lockedCategory;
    }

    if (data.part) {
      this.isEditMode = true;
      this.form.patchValue({
        name: data.part.name,
        description: data.part.description || '',
        internalPart: data.part.internalPart,
        vendor: data.part.vendor,
        sku: data.part.sku || '',
        link: data.part.link || '',
        minimumOrderQuantity: data.part.minimumOrderQuantity,
        partCategoryID: data.part.partCategoryID,
        serialNumberRequired: data.part.serialNumberRequired || false,
        lotNumberRequired: data.part.lotNumberRequired || false,
        defaultUnitOfMeasureID: data.part.defaultUnitOfMeasureID || 1,
        manufacturer: data.part.manufacturer || '',
        manufacturerPN: data.part.manufacturerPN || ''
      });
      // Load harness-specific data
      this.loadHarnessData(data.part.id, data.part.PartCategory?.name);
    } else if (this.lockedCategoryName === 'Harness') {
      // For new harness parts, set internalPart to true and vendor to Letwin
      this.form.patchValue({
        internalPart: true,
        vendor: 'Letwin'
      });
    }
  }

  private loadHarnessData(partId: number, categoryName?: string) {
    if (!categoryName) return;

    if (categoryName === 'Connector') {
      this.harnessPartsService.getConnectorByPartId(partId).subscribe({
        next: (connector) => {
          this.existingConnector.set(connector);
          if (connector) {
            this.form.patchValue({
              connectorType: connector.type,
              connectorPinCount: connector.pinCount,
              connectorColor: connector.color || ''
            });
            // Load existing images
            this.connectorImage.set(connector.connectorImage || null);
            this.pinoutDiagramImage.set(connector.pinoutDiagramImage || null);
          }
        }
      });
    } else if (categoryName === 'Wire') {
      this.harnessPartsService.getWireByPartId(partId).subscribe({
        next: (wire) => {
          this.existingWire.set(wire);
          if (wire) {
            this.form.patchValue({
              wireColor: wire.color,
              wireColorCode: wire.colorCode || '',
              wireGauge: wire.gaugeAWG || ''
            });
          }
        }
      });
    } else if (categoryName === 'Cable') {
      this.harnessPartsService.getCableByPartId(partId).subscribe({
        next: (cable) => {
          this.existingCable.set(cable);
          if (cable) {
            this.form.patchValue({
              cableWireCount: cable.wireCount,
              cableGauge: cable.gaugeAWG || ''
            });
            // Load existing wire colors
            if (cable.wires && cable.wires.length > 0) {
              this.cableWireColors.set(cable.wires.map((w, i) => ({
                id: w.id || `wire-${i + 1}`,
                color: w.color,
                colorCode: w.colorCode || WIRE_COLORS.find(c => c.name === w.color)?.code || 'BK'
              })));
            } else {
              // Initialize with default colors
              this.updateCableWireColors(cable.wireCount);
            }
            // Load existing cable diagram image
            this.cableDiagramImage.set(cable.cableDiagramImage || null);
          }
        }
      });
    }
  }

  ngOnInit() {
    // Load all parts to check for uniqueness and suggest next number
    this.inventoryService.getAllParts().subscribe({
      next: (parts) => {
        this.allParts = parts;
        if (!this.isEditMode) {
          this.suggestedPartNumber = this.getNextAvailablePartNumber();
          this.form.patchValue({ name: this.suggestedPartNumber });
        }
      },
      error: (err) => {
        console.error('Failed to load parts:', err);
      }
    });

    // Load units of measure
    this.inventoryService.getUnitsOfMeasure().subscribe({
      next: (uom) => {
        this.unitsOfMeasure.set(uom);
      },
      error: (err) => {
        console.error('Failed to load units of measure:', err);
      }
    });

    // Load part categories from API
    this.inventoryService.getPartCategories().subscribe({
      next: (categories) => {
        this.categories.set(categories);
        // If in edit mode and we have a category, load harness data now that we have category names
        if (this.isEditMode && this.data.part) {
          const category = categories.find(c => c.id === this.data.part!.partCategoryID);
          if (category) {
            this.loadHarnessData(this.data.part.id, category.name);
          }
        }
        // If locked to a category, set it now
        if (this.lockedCategoryName) {
          const lockedCategory = categories.find(c => c.name === this.lockedCategoryName);
          if (lockedCategory) {
            this.form.patchValue({ partCategoryID: lockedCategory.id });
          }
        }
      },
      error: (err) => {
        console.error('Failed to load part categories:', err);
      }
    });

    // Watch for category changes to update validators
    this.form.get('partCategoryID')?.valueChanges.subscribe(categoryId => {
      this.updateCategoryValidators(categoryId);
      // Initialize wire colors when Cable category is selected
      const categoryName = this.getCategoryName(categoryId);
      if (categoryName === 'Cable' && this.cableWireColors().length === 0) {
        const wireCount = this.form.get('cableWireCount')?.value || 1;
        this.updateCableWireColors(wireCount);
      }
    });

    // Watch for cable wire count changes to update wire colors
    this.form.get('cableWireCount')?.valueChanges.subscribe(wireCount => {
      if (wireCount && wireCount > 0 && this.isCable()) {
        this.updateCableWireColors(wireCount);
      }
    });

    // Update vendor validation when internalPart changes
    this.form.get('internalPart')?.valueChanges.subscribe(isInternal => {
      const vendorControl = this.form.get('vendor');
      const manufacturerControl = this.form.get('manufacturer');
      const manufacturerPNControl = this.form.get('manufacturerPN');

      if (isInternal) {
        // Internal parts don't require vendor or manufacturer
        vendorControl?.clearValidators();
        manufacturerControl?.clearValidators();
        manufacturerPNControl?.clearValidators();
        // Clear manufacturer fields for internal parts
        this.form.patchValue({
          manufacturer: '',
          manufacturerPN: '',
          manufacturerSameAsVendor: false
        });
      } else {
        // External parts require vendor and manufacturer
        vendorControl?.setValidators([Validators.required]);
        manufacturerControl?.setValidators([Validators.required]);
        manufacturerPNControl?.setValidators([Validators.required]);
      }
      vendorControl?.updateValueAndValidity();
      manufacturerControl?.updateValueAndValidity();
      manufacturerPNControl?.updateValueAndValidity();
    });

    // Set initial vendor and manufacturer validation based on current internalPart value
    const isInternal = this.form.get('internalPart')?.value;
    const vendorControl = this.form.get('vendor');
    const manufacturerControl = this.form.get('manufacturer');
    const manufacturerPNControl = this.form.get('manufacturerPN');
    if (!isInternal) {
      vendorControl?.setValidators([Validators.required]);
      manufacturerControl?.setValidators([Validators.required]);
      manufacturerPNControl?.setValidators([Validators.required]);
      vendorControl?.updateValueAndValidity();
      manufacturerControl?.updateValueAndValidity();
      manufacturerPNControl?.updateValueAndValidity();
    }

    // Handle "manufacturer same as vendor" checkbox
    this.form.get('manufacturerSameAsVendor')?.valueChanges.subscribe(isSame => {
      if (isSame) {
        // Copy vendor info to manufacturer fields
        const vendor = this.form.get('vendor')?.value;
        const sku = this.form.get('sku')?.value;
        this.form.patchValue({
          manufacturer: vendor || '',
          manufacturerPN: sku || ''
        });
        // Disable manufacturer fields when checkbox is checked
        this.form.get('manufacturer')?.disable();
        this.form.get('manufacturerPN')?.disable();
      } else {
        // Enable manufacturer fields when checkbox is unchecked
        this.form.get('manufacturer')?.enable();
        this.form.get('manufacturerPN')?.enable();
      }
    });

    // When vendor or SKU changes, update manufacturer fields if checkbox is checked
    this.form.get('vendor')?.valueChanges.subscribe(vendor => {
      if (this.form.get('manufacturerSameAsVendor')?.value) {
        this.form.patchValue({ manufacturer: vendor || '' });
      }
    });

    this.form.get('sku')?.valueChanges.subscribe(sku => {
      if (this.form.get('manufacturerSameAsVendor')?.value) {
        this.form.patchValue({ manufacturerPN: sku || '' });
      }
    });
  }

  getCategoryName(categoryId: number | null | undefined): string {
    if (!categoryId) return '';
    const category = this.categories().find(c => c.id === categoryId);
    return category?.name || '';
  }

  isConnector(): boolean {
    const categoryId = this.form.get('partCategoryID')?.value as number | null | undefined;
    return this.getCategoryName(categoryId) === 'Connector';
  }

  isWire(): boolean {
    const categoryId = this.form.get('partCategoryID')?.value as number | null | undefined;
    return this.getCategoryName(categoryId) === 'Wire';
  }

  isCable(): boolean {
    const categoryId = this.form.get('partCategoryID')?.value as number | null | undefined;
    return this.getCategoryName(categoryId) === 'Cable';
  }

  isHarness(): boolean {
    const categoryId = this.form.get('partCategoryID')?.value as number | null | undefined;
    return this.getCategoryName(categoryId) === 'Harness';
  }

  private updateCategoryValidators(categoryId: number | null | undefined) {
    const categoryName = this.getCategoryName(categoryId);
    const connectorTypeControl = this.form.get('connectorType');
    const connectorPinCountControl = this.form.get('connectorPinCount');
    const wireColorControl = this.form.get('wireColor');
    const cableWireCountControl = this.form.get('cableWireCount');

    // Clear all category-specific validators first
    connectorTypeControl?.clearValidators();
    connectorPinCountControl?.clearValidators();
    wireColorControl?.clearValidators();
    cableWireCountControl?.clearValidators();

    // Set validators based on category
    if (categoryName === 'Connector') {
      connectorTypeControl?.setValidators([Validators.required]);
      connectorPinCountControl?.setValidators([Validators.required, Validators.min(1)]);
    } else if (categoryName === 'Wire') {
      wireColorControl?.setValidators([Validators.required]);
    } else if (categoryName === 'Cable') {
      cableWireCountControl?.setValidators([Validators.required, Validators.min(1)]);
    }

    connectorTypeControl?.updateValueAndValidity();
    connectorPinCountControl?.updateValueAndValidity();
    wireColorControl?.updateValueAndValidity();
    cableWireCountControl?.updateValueAndValidity();
  }

  getNextAvailablePartNumber(): string {
    // Find the highest part ID
    const maxPartId = this.allParts.length > 0
      ? Math.max(...this.allParts.map(p => p.id))
      : 0;

    // Next part ID will be maxPartId + 1, formatted as 6-digit number with leading zeros
    const nextPartId = maxPartId + 1;
    return nextPartId.toString().padStart(6, '0');
  }

  isPartNameTaken(): boolean {
    const currentName = this.form.get('name')?.value?.trim();
    if (!currentName) return false;

    // In edit mode, ignore the current part's own name
    if (this.isEditMode && this.data.part) {
      return this.allParts.some(p =>
        p.name.toLowerCase() === currentName.toLowerCase() &&
        p.id !== this.data.part!.id
      );
    }

    // In create mode, check if any part has this name
    return this.allParts.some(p => p.name.toLowerCase() === currentName.toLowerCase());
  }

  getPartNameError(): string {
    const nameControl = this.form.get('name');
    if (nameControl?.hasError('required')) {
      return 'Part name is required';
    }
    if (nameControl?.hasError('maxlength')) {
      return 'Part name must be 16 characters or less';
    }
    if (this.isPartNameTaken()) {
      return 'This part name is already in use';
    }
    return '';
  }

  // Image upload handlers
  onConnectorImageSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.convertToBase64(input.files[0], (base64) => {
        this.connectorImage.set(base64);
      });
    }
  }

  onPinoutDiagramSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.convertToBase64(input.files[0], (base64) => {
        this.pinoutDiagramImage.set(base64);
      });
    }
  }

  private convertToBase64(file: File, callback: (base64: string) => void) {
    const reader = new FileReader();
    reader.onload = () => {
      callback(reader.result as string);
    };
    reader.readAsDataURL(file);
  }

  removeConnectorImage() {
    this.connectorImage.set(null);
  }

  removePinoutDiagram() {
    this.pinoutDiagramImage.set(null);
  }

  onCableDiagramSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.convertToBase64(input.files[0], (base64) => {
        this.cableDiagramImage.set(base64);
      });
    }
  }

  removeCableDiagram() {
    this.cableDiagramImage.set(null);
  }

  // Update cable wire colors when wire count changes
  updateCableWireColors(wireCount: number) {
    const currentColors = this.cableWireColors();
    const newColors: { id: string; color: string; colorCode: string }[] = [];

    for (let i = 0; i < wireCount; i++) {
      if (i < currentColors.length) {
        // Keep existing color
        newColors.push(currentColors[i]);
      } else {
        // Add new wire with default color (cycle through common colors)
        const defaultColor = WIRE_COLORS[i % WIRE_COLORS.length];
        newColors.push({
          id: `wire-${i + 1}`,
          color: defaultColor.name,
          colorCode: defaultColor.code
        });
      }
    }

    this.cableWireColors.set(newColors);
  }

  // Update a specific wire's color
  onWireColorChange(wireIndex: number, colorCode: string) {
    const wireColor = WIRE_COLORS.find(c => c.code === colorCode);
    if (!wireColor) return;

    const colors = [...this.cableWireColors()];
    if (wireIndex < colors.length) {
      colors[wireIndex] = {
        ...colors[wireIndex],
        color: wireColor.name,
        colorCode: wireColor.code
      };
      this.cableWireColors.set(colors);
    }
  }

  // Get hex color for a color code
  getWireColorHex(colorCode: string): string {
    const color = WIRE_COLORS.find(c => c.code === colorCode);
    return color?.hex || '#808080';
  }

  getFormValidationErrors(): string[] {
    const errors: string[] = [];

    if (this.form.get('name')?.hasError('required')) {
      errors.push('Part number is required');
    }
    if (this.form.get('name')?.hasError('maxlength')) {
      errors.push('Part number must be 16 characters or less');
    }
    if (this.isPartNameTaken()) {
      errors.push('Part name is already in use');
    }
    if (this.form.get('partCategoryID')?.hasError('required')) {
      errors.push('Category is required');
    }
    if (this.form.get('vendor')?.hasError('required')) {
      errors.push('Vendor is required');
    }
    if (this.form.get('manufacturer')?.hasError('required')) {
      errors.push('Manufacturer is required for vendor parts');
    }
    if (this.form.get('manufacturerPN')?.hasError('required')) {
      errors.push('Manufacturer Part Number is required for vendor parts');
    }
    if (this.form.get('minimumOrderQuantity')?.hasError('required')) {
      errors.push('Minimum order quantity is required');
    }
    if (this.form.get('minimumOrderQuantity')?.hasError('min')) {
      errors.push('Minimum order quantity must be at least 1');
    }

    return errors;
  }

  save() {
    // Mark all fields as touched to show validation errors
    Object.keys(this.form.controls).forEach(key => {
      this.form.get(key)?.markAsTouched();
    });

    // Check for duplicate part name
    if (this.isPartNameTaken()) {
      this.errorNotification.showError('This part name is already in use. Please choose a different name.');
      return;
    }

    if (!this.form.valid) {
      const errors = this.getFormValidationErrors();
      const errorMessage = errors.length > 0
        ? 'Please fix the following errors: ' + errors.join(', ')
        : 'Please fill in all required fields correctly';
      this.errorNotification.showError(errorMessage);
      return;
    }

    if (this.form.valid) {
      const formValue = this.form.value;
      const partData = {
        name: formValue.name!,
        description: formValue.description || '',
        internalPart: formValue.internalPart!,
        vendor: formValue.vendor!,
        sku: formValue.sku || '',
        link: formValue.link || '',
        minimumOrderQuantity: formValue.minimumOrderQuantity!,
        partCategoryID: formValue.partCategoryID!,
        serialNumberRequired: formValue.serialNumberRequired || false,
        lotNumberRequired: formValue.lotNumberRequired || false,
        defaultUnitOfMeasureID: formValue.defaultUnitOfMeasureID || 1,
        manufacturer: this.form.get('manufacturer')?.value || '',
        manufacturerPN: this.form.get('manufacturerPN')?.value || ''
      };

      if (this.isEditMode && this.data.part?.id) {
        this.inventoryService.updatePart(this.data.part.id, partData).subscribe({
          next: (response: any) => {
            this.saveHarnessData(response.id || this.data.part!.id);
            this.errorNotification.showSuccess('Part updated successfully');
            this.dialogRef.close(true);
          },
          error: (err) => {
            this.errorNotification.showHttpError(err, 'Failed to update part');
          }
        });
      } else {
        this.inventoryService.createPart(partData).subscribe({
          next: (response: any) => {
            // Don't call saveHarnessData for Harness parts - the harness-page will handle that
            if (!this.lockedCategoryName || this.lockedCategoryName !== 'Harness') {
              this.saveHarnessData(response.id);
            }
            this.errorNotification.showSuccess('Part created successfully');
            // Return the created part for harness creation
            if (this.lockedCategoryName === 'Harness') {
              this.dialogRef.close({ ...response, name: partData.name, description: partData.description } as Part);
            } else {
              this.dialogRef.close(true);
            }
          },
          error: (err) => {
            this.errorNotification.showHttpError(err, 'Failed to create part');
          }
        });
      }
    }
  }

  private saveHarnessData(partId: number) {
    const categoryId = this.form.get('partCategoryID')?.value as number | null | undefined;
    const categoryName = this.getCategoryName(categoryId);
    const partName = this.form.get('name')?.value || '';

    if (categoryName === 'Connector') {
      const connectorData: {
        label: string;
        type: 'male' | 'female' | 'terminal' | 'splice';
        pinCount: number;
        color?: string;
        partID: number;
        connectorImage?: string | null;
        pinoutDiagramImage?: string | null;
      } = {
        label: partName,
        type: this.form.get('connectorType')?.value as 'male' | 'female' | 'terminal' | 'splice',
        pinCount: this.form.get('connectorPinCount')?.value || 1,
        color: this.form.get('connectorColor')?.value || undefined,
        partID: partId,
        // Explicitly pass null to clear images, or the image data to set them
        connectorImage: this.connectorImage(),
        pinoutDiagramImage: this.pinoutDiagramImage()
      };

      const existingConnector = this.existingConnector();
      if (existingConnector) {
        this.harnessPartsService.updateConnector(existingConnector.id, connectorData).subscribe({
          error: (err) => {
            console.error('Failed to update connector:', err);
            this.errorNotification.showHttpError(err, 'Failed to save connector data');
          }
        });
      } else {
        this.harnessPartsService.createConnector(connectorData).subscribe({
          error: (err) => {
            console.error('Failed to create connector:', err);
            this.errorNotification.showHttpError(err, 'Failed to save connector data');
          }
        });
      }
    } else if (categoryName === 'Wire') {
      const wireData = {
        label: partName,
        color: this.form.get('wireColor')?.value || 'Black',
        colorCode: this.form.get('wireColorCode')?.value || undefined,
        gaugeAWG: this.form.get('wireGauge')?.value || undefined,
        partID: partId
      };

      const existingWire = this.existingWire();
      if (existingWire) {
        this.harnessPartsService.updateWire(existingWire.id, wireData).subscribe();
      } else {
        this.harnessPartsService.createWire(wireData).subscribe();
      }
    } else if (categoryName === 'Cable') {
      const cableData = {
        label: partName,
        wireCount: this.form.get('cableWireCount')?.value || 1,
        gaugeAWG: this.form.get('cableGauge')?.value || undefined,
        wires: this.cableWireColors(),
        partID: partId,
        cableDiagramImage: this.cableDiagramImage()
      };

      const existingCable = this.existingCable();
      if (existingCable) {
        this.harnessPartsService.updateCable(existingCable.id, cableData).subscribe();
      } else {
        this.harnessPartsService.createCable(cableData).subscribe();
      }
    } else if (categoryName === 'Harness') {
      // Create a WireHarness record linked to this part (only for new parts)
      if (!this.isEditMode) {
        const description = this.form.get('description')?.value || '';

        // Create a new wire harness with empty data
        const harnessData = createEmptyHarnessData(partName);
        harnessData.description = description;

        this.harnessService.createHarness({
          name: partName,
          description: description,
          harnessData: harnessData,
          partID: partId  // Link to the part we just created
        }).subscribe();
      }
    }
  }

  delete() {
    if (!this.isEditMode || !this.data.part?.id) {
      return;
    }

    const confirmed = confirm(`Are you sure you want to delete part "${this.data.part.name}"? This will mark it as inactive.`);
    if (!confirmed) {
      return;
    }

    console.log('Deleting part:', this.data.part.id);
    this.inventoryService.deletePart(this.data.part.id).subscribe({
      next: (response) => {
        console.log('Delete successful:', response);
        this.errorNotification.showSuccess('Part deleted successfully');
        this.dialogRef.close(true);
      },
      error: (err) => {
        console.error('Delete failed:', err);
        this.errorNotification.showHttpError(err, 'Failed to delete part');
      }
    });
  }
}
