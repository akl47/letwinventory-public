// HarnessBlock adapter: converts between legacy HarnessData format and unified blocks
// Legacy format (connectors/cables/components arrays) is preserved for save/load.
// Blocks are used internally by the canvas for rendering, hit testing, and state management.

import {
  HarnessBlock,
  HarnessBlockPin,
  HarnessBlockPinGroup,
  HarnessConnector,
  HarnessCable,
  HarnessComponent,
  HarnessConnection,
  HarnessData,
  HarnessPin,
  HarnessWire,
  NormalizedConnection
} from '../../models/harness.model';

import { ROW_HEIGHT, CABLE_WIRE_SPACING } from './constants';

// Header colors by block type
const CONNECTOR_HEADER_COLORS: Record<string, string> = {
  male: '#1565c0',
  female: '#c62828',
  splice: '#2e7d32',
  default: '#455a64'
};
const CABLE_HEADER_COLOR = '#696969';
const COMPONENT_HEADER_COLOR = '#002d04';

// --- Forward migration: legacy → block ---

export function connectorToBlock(c: HarnessConnector): HarnessBlock {
  const pinCount = c.pins?.length || c.pinCount || 1;
  const pins: HarnessBlockPin[] = [];

  const existingPins = c.pins?.length > 0 ? c.pins : generateDefaultPins(pinCount);
  const pinSide: 'left' | 'right' = c.type === 'female' ? 'left' : 'right';

  for (const p of existingPins) {
    pins.push({
      id: p.id,
      number: p.number,
      label: p.label,
      side: pinSide
    });
  }

  return {
    id: c.id,
    blockType: 'connector',
    label: c.label || 'CONN',
    position: { x: c.position?.x || 100, y: c.position?.y || 100 },
    rotation: c.rotation || 0,
    flipped: c.flipped || false,
    zIndex: c.zIndex || 0,
    groupId: c.groupId,
    dbId: c.dbId,
    partId: c.partId,
    partName: c.partName,
    pins,
    pinSide,
    hasMatingPoints: true,
    headerColor: CONNECTOR_HEADER_COLORS[c.type] || CONNECTOR_HEADER_COLORS['default'],
    connectorType: c.type,
    color: c.color,
    primaryImage: c.connectorImage,
    showPrimaryImage: c.showConnectorImage,
    pinoutDiagramImage: c.pinoutDiagramImage,
    showPinoutDiagram: c.showPinoutDiagram
  };
}

export function cableToBlock(c: HarnessCable): HarnessBlock {
  const wires = c.wires || [];
  const pins: HarnessBlockPin[] = [];

  // Each wire becomes a pin pair (left + right), represented as side: 'both'
  for (const w of wires) {
    const leftPinId = `${w.id}:L`;
    const rightPinId = `${w.id}:R`;

    pins.push({
      id: leftPinId,
      number: w.colorCode || w.color || '',
      label: w.label,
      side: 'both',
      wireColor: w.color,
      wireColorCode: w.colorCode,
      wireLabel: w.label,
      pairedPinId: rightPinId,
      wireDbId: w.dbId,
      wirePartId: w.partId
    });
  }

  // Cable origin is at first wire, while connector/component origin is at first pin center
  // Adjust position.y to use the same origin convention (first pin center = position.y - ROW_HEIGHT/2)
  const pos = c.position || { x: 100, y: 100 };

  return {
    id: c.id,
    blockType: 'cable',
    label: c.label || 'CABLE',
    position: { x: pos.x, y: pos.y + ROW_HEIGHT / 2 },
    rotation: c.rotation || 0,
    flipped: c.flipped || false,
    zIndex: c.zIndex || 0,
    groupId: c.groupId,
    dbId: c.dbId,
    partId: c.partId,
    partName: c.partName,
    pins,
    pinSide: 'both',
    hasMatingPoints: false,
    headerColor: CABLE_HEADER_COLOR,
    gaugeAWG: c.gaugeAWG,
    lengthMm: c.lengthMm,
    primaryImage: c.cableDiagramImage,
    showPrimaryImage: c.showCableDiagram
  };
}

