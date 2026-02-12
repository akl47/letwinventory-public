// Cable element rendering and hit testing
import { HarnessCable } from '../../../models/harness.model';
import {
  ROW_HEIGHT,
  HEADER_HEIGHT,
  CABLE_DEFAULT_LENGTH,
  CABLE_WIRE_SPACING,
  CABLE_ENDPOINT_RADIUS,
  CABLE_DIAGRAM_WIDTH,
  CABLE_DIAGRAM_HEIGHT,
  EXPAND_BUTTON_SIZE
} from '../constants';
import { CableDimensions, CableWirePosition, CentroidOffset } from '../types';
import { roundRect, drawExpandButton } from '../drawing-utils';
import { getWireColorHex } from '../wire-color-map';
import {
  COLORS,
  drawSelectionHighlight,
  drawElementBody,
  drawElementHeader,
  drawPartNameRow,
  truncateText
} from './base-element';

// Cable header color
const CABLE_HEADER_COLOR = '#696969';

/**
 * Get cable dimensions
 */
export function getCableDimensions(cable: HarnessCable): CableDimensions {
  const wireCount = cable.wires?.length || cable.wireCount || 1;
  const width = CABLE_DEFAULT_LENGTH;
  const hasPartName = !!cable.partName;
  const hasInfoRow = !!(cable.gaugeAWG || cable.lengthMm);
  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;
  const infoRowHeight = hasInfoRow ? ROW_HEIGHT : 0;
  const height = HEADER_HEIGHT + partNameRowHeight + infoRowHeight + (wireCount * CABLE_WIRE_SPACING);
  return { width, height, hasPartName, hasInfoRow };
}

/**
 * Draw a cable element on canvas
 */
