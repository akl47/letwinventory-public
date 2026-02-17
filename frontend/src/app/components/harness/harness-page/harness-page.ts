import { Component, OnInit, OnDestroy, ViewChild, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatIconModule } from '@angular/material/icon';
import { Subject, debounceTime, filter, switchMap, forkJoin, of, catchError } from 'rxjs';
import { HarnessCanvas, CanvasSelection } from '../harness-canvas/harness-canvas';
import { HarnessToolbar, HarnessTool } from '../harness-toolbar/harness-toolbar';
import { HarnessPropertyPanel } from '../harness-property-panel/harness-property-panel';
import { HarnessConnectorDialog } from '../harness-connector-dialog/harness-connector-dialog';
import { HarnessAddCableDialog } from '../harness-add-cable-dialog/harness-add-cable-dialog';
import { HarnessComponentDialog } from '../harness-component-dialog/harness-component-dialog';
import { HarnessListDialog } from '../harness-list-dialog/harness-list-dialog';
import { HarnessImportDialog } from '../harness-import-dialog/harness-import-dialog';
import { HarnessSyncDialog, SyncChange } from '../harness-sync-dialog/harness-sync-dialog';
import { PartEditDialog } from '../../inventory/part-edit-dialog/part-edit-dialog';
import { HarnessService } from '../../../services/harness.service';
import { HarnessPartsService } from '../../../services/harness-parts.service';
import { HarnessHistoryService } from '../../../services/harness-history.service';
import { AuthService } from '../../../services/auth.service';
import { Part } from '../../../models';
import {
  HarnessData,
  HarnessConnector,
  HarnessCable,
  HarnessComponent,
  WireHarness,
  SubHarnessRef,
  DbElectricalConnector,
  DbCable,
  DbElectricalComponent,
  createEmptyHarnessData
} from '../../../models/harness.model';
import {
  getConnectorCentroidOffset,
  getCableCentroidOffset,
  getComponentCentroidOffset,
  getBlockCentroidOffset,
  rotateAroundCentroid
} from '../../../utils/harness/canvas-renderer';

