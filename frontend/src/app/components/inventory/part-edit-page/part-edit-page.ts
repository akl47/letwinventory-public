import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSelectModule } from '@angular/material/select';
import { CommonModule, Location, TitleCasePipe } from '@angular/common';
import { forkJoin, of, combineLatest } from 'rxjs';
import { catchError, take } from 'rxjs/operators';
import { InventoryService } from '../../../services/inventory.service';
import { AuthService } from '../../../services/auth.service';
import { HarnessPartsService } from '../../../services/harness-parts.service';
import { HarnessService } from '../../../services/harness.service';
import { Part, PartCategory, UnitOfMeasure } from '../../../models';
import { DbHarnessConnector, DbHarnessWire, DbHarnessCable, DbElectricalComponent, ElectricalPinType, ComponentPinGroup, createEmptyHarnessData } from '../../../models/harness.model';
import { ErrorNotificationService } from '../../../services/error-notification.service';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { WIRE_COLORS } from '../../../utils/harness/wire-color-map';

@Component({
  selector: 'app-part-edit-page',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatCheckboxModule,
    MatSelectModule,
    MatIconModule,
    MatTooltipModule
  ],
  templateUrl: './part-edit-page.html',
  styleUrl: './part-edit-page.css',
})
export class PartEditPage implements OnInit {
  private fb = inject(FormBuilder);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private inventoryService = inject(InventoryService);
  private authService = inject(AuthService);
  private harnessPartsService = inject(HarnessPartsService);
  private harnessService = inject(HarnessService);
  private errorNotification = inject(ErrorNotificationService);
  private location = inject(Location);
  canWrite = computed(() => this.authService.hasPermission('parts', 'write'));

  isEditMode = false;
  isFormEditMode = signal(false);
  isLoadingPart = false; // Flag to prevent form valueChanges from interfering during load
  isDataLoaded = signal(false); // Flag to indicate when data is ready to display
  allParts: Part[] = [];
  suggestedPartNumber = '';
  lockedCategoryName: string | null = null;
  currentPart: Part | null = null;

  categories = signal<PartCategory[]>([]);
  unitsOfMeasure = signal<UnitOfMeasure[]>([]);
  pinTypes = signal<ElectricalPinType[]>([]);

  // Harness-specific data
  existingConnector = signal<DbHarnessConnector | null>(null);
  existingWire = signal<DbHarnessWire | null>(null);
  existingCable = signal<DbHarnessCable | null>(null);
  existingComponent = signal<DbElectricalComponent | null>(null);

  // Component pin groups
  componentPinGroups = signal<ComponentPinGroup[]>([]);

  // Connector pinout diagram
  pinoutDiagramImage = signal<string | null>(null);
  pinoutDiagramFile = signal<File | null>(null);
  pinoutDiagramFileID = signal<number | null>(null);

  // Component pinout diagram
  componentPinoutImage = signal<string | null>(null);
  componentPinoutFile = signal<File | null>(null);
  componentPinoutFileID = signal<number | null>(null);

  // Cable diagram
  cableDiagramImage = signal<string | null>(null);
  cableDiagramFile = signal<File | null>(null);
  cableDiagramFileID = signal<number | null>(null);

