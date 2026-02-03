import { Component, input, output, computed, signal, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import {
  HarnessConnector,
  HarnessConnection,
  HarnessData,
  HarnessCable,
  HarnessComponent,
  HarnessPin,
  HarnessWire,
  WireEnd
} from '../../../models/harness.model';
import { CONNECTOR_TYPES, CONNECTOR_COLORS, WIRE_COLORS, AWG_GAUGES } from '../../../utils/harness/wire-color-map';
import { CanvasSelection } from '../harness-canvas/harness-canvas';
import { HarnessPartsService } from '../../../services/harness-parts.service';

@Component({
  selector: 'app-harness-property-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatExpansionModule,
    MatChipsModule,
    MatDividerModule
  ],
  templateUrl: './harness-property-panel.html',
  styleUrls: ['./harness-property-panel.scss'],
})
export class HarnessPropertyPanel implements OnInit {
  private harnessPartsService = inject(HarnessPartsService);

  // Inputs
  harnessData = input<HarnessData | null>(null);
  selection = input<CanvasSelection | null>(null);

  // Outputs
  metadataChanged = output<{ field: string; value: string }>();
  connectorChanged = output<{ field: string; value: any }>();
  connectionChanged = output<{ field: string; value: any }>();
  bulkWiresChanged = output<{ connectionIds: string[]; field: string; value: any }>();
  pinLabelChanged = output<{ index: number; label: string }>();
  deleteConnector = output<void>();
  deleteCable = output<void>();
  deleteComponent = output<void>();
  deleteConnection = output<void>();
  deleteHarness = output<void>();

  // Constants
  connectorTypes = CONNECTOR_TYPES;
  connectorColors = CONNECTOR_COLORS;
  wireColors = WIRE_COLORS;
  awgGauges = AWG_GAUGES;

  // Wire termination types (loaded from API)
  terminationTypes = signal<{ value: string; label: string }[]>([]);

  // Wire end selection state
  selectedWireEnd = signal<'from' | 'to'>('from');

  ngOnInit(): void {
    this.loadWireEnds();
  }

  loadWireEnds(): void {
    this.harnessPartsService.getWireEnds().subscribe({
      next: (wireEnds) => {
        this.terminationTypes.set(wireEnds.map(we => ({
          value: we.code,
          label: we.name
        })));
      },
      error: (err) => console.error('Failed to load wire ends', err)
    });
  }

  // Computed values
  cables = computed(() => this.harnessData()?.cables || []);
  connectorCount = computed(() => this.harnessData()?.connectors?.length || 0);
  connectionCount = computed(() => this.harnessData()?.connections?.length || 0);
  totalPins = computed(() => {
    const connectors = this.harnessData()?.connectors || [];
    return connectors.reduce((sum, c) => sum + (c.pinCount || c.pins?.length || 0), 0);
  });

  // Multi-selection wire detection
  selectedWireIds = computed(() => {
    const sel = this.selection();
    if (!sel?.selectedIds) return [];
    return sel.selectedIds
      .filter(s => s.type === 'connection')
      .map(s => s.id);
  });

  hasMultipleWiresSelected = computed(() => this.selectedWireIds().length > 1);

  // Get common values across selected wires (for showing in bulk edit)
  selectedWiresCommonValues = computed(() => {
    const wireIds = this.selectedWireIds();
    const data = this.harnessData();
    if (!data || wireIds.length === 0) return null;

    const wires = data.connections.filter(c => wireIds.includes(c.id));
    if (wires.length === 0) return null;

    // Check if all wires have the same value for each field
    const firstWire = wires[0];
    return {
      color: wires.every(w => w.color === firstWire.color) ? firstWire.color : undefined,
      gauge: wires.every(w => w.gauge === firstWire.gauge) ? firstWire.gauge : undefined,
      lengthMm: wires.every(w => w.lengthMm === firstWire.lengthMm) ? firstWire.lengthMm : undefined,
      fromTermination: wires.every(w => w.fromTermination === firstWire.fromTermination) ? firstWire.fromTermination : undefined,
      toTermination: wires.every(w => w.toTermination === firstWire.toTermination) ? firstWire.toTermination : undefined,
    };
  });

  updateMetadata(field: string, event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.metadataChanged.emit({ field, value });
  }

  updateConnector(field: string, event: Event) {
    const input = event.target as HTMLInputElement;
    let value: any = input.value;
    if (field === 'pinCount') {
      value = parseInt(value) || 1;
    }
    this.connectorChanged.emit({ field, value });
  }

  updateConnectorSelect(field: string, value: any) {
    this.connectorChanged.emit({ field, value });
  }