export function drawCable(
  ctx: CanvasRenderingContext2D,
  cable: HarnessCable,
  isSelected: boolean = false,
  loadedImages?: Map<string, HTMLImageElement>,
  highlightedWireIds?: Set<string>,
  highlightedSide?: 'left' | 'right' | 'both'
): void {
  const { width, height, hasPartName, hasInfoRow } = getCableDimensions(cable);
  const x = cable.position?.x || 100;
  const y = cable.position?.y || 100;
  const rotation = cable.rotation || 0;
  const flipped = cable.flipped || false;

  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;
  const infoRowHeight = hasInfoRow ? ROW_HEIGHT : 0;
  const wireCount = cable.wires?.length || cable.wireCount || 1;

  ctx.save();

  // Origin is at first wire position
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

  // Draw selection highlight
  if (isSelected) {
    drawSelectionHighlight(ctx, left, top, width, height);
  }

  // Draw main body
  drawElementBody(ctx, left, top, width, height);

  // Draw header
  drawElementHeader(ctx, left, top, width, CABLE_HEADER_COLOR, cable.label || 'CABLE', flipped);

  // Draw part name row if present
  if (hasPartName && cable.partName) {
    drawPartNameRow(ctx, left, top + HEADER_HEIGHT, width, cable.partName, flipped);
  }

  // Draw info row (gauge + length) if present
  if (hasInfoRow) {
    const infoRowTop = top + HEADER_HEIGHT + partNameRowHeight;
    const infoRowCenter = infoRowTop + ROW_HEIGHT / 2;

    // Info row background
    ctx.fillStyle = COLORS.imageBackground;
    ctx.fillRect(left + 1, infoRowTop, width - 2, ROW_HEIGHT);

    // Info row divider
    ctx.strokeStyle = COLORS.border;
    ctx.beginPath();
    ctx.moveTo(left, infoRowTop + ROW_HEIGHT);
    ctx.lineTo(left + width, infoRowTop + ROW_HEIGHT);
    ctx.stroke();

    // Gauge and length text
    ctx.save();
    if (flipped) {
      ctx.scale(-1, 1);
    }

    if (cable.gaugeAWG) {
      ctx.fillStyle = COLORS.partName;
      ctx.font = '10px monospace';
      ctx.textAlign = flipped ? 'right' : 'left';
      ctx.textBaseline = 'middle';
      const gaugeX = flipped ? -(left + 6) : (left + 6);
      ctx.fillText(`${cable.gaugeAWG} AWG`, gaugeX, infoRowCenter);
    }

    if (cable.lengthMm) {
      ctx.fillStyle = COLORS.partName;
      ctx.font = '10px monospace';
      ctx.textAlign = flipped ? 'left' : 'right';
      ctx.textBaseline = 'middle';
      const lengthX = flipped ? -(left + width - 6) : (left + width - 6);
      ctx.fillText(`${cable.lengthMm.toLocaleString()}mm`, lengthX, infoRowCenter);
    }
    ctx.restore();
  }

  // Draw wires
  const wires = cable.wires || [];
  wires.forEach((wire, index) => {
    const wireY = index * CABLE_WIRE_SPACING;
    const wireColor = getWireColorHex(wire.colorCode || wire.color || 'BK');
    const isWireHighlighted = highlightedWireIds?.has(wire.id) || false;
    const highlightLeft = isWireHighlighted && (highlightedSide === 'left' || highlightedSide === 'both');
    const highlightRight = isWireHighlighted && (highlightedSide === 'right' || highlightedSide === 'both');

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
    ctx.fillStyle = highlightLeft ? '#ffeb3b' : wireColor;
    ctx.fill();
    ctx.strokeStyle = highlightLeft ? '#ff9800' : '#ffffff';
    ctx.lineWidth = highlightLeft ? 2.5 : 1.5;
    ctx.stroke();

    // Draw right endpoint circle
    ctx.beginPath();
    ctx.arc(left + width + CABLE_ENDPOINT_RADIUS, wireY, CABLE_ENDPOINT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = highlightRight ? '#ffeb3b' : wireColor;
    ctx.fill();
    ctx.strokeStyle = highlightRight ? '#ff9800' : '#ffffff';
    ctx.lineWidth = highlightRight ? 2.5 : 1.5;
    ctx.stroke();

    // Build wire label text
    const labelParts: string[] = [];
    if (wire.colorCode || wire.color) {
      labelParts.push(wire.colorCode || wire.color || '');
    }
    if (wire.label) {
      labelParts.push(wire.label);
    }
    const labelText = labelParts.join(' - ');

    if (labelText) {
      // Measure and truncate text for background box
      ctx.font = '10px monospace';
      const truncatedLabel = truncateText(ctx, labelText, width);
      const textWidth = ctx.measureText(truncatedLabel).width;
      const boxPadding = 4;
      const boxWidth = textWidth + boxPadding * 2;
      const boxHeight = 14;
      const boxX = left + width / 2 - boxWidth / 2;
      const boxY = wireY - boxHeight / 2;

      // Draw background box
      ctx.fillStyle = COLORS.body;
      ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

      // Draw wire label text
      ctx.save();
      if (flipped) {
        ctx.scale(-1, 1);
      }
      ctx.fillStyle = COLORS.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const labelX = flipped ? -(width / 2) : (width / 2);
      ctx.fillText(truncatedLabel, labelX, wireY);
      ctx.restore();
    }
  });

  // Draw cable diagram below if shown
  if (cable.showCableDiagram && cable.cableDiagramImage) {
    const diagramImg = loadedImages?.get(`cable-diagram-${cable.id}`);
    if (diagramImg) {
      // Fit image within max bounds while preserving aspect ratio
      const aspectRatio = diagramImg.width / diagramImg.height;
      let drawWidth = CABLE_DIAGRAM_WIDTH;
      let drawHeight = drawWidth / aspectRatio;
      if (drawHeight > CABLE_DIAGRAM_HEIGHT) {
        drawHeight = CABLE_DIAGRAM_HEIGHT;
        drawWidth = drawHeight * aspectRatio;
      }

      const diagramY = (wireCount - 1) * CABLE_WIRE_SPACING + CABLE_WIRE_SPACING / 2 + 10;
      const imgX = left + (width - drawWidth) / 2;
      const imgY = diagramY;

      // Draw image background
      ctx.fillStyle = COLORS.imageBackground;
      ctx.strokeStyle = COLORS.border;
      ctx.lineWidth = 1;
      roundRect(ctx, imgX - 4, imgY - 4, drawWidth + 8, drawHeight + 8, 4);
      ctx.fill();
      ctx.stroke();

      // Draw image
      ctx.save();
      if (flipped) {
        ctx.translate(imgX + drawWidth / 2, imgY + drawHeight / 2);
        ctx.scale(-1, 1);
        ctx.translate(-(imgX + drawWidth / 2), -(imgY + drawHeight / 2));
      }
      ctx.drawImage(diagramImg, imgX, imgY, drawWidth, drawHeight);
      ctx.restore();
    }
  }

  // Draw expand button if cable diagram image exists
  if (cable.cableDiagramImage) {
    const btnY = (wireCount - 1) * CABLE_WIRE_SPACING + CABLE_WIRE_SPACING / 2 + 4;
    const btnX = left + width / 2 - EXPAND_BUTTON_SIZE / 2;
    drawExpandButton(ctx, btnX, btnY, !!cable.showCableDiagram, flipped);
  }

  ctx.restore();
}

/**
 * Get wire endpoint positions for a cable
 */
export function getCableWirePositions(cable: HarnessCable): CableWirePosition[] {
  const { width } = getCableDimensions(cable);
  const ox = cable.position?.x || 100;
  const oy = cable.position?.y || 100;
  const rotation = cable.rotation || 0;
  const flipped = cable.flipped || false;
  const wireCount = cable.wires?.length || cable.wireCount || 1;

  const positions: CableWirePosition[] = [];
  const wires = cable.wires || [];

  wires.forEach((wire, index) => {
    const localWireY = index * CABLE_WIRE_SPACING;

    let leftX = -CABLE_ENDPOINT_RADIUS;
    let leftY = localWireY;
    let rightX = width + CABLE_ENDPOINT_RADIUS;
    let rightY = localWireY;

    // Apply flip around center
    if (flipped) {
      const centerX = width / 2;
      leftX = 2 * centerX - leftX;
      rightX = 2 * centerX - rightX;
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

    positions.push({
      wireId: wire.id,
      pinId: wire.id,
      side: 'left',
      x: ox + rotatedLeftX,
      y: oy + rotatedLeftY
    });

    positions.push({
      wireId: wire.id,
      pinId: wire.id,
      side: 'right',
      x: ox + rotatedRightX,
      y: oy + rotatedRightY
    });
  });

  return positions;
}

/**
 * Get the centroid offset from the cable's position origin
 */
export function getCableCentroidOffset(cable: HarnessCable): CentroidOffset {
  const { width, height, hasPartName, hasInfoRow } = getCableDimensions(cable);
  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;
  const infoRowHeight = hasInfoRow ? ROW_HEIGHT : 0;

  const top = -HEADER_HEIGHT - partNameRowHeight - infoRowHeight - CABLE_WIRE_SPACING / 2;
  const bottom = top + height;

  const cx = width / 2;
  const cy = (top + bottom) / 2;

  return { cx, cy };
}

/**
 * Hit test for cable body
 */
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

  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;
  const infoRowHeight = hasInfoRow ? ROW_HEIGHT : 0;

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

  // Hit area bounds
  const left = -CABLE_ENDPOINT_RADIUS;
  const right = width + CABLE_ENDPOINT_RADIUS;
  const top = -HEADER_HEIGHT - partNameRowHeight - infoRowHeight - CABLE_WIRE_SPACING / 2;
  const bottom = (wireCount - 1) * CABLE_WIRE_SPACING + CABLE_WIRE_SPACING / 2;

  return localX >= left && localX <= right &&
    localY >= top && localY <= bottom;
}

/**
 * Hit test for cable diagram expand button
 */
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

  // Button position (bottom center)
  const btnY = (wireCount - 1) * CABLE_WIRE_SPACING + CABLE_WIRE_SPACING / 2 + 4;
  const btnX = width / 2 - EXPAND_BUTTON_SIZE / 2;

  if (localX >= btnX && localX <= btnX + EXPAND_BUTTON_SIZE &&
    localY >= btnY && localY <= btnY + EXPAND_BUTTON_SIZE) {
    return 'cableDiagram';
  }

  return null;
}

/**
 * Hit test for cable wire endpoint
 */
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
