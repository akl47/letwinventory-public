import { Component, OnInit, OnDestroy, ViewChild, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject, debounceTime, filter, switchMap, forkJoin, of } from 'rxjs';
import { HarnessCanvas, CanvasSelection } from '../harness-canvas/harness-canvas';
import { HarnessToolbar, HarnessTool } from '../harness-toolbar/harness-toolbar';
import { HarnessPropertyPanel } from '../harness-property-panel/harness-property-panel';
import { HarnessConnectorDialog } from '../harness-connector-dialog/harness-connector-dialog';
import { HarnessAddCableDialog } from '../harness-add-cable-dialog/harness-add-cable-dialog';
import { HarnessListDialog } from '../harness-list-dialog/harness-list-dialog';
import { HarnessImportDialog } from '../harness-import-dialog/harness-import-dialog';
import { PartEditDialog } from '../../inventory/part-edit-dialog/part-edit-dialog';
import { HarnessService } from '../../../services/harness.service';
import { HarnessPartsService } from '../../../services/harness-parts.service';
import { Part } from '../../../models';
import {
  HarnessData,
  HarnessConnector,
  HarnessCable,
  WireHarness,
  createEmptyHarnessData
} from '../../../models/harness.model';
import {
  getConnectorCentroidOffset,
  getCableCentroidOffset,
  rotateAroundCentroid
} from '../../../utils/harness/canvas-renderer';

