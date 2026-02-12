// Connector element rendering and hit testing
import { HarnessConnector, HarnessPin } from '../../../models/harness.model';
import {
  ROW_HEIGHT,
  HEADER_HEIGHT,
  PIN_COL_WIDTH,
  PIN_CIRCLE_RADIUS,
  EXPAND_BUTTON_SIZE,
  CONNECTOR_IMAGE_WIDTH,
  CONNECTOR_IMAGE_MAX_HEIGHT,
  PINOUT_IMAGE_WIDTH,
  PINOUT_IMAGE_HEIGHT,
  ELEMENT_DEFAULT_WIDTH
} from '../constants';
import { ConnectorDimensions, PinPosition, CentroidOffset } from '../types';
import { roundRect, drawExpandButton } from '../drawing-utils';
import { worldToLocal } from '../transform-utils';
import {
  COLORS,
  drawSelectionHighlight,
  drawElementBody,
  drawElementHeader,
  drawPartNameRow,
  drawPinRow,
  drawPinCircle,
  drawPinoutDiagram,
  drawInlineImage
} from './base-element';

// Connector type colors
const CONNECTOR_COLORS = {
  male: '#1565c0',
  female: '#c62828',
  splice: '#2e7d32',
  default: '#455a64'
};

// Mating point constants
const MATING_POINT_SIZE = 4;  // Square size for mating points

/**
 * Get the header color based on connector type
 */
function getConnectorHeaderColor(type: string | undefined): string {
  if (type === 'male') return CONNECTOR_COLORS.male;
  if (type === 'female') return CONNECTOR_COLORS.female;
  if (type === 'splice') return CONNECTOR_COLORS.splice;
  return CONNECTOR_COLORS.default;
}

/**
 * Draw a mating point (square) for connector-to-connector connections
 */
function drawMatingPoint(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  fillColor: string,
  highlighted: boolean = false
): void {
  ctx.fillStyle = highlighted ? '#ffeb3b' : fillColor;  // Yellow when highlighted
  ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = highlighted ? '#ff9800' : '#ffffff';  // Orange stroke when highlighted
  ctx.lineWidth = highlighted ? 2 : 1;
  ctx.strokeRect(x, y, size, size);
}

/**
 * Generate default pins if none are provided
 */
