import { Component, input, output, computed } from '@angular/core';
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
  deleteConnection = output<void>();
  deleteHarness = output<void>();

  // Constants
  connectorTypes = CONNECTOR_TYPES;
  connectorColors = CONNECTOR_COLORS;
  wireColors = WIRE_COLORS;
  awgGauges = AWG_GAUGES;

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
}
