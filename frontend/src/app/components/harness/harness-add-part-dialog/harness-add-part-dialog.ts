import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatTabsModule } from '@angular/material/tabs';
import { MatRadioModule } from '@angular/material/radio';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import {
  HarnessConnector,
  HarnessCable,
  HarnessWire,
  HarnessPin,
  DbHarnessConnector,
  DbHarnessWire,
  DbHarnessCable
} from '../../../models/harness.model';
import { HarnessPartsService } from '../../../services/harness-parts.service';
import { WIRE_COLORS, AWG_GAUGES, CONNECTOR_TYPES, CONNECTOR_COLORS } from '../../../utils/harness/wire-color-map';

export type PartType = 'connector' | 'wire' | 'cable';

export interface AddPartDialogResult {
  type: PartType;
  connector?: HarnessConnector;
  wire?: HarnessWire;
  cable?: HarnessCable;
}

interface DialogData {
  existingConnectors?: HarnessConnector[];
  existingCables?: HarnessCable[];
  initialTab?: number;
}

@Component({
  selector: 'app-harness-add-part-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule,
    MatTooltipModule,
    MatTabsModule,
    MatRadioModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './harness-add-part-dialog.html',
  styleUrls: ['./harness-add-part-dialog.scss']
})
export class HarnessAddPartDialog implements OnInit {
  private dialogRef = inject(MatDialogRef<HarnessAddPartDialog>);
  private data = inject<DialogData>(MAT_DIALOG_DATA, { optional: true });
  private partsService = inject(HarnessPartsService);

  // Constants
  wireColors = WIRE_COLORS;
  awgGauges = AWG_GAUGES;
  connectorTypes = CONNECTOR_TYPES;
  connectorColors = CONNECTOR_COLORS;

  // Tab state
  selectedTab = 0;

  // Loading states
  loadingConnectors = signal(false);
  loadingWires = signal(false);
  loadingCables = signal(false);

  // Database parts
  dbConnectors = signal<DbHarnessConnector[]>([]);
  dbWires = signal<DbHarnessWire[]>([]);
  dbCables = signal<DbHarnessCable[]>([]);

  // Selection modes
  connectorMode: 'existing' | 'new' = 'new';
  wireMode: 'existing' | 'new' = 'new';
  cableMode: 'existing' | 'new' = 'new';

  // Selected IDs
  selectedConnectorId: number | null = null;
  selectedWireId: number | null = null;
  selectedCableId: number | null = null;

  // New part forms
  newConnector = {
    label: 'J1',
    type: 'male' as 'male' | 'female' | 'terminal' | 'splice',
    pinCount: 4,
    color: 'GY'
  };

  newWire = {
    label: 'W1',
    color: 'Black',
    colorCode: 'BK',
    gaugeAWG: '22'
  };

  newCable = {
    label: 'CABLE-A',
    gaugeAWG: '22',
    lengthMm: undefined as number | undefined
  };

  cableWires = signal<HarnessWire[]>([
    { id: 'wire-1', color: 'Black', colorCode: 'BK' }
  ]);

  // Save to library flags
  saveConnectorToLibrary = true;
  saveWireToLibrary = true;
  saveCableToLibrary = true;

  ngOnInit() {
    // Set initial tab if provided
    if (this.data?.initialTab !== undefined) {
      this.selectedTab = this.data.initialTab;
    }

    // Load data for all tabs
    this.loadConnectors();
    this.loadWires();
    this.loadCables();

    // Generate unique labels based on existing parts
    this.generateUniqueLabels();
  }

  private generateUniqueLabels() {
    // Generate unique connector label
    if (this.data?.existingConnectors) {
      const labels = this.data.existingConnectors.map(c => c.label);
      let counter = 1;
      while (labels.includes(`J${counter}`)) counter++;
      this.newConnector.label = `J${counter}`;
    }

    // Generate unique cable label
    if (this.data?.existingCables) {
      const labels = this.data.existingCables.map(c => c.label);
      let counter = 1;
      while (labels.includes(`CABLE-${String.fromCharCode(64 + counter)}`)) counter++;
      this.newCable.label = `CABLE-${String.fromCharCode(64 + counter)}`;
    }
  }

  onTabChange(index: number) {
    this.selectedTab = index;
  }

