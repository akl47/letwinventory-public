import { Component, Input, Output, EventEmitter, inject, signal, ElementRef, ViewChild, NgZone, HostListener, ChangeDetectorRef, OnChanges, SimpleChanges, DoCheck } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatTableModule } from '@angular/material/table';
import { AuthImgDirective } from '../../../directives/auth-img.directive';
import { BomTable, BomItem } from '../../common/bom-table/bom-table';
import { ManufacturingService } from '../../../services/manufacturing.service';
import { InventoryService } from '../../../services/inventory.service';
import { EngineeringMasterStep, EngineeringMasterStepMarker } from '../../../models/engineering-master.model';

@Component({
  selector: 'app-step-editor',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule,
    MatTooltipModule, MatAutocompleteModule, MatTableModule, AuthImgDirective, BomTable,
  ],
  templateUrl: './step-editor.html',
  styleUrl: './step-editor.css',
})
export class StepEditor implements DoCheck {
  @Input() step!: EngineeringMasterStep;
  @Input() editable = false;
  @Input() unassignedBomParts: any[] = []; // Parts in EM BOM not yet on any step
  @Input() unassignedBomTools: any[] = []; // Tools in EM BOM not yet on any step
  @Output() changed = new EventEmitter<void>();
  @Output() historyChanged = new EventEmitter<void>();

  // Cached BomItem arrays — only recompute when underlying data changes
  cachedPartBomItems: BomItem[] = [];
  cachedToolBomItems: BomItem[] = [];
  private lastPartsRef: any = null;
  private lastToolsRef: any = null;

  ngDoCheck() {
    if (this.step?.parts !== this.lastPartsRef) {
      this.lastPartsRef = this.step?.parts;
      this.cachedPartBomItems = this.computePartBomItems();
    }
    if (this.step?.tooling !== this.lastToolsRef) {
      this.lastToolsRef = this.step?.tooling;
      this.cachedToolBomItems = this.computeToolBomItems();
    }
  }

  private computeToolBomItems(): BomItem[] {
    return (this.step?.tooling || []).map((item: any, i: number) => ({
      partID: item.partID,
      quantity: item.quantity,
      partName: item.part?.name ?? '',
      partRevision: item.part?.revision,
      partImageFileId: item.part?.imageFileID ?? item.part?.imageFile?.id ?? null,
      uomName: item.part?.UnitOfMeasure?.name,
      allowDecimal: item.part?.UnitOfMeasure?.allowDecimal ?? false,
      pinLetter: this.pinLetter(i),
    }));
  }

  private computePartBomItems(): BomItem[] {
    const offset = this.step?.tooling?.length || 0;
    return (this.step?.parts || []).map((item: any, i: number) => ({
      partID: item.partID,
      quantity: item.quantity,
      partName: item.part?.name ?? '',
      partRevision: item.part?.revision,
      partImageFileId: item.part?.imageFileID ?? item.part?.imageFile?.id ?? null,
      uomName: item.part?.UnitOfMeasure?.name,
      allowDecimal: item.part?.UnitOfMeasure?.allowDecimal ?? false,
      pinLetter: this.pinLetter(offset + i),
    }));
  }

  @ViewChild('canvasContainer') canvasContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  private manufacturingService = inject(ManufacturingService);
  private inventoryService = inject(InventoryService);
  private ngZone = inject(NgZone);
  private cdr = inject(ChangeDetectorRef);

  partSearch = signal('');
  toolSearch = signal('');
  partResults = signal<any[]>([]);
  toolResults = signal<any[]>([]);
  draggingMarker = signal<EngineeringMasterStepMarker | null>(null);
  dragPosition = signal<{ x: number; y: number } | null>(null);
  private didDrag = false;
  editingParts = signal(false);
  editingTools = signal(false);
  pendingPin = signal<string | null>(null); // letter of pin waiting to be placed
  sidebarCollapsed = signal(false);

  private pinLetter(index: number): string {
    return String.fromCharCode(65 + (index % 26));
  }


  onPartQtyChanged(event: { index: number; quantity: number }) {
    this.updatePartQty(event.index, event.quantity);
  }

  onToolQtyChanged(event: { index: number; quantity: number }) {
    this.updateToolQty(event.index, event.quantity);
  }

