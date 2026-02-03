// Sub-harness element rendering and hit testing
// Sub-harnesses are always shown fully expanded with all their child elements visible
import { SubHarnessRef, WireHarness, HarnessConnector, HarnessCable, HarnessComponent, HarnessConnection, HarnessData } from '../../../models/harness.model';
import {
  ROW_HEIGHT,
  HEADER_HEIGHT,
  PIN_CIRCLE_RADIUS,
  CABLE_WIRE_SPACING
} from '../constants';
import { PinPosition, ElementDimensions } from '../types';
import { roundRect } from '../drawing-utils';
import { worldToLocal } from '../transform-utils';
// Note: COLORS, drawSelectionHighlight, drawElementBody, drawElementHeader available from './base-element' if needed
import { drawConnector, getConnectorPinPositions, getConnectorDimensions } from './connector';
import { drawCable, getCableWirePositions, getCableDimensions } from './cable';
import { drawComponent, getComponentPinPositions, getComponentDimensions } from './component';
import { drawWire } from '../wire';

// Sub-harness colors
const SUB_HARNESS_COLORS = {
  border: '#9c27b0',        // Purple border for sub-harness boundary
  borderSelected: '#ce93d8', // Lighter purple when selected
  labelBg: '#7b1fa2',       // Purple background for label
  labelText: '#ffffff'
};

