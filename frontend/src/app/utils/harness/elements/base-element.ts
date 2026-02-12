// Base element utilities shared by connectors, cables, and components

import {
  ROW_HEIGHT,
  HEADER_HEIGHT,
  PIN_COL_WIDTH,
  EXPAND_BUTTON_SIZE,
  PINOUT_IMAGE_WIDTH,
  PINOUT_IMAGE_HEIGHT
} from '../constants';
import { roundRect, drawExpandButton } from '../drawing-utils';

// Common colors used across elements
export const COLORS = {
  body: '#3a3a3a',
  border: '#555555',
  text: '#e0e0e0',
  pinBg: '#4a4a4a',
  selection: '#64b5f6',
  partName: '#888888',
  imageBackground: '#2a2a2a'
};

/**
 * Truncate text with ellipsis if it exceeds maxWidth
 */
export function truncateText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  if (!text) return '';
  const measured = ctx.measureText(text);
  if (measured.width <= maxWidth) return text;

  const ellipsis = '...';
  const ellipsisWidth = ctx.measureText(ellipsis).width;
  const availableWidth = maxWidth - ellipsisWidth;

  if (availableWidth <= 0) return ellipsis;

  // Binary search for the right truncation point
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const truncated = text.slice(0, mid);
    if (ctx.measureText(truncated).width <= availableWidth) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return text.slice(0, low) + ellipsis;
}

/**
 * Draw selection highlight around an element
 */
export function drawSelectionHighlight(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number
): void {
  ctx.strokeStyle = COLORS.selection;
  ctx.lineWidth = 3;
  ctx.setLineDash([5, 3]);
  roundRect(ctx, left - 4, top - 4, width + 8, height + 8, 6);
  ctx.stroke();
  ctx.setLineDash([]);
}

/**
 * Draw the main body background of an element
 */
export function drawElementBody(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number
): void {
  ctx.fillStyle = COLORS.body;
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1;
  roundRect(ctx, left, top, width, height, 4);
  ctx.fill();
  ctx.stroke();
}

/**
 * Draw the header row of an element
 */
export function drawElementHeader(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  headerColor: string,
  label: string,
  flipped: boolean
): void {
  // Header background
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
  ctx.strokeStyle = COLORS.border;
  ctx.beginPath();
  ctx.moveTo(left, top + HEADER_HEIGHT);
  ctx.lineTo(left + width, top + HEADER_HEIGHT);
  ctx.stroke();

  // Label text
  ctx.save();
  if (flipped) {
    ctx.scale(-1, 1);
  }
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const truncatedLabel = truncateText(ctx, label, width);
  const textX = flipped ? -(width / 2) : (width / 2);
  ctx.fillText(truncatedLabel, textX, top + HEADER_HEIGHT / 2);
  ctx.restore();
}

/**
 * Draw a part name row
 */
export function drawPartNameRow(
  ctx: CanvasRenderingContext2D,
  left: number,
  rowTop: number,
  width: number,
  partName: string,
  flipped: boolean
): void {
  const rowCenter = rowTop + ROW_HEIGHT / 2;

  // Background
  ctx.fillStyle = COLORS.imageBackground;
  ctx.fillRect(left + 1, rowTop, width - 2, ROW_HEIGHT);

  // Divider line
  ctx.strokeStyle = COLORS.border;
  ctx.beginPath();
  ctx.moveTo(left, rowTop + ROW_HEIGHT);
  ctx.lineTo(left + width, rowTop + ROW_HEIGHT);
  ctx.stroke();

  // Text
  ctx.save();
  if (flipped) {
    ctx.scale(-1, 1);
  }
  ctx.fillStyle = COLORS.partName;
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const truncatedPartName = truncateText(ctx, partName, width);
  const textX = flipped ? -(width / 2) : (width / 2);
  ctx.fillText(truncatedPartName, textX, rowCenter);
  ctx.restore();
}

/**
 * Draw a pin row with number and label
 */