export function componentToBlock(c: HarnessComponent): HarnessBlock {
  const pins: HarnessBlockPin[] = [];
  const pinGroups: HarnessBlockPinGroup[] = [];

  for (const group of c.pinGroups) {
    const groupPinIds: string[] = [];
    for (const p of group.pins) {
      pins.push({
        id: p.id,
        number: p.number,
        label: p.label,
        side: 'right',
        groupId: group.id,
        hidden: p.hidden
      });
      groupPinIds.push(p.id);
    }
    pinGroups.push({
      id: group.id,
      name: group.name,
      pinIds: groupPinIds,
      pinTypeID: group.pinTypeID,
      pinTypeName: group.pinTypeName,
      matingConnector: group.matingConnector,
      hidden: group.hidden
    });
  }

  return {
    id: c.id,
    blockType: 'component',
    label: c.label || 'COMP',
    position: { x: c.position?.x || 100, y: c.position?.y || 100 },
    rotation: c.rotation || 0,
    flipped: c.flipped || false,
    zIndex: c.zIndex || 0,
    groupId: c.groupId,
    dbId: c.dbId,
    partId: c.partId,
    partName: c.partName,
    pins,
    pinGroups,
    pinSide: 'right',
    hasMatingPoints: false,
    headerColor: COMPONENT_HEADER_COLOR,
    primaryImage: c.componentImage,
    showPrimaryImage: c.showComponentImage,
    pinoutDiagramImage: c.pinoutDiagramImage,
    showPinoutDiagram: c.showPinoutDiagram
  };
}

// --- Reverse migration: block → legacy ---

export function blockToConnector(b: HarnessBlock): HarnessConnector {
  const pins: HarnessPin[] = b.pins.map(p => ({
    id: p.id,
    number: p.number,
    label: p.label
  }));

  return {
    id: b.id,
    label: b.label,
    type: b.connectorType || 'male',
    pinCount: pins.length,
    pins,
    position: { ...b.position },
    color: b.color,
    rotation: b.rotation as 0 | 90 | 180 | 270,
    flipped: b.flipped,
    zIndex: b.zIndex,
    groupId: b.groupId,
    dbId: b.dbId,
    partId: b.partId,
    partName: b.partName,
    connectorImage: b.primaryImage,
    showConnectorImage: b.showPrimaryImage,
    pinoutDiagramImage: b.pinoutDiagramImage,
    showPinoutDiagram: b.showPinoutDiagram
  };
}

export function blockToCable(b: HarnessBlock): HarnessCable {
  // Rebuild wires from pins. Cable pins have side='both' and store wire metadata.
  const wires: HarnessWire[] = [];
  for (const pin of b.pins) {
    if (pin.side !== 'both') continue;
    // Strip the :L suffix to get back the original wire ID
    const wireId = pin.id.endsWith(':L') ? pin.id.slice(0, -2) : pin.id;
    wires.push({
      id: wireId,
      color: pin.wireColor || '',
      colorCode: pin.wireColorCode,
      label: pin.wireLabel,
      dbId: pin.wireDbId,
      partId: pin.wirePartId
    });
  }

  // Reverse the Y position adjustment from cableToBlock
  const pos = { x: b.position.x, y: b.position.y - ROW_HEIGHT / 2 };

  return {
    id: b.id,
    label: b.label,
    wireCount: wires.length,
    wires,
    position: pos,
    rotation: b.rotation as 0 | 90 | 180 | 270,
    flipped: b.flipped,
    zIndex: b.zIndex,
    groupId: b.groupId,
    gaugeAWG: b.gaugeAWG,
    lengthMm: b.lengthMm,
    dbId: b.dbId,
    partId: b.partId,
    partName: b.partName,
    cableDiagramImage: b.primaryImage,
    showCableDiagram: b.showPrimaryImage
  };
}