export interface SubHarnessDimensions extends ElementDimensions {
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface SubHarnessPinPosition extends PinPosition {
  connectorId: string;
  connectorPinId: string;
}

/**
 * Get dimensions for a sub-harness (bounding box of all child elements)
 */
export function getSubHarnessDimensions(
  _subHarnessRef: SubHarnessRef,
  childHarness: WireHarness | undefined
): SubHarnessDimensions {
  const defaultBounds = { minX: 0, minY: 0, maxX: 150, maxY: 80 };

  if (!childHarness?.harnessData) {
    return { width: 150, height: 80, bounds: defaultBounds };
  }

  const bounds = calculateChildBounds(childHarness);

  return {
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
    bounds
  };
}

/**
 * Get the visual bounds of a connector in world coordinates
 * Uses same calculation as exportAsPNG for consistency
 */
function getConnectorVisualBounds(connector: HarnessConnector): { minX: number; minY: number; maxX: number; maxY: number } {
  if (!connector.position) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  const dims = getConnectorDimensions(connector);
  const x = connector.position.x;
  const y = connector.position.y;

  const pinCount = connector.pins?.length || connector.pinCount || 1;
  const headerAndExtras = dims.height - (pinCount * ROW_HEIGHT);

  // Position is at first pin center (y - ROW_HEIGHT/2 is the origin for drawing)
  return {
    minX: x,
    minY: y - ROW_HEIGHT / 2 - headerAndExtras,
    maxX: x + dims.width,
    maxY: y - ROW_HEIGHT / 2 + pinCount * ROW_HEIGHT
  };
}

/**
 * Get the visual bounds of a cable in world coordinates
 * Uses same calculation as exportAsPNG for consistency
 */
function getCableVisualBounds(cable: HarnessCable): { minX: number; minY: number; maxX: number; maxY: number } {
  if (!cable.position) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  const dims = getCableDimensions(cable);
  const x = cable.position.x;
  const y = cable.position.y;

  const wireCount = cable.wires?.length || cable.wireCount || 1;
  const headerAndExtras = dims.height - (wireCount * CABLE_WIRE_SPACING);

  // Position is at first wire center
  // Top is position minus header/extras minus half wire spacing
  // Bottom is position plus remaining wires
  return {
    minX: x,
    minY: y - headerAndExtras - CABLE_WIRE_SPACING / 2,
    maxX: x + dims.width,
    maxY: y + (wireCount - 0.5) * CABLE_WIRE_SPACING
  };
}

/**
 * Get the visual bounds of a component in world coordinates
 * Component position is at first pin center, similar to connector
 * Uses same calculation as exportAsPNG for consistency
 */
function getComponentVisualBounds(component: HarnessComponent): { minX: number; minY: number; maxX: number; maxY: number } {
  if (!component.position) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  const dims = getComponentDimensions(component);
  const x = component.position.x;
  const y = component.position.y;

  // Calculate total pins across all pin groups
  let totalPins = 0;
  for (const group of component.pinGroups || []) {
    totalPins += group.pins?.length || 0;
  }
  totalPins = Math.max(totalPins, 1);

  // Header and extras height (everything above the pins)
  const headerAndExtras = dims.height - (totalPins * ROW_HEIGHT);

  // Position is at first pin center (y - ROW_HEIGHT/2 is the origin for drawing)
  // Top of component is origin minus header/extras
  // Bottom is origin plus all pin rows
  return {
    minX: x,
    minY: y - ROW_HEIGHT / 2 - headerAndExtras,
    maxX: x + dims.width,
    maxY: y - ROW_HEIGHT / 2 + totalPins * ROW_HEIGHT
  };
}

/**
 * Calculate bounding box of all elements in a child harness
 */
function calculateChildBounds(childHarness: WireHarness): { minX: number; minY: number; maxX: number; maxY: number } {
  const data = childHarness.harnessData;
  if (!data) {
    return { minX: 0, minY: 0, maxX: 150, maxY: 80 };
  }

  const connectors = data.connectors || [];
  const cables = data.cables || [];
  const components = data.components || [];

  if (connectors.length === 0 && cables.length === 0 && components.length === 0) {
    return { minX: 0, minY: 0, maxX: 150, maxY: 80 };
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  // Include connectors
  for (const connector of connectors) {
    const bounds = getConnectorVisualBounds(connector);
    minX = Math.min(minX, bounds.minX);
    minY = Math.min(minY, bounds.minY);
    maxX = Math.max(maxX, bounds.maxX);
    maxY = Math.max(maxY, bounds.maxY);
  }

  // Include cables
  for (const cable of cables) {
    if (!cable.position) continue;
    const bounds = getCableVisualBounds(cable);
    minX = Math.min(minX, bounds.minX);
    minY = Math.min(minY, bounds.minY);
    maxX = Math.max(maxX, bounds.maxX);
    maxY = Math.max(maxY, bounds.maxY);
  }

  // Include components
  for (const component of components) {
    const bounds = getComponentVisualBounds(component);
    minX = Math.min(minX, bounds.minX);
    minY = Math.min(minY, bounds.minY);
    maxX = Math.max(maxX, bounds.maxX);
    maxY = Math.max(maxY, bounds.maxY);
  }

  // Add padding
  const padding = 15;
  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding
  };
}

/**
 * Draw a sub-harness showing all its child elements
 */
export function drawSubHarnessCollapsed(
  ctx: CanvasRenderingContext2D,
  subHarnessRef: SubHarnessRef,
  childHarness: WireHarness | undefined,
  isSelected: boolean = false,
  loadedImages?: Map<string, HTMLImageElement>,
  highlightedPins?: Map<string, Set<string>>,
  highlightedMatingPins?: Map<string, Set<string>>
): void {
  const x = subHarnessRef.position?.x || 0;
  const y = subHarnessRef.position?.y || 0;
  const rotation = subHarnessRef.rotation || 0;
  const flipped = subHarnessRef.flipped || false;

  ctx.save();

  // Transform to sub-harness position
  ctx.translate(x, y);
  ctx.rotate((rotation * Math.PI) / 180);
  if (flipped) {
    ctx.scale(-1, 1);
  }

  // Draw loading placeholder if no data yet
  if (!childHarness?.harnessData) {
    ctx.fillStyle = SUB_HARNESS_COLORS.labelBg;
    ctx.fillRect(0, 0, 120, 40);
    ctx.fillStyle = SUB_HARNESS_COLORS.labelText;
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Loading...', 60, 20);
    ctx.restore();
    return;
  }

  const { bounds } = getSubHarnessDimensions(subHarnessRef, childHarness);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;

  // Draw selection highlight / border
  ctx.strokeStyle = isSelected ? SUB_HARNESS_COLORS.borderSelected : SUB_HARNESS_COLORS.border;
  ctx.lineWidth = isSelected ? 3 : 2;
  ctx.setLineDash([8, 4]);
  roundRect(ctx, bounds.minX, bounds.minY, width, height, 8);
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw label at top (inside the border)
  const revision = childHarness.revision || 'A';
  const labelText = `${childHarness.name} Rev ${revision}`;
  ctx.font = 'bold 12px monospace';
  const labelWidth = ctx.measureText(labelText).width + 16;
  const labelX = bounds.minX;
  const labelY = bounds.minY;

  // Label background
  ctx.fillStyle = SUB_HARNESS_COLORS.labelBg;
  roundRect(ctx, labelX, labelY, labelWidth, 12, 4);
  ctx.fill();

  // Label text
  ctx.fillStyle = SUB_HARNESS_COLORS.labelText;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(labelText, labelX + 8, labelY + 6);

  // Draw release state indicator in top-right corner
  if (childHarness.releaseState === 'released') {
    const releasedText = 'RELEASED';
    ctx.font = 'bold 10px monospace';
    const textWidth = ctx.measureText(releasedText).width;
    const badgeWidth = textWidth + 24; // Extra space for padlock icon
    const badgeX = bounds.maxX - badgeWidth;
    const badgeY = bounds.minY;

    // Released badge background (green)
    ctx.fillStyle = '#388e3c';
    roundRect(ctx, badgeX, badgeY, badgeWidth, 14, 4);
    ctx.fill();

    // Draw padlock icon
    const lockX = badgeX + 6;
    const lockY = badgeY + 7;
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    // Lock body
    ctx.fillRect(lockX, lockY - 2, 6, 5);
    // Lock shackle (arch)
    ctx.beginPath();
    ctx.arc(lockX + 3, lockY - 2, 2.5, Math.PI, 0, false);
    ctx.stroke();

    // Released badge text
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(releasedText, badgeX + 16, badgeY + 7);
  } else if (childHarness.releaseState === 'review') {
    const reviewText = 'IN REVIEW';
    ctx.font = 'bold 10px monospace';
    const textWidth = ctx.measureText(reviewText).width;
    const badgeWidth = textWidth + 24; // Extra space for padlock icon
    const badgeX = bounds.maxX - badgeWidth;
    const badgeY = bounds.minY;

    // Review badge background (orange/yellow)
    ctx.fillStyle = '#f9a825';
    roundRect(ctx, badgeX, badgeY, badgeWidth, 14, 4);
    ctx.fill();

    // Draw padlock icon
    const lockX = badgeX + 6;
    const lockY = badgeY + 7;
    ctx.strokeStyle = '#000000';
    ctx.fillStyle = '#000000';
    ctx.lineWidth = 1.5;
    // Lock body
    ctx.fillRect(lockX, lockY - 2, 6, 5);
    // Lock shackle (arch)
    ctx.beginPath();
    ctx.arc(lockX + 3, lockY - 2, 2.5, Math.PI, 0, false);
    ctx.stroke();

    // Review badge text
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(reviewText, badgeX + 16, badgeY + 7);
  }

  // Draw all child elements at their positions
  const data = childHarness.harnessData;

  // Draw wires first (behind everything)
  drawSubHarnessWires(ctx, data);

  // Draw cables
  for (const cable of data.cables || []) {
    if (cable.position) {
      drawCable(ctx, cable, false, loadedImages);
    }
  }

  // Draw connectors
  for (const connector of data.connectors || []) {
    const connHighlight = highlightedPins?.get(connector.id);
    const connMatingHighlight = highlightedMatingPins?.get(connector.id);
    drawConnector(ctx, connector, false, loadedImages, connHighlight, connMatingHighlight);
  }

  // Draw components
  for (const component of data.components || []) {
    drawComponent(ctx, component, false, loadedImages);
  }

  ctx.restore();
}

/**
 * Edit mode selection state for sub-harness children
 */
export interface SubHarnessEditState {
  selectedConnectorId?: string | null;
  selectedCableId?: string | null;
  selectedComponentId?: string | null;
  selectedConnectionId?: string | null;
  isNodeEditMode?: boolean;
}

/**
 * Draw a sub-harness in edit mode with selection highlighting and node editing support
 */
export function drawSubHarnessEditMode(
  ctx: CanvasRenderingContext2D,
  subHarnessRef: SubHarnessRef,
  childHarness: WireHarness | undefined,
  editState: SubHarnessEditState,
  loadedImages?: Map<string, HTMLImageElement>
): void {
  const x = subHarnessRef.position?.x || 0;
  const y = subHarnessRef.position?.y || 0;
  const rotation = subHarnessRef.rotation || 0;
  const flipped = subHarnessRef.flipped || false;

  ctx.save();

  // Transform to sub-harness position
  ctx.translate(x, y);
  ctx.rotate((rotation * Math.PI) / 180);
  if (flipped) {
    ctx.scale(-1, 1);
  }

  // Draw loading placeholder if no data yet
  if (!childHarness?.harnessData) {
    ctx.fillStyle = SUB_HARNESS_COLORS.labelBg;
    ctx.fillRect(0, 0, 120, 40);
    ctx.fillStyle = SUB_HARNESS_COLORS.labelText;
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Loading...', 60, 20);
    ctx.restore();
    return;
  }

  const { bounds } = getSubHarnessDimensions(subHarnessRef, childHarness);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;

  // Draw selection highlight / border (always selected in edit mode)
  ctx.strokeStyle = SUB_HARNESS_COLORS.borderSelected;
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 4]);
  roundRect(ctx, bounds.minX, bounds.minY, width, height, 8);
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw label at top (inside the border)
  const revision = childHarness.revision || 'A';
  const labelText = `${childHarness.name} Rev ${revision}`;
  ctx.font = 'bold 12px monospace';
  const labelWidth = ctx.measureText(labelText).width + 16;
  const labelX = bounds.minX;
  const labelY = bounds.minY;

  // Label background
  ctx.fillStyle = SUB_HARNESS_COLORS.labelBg;
  roundRect(ctx, labelX, labelY, labelWidth, 12, 4);
  ctx.fill();

  // Label text
  ctx.fillStyle = SUB_HARNESS_COLORS.labelText;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(labelText, labelX + 8, labelY + 6);

  // Draw all child elements at their positions with selection state
  const data = childHarness.harnessData;

  // Draw wires first (behind everything) with selection and node edit support
  drawSubHarnessWiresEditMode(ctx, data, editState);

  // Draw cables with selection highlighting
  for (const cable of data.cables || []) {
    if (cable.position) {
      const isSelected = cable.id === editState.selectedCableId;
      drawCable(ctx, cable, isSelected, loadedImages);
    }
  }

  // Draw connectors with selection highlighting
  for (const connector of data.connectors || []) {
    const isSelected = connector.id === editState.selectedConnectorId;
    drawConnector(ctx, connector, isSelected, loadedImages);
  }

  // Draw components with selection highlighting
  for (const component of data.components || []) {
    const isSelected = component.id === editState.selectedComponentId;
    drawComponent(ctx, component, isSelected, loadedImages);
  }

  ctx.restore();
}