@Component({
  selector: 'app-harness-page',
  standalone: true,
  imports: [
    CommonModule,
    HarnessCanvas,
    HarnessToolbar,
    HarnessPropertyPanel
  ],
  templateUrl: './harness-page.html',
  styleUrls: ['./harness-page.scss']
})
export class HarnessPage implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private harnessService = inject(HarnessService);
  private harnessPartsService = inject(HarnessPartsService);

  @ViewChild('harnessCanvas') harnessCanvas!: HarnessCanvas;

  // State
  currentHarnessId = signal<number | null>(null);
  linkedPartId = signal<number | null>(null);
  harnessData = signal<HarnessData | null>(null);
  originalData = signal<string>('');
  currentSelection = signal<CanvasSelection | null>(null);
  activeTool = signal<HarnessTool>('select');
  gridEnabled = signal<boolean>(true);
  snapToGrid = signal<boolean>(true);
  zoomLevel = signal<number>(100);
  clipboardConnector = signal<HarnessConnector | null>(null);
  isSaving = signal<boolean>(false);
  autoSaveEnabled = signal<boolean>(true);

  // Auto-save
  private autoSave$ = new Subject<void>();
  private destroy$ = new Subject<void>();

  // Computed
  hasUnsavedChanges = computed(() => {
    const current = JSON.stringify(this.harnessData());
    return current !== this.originalData();
  });

  constructor() {
    // Set up auto-save with debounce
    this.autoSave$.pipe(
      debounceTime(1500), // Wait 1.5 seconds after last change
      filter(() => this.autoSaveEnabled() && this.hasUnsavedChanges() && !this.isSaving()),
      switchMap(() => {
        this.isSaving.set(true);
        return this.performSave();
      })
    ).subscribe({
      next: (result) => {
        this.isSaving.set(false);
        if (result) {
          this.currentHarnessId.set(result.id);
          // Update local data with generated part number if it was created
          if (result.partNumber) {
            const data = this.harnessData();
            if (data && data.partNumber !== result.partNumber) {
              this.harnessData.set({
                ...data,
                partNumber: result.partNumber
              });
            }
          }
          this.originalData.set(JSON.stringify(this.harnessData()));
          // Navigate to the ID-based URL if this was a new harness
          if (!this.route.snapshot.params['id']) {
            this.router.navigate(['/harness/editor', result.id], { replaceUrl: true });
          }
        }
      },
      error: () => {
        this.isSaving.set(false);
        this.snackBar.open('Auto-save failed', 'Close', { duration: 3000 });
      }
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    this.autoSave$.complete();
  }

  ngOnInit() {
    // Check for ID in route params
    this.route.params.subscribe(params => {
      if (params['id']) {
        this.loadHarness(parseInt(params['id']));
      } else {
        // Create new empty harness
        this.createNewHarness();
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => this.handleKeydown(e));
  }

  private handleKeydown(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return;
    }

    switch (e.key.toLowerCase()) {
      case 'v':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.pasteConnector();
        } else {
          this.activeTool.set('select');
        }
        break;
      case 'c':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.copyConnector();
        }
        break;
      case 'h':
        this.activeTool.set('pan');
        break;
      case 'w':
        this.activeTool.set('wire');
        break;
      case 'delete':
      case 'backspace':
        this.onDeleteSelected();
        break;
      case 's':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.onSave();
        }
        break;
      case 'r':
        this.rotateSelected(e.shiftKey ? -90 : 90);
        break;
      case 'f':
        this.flipSelected();
        break;
      case 'escape':
        this.activeTool.set('select');
        break;
    }
  }

  rotateSelected(delta: number) {
    const selection = this.currentSelection();
    const data = this.harnessData();
    if (!data) return;

    // Handle connector rotation
    if (selection?.connector) {
      const connector = data.connectors.find(c => c.id === selection.connector!.id);
      if (!connector) return;

      const currentRotation = connector.rotation || 0;
      let newRotation = (currentRotation + delta) % 360;
      if (newRotation < 0) newRotation += 360;

      // Calculate new position to rotate around centroid
      const centroidOffset = getConnectorCentroidOffset(connector);
      const currentPos = connector.position || { x: 100, y: 100 };
      const newPos = rotateAroundCentroid(currentPos, centroidOffset, currentRotation, newRotation);

      const updatedConnector = {
        ...connector,
        rotation: newRotation as 0 | 90 | 180 | 270,
        position: newPos
      };
      this.updateHarnessConnectors(
        data.connectors.map(c => c.id === updatedConnector.id ? updatedConnector : c)
      );
      this.currentSelection.set({ type: 'connector', connector: updatedConnector });
    }
    // Handle cable rotation
    else if (selection?.cable) {
      const cable = data.cables.find(c => c.id === selection.cable!.id);
      if (!cable) return;

      const currentRotation = cable.rotation || 0;
      let newRotation = (currentRotation + delta) % 360;
      if (newRotation < 0) newRotation += 360;

      // Calculate new position to rotate around centroid
      const centroidOffset = getCableCentroidOffset(cable);
      const currentPos = cable.position || { x: 100, y: 100 };
      const newPos = rotateAroundCentroid(currentPos, centroidOffset, currentRotation, newRotation);

      const updatedCable = {
        ...cable,
        rotation: newRotation as 0 | 90 | 180 | 270,
        position: newPos
      };
      this.updateHarnessCables(
        data.cables.map(c => c.id === updatedCable.id ? updatedCable : c)
      );
      this.currentSelection.set({ type: 'cable', cable: updatedCable });
    }
  }

  flipSelected() {
    const selection = this.currentSelection();
    const data = this.harnessData();
    if (!data) return;

    // Handle connector flip
    if (selection?.connector) {
      const connector = data.connectors.find(c => c.id === selection.connector!.id);
      if (!connector) return;

      const currentFlipped = connector.flipped || false;
      const updatedConnector = { ...connector, flipped: !currentFlipped };
      this.updateHarnessConnectors(
        data.connectors.map(c => c.id === updatedConnector.id ? updatedConnector : c)
      );
      this.currentSelection.set({ type: 'connector', connector: updatedConnector });
    }
    // Handle cable flip
    else if (selection?.cable) {
      const cable = data.cables.find(c => c.id === selection.cable!.id);
      if (!cable) return;

      const currentFlipped = cable.flipped || false;
      const updatedCable = { ...cable, flipped: !currentFlipped };
      this.updateHarnessCables(
        data.cables.map(c => c.id === updatedCable.id ? updatedCable : c)
      );
      this.currentSelection.set({ type: 'cable', cable: updatedCable });
    }
  }

  copyConnector() {
    const selection = this.currentSelection();
    if (!selection?.connector) return;

    // Get the current connector from harnessData
    const data = this.harnessData();
    const connector = data?.connectors.find(c => c.id === selection.connector!.id);
    if (!connector) return;

    // Store a deep copy
    this.clipboardConnector.set(JSON.parse(JSON.stringify(connector)));
    this.snackBar.open('Connector copied', 'Close', { duration: 1500 });
  }

  pasteConnector() {
    const clipboard = this.clipboardConnector();
    if (!clipboard) return;

    const data = this.harnessData();
    if (!data) return;

    // Create a new connector with a unique ID and offset position
    const newConnector: HarnessConnector = {
      ...JSON.parse(JSON.stringify(clipboard)),
      id: `conn-${Date.now()}`,
      label: this.generateUniqueLabel(clipboard.label, data.connectors),
      position: {
        x: (clipboard.position?.x || 100) + 40,
        y: (clipboard.position?.y || 100) + 40
      },
      // Generate new pin IDs
      pins: clipboard.pins.map((pin, i) => ({
        ...pin,
        id: `pin-${Date.now()}-${i + 1}`
      }))
    };

    // Add to harness data
    this.updateHarnessConnectors([...data.connectors, newConnector]);

    // Select the new connector
    this.currentSelection.set({ type: 'connector', connector: newConnector });
    this.snackBar.open('Connector pasted', 'Close', { duration: 1500 });
  }

  private generateUniqueLabel(baseLabel: string, existingConnectors: HarnessConnector[]): string {
    const existingLabels = new Set(existingConnectors.map(c => c.label));

    // Try to increment any trailing number
    const match = baseLabel.match(/^(.+?)(\d+)$/);
    if (match) {
      const prefix = match[1];
      let num = parseInt(match[2]);
      while (existingLabels.has(`${prefix}${num}`)) {
        num++;
      }
      return `${prefix}${num}`;
    }

    // Otherwise append a number
    let num = 2;
    while (existingLabels.has(`${baseLabel}${num}`)) {
      num++;
    }
    return `${baseLabel}${num}`;
  }

  createNewHarness(part?: Part) {
    const name = part?.name || 'New Harness';
    const data = createEmptyHarnessData(name);
    if (part) {
      data.partNumber = part.name;
      data.description = part.description || '';
    }
    this.harnessData.set(data);
    this.originalData.set(JSON.stringify(data));
    this.currentHarnessId.set(null);
    this.linkedPartId.set(part?.id || null);
  }

  loadHarness(id: number) {
    this.harnessService.getHarnessById(id).subscribe({
      next: (harness) => {
        this.currentHarnessId.set(harness.id);
        this.linkedPartId.set(harness.partID);
        // Merge top-level WireHarness fields into harnessData
        const data: HarnessData = {
          ...harness.harnessData,
          name: harness.name,
          partNumber: harness.partNumber || '',
          revision: harness.revision,
          description: harness.description || ''
        };

        // Fetch connector images for connectors that have partId
        this.loadConnectorImages(data);
      },
      error: (err) => {
        this.snackBar.open('Failed to load harness', 'Close', { duration: 3000 });
        this.createNewHarness();
      }
    });
  }

  private loadConnectorImages(data: HarnessData) {
    const connectorsWithPartId = data.connectors.filter(c => c.partId);

    if (connectorsWithPartId.length === 0) {
      // No connectors with partId, just set the data
      this.harnessData.set(data);
      this.originalData.set(JSON.stringify(data));
      return;
    }

    // Fetch connector details for each connector with partId
    // Map partId to the request so we can match results later
    const requestsWithPartId = connectorsWithPartId.map(c => ({
      partId: c.partId!,
      request: this.harnessPartsService.getConnectorByPartId(c.partId!)
    }));

    forkJoin(requestsWithPartId.map(r => r.request)).subscribe({
      next: (dbConnectors) => {
        // Create a map of partId to dbConnector
        const imageMap = new Map<number, { connectorImage?: string; pinoutDiagramImage?: string }>();
        dbConnectors.forEach((dbConnector, idx) => {
          if (dbConnector) {
            imageMap.set(requestsWithPartId[idx].partId, {
              connectorImage: dbConnector.connectorImage || undefined,
              pinoutDiagramImage: dbConnector.pinoutDiagramImage || undefined
            });
          }
        });

        // Merge images into connectors
        const updatedConnectors = data.connectors.map(connector => {
          if (!connector.partId) return connector;

          const images = imageMap.get(connector.partId);
          if (images) {
            return {
              ...connector,
              connectorImage: images.connectorImage,
              pinoutDiagramImage: images.pinoutDiagramImage
            };
          }
          return connector;
        });

        const updatedData = { ...data, connectors: updatedConnectors };
        this.harnessData.set(updatedData);
        this.originalData.set(JSON.stringify(updatedData));
      },
      error: () => {
        // If fetching images fails, still load the harness without images
        this.harnessData.set(data);
        this.originalData.set(JSON.stringify(data));
      }
    });
  }

  // Toolbar events
  onNewHarness() {
    if (this.hasUnsavedChanges()) {
      if (!confirm('You have unsaved changes. Create new harness anyway?')) {
        return;
      }
    }

    // Open part-edit-dialog locked to Harness category
    const dialogRef = this.dialog.open(PartEditDialog, {
      width: '500px',
      data: { lockedCategory: 'Harness' }
    });

    dialogRef.afterClosed().subscribe((result: boolean | Part | undefined) => {
      if (result && typeof result === 'object') {
        // Part was created, use it to create the harness
        this.createNewHarness(result);
        this.router.navigate(['/harness/editor']);
      }
    });
  }

  onOpenHarness() {
    const dialogRef = this.dialog.open(HarnessListDialog, {
      width: '600px',
      maxHeight: '80vh'
    });

    dialogRef.afterClosed().subscribe((harness: WireHarness | undefined) => {
      if (harness) {
        this.router.navigate(['/harness/editor', harness.id]);
      }
    });
  }

  private performSave() {
    const data = this.harnessData();
    if (!data) {
      return new Subject<WireHarness | null>().asObservable();
    }

    // Generate thumbnail
    const thumbnail = this.harnessCanvas?.exportAsThumbnail() || undefined;

    const id = this.currentHarnessId();
    const partId = this.linkedPartId();

    const saveData: {
      name: string;
      revision?: string;
      description?: string;
      harnessData: HarnessData;
      thumbnailBase64?: string;
      createPart?: boolean;
      partID?: number;
    } = {
      name: data.name,
      revision: data.revision,
      description: data.description,
      harnessData: data,
      thumbnailBase64: thumbnail
    };

    // For new harnesses, link to the existing part or create a new one
    if (!id) {
      if (partId) {
        saveData.partID = partId;
      } else {
        saveData.createPart = true;
      }
    }

    return id
      ? this.harnessService.updateHarness(id, saveData)
      : this.harnessService.createHarness(saveData);
  }

  onSave() {
    if (this.isSaving()) return;

    this.isSaving.set(true);
    this.performSave().subscribe({
      next: (result) => {
        this.isSaving.set(false);
        if (result) {
          this.currentHarnessId.set(result.id);
          // Update local data with generated part number if it was created
          if (result.partNumber) {
            const data = this.harnessData();
            if (data && data.partNumber !== result.partNumber) {
              this.harnessData.set({
                ...data,
                partNumber: result.partNumber
              });
            }
          }
          this.originalData.set(JSON.stringify(this.harnessData()));
          this.snackBar.open('Harness saved', 'Close', { duration: 1500 });

          if (!this.route.snapshot.params['id']) {
            this.router.navigate(['/harness/editor', result.id], { replaceUrl: true });
          }
        }
      },
      error: () => {
        this.isSaving.set(false);
        this.snackBar.open('Failed to save harness', 'Close', { duration: 3000 });
      }
    });
  }

  private triggerAutoSave() {
    if (this.autoSaveEnabled()) {
      this.autoSave$.next();
    }
  }

  onExportJSON() {
    const data = this.harnessData();
    if (!data) return;

    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.name || 'harness'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  onExportPNG() {
    const dataUrl = this.harnessCanvas?.exportAsPNG();
    if (!dataUrl) return;

    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `${this.harnessData()?.name || 'harness'}.png`;
    a.click();
  }

  onImportJSON() {
    const dialogRef = this.dialog.open(HarnessImportDialog, {
      width: '500px'
    });

    dialogRef.afterClosed().subscribe((importedData: HarnessData | undefined) => {
      if (importedData) {
        this.harnessData.set(importedData);
        this.currentHarnessId.set(null);
        this.snackBar.open('Harness imported successfully', 'Close', { duration: 2000 });
      }
    });
  }

  onAddConnector() {
    const dialogRef = this.dialog.open(HarnessConnectorDialog, {
      width: '400px',
      data: { existingConnectors: this.harnessData()?.connectors || [] }
    });

    dialogRef.afterClosed().subscribe((connector: HarnessConnector | undefined) => {
      if (connector) {
        // Assign highest zIndex so new connector appears in front
        const newConnector = { ...connector, zIndex: this.getMaxZIndex() + 1 };
        this.harnessCanvas?.addConnector(newConnector);
        this.updateHarnessConnectors([...this.harnessData()?.connectors || [], newConnector]);
      }
    });
  }

  onEditConnector(connector: HarnessConnector) {
    const dialogRef = this.dialog.open(HarnessConnectorDialog, {
      width: '400px',
      data: {
        existingConnectors: this.harnessData()?.connectors || [],
        editConnector: connector
      }
    });

    dialogRef.afterClosed().subscribe((updatedConnector: HarnessConnector | undefined) => {
      if (updatedConnector) {
        const data = this.harnessData();
        if (data) {
          const connectors = data.connectors.map(c =>
            c.id === updatedConnector.id ? updatedConnector : c
          );
          this.updateHarnessConnectors(connectors);
          // Update selection with new connector data
          this.currentSelection.set({ type: 'connector', connector: updatedConnector });
        }
      }
    });
  }

  onAddCable() {
    const dialogRef = this.dialog.open(HarnessAddCableDialog, {
      width: '500px',
      data: { existingCables: this.harnessData()?.cables || [] }
    });

    dialogRef.afterClosed().subscribe((cable: HarnessCable | undefined) => {
      if (cable) {
        const data = this.harnessData();
        if (!data) return;

        // Assign highest zIndex so new cable appears in front
        const newCable = { ...cable, zIndex: this.getMaxZIndex() + 1 };

        // Check if this cable already exists (we're adding it to the canvas)
        const existingIndex = data.cables.findIndex(c => c.id === newCable.id);
        if (existingIndex >= 0) {
          // Update the existing cable with position and zIndex
          const cables = data.cables.map(c =>
            c.id === newCable.id ? newCable : c
          );
          this.harnessData.set({ ...data, cables });
          // Select the cable
          this.currentSelection.set({ type: 'cable', cable: newCable });
        } else {
          // Add new cable
          this.harnessCanvas?.addCable(newCable);
        }
      }
    });
  }

  onEditCable(cable: HarnessCable) {
    const dialogRef = this.dialog.open(HarnessAddCableDialog, {
      width: '400px',
      data: {
        existingCables: this.harnessData()?.cables || [],
        editCable: cable
      }
    });

    dialogRef.afterClosed().subscribe((updatedCable: HarnessCable | undefined) => {
      if (updatedCable) {
        const data = this.harnessData();
        if (data) {
          const cables = data.cables.map(c =>
            c.id === updatedCable.id ? updatedCable : c
          );
          this.harnessData.set({ ...data, cables });
          this.triggerAutoSave();
          // Update selection with new cable data
          this.currentSelection.set({ type: 'cable', cable: updatedCable });
        }
      }
    });
  }

  // Layer ordering methods
  private getMaxZIndex(): number {
    const data = this.harnessData();
    if (!data) return 0;
    const connectorMax = Math.max(0, ...data.connectors.map(c => c.zIndex || 0));
    const cableMax = Math.max(0, ...data.cables.map(c => c.zIndex || 0));
    return Math.max(connectorMax, cableMax);
  }

  private getMinZIndex(): number {
    const data = this.harnessData();
    if (!data) return 0;
    const connectorMin = Math.min(0, ...data.connectors.map(c => c.zIndex || 0));
    const cableMin = Math.min(0, ...data.cables.map(c => c.zIndex || 0));
    return Math.min(connectorMin, cableMin);
  }

  onBringToFront() {
    const selection = this.currentSelection();
    const data = this.harnessData();
    if (!data) return;

    const maxZ = this.getMaxZIndex();

    if (selection?.connector) {
      const updated = { ...selection.connector, zIndex: maxZ + 1 };
      this.harnessData.set({
        ...data,
        connectors: data.connectors.map(c => c.id === updated.id ? updated : c)
      });
      this.currentSelection.set({ type: 'connector', connector: updated });
    } else if (selection?.cable) {
      const updated = { ...selection.cable, zIndex: maxZ + 1 };
      this.harnessData.set({
        ...data,
        cables: data.cables.map(c => c.id === updated.id ? updated : c)
      });
      this.currentSelection.set({ type: 'cable', cable: updated });
    }
    this.triggerAutoSave();
  }

  onSendToBack() {
    const selection = this.currentSelection();
    const data = this.harnessData();
    if (!data) return;

    const minZ = this.getMinZIndex();

    if (selection?.connector) {
      const updated = { ...selection.connector, zIndex: minZ - 1 };
      this.harnessData.set({
        ...data,
        connectors: data.connectors.map(c => c.id === updated.id ? updated : c)
      });
      this.currentSelection.set({ type: 'connector', connector: updated });
    } else if (selection?.cable) {
      const updated = { ...selection.cable, zIndex: minZ - 1 };
      this.harnessData.set({
        ...data,
        cables: data.cables.map(c => c.id === updated.id ? updated : c)
      });
      this.currentSelection.set({ type: 'cable', cable: updated });
    }
    this.triggerAutoSave();
  }

  onMoveForward() {
    const selection = this.currentSelection();
    const data = this.harnessData();
    if (!data) return;

    if (selection?.connector) {
      const currentZ = selection.connector.zIndex || 0;
      const updated = { ...selection.connector, zIndex: currentZ + 1 };
      this.harnessData.set({
        ...data,
        connectors: data.connectors.map(c => c.id === updated.id ? updated : c)
      });
      this.currentSelection.set({ type: 'connector', connector: updated });
    } else if (selection?.cable) {
      const currentZ = selection.cable.zIndex || 0;
      const updated = { ...selection.cable, zIndex: currentZ + 1 };
      this.harnessData.set({
        ...data,
        cables: data.cables.map(c => c.id === updated.id ? updated : c)
      });
      this.currentSelection.set({ type: 'cable', cable: updated });
    }
    this.triggerAutoSave();
  }

  onMoveBackward() {
    const selection = this.currentSelection();
    const data = this.harnessData();
    if (!data) return;

    if (selection?.connector) {
      const currentZ = selection.connector.zIndex || 0;
      const updated = { ...selection.connector, zIndex: currentZ - 1 };
      this.harnessData.set({
        ...data,
        connectors: data.connectors.map(c => c.id === updated.id ? updated : c)
      });
      this.currentSelection.set({ type: 'connector', connector: updated });
    } else if (selection?.cable) {
      const currentZ = selection.cable.zIndex || 0;
      const updated = { ...selection.cable, zIndex: currentZ - 1 };
      this.harnessData.set({
        ...data,
        cables: data.cables.map(c => c.id === updated.id ? updated : c)
      });
      this.currentSelection.set({ type: 'cable', cable: updated });
    }
    this.triggerAutoSave();
  }

  onDeleteSelected() {
    this.harnessCanvas?.deleteSelected();
  }

  onZoomIn() {
    this.harnessCanvas?.zoomIn();
    this.zoomLevel.set(Math.round((this.harnessCanvas?.zoom() || 1) * 100));
  }

  onZoomOut() {
    this.harnessCanvas?.zoomOut();
    this.zoomLevel.set(Math.round((this.harnessCanvas?.zoom() || 1) * 100));
  }

  onResetZoom() {
    this.harnessCanvas?.resetZoom();
    this.zoomLevel.set(100);
  }

  onToolChanged(tool: HarnessTool) {
    this.activeTool.set(tool);
  }

  // Canvas events
  onSelectionChanged(selection: CanvasSelection) {
    this.currentSelection.set(selection);
  }

  onDataChanged(data: HarnessData) {
    this.harnessData.set(data);
    this.triggerAutoSave();
  }

  onConnectorMoved(event: { connector: HarnessConnector; x: number; y: number }) {
    // Update the harness data with new position
    const data = this.harnessData();
    if (!data) return;

    const connectors = data.connectors.map(c =>
      c.id === event.connector.id ? event.connector : c
    );
    this.harnessData.set({ ...data, connectors });
    this.triggerAutoSave();
  }

  onCableMoved(event: { cable: HarnessCable; x: number; y: number }) {
    // Update the harness data with new position
    const data = this.harnessData();
    if (!data) return;

    const cables = data.cables.map(c =>
      c.id === event.cable.id ? event.cable : c
    );
    this.harnessData.set({ ...data, cables });
    this.triggerAutoSave();
  }

  // Property panel events
  onMetadataChanged(event: { field: string; value: string }) {
    const data = this.harnessData();
    if (!data) return;

    this.harnessData.set({
      ...data,
      [event.field]: event.value
    });
    this.triggerAutoSave();
  }

  onConnectorPropertyChanged(event: { field: string; value: any }) {
    const selection = this.currentSelection();
    if (!selection?.connector) return;

    const data = this.harnessData();
    if (!data) return;

    const updatedConnector = { ...selection.connector, [event.field]: event.value };

    // If pin count changed, regenerate pins
    if (event.field === 'pinCount') {
      const newPinCount = event.value as number;
      const existingPins = updatedConnector.pins || [];

      if (newPinCount > existingPins.length) {
        // Add new pins
        for (let i = existingPins.length; i < newPinCount; i++) {
          existingPins.push({
            id: `pin-${i + 1}`,
            number: String(i + 1),
            label: ''
          });
        }
      } else {
        // Truncate pins
        existingPins.length = newPinCount;
      }
      updatedConnector.pins = existingPins;
    }

    this.updateHarnessConnectors(
      data.connectors.map(c => c.id === updatedConnector.id ? updatedConnector : c)
    );
  }

  onConnectionPropertyChanged(event: { field: string; value: any }) {
    const selection = this.currentSelection();
    if (!selection?.connection) return;

    const data = this.harnessData();
    if (!data) return;

    const updatedConnection = { ...selection.connection, [event.field]: event.value };

    this.harnessData.set({
      ...data,
      connections: data.connections.map(c =>
        c.id === updatedConnection.id ? updatedConnection : c
      )
    });
    this.triggerAutoSave();
  }

  onPinLabelChanged(event: { index: number; label: string }) {
    const selection = this.currentSelection();
    if (!selection?.connector) return;

    const data = this.harnessData();
    if (!data) return;

    const updatedPins = [...selection.connector.pins];
    if (updatedPins[event.index]) {
      updatedPins[event.index] = { ...updatedPins[event.index], label: event.label };
    }

    const updatedConnector = { ...selection.connector, pins: updatedPins };
    this.updateHarnessConnectors(
      data.connectors.map(c => c.id === updatedConnector.id ? updatedConnector : c)
    );
  }

  private updateHarnessConnectors(connectors: HarnessConnector[]) {
    const data = this.harnessData();
    if (!data) return;

    this.harnessData.set({ ...data, connectors });
    this.triggerAutoSave();
  }

  private updateHarnessCables(cables: HarnessCable[]) {
    const data = this.harnessData();
    if (!data) return;

    this.harnessData.set({ ...data, cables });
    this.triggerAutoSave();
  }

  onDeleteHarness() {
    const id = this.currentHarnessId();
    const data = this.harnessData();
    if (!id) {
      this.snackBar.open('Harness has not been saved yet', 'Close', { duration: 3000 });
      return;
    }

    if (confirm(`Are you sure you want to delete "${data?.name}"?`)) {
      this.harnessService.deleteHarness(id).subscribe({
        next: () => {
          this.snackBar.open('Harness deleted', 'Close', { duration: 2000 });
          this.router.navigate(['/harness']);
        },
        error: () => {
          this.snackBar.open('Failed to delete harness', 'Close', { duration: 3000 });
        }
      });
    }
  }
}
