// Native Canvas Renderer for Wire Harness
import { HarnessConnector, HarnessConnection, HarnessPin, HarnessCable, HarnessComponent, HarnessComponentPinGroup } from '../../models/harness.model';
import { getWireColorHex } from './wire-color-map';

// Constants for table-style connectors (aligned to 20px grid)
// Origin point is top-left corner of the first pin row
const ROW_HEIGHT = 20;
const HEADER_HEIGHT = 20;
const PIN_COL_WIDTH = 20;
const LABEL_COL_WIDTH = 80;
const WIRE_STROKE_WIDTH = 4;
const PIN_CIRCLE_RADIUS = 5;

// Constants for expand buttons and images
const EXPAND_BUTTON_SIZE = 16;
const CONNECTOR_IMAGE_WIDTH = 90;
const CONNECTOR_IMAGE_MAX_HEIGHT = 80;  // Max height for layout calculation
const PINOUT_IMAGE_WIDTH = 100;
const PINOUT_IMAGE_HEIGHT = 80;

// Constants for cable elements
const CABLE_DEFAULT_LENGTH = 100;
const CABLE_WIRE_SPACING = 20;
const CABLE_ENDPOINT_RADIUS = 6;
const CABLE_DIAGRAM_WIDTH = 100;
const CABLE_DIAGRAM_HEIGHT = 80;

export interface CanvasObject {
  type: 'connector' | 'wire';
  id: string;
  bounds: { x: number; y: number; width: number; height: number };
  data: HarnessConnector | HarnessConnection;
}

export interface PinPosition {
  pinId: string;
  x: number;
  y: number;
}

// Calculate connector dimensions (table style)
export function getConnectorDimensions(connector: HarnessConnector): {
  width: number;
  height: number;
  hasPartName: boolean;
  hasConnectorImage: boolean;
  connectorImageHeight: number;
} {
  const pinCount = connector.pins?.length || connector.pinCount || 1;
  const hasPartName = !!connector.partName;
  const hasConnectorImage = !!connector.showConnectorImage && !!connector.connectorImage;
  const connectorImageHeight = hasConnectorImage ? CONNECTOR_IMAGE_MAX_HEIGHT : 0;

  // Calculate label width based on longest label and part name
  let maxLabelWidth = LABEL_COL_WIDTH;
  const ctx = document.createElement('canvas').getContext('2d');
  if (ctx) {
    ctx.font = '12px monospace';
    if (connector.pins?.length) {
      connector.pins.forEach(pin => {
        if (pin.label) {
          const width = ctx.measureText(pin.label).width + 16;
          maxLabelWidth = Math.max(maxLabelWidth, width);
        }
      });
    }
    // Also consider part name width
    if (connector.partName) {
      ctx.font = '11px monospace';
      const partNameWidth = ctx.measureText(connector.partName).width + 16;
      maxLabelWidth = Math.max(maxLabelWidth, partNameWidth - PIN_COL_WIDTH);
    }
  }

  let width = PIN_COL_WIDTH + maxLabelWidth;
  // Ensure width is at least enough for the connector image if shown
  if (hasConnectorImage) {
    width = Math.max(width, CONNECTOR_IMAGE_WIDTH + 4);  // +4 for padding
  }
  // Add extra row height if part name exists, plus connector image height if shown
  const height = HEADER_HEIGHT + connectorImageHeight + (hasPartName ? ROW_HEIGHT : 0) + (pinCount * ROW_HEIGHT);

  return { width, height, hasPartName, hasConnectorImage, connectorImageHeight };
}