/**
 * Draw wires for a sub-harness with edit mode support (selection and control points)
 */
function drawSubHarnessWiresEditMode(
  ctx: CanvasRenderingContext2D,
  data: HarnessData,
  editState: SubHarnessEditState
): void {
  const gridSize = 20; // Default grid size

  for (const connection of data.connections || []) {
    let fromPos: { x: number; y: number } | null = null;
    let toPos: { x: number; y: number } | null = null;
    let wireColor = 'BK';

    // Get from position
    if (connection.fromConnector && connection.fromPin) {
      const fromConnector = data.connectors.find(c => c.id === connection.fromConnector);
      if (fromConnector) {
        const pins = getConnectorPinPositions(fromConnector);
        const pin = pins.find(p => p.pinId === connection.fromPin);
        if (pin) fromPos = pin;
      }
    } else if (connection.fromCable && connection.fromWire && connection.fromSide) {
      const fromCable = data.cables.find(c => c.id === connection.fromCable);
      if (fromCable) {
        const wires = getCableWirePositions(fromCable);
        const wire = wires.find(w => w.wireId === connection.fromWire && w.side === connection.fromSide);
        if (wire) {
          fromPos = wire;
          const cableWire = fromCable.wires.find(w => w.id === connection.fromWire);
          if (cableWire) wireColor = cableWire.colorCode || cableWire.color || 'BK';
        }
      }
    } else if (connection.fromComponent && connection.fromComponentPin) {
      const fromComponent = (data.components || []).find(c => c.id === connection.fromComponent);
      if (fromComponent) {
        const pins = getComponentPinPositions(fromComponent);
        const pin = pins.find(p => p.pinId === connection.fromComponentPin);
        if (pin) fromPos = pin;
      }
    }

    // Get to position
    if (connection.toConnector && connection.toPin) {
      const toConnector = data.connectors.find(c => c.id === connection.toConnector);
      if (toConnector) {
        const pins = getConnectorPinPositions(toConnector);
        const pin = pins.find(p => p.pinId === connection.toPin);
        if (pin) toPos = pin;
      }
    } else if (connection.toCable && connection.toWire && connection.toSide) {
      const toCable = data.cables.find(c => c.id === connection.toCable);
      if (toCable) {
        const wires = getCableWirePositions(toCable);
        const wire = wires.find(w => w.wireId === connection.toWire && w.side === connection.toSide);
        if (wire) {
          toPos = wire;
          if (wireColor === 'BK') {
            const cableWire = toCable.wires.find(w => w.id === connection.toWire);
            if (cableWire) wireColor = cableWire.colorCode || cableWire.color || 'BK';
          }
        }
      }
    } else if (connection.toComponent && connection.toComponentPin) {
      const toComponent = (data.components || []).find(c => c.id === connection.toComponent);
      if (toComponent) {
        const pins = getComponentPinPositions(toComponent);
        const pin = pins.find(p => p.pinId === connection.toComponentPin);
        if (pin) toPos = pin;
      }
    }

    // Draw the wire if we have both endpoints
    if (fromPos && toPos) {
      if (connection.color) {
        wireColor = connection.color;
      }
      const isSelected = connection.id === editState.selectedConnectionId;
      // Show control points only in nodeEdit mode when wire is selected
      const showControlPoints = editState.isNodeEditMode && isSelected;
      drawWire(ctx, connection, fromPos, toPos, wireColor, isSelected, gridSize, undefined, [], showControlPoints);
    }
  }
}

