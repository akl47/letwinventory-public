import { Component, input, output, computed, signal } from '@angular/core';
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
  HarnessWire
} from '../../../models/harness.model';
import { CONNECTOR_TYPES, CONNECTOR_COLORS, WIRE_COLORS, AWG_GAUGES } from '../../../utils/harness/wire-color-map';
import { CanvasSelection } from '../harness-canvas/harness-canvas';

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
export class HarnessPropertyPanel {
  // Inputs
  harnessData = input<HarnessData | null>(null);
  selection = input<CanvasSelection | null>(null);

  // Outputs
  metadataChanged = output<{ field: string; value: string }>();
  connectorChanged = output<{ field: string; value: any }>();
  connectionChanged = output<{ field: string; value: any }>();
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

  // Wire termination types
  terminationTypes = [
    { value: 'f-pin', label: 'F Pin' },
    { value: 'm-pin', label: 'M Pin' },
    { value: 'f-spade', label: 'F Spade' },
    { value: 'm-spade', label: 'M Spade' },
    { value: 'ring', label: 'Ring' },
    { value: 'fork', label: 'Fork' },
    { value: 'ferrule', label: 'Ferrule' },
    { value: 'soldered', label: 'Soldered' },
    { value: 'bare', label: 'Bare' }
  ];

  // Wire end selection state
  selectedWireEnd = signal<'from' | 'to'>('from');

  // Computed values
  cables = computed(() => this.harnessData()?.cables || []);
  connectorCount = computed(() => this.harnessData()?.connectors?.length || 0);
  connectionCount = computed(() => this.harnessData()?.connections?.length || 0);
  totalPins = computed(() => {
    const connectors = this.harnessData()?.connectors || [];
    return connectors.reduce((sum, c) => sum + (c.pinCount || c.pins?.length || 0), 0);
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
}