// Draw a connector on canvas (table style like WireViz)
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

  // Determine colors based on connector type
  const headerColor = connector.type === 'male' ? '#1565c0' :
    connector.type === 'female' ? '#c62828' :
      connector.type === 'splice' ? '#2e7d32' : '#455a64';
  const bodyColor = '#3a3a3a';
  const borderColor = '#555555';
  const textColor = '#e0e0e0';
  const pinBgColor = '#4a4a4a';

  // Calculate offset for part name row
  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;

  ctx.save();

  // Origin is at the first pin center (so pins land on grid lines)
  // Shift up by half a row height so pin centers align with grid
  ctx.translate(x, y - ROW_HEIGHT / 2);
  ctx.rotate((rotation * Math.PI) / 180);

  // Flip around the center of the connector (not the origin)
  if (flipped) {
    const centerX = width / 2;
    // Adjust centerY for the shifted origin (we're now at first pin center, not top of first pin row)
    const centerY = height / 2 - HEADER_HEIGHT - connectorImageHeight - partNameRowHeight - ROW_HEIGHT / 2;
    ctx.translate(centerX, centerY);
    ctx.scale(-1, 1);
    ctx.translate(-centerX, -centerY);
  }

  // Position relative to origin (top-left of first pin row)
  const left = 0;
  const top = -HEADER_HEIGHT - connectorImageHeight - partNameRowHeight;  // Header, image, and part name row are above the origin

  // Draw pinout diagram to the left if shown (flips to right side when connector is flipped)
  if (connector.showPinoutDiagram && connector.pinoutDiagramImage) {
    const pinoutImg = loadedImages?.get(`pinout-${connector.id}`);
    if (pinoutImg) {
      // Since the context is already flipped when connector.flipped is true,
      // we draw at left side in local coords - it will appear on opposite side in screen space
      const imgX = left - PINOUT_IMAGE_WIDTH - 10;
      const imgY = top + (height - PINOUT_IMAGE_HEIGHT) / 2;

      // Draw image background
      ctx.fillStyle = '#2a2a2a';
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      roundRect(ctx, imgX - 4, imgY - 4, PINOUT_IMAGE_WIDTH + 8, PINOUT_IMAGE_HEIGHT + 8, 4);
      ctx.fill();
      ctx.stroke();

      // Draw image - counter the flip so image content stays normal (not mirrored)
      ctx.save();
      if (flipped) {
        ctx.translate(imgX + PINOUT_IMAGE_WIDTH / 2, imgY + PINOUT_IMAGE_HEIGHT / 2);
        ctx.scale(-1, 1);
        ctx.translate(-(imgX + PINOUT_IMAGE_WIDTH / 2), -(imgY + PINOUT_IMAGE_HEIGHT / 2));
      }
      ctx.drawImage(pinoutImg, imgX, imgY, PINOUT_IMAGE_WIDTH, PINOUT_IMAGE_HEIGHT);
      ctx.restore();
    }
  }

  // Draw selection highlight (before rotation for cleaner look)
  if (isSelected) {
    ctx.strokeStyle = '#64b5f6';
    ctx.lineWidth = 3;
    ctx.setLineDash([5, 3]);
    roundRect(ctx, left - 4, top - 4, width + 8, height + 8, 6);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Main body background
  ctx.fillStyle = bodyColor;
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  roundRect(ctx, left, top, width, height, 4);
  ctx.fill();
  ctx.stroke();

  // Header row
  ctx.fillStyle = headerColor;
  ctx.beginPath();
  ctx.moveTo(left + 4, top);
  ctx.lineTo(left + width - 4, top);
  ctx.quadraticCurveTo(left + width, top, left + width, top + 4);
  ctx.lineTo(left + width, top + HEADER_HEIGHT);
  ctx.lineTo(left, top + HEADER_HEIGHT);
  ctx.lineTo(left, top + 4);
  ctx.quadraticCurveTo(left, top, left + 4, top);
  ctx.closePath();
  ctx.fill();

  // Header divider line
  ctx.strokeStyle = borderColor;
  ctx.beginPath();
  ctx.moveTo(left, top + HEADER_HEIGHT);
  ctx.lineTo(left + width, top + HEADER_HEIGHT);
  ctx.stroke();

  // Connector label in header (flip text back if connector is mirrored)
  ctx.save();
  if (flipped) {
    ctx.scale(-1, 1);  // Counter the horizontal flip so text is readable
  }
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const headerTextX = flipped ? -(width / 2) : (width / 2);
  ctx.fillText(connector.label || 'CONN', headerTextX, top + HEADER_HEIGHT / 2);
  ctx.restore();


  // Draw connector image section if shown
  if (hasConnectorImage && connector.connectorImage) {
    const imgSectionTop = top + HEADER_HEIGHT;

    // Image section background
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(left + 1, imgSectionTop, width - 2, connectorImageHeight);

    // Draw the image - constrained by width, maintaining aspect ratio
    const connImg = loadedImages?.get(`connector-${connector.id}`);
    if (connImg) {
      const aspectRatio = connImg.width / connImg.height;
      // Use fixed width
      let imgWidth = CONNECTOR_IMAGE_WIDTH;
      let imgHeight = imgWidth / aspectRatio;
      // If too tall, constrain by height
      if (imgHeight > CONNECTOR_IMAGE_MAX_HEIGHT) {
        imgHeight = CONNECTOR_IMAGE_MAX_HEIGHT;
        imgWidth = imgHeight * aspectRatio;
      }
      const imgX = left + (width - imgWidth) / 2;
      const imgY = imgSectionTop + (connectorImageHeight - imgHeight) / 2;

      // Counter the flip so image content stays normal
      ctx.save();
      if (flipped) {
        ctx.translate(imgX + imgWidth / 2, imgY + imgHeight / 2);
        ctx.scale(-1, 1);
        ctx.translate(-(imgX + imgWidth / 2), -(imgY + imgHeight / 2));
      }
      ctx.drawImage(connImg, imgX, imgY, imgWidth, imgHeight);
      ctx.restore();
    }

    // Image section divider
    ctx.strokeStyle = borderColor;
    ctx.beginPath();
    ctx.moveTo(left, imgSectionTop + connectorImageHeight);
    ctx.lineTo(left + width, imgSectionTop + connectorImageHeight);
    ctx.stroke();
  }

  // Draw part name row (if present)
  if (hasPartName && connector.partName) {
    const partNameRowTop = top + HEADER_HEIGHT + connectorImageHeight;
    const partNameRowCenter = partNameRowTop + ROW_HEIGHT / 2;

    // Part name row background
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(left + 1, partNameRowTop, width - 2, ROW_HEIGHT);

    // Part name row divider
    ctx.strokeStyle = borderColor;
    ctx.beginPath();
    ctx.moveTo(left, partNameRowTop + ROW_HEIGHT);
    ctx.lineTo(left + width, partNameRowTop + ROW_HEIGHT);
    ctx.stroke();

    // Part name text (flip text back if connector is mirrored)
    ctx.save();
    if (flipped) {
      ctx.scale(-1, 1);
    }
    ctx.fillStyle = '#888888';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const partNameTextX = flipped ? -(width / 2) : (width / 2);
    ctx.fillText(connector.partName, partNameTextX, partNameRowCenter);
    ctx.restore();
  }

  // Draw pin rows
  const pinCount = connector.pins?.length || connector.pinCount || 1;
  const pins = connector.pins?.length > 0 ? connector.pins : generateDefaultPins(pinCount);

  pins.forEach((pin, index) => {
    const rowTop = top + HEADER_HEIGHT + connectorImageHeight + partNameRowHeight + (index * ROW_HEIGHT);
    const rowCenter = rowTop + ROW_HEIGHT / 2;

    // Alternating row background
    if (index % 2 === 1) {
      ctx.fillStyle = pinBgColor;
      ctx.fillRect(left + 1, rowTop, width - 2, ROW_HEIGHT);
    }

    // Row divider
    if (index > 0) {
      ctx.strokeStyle = '#4a4a4a';
      ctx.beginPath();
      ctx.moveTo(left, rowTop);
      ctx.lineTo(left + width, rowTop);
      ctx.stroke();
    }

    // Column divider between pin number and label
    ctx.strokeStyle = '#4a4a4a';
    ctx.beginPath();
    ctx.moveTo(left + PIN_COL_WIDTH, rowTop);
    ctx.lineTo(left + PIN_COL_WIDTH, rowTop + ROW_HEIGHT);
    ctx.stroke();

    // Pin number and label (flip text back if connector is mirrored)
    ctx.save();
    if (flipped) {
      ctx.scale(-1, 1);  // Counter the horizontal flip so text is readable
    }

    // Pin number (left column) - when flipped, left becomes right visually
    ctx.fillStyle = textColor;
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const pinNumX = flipped ? -(left + PIN_COL_WIDTH / 2) : (left + PIN_COL_WIDTH / 2);
    ctx.fillText(pin.number || String(index + 1), pinNumX, rowCenter);

    // Pin label (right column)
    if (pin.label) {
      ctx.fillStyle = '#b0b0b0';
      ctx.font = '11px monospace';
      ctx.textAlign = flipped ? 'right' : 'left';
      const labelX = flipped ? -(left + PIN_COL_WIDTH + 8) : (left + PIN_COL_WIDTH + 8);
      ctx.fillText(pin.label, labelX, rowCenter);
    }
    ctx.restore();

    // Wire connection point (circle on the side)
    const circleX = connector.type === 'male' ? left + width + PIN_CIRCLE_RADIUS : left - PIN_CIRCLE_RADIUS;
    ctx.beginPath();
    ctx.arc(circleX, rowCenter, PIN_CIRCLE_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = headerColor;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });

  // Draw [+] buttons last so they appear on top of everything
  // Connector image button (right side of header) - only if image exists
  if (connector.connectorImage) {
    const connImgBtnX = left + width - EXPAND_BUTTON_SIZE - 2;
    const connImgBtnY = top + (HEADER_HEIGHT - EXPAND_BUTTON_SIZE) / 2;
    drawExpandButton(ctx, connImgBtnX, connImgBtnY, !!connector.showConnectorImage, flipped);
  }

  // Pinout diagram button (left side middle of pin area) - only if image exists
  if (connector.pinoutDiagramImage) {
    const pinAreaHeight = pinCount * ROW_HEIGHT;
    const pinoutBtnX = left - EXPAND_BUTTON_SIZE - 4;
    const pinoutBtnY = top + HEADER_HEIGHT + connectorImageHeight + partNameRowHeight + (pinAreaHeight / 2) - (EXPAND_BUTTON_SIZE / 2);
    drawExpandButton(ctx, pinoutBtnX, pinoutBtnY, !!connector.showPinoutDiagram, flipped);
  }

  ctx.restore();
}

// Draw an expand/collapse button
function drawExpandButton(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  isExpanded: boolean,
  flipped: boolean = false
): void {
  ctx.save();

  // Counter flip for button if connector is flipped
  if (flipped) {
    ctx.scale(-1, 1);
    x = -x - EXPAND_BUTTON_SIZE;
  }

  // Button background
  ctx.fillStyle = isExpanded ? '#1976d2' : '#555555';
  ctx.strokeStyle = '#888888';
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, EXPAND_BUTTON_SIZE, EXPAND_BUTTON_SIZE, 3);
  ctx.fill();
  ctx.stroke();

  // Plus or minus sign
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';

  const centerX = x + EXPAND_BUTTON_SIZE / 2;
  const centerY = y + EXPAND_BUTTON_SIZE / 2;
  const lineLen = 5;

  // Horizontal line (always)
  ctx.beginPath();
  ctx.moveTo(centerX - lineLen, centerY);
  ctx.lineTo(centerX + lineLen, centerY);
  ctx.stroke();

  // Vertical line (only if not expanded)
  if (!isExpanded) {
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - lineLen);
    ctx.lineTo(centerX, centerY + lineLen);
    ctx.stroke();
  }

  ctx.restore();
}