  updatePinLabel(index: number, event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.pinLabelChanged.emit({ index, label: value });
  }

  updateConnection(field: string, value: any) {
    this.connectionChanged.emit({ field, value });
  }

  updateConnectionInput(field: string, event: Event) {
    const input = event.target as HTMLInputElement;
    let value: any = input.value;
    if (field === 'lengthMm') {
      value = value ? parseInt(value) : undefined;
    }
    this.connectionChanged.emit({ field, value });
  }

  getConnectorLabel(connectorId: string | undefined): string {
    if (!connectorId) return 'Unknown';
    const connector = this.harnessData()?.connectors?.find(c => c.id === connectorId);
    return connector?.label || connectorId;
  }

  getPinNumber(connectorId: string | undefined, pinId: string | undefined): string {
    if (!connectorId || !pinId) return '?';
    const connector = this.harnessData()?.connectors?.find(c => c.id === connectorId);
    const pin = connector?.pins?.find(p => p.id === pinId);
    return pin?.number || pinId;
  }

  getCableLabel(cableId: string | undefined): string {
    if (!cableId) return 'Unknown';
    const cable = this.harnessData()?.cables?.find(c => c.id === cableId);
    return cable?.label || cableId;
  }

  getComponentLabel(componentId: string | undefined): string {
    if (!componentId) return 'Unknown';
    const component = this.harnessData()?.components?.find(c => c.id === componentId);
    return component?.label || componentId;
  }

  getComponentPinNumber(componentId: string | undefined, pinId: string | undefined): string {
    if (!componentId || !pinId) return '?';
    const component = this.harnessData()?.components?.find(c => c.id === componentId);
    if (component) {
      for (const group of component.pinGroups) {
        const pin = group.pins.find(p => p.id === pinId);
        if (pin) {
          return pin.number || pinId;
        }
      }
    }
    return pinId;
  }

  getWireLabel(cableId: string | undefined, wireId: string | undefined): string {
    if (!cableId || !wireId) return '?';
    const cable = this.harnessData()?.cables?.find(c => c.id === cableId);
    const wire = cable?.wires?.find(w => w.id === wireId);
    if (wire) {
      const index = cable?.wires?.indexOf(wire) ?? -1;
      const label = wire.label || wire.color || `Wire ${index + 1}`;
      return label;
    }
    return wireId;
  }

  getEndpointDescription(connection: HarnessConnection | undefined, endpoint: 'from' | 'to'): string {
    if (!connection) return 'Unknown';

    if (endpoint === 'from') {
      if (connection.fromConnector) {
        const connLabel = this.getConnectorLabel(connection.fromConnector);
        const pinNum = this.getPinNumber(connection.fromConnector, connection.fromPin);
        return `${connLabel} Pin ${pinNum}`;
      } else if (connection.fromCable) {
        const cableLabel = this.getCableLabel(connection.fromCable);
        const wireLabel = this.getWireLabel(connection.fromCable, connection.fromWire);
        const side = connection.fromSide === 'left' ? 'L' : 'R';
        return `${cableLabel} [${side}] ${wireLabel}`;
      } else if (connection.fromComponent) {
        const compLabel = this.getComponentLabel(connection.fromComponent);
        const pinNum = this.getComponentPinNumber(connection.fromComponent, connection.fromComponentPin);
        return `${compLabel} Pin ${pinNum}`;
      }
    } else {
      if (connection.toConnector) {
        const connLabel = this.getConnectorLabel(connection.toConnector);
        const pinNum = this.getPinNumber(connection.toConnector, connection.toPin);
        return `${connLabel} Pin ${pinNum}`;
      } else if (connection.toCable) {
        const cableLabel = this.getCableLabel(connection.toCable);
        const wireLabel = this.getWireLabel(connection.toCable, connection.toWire);
        const side = connection.toSide === 'left' ? 'L' : 'R';
        return `${cableLabel} [${side}] ${wireLabel}`;
      } else if (connection.toComponent) {
        const compLabel = this.getComponentLabel(connection.toComponent);
        const pinNum = this.getComponentPinNumber(connection.toComponent, connection.toComponentPin);
        return `${compLabel} Pin ${pinNum}`;
      }
    }
    return 'Unknown';
  }

  getWiresForCable(cableId: string | undefined): any[] {
    if (!cableId) return [];
    const cable = this.cables().find(c => c.id === cableId);
    return cable?.wires || [];
  }

  getWireHex(colorCode: string): string {
    const color = this.wireColors.find(c => c.code === colorCode);
    return color?.hex || '#808080';
  }