/**
 * Draw wires for a sub-harness's internal connections
 */
function drawSubHarnessWires(ctx: CanvasRenderingContext2D, data: HarnessData): void {
  const gridSize = 20; // Default grid size

  for (const connection of data.connections || []) {
    let fromPos: { x: number; y: number } | null = null;
    let toPos: { x: number; y: number } | null = null;
    let wireColor = 'BK';

    // Get from position
    if (connection.fromConnector && connection.fromPin) {
      const fromConnector = data.connectors.find(c => c.id === connection.fromConnector);
      if (fromConnector) {
        const pins = getConnectorPinPositions(fromConnector);
        const pin = pins.find(p => p.pinId === connection.fromPin);
        if (pin) fromPos = pin;
      }
    } else if (connection.fromCable && connection.fromWire && connection.fromSide) {
      const fromCable = data.cables.find(c => c.id === connection.fromCable);
      if (fromCable) {
        const wires = getCableWirePositions(fromCable);
        const wire = wires.find(w => w.wireId === connection.fromWire && w.side === connection.fromSide);
        if (wire) {
          fromPos = wire;
          const cableWire = fromCable.wires.find(w => w.id === connection.fromWire);
          if (cableWire) wireColor = cableWire.colorCode || cableWire.color || 'BK';
        }
      }
    } else if (connection.fromComponent && connection.fromComponentPin) {
      const fromComponent = (data.components || []).find(c => c.id === connection.fromComponent);
      if (fromComponent) {
        const pins = getComponentPinPositions(fromComponent);
        const pin = pins.find(p => p.pinId === connection.fromComponentPin);
        if (pin) fromPos = pin;
      }
    }

    // Get to position
    if (connection.toConnector && connection.toPin) {
      const toConnector = data.connectors.find(c => c.id === connection.toConnector);
      if (toConnector) {
        const pins = getConnectorPinPositions(toConnector);
        const pin = pins.find(p => p.pinId === connection.toPin);
        if (pin) toPos = pin;
      }
    } else if (connection.toCable && connection.toWire && connection.toSide) {
      const toCable = data.cables.find(c => c.id === connection.toCable);
      if (toCable) {
        const wires = getCableWirePositions(toCable);
        const wire = wires.find(w => w.wireId === connection.toWire && w.side === connection.toSide);
        if (wire) {
          toPos = wire;
          if (wireColor === 'BK') {
            const cableWire = toCable.wires.find(w => w.id === connection.toWire);
            if (cableWire) wireColor = cableWire.colorCode || cableWire.color || 'BK';
          }
        }
      }
    } else if (connection.toComponent && connection.toComponentPin) {
      const toComponent = (data.components || []).find(c => c.id === connection.toComponent);
      if (toComponent) {
        const pins = getComponentPinPositions(toComponent);
        const pin = pins.find(p => p.pinId === connection.toComponentPin);
        if (pin) toPos = pin;
      }
    }

    // Draw the wire if we have both endpoints
    if (fromPos && toPos) {
      if (connection.color) {
        wireColor = connection.color;
      }
      drawWire(ctx, connection, fromPos, toPos, wireColor, false, gridSize);
    }
  }
}


