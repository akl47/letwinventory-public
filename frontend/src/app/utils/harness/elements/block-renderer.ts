// Unified block renderer — replaces connector.ts, cable.ts, component.ts
// One draw function, one hit test function, one pin position function for all block types.

import {
  HarnessBlock,
  HarnessBlockPin
} from '../../../models/harness.model';
import {
  ROW_HEIGHT,
  HEADER_HEIGHT,
  PIN_COL_WIDTH,
  PIN_CIRCLE_RADIUS,
  EXPAND_BUTTON_SIZE,
  CONNECTOR_IMAGE_WIDTH,
  CONNECTOR_IMAGE_MAX_HEIGHT,
  ELEMENT_DEFAULT_WIDTH,
  CABLE_WIRE_SPACING,
  CABLE_ENDPOINT_RADIUS,
  CABLE_DIAGRAM_WIDTH,
  CABLE_DIAGRAM_HEIGHT,
  COMPONENT_PIN_RADIUS,
  COMPONENT_IMAGE_WIDTH,
  COMPONENT_IMAGE_MAX_HEIGHT
} from '../constants';
import { BlockDimensions, BlockPinPosition, CentroidOffset } from '../types';
import { roundRect, drawExpandButton } from '../drawing-utils';
import { worldToLocal } from '../transform-utils';
import { getWireColorHex } from '../wire-color-map';
import {
  COLORS,
  drawSelectionHighlight,
  drawElementBody,
  drawElementHeader,
  drawPartNameRow,
  drawPinRow,
  drawPinCircle,
  drawPinoutDiagram,
  drawInlineImage,
  truncateText
} from './base-element';

// Mating point constants
const MATING_POINT_SIZE = 4;

// --- Dimensions ---

export function getBlockDimensions(block: HarnessBlock): BlockDimensions {
  if (block.blockType === 'cable') {
    return getCableBlockDimensions(block);
  }

  const pinCount = getPinRowCount(block);
  const hasPartName = !!block.partName;
  const hasPrimaryImage = !!block.showPrimaryImage && !!block.primaryImage;
  const primaryImageHeight = hasPrimaryImage
    ? (block.blockType === 'connector' ? CONNECTOR_IMAGE_MAX_HEIGHT : COMPONENT_IMAGE_MAX_HEIGHT)
    : 0;
  const hasInfoRow = false;

  const width = ELEMENT_DEFAULT_WIDTH;
  const height = HEADER_HEIGHT + primaryImageHeight + (hasPartName ? ROW_HEIGHT : 0) + (pinCount * ROW_HEIGHT);

  // For components, calculate group heights
  const groupHeights = getGroupHeights(block);

  return { width, height, hasPartName, hasInfoRow, hasPrimaryImage, primaryImageHeight, groupHeights };
}

function getCableBlockDimensions(block: HarnessBlock): BlockDimensions {
  const wireCount = block.pins.length || 1;
  const width = ELEMENT_DEFAULT_WIDTH;
  const hasPartName = !!block.partName;
  const hasInfoRow = !!(block.gaugeAWG || block.lengthMm);
  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;
  const infoRowHeight = hasInfoRow ? ROW_HEIGHT : 0;
  const hasPrimaryImage = false;
  const primaryImageHeight = 0;
  const height = HEADER_HEIGHT + partNameRowHeight + infoRowHeight + (wireCount * CABLE_WIRE_SPACING);

  return { width, height, hasPartName, hasInfoRow, hasPrimaryImage, primaryImageHeight, groupHeights: [] };
}

function getPinRowCount(block: HarnessBlock): number {
  if (block.blockType === 'component' && block.pinGroups?.length) {
    const pinMap = new Map(block.pins.map(p => [p.id, p]));
    return block.pinGroups.filter(g => !g.hidden).reduce((sum, g) =>
      sum + g.pinIds.filter(pid => !pinMap.get(pid)?.hidden).length, 0);
  }
  return block.pins.filter(p => !p.hidden).length || 1;
}

function getGroupHeights(block: HarnessBlock): number[] {
  if (block.blockType !== 'component' || !block.pinGroups?.length) return [];
  const pinMap = new Map(block.pins.map(p => [p.id, p]));
  return block.pinGroups.filter(g => !g.hidden).map(g =>
    g.pinIds.filter(pid => !pinMap.get(pid)?.hidden).length * ROW_HEIGHT);
}