@Component({
  selector: 'app-harness-page',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
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
  private historyService = inject(HarnessHistoryService);
  private authService = inject(AuthService);
  private canWrite = computed(() => this.authService.hasPermission('harness', 'write'));

  @ViewChild('harnessCanvas') harnessCanvas!: HarnessCanvas;

  // State
  currentHarnessId = signal<number | null>(null);
  linkedPartId = signal<number | null>(null);
  harnessData = signal<HarnessData | null>(null);
  originalData = signal<string>('');
  currentSelection = signal<CanvasSelection | null>(null);
  activeTool = signal<HarnessTool>('select');
  gridEnabled = signal<boolean>(true);
  showSubHarnessBounds = signal<boolean>(true);
  zoomLevel = signal<number>(100);
  clipboardConnector = signal<HarnessConnector | null>(null);

  // Computed properties for grouping
  hasMultipleSelected = computed(() => {
    const selection = this.currentSelection();
    return (selection?.selectedIds?.length || 0) > 1;
  });

  hasGroupSelected = computed(() => {
    const selection = this.currentSelection();
    return !!selection?.groupId;
  });
  isSaving = signal<boolean>(false);
  autoSaveEnabled = signal<boolean>(true);
  hasPendingSubHarnessChanges = signal<boolean>(false);

  // Undo/redo state from history service (use computed for proper reactivity)
  canUndo = computed(() => this.historyService.canUndo());
  canRedo = computed(() => this.historyService.canRedo());

  // Release state
  isReleased = computed(() => this.harnessData()?.releaseState === 'released');
  isInReview = computed(() => this.harnessData()?.releaseState === 'review');
  isViewOnly = computed(() => !this.canWrite());
  isLocked = computed(() => this.isReleased() || this.isInReview() || this.isViewOnly());

  // Auto-save
  private autoSave$ = new Subject<void>();
  private destroy$ = new Subject<void>();

  // Computed
  hasUnsavedChanges = computed(() => {
    const current = JSON.stringify(this.harnessData());
    const parentChanged = current !== this.originalData();
    return parentChanged || this.hasPendingSubHarnessChanges();
  });

  constructor() {
    // Set up auto-save with debounce
    this.autoSave$.pipe(
      debounceTime(1500), // Wait 1.5 seconds after last change
      filter(() => this.autoSaveEnabled() && this.hasUnsavedChanges() && !this.isSaving() && !this.isLocked()),
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

    const locked = this.isLocked();

    switch (e.key.toLowerCase()) {
      case 'z':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          if (locked) return;
          if (e.shiftKey) {
            this.onRedo();
          } else {
            this.onUndo();
          }
        }
        break;
      case 'y':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          if (locked) return;
          this.onRedo();
        }
        break;
      case 'v':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          if (locked) return;
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
        if (locked) return;
        this.activeTool.set('wire');
        break;
      case 'n':
        if (locked) return;
        this.activeTool.set('nodeEdit');
        break;
      case 'delete':
      case 'backspace':
        if (locked) return;
        this.onDeleteSelected();
        break;
      case 's':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          if (locked) return;
          this.onSave();
        }
        break;
      case 'r':
        if (locked) return;
        this.rotateSelected(e.shiftKey ? -90 : 90);
        break;
      case 'f':
        if (locked) return;
        this.flipSelected();
        break;
      case 'g':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          if (locked) return;
          if (e.shiftKey) {
            this.onUngroupSelected();
          } else {
            this.onGroupSelected();
          }
        }
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

    // Push to history before making changes
    this.historyService.push(data);

    // Use block for unified rotation if available
    if (selection?.block) {
      const block = selection.block;
      const currentRotation = block.rotation || 0;
      let newRotation = (currentRotation + delta) % 360;
      if (newRotation < 0) newRotation += 360;

      const centroidOffset = getBlockCentroidOffset(block);
      const currentPos = block.position;
      const newPos = rotateAroundCentroid(currentPos, centroidOffset, currentRotation, newRotation);

      if (block.blockType === 'connector') {
        const updatedConnector = {
          ...data.connectors.find(c => c.id === block.id)!,
          rotation: newRotation as 0 | 90 | 180 | 270,
          position: newPos
        };
        this.updateHarnessConnectors(
          data.connectors.map(c => c.id === block.id ? updatedConnector : c)
        );
        this.currentSelection.set({ type: 'connector', connector: updatedConnector, block: { ...block, rotation: newRotation, position: newPos } });
      } else if (block.blockType === 'cable') {
        const updatedCable = {
          ...data.cables.find(c => c.id === block.id)!,
          rotation: newRotation as 0 | 90 | 180 | 270,
          position: newPos
        };
        this.updateHarnessCables(
          data.cables.map(c => c.id === block.id ? updatedCable : c)
        );
        this.currentSelection.set({ type: 'cable', cable: updatedCable, block: { ...block, rotation: newRotation, position: newPos } });
      } else if (block.blockType === 'component') {
        const updatedComponent = {
          ...((data.components || []).find(c => c.id === block.id))!,
          rotation: newRotation as 0 | 90 | 180 | 270,
          position: newPos
        };
        this.updateHarnessComponents(
          (data.components || []).map(c => c.id === block.id ? updatedComponent : c)
        );
        this.currentSelection.set({ type: 'component', component: updatedComponent, block: { ...block, rotation: newRotation, position: newPos } });
      }
    }
    // Legacy fallback for selections without block (e.g. sub-harness edit mode)
    else if (selection?.connector) {
      const connector = data.connectors.find(c => c.id === selection.connector!.id);
      if (!connector) return;
      const currentRotation = connector.rotation || 0;
      let newRotation = (currentRotation + delta) % 360;
      if (newRotation < 0) newRotation += 360;
      const centroidOffset = getConnectorCentroidOffset(connector);
      const newPos = rotateAroundCentroid(connector.position || { x: 100, y: 100 }, centroidOffset, currentRotation, newRotation);
      const updatedConnector = { ...connector, rotation: newRotation as 0 | 90 | 180 | 270, position: newPos };
      this.updateHarnessConnectors(data.connectors.map(c => c.id === updatedConnector.id ? updatedConnector : c));
      this.currentSelection.set({ type: 'connector', connector: updatedConnector });
    } else if (selection?.cable) {
      const cable = data.cables.find(c => c.id === selection.cable!.id);
      if (!cable) return;
      const currentRotation = cable.rotation || 0;
      let newRotation = (currentRotation + delta) % 360;
      if (newRotation < 0) newRotation += 360;
      const centroidOffset = getCableCentroidOffset(cable);
      const newPos = rotateAroundCentroid(cable.position || { x: 100, y: 100 }, centroidOffset, currentRotation, newRotation);
      const updatedCable = { ...cable, rotation: newRotation as 0 | 90 | 180 | 270, position: newPos };
      this.updateHarnessCables(data.cables.map(c => c.id === updatedCable.id ? updatedCable : c));
      this.currentSelection.set({ type: 'cable', cable: updatedCable });
    } else if (selection?.component) {
      const component = (data.components || []).find(c => c.id === selection.component!.id);
      if (!component) return;
      const currentRotation = component.rotation || 0;
      let newRotation = (currentRotation + delta) % 360;
      if (newRotation < 0) newRotation += 360;
      const centroidOffset = getComponentCentroidOffset(component);
      const newPos = rotateAroundCentroid(component.position || { x: 100, y: 100 }, centroidOffset, currentRotation, newRotation);
      const updatedComponent = { ...component, rotation: newRotation as 0 | 90 | 180 | 270, position: newPos };
      this.updateHarnessComponents((data.components || []).map(c => c.id === updatedComponent.id ? updatedComponent : c));
      this.currentSelection.set({ type: 'component', component: updatedComponent });
    }

    // Normalize connections so "from" is always the top-left endpoint
    this.harnessCanvas?.normalizeAllConnections();
  }

  flipSelected() {
    const selection = this.currentSelection();
    const data = this.harnessData();
    if (!data) return;

    // Push to history before making changes
    this.historyService.push(data);

    // Use block for unified flip if available
    if (selection?.block) {
      const block = selection.block;
      const newFlipped = !block.flipped;

      if (block.blockType === 'connector') {
        const updatedConnector = { ...data.connectors.find(c => c.id === block.id)!, flipped: newFlipped };
        this.updateHarnessConnectors(data.connectors.map(c => c.id === block.id ? updatedConnector : c));
        this.currentSelection.set({ type: 'connector', connector: updatedConnector, block: { ...block, flipped: newFlipped } });
      } else if (block.blockType === 'cable') {
        const updatedCable = { ...data.cables.find(c => c.id === block.id)!, flipped: newFlipped };
        this.updateHarnessCables(data.cables.map(c => c.id === block.id ? updatedCable : c));
        this.currentSelection.set({ type: 'cable', cable: updatedCable, block: { ...block, flipped: newFlipped } });
      } else if (block.blockType === 'component') {
        const updatedComponent = { ...(data.components || []).find(c => c.id === block.id)!, flipped: newFlipped };
        this.updateHarnessComponents((data.components || []).map(c => c.id === block.id ? updatedComponent : c));
        this.currentSelection.set({ type: 'component', component: updatedComponent, block: { ...block, flipped: newFlipped } });
      }
    }
    // Legacy fallback
    else if (selection?.connector) {
      const connector = data.connectors.find(c => c.id === selection.connector!.id);
      if (!connector) return;
      const updatedConnector = { ...connector, flipped: !(connector.flipped || false) };
      this.updateHarnessConnectors(data.connectors.map(c => c.id === updatedConnector.id ? updatedConnector : c));
      this.currentSelection.set({ type: 'connector', connector: updatedConnector });
    } else if (selection?.cable) {
      const cable = data.cables.find(c => c.id === selection.cable!.id);
      if (!cable) return;
      const updatedCable = { ...cable, flipped: !(cable.flipped || false) };
      this.updateHarnessCables(data.cables.map(c => c.id === updatedCable.id ? updatedCable : c));
      this.currentSelection.set({ type: 'cable', cable: updatedCable });
    } else if (selection?.component) {
      const component = (data.components || []).find(c => c.id === selection.component!.id);
      if (!component) return;
      const updatedComponent = { ...component, flipped: !(component.flipped || false) };
      this.updateHarnessComponents((data.components || []).map(c => c.id === updatedComponent.id ? updatedComponent : c));
      this.currentSelection.set({ type: 'component', component: updatedComponent });
    }

    // Normalize connections so "from" is always the top-left endpoint
    this.harnessCanvas?.normalizeAllConnections();
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

    // Push to history before making changes
    this.historyService.push(data);

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
    // Clear undo/redo history when creating a new harness
    this.historyService.clear();

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
    // Clear undo/redo history when loading a different harness
    this.historyService.clear();

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
          description: harness.description || '',
          releaseState: harness.releaseState || 'draft'
        };

        // Sync all linked parts (connectors, cables, components) from database
        this.syncPartsFromDatabase(data);
      },
      error: (err) => {
        this.snackBar.open('Failed to load harness', 'Close', { duration: 3000 });
        this.createNewHarness();
      }
    });
  }

  private syncPartsFromDatabase(data: HarnessData) {
    const connectorsWithPartId = data.connectors.filter(c => c.partId);
    const cablesWithPartId = data.cables.filter(c => c.partId);
    const componentsWithPartId = (data.components || []).filter(c => c.partId);

    // If no elements have partId, just set the data
    if (connectorsWithPartId.length === 0 && cablesWithPartId.length === 0 && componentsWithPartId.length === 0) {
      this.harnessData.set(data);
      this.originalData.set(JSON.stringify(data));
      return;
    }

    // Batch-fetch all linked parts from database
    const connectorRequests = connectorsWithPartId.map(c =>
      this.harnessPartsService.getConnectorByPartId(c.partId!).pipe(catchError(() => of(null)))
    );
    const cableRequests = cablesWithPartId.map(c =>
      this.harnessPartsService.getCableByPartId(c.partId!).pipe(catchError(() => of(null)))
    );
    const componentRequests = componentsWithPartId.map(c =>
      this.harnessPartsService.getComponentByPartId(c.partId!).pipe(catchError(() => of(null)))
    );

    forkJoin([
      connectorRequests.length > 0 ? forkJoin(connectorRequests) : of([]),
      cableRequests.length > 0 ? forkJoin(cableRequests) : of([]),
      componentRequests.length > 0 ? forkJoin(componentRequests) : of([])
    ]).subscribe({
      next: ([dbConnectors, dbCables, dbComponents]) => {
        // Build lookup maps: partId -> db record
        const connectorMap = new Map<number, DbElectricalConnector>();
        dbConnectors.forEach((db, idx) => {
          if (db) connectorMap.set(connectorsWithPartId[idx].partId!, db);
        });

        const cableMap = new Map<number, DbCable>();
        dbCables.forEach((db, idx) => {
          if (db) cableMap.set(cablesWithPartId[idx].partId!, db);
        });

        const componentMap = new Map<number, DbElectricalComponent>();
        dbComponents.forEach((db, idx) => {
          if (db) componentMap.set(componentsWithPartId[idx].partId!, db);
        });

        // Detect structural changes (images always sync silently)
        const structuralChanges: SyncChange[] = [];

        // Check connectors
        for (const conn of connectorsWithPartId) {
          const db = connectorMap.get(conn.partId!);
          if (!db) continue;
          const changes: { field: string; description: string }[] = [];

          if (db.type && db.type !== conn.type) {
            changes.push({ field: 'Type', description: `${conn.type} → ${db.type}` });
          }
          if (db.pinCount && db.pinCount !== conn.pinCount) {
            changes.push({ field: 'Pin Count', description: `${conn.pinCount} → ${db.pinCount}` });
          }
          if (db.color && db.color !== conn.color) {
            changes.push({ field: 'Color', description: `${conn.color || 'none'} → ${db.color}` });
          }
          if (db.pins && db.pins.length !== conn.pins.length) {
            changes.push({ field: 'Pins', description: `${conn.pins.length} pins → ${db.pins.length} pins` });
          }

          if (changes.length > 0) {
            structuralChanges.push({
              elementType: 'connector',
              elementId: conn.id,
              label: conn.label,
              changes,
              dbData: db,
              accepted: true
            });
          }
        }

        // Check cables
        for (const cable of cablesWithPartId) {
          const db = cableMap.get(cable.partId!);
          if (!db) continue;
          const changes: { field: string; description: string }[] = [];

          if ((db.gaugeAWG || null) !== (cable.gaugeAWG || null)) {
            changes.push({ field: 'Gauge', description: `${cable.gaugeAWG || 'none'} → ${db.gaugeAWG || 'none'}` });
          }
          if (db.wireCount && db.wireCount !== cable.wireCount) {
            changes.push({ field: 'Wire Count', description: `${cable.wireCount} → ${db.wireCount}` });
          }
          if (db.wires && db.wires.length !== cable.wires.length) {
            changes.push({ field: 'Wires', description: `${cable.wires.length} wires → ${db.wires.length} wires` });
          }

          if (changes.length > 0) {
            structuralChanges.push({
              elementType: 'cable',
              elementId: cable.id,
              label: cable.label,
              changes,
              dbData: db,
              accepted: true
            });
          }
        }

        // Check components
        for (const comp of componentsWithPartId) {
          const db = componentMap.get(comp.partId!);
          if (!db) continue;
          const changes: { field: string; description: string }[] = [];

          if (db.pinCount && db.pinCount !== comp.pinCount) {
            changes.push({ field: 'Pin Count', description: `${comp.pinCount} → ${db.pinCount}` });
          }
          if (db.pins && db.pins.length !== comp.pinGroups.length) {
            changes.push({ field: 'Pin Groups', description: `${comp.pinGroups.length} groups → ${db.pins.length} groups` });
          }

          if (changes.length > 0) {
            structuralChanges.push({
              elementType: 'component',
              elementId: comp.id,
              label: comp.label,
              changes,
              dbData: db,
              accepted: true
            });
          }
        }

        // Always silently update images first
        let updatedData = this.applyImageUpdates(data, connectorMap, cableMap, componentMap);

        if (structuralChanges.length === 0) {
          // No structural changes — just set data with refreshed images
          this.harnessData.set(updatedData);
          this.originalData.set(JSON.stringify(updatedData));
          return;
        }

        // Show sync dialog for structural changes
        const dialogRef = this.dialog.open(HarnessSyncDialog, {
          width: '500px',
          maxHeight: '80vh',
          data: { changes: structuralChanges }
        });

        dialogRef.afterClosed().subscribe((result: SyncChange[] | undefined) => {
          if (!result) {
            // Dialog dismissed — keep existing data with refreshed images
            this.harnessData.set(updatedData);
            this.originalData.set(JSON.stringify(updatedData));
            return;
          }

          // Apply accepted structural changes
          updatedData = this.applyStructuralChanges(updatedData, result);
          this.harnessData.set(updatedData);
          this.originalData.set(JSON.stringify(updatedData));
        });
      },
      error: () => {
        // If fetching fails, still load the harness
        this.harnessData.set(data);
        this.originalData.set(JSON.stringify(data));
      }
    });
  }

  private applyImageUpdates(
    data: HarnessData,
    connectorMap: Map<number, DbElectricalConnector>,
    cableMap: Map<number, DbCable>,
    componentMap: Map<number, DbElectricalComponent>
  ): HarnessData {
    const updatedConnectors = data.connectors.map(conn => {
      if (!conn.partId) return conn;
      const db = connectorMap.get(conn.partId);
      if (!db) return conn;
      return {
        ...conn,
        connectorImage: db.connectorImage || undefined,
        pinoutDiagramImage: db.pinoutDiagramImage || undefined
      };
    });

    const updatedCables = data.cables.map(cable => {
      if (!cable.partId) return cable;
      const db = cableMap.get(cable.partId);
      if (!db) return cable;
      return {
        ...cable,
        cableDiagramImage: db.cableDiagramImage || undefined
      };
    });

    const updatedComponents = (data.components || []).map(comp => {
      if (!comp.partId) return comp;
      const db = componentMap.get(comp.partId);
      if (!db) return comp;
      return {
        ...comp,
        componentImage: db.componentImage || undefined,
        pinoutDiagramImage: db.pinoutDiagramImage || undefined
      };
    });

    return {
      ...data,
      connectors: updatedConnectors,
      cables: updatedCables,
      components: updatedComponents
    };
  }

  private applyStructuralChanges(data: HarnessData, changes: SyncChange[]): HarnessData {
    let updatedData = { ...data };

    for (const change of changes) {
      if (!change.accepted) continue;

      if (change.elementType === 'connector') {
        const db = change.dbData as DbElectricalConnector;
        updatedData = {
          ...updatedData,
          connectors: updatedData.connectors.map(conn => {
            if (conn.id !== change.elementId) return conn;

            // Regenerate pins if count or array length changed
            let pins = conn.pins;
            if ((db.pinCount !== conn.pinCount || db.pins?.length !== conn.pins.length) && db.pins) {
              pins = db.pins.map((dbPin, i) => {
                const existing = conn.pins[i];
                return {
                  id: existing?.id || `pin-${Date.now()}-${i + 1}`,
                  number: dbPin.number || String(i + 1),
                  label: existing?.label || dbPin.label || ''
                };
              });
            }

            return {
              ...conn,
              type: db.type || conn.type,
              pinCount: db.pinCount || conn.pinCount,
              color: db.color !== undefined ? (db.color || undefined) : conn.color,
              pins
            };
          })
        };
      } else if (change.elementType === 'cable') {
        const db = change.dbData as DbCable;
        updatedData = {
          ...updatedData,
          cables: updatedData.cables.map(cable => {
            if (cable.id !== change.elementId) return cable;

            // Regenerate wires if count changed
            let wires = cable.wires;
            if (db.wireCount !== cable.wireCount && db.wires) {
              wires = db.wires.map((dbWire, i) => {
                const existing = cable.wires[i];
                return {
                  id: existing?.id || `wire-${Date.now()}-${i + 1}`,
                  color: dbWire.color,
                  colorCode: dbWire.colorCode,
                  label: existing?.label || ''
                };
              });
            }

            return {
              ...cable,
              gaugeAWG: db.gaugeAWG !== undefined ? (db.gaugeAWG || undefined) : cable.gaugeAWG,
              wireCount: db.wireCount || cable.wireCount,
              wires
            };
          })
        };
      } else if (change.elementType === 'component') {
        const db = change.dbData as DbElectricalComponent;
        updatedData = {
          ...updatedData,
          components: (updatedData.components || []).map(comp => {
            if (comp.id !== change.elementId) return comp;

            // Regenerate pin groups if structure changed
            let pinGroups = comp.pinGroups;
            if (db.pins && db.pins.length !== comp.pinGroups.length) {
              pinGroups = db.pins.map((dbGroup, gi) => {
                const existing = comp.pinGroups[gi];
                return {
                  id: existing?.id || `group-${Date.now()}-${gi + 1}`,
                  name: dbGroup.name,
                  pinTypeID: dbGroup.pinTypeID,
                  pinTypeName: dbGroup.pinTypeName,
                  matingConnector: dbGroup.matingConnector,
                  pins: dbGroup.pins.map((dbPin, pi) => {
                    const existingPin = existing?.pins?.[pi];
                    return {
                      id: existingPin?.id || `pin-${Date.now()}-${gi}-${pi}`,
                      number: dbPin.number || String(pi + 1),
                      label: existingPin?.label || dbPin.label || ''
                    };
                  })
                };
              });
            }

            return {
              ...comp,
              pinCount: db.pinCount || comp.pinCount,
              pinGroups
            };
          })
        };
      }
    }

    return updatedData;
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

  private stripImageData(data: HarnessData): HarnessData {
    return {
      ...data,
      connectors: data.connectors.map(({ connectorImage, pinoutDiagramImage, ...rest }) => rest as any),
      cables: data.cables.map(({ cableDiagramImage, ...rest }) => rest as any),
      components: (data.components || []).map(({ componentImage, pinoutDiagramImage, ...rest }) => rest as any),
    };
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
      harnessData: this.stripImageData(data),
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

    // Save main harness
    const mainSave$ = id
      ? this.harnessService.updateHarness(id, saveData)
      : this.harnessService.createHarness(saveData);

    // Save any pending sub-harness changes
    const subHarnessSaves: Array<ReturnType<typeof this.harnessService.updateHarness>> = [];
    this.pendingSubHarnessChanges.forEach((subData, subId) => {
      subHarnessSaves.push(
        this.harnessService.updateHarness(subId, { harnessData: this.stripImageData(subData) })
      );
    });

    if (subHarnessSaves.length > 0) {
      // Save sub-harnesses in parallel with main harness
      return forkJoin([mainSave$, ...subHarnessSaves]).pipe(
        switchMap(([mainResult]) => {
          // Clear pending changes after successful save
          this.pendingSubHarnessChanges.clear();
          this.hasPendingSubHarnessChanges.set(false);
          return of(mainResult);
        })
      );
    }

    return mainSave$;
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

    const json = JSON.stringify(this.stripImageData(data), null, 2);
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
        const data = this.harnessData();
        if (data) {
          this.historyService.push(data);
        }
        // Assign highest zIndex so new connector appears in front
        const newConnector = { ...connector, zIndex: this.getMaxZIndex() + 1 };
        this.harnessCanvas?.addConnector(newConnector);
      }
    });
  }

  onEditConnector(connector: HarnessConnector) {
    const dialogRef = this.dialog.open(HarnessConnectorDialog, {
      width: '400px',
      data: {
        existingConnectors: this.harnessData()?.connectors || [],
        editConnector: connector,
        isLocked: this.isLocked()
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

        // Push to history before making changes
        this.historyService.push(data);

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
        editCable: cable,
        isLocked: this.isLocked()
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
    const componentMax = Math.max(0, ...(data.components || []).map(c => c.zIndex || 0));
    return Math.max(connectorMax, cableMax, componentMax);
  }

  private getMinZIndex(): number {
    const data = this.harnessData();
    if (!data) return 0;
    const connectorMin = Math.min(0, ...data.connectors.map(c => c.zIndex || 0));
    const cableMin = Math.min(0, ...data.cables.map(c => c.zIndex || 0));
    const componentMin = Math.min(0, ...(data.components || []).map(c => c.zIndex || 0));
    return Math.min(connectorMin, cableMin, componentMin);
  }

  onBringToFront() {
    const selection = this.currentSelection();
    const data = this.harnessData();
    if (!data) return;

    this.historyService.push(data);
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
    } else if (selection?.component) {
      const updated = { ...selection.component, zIndex: maxZ + 1 };
      this.harnessData.set({
        ...data,
        components: (data.components || []).map(c => c.id === updated.id ? updated : c)
      });
      this.currentSelection.set({ type: 'component', component: updated });
    }
    this.triggerAutoSave();
  }

  onSendToBack() {
    const selection = this.currentSelection();
    const data = this.harnessData();
    if (!data) return;

    this.historyService.push(data);
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
    } else if (selection?.component) {
      const updated = { ...selection.component, zIndex: minZ - 1 };
      this.harnessData.set({
        ...data,
        components: (data.components || []).map(c => c.id === updated.id ? updated : c)
      });
      this.currentSelection.set({ type: 'component', component: updated });
    }
    this.triggerAutoSave();
  }

  onMoveForward() {
    const selection = this.currentSelection();
    const data = this.harnessData();
    if (!data) return;

    this.historyService.push(data);

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
    } else if (selection?.component) {
      const currentZ = selection.component.zIndex || 0;
      const updated = { ...selection.component, zIndex: currentZ + 1 };
      this.harnessData.set({
        ...data,
        components: (data.components || []).map(c => c.id === updated.id ? updated : c)
      });
      this.currentSelection.set({ type: 'component', component: updated });
    }
    this.triggerAutoSave();
  }

  onMoveBackward() {
    const selection = this.currentSelection();
    const data = this.harnessData();
    if (!data) return;

    this.historyService.push(data);

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
    } else if (selection?.component) {
      const currentZ = selection.component.zIndex || 0;
      const updated = { ...selection.component, zIndex: currentZ - 1 };
      this.harnessData.set({
        ...data,
        components: (data.components || []).map(c => c.id === updated.id ? updated : c)
      });
      this.currentSelection.set({ type: 'component', component: updated });
    }
    this.triggerAutoSave();
  }

  onDeleteSelected() {
    const data = this.harnessData();
    if (data) {
      this.historyService.push(data);
    }
    this.harnessCanvas?.deleteSelected();
  }

  onGroupSelected() {
    const data = this.harnessData();
    if (data) {
      this.historyService.push(data);
    }
    this.harnessCanvas?.groupSelected();
  }

  onUngroupSelected() {
    const data = this.harnessData();
    if (data) {
      this.historyService.push(data);
    }
    this.harnessCanvas?.ungroupSelected();
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

  onCanvasToolChangeRequest(tool: string) {
    this.activeTool.set(tool as HarnessTool);
  }

  // Canvas events
  onSelectionChanged(selection: CanvasSelection) {
    this.currentSelection.set(selection);
  }

  onDataChanged(data: HarnessData) {
    this.harnessData.set(data);
    this.triggerAutoSave();
  }

  // Track pending sub-harness changes for auto-save
  private pendingSubHarnessChanges = new Map<number, HarnessData>();

  onSubHarnessDataChanged(event: { subHarnessId: number; data: HarnessData }) {
    // Store the changes for auto-save
    this.pendingSubHarnessChanges.set(event.subHarnessId, event.data);
    this.hasPendingSubHarnessChanges.set(true);
    this.triggerAutoSave();
  }

  onSubHarnessEditModeChanged(inEditMode: boolean) {
    // Could update UI state here if needed (e.g., disable certain toolbar buttons)
  }

  onConnectorMoved(event: { connector: HarnessConnector; x: number; y: number }) {
    // Update the harness data with new position
    const data = this.harnessData();
    if (!data) return;

    const connectors = data.connectors.map(c =>
      c.id === event.connector.id ? event.connector : c
    );
    this.harnessData.set({ ...data, connectors });
    // Normalize connections so "from" is always the top-left endpoint
    this.harnessCanvas?.normalizeAllConnections();
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
    // Normalize connections so "from" is always the top-left endpoint
    this.harnessCanvas?.normalizeAllConnections();
    this.triggerAutoSave();
  }

  onAddComponent() {
    const dialogRef = this.dialog.open(HarnessComponentDialog, {
      width: '500px',
      data: { existingComponents: this.harnessData()?.components || [] }
    });

    dialogRef.afterClosed().subscribe((component: HarnessComponent | undefined) => {
      if (component) {
        const data = this.harnessData();
        if (data) {
          this.historyService.push(data);
        }
        // Assign highest zIndex so new component appears in front
        const newComponent = { ...component, zIndex: this.getMaxZIndex() + 1 };
        this.harnessCanvas?.addComponent(newComponent);
      }
    });
  }

  onAddSubHarness() {
    const currentId = this.currentHarnessId();
    const currentPartNumber = this.harnessData()?.partNumber;

    const dialogRef = this.dialog.open(HarnessListDialog, {
      width: '600px',
      maxHeight: '80vh',
      data: {
        excludeHarnessId: currentId,
        excludePartNumber: currentPartNumber,
        selectMode: true
      }
    });

    dialogRef.afterClosed().subscribe((selectedHarness: WireHarness | undefined) => {
      if (!selectedHarness) return;

      const data = this.harnessData();
      if (!data) return;

      // Push to history before making changes
      this.historyService.push(data);

      // Generate unique instance ID
      const existingSubHarnesses = data.subHarnesses || [];
      const instanceNum = existingSubHarnesses.length + 1;
      const instanceId = `sub-${Date.now()}-${instanceNum}`;

      // Create the sub-harness reference (always expanded to show full harness)
      const subHarnessRef: SubHarnessRef = {
        id: instanceId,
        harnessId: selectedHarness.id,
        position: { x: 200, y: 200 },
        zIndex: this.getMaxZIndex() + 1
      };

      // Add to harness data
      this.harnessData.set({
        ...data,
        subHarnesses: [...existingSubHarnesses, subHarnessRef]
      });

      this.triggerAutoSave();
      this.snackBar.open(`Added "${selectedHarness.name}" as sub-harness`, 'Close', { duration: 2000 });
    });
  }

  onEditComponent(component: HarnessComponent) {
    const dialogRef = this.dialog.open(HarnessComponentDialog, {
      width: '500px',
      data: {
        existingComponents: this.harnessData()?.components || [],
        editComponent: component,
        isLocked: this.isLocked()
      }
    });

    dialogRef.afterClosed().subscribe((updatedComponent: HarnessComponent | undefined) => {
      if (updatedComponent) {
        const data = this.harnessData();
        if (data) {
          const components = (data.components || []).map(c =>
            c.id === updatedComponent.id ? updatedComponent : c
          );
          this.updateHarnessComponents(components);
          // Update selection with new component data
          this.currentSelection.set({ type: 'component', component: updatedComponent });
        }
      }
    });
  }

  // Child harness element edit handlers (for sub-harness edit mode)
  onEditChildConnector(event: { connector: HarnessConnector; subHarnessId: number; childData: HarnessData }) {
    const dialogRef = this.dialog.open(HarnessConnectorDialog, {
      width: '400px',
      data: {
        existingConnectors: event.childData.connectors || [],
        editConnector: event.connector
      }
    });

    dialogRef.afterClosed().subscribe((updatedConnector: HarnessConnector | undefined) => {
      if (updatedConnector) {
        const updatedChildData: HarnessData = {
          ...event.childData,
          connectors: event.childData.connectors.map(c =>
            c.id === updatedConnector.id ? updatedConnector : c
          )
        };
        // Emit the change to be saved
        this.pendingSubHarnessChanges.set(event.subHarnessId, updatedChildData);
        this.hasPendingSubHarnessChanges.set(true);
        // Update the canvas cache
        this.harnessCanvas?.updateSubHarnessData(event.subHarnessId, updatedChildData);
        this.triggerAutoSave();
      }
    });
  }

  onEditChildCable(event: { cable: HarnessCable; subHarnessId: number; childData: HarnessData }) {
    const dialogRef = this.dialog.open(HarnessAddCableDialog, {
      width: '400px',
      data: {
        existingCables: event.childData.cables || [],
        editCable: event.cable
      }
    });

    dialogRef.afterClosed().subscribe((updatedCable: HarnessCable | undefined) => {
      if (updatedCable) {
        const updatedChildData: HarnessData = {
          ...event.childData,
          cables: event.childData.cables.map(c =>
            c.id === updatedCable.id ? updatedCable : c
          )
        };
        // Emit the change to be saved
        this.pendingSubHarnessChanges.set(event.subHarnessId, updatedChildData);
        this.hasPendingSubHarnessChanges.set(true);
        // Update the canvas cache
        this.harnessCanvas?.updateSubHarnessData(event.subHarnessId, updatedChildData);
        this.triggerAutoSave();
      }
    });
  }

  onEditChildComponent(event: { component: HarnessComponent; subHarnessId: number; childData: HarnessData }) {
    const dialogRef = this.dialog.open(HarnessComponentDialog, {
      width: '500px',
      data: {
        existingComponents: event.childData.components || [],
        editComponent: event.component
      }
    });

    dialogRef.afterClosed().subscribe((updatedComponent: HarnessComponent | undefined) => {
      if (updatedComponent) {
        const updatedChildData: HarnessData = {
          ...event.childData,
          components: (event.childData.components || []).map(c =>
            c.id === updatedComponent.id ? updatedComponent : c
          )
        };
        // Emit the change to be saved
        this.pendingSubHarnessChanges.set(event.subHarnessId, updatedChildData);
        this.hasPendingSubHarnessChanges.set(true);
        // Update the canvas cache
        this.harnessCanvas?.updateSubHarnessData(event.subHarnessId, updatedChildData);
        this.triggerAutoSave();
      }
    });
  }

  onComponentMoved(event: { component: HarnessComponent; x: number; y: number }) {
    // Update the harness data with new position
    const data = this.harnessData();
    if (!data) return;

    const components = (data.components || []).map(c =>
      c.id === event.component.id ? event.component : c
    );
    this.harnessData.set({ ...data, components });
    // Normalize connections so "from" is always the top-left endpoint
    this.harnessCanvas?.normalizeAllConnections();
    this.triggerAutoSave();
  }

  // Property panel events
  onMetadataChanged(event: { field: string; value: string }) {
    const data = this.harnessData();
    if (!data) return;

    this.historyService.push(data);
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

    this.historyService.push(data);
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

    this.historyService.push(data);
    const updatedConnection = { ...selection.connection, [event.field]: event.value };

    this.harnessData.set({
      ...data,
      connections: data.connections.map(c =>
        c.id === updatedConnection.id ? updatedConnection : c
      )
    });
    // Update selection with new connection data
    this.currentSelection.set({ type: 'wire', connection: updatedConnection });
    this.triggerAutoSave();
  }

  onPinLabelChanged(event: { index: number; label: string }) {
    const selection = this.currentSelection();
    if (!selection?.connector) return;

    const data = this.harnessData();
    if (!data) return;

    this.historyService.push(data);
    const updatedPins = [...selection.connector.pins];
    if (updatedPins[event.index]) {
      updatedPins[event.index] = { ...updatedPins[event.index], label: event.label };
    }

    const updatedConnector = { ...selection.connector, pins: updatedPins };
    this.updateHarnessConnectors(
      data.connectors.map(c => c.id === updatedConnector.id ? updatedConnector : c)
    );
  }

  onBulkWiresChanged(event: { connectionIds: string[]; field: string; value: any }) {
    const data = this.harnessData();
    if (!data) return;

    this.historyService.push(data);
    // Update all specified connections with the new field value
    const updatedConnections = data.connections.map(c => {
      if (event.connectionIds.includes(c.id)) {
        return { ...c, [event.field]: event.value };
      }
      return c;
    });

    this.harnessData.set({
      ...data,
      connections: updatedConnections
    });
    this.triggerAutoSave();
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

  private updateHarnessComponents(components: HarnessComponent[]) {
    const data = this.harnessData();
    if (!data) return;

    this.harnessData.set({ ...data, components });
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

  onReleaseHarness() {
    const id = this.currentHarnessId();
    const data = this.harnessData();
    if (!id) {
      this.snackBar.open('Harness must be saved before releasing', 'Close', { duration: 3000 });
      return;
    }

    const currentState = data?.releaseState || 'draft';

    if (currentState === 'draft') {
      // Submit for review
      if (confirm(`Submit "${data?.name}" for review?`)) {
        this.harnessService.submitForReview(id).subscribe({
          next: (result: any) => {
            let message = 'Harness submitted for review';
            let duration = 2000;
            if (result.updatedSubHarnesses?.length > 0) {
              const names = result.updatedSubHarnesses.map((s: any) => s.name).join(', ');
              message += `. Sub-harnesses also submitted: ${names}`;
              duration = 5000;
            }
            this.snackBar.open(message, 'Close', { duration });
            // Update local state
            if (data) {
              this.harnessData.set({ ...data, releaseState: 'review' });
              this.originalData.set(JSON.stringify(this.harnessData()));
            }
            // Refresh sub-harness data cache to reflect new states
            this.refreshSubHarnessCache();
          },
          error: (err) => {
            this.snackBar.open(err.error?.error || 'Failed to submit for review', 'Close', { duration: 3000 });
          }
        });
      }
    } else if (currentState === 'review') {
      // Release the harness (creates numeric revision)
      if (confirm(`Release "${data?.name}"? This will create a numeric revision.`)) {
        this.harnessService.release(id).subscribe({
          next: (result: any) => {
            let message = `Harness released as Rev ${result.revision}`;
            let duration = 2000;
            if (result.updatedSubHarnesses?.length > 0) {
              const names = result.updatedSubHarnesses.map((s: any) => s.name).join(', ');
              message += `. Sub-harnesses also released: ${names}`;
              duration = 5000;
            }
            this.snackBar.open(message, 'Close', { duration });
            // Update local state with new revision
            if (data) {
              this.harnessData.set({ ...data, releaseState: 'released', revision: result.revision });
              this.originalData.set(JSON.stringify(this.harnessData()));
            }
            // Refresh sub-harness data cache to reflect new states
            this.refreshSubHarnessCache();
          },
          error: (err) => {
            this.snackBar.open(err.error?.error || 'Failed to release harness', 'Close', { duration: 3000 });
          }
        });
      }
    }
  }

  onReturnToDraft() {
    const id = this.currentHarnessId();
    const data = this.harnessData();
    if (!id) {
      this.snackBar.open('Harness must be saved first', 'Close', { duration: 3000 });
      return;
    }

    if (data?.releaseState !== 'review') {
      this.snackBar.open('Only harnesses in review can be returned to draft', 'Close', { duration: 3000 });
      return;
    }

    if (confirm(`Return "${data?.name}" to draft? This will allow editing again.`)) {
      this.harnessService.reject(id, 'Returned to draft').subscribe({
        next: () => {
          this.snackBar.open('Harness returned to draft', 'Close', { duration: 2000 });
          if (data) {
            this.harnessData.set({ ...data, releaseState: 'draft' });
            this.originalData.set(JSON.stringify(this.harnessData()));
          }
        },
        error: (err) => {
          this.snackBar.open(err.error?.error || 'Failed to return to draft', 'Close', { duration: 3000 });
        }
      });
    }
  }

  private refreshSubHarnessCache() {
    this.harnessCanvas?.refreshSubHarnessCache();
  }

  onNewRevision() {
    const id = this.currentHarnessId();
    const data = this.harnessData();
    if (!id || !data) {
      this.snackBar.open('No harness loaded', 'Close', { duration: 3000 });
      return;
    }

    if (data.releaseState !== 'released') {
      this.snackBar.open('Only released harnesses can have new revisions', 'Close', { duration: 3000 });
      return;
    }

    // Check if a higher revision already exists
    this.harnessService.getAllRevisions(id).subscribe({
      next: (revisions) => {
        const currentRevision = data.revision || 'A';
        // Find the highest revision
        const higherRevisions = revisions.filter(r => this.compareRevisions(r.revision, currentRevision) > 0);

        if (higherRevisions.length > 0) {
          // Sort to find the highest revision
          higherRevisions.sort((a, b) => this.compareRevisions(b.revision, a.revision));
          const latestRevision = higherRevisions[0];

          if (confirm(`A newer revision (Rev ${latestRevision.revision}) already exists. Go to that revision?`)) {
            this.router.navigate(['/harness/editor', latestRevision.id]);
          }
        } else {
          // No higher revision exists, create one
          if (confirm(`Create a new revision of "${data.name}"? This will create Rev ${this.getNextRevision(currentRevision)}.`)) {
            this.harnessService.updateHarness(id, {
              name: data.name,
              harnessData: data
            }).subscribe({
              next: (newHarness) => {
                this.snackBar.open(`Created Rev ${newHarness.revision}`, 'Close', { duration: 2000 });
                this.router.navigate(['/harness/editor', newHarness.id]);
              },
              error: (err) => {
                this.snackBar.open(err.error?.error || 'Failed to create new revision', 'Close', { duration: 3000 });
              }
            });
          }
        }
      },
      error: () => {
        // If we can't fetch revisions, fall back to creating a new one
        if (confirm(`Create a new revision of "${data.name}"? This will create Rev ${this.getNextRevision(data.revision || 'A')}.`)) {
          this.harnessService.updateHarness(id, {
            name: data.name,
            harnessData: data
          }).subscribe({
            next: (newHarness) => {
              this.snackBar.open(`Created Rev ${newHarness.revision}`, 'Close', { duration: 2000 });
              this.router.navigate(['/harness/editor', newHarness.id]);
            },
            error: (err) => {
              this.snackBar.open(err.error?.error || 'Failed to create new revision', 'Close', { duration: 3000 });
            }
          });
        }
      }
    });
  }

  // Compare two revision strings (e.g., 'A' < 'B' < 'Z' < 'AA' < 'AB')
  // Returns negative if a < b, positive if a > b, 0 if equal
  private compareRevisions(a: string, b: string): number {
    if (a.length !== b.length) {
      return a.length - b.length;
    }
    return a.localeCompare(b);
  }

  private getNextRevision(current: string): string {
    if (current === 'Z') return 'AA';
    if (current.length === 1) {
      return String.fromCharCode(current.charCodeAt(0) + 1);
    }
    // Handle AA, AB, etc.
    const lastChar = current[current.length - 1];
    if (lastChar === 'Z') {
      return String.fromCharCode(current.charCodeAt(0) + 1) + 'A';
    }
    return current.slice(0, -1) + String.fromCharCode(lastChar.charCodeAt(0) + 1);
  }

  // Undo/Redo methods
  onDragStart() {
    const data = this.harnessData();
    if (data) {
      this.historyService.beginTransaction(data);
    }
  }

  onDragEnd() {
    const data = this.harnessData();
    if (data) {
      this.historyService.commitTransaction(data);
    }
  }

  onUndo() {
    const data = this.harnessData();
    if (!data) return;
    const previous = this.historyService.undo(data);
    if (previous) {
      this.harnessData.set(previous);
      this.triggerAutoSave();
    }
  }

  onRedo() {
    const data = this.harnessData();
    if (!data) return;
    const next = this.historyService.redo(data);
    if (next) {
      this.harnessData.set(next);
      this.triggerAutoSave();
    }
  }
}