  onPinDragFromTable(event: { event: MouseEvent; item: BomItem; index: number }) {
    if (!this.editable) return;
    const container = this.canvasContainer.nativeElement;
    const letter = event.item.pinLetter || 'A';
    let didMove = false;

    // Create a floating pin that follows the mouse
    const ghost = document.createElement('img');
    ghost.src = `assets/pin-${letter}.svg`;
    ghost.style.position = 'fixed';
    ghost.style.width = '34px';
    ghost.style.height = '50px';
    ghost.style.pointerEvents = 'none';
    ghost.style.zIndex = '9999';
    ghost.style.opacity = '0.8';
    ghost.style.left = event.event.clientX - 17 + 'px';
    ghost.style.top = event.event.clientY - 50 + 'px';
    document.body.appendChild(ghost);

    const onMove = (e: MouseEvent) => {
      didMove = true;
      ghost.style.left = e.clientX - 17 + 'px';
      ghost.style.top = e.clientY - 50 + 'px';
    };

    const onUp = (e: MouseEvent) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.removeChild(ghost);

      this.ngZone.run(() => {
        if (!didMove) {
          // Single click — toggle pending pin (click same pin again to cancel)
          this.pendingPin.set(this.pendingPin() === letter ? null : letter);
          return;
        }

        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Only place if dropped inside the canvas
        if (x >= 0 && y >= 0 && x <= rect.width && y <= rect.height) {
          this.placePin(letter, x, y);
        }
      });
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  onCanvasClickForPin(event: MouseEvent) {
    const pin = this.pendingPin();
    if (!pin) return;
    const container = this.canvasContainer.nativeElement;
    const rect = container.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    this.placePin(pin, x, y);
    this.pendingPin.set(null);
  }

  private placePin(letter: string, x: number, y: number) {
    this.step.markers = [...this.step.markers, { id: 0, stepID: this.step.id, label: letter, x, y } as any];
    this.cdr.detectChanges();
    this.saveMarkers(this.step.markers);
  }

  @HostListener('document:keydown.escape')
  onEscapeKey() {
    if (this.pendingPin()) {
      this.pendingPin.set(null);
    }
  }

  onPartRemoved(index: number) {
    this.removePart(index);
  }

  onToolRemoved(index: number) {
    this.removeTool(index);
  }


  onCanvasClick(event: MouseEvent) {
    if (!this.editable) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const label = `P${this.step.markers.length + 1}`;
    const markers = [...this.step.markers, { id: 0, stepID: this.step.id, label, x, y }];
    this.saveMarkers(markers);
  }

  onMarkerMouseDown(event: MouseEvent, marker: EngineeringMasterStepMarker) {
    if (!this.editable) return;
    event.preventDefault();
    event.stopPropagation();
    this.didDrag = false;
    this.draggingMarker.set(marker);
    this.dragPosition.set({ x: marker.x, y: marker.y });

    const container = this.canvasContainer.nativeElement;

    const onMove = (e: MouseEvent) => {
      this.didDrag = true;
      const rect = container.getBoundingClientRect();
      this.ngZone.run(() => {
        this.dragPosition.set({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
      });
    };

    const onUp = (e: MouseEvent) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);

      const pos = this.dragPosition();
      this.draggingMarker.set(null);
      this.dragPosition.set(null);

      if (!this.didDrag) return; // was a click, not a drag — let dblclick handle it

      this.ngZone.run(() => {
        const rect = container.getBoundingClientRect();
        const x = pos?.x ?? e.clientX - rect.left;
        const y = pos?.y ?? e.clientY - rect.top;
        const outside = x < 0 || y < 0 || x > rect.width || y > rect.height;

        if (outside) {
          this.step.markers = this.step.markers.filter(m => m !== marker);
        } else {
          marker.x = x;
          marker.y = y;
        }
        this.cdr.detectChanges();
        this.saveMarkers(this.step.markers);
      });
    };

    this.ngZone.runOutsideAngular(() => {
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  onMarkerDblClick(event: MouseEvent, marker: EngineeringMasterStepMarker) {
    if (!this.editable) return;
    event.preventDefault();
    event.stopPropagation();
    this.step.markers = this.step.markers.filter(m => m !== marker);
    this.cdr.detectChanges();
    this.saveMarkers(this.step.markers);
  }

  saveMarkers(markers: EngineeringMasterStepMarker[]) {
    this.manufacturingService.updateStep(this.step.id, {
      markers: markers.map(m => ({ label: m.label, x: m.x, y: m.y })),
    }).subscribe({
      next: () => this.historyChanged.emit(),
    });
  }

  saveStepNumber(stepNumber: number) {
    const num = Number(stepNumber);
    if (isNaN(num) || num < 1) return;
    this.step.stepNumber = num;
    this.manufacturingService.reorderStep(this.step.id, num).subscribe({
      next: () => this.changed.emit(),
    });
  }

  saveTitle(title: string) {
    this.step.title = title;
    this.manufacturingService.updateStep(this.step.id, { title }).subscribe({
      next: () => this.historyChanged.emit(),
    });
  }

  saveInstructions(instructions: string) {
    this.step.instructions = instructions;
    this.manufacturingService.updateStep(this.step.id, { instructions }).subscribe({
      next: () => this.historyChanged.emit(),
    });
  }

  deleteStep() {
    this.manufacturingService.deleteStep(this.step.id).subscribe({
      next: () => this.changed.emit(),
    });
  }

  triggerImageUpload() {
    this.fileInput.nativeElement.click();
  }

  onImageSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      this.manufacturingService.uploadStepImage(this.step.engineeringMasterID, this.step.id, {
        filename: file.name,
        mimeType: file.type,
        data: base64,
      }).subscribe({
        next: (result: any) => {
          // Update local state — no full reload needed
          this.step.imageFileID = result.imageFileID;
          this.step.imageFile = result.imageFile;
          this.cdr.detectChanges();
          this.historyChanged.emit();
        },
        error: (err) => console.error('Image upload failed:', err),
      });
    };
    reader.readAsDataURL(file);
    input.value = '';
  }

  confirmRemoveImage() {
    if (!confirm('Remove this step image?')) return;
    this.manufacturingService.deleteStepImage(this.step.id).subscribe({
      next: (result: any) => {
        this.step.imageFileID = null;
        this.step.imageFile = null;
        this.cdr.detectChanges();
        this.historyChanged.emit();
      },
      error: (err) => console.error('Image delete failed:', err),
    });
  }

  onPartSearchFocus() {
    if (!this.partSearch() || this.partSearch().length < 2) {
      // Show unassigned BOM parts as suggestions
      const existing = new Set(this.step.parts.map((p: any) => p.partID));
      const suggestions = this.unassignedBomParts.filter(p => !existing.has(p.id)).map(p => ({ ...p, _fromBom: true }));
      this.partResults.set(suggestions);
    }
  }

  onToolSearchFocus() {
    if (!this.toolSearch() || this.toolSearch().length < 2) {
      const existing = new Set(this.step.tooling.map((t: any) => t.partID));
      const suggestions = this.unassignedBomTools.filter(p => !existing.has(p.id)).map(p => ({ ...p, _fromBom: true }));
      this.toolResults.set(suggestions);
    }
  }

  searchParts(query: string) {
    this.partSearch.set(query);
    if (typeof query !== 'string') return;
    if (query.length < 2) {
      this.onPartSearchFocus();
      return;
    }
    this.inventoryService.getAllParts().subscribe({
      next: (parts) => {
        const q = query.toLowerCase();
        this.partResults.set(parts.filter((p: any) => p.name?.toLowerCase().includes(q)).slice(0, 10));
      },
    });
  }

  searchTools(query: string) {
    this.toolSearch.set(query);
    if (typeof query !== 'string') return;
    if (query.length < 2) {
      this.onToolSearchFocus();
      return;
    }
    this.inventoryService.getAllParts().subscribe({
      next: (parts) => {
        const q = query.toLowerCase();
        this.toolResults.set(parts.filter((p: any) => p.name?.toLowerCase().includes(q)).slice(0, 10));
      },
    });
  }

  addPart(part: any) {
    if (this.step.parts.some(p => p.partID === part.id)) return;
    const partData = { id: part.id, name: part.name, revision: part.revision, imageFile: part.imageFile, UnitOfMeasure: part.UnitOfMeasure };
    const parts = [...this.step.parts, { id: 0, stepID: this.step.id, partID: part.id, quantity: 1, isTool: false, part: partData }];
    this.saveItems(parts, this.step.tooling);
    setTimeout(() => { this.partSearch.set(''); this.onPartSearchFocus(); });
  }

  addTool(part: any) {
    if (this.step.tooling.some(t => t.partID === part.id)) return;
    const partData = { id: part.id, name: part.name, revision: part.revision, imageFile: part.imageFile, UnitOfMeasure: part.UnitOfMeasure };
    const tooling = [...this.step.tooling, { id: 0, stepID: this.step.id, partID: part.id, quantity: 1, isTool: true, part: partData }];
    this.saveItems(this.step.parts, tooling);
    setTimeout(() => { this.toolSearch.set(''); this.onToolSearchFocus(); });
  }

  updatePartQty(index: number, qty: number) {
    if (isNaN(qty) || qty < 1) return;
    this.step.parts[index] = { ...this.step.parts[index], quantity: qty };
    this.saveItems([...this.step.parts], this.step.tooling);
  }

  updateToolQty(index: number, qty: number) {
    if (isNaN(qty) || qty < 1) return;
    this.step.tooling[index] = { ...this.step.tooling[index], quantity: qty };
    this.saveItems(this.step.parts, [...this.step.tooling]);
  }

  removePart(index: number) {
    const parts = [...this.step.parts];
    parts.splice(index, 1);
    this.saveItems(parts, this.step.tooling);
  }

  removeTool(index: number) {
    const tooling = [...this.step.tooling];
    tooling.splice(index, 1);
    this.saveItems(this.step.parts, tooling);
  }

  saveItems(parts: any[], tooling: any[]) {
    this.step.parts = parts;
    this.step.tooling = tooling;
    this.manufacturingService.updateStep(this.step.id, {
      parts: parts.map(p => ({ partID: p.partID, quantity: p.quantity, isTool: false })),
      tooling: tooling.map(t => ({ partID: t.partID, quantity: t.quantity, isTool: true })),
    }).subscribe({
      next: () => this.historyChanged.emit(),
      error: (err) => console.error('Save items failed:', err),
    });
  }
}