  // Part image (base64 for preview)
  partImage = signal<string | null>(null);
  partImageFile = signal<File | null>(null);
  partImageFileID = signal<number | null>(null);

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
    name: ['', [Validators.required, Validators.maxLength(32)]],
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
    connectorPinTypeID: [null as number | null],
    // Wire fields
    wireColor: ['Black'],
    wireColorCode: ['BK'],
    wireGauge: ['22'],
    // Cable fields
    cableWireCount: [1, [Validators.min(1)]],
    cableGauge: ['22']
  });

  ngOnInit() {
    // Check for locked category from query params
    this.route.queryParams.subscribe(params => {
      if (params['category']) {
        this.lockedCategoryName = params['category'];
        if (this.lockedCategoryName === 'Harness') {
          this.form.patchValue({ internalPart: true });
        }
      }
    });

    // Load all reference data first, then load part if in edit mode
    this.loadReferenceData();

    // Load all parts to check for uniqueness and suggest next number (independent)
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
        vendorControl?.clearValidators();
        manufacturerControl?.clearValidators();
        manufacturerPNControl?.clearValidators();
        // Only clear fields if user is manually changing the checkbox, not during initial load
        if (!this.isLoadingPart) {
          this.form.patchValue({
            manufacturer: '',
            manufacturerPN: '',
            manufacturerSameAsVendor: false
          });
        }
      } else {
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
        const vendor = this.form.get('vendor')?.value;
        const sku = this.form.get('sku')?.value;
        this.form.patchValue({
          manufacturer: vendor || '',
          manufacturerPN: sku || ''
        });
        this.form.get('manufacturer')?.disable();
        this.form.get('manufacturerPN')?.disable();
      } else {
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

  private loadReferenceData() {
    // Combine route params with reference data loading to ensure both are ready
    combineLatest([
      this.route.params.pipe(take(1)),
      forkJoin({
        categories: this.inventoryService.getPartCategories().pipe(
          catchError(err => {
            console.error('Failed to load part categories:', err);
            return of([]);
          })
        ),
        unitsOfMeasure: this.inventoryService.getUnitsOfMeasure().pipe(
          catchError(err => {
            console.error('Failed to load units of measure:', err);
            return of([]);
          })
        ),
        pinTypes: this.harnessPartsService.getPinTypes().pipe(
          catchError(err => {
            console.error('Failed to load pin types:', err);
            return of([]);
          })
        )
      })
    ]).subscribe({
      next: ([params, results]) => {
        // Set all reference data
        this.categories.set(results.categories);
        this.unitsOfMeasure.set(results.unitsOfMeasure);
        this.pinTypes.set(results.pinTypes);

        // If locked to a category, set it and disable the control
        if (this.lockedCategoryName) {
          const lockedCategory = results.categories.find(c => c.name === this.lockedCategoryName);
          if (lockedCategory) {
            this.form.patchValue({ partCategoryID: lockedCategory.id });
            this.form.get('partCategoryID')?.disable();
          }
          // Disable internalPart checkbox for Harness category
          if (this.lockedCategoryName === 'Harness') {
            this.form.get('internalPart')?.disable();
          }
        }

        // Now load part if in edit mode - reference data is guaranteed to be loaded
        if (params['id']) {
          this.isEditMode = true;
          this.isFormEditMode.set(false);
          this.loadPart(+params['id']);
        } else {
          this.isFormEditMode.set(true);
          this.isDataLoaded.set(true);
        }
      }
    });
  }

  private loadPart(partId: number) {
    this.inventoryService.getPartById(partId).subscribe({
      next: (part) => {
        this.currentPart = part;
        // Set flag to prevent valueChanges handlers from clearing data during load
        this.isLoadingPart = true;
        this.form.patchValue({
          name: part.name,
          description: part.description || '',
          internalPart: part.internalPart,
          vendor: part.vendor,
          sku: part.sku || '',
          link: part.link || '',
          minimumOrderQuantity: part.minimumOrderQuantity,
          partCategoryID: part.partCategoryID,
          serialNumberRequired: part.serialNumberRequired || false,
          lotNumberRequired: part.lotNumberRequired || false,
          defaultUnitOfMeasureID: part.defaultUnitOfMeasureID || 1,
          manufacturer: part.manufacturer || '',
          manufacturerPN: part.manufacturerPN || ''
        });
        this.isLoadingPart = false;
        this.isDataLoaded.set(true);
        // Load part image
        this.partImage.set(part.imageFile?.data || null);
        this.partImageFileID.set(part.imageFileID || null);
        // Load harness-specific data
        this.loadHarnessData(part.id, part.PartCategory?.name);
      },
      error: (err) => {
        console.error('Failed to load part:', err);
        this.errorNotification.showError('Failed to load part');
        this.router.navigate(['/parts']);
      }
    });
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
              connectorColor: connector.color || '',
              connectorPinTypeID: connector.electricalPinTypeID || null
            });
            this.pinoutDiagramImage.set(connector.pinoutDiagramImage || null);
            this.pinoutDiagramFileID.set(connector.pinoutDiagramFileID || null);
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
            if (cable.wires && cable.wires.length > 0) {
              this.cableWireColors.set(cable.wires.map((w, i) => ({
                id: w.id || `wire-${i + 1}`,
                color: w.color,
                colorCode: w.colorCode || WIRE_COLORS.find(c => c.name === w.color)?.code || 'BK'
              })));
            } else {
              this.updateCableWireColors(cable.wireCount);
            }
            this.cableDiagramImage.set(cable.cableDiagramImage || null);
            this.cableDiagramFileID.set(cable.cableDiagramFileID || null);
          }
        }
      });
    } else if (categoryName === 'Electrical Component') {
      this.harnessPartsService.getComponentByPartId(partId).subscribe({
        next: (component) => {
          this.existingComponent.set(component);
          if (component) {
            if (component.pins && component.pins.length > 0) {
              this.componentPinGroups.set(component.pins);
            }
            this.componentPinoutImage.set(component.pinoutDiagramImage || null);
            this.componentPinoutFileID.set(component.pinoutDiagramFileID || null);
          }
        }
      });
    }
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

  isComponent(): boolean {
    const categoryId = this.form.get('partCategoryID')?.value as number | null | undefined;
    return this.getCategoryName(categoryId) === 'Electrical Component';
  }

  private updateCategoryValidators(categoryId: number | null | undefined) {
    const categoryName = this.getCategoryName(categoryId);
    const connectorTypeControl = this.form.get('connectorType');
    const connectorPinCountControl = this.form.get('connectorPinCount');
    const wireColorControl = this.form.get('wireColor');
    const cableWireCountControl = this.form.get('cableWireCount');

    connectorTypeControl?.clearValidators();
    connectorPinCountControl?.clearValidators();
    wireColorControl?.clearValidators();
    cableWireCountControl?.clearValidators();

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
    const maxPartId = this.allParts.length > 0
      ? Math.max(...this.allParts.map(p => p.id))
      : 0;
    const nextPartId = maxPartId + 1;
    return nextPartId.toString().padStart(6, '0');
  }

  isPartNameTaken(): boolean {
    const currentName = this.form.get('name')?.value?.trim();
    if (!currentName) return false;

    if (this.isEditMode && this.currentPart) {
      return this.allParts.some(p =>
        p.name.toLowerCase() === currentName.toLowerCase() &&
        p.id !== this.currentPart!.id
      );
    }

    return this.allParts.some(p => p.name.toLowerCase() === currentName.toLowerCase());
  }

  getPartNameError(): string {
    const nameControl = this.form.get('name');
    if (nameControl?.hasError('required')) {
      return 'Part name is required';
    }
    if (nameControl?.hasError('maxlength')) {
      return 'Part name must be 32 characters or less';
    }
    if (this.isPartNameTaken()) {
      return 'This part name is already in use';
    }
    return '';
  }

  private convertToBase64(file: File, callback: (base64: string) => void) {
    const reader = new FileReader();
    reader.onload = () => {
      callback(reader.result as string);
    };
    reader.readAsDataURL(file);
  }

  onPartImageSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      this.partImageFile.set(file);
      this.convertToBase64(file, (base64) => {
        this.partImage.set(base64);
      });
    }
  }

  removePartImage() {
    this.partImage.set(null);
    this.partImageFile.set(null);
    this.partImageFileID.set(null);
  }

  onPinoutDiagramSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      this.pinoutDiagramFile.set(file);
      this.convertToBase64(file, (base64) => {
        this.pinoutDiagramImage.set(base64);
      });
    }
  }

  removePinoutDiagram() {
    this.pinoutDiagramImage.set(null);
    this.pinoutDiagramFile.set(null);
    this.pinoutDiagramFileID.set(null);
  }

  onCableDiagramSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      this.cableDiagramFile.set(file);
      this.convertToBase64(file, (base64) => {
        this.cableDiagramImage.set(base64);
      });
    }
  }

  removeCableDiagram() {
    this.cableDiagramImage.set(null);
    this.cableDiagramFile.set(null);
    this.cableDiagramFileID.set(null);
  }

  onComponentPinoutSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      this.componentPinoutFile.set(file);
      this.convertToBase64(file, (base64) => {
        this.componentPinoutImage.set(base64);
      });
    }
  }

  removeComponentPinout() {
    this.componentPinoutImage.set(null);
    this.componentPinoutFile.set(null);
    this.componentPinoutFileID.set(null);
  }

  // Component pin group management
  addPinGroup() {
    const groups = [...this.componentPinGroups()];
    const newGroup: ComponentPinGroup = {
      id: `group-${Date.now()}`,
      name: `Group ${groups.length + 1}`,
      pinTypeID: null,
      pins: [{
        id: `pin-${Date.now()}-1`,
        number: '1',
        label: ''
      }]
    };
    groups.push(newGroup);
    this.componentPinGroups.set(groups);
  }

  removePinGroup(groupIndex: number) {
    const groups = [...this.componentPinGroups()];
    groups.splice(groupIndex, 1);
    this.componentPinGroups.set(groups);
  }

  updatePinGroupName(groupIndex: number, name: string) {
    const groups = [...this.componentPinGroups()];
    if (groups[groupIndex]) {
      groups[groupIndex] = { ...groups[groupIndex], name };
      this.componentPinGroups.set(groups);
    }
  }

  updatePinGroupType(groupIndex: number, pinTypeID: number | null) {
    const groups = [...this.componentPinGroups()];
    if (groups[groupIndex]) {
      const pinType = this.pinTypes().find(pt => pt.id === pinTypeID);
      groups[groupIndex] = {
        ...groups[groupIndex],
        pinTypeID,
        pinTypeName: pinType?.name,
        matingConnector: pinType?.matingConnector || false
      };
      this.componentPinGroups.set(groups);
    }
  }

  addPinToGroup(groupIndex: number) {
    const groups = [...this.componentPinGroups()];
    if (groups[groupIndex]) {
      const group = { ...groups[groupIndex] };
      const nextPinNumber = group.pins.length + 1;
      group.pins = [...group.pins, {
        id: `pin-${Date.now()}-${nextPinNumber}`,
        number: String(nextPinNumber),
        label: ''
      }];
      groups[groupIndex] = group;
      this.componentPinGroups.set(groups);
    }
  }

  removePinFromGroup(groupIndex: number, pinIndex: number) {
    const groups = [...this.componentPinGroups()];
    if (groups[groupIndex] && groups[groupIndex].pins.length > 1) {
      const group = { ...groups[groupIndex] };
      group.pins = [...group.pins];
      group.pins.splice(pinIndex, 1);
      groups[groupIndex] = group;
      this.componentPinGroups.set(groups);
    }
  }

  updatePinNumber(groupIndex: number, pinIndex: number, number: string) {
    const groups = [...this.componentPinGroups()];
    if (groups[groupIndex] && groups[groupIndex].pins[pinIndex]) {
      const group = { ...groups[groupIndex] };
      group.pins = [...group.pins];
      group.pins[pinIndex] = { ...group.pins[pinIndex], number };
      groups[groupIndex] = group;
      this.componentPinGroups.set(groups);
    }
  }

  updatePinLabel(groupIndex: number, pinIndex: number, label: string) {
    const groups = [...this.componentPinGroups()];
    if (groups[groupIndex] && groups[groupIndex].pins[pinIndex]) {
      const group = { ...groups[groupIndex] };
      group.pins = [...group.pins];
      group.pins[pinIndex] = { ...group.pins[pinIndex], label };
      groups[groupIndex] = group;
      this.componentPinGroups.set(groups);
    }
  }

  getTotalPinCount(): number {
    return this.componentPinGroups().reduce((total, group) => total + group.pins.length, 0);
  }

  // Update cable wire colors when wire count changes
  updateCableWireColors(wireCount: number) {
    const currentColors = this.cableWireColors();
    const newColors: { id: string; color: string; colorCode: string }[] = [];

    for (let i = 0; i < wireCount; i++) {
      if (i < currentColors.length) {
        newColors.push(currentColors[i]);
      } else {
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

  getUomName(uomId: number | null | undefined): string {
    if (!uomId) return '-';
    const uom = this.unitsOfMeasure().find(u => u.id === uomId);
    return uom ? uom.name : '-';
  }

  getPinTypeName(pinTypeId: number | null | undefined): string {
    if (!pinTypeId) return '-';
    const pinType = this.pinTypes().find(pt => pt.id === pinTypeId);
    return pinType ? pinType.name : '-';
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

  cancel() {
    this.location.back();
  }

  enableEdit() {
    this.isFormEditMode.set(true);
  }

  cancelEdit() {
    if (this.currentPart) {
      // Restore form to current part values
      this.form.patchValue({
        name: this.currentPart.name,
        description: this.currentPart.description || '',
        internalPart: this.currentPart.internalPart,
        vendor: this.currentPart.vendor,
        sku: this.currentPart.sku || '',
        link: this.currentPart.link || '',
        minimumOrderQuantity: this.currentPart.minimumOrderQuantity,
        partCategoryID: this.currentPart.partCategoryID,
        serialNumberRequired: this.currentPart.serialNumberRequired || false,
        lotNumberRequired: this.currentPart.lotNumberRequired || false,
        defaultUnitOfMeasureID: this.currentPart.defaultUnitOfMeasureID || 1,
        manufacturer: this.currentPart.manufacturer || '',
        manufacturerPN: this.currentPart.manufacturerPN || ''
      });
      // Restore part image state
      this.partImage.set(this.currentPart.imageFile?.data || null);
      this.partImageFile.set(null);
      this.partImageFileID.set(this.currentPart.imageFileID || null);
    }
    this.isFormEditMode.set(false);
  }

  save() {
    Object.keys(this.form.controls).forEach(key => {
      this.form.get(key)?.markAsTouched();
    });

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
      const formValue = this.form.getRawValue();
      const partData: any = {
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
        manufacturerPN: this.form.get('manufacturerPN')?.value || '',
        imageFileID: this.partImageFileID()
      };

      const savePart = () => {
        if (this.isEditMode && this.currentPart?.id) {
          this.inventoryService.updatePart(this.currentPart.id, partData).subscribe({
            next: (response: any) => {
              const partId = response.id || this.currentPart!.id;
              this.saveHarnessData(partId);
              this.errorNotification.showSuccess('Part updated successfully');
              this.isFormEditMode.set(false);
              this.loadPart(partId);
            },
            error: (err) => {
              this.errorNotification.showHttpError(err, 'Failed to update part');
            }
          });
        } else {
          this.inventoryService.createPart(partData).subscribe({
            next: (response: any) => {
              if (!this.lockedCategoryName || this.lockedCategoryName !== 'Harness') {
                this.saveHarnessData(response.id);
              }
              this.errorNotification.showSuccess('Part created successfully');
              this.router.navigate(['/parts']);
            },
            error: (err) => {
              this.errorNotification.showHttpError(err, 'Failed to create part');
            }
          });
        }
      };

      const partImageFile = this.partImageFile();
      if (partImageFile) {
        this.harnessPartsService.uploadFile(partImageFile).subscribe({
          next: (result) => {
            partData.imageFileID = result.id;
            savePart();
          },
          error: (err) => {
            this.errorNotification.showHttpError(err, 'Failed to upload part image');
          }
        });
      } else {
        savePart();
      }
    }
  }

  private saveHarnessData(partId: number) {
    const categoryId = this.form.get('partCategoryID')?.value as number | null | undefined;
    const categoryName = this.getCategoryName(categoryId);
    const partName = this.form.get('name')?.value || '';

    if (categoryName === 'Connector') {
      const saveConnector = (pinoutDiagramFileID: number | null) => {
        const connectorData = {
          label: partName,
          type: this.form.get('connectorType')?.value as 'male' | 'female' | 'terminal' | 'splice',
          pinCount: this.form.get('connectorPinCount')?.value || 1,
          color: this.form.get('connectorColor')?.value || undefined,
          partID: partId,
          pinoutDiagramFileID,
          electricalPinTypeID: this.form.get('connectorPinTypeID')?.value || null
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
      };

      const pinoutDiagramFile = this.pinoutDiagramFile();
      if (pinoutDiagramFile) {
        this.harnessPartsService.uploadFile(pinoutDiagramFile).subscribe({
          next: (result) => saveConnector(result.id),
          error: (err) => {
            this.errorNotification.showHttpError(err, 'Failed to upload pinout diagram');
          }
        });
      } else {
        saveConnector(this.pinoutDiagramFileID());
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
      const saveCable = (cableDiagramFileID: number | null) => {
        const cableData = {
          label: partName,
          wireCount: this.form.get('cableWireCount')?.value || 1,
          gaugeAWG: this.form.get('cableGauge')?.value || undefined,
          wires: this.cableWireColors(),
          partID: partId,
          cableDiagramFileID
        };

        const existingCable = this.existingCable();
        if (existingCable) {
          this.harnessPartsService.updateCable(existingCable.id, cableData).subscribe({
            error: (err) => {
              console.error('Failed to update cable:', err);
              this.errorNotification.showHttpError(err, 'Failed to save cable data');
            }
          });
        } else {
          this.harnessPartsService.createCable(cableData).subscribe({
            error: (err) => {
              console.error('Failed to create cable:', err);
              this.errorNotification.showHttpError(err, 'Failed to save cable data');
            }
          });
        }
      };

      const cableDiagramFile = this.cableDiagramFile();
      if (cableDiagramFile) {
        this.harnessPartsService.uploadFile(cableDiagramFile).subscribe({
          next: (result) => saveCable(result.id),
          error: (err) => {
            this.errorNotification.showHttpError(err, 'Failed to upload cable diagram');
          }
        });
      } else {
        saveCable(this.cableDiagramFileID());
      }
    } else if (categoryName === 'Electrical Component') {
      const saveComponent = (pinoutDiagramFileID: number | null) => {
        const pinGroups = this.componentPinGroups();
        const componentData = {
          label: partName,
          pinCount: this.getTotalPinCount(),
          pins: pinGroups,
          partID: partId,
          pinoutDiagramFileID
        };

        const existingComponent = this.existingComponent();
        if (existingComponent) {
          this.harnessPartsService.updateComponent(existingComponent.id, componentData).subscribe({
            error: (err) => {
              console.error('Failed to update component:', err);
              this.errorNotification.showHttpError(err, 'Failed to save component data');
            }
          });
        } else {
          this.harnessPartsService.createComponent(componentData).subscribe({
            error: (err) => {
              console.error('Failed to create component:', err);
              this.errorNotification.showHttpError(err, 'Failed to save component data');
            }
          });
        }
      };

      const componentPinoutFile = this.componentPinoutFile();
      if (componentPinoutFile) {
        this.harnessPartsService.uploadFile(componentPinoutFile).subscribe({
          next: (result) => saveComponent(result.id),
          error: (err) => {
            this.errorNotification.showHttpError(err, 'Failed to upload component pinout diagram');
          }
        });
      } else {
        saveComponent(this.componentPinoutFileID());
      }
    } else if (categoryName === 'Harness') {
      if (!this.isEditMode) {
        const description = this.form.get('description')?.value || '';
        const harnessData = createEmptyHarnessData(partName);
        harnessData.description = description;

        this.harnessService.createHarness({
          name: partName,
          description: description,
          harnessData: harnessData,
          partID: partId
        }).subscribe();
      }
    }
  }

  delete() {
    if (!this.isEditMode || !this.currentPart?.id) {
      return;
    }

    const confirmed = confirm(`Are you sure you want to delete part "${this.currentPart.name}"? This will mark it as inactive.`);
    if (!confirmed) {
      return;
    }

    this.inventoryService.deletePart(this.currentPart.id).subscribe({
      next: () => {
        this.errorNotification.showSuccess('Part deleted successfully');
        this.router.navigate(['/parts']);
      },
      error: (err) => {
        console.error('Delete failed:', err);
        this.errorNotification.showHttpError(err, 'Failed to delete part');
      }
    });
  }
}
