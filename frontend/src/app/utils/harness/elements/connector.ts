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
 * Origin = pin 0's wire connection point (the circle where wires attach)
 * Body draws to the right of pin 0, header/images above
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

  // Origin is at pin 0's wire connection point
  ctx.translate(x, y);
  ctx.rotate((rotation * Math.PI) / 180);

  // Flip around the center of the connector body
  if (flipped) {
    const bodyLeft = 0;
    const bodyRight = width;
    const centerX = (bodyLeft + bodyRight) / 2;
    const pinCount = connector.pins?.length || connector.pinCount || 1;
    const bodyTop = -ROW_HEIGHT / 2 - HEADER_HEIGHT - connectorImageHeight - partNameRowHeight;
    const bodyBottom = (pinCount - 1) * ROW_HEIGHT + ROW_HEIGHT / 2;
    const centerY = (bodyTop + bodyBottom) / 2;
    ctx.translate(centerX, centerY);
    ctx.scale(-1, 1);
    ctx.translate(-centerX, -centerY);
  }

  // Body starts at origin (pin 0 is at body edge). Circle extends left.
  const left = 0;
  const top = -ROW_HEIGHT / 2 - HEADER_HEIGHT - connectorImageHeight - partNameRowHeight;

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
    // Pin rows start at y=0 (pin 0) relative to origin
    const rowTop = index * ROW_HEIGHT - ROW_HEIGHT / 2;
    const rowCenter = index * ROW_HEIGHT; // Pin i center = i * ROW_HEIGHT

    // Draw pin row (inside the body)
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

    // Wire connection point (circle extends left from body edge)
    drawPinCircle(ctx, -PIN_CIRCLE_RADIUS, rowCenter, PIN_CIRCLE_RADIUS, headerColor, isPinHighlighted);

    // Mating connection point (square on right side of body)
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
    const pinoutBtnY = top + (HEADER_HEIGHT - EXPAND_BUTTON_SIZE) / 2;
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
 * Pin 0 is at local (0, 0), pin i at local (0, i * ROW_HEIGHT)
 * Origin = (ox, oy) = pin 0's wire connection point
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

  pins.forEach((pin, index) => {
    // Pin i center in local space: (0, i * ROW_HEIGHT)
    const pinLocalY = index * ROW_HEIGHT;

    // Wire connection point (at origin axis, x=0)
    if (side === 'wire' || side === 'both') {
      let wireX = 0;
      let wireY = pinLocalY;

      if (flipped) {
        const bodyLeft = 0;
        const bodyRight = width;
        const centerX = (bodyLeft + bodyRight) / 2;
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
        y: oy + rotatedWireY
      });
    }

    // Mating connection point (right side of body)
    if (side === 'mating' || side === 'both') {
      let matingX = width + MATING_POINT_SIZE / 2;
      let matingY = pinLocalY;

      if (flipped) {
        const bodyLeft = 0;
        const bodyRight = width;
        const centerX = (bodyLeft + bodyRight) / 2;
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
        y: oy + rotatedMatingY
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

  pins.forEach((pin, index) => {
    const pinLocalY = index * ROW_HEIGHT;
    const rad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    // Wire connection point (x=0 in local space)
    let wireX = 0;
    let wireY = pinLocalY;
    if (flipped) {
      const bodyLeft = 0;
      const bodyRight = width;
      const centerX = (bodyLeft + bodyRight) / 2;
      wireX = 2 * centerX - wireX;
    }
    const rotatedWireX = wireX * cos - wireY * sin;
    const rotatedWireY = wireX * sin + wireY * cos;

    positions.push({
      pinId: pin.id,
      x: ox + rotatedWireX,
      y: oy + rotatedWireY,
      side: 'wire'
    });

    // Mating connection point (right side of body)
    let matingX = width + MATING_POINT_SIZE / 2;
    let matingY = pinLocalY;
    if (flipped) {
      const bodyLeft = 0;
      const bodyRight = width;
      const centerX = (bodyLeft + bodyRight) / 2;
      matingX = 2 * centerX - matingX;
    }
    const rotatedMatingX = matingX * cos - matingY * sin;
    const rotatedMatingY = matingX * sin + matingY * cos;

    positions.push({
      pinId: pin.id,
      x: ox + rotatedMatingX,
      y: oy + rotatedMatingY,
      side: 'mating'
    });
  });

  return positions;
}

/**
 * Get the centroid offset from the connector's stored position (pin 0)
 */
export function getConnectorCentroidOffset(connector: HarnessConnector): CentroidOffset {
  const { width, height, hasPartName, connectorImageHeight } = getConnectorDimensions(connector);
  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;
  const pinCount = connector.pins?.length || connector.pinCount || 1;

  // Body goes from (PIN_CIRCLE_RADIUS, top) to (PIN_CIRCLE_RADIUS + width, bottom)
  // top = -HEADER_HEIGHT - connectorImageHeight - partNameRowHeight
  // bottom = (pinCount - 1) * ROW_HEIGHT
  const bodyTop = -HEADER_HEIGHT - connectorImageHeight - partNameRowHeight;
  const bodyBottom = (pinCount - 1) * ROW_HEIGHT;

  const cx = width / 2;
  const cy = (bodyTop + bodyBottom) / 2;

  return { cx, cy };
}

/**
 * Hit test for connector body
 * Origin = pin 0's wire connection point (ox, oy)
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

  // Transform to local space (origin at pin 0)
  const rad = (-rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = testX - ox;
  const dy = testY - oy;

  let localX = dx * cos - dy * sin;
  let localY = dx * sin + dy * cos;

  if (flipped) {
    const bodyLeft = 0;
    const bodyRight = width;
    const centerX = (bodyLeft + bodyRight) / 2;
    localX = 2 * centerX - localX;
  }

  // Hit area: from pin circle to mating point, header to last pin
  const left = -PIN_CIRCLE_RADIUS;
  const right = PIN_CIRCLE_RADIUS + width + PIN_CIRCLE_RADIUS;
  const top = -HEADER_HEIGHT - connectorImageHeight - partNameRowHeight - ROW_HEIGHT / 2;
  const bottom = (pinCount - 1) * ROW_HEIGHT + ROW_HEIGHT / 2;

  return localX >= left && localX <= right &&
    localY >= top && localY <= bottom;
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

  // Transform to local space (origin at pin 0)
  const rad = (-rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = testX - ox;
  const dy = testY - oy;

  let localX = dx * cos - dy * sin;
  let localY = dx * sin + dy * cos;

  if (flipped) {
    const bodyLeft = 0;
    const bodyRight = width;
    const centerX = (bodyLeft + bodyRight) / 2;
    localX = 2 * centerX - localX;
  }

  const left = PIN_CIRCLE_RADIUS;
  const top = -HEADER_HEIGHT - connectorImageHeight - partNameRowHeight;

  // Check connector image button
  if (connector.connectorImage) {
    const connImgBtnX = left + width - EXPAND_BUTTON_SIZE - 2;
    const connImgBtnY = top + (HEADER_HEIGHT - EXPAND_BUTTON_SIZE) / 2;

    if (localX >= connImgBtnX && localX <= connImgBtnX + EXPAND_BUTTON_SIZE &&
      localY >= connImgBtnY && localY <= connImgBtnY + EXPAND_BUTTON_SIZE) {
      return 'connectorImage';
    }
  }

  // Check pinout diagram button
  if (connector.pinoutDiagramImage) {
    const pinoutBtnX = left - EXPAND_BUTTON_SIZE - 4;
    const pinoutBtnY = top + (HEADER_HEIGHT - EXPAND_BUTTON_SIZE) / 2;

    if (localX >= pinoutBtnX && localX <= pinoutBtnX + EXPAND_BUTTON_SIZE &&
      localY >= pinoutBtnY && localY <= pinoutBtnY + EXPAND_BUTTON_SIZE) {
      return 'pinout';
    }
  }

  return null;
}
