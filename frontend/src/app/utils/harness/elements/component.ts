// Component element rendering and hit testing
import { HarnessComponent } from '../../../models/harness.model';
import {
  ROW_HEIGHT,
  HEADER_HEIGHT,
  PIN_COL_WIDTH,
  LABEL_COL_WIDTH,
  EXPAND_BUTTON_SIZE,
  COMPONENT_PIN_RADIUS,
  COMPONENT_IMAGE_WIDTH,
  COMPONENT_IMAGE_MAX_HEIGHT,
  PINOUT_IMAGE_WIDTH,
  PINOUT_IMAGE_HEIGHT
} from '../constants';
import { ComponentDimensions, ComponentPinPosition, CentroidOffset } from '../types';
import { roundRect, drawExpandButton, calculateMaxLabelWidth } from '../drawing-utils';
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

// Component header color (dark green)
const COMPONENT_HEADER_COLOR = '#002d04';

/**
 * Calculate component dimensions
 */
export function getComponentDimensions(component: HarnessComponent): ComponentDimensions {
  const hasPartName = !!component.partName;
  const hasComponentImage = !!component.showComponentImage && !!component.componentImage;
  const componentImageHeight = hasComponentImage ? COMPONENT_IMAGE_MAX_HEIGHT : 0;

  // Calculate width based on longest label
  let maxLabelWidth = LABEL_COL_WIDTH;
  const ctx = document.createElement('canvas').getContext('2d');
  if (ctx) {
    ctx.font = '12px monospace';
    for (const group of component.pinGroups) {
      const groupWidth = ctx.measureText(group.name || 'Group').width + 16;
      maxLabelWidth = Math.max(maxLabelWidth, groupWidth);
      for (const pin of group.pins) {
        if (pin.label) {
          const width = ctx.measureText(pin.label).width + 16;
          maxLabelWidth = Math.max(maxLabelWidth, width);
        }
      }
    }
    if (component.partName) {
      ctx.font = '11px monospace';
      const partNameWidth = ctx.measureText(component.partName).width + 16;
      maxLabelWidth = Math.max(maxLabelWidth, partNameWidth - PIN_COL_WIDTH);
    }
  }

  let width = PIN_COL_WIDTH + maxLabelWidth;
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

/**
 * Draw a component element on canvas
 */
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

  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;

  ctx.save();

  // Origin is at the first pin center
  ctx.translate(x, y - ROW_HEIGHT / 2);
  ctx.rotate((rotation * Math.PI) / 180);

  // Flip around center if flipped
  if (flipped) {
    const centerX = width / 2;
    const totalGroupHeight = groupHeights.reduce((a, b) => a + b, 0);
    const centerY = totalGroupHeight / 2 - HEADER_HEIGHT - componentImageHeight - partNameRowHeight - ROW_HEIGHT / 2;
    ctx.translate(centerX, centerY);
    ctx.scale(-1, 1);
    ctx.translate(-centerX, -centerY);
  }

  const left = 0;
  const top = -HEADER_HEIGHT - componentImageHeight - partNameRowHeight;

  // Draw pinout diagram if shown
  if (component.showPinoutDiagram && component.pinoutDiagramImage) {
    const pinoutImg = loadedImages?.get(`component-pinout-${component.id}`);
    drawPinoutDiagram(ctx, pinoutImg, left, top, height, flipped);
  }

  // Draw selection highlight
  if (isSelected) {
    drawSelectionHighlight(ctx, left, top, width, height);
  }

  // Draw main body
  drawElementBody(ctx, left, top, width, height);

  // Draw header
  drawElementHeader(ctx, left, top, width, COMPONENT_HEADER_COLOR, component.label || 'COMP', flipped);

  // Draw component image section if shown
  if (hasComponentImage && component.componentImage) {
    const compImg = loadedImages?.get(`component-img-${component.id}`);
    drawInlineImage(
      ctx, compImg, left, top + HEADER_HEIGHT, width,
      COMPONENT_IMAGE_WIDTH, componentImageHeight, flipped
    );
  }

  // Draw part name row if present
  if (hasPartName && component.partName) {
    drawPartNameRow(ctx, left, top + HEADER_HEIGHT + componentImageHeight, width, component.partName, flipped);
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

      // Draw pin row
      drawPinRow(
        ctx, left, rowTop, width,
        pin.number || String(i + 1),
        pin.label,
        (pinIndex + i) % 2 === 1,
        flipped,
        i > 0
      );

      // Wire connection point on the right side
      const circleX = left + width + COMPONENT_PIN_RADIUS;
      drawPinCircle(ctx, circleX, rowCenter, COMPONENT_PIN_RADIUS, COMPONENT_HEADER_COLOR);
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

/**
 * Get pin positions for a component
 */
export function getComponentPinPositions(component: HarnessComponent): ComponentPinPosition[] {
  const { width, hasPartName, componentImageHeight } = getComponentDimensions(component);
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

      // Pin connection is on the right side
      // Subtract ROW_HEIGHT/2 to account for drawing origin offset
      let localX = width + COMPONENT_PIN_RADIUS;
      let localY = localPinY - HEADER_HEIGHT - componentImageHeight - partNameRowHeight - ROW_HEIGHT / 2;

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

/**
 * Get the centroid offset for component
 */
export function getComponentCentroidOffset(component: HarnessComponent): CentroidOffset {
  const { width, height, hasPartName, componentImageHeight } = getComponentDimensions(component);
  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;

  const drawingTop = -HEADER_HEIGHT - componentImageHeight - partNameRowHeight;
  const drawingBottom = drawingTop + height;

  const localCy = (drawingTop + drawingBottom) / 2;
  const cx = width / 2;
  const cy = localCy - ROW_HEIGHT / 2;

  return { cx, cy };
}

/**
 * Hit test for component body
 */
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

  // Transform to local space (account for drawing origin at y - ROW_HEIGHT/2)
  const rad = (-rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = testX - ox;
  const dy = testY - oy + ROW_HEIGHT / 2;

  let localX = dx * cos - dy * sin;
  let localY = dx * sin + dy * cos;

  if (flipped) {
    const centerX = width / 2;
    localX = 2 * centerX - localX;
  }

  const left = -COMPONENT_PIN_RADIUS;
  const right = width + COMPONENT_PIN_RADIUS;
  const top = -HEADER_HEIGHT - componentImageHeight - partNameRowHeight;
  const bottom = height - HEADER_HEIGHT - componentImageHeight - partNameRowHeight;

  return localX >= left && localX <= right &&
    localY >= top && localY <= bottom;
}

/**
 * Hit test for component pin
 */
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

/**
 * Hit test for component expand buttons
 */
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

  // Transform to local space (account for drawing origin at y - ROW_HEIGHT/2)
  const rad = (-rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = testX - ox;
  const dy = testY - oy + ROW_HEIGHT / 2;

  let localX = dx * cos - dy * sin;
  let localY = dx * sin + dy * cos;

  if (flipped) {
    const centerX = width / 2;
    localX = 2 * centerX - localX;
  }

  const left = 0;
  const top = -HEADER_HEIGHT - componentImageHeight - partNameRowHeight;

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