export function blockToComponent(b: HarnessBlock): HarnessComponent {
  const groups = b.pinGroups || [];
  const pinMap = new Map(b.pins.map(p => [p.id, p]));

  const pinGroups = groups.map(g => ({
    id: g.id,
    name: g.name,
    pinTypeID: g.pinTypeID ?? null,
    pinTypeName: g.pinTypeName,
    matingConnector: g.matingConnector,
    hidden: g.hidden,
    pins: g.pinIds.map(pid => {
      const p = pinMap.get(pid);
      return {
        id: pid,
        number: p?.number || '',
        label: p?.label || '',
        hidden: p?.hidden
      };
    })
  }));

  const totalPins = pinGroups.reduce((sum, g) => sum + g.pins.length, 0);

  return {
    id: b.id,
    label: b.label,
    pinCount: totalPins,
    pinGroups,
    position: { ...b.position },
    rotation: b.rotation as 0 | 90 | 180 | 270,
    flipped: b.flipped,
    zIndex: b.zIndex,
    groupId: b.groupId,
    dbId: b.dbId,
    partId: b.partId,
    partName: b.partName,
    componentImage: b.primaryImage,
    showComponentImage: b.showPrimaryImage,
    pinoutDiagramImage: b.pinoutDiagramImage,
    showPinoutDiagram: b.showPinoutDiagram
  };
}

// --- Batch conversions ---

export function harnessDataToBlocks(data: HarnessData): HarnessBlock[] {
  const blocks: HarnessBlock[] = [];
  for (const c of data.connectors || []) blocks.push(connectorToBlock(c));
  for (const c of data.cables || []) blocks.push(cableToBlock(c));
  for (const c of data.components || []) blocks.push(componentToBlock(c));
  return blocks;
}

export function blocksToHarnessData(blocks: HarnessBlock[], data: HarnessData): HarnessData {
  const connectors: HarnessConnector[] = [];
  const cables: HarnessCable[] = [];
  const components: HarnessComponent[] = [];

  for (const b of blocks) {
    if (b.blockType === 'connector') connectors.push(blockToConnector(b));
    else if (b.blockType === 'cable') cables.push(blockToCable(b));
    else if (b.blockType === 'component') components.push(blockToComponent(b));
  }

  return { ...data, connectors, cables, components };
}

// --- Connection normalization ---

/**
 * Normalize a HarnessConnection to unified block+pin references.
 * The original connection fields are preserved for backward compat on save.
 */
export function normalizeConnection(
  conn: HarnessConnection,
  blocks: HarnessBlock[]
): NormalizedConnection {
  const norm: NormalizedConnection = { ...conn };

  // Resolve "from" endpoint
  if (conn.fromConnector && conn.fromPin) {
    norm.fromBlock = conn.fromConnector;
    // If it's a mating connection (not wire side), pin ID stays the same but
    // the canvas uses connectionType to differentiate
    norm.fromBlockPin = conn.fromPin;
  } else if (conn.fromCable && conn.fromWire) {
    norm.fromBlock = conn.fromCable;
    const side = conn.fromSide || 'left';
    norm.fromBlockPin = `${conn.fromWire}:${side === 'left' ? 'L' : 'R'}`;
  } else if (conn.fromComponent && conn.fromComponentPin) {
    norm.fromBlock = conn.fromComponent;
    norm.fromBlockPin = conn.fromComponentPin;
  }

  // Resolve "to" endpoint
  if (conn.toConnector && conn.toPin) {
    norm.toBlock = conn.toConnector;
    norm.toBlockPin = conn.toPin;
  } else if (conn.toCable && conn.toWire) {
    norm.toBlock = conn.toCable;
    const side = conn.toSide || 'right';
    norm.toBlockPin = `${conn.toWire}:${side === 'left' ? 'L' : 'R'}`;
  } else if (conn.toComponent && conn.toComponentPin) {
    norm.toBlock = conn.toComponent;
    norm.toBlockPin = conn.toComponentPin;
  }

  return norm;
}

