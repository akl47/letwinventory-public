// Connector element rendering and hit testing
import { HarnessConnector, HarnessPin } from '../../../models/harness.model';
import {
  ROW_HEIGHT,
  HEADER_HEIGHT,
  PIN_COL_WIDTH,
  LABEL_COL_WIDTH,
  PIN_CIRCLE_RADIUS,
  EXPAND_BUTTON_SIZE,
  CONNECTOR_IMAGE_WIDTH,
  CONNECTOR_IMAGE_MAX_HEIGHT,
  PINOUT_IMAGE_WIDTH,
  PINOUT_IMAGE_HEIGHT
} from '../constants';
import { ConnectorDimensions, PinPosition, CentroidOffset } from '../types';
import { roundRect, drawExpandButton, calculateMaxLabelWidth } from '../drawing-utils';
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

  // Calculate label width based on longest label and part name
  const labels = connector.pins?.map(p => p.label) || [];
  let maxLabelWidth = calculateMaxLabelWidth(labels, '12px monospace', 16);
  maxLabelWidth = Math.max(maxLabelWidth, LABEL_COL_WIDTH);

  // Also consider part name width
  if (connector.partName) {
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx) {
      ctx.font = '11px monospace';
      const partNameWidth = ctx.measureText(connector.partName).width + 16;
      maxLabelWidth = Math.max(maxLabelWidth, partNameWidth - PIN_COL_WIDTH);
    }
  }

  let width = PIN_COL_WIDTH + maxLabelWidth;
  // Ensure width is at least enough for the connector image if shown
  if (hasConnectorImage) {
    width = Math.max(width, CONNECTOR_IMAGE_WIDTH + 4);
  }

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
  loadedImages?: Map<string, HTMLImageElement>
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

    // Wire connection point (circle on the side)
    const circleX = connector.type === 'male' ? left + width + PIN_CIRCLE_RADIUS : left - PIN_CIRCLE_RADIUS;
    drawPinCircle(ctx, circleX, rowCenter, PIN_CIRCLE_RADIUS, headerColor);
  });

  // Draw expand buttons if images exist
  if (connector.connectorImage) {
    const connImgBtnX = left + width - EXPAND_BUTTON_SIZE - 2;
    const connImgBtnY = top + (HEADER_HEIGHT - EXPAND_BUTTON_SIZE) / 2;
    drawExpandButton(ctx, connImgBtnX, connImgBtnY, !!connector.showConnectorImage, flipped);
  }

  if (connector.pinoutDiagramImage) {
    const pinAreaHeight = pinCount * ROW_HEIGHT;
    const pinoutBtnX = left - EXPAND_BUTTON_SIZE - 4;
    const pinoutBtnY = top + HEADER_HEIGHT + connectorImageHeight + partNameRowHeight + (pinAreaHeight / 2) - (EXPAND_BUTTON_SIZE / 2);
    drawExpandButton(ctx, pinoutBtnX, pinoutBtnY, !!connector.showPinoutDiagram, flipped);
  }

  ctx.restore();
}

/**
 * Get pin positions for a connector (wire connection points on the side)
 */
export function getConnectorPinPositions(connector: HarnessConnector): PinPosition[] {
  const { width } = getConnectorDimensions(connector);
  const ox = connector.position?.x || 100;
  const oy = connector.position?.y || 100;
  const rotation = connector.rotation || 0;
  const flipped = connector.flipped || false;

  const pinCount = connector.pins?.length || connector.pinCount || 1;
  const pins = connector.pins?.length > 0 ? connector.pins : generateDefaultPins(pinCount);

  return pins.map((pin, index) => {
    // Calculate local position relative to origin (first pin center)
    const rowCenter = index * ROW_HEIGHT;

    // Wire connection point is on the side based on connector type
    let localX = connector.type === 'male'
      ? width + PIN_CIRCLE_RADIUS
      : -PIN_CIRCLE_RADIUS;
    let localY = rowCenter;

    // Apply flip around center
    if (flipped) {
      const centerX = width / 2;
      localX = 2 * centerX - localX;
    }

    // Apply rotation
    const rad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rotatedX = localX * cos - localY * sin;
    const rotatedY = localX * sin + localY * cos;

    return {
      pinId: pin.id,
      x: ox + rotatedX,
      y: oy + rotatedY
    };
  });
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

/**
 * Hit test for connector pin
 */
export function hitTestConnectorPin(
  connector: HarnessConnector,
  testX: number,
  testY: number
): string | null {
  const pinPositions = getConnectorPinPositions(connector);

  for (const pin of pinPositions) {
    const dist = Math.sqrt(Math.pow(testX - pin.x, 2) + Math.pow(testY - pin.y, 2));
    if (dist <= PIN_CIRCLE_RADIUS + 6) {
      return pin.pinId;
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
    const pinoutBtnY = (pinCount - 1) * ROW_HEIGHT / 2 - (EXPAND_BUTTON_SIZE / 2);

    if (local.x >= pinoutBtnX && local.x <= pinoutBtnX + EXPAND_BUTTON_SIZE &&
      local.y >= pinoutBtnY && local.y <= pinoutBtnY + EXPAND_BUTTON_SIZE) {
      return 'pinout';
    }
  }

  return null;
}