/**
 * Get pin positions for a sub-harness (for wire connections)
 * Returns actual pin positions from all child connectors, transformed by sub-harness position
 * @param side - 'wire' for wire-side pins, 'mating' for mating-side pins
 */
export function getSubHarnessPinPositions(
  subHarnessRef: SubHarnessRef,
  childHarness: WireHarness | undefined,
  side: 'wire' | 'mating' = 'wire'
): SubHarnessPinPosition[] {
  if (!childHarness?.harnessData) return [];

  const x = subHarnessRef.position?.x || 0;
  const y = subHarnessRef.position?.y || 0;
  const rotation = subHarnessRef.rotation || 0;
  const flipped = subHarnessRef.flipped || false;

  const connectors = childHarness.harnessData.connectors || [];
  const positions: SubHarnessPinPosition[] = [];

  // Return actual pin positions from child connectors
  for (const connector of connectors) {
    const connectorPins = getConnectorPinPositions(connector, side);
    for (const pin of connectorPins) {
      // Transform pin position by sub-harness transform
      let localX = pin.x;
      let localY = pin.y;

      if (flipped) {
        localX = -localX;
      }

      const rad = (rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const rotatedX = localX * cos - localY * sin;
      const rotatedY = localX * sin + localY * cos;

      positions.push({
        pinId: `${subHarnessRef.id}:${connector.id}:${pin.pinId}`,
        connectorId: connector.id,
        connectorPinId: pin.pinId,
        x: x + rotatedX,
        y: y + rotatedY
      });
    }
  }

  return positions;
}

/**
 * Hit test for sub-harness body (bounding box of all child elements)
 */
export function hitTestSubHarness(
  subHarnessRef: SubHarnessRef,
  childHarness: WireHarness | undefined,
  testX: number,
  testY: number
): boolean {
  const x = subHarnessRef.position?.x || 0;
  const y = subHarnessRef.position?.y || 0;
  const rotation = subHarnessRef.rotation || 0;
  const flipped = subHarnessRef.flipped || false;

  const { bounds } = getSubHarnessDimensions(subHarnessRef, childHarness);

  // Transform test point to local space
  const local = worldToLocal(testX, testY, {
    ox: x,
    oy: y,
    rotation,
    flipped,
    width: bounds.maxX - bounds.minX
  });

  // Test against the bounding box
  return local.x >= bounds.minX && local.x <= bounds.maxX &&
    local.y >= bounds.minY && local.y <= bounds.maxY;
}

/**
 * Hit test for sub-harness pins
 * Returns the pin position info if a pin is hit, null otherwise
 * @param side - 'wire' for wire-side pins, 'mating' for mating-side pins
 */
export function hitTestSubHarnessPin(
  subHarnessRef: SubHarnessRef,
  childHarness: WireHarness | undefined,
  testX: number,
  testY: number,
  side: 'wire' | 'mating' = 'wire'
): SubHarnessPinPosition | null {
  const pinPositions = getSubHarnessPinPositions(subHarnessRef, childHarness, side);

  // Use larger hit radius for mating pins (they're 4px squares vs 5px radius circles)
  const hitRadius = side === 'wire' ? PIN_CIRCLE_RADIUS + 6 : PIN_CIRCLE_RADIUS + 8;

  for (const pin of pinPositions) {
    const dist = Math.sqrt(Math.pow(testX - pin.x, 2) + Math.pow(testY - pin.y, 2));
    if (dist <= hitRadius) {
      return pin;
    }
  }

  return null;
}