  loadConnectors() {
    this.loadingConnectors.set(true);
    this.partsService.getConnectors().subscribe({
      next: (connectors) => {
        this.dbConnectors.set(connectors);
        this.loadingConnectors.set(false);
        if (connectors.length > 0) {
          this.connectorMode = 'existing';
        }
      },
      error: () => {
        this.loadingConnectors.set(false);
      }
    });
  }

  loadWires() {
    this.loadingWires.set(true);
    this.partsService.getWires().subscribe({
      next: (wires) => {
        this.dbWires.set(wires);
        this.loadingWires.set(false);
        if (wires.length > 0) {
          this.wireMode = 'existing';
        }
      },
      error: () => {
        this.loadingWires.set(false);
      }
    });
  }

  loadCables() {
    this.loadingCables.set(true);
    this.partsService.getCables().subscribe({
      next: (cables) => {
        this.dbCables.set(cables);
        this.loadingCables.set(false);
        if (cables.length > 0) {
          this.cableMode = 'existing';
        }
      },
      error: () => {
        this.loadingCables.set(false);
      }
    });
  }

  getConnectorHex(colorCode: string): string {
    const color = this.connectorColors.find(c => c.code === colorCode);
    return color?.hex || '#808080';
  }

  getWireHex(colorCode: string): string {
    const color = this.wireColors.find(c => c.code === colorCode);
    return color?.hex || '#808080';
  }

  updateNewWireColor() {
    const color = this.wireColors.find(c => c.code === this.newWire.colorCode);
    if (color) {
      this.newWire.color = color.name;
    }
  }

  updateCableWireColor(wire: HarnessWire) {
    const color = this.wireColors.find(c => c.code === wire.colorCode);
    if (color) {
      wire.color = color.name;
    }
  }

  addCableWire() {
    const newWire: HarnessWire = {
      id: `wire-${Date.now()}`,
      color: 'Black',
      colorCode: 'BK'
    };
    this.cableWires.update(wires => [...wires, newWire]);
  }

  removeCableWire(index: number) {
    if (this.cableWires().length > 1) {
      this.cableWires.update(wires => wires.filter((_, i) => i !== index));
    }
  }

  getPartTypeName(): string {
    switch (this.selectedTab) {
      case 0: return 'Connector';
      case 1: return 'Wire';
      case 2: return 'Cable';
      default: return 'Part';
    }
  }

  isValid(): boolean {
    switch (this.selectedTab) {
      case 0: // Connector
        if (this.connectorMode === 'existing') {
          return this.selectedConnectorId !== null;
        }
        return !!this.newConnector.label.trim() && this.newConnector.pinCount > 0;

      case 1: // Wire
        if (this.wireMode === 'existing') {
          return this.selectedWireId !== null;
        }
        return !!this.newWire.label.trim() && !!this.newWire.colorCode;

      case 2: // Cable
        if (this.cableMode === 'existing') {
          return this.selectedCableId !== null;
        }
        return !!this.newCable.label.trim() && this.cableWires().length > 0;

      default:
        return false;
    }
  }

  save() {
    if (!this.isValid()) return;

    switch (this.selectedTab) {
      case 0:
        this.saveConnector();
        break;
      case 1:
        this.saveWire();
        break;
      case 2:
        this.saveCable();
        break;
    }
  }

  private saveConnector() {
    if (this.connectorMode === 'existing' && this.selectedConnectorId) {
      const dbConn = this.dbConnectors().find(c => c.id === this.selectedConnectorId);
      if (dbConn) {
        const connector: HarnessConnector = {
          id: `connector-${Date.now()}`,
          label: dbConn.label,
          type: dbConn.type,
          pinCount: dbConn.pinCount,
          pins: dbConn.pins || this.generatePins(dbConn.pinCount),
          position: { x: 200, y: 200 },
          color: dbConn.color || undefined,
          dbId: dbConn.id,
          partId: dbConn.partID || undefined
        };
        this.dialogRef.close({ type: 'connector', connector } as AddPartDialogResult);
      }
    } else {
      // Create new connector
      const pins = this.generatePins(this.newConnector.pinCount);
      const connector: HarnessConnector = {
        id: `connector-${Date.now()}`,
        label: this.newConnector.label.trim(),
        type: this.newConnector.type,
        pinCount: this.newConnector.pinCount,
        pins,
        position: { x: 200, y: 200 },
        color: this.newConnector.color
      };

      if (this.saveConnectorToLibrary) {
        // Save to database first
        this.partsService.createConnector({
          label: connector.label,
          type: connector.type,
          pinCount: connector.pinCount,
          color: connector.color,
          pins
        }).subscribe({
          next: (dbConn) => {
            connector.dbId = dbConn.id;
            this.dialogRef.close({ type: 'connector', connector } as AddPartDialogResult);
          },
          error: () => {
            // Still add to canvas even if save fails
            this.dialogRef.close({ type: 'connector', connector } as AddPartDialogResult);
          }
        });
      } else {
        this.dialogRef.close({ type: 'connector', connector } as AddPartDialogResult);
      }
    }
  }