export function drawPinRow(
  ctx: CanvasRenderingContext2D,
  left: number,
  rowTop: number,
  width: number,
  pinNumber: string,
  pinLabel: string | undefined,
  isAlternate: boolean,
  flipped: boolean,
  showDivider: boolean = true
): void {
  const rowCenter = rowTop + ROW_HEIGHT / 2;

  // Alternating background
  if (isAlternate) {
    ctx.fillStyle = COLORS.pinBg;
    ctx.fillRect(left + 1, rowTop, width - 2, ROW_HEIGHT);
  }

  // Row divider
  if (showDivider) {
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

  // Pin number
  ctx.fillStyle = COLORS.text;
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const pinNumX = flipped ? -(left + PIN_COL_WIDTH / 2) : (left + PIN_COL_WIDTH / 2);
  ctx.fillText(pinNumber, pinNumX, rowCenter);

  // Pin label
  if (pinLabel) {
    ctx.fillStyle = '#b0b0b0';
    ctx.font = '11px monospace';
    ctx.textAlign = flipped ? 'right' : 'left';
    const maxPinLabelWidth = width - PIN_COL_WIDTH;
    const truncatedPinLabel = truncateText(ctx, pinLabel, maxPinLabelWidth);
    const labelX = flipped ? -(left + PIN_COL_WIDTH + 8) : (left + PIN_COL_WIDTH + 8);
    ctx.fillText(truncatedPinLabel, labelX, rowCenter);
  }
  ctx.restore();
}

/**
 * Draw a wire connection circle (pin endpoint)
 */
export function drawPinCircle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  fillColor: string,
  highlighted: boolean = false
): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = highlighted ? '#ffeb3b' : fillColor;  // Yellow when highlighted
  ctx.fill();
  ctx.strokeStyle = highlighted ? '#ff9800' : '#ffffff';  // Orange stroke when highlighted
  ctx.lineWidth = highlighted ? 2.5 : 1.5;
  ctx.stroke();
}

/**
 * Draw a pinout diagram image to the left of an element
 */
export function drawPinoutDiagram(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | undefined,
  left: number,
  top: number,
  height: number,
  flipped: boolean
): void {
  if (!image) return;

  // Fit image within max bounds while preserving aspect ratio
  const aspectRatio = image.width / image.height;
  let imgWidth = PINOUT_IMAGE_WIDTH;
  let imgHeight = imgWidth / aspectRatio;
  if (imgHeight > PINOUT_IMAGE_HEIGHT) {
    imgHeight = PINOUT_IMAGE_HEIGHT;
    imgWidth = imgHeight * aspectRatio;
  }

  const imgX = left - imgWidth - 10;
  const imgY = top + (height - imgHeight) / 2;

  // Image background
  ctx.fillStyle = COLORS.imageBackground;
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1;
  roundRect(ctx, imgX - 4, imgY - 4, imgWidth + 8, imgHeight + 8, 4);
  ctx.fill();
  ctx.stroke();

  // Draw image (counter-flip if element is flipped)
  ctx.save();
  if (flipped) {
    ctx.translate(imgX + imgWidth / 2, imgY + imgHeight / 2);
    ctx.scale(-1, 1);
    ctx.translate(-(imgX + imgWidth / 2), -(imgY + imgHeight / 2));
  }
  ctx.drawImage(image, imgX, imgY, imgWidth, imgHeight);
  ctx.restore();
}

/**
 * Draw an inline image section (connector image or component image)
 */
export function drawInlineImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | undefined,
  left: number,
  sectionTop: number,
  elementWidth: number,
  imageWidth: number,
  imageMaxHeight: number,
  flipped: boolean
): void {
  // Section background
  ctx.fillStyle = COLORS.imageBackground;
  ctx.fillRect(left + 1, sectionTop, elementWidth - 2, imageMaxHeight);

  if (image) {
    const aspectRatio = image.width / image.height;
    let imgWidth = imageWidth;
    let imgHeight = imgWidth / aspectRatio;
    if (imgHeight > imageMaxHeight) {
      imgHeight = imageMaxHeight;
      imgWidth = imgHeight * aspectRatio;
    }
    const imgX = left + (elementWidth - imgWidth) / 2;
    const imgY = sectionTop + (imageMaxHeight - imgHeight) / 2;

    ctx.save();
    if (flipped) {
      ctx.translate(imgX + imgWidth / 2, imgY + imgHeight / 2);
      ctx.scale(-1, 1);
      ctx.translate(-(imgX + imgWidth / 2), -(imgY + imgHeight / 2));
    }
    ctx.drawImage(image, imgX, imgY, imgWidth, imgHeight);
    ctx.restore();
  }

  // Section divider
  ctx.strokeStyle = COLORS.border;
  ctx.beginPath();
  ctx.moveTo(left, sectionTop + imageMaxHeight);
  ctx.lineTo(left + elementWidth, sectionTop + imageMaxHeight);
  ctx.stroke();
}

// Re-export drawExpandButton for convenience
export { drawExpandButton };