// --- Drawing ---

export function drawBlock(
  ctx: CanvasRenderingContext2D,
  block: HarnessBlock,
  isSelected: boolean = false,
  loadedImages?: Map<string, HTMLImageElement>,
  highlightedPinIds?: Set<string>,
  highlightedMatingPinIds?: Set<string>
): void {
  if (block.blockType === 'cable') {
    drawCableBlock(ctx, block, isSelected, loadedImages, highlightedPinIds);
    return;
  }

  const dims = getBlockDimensions(block);
  const { width, height, hasPartName, hasPrimaryImage, primaryImageHeight } = dims;
  const x = block.position.x;
  const y = block.position.y;
  const rotation = block.rotation || 0;
  const flipped = block.flipped || false;

  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;

  ctx.save();

  // Origin at first pin center (consistent across all non-cable block types)
  ctx.translate(x, y - ROW_HEIGHT / 2);
  ctx.rotate((rotation * Math.PI) / 180);

  if (flipped) {
    const centerX = width / 2;
    const totalPinHeight = block.blockType === 'component'
      ? dims.groupHeights.reduce((a, b) => a + b, 0)
      : block.pins.length * ROW_HEIGHT;
    const centerY = totalPinHeight / 2 - HEADER_HEIGHT - primaryImageHeight - partNameRowHeight - ROW_HEIGHT / 2;
    ctx.translate(centerX, centerY);
    ctx.scale(-1, 1);
    ctx.translate(-centerX, -centerY);
  }

  const left = 0;
  const top = -HEADER_HEIGHT - primaryImageHeight - partNameRowHeight;

  // Pinout diagram (left side)
  if (block.showPinoutDiagram && block.pinoutDiagramImage) {
    const imgKey = block.blockType === 'connector'
      ? `pinout-${block.id}`
      : `component-pinout-${block.id}`;
    const pinoutImg = loadedImages?.get(imgKey);
    drawPinoutDiagram(ctx, pinoutImg, left, top, height, flipped);
  }

  // Selection highlight
  if (isSelected) {
    drawSelectionHighlight(ctx, left, top, width, height);
  }

  // Body
  drawElementBody(ctx, left, top, width, height);

  // Header
  drawElementHeader(ctx, left, top, width, block.headerColor, block.label, flipped);

  // Inline image section
  if (hasPrimaryImage && block.primaryImage) {
    const imgKey = block.blockType === 'connector'
      ? `connector-${block.id}`
      : `component-img-${block.id}`;
    const img = loadedImages?.get(imgKey);
    const imgWidth = block.blockType === 'connector' ? CONNECTOR_IMAGE_WIDTH : COMPONENT_IMAGE_WIDTH;
    drawInlineImage(ctx, img, left, top + HEADER_HEIGHT, width, imgWidth, primaryImageHeight, flipped);
  }

  // Part name row
  if (hasPartName && block.partName) {
    drawPartNameRow(ctx, left, top + HEADER_HEIGHT + primaryImageHeight, width, block.partName, flipped);
  }

  // Pin rows
  if (block.blockType === 'component' && block.pinGroups?.length) {
    drawComponentPinRows(ctx, block, dims, left, top, highlightedPinIds);
  } else {
    drawConnectorPinRows(ctx, block, dims, left, top, highlightedPinIds, highlightedMatingPinIds);
  }

  // Expand buttons
  drawBlockExpandButtons(ctx, block, dims, left, top, flipped);

  ctx.restore();
}

function drawConnectorPinRows(
  ctx: CanvasRenderingContext2D,
  block: HarnessBlock,
  dims: BlockDimensions,
  left: number,
  top: number,
  highlightedPinIds?: Set<string>,
  highlightedMatingPinIds?: Set<string>
): void {
  const { width, primaryImageHeight, hasPartName } = dims;
  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;
  const flipped = block.flipped || false;

  const visiblePins = block.pins.filter(p => !p.hidden);
  visiblePins.forEach((pin, index) => {
    const rowTop = top + HEADER_HEIGHT + primaryImageHeight + partNameRowHeight + (index * ROW_HEIGHT);
    const rowCenter = rowTop + ROW_HEIGHT / 2;

    drawPinRow(
      ctx, left, rowTop, width,
      pin.number || String(index + 1),
      pin.label,
      index % 2 === 1,
      flipped,
      index > 0
    );

    const isPinHighlighted = highlightedPinIds?.has(pin.id) || false;
    const isMatingHighlighted = highlightedMatingPinIds?.has(pin.id) || false;

    // Wire connection circle
    const circleX = block.pinSide === 'right'
      ? left + width + PIN_CIRCLE_RADIUS
      : left - PIN_CIRCLE_RADIUS;
    drawPinCircle(ctx, circleX, rowCenter, PIN_CIRCLE_RADIUS, block.headerColor, isPinHighlighted);

    // Mating point (opposite side)
    if (block.hasMatingPoints) {
      const matingX = block.pinSide === 'right'
        ? left - MATING_POINT_SIZE
        : left + width;
      drawMatingPoint(ctx, matingX, rowCenter - MATING_POINT_SIZE / 2, MATING_POINT_SIZE, block.headerColor, isMatingHighlighted);
    }
  });
}