  getEndpointType(connection: HarnessConnection | undefined, endpoint: 'from' | 'to'): 'connector' | 'cable' | 'component' | null {
    if (!connection) return null;
    if (endpoint === 'from') {
      if (connection.fromConnector) return 'connector';
      if (connection.fromCable) return 'cable';
      if (connection.fromComponent) return 'component';
    } else {
      if (connection.toConnector) return 'connector';
      if (connection.toCable) return 'cable';
      if (connection.toComponent) return 'component';
    }
    return null;
  }

  getConnectorsForSelection(): HarnessConnector[] {
    return this.harnessData()?.connectors || [];
  }

  getCablesForSelection(): HarnessCable[] {
    return this.harnessData()?.cables || [];
  }

  getComponentsForSelection(): HarnessComponent[] {
    return this.harnessData()?.components || [];
  }

  getPinsForConnector(connectorId: string | undefined): HarnessPin[] {
    if (!connectorId) return [];
    const connector = this.harnessData()?.connectors?.find(c => c.id === connectorId);
    return connector?.pins || [];
  }

  getWiresForCableId(cableId: string | undefined): HarnessWire[] {
    if (!cableId) return [];
    const cable = this.harnessData()?.cables?.find(c => c.id === cableId);
    return cable?.wires || [];
  }

  getPinsForComponent(componentId: string | undefined): { pin: HarnessPin; groupName: string }[] {
    if (!componentId) return [];
    const component = this.harnessData()?.components?.find(c => c.id === componentId);
    if (!component) return [];
    const pins: { pin: HarnessPin; groupName: string }[] = [];
    for (const group of component.pinGroups) {
      for (const pin of group.pins) {
        pins.push({ pin, groupName: group.name });
      }
    }
    return pins;
  }

  getCurrentEndpointConnectorId(): string | undefined {
    const conn = this.selection()?.connection;
    if (!conn) return undefined;
    return this.selectedWireEnd() === 'from' ? conn.fromConnector : conn.toConnector;
  }

  getCurrentEndpointPinId(): string | undefined {
    const conn = this.selection()?.connection;
    if (!conn) return undefined;
    return this.selectedWireEnd() === 'from' ? conn.fromPin : conn.toPin;
  }

  getCurrentEndpointCableId(): string | undefined {
    const conn = this.selection()?.connection;
    if (!conn) return undefined;
    return this.selectedWireEnd() === 'from' ? conn.fromCable : conn.toCable;
  }

  getCurrentEndpointWireId(): string | undefined {
    const conn = this.selection()?.connection;
    if (!conn) return undefined;
    return this.selectedWireEnd() === 'from' ? conn.fromWire : conn.toWire;
  }

  getCurrentEndpointSide(): 'left' | 'right' | undefined {
    const conn = this.selection()?.connection;
    if (!conn) return undefined;
    return this.selectedWireEnd() === 'from' ? conn.fromSide : conn.toSide;
  }

  getCurrentEndpointComponentId(): string | undefined {
    const conn = this.selection()?.connection;
    if (!conn) return undefined;
    return this.selectedWireEnd() === 'from' ? conn.fromComponent : conn.toComponent;
  }

  getCurrentEndpointComponentPinId(): string | undefined {
    const conn = this.selection()?.connection;
    if (!conn) return undefined;
    return this.selectedWireEnd() === 'from' ? conn.fromComponentPin : conn.toComponentPin;
  }

  updateEndpointSide(side: 'left' | 'right') {
    const field = this.selectedWireEnd() === 'from' ? 'fromSide' : 'toSide';
    this.connectionChanged.emit({ field, value: side });
  }

  getCurrentEndpointTermination(): string | undefined {
    const conn = this.selection()?.connection;
    if (!conn) return undefined;
    return this.selectedWireEnd() === 'from' ? conn.fromTermination : conn.toTermination;
  }

  updateEndpointTermination(termination: string) {
    const field = this.selectedWireEnd() === 'from' ? 'fromTermination' : 'toTermination';
    this.connectionChanged.emit({ field, value: termination });
  }

  // Bulk wire update methods
  updateBulkWires(field: string, value: any) {
    const wireIds = this.selectedWireIds();
    if (wireIds.length === 0) return;
    this.bulkWiresChanged.emit({ connectionIds: wireIds, field, value });
  }

  updateBulkWiresInput(field: string, event: Event) {
    const input = event.target as HTMLInputElement;
    let value: any = input.value;
    if (field === 'lengthMm') {
      value = value ? parseInt(value) : undefined;
    }
    this.updateBulkWires(field, value);
  }
}