/**
 * Denormalize a NormalizedConnection back to legacy HarnessConnection format.
 * Requires block lookup to determine element type for correct field mapping.
 */
export function denormalizeConnection(
  norm: NormalizedConnection,
  blockMap: Map<string, HarnessBlock>
): HarnessConnection {
  const conn: HarnessConnection = {
    id: norm.id,
    connectionType: norm.connectionType,
    color: norm.color,
    label: norm.label,
    gauge: norm.gauge,
    lengthMm: norm.lengthMm,
    labelPosition: norm.labelPosition,
    waypoints: norm.waypoints,
    fromTermination: norm.fromTermination,
    toTermination: norm.toTermination,
    groupId: norm.groupId
  };

  // "from" endpoint
  if (norm.fromBlock && norm.fromBlockPin) {
    const block = blockMap.get(norm.fromBlock);
    if (block) {
      if (block.blockType === 'connector') {
        conn.fromConnector = norm.fromBlock;
        conn.fromPin = norm.fromBlockPin;
      } else if (block.blockType === 'cable') {
        conn.fromCable = norm.fromBlock;
        // Parse pin ID back to wire ID + side
        const { wireId, side } = parseCablePinId(norm.fromBlockPin);
        conn.fromWire = wireId;
        conn.fromSide = side;
      } else if (block.blockType === 'component') {
        conn.fromComponent = norm.fromBlock;
        conn.fromComponentPin = norm.fromBlockPin;
      }
    }
  }

  // "to" endpoint
  if (norm.toBlock && norm.toBlockPin) {
    const block = blockMap.get(norm.toBlock);
    if (block) {
      if (block.blockType === 'connector') {
        conn.toConnector = norm.toBlock;
        conn.toPin = norm.toBlockPin;
      } else if (block.blockType === 'cable') {
        conn.toCable = norm.toBlock;
        const { wireId, side } = parseCablePinId(norm.toBlockPin);
        conn.toWire = wireId;
        conn.toSide = side;
      } else if (block.blockType === 'component') {
        conn.toComponent = norm.toBlock;
        conn.toComponentPin = norm.toBlockPin;
      }
    }
  }

  // Preserve sub-harness fields as-is
  if (norm.fromSubHarness) conn.fromSubHarness = norm.fromSubHarness;
  if (norm.fromSubConnector) conn.fromSubConnector = norm.fromSubConnector;
  if (norm.toSubHarness) conn.toSubHarness = norm.toSubHarness;
  if (norm.toSubConnector) conn.toSubConnector = norm.toSubConnector;

  return conn;
}

/**
 * Get the block ID that a connection endpoint references.
 * Works with raw HarnessConnection (before normalization).
 */
export function getConnectionBlockId(
  conn: HarnessConnection,
  endpoint: 'from' | 'to'
): string | undefined {
  if (endpoint === 'from') {
    return conn.fromConnector || conn.fromCable || conn.fromComponent || undefined;
  } else {
    return conn.toConnector || conn.toCable || conn.toComponent || undefined;
  }
}

// --- Helpers ---

function generateDefaultPins(count: number): HarnessPin[] {
  const pins: HarnessPin[] = [];
  for (let i = 0; i < count; i++) {
    pins.push({ id: `pin-${i + 1}`, number: String(i + 1), label: '' });
  }
  return pins;
}

function parseCablePinId(pinId: string): { wireId: string; side: 'left' | 'right' } {
  if (pinId.endsWith(':L')) {
    return { wireId: pinId.slice(0, -2), side: 'left' };
  } else if (pinId.endsWith(':R')) {
    return { wireId: pinId.slice(0, -2), side: 'right' };
  }
  // Fallback: treat as left side
  return { wireId: pinId, side: 'left' };
}
