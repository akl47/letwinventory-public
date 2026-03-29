// Component element rendering and hit testing
import { HarnessComponent } from '../../../models/harness.model';
import {
  ROW_HEIGHT,
  HEADER_HEIGHT,
  PIN_COL_WIDTH,
  EXPAND_BUTTON_SIZE,
  COMPONENT_PIN_RADIUS,
  COMPONENT_IMAGE_WIDTH,
  COMPONENT_IMAGE_MAX_HEIGHT,
  PINOUT_IMAGE_WIDTH,
  PINOUT_IMAGE_HEIGHT,
  ELEMENT_DEFAULT_WIDTH
} from '../constants';
import { ComponentDimensions, ComponentPinPosition, CentroidOffset } from '../types';
import { roundRect, drawExpandButton } from '../drawing-utils';
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

  // Fixed width matching connectors and cables
  const width = ELEMENT_DEFAULT_WIDTH;

  // Calculate height based on visible pin groups and pins
  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;
  const groupHeights: number[] = [];
  let totalPinHeight = 0;
  for (const group of component.pinGroups) {
    if (group.hidden) continue;
    const visiblePins = group.pins.filter(p => !p.hidden);
    const groupHeight = visiblePins.length * ROW_HEIGHT;
    groupHeights.push(groupHeight);
    totalPinHeight += groupHeight;
  }

  const height = HEADER_HEIGHT + componentImageHeight + partNameRowHeight + totalPinHeight;

  return { width, height, hasPartName, hasComponentImage, componentImageHeight, groupHeights };
}

/**
 * Draw a component element on canvas
 * Origin = pin 0's connection point (right side circle center)
 * Body draws to the LEFT of pin 0
 */