function drawComponentPinRows(
  ctx: CanvasRenderingContext2D,
  block: HarnessBlock,
  dims: BlockDimensions,
  left: number,
  top: number,
  highlightedPinIds?: Set<string>
): void {
  const { width, primaryImageHeight, hasPartName } = dims;
  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;
  const flipped = block.flipped || false;
  const groups = block.pinGroups || [];
  const pinMap = new Map(block.pins.map(p => [p.id, p]));

  let currentY = top + HEADER_HEIGHT + primaryImageHeight + partNameRowHeight;
  let pinIndex = 0;
  let visibleGroupIndex = 0;

  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    if (group.hidden) continue;

    // Group divider (not before first visible group)
    if (visibleGroupIndex > 0) {
      ctx.strokeStyle = '#CCCCCC';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(left, currentY);
      ctx.lineTo(left + width, currentY);
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    const visiblePinIds = group.pinIds.filter(pid => !pinMap.get(pid)?.hidden);
    let rowIdx = 0;
    for (const pid of visiblePinIds) {
      const pin = pinMap.get(pid);
      if (!pin) continue;

      const rowTop = currentY + (rowIdx * ROW_HEIGHT);
      const rowCenter = rowTop + ROW_HEIGHT / 2;

      drawPinRow(
        ctx, left, rowTop, width,
        pin.number || String(rowIdx + 1),
        pin.label,
        (pinIndex + rowIdx) % 2 === 1,
        flipped,
        rowIdx > 0
      );

      const isPinHighlighted = highlightedPinIds?.has(pin.id) || false;
      if (group.matingConnector) {
        // Mating square on right side (same side as connector pins)
        const matingX = left + width;
        drawMatingPoint(ctx, matingX, rowCenter - MATING_POINT_SIZE / 2, MATING_POINT_SIZE, block.headerColor, isPinHighlighted);
      } else {
        // Wire connection circle on right side
        const circleX = left + width + COMPONENT_PIN_RADIUS;
        drawPinCircle(ctx, circleX, rowCenter, COMPONENT_PIN_RADIUS, block.headerColor, isPinHighlighted);
      }
      rowIdx++;
    }

    currentY += visiblePinIds.length * ROW_HEIGHT;
    pinIndex += visiblePinIds.length;
    visibleGroupIndex++;
  }
}

