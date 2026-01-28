// Common drawing utilities for harness canvas rendering

import { EXPAND_BUTTON_SIZE } from './constants';

/**
 * Draw a rounded rectangle path
 */
export function roundRect(
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

/**
 * Draw an expand/collapse button (+/- icon)
 */
export function drawExpandButton(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  isExpanded: boolean,
  flipped: boolean = false
): void {
  ctx.save();

  // Counter flip for button if element is flipped
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

/**
 * Draw a green highlight circle around a pin
 */
export function drawPinHighlight(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  isStart: boolean
): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 10, 0, Math.PI * 2);
  ctx.strokeStyle = '#4caf50';
  ctx.lineWidth = 2;
  ctx.stroke();

  if (isStart) {
    ctx.fillStyle = 'rgba(76, 175, 80, 0.3)';
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Measure text width using a temporary canvas context
 */
export function measureTextWidth(text: string, font: string): number {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return 0;
  ctx.font = font;
  return ctx.measureText(text).width;
}

/**
 * Calculate maximum label width from an array of labels
 */
export function calculateMaxLabelWidth(labels: (string | undefined)[], font: string, padding: number = 16): number {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return 0;
  ctx.font = font;

  let maxWidth = 0;
  for (const label of labels) {
    if (label) {
      const width = ctx.measureText(label).width + padding;
      maxWidth = Math.max(maxWidth, width);
    }
  }
  return maxWidth;
}