export function drawComponent(
  ctx: CanvasRenderingContext2D,
  component: HarnessComponent,
  isSelected: boolean = false,
  loadedImages?: Map<string, HTMLImageElement>,
  highlightedPinIds?: Set<string>
): void {
  const { width, height, hasPartName, hasComponentImage, componentImageHeight, groupHeights } = getComponentDimensions(component);
  const x = component.position?.x || 100;
  const y = component.position?.y || 100;
  const rotation = component.rotation || 0;
  const flipped = component.flipped || false;

  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;

  ctx.save();

  // Origin is at pin 0's connection point (right side)
  ctx.translate(x, y);
  ctx.rotate((rotation * Math.PI) / 180);

  // Flip around center of body
  if (flipped) {
    const bodyLeft = -width;
    const bodyRight = 0;
    const centerX = (bodyLeft + bodyRight) / 2;
    const totalGroupHeight = groupHeights.reduce((a, b) => a + b, 0);
    const totalPins = Math.max(totalGroupHeight / ROW_HEIGHT, 1);
    const bodyTop = -ROW_HEIGHT / 2 - HEADER_HEIGHT - componentImageHeight - partNameRowHeight;
    const bodyBottom = (totalPins - 1) * ROW_HEIGHT + ROW_HEIGHT / 2;
    const centerY = (bodyTop + bodyBottom) / 2;
    ctx.translate(centerX, centerY);
    ctx.scale(-1, 1);
    ctx.translate(-centerX, -centerY);
  }

  // Body edge at pin 0 (x=0). Body extends left. Circle extends right.
  const left = -width;
  const top = -ROW_HEIGHT / 2 - HEADER_HEIGHT - componentImageHeight - partNameRowHeight;

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
  let pinIndex = 0;
  let currentPinOffset = 0;

  for (let gi = 0; gi < component.pinGroups.length; gi++) {
    const group = component.pinGroups[gi];

    // Draw thicker divider line between pin groups (not before first group)
    if (gi > 0 && currentPinOffset > 0) {
      const dividerY = currentPinOffset * ROW_HEIGHT - ROW_HEIGHT / 2;
      ctx.strokeStyle = '#CCCCCC';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(left, dividerY);
      ctx.lineTo(left + width, dividerY);
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    // Draw pins in this group
    for (let i = 0; i < group.pins.length; i++) {
      const pin = group.pins[i];
      const globalPinIndex = currentPinOffset + i;
      const rowCenter = globalPinIndex * ROW_HEIGHT; // Pin center in local space
      const rowTop = rowCenter - ROW_HEIGHT / 2;

      // Draw pin row (inside the body)
      drawPinRow(
        ctx, left, rowTop, width,
        pin.number || String(i + 1),
        pin.label,
        (pinIndex + i) % 2 === 1,
        flipped,
        i > 0
      );

      // Check if this pin should be highlighted
      const isPinHighlighted = highlightedPinIds?.has(pin.id) || false;

      // Wire connection point at pin center (x=0 = the origin axis)
      // Pin circle extends right from body edge
      drawPinCircle(ctx, COMPONENT_PIN_RADIUS, rowCenter, COMPONENT_PIN_RADIUS, COMPONENT_HEADER_COLOR, isPinHighlighted);
    }

    currentPinOffset += group.pins.length;
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
 * Pin 0 is at local (0, 0), pin i at local (0, i * ROW_HEIGHT)
 * Origin = (ox, oy) = pin 0's connection point
 */
export function getComponentPinPositions(component: HarnessComponent): ComponentPinPosition[] {
  const { width, hasPartName, componentImageHeight } = getComponentDimensions(component);
  const ox = component.position?.x || 100;
  const oy = component.position?.y || 100;
  const rotation = component.rotation || 0;
  const flipped = component.flipped || false;

  const positions: ComponentPinPosition[] = [];
  let currentPinOffset = 0;

  for (const group of component.pinGroups) {
    if (group.hidden) continue;
    const visiblePins = group.pins.filter(p => !p.hidden);
    for (let pi = 0; pi < visiblePins.length; pi++) {
      const pin = visiblePins[pi];
      const globalPinIndex = currentPinOffset + pi;

      // Pin connection at local (0, globalPinIndex * ROW_HEIGHT)
      let localX = 0;
      let localY = globalPinIndex * ROW_HEIGHT;

      // Apply flip around body center
      if (flipped) {
        const bodyLeft = -width;
        const bodyRight = 0;
        const centerX = (bodyLeft + bodyRight) / 2;
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

    currentPinOffset += visiblePins.length;
  }

  return positions;
}

/**
 * Get the centroid offset for component (relative to pin 0 at origin)
 */
export function getComponentCentroidOffset(component: HarnessComponent): CentroidOffset {
  const { width, height, hasPartName, componentImageHeight } = getComponentDimensions(component);
  const partNameRowHeight = hasPartName ? ROW_HEIGHT : 0;

  let totalPins = 0;
  for (const group of component.pinGroups) {
    if (group.hidden) continue;
    totalPins += group.pins.filter(p => !p.hidden).length;
  }
  totalPins = Math.max(totalPins, 1);

  // Body: left = -(COMPONENT_PIN_RADIUS + width), top = -HEADER_HEIGHT - extras
  // Body: right = -COMPONENT_PIN_RADIUS, bottom = (totalPins - 1) * ROW_HEIGHT
  const bodyTop = -HEADER_HEIGHT - componentImageHeight - partNameRowHeight;
  const bodyBottom = (totalPins - 1) * ROW_HEIGHT;

  const cx = -(width / 2);
  const cy = (bodyTop + bodyBottom) / 2;

  return { cx, cy };
}

/**
 * Hit test for component body
 * Origin = pin 0's connection point (ox, oy)
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

  let totalPins = 0;
  for (const group of component.pinGroups || []) {
    if (group.hidden) continue;
    totalPins += group.pins?.filter(p => !p.hidden).length || 0;
  }
  totalPins = Math.max(totalPins, 1);

  // Transform to local space (origin at pin 0)
  const rad = (-rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = testX - ox;
  const dy = testY - oy;

  let localX = dx * cos - dy * sin;
  let localY = dx * sin + dy * cos;

  if (flipped) {
    const bodyLeft = -width;
    const bodyRight = 0;
    const centerX = (bodyLeft + bodyRight) / 2;
    localX = 2 * centerX - localX;
  }

  const left = -(width + COMPONENT_PIN_RADIUS);
  const right = COMPONENT_PIN_RADIUS;
  const top = -HEADER_HEIGHT - componentImageHeight - partNameRowHeight - ROW_HEIGHT / 2;
  const bottom = (totalPins - 1) * ROW_HEIGHT + ROW_HEIGHT / 2;

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

  // Transform to local space (origin at pin 0)
  const rad = (-rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = testX - ox;
  const dy = testY - oy;

  let localX = dx * cos - dy * sin;
  let localY = dx * sin + dy * cos;

  if (flipped) {
    const bodyLeft = -width;
    const bodyRight = 0;
    const centerX = (bodyLeft + bodyRight) / 2;
    localX = 2 * centerX - localX;
  }

  const left = -width;
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