// Get pin positions for a connector (wire connection points on the side)
// Takes rotation and flip into account for wire connection points
// Origin is top-left of first pin row (after header, connector image, and part name row)
export function getConnectorPinPositions(connector: HarnessConnector): PinPosition[] {
  const { width } = getConnectorDimensions(connector);
  const ox = connector.position?.x || 100;  // Origin x (top-left of first pin)
  const oy = connector.position?.y || 100;  // Origin y (top-left of first pin)
  const rotation = connector.rotation || 0;
  const flipped = connector.flipped || false;

  const pinCount = connector.pins?.length || connector.pinCount || 1;
  const pins = connector.pins?.length > 0 ? connector.pins : generateDefaultPins(pinCount);

  return pins.map((pin, index) => {
    // Calculate local position relative to origin (first pin center)
    // Origin is shifted so first pin center is at y=0, subsequent pins at multiples of ROW_HEIGHT
    const rowCenter = index * ROW_HEIGHT;

    // Wire connection point is on the side based on connector type
    // Male connectors have pins on the right, female on the left
    let localX = connector.type === 'male'
      ? width + PIN_CIRCLE_RADIUS
      : -PIN_CIRCLE_RADIUS;
    let localY = rowCenter;

    // Apply flip around center of connector (horizontal flip)
    if (flipped) {
      const centerX = width / 2;
      localX = 2 * centerX - localX;  // Flip X around centerX
      // Y unchanged for horizontal flip
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

// ============ CABLE FUNCTIONS ============

export interface CableWirePosition {
  wireId: string;
  side: 'left' | 'right';
  x: number;
  y: number;
}

// Get cable dimensions (visual length is always fixed at 100px)
export function getCableDimensions(cable: HarnessCable): { width: number; height: number; hasPartName: boolean; hasInfoRow: boolean } {
  const wireCount = cable.wires?.length || cable.wireCount || 1;
  const width = CABLE_DEFAULT_LENGTH;  // Always 100px visual length
  const hasPartName = !!cable.partName;
  const hasInfoRow = !!(cable.gaugeAWG || cable.lengthMm);
  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;
  const infoRowHeight = hasInfoRow ? ROW_HEIGHT : 0;
  const height = HEADER_HEIGHT + partNameRowHeight + infoRowHeight + (wireCount * CABLE_WIRE_SPACING);
  return { width, height, hasPartName, hasInfoRow };
}

// Get the centroid offset from the connector's STORED position (in local unrotated coordinates)
// The stored position is (x, y), but drawing translates to (x, y - ROW_HEIGHT/2)
export function getConnectorCentroidOffset(connector: HarnessConnector): { cx: number; cy: number } {
  const { width, height, hasPartName, hasConnectorImage, connectorImageHeight } = getConnectorDimensions(connector);
  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;

  // Local bounds relative to drawing origin (which is at stored position + (0, -ROW_HEIGHT/2))
  const drawingTop = -HEADER_HEIGHT - connectorImageHeight - partNameRowHeight;
  const drawingBottom = drawingTop + height;

  // Centroid relative to drawing origin
  const localCy = (drawingTop + drawingBottom) / 2;

  // Convert to offset from stored position (drawing origin is ROW_HEIGHT/2 above stored position)
  const cx = width / 2;
  const cy = localCy - ROW_HEIGHT / 2;

  return { cx, cy };
}

// Get the centroid offset from the cable's position origin (in local unrotated coordinates)
// The cable origin is at (x, y), which is the first wire position
export function getCableCentroidOffset(cable: HarnessCable): { cx: number; cy: number } {
  const { width, height, hasPartName, hasInfoRow } = getCableDimensions(cable);
  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;
  const infoRowHeight = hasInfoRow ? ROW_HEIGHT : 0;

  // Local bounds relative to origin (first wire position)
  const top = -HEADER_HEIGHT - partNameRowHeight - infoRowHeight - CABLE_WIRE_SPACING / 2;
  const bottom = top + height;

  // Centroid in local coordinates
  const cx = width / 2;
  const cy = (top + bottom) / 2;

  return { cx, cy };
}

// Calculate new position after rotation so centroid stays in place
export function rotateAroundCentroid(
  position: { x: number; y: number },
  centroidOffset: { cx: number; cy: number },
  currentRotation: number,
  newRotation: number
): { x: number; y: number } {
  const currentRad = (currentRotation * Math.PI) / 180;
  const newRad = (newRotation * Math.PI) / 180;

  // Calculate current centroid world position
  // The centroid in world coords = position + rotated(centroidOffset)
  const currentCentroidX = position.x + centroidOffset.cx * Math.cos(currentRad) - centroidOffset.cy * Math.sin(currentRad);
  const currentCentroidY = position.y + centroidOffset.cx * Math.sin(currentRad) + centroidOffset.cy * Math.cos(currentRad);

  // Calculate new position so centroid stays at the same world position
  // newPosition + rotated(centroidOffset, newRotation) = currentCentroid
  // newPosition = currentCentroid - rotated(centroidOffset, newRotation)
  const newX = currentCentroidX - (centroidOffset.cx * Math.cos(newRad) - centroidOffset.cy * Math.sin(newRad));
  const newY = currentCentroidY - (centroidOffset.cx * Math.sin(newRad) + centroidOffset.cy * Math.cos(newRad));

  return { x: Math.round(newX), y: Math.round(newY) };
}

// Draw a cable element on canvas
export function drawCable(
  ctx: CanvasRenderingContext2D,
  cable: HarnessCable,
  isSelected: boolean = false,
  loadedImages?: Map<string, HTMLImageElement>
): void {
  const { width, height, hasPartName, hasInfoRow } = getCableDimensions(cable);
  const x = cable.position?.x || 100;
  const y = cable.position?.y || 100;
  const rotation = cable.rotation || 0;
  const flipped = cable.flipped || false;

  const headerColor = '#6a1b9a';  // Purple for cables
  const bodyColor = '#3a3a3a';
  const borderColor = '#555555';
  const textColor = '#e0e0e0';

  // Row heights
  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;
  const infoRowHeight = hasInfoRow ? ROW_HEIGHT : 0;
  const wireCount = cable.wires?.length || cable.wireCount || 1;

  ctx.save();

  // Origin is at first wire position (so wires land on grid lines)
  ctx.translate(x, y);
  ctx.rotate((rotation * Math.PI) / 180);

  // Flip around center if flipped
  if (flipped) {
    const centerX = width / 2;
    const centerY = (wireCount - 1) * CABLE_WIRE_SPACING / 2;
    ctx.translate(centerX, centerY);
    ctx.scale(-1, 1);
    ctx.translate(-centerX, -centerY);
  }

  // Local coordinates (relative to origin at first wire)
  const left = 0;
  const top = -HEADER_HEIGHT - partNameRowHeight - infoRowHeight - CABLE_WIRE_SPACING / 2;

  // Draw selection highlight (same style as connector selection)
  if (isSelected) {
    ctx.strokeStyle = '#64b5f6';
    ctx.lineWidth = 3;
    ctx.setLineDash([5, 3]);
    roundRect(ctx, left - 4, top - 4, width + 8, height + 8, 6);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Main body background
  ctx.fillStyle = bodyColor;
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  roundRect(ctx, left, top, width, height, 4);
  ctx.fill();
  ctx.stroke();

  // Header row
  ctx.fillStyle = headerColor;
  ctx.beginPath();
  ctx.moveTo(left + 4, top);
  ctx.lineTo(left + width - 4, top);
  ctx.quadraticCurveTo(left + width, top, left + width, top + 4);
  ctx.lineTo(left + width, top + HEADER_HEIGHT);
  ctx.lineTo(left, top + HEADER_HEIGHT);
  ctx.lineTo(left, top + 4);
  ctx.quadraticCurveTo(left, top, left + 4, top);
  ctx.closePath();
  ctx.fill();

  // Header divider line
  ctx.strokeStyle = borderColor;
  ctx.beginPath();
  ctx.moveTo(left, top + HEADER_HEIGHT);
  ctx.lineTo(left + width, top + HEADER_HEIGHT);
  ctx.stroke();

  // Cable label in header (flip text back if cable is flipped)
  ctx.save();
  if (flipped) {
    ctx.scale(-1, 1);
  }
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const headerTextX = flipped ? -(width / 2) : (width / 2);
  ctx.fillText(cable.label || 'CABLE', headerTextX, top + HEADER_HEIGHT / 2);
  ctx.restore();

  // Draw part name row (if present)
  if (hasPartName && cable.partName) {
    const partNameRowTop = top + HEADER_HEIGHT;
    const partNameRowCenter = partNameRowTop + ROW_HEIGHT / 2;

    // Part name row background
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(left + 1, partNameRowTop, width - 2, ROW_HEIGHT);

    // Part name row divider
    ctx.strokeStyle = borderColor;
    ctx.beginPath();
    ctx.moveTo(left, partNameRowTop + ROW_HEIGHT);
    ctx.lineTo(left + width, partNameRowTop + ROW_HEIGHT);
    ctx.stroke();

    // Part name text (flip text back if cable is flipped)
    ctx.save();
    if (flipped) {
      ctx.scale(-1, 1);
    }
    ctx.fillStyle = '#888888';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const partNameTextX = flipped ? -(width / 2) : (width / 2);
    ctx.fillText(cable.partName, partNameTextX, partNameRowCenter);
    ctx.restore();
  }

  // Draw info row (gauge + length) if present
  if (hasInfoRow) {
    const infoRowTop = top + HEADER_HEIGHT + partNameRowHeight;
    const infoRowCenter = infoRowTop + ROW_HEIGHT / 2;

    // Info row background
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(left + 1, infoRowTop, width - 2, ROW_HEIGHT);

    // Info row divider
    ctx.strokeStyle = borderColor;
    ctx.beginPath();
    ctx.moveTo(left, infoRowTop + ROW_HEIGHT);
    ctx.lineTo(left + width, infoRowTop + ROW_HEIGHT);
    ctx.stroke();

    // Gauge and length text (flip text back if cable is flipped)
    ctx.save();
    if (flipped) {
      ctx.scale(-1, 1);
    }

    // Gauge text (left aligned)
    if (cable.gaugeAWG) {
      ctx.fillStyle = '#888888';
      ctx.font = '10px monospace';
      ctx.textAlign = flipped ? 'right' : 'left';
      ctx.textBaseline = 'middle';
      const gaugeX = flipped ? -(left + 6) : (left + 6);
      ctx.fillText(`${cable.gaugeAWG} AWG`, gaugeX, infoRowCenter);
    }

    // Length text (right aligned)
    if (cable.lengthMm) {
      ctx.fillStyle = '#888888';
      ctx.font = '10px monospace';
      ctx.textAlign = flipped ? 'left' : 'right';
      ctx.textBaseline = 'middle';
      const lengthX = flipped ? -(left + width - 6) : (left + width - 6);
      ctx.fillText(`${cable.lengthMm.toLocaleString()}mm`, lengthX, infoRowCenter);
    }
    ctx.restore();
  }

  // Draw wires - wire positions are at multiples of CABLE_WIRE_SPACING from origin
  const wires = cable.wires || [];
  wires.forEach((wire, index) => {
    const wireY = index * CABLE_WIRE_SPACING;
    const wireColor = getWireColorHex(wire.colorCode || wire.color || 'BK');

    // Draw wire line
    ctx.beginPath();
    ctx.strokeStyle = wireColor;
    ctx.lineWidth = 3;
    ctx.moveTo(left + CABLE_ENDPOINT_RADIUS, wireY);
    ctx.lineTo(left + width - CABLE_ENDPOINT_RADIUS, wireY);
    ctx.stroke();

    // Draw left endpoint circle
    ctx.beginPath();
    ctx.arc(left - CABLE_ENDPOINT_RADIUS, wireY, CABLE_ENDPOINT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = wireColor;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Draw right endpoint circle
    ctx.beginPath();
    ctx.arc(left + width + CABLE_ENDPOINT_RADIUS, wireY, CABLE_ENDPOINT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = wireColor;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Build wire label text (colorCode and/or label)
    const labelParts: string[] = [];
    if (wire.colorCode || wire.color) {
      labelParts.push(wire.colorCode || wire.color || '');
    }
    if (wire.label) {
      labelParts.push(wire.label);
    }
    const labelText = labelParts.join(' - ');

    if (labelText) {
      // Measure text for background box
      ctx.font = '10px monospace';
      const textWidth = ctx.measureText(labelText).width;
      const boxPadding = 4;
      const boxWidth = textWidth + boxPadding * 2;
      const boxHeight = 14;
      const boxX = left + width / 2 - boxWidth / 2;
      const boxY = wireY - boxHeight / 2;

      // Draw background box matching cable body color
      ctx.fillStyle = bodyColor;
      ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

      // Draw wire label text (flip text back if cable is flipped)
      ctx.save();
      if (flipped) {
        ctx.scale(-1, 1);
      }
      ctx.fillStyle = textColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const labelX = flipped ? -(width / 2) : (width / 2);
      ctx.fillText(labelText, labelX, wireY);
      ctx.restore();
    }
  });

  // Draw cable diagram below if shown
  if (cable.showCableDiagram && cable.cableDiagramImage) {
    const diagramImg = loadedImages?.get(`cable-diagram-${cable.id}`);
    if (diagramImg) {
      const diagramY = (wireCount - 1) * CABLE_WIRE_SPACING + CABLE_WIRE_SPACING / 2 + 10;
      const imgX = left + (width - CABLE_DIAGRAM_WIDTH) / 2;
      const imgY = diagramY;

      // Draw image background
      ctx.fillStyle = '#2a2a2a';
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      roundRect(ctx, imgX - 4, imgY - 4, CABLE_DIAGRAM_WIDTH + 8, CABLE_DIAGRAM_HEIGHT + 8, 4);
      ctx.fill();
      ctx.stroke();

      // Draw image - counter the flip so image content stays normal
      ctx.save();
      if (flipped) {
        ctx.translate(imgX + CABLE_DIAGRAM_WIDTH / 2, imgY + CABLE_DIAGRAM_HEIGHT / 2);
        ctx.scale(-1, 1);
        ctx.translate(-(imgX + CABLE_DIAGRAM_WIDTH / 2), -(imgY + CABLE_DIAGRAM_HEIGHT / 2));
      }
      ctx.drawImage(diagramImg, imgX, imgY, CABLE_DIAGRAM_WIDTH, CABLE_DIAGRAM_HEIGHT);
      ctx.restore();
    }
  }

  // Draw [+] button at bottom center if cable diagram image exists
  if (cable.cableDiagramImage) {
    const btnY = (wireCount - 1) * CABLE_WIRE_SPACING + CABLE_WIRE_SPACING / 2 + 4;
    const btnX = left + width / 2 - EXPAND_BUTTON_SIZE / 2;
    drawExpandButton(ctx, btnX, btnY, !!cable.showCableDiagram, flipped);
  }

  ctx.restore();
}

// Get wire endpoint positions for a cable (connection points on both sides)
// Takes rotation and flip into account for wire connection points
// Origin is at first wire position (so wires land on grid lines)
export function getCableWirePositions(cable: HarnessCable): CableWirePosition[] {
  const { width } = getCableDimensions(cable);
  const ox = cable.position?.x || 100;  // Origin x
  const oy = cable.position?.y || 100;  // Origin y
  const rotation = cable.rotation || 0;
  const flipped = cable.flipped || false;
  const wireCount = cable.wires?.length || cable.wireCount || 1;

  const positions: CableWirePosition[] = [];
  const wires = cable.wires || [];

  wires.forEach((wire, index) => {
    // Local Y position relative to origin (first wire at 0)
    const localWireY = index * CABLE_WIRE_SPACING;

    // Left endpoint in local coords
    let leftX = -CABLE_ENDPOINT_RADIUS;
    let leftY = localWireY;

    // Right endpoint in local coords
    let rightX = width + CABLE_ENDPOINT_RADIUS;
    let rightY = localWireY;

    // Apply flip around center
    if (flipped) {
      const centerX = width / 2;
      const centerY = (wireCount - 1) * CABLE_WIRE_SPACING / 2;
      leftX = 2 * centerX - leftX;
      rightX = 2 * centerX - rightX;
      // Swap left and right
      [leftX, rightX] = [rightX, leftX];
    }

    // Apply rotation
    const rad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const rotatedLeftX = leftX * cos - leftY * sin;
    const rotatedLeftY = leftX * sin + leftY * cos;
    const rotatedRightX = rightX * cos - rightY * sin;
    const rotatedRightY = rightX * sin + rightY * cos;

    // Left side endpoint
    positions.push({
      wireId: wire.id,
      side: 'left',
      x: ox + rotatedLeftX,
      y: oy + rotatedLeftY
    });

    // Right side endpoint
    positions.push({
      wireId: wire.id,
      side: 'right',
      x: ox + rotatedRightX,
      y: oy + rotatedRightY
    });
  });

  return positions;
}

// Hit test for cable body
// Takes rotation and flip into account by transforming mouse position to local space
export function hitTestCable(
  cable: HarnessCable,
  testX: number,
  testY: number
): boolean {
  const { width, height, hasPartName, hasInfoRow } = getCableDimensions(cable);
  const ox = cable.position?.x || 100;
  const oy = cable.position?.y || 100;
  const rotation = cable.rotation || 0;
  const flipped = cable.flipped || false;
  const wireCount = cable.wires?.length || cable.wireCount || 1;

  // Row heights
  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;
  const infoRowHeight = hasInfoRow ? ROW_HEIGHT : 0;

  // Transform mouse position to local coordinate space
  const rad = (-rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = testX - ox;
  const dy = testY - oy;

  // Inverse rotation
  let localX = dx * cos - dy * sin;
  let localY = dx * sin + dy * cos;

  // Inverse flip around center
  if (flipped) {
    const centerX = width / 2;
    localX = 2 * centerX - localX;
  }

  // Hit area bounds relative to origin (first wire position)
  const left = -CABLE_ENDPOINT_RADIUS;
  const right = width + CABLE_ENDPOINT_RADIUS;
  const top = -HEADER_HEIGHT - partNameRowHeight - infoRowHeight - CABLE_WIRE_SPACING / 2;
  const bottom = (wireCount - 1) * CABLE_WIRE_SPACING + CABLE_WIRE_SPACING / 2;

  return localX >= left && localX <= right &&
    localY >= top && localY <= bottom;
}

// Hit test for cable diagram expand button
// Returns 'cableDiagram' if button was clicked, null otherwise
export function hitTestCableButton(
  cable: HarnessCable,
  testX: number,
  testY: number
): 'cableDiagram' | null {
  if (!cable.cableDiagramImage) return null;

  const { width } = getCableDimensions(cable);
  const ox = cable.position?.x || 100;
  const oy = cable.position?.y || 100;
  const rotation = cable.rotation || 0;
  const flipped = cable.flipped || false;
  const wireCount = cable.wires?.length || cable.wireCount || 1;

  // Transform mouse position to local coordinate space
  const rad = (-rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = testX - ox;
  const dy = testY - oy;

  // Inverse rotation
  let localX = dx * cos - dy * sin;
  let localY = dx * sin + dy * cos;

  // Inverse flip around center
  if (flipped) {
    const centerX = width / 2;
    localX = 2 * centerX - localX;
  }

  // Button position (bottom center)
  const btnY = (wireCount - 1) * CABLE_WIRE_SPACING + CABLE_WIRE_SPACING / 2 + 4;
  const btnX = width / 2 - EXPAND_BUTTON_SIZE / 2;

  if (localX >= btnX && localX <= btnX + EXPAND_BUTTON_SIZE &&
    localY >= btnY && localY <= btnY + EXPAND_BUTTON_SIZE) {
    return 'cableDiagram';
  }

  return null;
}

// Hit test for cable wire endpoint (returns wire ID and side if hit)
export function hitTestCableWire(
  cable: HarnessCable,
  testX: number,
  testY: number
): { wireId: string; side: 'left' | 'right' } | null {
  const positions = getCableWirePositions(cable);

  for (const pos of positions) {
    const dist = Math.sqrt(Math.pow(testX - pos.x, 2) + Math.pow(testY - pos.y, 2));
    if (dist <= CABLE_ENDPOINT_RADIUS + 4) {
      return { wireId: pos.wireId, side: pos.side };
    }
  }

  return null;
}

// ============ END CABLE FUNCTIONS ============

// ============ COMPONENT FUNCTIONS ============

// Constants for component elements
const COMPONENT_PIN_SPACING = 20;
const COMPONENT_PIN_RADIUS = 5;
const COMPONENT_IMAGE_WIDTH = 90;
const COMPONENT_IMAGE_MAX_HEIGHT = 80;

export interface ComponentPinPosition {
  pinId: string;
  groupId: string;
  x: number;
  y: number;
}

// Get component dimensions
export function getComponentDimensions(component: HarnessComponent): {
  width: number;
  height: number;
  hasPartName: boolean;
  hasComponentImage: boolean;
  componentImageHeight: number;
  groupHeights: number[];
} {
  const hasPartName = !!component.partName;
  const hasComponentImage = !!component.showComponentImage && !!component.componentImage;
  const componentImageHeight = hasComponentImage ? COMPONENT_IMAGE_MAX_HEIGHT : 0;

  // Calculate width based on longest label
  let maxLabelWidth = LABEL_COL_WIDTH;
  const ctx = document.createElement('canvas').getContext('2d');
  if (ctx) {
    ctx.font = '12px monospace';
    for (const group of component.pinGroups) {
      // Check group name
      const groupWidth = ctx.measureText(group.name || 'Group').width + 16;
      maxLabelWidth = Math.max(maxLabelWidth, groupWidth);
      // Check pin labels
      for (const pin of group.pins) {
        if (pin.label) {
          const width = ctx.measureText(pin.label).width + 16;
          maxLabelWidth = Math.max(maxLabelWidth, width);
        }
      }
    }
    // Also consider part name width
    if (component.partName) {
      ctx.font = '11px monospace';
      const partNameWidth = ctx.measureText(component.partName).width + 16;
      maxLabelWidth = Math.max(maxLabelWidth, partNameWidth - PIN_COL_WIDTH);
    }
  }

  let width = PIN_COL_WIDTH + maxLabelWidth;
  // Ensure width is at least enough for the component image if shown
  if (hasComponentImage) {
    width = Math.max(width, COMPONENT_IMAGE_WIDTH + 4);
  }

  // Calculate height based on pin groups
  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;
  const groupHeights: number[] = [];
  let totalPinHeight = 0;
  for (const group of component.pinGroups) {
    const groupHeight = group.pins.length * ROW_HEIGHT;
    groupHeights.push(groupHeight);
    totalPinHeight += groupHeight;
  }

  const height = HEADER_HEIGHT + componentImageHeight + partNameRowHeight + totalPinHeight;

  return { width, height, hasPartName, hasComponentImage, componentImageHeight, groupHeights };
}

// Draw a component on canvas
export function drawComponent(
  ctx: CanvasRenderingContext2D,
  component: HarnessComponent,
  isSelected: boolean = false,
  loadedImages?: Map<string, HTMLImageElement>
): void {
  const { width, height, hasPartName, hasComponentImage, componentImageHeight, groupHeights } = getComponentDimensions(component);
  const x = component.position?.x || 100;
  const y = component.position?.y || 100;
  const rotation = component.rotation || 0;
  const flipped = component.flipped || false;

  // Component uses a teal color to distinguish from connectors
  const headerColor = '#00695c';
  const bodyColor = '#3a3a3a';
  const borderColor = '#555555';
  const textColor = '#e0e0e0';
  const pinBgColor = '#4a4a4a';

  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;

  ctx.save();

  // Origin is at the first pin center (so pins land on grid lines)
  ctx.translate(x, y - ROW_HEIGHT / 2);
  ctx.rotate((rotation * Math.PI) / 180);

  // Flip around the center of the component if flipped
  if (flipped) {
    const centerX = width / 2;
    const totalGroupHeight = groupHeights.reduce((a, b) => a + b, 0);
    const centerY = totalGroupHeight / 2 - HEADER_HEIGHT - componentImageHeight - partNameRowHeight - ROW_HEIGHT / 2;
    ctx.translate(centerX, centerY);
    ctx.scale(-1, 1);
    ctx.translate(-centerX, -centerY);
  }

  // Position relative to origin
  const left = 0;
  const top = -HEADER_HEIGHT - componentImageHeight - partNameRowHeight;

  // Draw pinout diagram to the left if shown
  if (component.showPinoutDiagram && component.pinoutDiagramImage) {
    const pinoutImg = loadedImages?.get(`component-pinout-${component.id}`);
    if (pinoutImg) {
      const imgX = left - PINOUT_IMAGE_WIDTH - 10;
      const imgY = top + (height - PINOUT_IMAGE_HEIGHT) / 2;

      ctx.fillStyle = '#2a2a2a';
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      roundRect(ctx, imgX - 4, imgY - 4, PINOUT_IMAGE_WIDTH + 8, PINOUT_IMAGE_HEIGHT + 8, 4);
      ctx.fill();
      ctx.stroke();

      ctx.save();
      if (flipped) {
        ctx.translate(imgX + PINOUT_IMAGE_WIDTH / 2, imgY + PINOUT_IMAGE_HEIGHT / 2);
        ctx.scale(-1, 1);
        ctx.translate(-(imgX + PINOUT_IMAGE_WIDTH / 2), -(imgY + PINOUT_IMAGE_HEIGHT / 2));
      }
      ctx.drawImage(pinoutImg, imgX, imgY, PINOUT_IMAGE_WIDTH, PINOUT_IMAGE_HEIGHT);
      ctx.restore();
    }
  }

  // Draw selection highlight
  if (isSelected) {
    ctx.strokeStyle = '#64b5f6';
    ctx.lineWidth = 3;
    ctx.setLineDash([5, 3]);
    roundRect(ctx, left - 4, top - 4, width + 8, height + 8, 6);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Main body background
  ctx.fillStyle = bodyColor;
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  roundRect(ctx, left, top, width, height, 4);
  ctx.fill();
  ctx.stroke();

  // Header row
  ctx.fillStyle = headerColor;
  ctx.beginPath();
  ctx.moveTo(left + 4, top);
  ctx.lineTo(left + width - 4, top);
  ctx.quadraticCurveTo(left + width, top, left + width, top + 4);
  ctx.lineTo(left + width, top + HEADER_HEIGHT);
  ctx.lineTo(left, top + HEADER_HEIGHT);
  ctx.lineTo(left, top + 4);
  ctx.quadraticCurveTo(left, top, left + 4, top);
  ctx.closePath();
  ctx.fill();

  // Header divider line
  ctx.strokeStyle = borderColor;
  ctx.beginPath();
  ctx.moveTo(left, top + HEADER_HEIGHT);
  ctx.lineTo(left + width, top + HEADER_HEIGHT);
  ctx.stroke();

  // Component label in header
  ctx.save();
  if (flipped) {
    ctx.scale(-1, 1);
  }
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const headerTextX = flipped ? -(width / 2) : (width / 2);
  ctx.fillText(component.label || 'COMP', headerTextX, top + HEADER_HEIGHT / 2);
  ctx.restore();

  // Draw component image section if shown
  if (hasComponentImage && component.componentImage) {
    const imgSectionTop = top + HEADER_HEIGHT;

    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(left + 1, imgSectionTop, width - 2, componentImageHeight);

    const compImg = loadedImages?.get(`component-img-${component.id}`);
    if (compImg) {
      const aspectRatio = compImg.width / compImg.height;
      let imgWidth = COMPONENT_IMAGE_WIDTH;
      let imgHeight = imgWidth / aspectRatio;
      if (imgHeight > COMPONENT_IMAGE_MAX_HEIGHT) {
        imgHeight = COMPONENT_IMAGE_MAX_HEIGHT;
        imgWidth = imgHeight * aspectRatio;
      }
      const imgX = left + (width - imgWidth) / 2;
      const imgY = imgSectionTop + (componentImageHeight - imgHeight) / 2;

      ctx.save();
      if (flipped) {
        ctx.translate(imgX + imgWidth / 2, imgY + imgHeight / 2);
        ctx.scale(-1, 1);
        ctx.translate(-(imgX + imgWidth / 2), -(imgY + imgHeight / 2));
      }
      ctx.drawImage(compImg, imgX, imgY, imgWidth, imgHeight);
      ctx.restore();
    }

    ctx.strokeStyle = borderColor;
    ctx.beginPath();
    ctx.moveTo(left, imgSectionTop + componentImageHeight);
    ctx.lineTo(left + width, imgSectionTop + componentImageHeight);
    ctx.stroke();
  }

  // Draw part name row if present
  if (hasPartName && component.partName) {
    const partNameRowTop = top + HEADER_HEIGHT + componentImageHeight;
    const partNameRowCenter = partNameRowTop + ROW_HEIGHT / 2;

    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(left + 1, partNameRowTop, width - 2, ROW_HEIGHT);

    ctx.strokeStyle = borderColor;
    ctx.beginPath();
    ctx.moveTo(left, partNameRowTop + ROW_HEIGHT);
    ctx.lineTo(left + width, partNameRowTop + ROW_HEIGHT);
    ctx.stroke();

    ctx.save();
    if (flipped) {
      ctx.scale(-1, 1);
    }
    ctx.fillStyle = '#888888';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const partNameTextX = flipped ? -(width / 2) : (width / 2);
    ctx.fillText(component.partName, partNameTextX, partNameRowCenter);
    ctx.restore();
  }

  // Draw pin groups
  let currentY = top + HEADER_HEIGHT + componentImageHeight + partNameRowHeight;
  let pinIndex = 0;

  for (let gi = 0; gi < component.pinGroups.length; gi++) {
    const group = component.pinGroups[gi];

    // Draw thicker divider line between pin groups (not before first group)
    if (gi > 0) {
      ctx.strokeStyle = '#CCCCCC';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(left, currentY);
      ctx.lineTo(left + width, currentY);
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    // Draw pins in this group
    for (let i = 0; i < group.pins.length; i++) {
      const pin = group.pins[i];
      const rowTop = currentY + (i * ROW_HEIGHT);
      const rowCenter = rowTop + ROW_HEIGHT / 2;

      // Alternating row background
      if ((pinIndex + i) % 2 === 1) {
        ctx.fillStyle = pinBgColor;
        ctx.fillRect(left + 1, rowTop, width - 2, ROW_HEIGHT);
      }

      // Row divider
      if (i > 0) {
        ctx.strokeStyle = '#4a4a4a';
        ctx.beginPath();
        ctx.moveTo(left, rowTop);
        ctx.lineTo(left + width, rowTop);
        ctx.stroke();
      }

      // Column divider
      ctx.strokeStyle = '#4a4a4a';
      ctx.beginPath();
      ctx.moveTo(left + PIN_COL_WIDTH, rowTop);
      ctx.lineTo(left + PIN_COL_WIDTH, rowTop + ROW_HEIGHT);
      ctx.stroke();

      // Pin number and label
      ctx.save();
      if (flipped) {
        ctx.scale(-1, 1);
      }

      ctx.fillStyle = textColor;
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const pinNumX = flipped ? -(left + PIN_COL_WIDTH / 2) : (left + PIN_COL_WIDTH / 2);
      ctx.fillText(pin.number || String(i + 1), pinNumX, rowCenter);

      if (pin.label) {
        ctx.fillStyle = '#b0b0b0';
        ctx.font = '11px monospace';
        ctx.textAlign = flipped ? 'right' : 'left';
        const labelX = flipped ? -(left + PIN_COL_WIDTH + 8) : (left + PIN_COL_WIDTH + 8);
        ctx.fillText(pin.label, labelX, rowCenter);
      }
      ctx.restore();

      // Wire connection point (circle on the right side)
      const circleX = left + width + COMPONENT_PIN_RADIUS;
      ctx.beginPath();
      ctx.arc(circleX, rowCenter, COMPONENT_PIN_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = headerColor;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    currentY += group.pins.length * ROW_HEIGHT;
    pinIndex += group.pins.length;
  }

  // Draw expand buttons if images exist
  if (component.componentImage) {
    const compImgBtnX = left + width - EXPAND_BUTTON_SIZE - 2;
    const compImgBtnY = top + (HEADER_HEIGHT - EXPAND_BUTTON_SIZE) / 2;
    drawExpandButton(ctx, compImgBtnX, compImgBtnY, !!component.showComponentImage, flipped);
  }

  if (component.pinoutDiagramImage) {
    const totalPinHeight = groupHeights.reduce((a, b) => a + b, 0);
    const pinoutBtnX = left - EXPAND_BUTTON_SIZE - 4;
    const pinoutBtnY = top + HEADER_HEIGHT + componentImageHeight + partNameRowHeight + (totalPinHeight / 2) - (EXPAND_BUTTON_SIZE / 2);
    drawExpandButton(ctx, pinoutBtnX, pinoutBtnY, !!component.showPinoutDiagram, flipped);
  }

  ctx.restore();
}

// Get pin positions for a component
export function getComponentPinPositions(component: HarnessComponent): ComponentPinPosition[] {
  const { width, hasPartName, componentImageHeight, groupHeights } = getComponentDimensions(component);
  const ox = component.position?.x || 100;
  const oy = component.position?.y || 100;
  const rotation = component.rotation || 0;
  const flipped = component.flipped || false;

  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;
  const positions: ComponentPinPosition[] = [];

  let currentLocalY = componentImageHeight + partNameRowHeight + HEADER_HEIGHT;

  for (const group of component.pinGroups) {
    for (let pi = 0; pi < group.pins.length; pi++) {
      const pin = group.pins[pi];
      const localPinY = currentLocalY + (pi * ROW_HEIGHT) + ROW_HEIGHT / 2;

      // Pin connection is on the right side of the component
      let localX = width + COMPONENT_PIN_RADIUS;
      let localY = localPinY - HEADER_HEIGHT - componentImageHeight - partNameRowHeight;

      // Apply flip
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

      positions.push({
        pinId: pin.id,
        groupId: group.id,
        x: ox + rotatedX,
        y: oy + rotatedY
      });
    }

    currentLocalY += group.pins.length * ROW_HEIGHT;
  }

  return positions;
}

// Hit test for component body
export function hitTestComponent(
  component: HarnessComponent,
  testX: number,
  testY: number
): boolean {
  const { width, height, hasPartName, componentImageHeight } = getComponentDimensions(component);
  const ox = component.position?.x || 100;
  const oy = component.position?.y || 100;
  const rotation = component.rotation || 0;
  const flipped = component.flipped || false;

  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;

  // Transform to local space
  const rad = (-rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = testX - ox;
  const dy = testY - oy;

  let localX = dx * cos - dy * sin;
  let localY = dx * sin + dy * cos;

  if (flipped) {
    const centerX = width / 2;
    localX = 2 * centerX - localX;
  }

  const left = -COMPONENT_PIN_RADIUS;
  const right = width + COMPONENT_PIN_RADIUS;
  const top = -HEADER_HEIGHT - componentImageHeight - partNameRowHeight - ROW_HEIGHT / 2;
  const bottom = height - HEADER_HEIGHT - componentImageHeight - partNameRowHeight - ROW_HEIGHT / 2;

  return localX >= left && localX <= right &&
    localY >= top && localY <= bottom;
}

// Hit test for component pin
export function hitTestComponentPin(
  component: HarnessComponent,
  testX: number,
  testY: number
): { pinId: string; groupId: string } | null {
  const positions = getComponentPinPositions(component);

  for (const pos of positions) {
    const dist = Math.sqrt(Math.pow(testX - pos.x, 2) + Math.pow(testY - pos.y, 2));
    if (dist <= COMPONENT_PIN_RADIUS + 6) {
      return { pinId: pos.pinId, groupId: pos.groupId };
    }
  }
  return null;
}

// Hit test for component expand buttons
export function hitTestComponentButton(
  component: HarnessComponent,
  testX: number,
  testY: number
): 'pinout' | 'componentImage' | null {
  const { width, height, hasPartName, componentImageHeight, groupHeights } = getComponentDimensions(component);
  const ox = component.position?.x || 100;
  const oy = component.position?.y || 100;
  const rotation = component.rotation || 0;
  const flipped = component.flipped || false;

  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;

  // Transform to local space
  const rad = (-rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = testX - ox;
  const dy = testY - oy;

  let localX = dx * cos - dy * sin;
  let localY = dx * sin + dy * cos;

  if (flipped) {
    const centerX = width / 2;
    localX = 2 * centerX - localX;
  }

  const left = 0;
  const top = -HEADER_HEIGHT - componentImageHeight - partNameRowHeight - ROW_HEIGHT / 2;

  // Check component image button
  if (component.componentImage) {
    const compImgBtnX = left + width - EXPAND_BUTTON_SIZE - 2;
    const compImgBtnY = top + (HEADER_HEIGHT - EXPAND_BUTTON_SIZE) / 2;

    if (localX >= compImgBtnX && localX <= compImgBtnX + EXPAND_BUTTON_SIZE &&
      localY >= compImgBtnY && localY <= compImgBtnY + EXPAND_BUTTON_SIZE) {
      return 'componentImage';
    }
  }

  // Check pinout diagram button
  if (component.pinoutDiagramImage) {
    const totalPinHeight = groupHeights.reduce((a, b) => a + b, 0);
    const pinoutBtnX = left - EXPAND_BUTTON_SIZE - 4;
    const pinoutBtnY = (totalPinHeight / 2) - (EXPAND_BUTTON_SIZE / 2);

    if (localX >= pinoutBtnX && localX <= pinoutBtnX + EXPAND_BUTTON_SIZE &&
      localY >= pinoutBtnY && localY <= pinoutBtnY + EXPAND_BUTTON_SIZE) {
      return 'pinout';
    }
  }

  return null;
}

// Get the centroid offset for component
export function getComponentCentroidOffset(component: HarnessComponent): { cx: number; cy: number } {
  const { width, height, hasPartName, componentImageHeight } = getComponentDimensions(component);
  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;

  const drawingTop = -HEADER_HEIGHT - componentImageHeight - partNameRowHeight;
  const drawingBottom = drawingTop + height;

  const localCy = (drawingTop + drawingBottom) / 2;
  const cx = width / 2;
  const cy = localCy - ROW_HEIGHT / 2;

  return { cx, cy };
}

// ============ END COMPONENT FUNCTIONS ============

// Calculate orthogonal (right-angle) path between two points
export function calculateOrthogonalPath(
  fromPos: { x: number; y: number },
  toPos: { x: number; y: number },
  gridSize: number = 20
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];

  // Snap positions to grid
  const startX = Math.round(fromPos.x / gridSize) * gridSize;
  const startY = Math.round(fromPos.y / gridSize) * gridSize;
  const endX = Math.round(toPos.x / gridSize) * gridSize;
  const endY = Math.round(toPos.y / gridSize) * gridSize;

  points.push({ x: fromPos.x, y: fromPos.y });

  // Calculate midpoint for the routing
  const midX = Math.round(((startX + endX) / 2) / gridSize) * gridSize;

  // Route: start -> horizontal to midX -> vertical to endY -> horizontal to end
  if (startX !== endX || startY !== endY) {
    // First horizontal segment to midpoint
    if (startX !== midX) {
      points.push({ x: midX, y: fromPos.y });
    }
    // Vertical segment
    if (fromPos.y !== toPos.y) {
      points.push({ x: midX, y: toPos.y });
    }
  }

  points.push({ x: toPos.x, y: toPos.y });

  return points;
}

// Draw a wire connection with orthogonal routing
export function drawWire(
  ctx: CanvasRenderingContext2D,
  connection: HarnessConnection,
  fromPos: { x: number; y: number },
  toPos: { x: number; y: number },
  wireColor: string = 'BK',
  isSelected: boolean = false,
  gridSize: number = 20,
  cableLabel?: string
): void {
  const hexColor = getWireColorHex(wireColor);

  ctx.save();

  // Build orthogonal path
  const points = connection.waypoints?.length
    ? [fromPos, ...connection.waypoints, toPos]
    : calculateOrthogonalPath(fromPos, toPos, gridSize);

  ctx.lineCap = 'square';
  ctx.lineJoin = 'miter';

  // Draw white border first (1px on each side)
  ctx.beginPath();
  ctx.strokeStyle = isSelected ? '#90caf9' : '#ffffff';
  ctx.lineWidth = WIRE_STROKE_WIDTH + 2;
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();

  // Draw wire color on top
  ctx.beginPath();
  ctx.strokeStyle = isSelected ? '#64b5f6' : hexColor;
  ctx.lineWidth = WIRE_STROKE_WIDTH;
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();

  // Draw endpoint dots
  ctx.fillStyle = hexColor;
  ctx.beginPath();
  ctx.arc(fromPos.x, fromPos.y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(toPos.x, toPos.y, 4, 0, Math.PI * 2);
  ctx.fill();

  // Draw cable label on wire if provided
  if (cableLabel && points.length >= 2) {
    // Find the midpoint of the wire path
    const midIndex = Math.floor(points.length / 2);
    const midPoint = points[midIndex];

    // Draw label background
    ctx.font = 'bold 10px monospace';
    const labelWidth = ctx.measureText(cableLabel).width + 8;
    const labelHeight = 14;

    const labelX = midPoint.x - labelWidth / 2;
    const labelY = midPoint.y - labelHeight / 2;

    ctx.fillStyle = '#2d2d2d';
    ctx.fillRect(labelX, labelY, labelWidth, labelHeight);
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    ctx.strokeRect(labelX, labelY, labelWidth, labelHeight);

    // Draw label text
    ctx.fillStyle = '#e0e0e0';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(cableLabel, midPoint.x, midPoint.y);
  }

  // Draw control point handles at direction changes if selected
  if (isSelected && points.length > 2) {
    // Draw handles at all intermediate points (not start/end which are connected to pins)
    for (let i = 1; i < points.length - 1; i++) {
      const pt = points[i];
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = hexColor;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  ctx.restore();
}

// Draw wire preview while drawing (orthogonal)
export function drawWirePreview(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  gridSize: number = 20
): void {
  ctx.save();
  ctx.beginPath();
  ctx.strokeStyle = '#64b5f6';
  ctx.lineWidth = WIRE_STROKE_WIDTH;
  ctx.setLineDash([8, 4]);
  ctx.lineCap = 'square';
  ctx.lineJoin = 'miter';

  // Calculate orthogonal path
  const points = calculateOrthogonalPath(
    { x: fromX, y: fromY },
    { x: toX, y: toY },
    gridSize
  );

  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  ctx.restore();
}

// Draw a green highlight indicator on a pin during wire drawing
export function drawPinHighlight(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  isStart: boolean = false
): void {
  ctx.save();

  // Draw outer glow
  ctx.beginPath();
  ctx.arc(x, y, PIN_CIRCLE_RADIUS + 3, 0, Math.PI * 2);
  ctx.strokeStyle = isStart ? '#4caf50' : '#4caf50';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Draw inner green dot
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, Math.PI * 2);
  ctx.fillStyle = '#4caf50';
  ctx.fill();

  ctx.restore();
}

// Draw grid (dark mode) - Draws in screen space for consistent rendering
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  screenWidth: number,
  screenHeight: number,
  gridSize: number,
  panX: number = 0,
  panY: number = 0,
  zoom: number = 1
): void {
  ctx.save();

  // Grid spacing in screen space
  const screenGridSize = gridSize * zoom;

  // Calculate starting position accounting for pan
  // We want grid lines to align with world coordinates
  const startX = (panX % screenGridSize);
  const startY = (panY % screenGridSize);

  // Calculate which world grid line is at the left/top edge
  const worldStartX = -panX / zoom;
  const worldStartY = -panY / zoom;

  // Draw vertical lines
  for (let screenX = startX; screenX <= screenWidth; screenX += screenGridSize) {
    // Calculate the world coordinate for this line
    const worldX = (screenX - panX) / zoom;
    // Check if this is a major grid line (every 5th line in world coordinates)
    const isMajor = Math.abs(Math.round(worldX / gridSize) % 5) === 0;

    ctx.strokeStyle = isMajor ? '#404040' : '#2a2a2a';
    ctx.lineWidth = isMajor ? 1 : 0.5;
    ctx.beginPath();
    ctx.moveTo(Math.round(screenX) + 0.5, 0);
    ctx.lineTo(Math.round(screenX) + 0.5, screenHeight);
    ctx.stroke();
  }

  // Draw horizontal lines
  for (let screenY = startY; screenY <= screenHeight; screenY += screenGridSize) {
    // Calculate the world coordinate for this line
    const worldY = (screenY - panY) / zoom;
    // Check if this is a major grid line
    const isMajor = Math.abs(Math.round(worldY / gridSize) % 5) === 0;

    ctx.strokeStyle = isMajor ? '#404040' : '#2a2a2a';
    ctx.lineWidth = isMajor ? 1 : 0.5;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(screenY) + 0.5);
    ctx.lineTo(screenWidth, Math.round(screenY) + 0.5);
    ctx.stroke();
  }

  ctx.restore();
}

// Hit test for connector (including the pin circles on the side)
// Takes rotation and flip into account by transforming mouse position to local space
// Origin is at first pin center (so pins align with grid)
export function hitTestConnector(
  connector: HarnessConnector,
  x: number,
  y: number
): boolean {
  const { width, hasPartName, connectorImageHeight } = getConnectorDimensions(connector);
  const ox = connector.position?.x || 100;  // Origin x
  const oy = connector.position?.y || 100;  // Origin y
  const rotation = connector.rotation || 0;
  const flipped = connector.flipped || false;

  // Part name row offset
  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;
  const pinCount = connector.pins?.length || connector.pinCount || 1;

  // Transform mouse position to local coordinate space
  // Apply inverse transforms in reverse order (flip then rotation)
  const rad = (-rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = x - ox;
  const dy = y - oy;

  // Inverse rotation
  let localX = dx * cos - dy * sin;
  let localY = dx * sin + dy * cos;

  // Inverse flip around center (same as flip since it's its own inverse)
  if (flipped) {
    const centerX = width / 2;
    localX = 2 * centerX - localX;
  }

  // Hit area bounds relative to origin (first pin center)
  // Header, connector image, and part name row are above origin
  const left = -PIN_CIRCLE_RADIUS;
  const right = width + PIN_CIRCLE_RADIUS;
  const top = -HEADER_HEIGHT - connectorImageHeight - partNameRowHeight - ROW_HEIGHT / 2;
  const bottom = (pinCount - 1) * ROW_HEIGHT + ROW_HEIGHT / 2;

  return localX >= left && localX <= right &&
    localY >= top && localY <= bottom;
}

// Hit test for pin (returns pin ID if hit)
export function hitTestPin(
  connector: HarnessConnector,
  x: number,
  y: number
): string | null {
  const pinPositions = getConnectorPinPositions(connector);

  for (const pin of pinPositions) {
    const dist = Math.sqrt(Math.pow(x - pin.x, 2) + Math.pow(y - pin.y, 2));
    if (dist <= PIN_CIRCLE_RADIUS + 6) {
      return pin.pinId;
    }
  }
  return null;
}

// Hit test for expand buttons on connector
// Returns 'pinout' or 'connectorImage' if a button was clicked, null otherwise
export function hitTestConnectorButton(
  connector: HarnessConnector,
  x: number,
  y: number
): 'pinout' | 'connectorImage' | null {
  const { width, hasPartName, connectorImageHeight } = getConnectorDimensions(connector);
  const ox = connector.position?.x || 100;
  const oy = connector.position?.y || 100;
  const rotation = connector.rotation || 0;
  const flipped = connector.flipped || false;

  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;
  const pinCount = connector.pins?.length || connector.pinCount || 1;

  // Transform mouse position to local coordinate space
  const rad = (-rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = x - ox;
  const dy = y - oy;

  let localX = dx * cos - dy * sin;
  let localY = dx * sin + dy * cos;

  if (flipped) {
    const centerX = width / 2;
    localX = 2 * centerX - localX;
  }

  // Local coordinates relative to origin (first pin center)
  const left = 0;
  const top = -HEADER_HEIGHT - connectorImageHeight - partNameRowHeight - ROW_HEIGHT / 2;

  // Check connector image button (right side of header) - only if image exists
  if (connector.connectorImage) {
    const connImgBtnX = left + width - EXPAND_BUTTON_SIZE - 2;
    const connImgBtnY = top + (HEADER_HEIGHT - EXPAND_BUTTON_SIZE) / 2;

    if (localX >= connImgBtnX && localX <= connImgBtnX + EXPAND_BUTTON_SIZE &&
      localY >= connImgBtnY && localY <= connImgBtnY + EXPAND_BUTTON_SIZE) {
      return 'connectorImage';
    }
  }

  // Check pinout diagram button (left side middle) - only if image exists
  if (connector.pinoutDiagramImage) {
    const pinoutBtnX = left - EXPAND_BUTTON_SIZE - 4;
    // Pin area center is at (pinCount-1)*ROW_HEIGHT/2 from origin (first pin center)
    const pinoutBtnY = (pinCount - 1) * ROW_HEIGHT / 2 - (EXPAND_BUTTON_SIZE / 2);

    if (localX >= pinoutBtnX && localX <= pinoutBtnX + EXPAND_BUTTON_SIZE &&
      localY >= pinoutBtnY && localY <= pinoutBtnY + EXPAND_BUTTON_SIZE) {
      return 'pinout';
    }
  }

  return null;
}

// Hit test for wire connection
export function hitTestWire(
  connection: HarnessConnection,
  fromPos: { x: number; y: number },
  toPos: { x: number; y: number },
  testX: number,
  testY: number,
  gridSize: number = 20,
  threshold: number = 8
): boolean {
  // Get the wire path points
  const points = connection.waypoints?.length
    ? [fromPos, ...connection.waypoints, toPos]
    : calculateOrthogonalPath(fromPos, toPos, gridSize);

  // Check distance to each line segment
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const dist = pointToLineDistance(testX, testY, p1.x, p1.y, p2.x, p2.y);
    if (dist <= threshold) {
      return true;
    }
  }
  return false;
}

// Get wire control points (intermediate points where wire changes direction)
export function getWireControlPoints(
  connection: HarnessConnection,
  fromPos: { x: number; y: number },
  toPos: { x: number; y: number },
  gridSize: number = 20
): { x: number; y: number; index: number }[] {
  const points = connection.waypoints?.length
    ? [fromPos, ...connection.waypoints, toPos]
    : calculateOrthogonalPath(fromPos, toPos, gridSize);

  // Return intermediate points (not start/end which are connected to pins)
  const controlPoints: { x: number; y: number; index: number }[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    controlPoints.push({ ...points[i], index: i });
  }
  return controlPoints;
}

// Hit test for wire control point (returns point index if hit, -1 otherwise)
export function hitTestWireControlPoint(
  connection: HarnessConnection,
  fromPos: { x: number; y: number },
  toPos: { x: number; y: number },
  testX: number,
  testY: number,
  gridSize: number = 20
): number {
  const controlPoints = getWireControlPoints(connection, fromPos, toPos, gridSize);
  const threshold = 8;

  for (const cp of controlPoints) {
    const dist = Math.sqrt((testX - cp.x) ** 2 + (testY - cp.y) ** 2);
    if (dist <= threshold) {
      return cp.index;
    }
  }
  return -1;
}

// Helper: Calculate distance from point to line segment
function pointToLineDistance(
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) {
    // Line segment is a point
    return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
  }

  // Project point onto line, clamped to segment
  let t = ((px - x1) * dx + (py - y1) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));

  const projX = x1 + t * dx;
  const projY = y1 + t * dy;

  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
}

// Helper: Draw rounded rectangle
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

// Helper: Generate default pins
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
