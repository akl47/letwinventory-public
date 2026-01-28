// Coordinate transformation utilities for harness canvas rendering

import { TransformParams, CentroidOffset } from './types';

/**
 * Transform a local coordinate to world space
 * Applies rotation and flip transformations
 */
export function localToWorld(
  localX: number,
  localY: number,
  params: TransformParams
): { x: number; y: number } {
  const { ox, oy, rotation, flipped, width, originOffsetY = 0 } = params;

  let x = localX;
  let y = localY;

  // Apply flip
  if (flipped) {
    const centerX = width / 2;
    x = 2 * centerX - x;
  }

  // Apply rotation
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rotatedX = x * cos - y * sin;
  const rotatedY = x * sin + y * cos;

  return {
    x: ox + rotatedX,
    y: oy + originOffsetY + rotatedY
  };
}

/**
 * Transform a world coordinate to local space
 * Reverse of localToWorld - used for hit testing
 */
export function worldToLocal(
  worldX: number,
  worldY: number,
  params: TransformParams
): { x: number; y: number } {
  const { ox, oy, rotation, flipped, width, originOffsetY = 0 } = params;

  // Translate relative to origin (accounting for origin offset)
  const dx = worldX - ox;
  const dy = worldY - (oy + originOffsetY);

  // Reverse rotation
  const rad = (-rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  let localX = dx * cos - dy * sin;
  let localY = dx * sin + dy * cos;

  // Reverse flip
  if (flipped) {
    const centerX = width / 2;
    localX = 2 * centerX - localX;
  }

  return { x: localX, y: localY };
}

/**
 * Check if a point is within a rectangular region
 */
export function isPointInRect(
  x: number,
  y: number,
  left: number,
  top: number,
  right: number,
  bottom: number
): boolean {
  return x >= left && x <= right && y >= top && y <= bottom;
}

/**
 * Check if a point is within a circle
 */
export function isPointInCircle(
  x: number,
  y: number,
  centerX: number,
  centerY: number,
  radius: number
): boolean {
  const dist = Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2));
  return dist <= radius;
}

/**
 * Rotate a position around a centroid when the element's rotation changes
 */
export function rotateAroundCentroid(
  position: { x: number; y: number },
  centroidOffset: CentroidOffset,
  oldRotation: number,
  newRotation: number
): { x: number; y: number } {
  // Get the centroid in world space before rotation change
  const oldRad = (oldRotation * Math.PI) / 180;
  const oldCos = Math.cos(oldRad);
  const oldSin = Math.sin(oldRad);
  const centroidWorldX = position.x + (centroidOffset.cx * oldCos - centroidOffset.cy * oldSin);
  const centroidWorldY = position.y + (centroidOffset.cx * oldSin + centroidOffset.cy * oldCos);

  // Calculate the new position that keeps the centroid in place
  const newRad = (newRotation * Math.PI) / 180;
  const newCos = Math.cos(newRad);
  const newSin = Math.sin(newRad);
  const newX = centroidWorldX - (centroidOffset.cx * newCos - centroidOffset.cy * newSin);
  const newY = centroidWorldY - (centroidOffset.cx * newSin + centroidOffset.cy * newCos);

  return { x: newX, y: newY };
}

/**
 * Set up canvas transform for drawing an element
 */
export function setupElementTransform(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rotation: number,
  flipped: boolean,
  width: number,
  height: number,
  originOffsetY: number = 0
): void {
  ctx.save();

  // Translate to element origin
  ctx.translate(x, y + originOffsetY);

  // Apply rotation
  ctx.rotate((rotation * Math.PI) / 180);

  // Apply flip around center
  if (flipped) {
    const centerX = width / 2;
    const centerY = height / 2 - originOffsetY;
    ctx.translate(centerX, centerY);
    ctx.scale(-1, 1);
    ctx.translate(-centerX, -centerY);
  }
}