function drawCableBlock(
  ctx: CanvasRenderingContext2D,
  block: HarnessBlock,
  isSelected: boolean,
  loadedImages?: Map<string, HTMLImageElement>,
  highlightedPinIds?: Set<string>
): void {
  const dims = getBlockDimensions(block);
  const { width, height, hasPartName, hasInfoRow } = dims;
  const x = block.position.x;
  const y = block.position.y;
  const rotation = block.rotation || 0;
  const flipped = block.flipped || false;

  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;
  const infoRowHeight = hasInfoRow ? ROW_HEIGHT : 0;
  const wireCount = block.pins.length || 1;

  ctx.save();

  // Cable origin: first wire position (same as connector/component origin with ROW_HEIGHT/2 offset applied in migration)
  ctx.translate(x, y - ROW_HEIGHT / 2);
  ctx.rotate((rotation * Math.PI) / 180);

  if (flipped) {
    const centerX = width / 2;
    const centerY = (wireCount - 1) * CABLE_WIRE_SPACING / 2;
    ctx.translate(centerX, centerY);
    ctx.scale(-1, 1);
    ctx.translate(-centerX, -centerY);
  }

  const left = 0;
  const top = -HEADER_HEIGHT - partNameRowHeight - infoRowHeight - CABLE_WIRE_SPACING / 2;

  // Selection highlight
  if (isSelected) {
    drawSelectionHighlight(ctx, left, top, width, height);
  }

  // Body
  drawElementBody(ctx, left, top, width, height);

  // Header
  drawElementHeader(ctx, left, top, width, block.headerColor, block.label, flipped);

  // Part name row
  if (hasPartName && block.partName) {
    drawPartNameRow(ctx, left, top + HEADER_HEIGHT, width, block.partName, flipped);
  }

  // Info row (gauge + length)
  if (hasInfoRow) {
    const infoRowTop = top + HEADER_HEIGHT + partNameRowHeight;
    const infoRowCenter = infoRowTop + ROW_HEIGHT / 2;

    ctx.fillStyle = COLORS.imageBackground;
    ctx.fillRect(left + 1, infoRowTop, width - 2, ROW_HEIGHT);

    ctx.strokeStyle = COLORS.border;
    ctx.beginPath();
    ctx.moveTo(left, infoRowTop + ROW_HEIGHT);
    ctx.lineTo(left + width, infoRowTop + ROW_HEIGHT);
    ctx.stroke();

    ctx.save();
    if (flipped) ctx.scale(-1, 1);

    if (block.gaugeAWG) {
      ctx.fillStyle = COLORS.partName;
      ctx.font = '10px monospace';
      ctx.textAlign = flipped ? 'right' : 'left';
      ctx.textBaseline = 'middle';
      const gaugeX = flipped ? -(left + 6) : (left + 6);
      ctx.fillText(`${block.gaugeAWG} AWG`, gaugeX, infoRowCenter);
    }

    if (block.lengthMm) {
      ctx.fillStyle = COLORS.partName;
      ctx.font = '10px monospace';
      ctx.textAlign = flipped ? 'left' : 'right';
      ctx.textBaseline = 'middle';
      const lengthX = flipped ? -(left + width - 6) : (left + width - 6);
      ctx.fillText(`${block.lengthMm.toLocaleString()}mm`, lengthX, infoRowCenter);
    }
    ctx.restore();
  }

  // Draw wires
  block.pins.forEach((pin, index) => {
    const wireY = index * CABLE_WIRE_SPACING;
    const wireColor = getWireColorHex(pin.wireColorCode || pin.wireColor || 'BK');
    const isLeftHighlighted = highlightedPinIds?.has(pin.id) || false;
    const pairedId = pin.pairedPinId;
    const isRightHighlighted = pairedId ? (highlightedPinIds?.has(pairedId) || false) : false;

    // Wire line
    ctx.beginPath();
    ctx.strokeStyle = wireColor;
    ctx.lineWidth = 3;
    ctx.moveTo(left + CABLE_ENDPOINT_RADIUS, wireY);
    ctx.lineTo(left + width - CABLE_ENDPOINT_RADIUS, wireY);
    ctx.stroke();

    // Left endpoint
    ctx.beginPath();
    ctx.arc(left - CABLE_ENDPOINT_RADIUS, wireY, CABLE_ENDPOINT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = isLeftHighlighted ? '#ffeb3b' : wireColor;
    ctx.fill();
    ctx.strokeStyle = isLeftHighlighted ? '#ff9800' : '#ffffff';
    ctx.lineWidth = isLeftHighlighted ? 2.5 : 1.5;
    ctx.stroke();

    // Right endpoint
    ctx.beginPath();
    ctx.arc(left + width + CABLE_ENDPOINT_RADIUS, wireY, CABLE_ENDPOINT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = isRightHighlighted ? '#ffeb3b' : wireColor;
    ctx.fill();
    ctx.strokeStyle = isRightHighlighted ? '#ff9800' : '#ffffff';
    ctx.lineWidth = isRightHighlighted ? 2.5 : 1.5;
    ctx.stroke();

    // Wire label
    const labelParts: string[] = [];
    if (pin.wireColorCode || pin.wireColor) {
      labelParts.push(pin.wireColorCode || pin.wireColor || '');
    }
    if (pin.wireLabel) {
      labelParts.push(pin.wireLabel);
    }
    const labelText = labelParts.join(' - ');

    if (labelText) {
      ctx.font = '10px monospace';
      const truncatedLabel = truncateText(ctx, labelText, width);
      const textWidth = ctx.measureText(truncatedLabel).width;
      const boxPadding = 4;
      const boxWidth = textWidth + boxPadding * 2;
      const boxHeight = 14;
      const boxX = left + width / 2 - boxWidth / 2;
      const boxY = wireY - boxHeight / 2;

      ctx.fillStyle = COLORS.body;
      ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

      ctx.save();
      if (flipped) ctx.scale(-1, 1);
      ctx.fillStyle = COLORS.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const labelX = flipped ? -(width / 2) : (width / 2);
      ctx.fillText(truncatedLabel, labelX, wireY);
      ctx.restore();
    }
  });

  // Cable diagram below
  if (block.showPrimaryImage && block.primaryImage) {
    const diagramImg = loadedImages?.get(`cable-diagram-${block.id}`);
    if (diagramImg) {
      const aspectRatio = diagramImg.width / diagramImg.height;
      let drawWidth = CABLE_DIAGRAM_WIDTH;
      let drawHeight = drawWidth / aspectRatio;
      if (drawHeight > CABLE_DIAGRAM_HEIGHT) {
        drawHeight = CABLE_DIAGRAM_HEIGHT;
        drawWidth = drawHeight * aspectRatio;
      }

      const diagramY = (wireCount - 1) * CABLE_WIRE_SPACING + CABLE_WIRE_SPACING / 2 + 10;
      const imgX = left + (width - drawWidth) / 2;

      ctx.fillStyle = COLORS.imageBackground;
      ctx.strokeStyle = COLORS.border;
      ctx.lineWidth = 1;
      roundRect(ctx, imgX - 4, diagramY - 4, drawWidth + 8, drawHeight + 8, 4);
      ctx.fill();
      ctx.stroke();

      ctx.save();
      if (flipped) {
        ctx.translate(imgX + drawWidth / 2, diagramY + drawHeight / 2);
        ctx.scale(-1, 1);
        ctx.translate(-(imgX + drawWidth / 2), -(diagramY + drawHeight / 2));
      }
      ctx.drawImage(diagramImg, imgX, diagramY, drawWidth, drawHeight);
      ctx.restore();
    }
  }

  // Expand button for cable diagram
  if (block.primaryImage) {
    const btnY = (wireCount - 1) * CABLE_WIRE_SPACING + CABLE_WIRE_SPACING / 2 + 4;
    const btnX = left + width / 2 - EXPAND_BUTTON_SIZE / 2;
    drawExpandButton(ctx, btnX, btnY, !!block.showPrimaryImage, flipped);
  }

  ctx.restore();
}

function drawBlockExpandButtons(
  ctx: CanvasRenderingContext2D,
  block: HarnessBlock,
  dims: BlockDimensions,
  left: number,
  top: number,
  flipped: boolean
): void {
  // Primary image expand button (top-right of header)
  if (block.primaryImage) {
    const btnX = left + dims.width - EXPAND_BUTTON_SIZE - 2;
    const btnY = top + (HEADER_HEIGHT - EXPAND_BUTTON_SIZE) / 2;
    drawExpandButton(ctx, btnX, btnY, !!block.showPrimaryImage, flipped);
  }

  // Pinout diagram expand button (left of element)
  if (block.pinoutDiagramImage) {
    if (block.blockType === 'component' && dims.groupHeights.length) {
      const totalPinHeight = dims.groupHeights.reduce((a, b) => a + b, 0);
      const btnX = left - EXPAND_BUTTON_SIZE - 4;
      const partNameRowHeight = dims.hasPartName ? ROW_HEIGHT : 0;
      const btnY = top + HEADER_HEIGHT + dims.primaryImageHeight + partNameRowHeight + (totalPinHeight / 2) - (EXPAND_BUTTON_SIZE / 2);
      drawExpandButton(ctx, btnX, btnY, !!block.showPinoutDiagram, flipped);
    } else {
      const btnX = left - EXPAND_BUTTON_SIZE - 4;
      const btnY = top + (HEADER_HEIGHT - EXPAND_BUTTON_SIZE) / 2;
      drawExpandButton(ctx, btnX, btnY, !!block.showPinoutDiagram, flipped);
    }
  }
}

function drawMatingPoint(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  fillColor: string,
  highlighted: boolean = false
): void {
  ctx.fillStyle = highlighted ? '#ffeb3b' : fillColor;
  ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = highlighted ? '#ff9800' : '#ffffff';
  ctx.lineWidth = highlighted ? 2 : 1;
  ctx.strokeRect(x, y, size, size);
}

// --- Pin Positions ---

export function getBlockPinPositions(block: HarnessBlock): BlockPinPosition[] {
  if (block.blockType === 'cable') {
    return getCableBlockPinPositions(block);
  }

  const dims = getBlockDimensions(block);
  const { width, primaryImageHeight, hasPartName } = dims;
  const ox = block.position.x;
  const oy = block.position.y;
  const rotation = block.rotation || 0;
  const flipped = block.flipped || false;
  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;

  const positions: BlockPinPosition[] = [];
  const pinRadius = block.blockType === 'component' ? COMPONENT_PIN_RADIUS : PIN_CIRCLE_RADIUS;

  if (block.blockType === 'component' && block.pinGroups?.length) {
    // Component: iterate through visible pin groups, skip hidden pins
    const pinMap = new Map(block.pins.map(p => [p.id, p]));
    let currentLocalY = primaryImageHeight + partNameRowHeight + HEADER_HEIGHT;
    for (const group of block.pinGroups) {
      if (group.hidden) continue;
      const visiblePinIds = group.pinIds.filter(pid => !pinMap.get(pid)?.hidden);
      const isMatingGroup = !!group.matingConnector;
      for (let pi = 0; pi < visiblePinIds.length; pi++) {
        const pinId = visiblePinIds[pi];
        const localPinY = currentLocalY + (pi * ROW_HEIGHT) + ROW_HEIGHT / 2;

        let localX = isMatingGroup
          ? width + MATING_POINT_SIZE / 2  // Right side for mating
          : width + pinRadius;              // Right side for wire
        let localY = localPinY - HEADER_HEIGHT - primaryImageHeight - partNameRowHeight;

        if (flipped) {
          localX = width - localX;
        }

        const rad = (rotation * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const rotX = localX * cos - localY * sin;
        const rotY = localX * sin + localY * cos;

        positions.push({
          pinId,
          x: ox + rotX,
          y: (oy - ROW_HEIGHT / 2) + rotY,
          side: isMatingGroup ? 'mating' : 'right',
          groupId: group.id
        });
      }
      currentLocalY += visiblePinIds.length * ROW_HEIGHT;
    }
  } else {
    // Connector: wire and mating positions
    const visiblePins = block.pins.filter(p => !p.hidden);
    visiblePins.forEach((pin, index) => {
      const rowCenter = index * ROW_HEIGHT + ROW_HEIGHT / 2;

      // Wire connection point
      let wireX = block.pinSide === 'right'
        ? width + pinRadius
        : -pinRadius;
      let wireY = rowCenter;

      if (flipped) {
        const centerX = width / 2;
        wireX = 2 * centerX - wireX;
      }

      const rad = (rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const rotWireX = wireX * cos - wireY * sin;
      const rotWireY = wireX * sin + wireY * cos;

      positions.push({
        pinId: pin.id,
        x: ox + rotWireX,
        y: (oy - ROW_HEIGHT / 2) + rotWireY,
        side: block.pinSide === 'left' ? 'left' : 'right'
      });

      // Mating point (opposite side)
      if (block.hasMatingPoints) {
        let matingX = block.pinSide === 'right'
          ? -MATING_POINT_SIZE / 2
          : width + MATING_POINT_SIZE / 2;
        let matingY = rowCenter;

        if (flipped) {
          const centerX = width / 2;
          matingX = 2 * centerX - matingX;
        }

        const rotMatingX = matingX * cos - matingY * sin;
        const rotMatingY = matingX * sin + matingY * cos;

        positions.push({
          pinId: pin.id,
          x: ox + rotMatingX,
          y: (oy - ROW_HEIGHT / 2) + rotMatingY,
          side: 'mating'
        });
      }
    });
  }

  return positions;
}

function getCableBlockPinPositions(block: HarnessBlock): BlockPinPosition[] {
  const dims = getBlockDimensions(block);
  const { width } = dims;
  const ox = block.position.x;
  const oy = block.position.y;
  const rotation = block.rotation || 0;
  const flipped = block.flipped || false;

  const positions: BlockPinPosition[] = [];

  block.pins.forEach((pin, index) => {
    const localWireY = index * CABLE_WIRE_SPACING;

    let leftX = -CABLE_ENDPOINT_RADIUS;
    let leftY = localWireY;
    let rightX = width + CABLE_ENDPOINT_RADIUS;
    let rightY = localWireY;

    if (flipped) {
      const centerX = width / 2;
      leftX = 2 * centerX - leftX;
      rightX = 2 * centerX - rightX;
      [leftX, rightX] = [rightX, leftX];
    }

    const rad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const rotLeftX = leftX * cos - leftY * sin;
    const rotLeftY = leftX * sin + leftY * cos;
    const rotRightX = rightX * cos - rightY * sin;
    const rotRightY = rightX * sin + rightY * cos;

    // Left pin
    positions.push({
      pinId: pin.id,
      x: ox + rotLeftX,
      y: (oy - ROW_HEIGHT / 2) + rotLeftY,
      side: 'left'
    });

    // Right pin (paired)
    const rightPinId = pin.pairedPinId || pin.id.replace(':L', ':R');
    positions.push({
      pinId: rightPinId,
      x: ox + rotRightX,
      y: (oy - ROW_HEIGHT / 2) + rotRightY,
      side: 'right'
    });
  });

  return positions;
}

// --- Centroid ---

export function getBlockCentroidOffset(block: HarnessBlock): CentroidOffset {
  const dims = getBlockDimensions(block);

  if (block.blockType === 'cable') {
    const { width, height, hasPartName, hasInfoRow } = dims;
    const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;
    const infoRowHeight = hasInfoRow ? ROW_HEIGHT : 0;
    const wireCount = block.pins.length || 1;

    const top = -HEADER_HEIGHT - partNameRowHeight - infoRowHeight - CABLE_WIRE_SPACING / 2;
    const bottom = top + height;

    return { cx: width / 2, cy: (top + bottom) / 2 };
  }

  const { width, height, hasPartName, primaryImageHeight } = dims;
  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;
  const drawingTop = -HEADER_HEIGHT - primaryImageHeight - partNameRowHeight;
  const drawingBottom = drawingTop + height;
  const localCy = (drawingTop + drawingBottom) / 2;

  return { cx: width / 2, cy: localCy - ROW_HEIGHT / 2 };
}

// --- Hit Testing ---

export function hitTestBlock(
  block: HarnessBlock,
  testX: number,
  testY: number
): boolean {
  if (block.blockType === 'cable') {
    return hitTestCableBlock(block, testX, testY);
  }

  const dims = getBlockDimensions(block);
  const { width, height, hasPartName, primaryImageHeight } = dims;
  const ox = block.position.x;
  const oy = block.position.y;
  const rotation = block.rotation || 0;
  const flipped = block.flipped || false;
  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;
  const pinRadius = block.blockType === 'component' ? COMPONENT_PIN_RADIUS : PIN_CIRCLE_RADIUS;
  const pinCount = getPinRowCount(block);

  const local = worldToLocal(testX, testY, {
    ox, oy, rotation, flipped, width
  });

  const left = -pinRadius;
  const right = width + pinRadius;
  const top = -HEADER_HEIGHT - primaryImageHeight - partNameRowHeight - ROW_HEIGHT / 2;
  const bottom = (pinCount - 1) * ROW_HEIGHT + ROW_HEIGHT / 2;

  return local.x >= left && local.x <= right &&
    local.y >= top && local.y <= bottom;
}

function hitTestCableBlock(
  block: HarnessBlock,
  testX: number,
  testY: number
): boolean {
  const dims = getBlockDimensions(block);
  const { width, hasPartName, hasInfoRow } = dims;
  const ox = block.position.x;
  const oy = block.position.y;
  const rotation = block.rotation || 0;
  const flipped = block.flipped || false;
  const wireCount = block.pins.length || 1;

  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;
  const infoRowHeight = hasInfoRow ? ROW_HEIGHT : 0;

  // Cable uses same origin convention now (y - ROW_HEIGHT/2 in draw)
  const rad = (-rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = testX - ox;
  const dy = testY - (oy - ROW_HEIGHT / 2);

  let localX = dx * cos - dy * sin;
  let localY = dx * sin + dy * cos;

  if (flipped) {
    const centerX = width / 2;
    localX = 2 * centerX - localX;
  }

  const left = -CABLE_ENDPOINT_RADIUS;
  const right = width + CABLE_ENDPOINT_RADIUS;
  const top = -HEADER_HEIGHT - partNameRowHeight - infoRowHeight - CABLE_WIRE_SPACING / 2;
  const bottom = (wireCount - 1) * CABLE_WIRE_SPACING + CABLE_WIRE_SPACING / 2;

  return localX >= left && localX <= right &&
    localY >= top && localY <= bottom;
}

export function hitTestBlockPin(
  block: HarnessBlock,
  testX: number,
  testY: number
): { pinId: string; side: 'left' | 'right' | 'mating' } | null {
  const positions = getBlockPinPositions(block);

  for (const pos of positions) {
    const hitRadius = pos.side === 'mating'
      ? MATING_POINT_SIZE + 4
      : (block.blockType === 'cable' ? CABLE_ENDPOINT_RADIUS + 4 : PIN_CIRCLE_RADIUS + 6);
    const dist = Math.sqrt(Math.pow(testX - pos.x, 2) + Math.pow(testY - pos.y, 2));
    if (dist <= hitRadius) {
      return { pinId: pos.pinId, side: pos.side };
    }
  }

  return null;
}

export function hitTestBlockButton(
  block: HarnessBlock,
  testX: number,
  testY: number
): string | null {
  if (block.blockType === 'cable') {
    return hitTestCableBlockButton(block, testX, testY);
  }

  const dims = getBlockDimensions(block);
  const { width, hasPartName, primaryImageHeight, groupHeights } = dims;
  const ox = block.position.x;
  const oy = block.position.y;
  const rotation = block.rotation || 0;
  const flipped = block.flipped || false;
  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;

  const local = worldToLocal(testX, testY, {
    ox, oy, rotation, flipped, width
  });

  const left = 0;
  const top = -HEADER_HEIGHT - primaryImageHeight - partNameRowHeight - ROW_HEIGHT / 2;

  // Primary image button (top-right of header)
  if (block.primaryImage) {
    const btnX = left + width - EXPAND_BUTTON_SIZE - 2;
    const btnY = top + (HEADER_HEIGHT - EXPAND_BUTTON_SIZE) / 2;

    if (local.x >= btnX && local.x <= btnX + EXPAND_BUTTON_SIZE &&
      local.y >= btnY && local.y <= btnY + EXPAND_BUTTON_SIZE) {
      return 'primaryImage';
    }
  }

  // Pinout diagram button
  if (block.pinoutDiagramImage) {
    let btnX: number, btnY: number;
    if (block.blockType === 'component' && groupHeights.length) {
      const totalPinHeight = groupHeights.reduce((a, b) => a + b, 0);
      btnX = left - EXPAND_BUTTON_SIZE - 4;
      btnY = (totalPinHeight / 2) - (EXPAND_BUTTON_SIZE / 2);
    } else {
      btnX = left - EXPAND_BUTTON_SIZE - 4;
      btnY = top + (HEADER_HEIGHT - EXPAND_BUTTON_SIZE) / 2;
    }

    if (local.x >= btnX && local.x <= btnX + EXPAND_BUTTON_SIZE &&
      local.y >= btnY && local.y <= btnY + EXPAND_BUTTON_SIZE) {
      return 'pinoutDiagram';
    }
  }

  return null;
}

function hitTestCableBlockButton(
  block: HarnessBlock,
  testX: number,
  testY: number
): string | null {
  if (!block.primaryImage) return null;

  const dims = getBlockDimensions(block);
  const { width } = dims;
  const ox = block.position.x;
  const oy = block.position.y;
  const rotation = block.rotation || 0;
  const flipped = block.flipped || false;
  const wireCount = block.pins.length || 1;

  const rad = (-rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = testX - ox;
  const dy = testY - (oy - ROW_HEIGHT / 2);

  let localX = dx * cos - dy * sin;
  let localY = dx * sin + dy * cos;

  if (flipped) {
    const centerX = width / 2;
    localX = 2 * centerX - localX;
  }

  const btnY = (wireCount - 1) * CABLE_WIRE_SPACING + CABLE_WIRE_SPACING / 2 + 4;
  const btnX = width / 2 - EXPAND_BUTTON_SIZE / 2;

  if (localX >= btnX && localX <= btnX + EXPAND_BUTTON_SIZE &&
    localY >= btnY && localY <= btnY + EXPAND_BUTTON_SIZE) {
    return 'primaryImage';
  }

  return null;
}