  private saveWire() {
    if (this.wireMode === 'existing' && this.selectedWireId) {
      const dbWire = this.dbWires().find(w => w.id === this.selectedWireId);
      if (dbWire) {
        const wire: HarnessWire = {
          id: `wire-${Date.now()}`,
          label: dbWire.label,
          color: dbWire.color,
          colorCode: dbWire.colorCode || undefined,
          gaugeAWG: dbWire.gaugeAWG || undefined,
          dbId: dbWire.id,
          partId: dbWire.partID || undefined
        };
        this.dialogRef.close({ type: 'wire', wire } as AddPartDialogResult);
      }
    } else {
      // Create new wire
      const wire: HarnessWire = {
        id: `wire-${Date.now()}`,
        label: this.newWire.label.trim(),
        color: this.newWire.color,
        colorCode: this.newWire.colorCode,
        gaugeAWG: this.newWire.gaugeAWG || undefined
      };

      if (this.saveWireToLibrary) {
        this.partsService.createWire({
          label: wire.label!,
          color: wire.color,
          colorCode: wire.colorCode,
          gaugeAWG: wire.gaugeAWG
        }).subscribe({
          next: (dbWire) => {
            wire.dbId = dbWire.id;
            this.dialogRef.close({ type: 'wire', wire } as AddPartDialogResult);
          },
          error: () => {
            this.dialogRef.close({ type: 'wire', wire } as AddPartDialogResult);
          }
        });
      } else {
        this.dialogRef.close({ type: 'wire', wire } as AddPartDialogResult);
      }
    }
  }

  private saveCable() {
    if (this.cableMode === 'existing' && this.selectedCableId) {
      const dbCable = this.dbCables().find(c => c.id === this.selectedCableId);
      if (dbCable) {
        const cable: HarnessCable = {
          id: `cable-${Date.now()}`,
          label: dbCable.label,
          wireCount: dbCable.wireCount,
          gaugeAWG: dbCable.gaugeAWG || undefined,
          wires: dbCable.wires.map((w, i) => ({
            id: `wire-${Date.now()}-${i}`,
            color: w.color,
            colorCode: w.colorCode
          })),
          position: { x: 300, y: 200 },
          dbId: dbCable.id,
          partId: dbCable.partID || undefined
        };
        this.dialogRef.close({ type: 'cable', cable } as AddPartDialogResult);
      }
    } else {
      // Create new cable
      const wires = this.cableWires();
      const cable: HarnessCable = {
        id: `cable-${Date.now()}`,
        label: this.newCable.label.trim(),
        wireCount: wires.length,
        gaugeAWG: this.newCable.gaugeAWG || undefined,
        lengthMm: this.newCable.lengthMm,
        wires: wires.map((w, i) => ({
          id: `wire-${Date.now()}-${i}`,
          color: w.color,
          colorCode: w.colorCode
        })),
        position: { x: 300, y: 200 }
      };

      if (this.saveCableToLibrary) {
        this.partsService.createCable({
          label: cable.label,
          wireCount: cable.wireCount,
          gaugeAWG: cable.gaugeAWG,
          wires: cable.wires.map(w => ({
            id: w.id,
            color: w.color,
            colorCode: w.colorCode
          }))
        }).subscribe({
          next: (dbCable) => {
            cable.dbId = dbCable.id;
            this.dialogRef.close({ type: 'cable', cable } as AddPartDialogResult);
          },
          error: () => {
            this.dialogRef.close({ type: 'cable', cable } as AddPartDialogResult);
          }
        });
      } else {
        this.dialogRef.close({ type: 'cable', cable } as AddPartDialogResult);
      }
    }
  }

  private generatePins(count: number): HarnessPin[] {
    const pins: HarnessPin[] = [];
    for (let i = 0; i < count; i++) {
      pins.push({
        id: `pin-${i + 1}`,
        number: String(i + 1),
        label: ''
      });
    }
    return pins;
  }
}