function generateDefaultPins(count: number): HarnessPin[] {
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

/**
 * Calculate connector dimensions
 */
export function getConnectorDimensions(connector: HarnessConnector): ConnectorDimensions {
  const pinCount = connector.pins?.length || connector.pinCount || 1;
  const hasPartName = !!connector.partName;
  const hasConnectorImage = !!connector.showConnectorImage && !!connector.connectorImage;
  const connectorImageHeight = hasConnectorImage ? CONNECTOR_IMAGE_MAX_HEIGHT : 0;

  // Fixed width matching cables and components
  const width = ELEMENT_DEFAULT_WIDTH;

  const height = HEADER_HEIGHT + connectorImageHeight + (hasPartName ? ROW_HEIGHT : 0) + (pinCount * ROW_HEIGHT);

  return { width, height, hasPartName, hasConnectorImage, connectorImageHeight };
}

/**
 * Draw a connector element on canvas
 */
export function drawConnector(
  ctx: CanvasRenderingContext2D,
  connector: HarnessConnector,
  isSelected: boolean = false,
  loadedImages?: Map<string, HTMLImageElement>,
  highlightedPinIds?: Set<string>,
  highlightedMatingPinIds?: Set<string>
): void {
  const { width, height, hasPartName, hasConnectorImage, connectorImageHeight } = getConnectorDimensions(connector);
  const x = connector.position?.x || 100;
  const y = connector.position?.y || 100;
  const rotation = connector.rotation || 0;
  const flipped = connector.flipped || false;

  const headerColor = getConnectorHeaderColor(connector.type);
  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;

  ctx.save();

  // Origin is at the first pin center (so pins land on grid lines)
  ctx.translate(x, y - ROW_HEIGHT / 2);
  ctx.rotate((rotation * Math.PI) / 180);

  // Flip around the center of the connector
  if (flipped) {
    const centerX = width / 2;
    const centerY = height / 2 - HEADER_HEIGHT - connectorImageHeight - partNameRowHeight - ROW_HEIGHT / 2;
    ctx.translate(centerX, centerY);
    ctx.scale(-1, 1);
    ctx.translate(-centerX, -centerY);
  }

  // Position relative to origin (top-left of first pin row)
  const left = 0;
  const top = -HEADER_HEIGHT - connectorImageHeight - partNameRowHeight;

  // Draw pinout diagram to the left if shown
  if (connector.showPinoutDiagram && connector.pinoutDiagramImage) {
    const pinoutImg = loadedImages?.get(`pinout-${connector.id}`);
    drawPinoutDiagram(ctx, pinoutImg, left, top, height, flipped);
  }

  // Draw selection highlight
  if (isSelected) {
    drawSelectionHighlight(ctx, left, top, width, height);
  }

  // Draw main body
  drawElementBody(ctx, left, top, width, height);

  // Draw header
  drawElementHeader(ctx, left, top, width, headerColor, connector.label || 'CONN', flipped);

  // Draw connector image section if shown
  if (hasConnectorImage && connector.connectorImage) {
    const connImg = loadedImages?.get(`connector-${connector.id}`);
    drawInlineImage(
      ctx, connImg, left, top + HEADER_HEIGHT, width,
      CONNECTOR_IMAGE_WIDTH, connectorImageHeight, flipped
    );
  }

  // Draw part name row if present
  if (hasPartName && connector.partName) {
    drawPartNameRow(ctx, left, top + HEADER_HEIGHT + connectorImageHeight, width, connector.partName, flipped);
  }

  // Draw pin rows
  const pinCount = connector.pins?.length || connector.pinCount || 1;
  const pins = connector.pins?.length > 0 ? connector.pins : generateDefaultPins(pinCount);

  pins.forEach((pin, index) => {
    const rowTop = top + HEADER_HEIGHT + connectorImageHeight + partNameRowHeight + (index * ROW_HEIGHT);
    const rowCenter = rowTop + ROW_HEIGHT / 2;

    // Draw pin row
    drawPinRow(
      ctx, left, rowTop, width,
      pin.number || String(index + 1),
      pin.label,
      index % 2 === 1,
      flipped,
      index > 0
    );

    // Check if this pin should be highlighted (wire or mating)
    const isPinHighlighted = highlightedPinIds?.has(pin.id) || false;
    const isMatingPinHighlighted = highlightedMatingPinIds?.has(pin.id) || false;

    // Wire connection point (circle on left side) - for wire connections
    const wireCircleX = left - PIN_CIRCLE_RADIUS;
    drawPinCircle(ctx, wireCircleX, rowCenter, PIN_CIRCLE_RADIUS, headerColor, isPinHighlighted);

    // Mating connection point (square on right side) - for connector-to-connector mating
    const matingX = left + width;
    drawMatingPoint(ctx, matingX, rowCenter - MATING_POINT_SIZE / 2, MATING_POINT_SIZE, headerColor, isMatingPinHighlighted);
  });

  // Draw expand buttons if images exist
  if (connector.connectorImage) {
    const connImgBtnX = left + width - EXPAND_BUTTON_SIZE - 2;
    const connImgBtnY = top + (HEADER_HEIGHT - EXPAND_BUTTON_SIZE) / 2;
    drawExpandButton(ctx, connImgBtnX, connImgBtnY, !!connector.showConnectorImage, flipped);
  }

  if (connector.pinoutDiagramImage) {
    const pinoutBtnX = left - EXPAND_BUTTON_SIZE - 4;
    const pinoutBtnY = top + (HEADER_HEIGHT - EXPAND_BUTTON_SIZE) / 2;  // Centered on header
    drawExpandButton(ctx, pinoutBtnX, pinoutBtnY, !!connector.showPinoutDiagram, flipped);
  }

  ctx.restore();
}

// Extended pin position that includes connection side
export interface ConnectorPinPosition extends PinPosition {
  side: 'wire' | 'mating';
}

/**
 * Get pin positions for a connector
 * @param connector The connector
 * @param side Which side to get positions for: 'wire' (default), 'mating', or 'both'
 */
export function getConnectorPinPositions(
  connector: HarnessConnector,
  side: 'wire' | 'mating' | 'both' = 'wire'
): PinPosition[] {
  const { width } = getConnectorDimensions(connector);
  const ox = connector.position?.x || 100;
  const oy = connector.position?.y || 100;
  const rotation = connector.rotation || 0;
  const flipped = connector.flipped || false;

  const pinCount = connector.pins?.length || connector.pinCount || 1;
  const pins = connector.pins?.length > 0 ? connector.pins : generateDefaultPins(pinCount);

  const positions: PinPosition[] = [];

  // Local coordinates are relative to the drawing origin at (ox, oy - ROW_HEIGHT/2)
  pins.forEach((pin, index) => {
    const rowCenter = index * ROW_HEIGHT + ROW_HEIGHT / 2;

    // Wire connection point (always left side)
    if (side === 'wire' || side === 'both') {
      let wireX = -PIN_CIRCLE_RADIUS;
      let wireY = rowCenter;

      if (flipped) {
        const centerX = width / 2;
        wireX = 2 * centerX - wireX;
      }

      const rad = (rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const rotatedWireX = wireX * cos - wireY * sin;
      const rotatedWireY = wireX * sin + wireY * cos;

      positions.push({
        pinId: pin.id,
        x: ox + rotatedWireX,
        y: (oy - ROW_HEIGHT / 2) + rotatedWireY
      });
    }

    // Mating connection point (always right side)
    if (side === 'mating' || side === 'both') {
      let matingX = width + MATING_POINT_SIZE / 2;
      let matingY = rowCenter;

      if (flipped) {
        const centerX = width / 2;
        matingX = 2 * centerX - matingX;
      }

      const rad = (rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const rotatedMatingX = matingX * cos - matingY * sin;
      const rotatedMatingY = matingX * sin + matingY * cos;

      positions.push({
        pinId: side === 'both' ? `${pin.id}:mating` : pin.id,
        x: ox + rotatedMatingX,
        y: (oy - ROW_HEIGHT / 2) + rotatedMatingY
      });
    }
  });

  return positions;
}

/**
 * Get all pin positions with side information
 */
export function getConnectorPinPositionsWithSide(connector: HarnessConnector): ConnectorPinPosition[] {
  const { width } = getConnectorDimensions(connector);
  const ox = connector.position?.x || 100;
  const oy = connector.position?.y || 100;
  const rotation = connector.rotation || 0;
  const flipped = connector.flipped || false;

  const pinCount = connector.pins?.length || connector.pinCount || 1;
  const pins = connector.pins?.length > 0 ? connector.pins : generateDefaultPins(pinCount);

  const positions: ConnectorPinPosition[] = [];

  // Local coordinates are relative to the drawing origin at (ox, oy - ROW_HEIGHT/2)
  pins.forEach((pin, index) => {
    const rowCenter = index * ROW_HEIGHT + ROW_HEIGHT / 2;
    const rad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    // Wire connection point
    // Wire connection point (always left side)
    let wireX = -PIN_CIRCLE_RADIUS;
    let wireY = rowCenter;
    if (flipped) {
      wireX = width - wireX;
    }
    const rotatedWireX = wireX * cos - wireY * sin;
    const rotatedWireY = wireX * sin + wireY * cos;

    positions.push({
      pinId: pin.id,
      x: ox + rotatedWireX,
      y: (oy - ROW_HEIGHT / 2) + rotatedWireY,
      side: 'wire'
    });

    // Mating connection point (always right side)
    let matingX = width + MATING_POINT_SIZE / 2;
    let matingY = rowCenter;
    if (flipped) {
      matingX = width - matingX;
    }
    const rotatedMatingX = matingX * cos - matingY * sin;
    const rotatedMatingY = matingX * sin + matingY * cos;

    positions.push({
      pinId: pin.id,
      x: ox + rotatedMatingX,
      y: (oy - ROW_HEIGHT / 2) + rotatedMatingY,
      side: 'mating'
    });
  });

  return positions;
}

/**
 * Get the centroid offset from the connector's stored position
 */
export function getConnectorCentroidOffset(connector: HarnessConnector): CentroidOffset {
  const { width, height, hasPartName, connectorImageHeight } = getConnectorDimensions(connector);
  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;

  const drawingTop = -HEADER_HEIGHT - connectorImageHeight - partNameRowHeight;
  const drawingBottom = drawingTop + height;

  const localCy = (drawingTop + drawingBottom) / 2;
  const cx = width / 2;
  const cy = localCy - ROW_HEIGHT / 2;

  return { cx, cy };
}

/**
 * Hit test for connector body
 */
export function hitTestConnector(
  connector: HarnessConnector,
  testX: number,
  testY: number
): boolean {
  const { width, hasPartName, connectorImageHeight } = getConnectorDimensions(connector);
  const ox = connector.position?.x || 100;
  const oy = connector.position?.y || 100;
  const rotation = connector.rotation || 0;
  const flipped = connector.flipped || false;

  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;
  const pinCount = connector.pins?.length || connector.pinCount || 1;

  // Transform to local space
  const local = worldToLocal(testX, testY, {
    ox, oy, rotation, flipped, width
  });

  // Hit area bounds relative to origin (first pin center)
  const left = -PIN_CIRCLE_RADIUS;
  const right = width + PIN_CIRCLE_RADIUS;
  const top = -HEADER_HEIGHT - connectorImageHeight - partNameRowHeight - ROW_HEIGHT / 2;
  const bottom = (pinCount - 1) * ROW_HEIGHT + ROW_HEIGHT / 2;

  return local.x >= left && local.x <= right &&
    local.y >= top && local.y <= bottom;
}

// Hit test result with side information
export interface ConnectorPinHitResult {
  pinId: string;
  side: 'wire' | 'mating';
}

/**
 * Hit test for connector pin (returns pin ID only, for backward compatibility)
 */
export function hitTestConnectorPin(
  connector: HarnessConnector,
  testX: number,
  testY: number
): string | null {
  const result = hitTestConnectorPinWithSide(connector, testX, testY);
  return result ? result.pinId : null;
}

/**
 * Hit test for connector pin with side information
 */
export function hitTestConnectorPinWithSide(
  connector: HarnessConnector,
  testX: number,
  testY: number
): ConnectorPinHitResult | null {
  const pinPositions = getConnectorPinPositionsWithSide(connector);

  for (const pin of pinPositions) {
    const hitRadius = pin.side === 'wire' ? PIN_CIRCLE_RADIUS + 6 : MATING_POINT_SIZE + 4;
    const dist = Math.sqrt(Math.pow(testX - pin.x, 2) + Math.pow(testY - pin.y, 2));
    if (dist <= hitRadius) {
      return {
        pinId: pin.pinId,
        side: pin.side
      };
    }
  }
  return null;
}

/**
 * Hit test for connector expand buttons
 */
export function hitTestConnectorButton(
  connector: HarnessConnector,
  testX: number,
  testY: number
): 'pinout' | 'connectorImage' | null {
  const { width, hasPartName, connectorImageHeight } = getConnectorDimensions(connector);
  const ox = connector.position?.x || 100;
  const oy = connector.position?.y || 100;
  const rotation = connector.rotation || 0;
  const flipped = connector.flipped || false;

  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;
  const pinCount = connector.pins?.length || connector.pinCount || 1;

  // Transform to local space
  const local = worldToLocal(testX, testY, {
    ox, oy, rotation, flipped, width
  });

  const left = 0;
  const top = -HEADER_HEIGHT - connectorImageHeight - partNameRowHeight - ROW_HEIGHT / 2;

  // Check connector image button
  if (connector.connectorImage) {
    const connImgBtnX = left + width - EXPAND_BUTTON_SIZE - 2;
    const connImgBtnY = top + (HEADER_HEIGHT - EXPAND_BUTTON_SIZE) / 2;

    if (local.x >= connImgBtnX && local.x <= connImgBtnX + EXPAND_BUTTON_SIZE &&
      local.y >= connImgBtnY && local.y <= connImgBtnY + EXPAND_BUTTON_SIZE) {
      return 'connectorImage';
    }
  }

  // Check pinout diagram button
  if (connector.pinoutDiagramImage) {
    const pinoutBtnX = left - EXPAND_BUTTON_SIZE - 4;
    const pinoutBtnY = top + (HEADER_HEIGHT - EXPAND_BUTTON_SIZE) / 2;  // Centered on header (matches drawing)

    if (local.x >= pinoutBtnX && local.x <= pinoutBtnX + EXPAND_BUTTON_SIZE &&
      local.y >= pinoutBtnY && local.y <= pinoutBtnY + EXPAND_BUTTON_SIZE) {
      return 'pinout';
    }
  }

  return null;
}
