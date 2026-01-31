// Wire rendering and hit testing utilities
import { HarnessConnection, WireEnd } from '../../models/harness.model';
import { getWireColorHex } from './wire-color-map';
import { WIRE_STROKE_WIDTH, PIN_CIRCLE_RADIUS } from './constants';

// Default termination type display labels (fallback when API data unavailable)
const DEFAULT_TERMINATION_LABELS: { [key: string]: string } = {
  'f-pin': 'F Pin',
  'm-pin': 'M Pin',
  'f-spade': 'F Spade',
  'm-spade': 'M Spade',
  'ring': 'Ring',
  'fork': 'Fork',
  'ferrule': 'Ferrule',
  'soldered': 'Solder',
  'bare': 'Bare'
};

// Current termination labels (can be updated from API)
let TERMINATION_LABELS: { [key: string]: string } = { ...DEFAULT_TERMINATION_LABELS };

/**
 * Update termination labels from API wire end data
 */
export function setTerminationLabels(wireEnds: WireEnd[]): void {
  TERMINATION_LABELS = {};
  for (const we of wireEnds) {
    TERMINATION_LABELS[we.code] = we.name;
  }
}

/**
 * Get termination label for a code
 */
export function getTerminationLabel(code: string): string | undefined {
  return TERMINATION_LABELS[code];
}

/**
 * Calculate orthogonal (right-angle) path between two points
 */
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
    if (startX !== midX) {
      points.push({ x: midX, y: fromPos.y });
    }
    if (fromPos.y !== toPos.y) {
      points.push({ x: midX, y: toPos.y });
    }
  }

  points.push({ x: toPos.x, y: toPos.y });

  return points;
}

/**
 * Draw a termination type box at a wire endpoint
 */
function drawTerminationBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  side: 'left' | 'right'
): void {
  ctx.save();
  ctx.font = 'bold 9px monospace';
  const textWidth = ctx.measureText(label).width;
  const boxWidth = textWidth + 6;
  const boxHeight = 14;

  // Position box to the side of the endpoint
  const offsetX = side === 'left' ? -boxWidth - 8 : 8;
  const boxX = x + offsetX;
  const boxY = y - boxHeight / 2;

  // Draw box background
  ctx.fillStyle = '#1a1a1a';
  ctx.strokeStyle = '#666';
  ctx.lineWidth = 1;
  ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
  ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);

  // Draw label text
  ctx.fillStyle = '#e0e0e0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, boxX + boxWidth / 2, y);

  ctx.restore();
}

/**
 * Draw a wire connection with orthogonal routing
 */
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

  // Draw termination boxes at ends if set
  if (connection.fromTermination && TERMINATION_LABELS[connection.fromTermination]) {
    drawTerminationBox(ctx, fromPos.x, fromPos.y, TERMINATION_LABELS[connection.fromTermination], 'right');
  }
  if (connection.toTermination && TERMINATION_LABELS[connection.toTermination]) {
    drawTerminationBox(ctx, toPos.x, toPos.y, TERMINATION_LABELS[connection.toTermination], 'left');
  }

  // Draw wire label at the specified position along the wire
  const wireLabel = connection.label || cableLabel;
  if (wireLabel && points.length >= 2) {
    const labelPos = getPointAlongPath(points, connection.labelPosition ?? 0.5);

    // Normalize angle so text is never upside down (keep between -90 and 90 degrees)
    let angle = labelPos.angle;
    if (angle > Math.PI / 2) angle -= Math.PI;
    if (angle < -Math.PI / 2) angle += Math.PI;

    ctx.save();
    ctx.translate(labelPos.x, labelPos.y);
    ctx.rotate(angle);

    ctx.font = 'bold 9px monospace';
    const textWidth = ctx.measureText(wireLabel).width;
    const boxWidth = textWidth + 6;
    const boxHeight = 14;

    // Draw box centered at origin
    ctx.fillStyle = '#1a1a1a';
    ctx.strokeStyle = isSelected ? '#64b5f6' : '#666';
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.fillRect(-boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight);
    ctx.strokeRect(-boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight);

    // Draw label text
    ctx.fillStyle = '#e0e0e0';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(wireLabel, 0, 0);

    ctx.restore();
  }

  // Draw control point handles at direction changes if selected
  // Only show if wire has waypoints (not a straight/auto-routed line)
  if (isSelected && points.length > 2 && connection.waypoints?.length) {
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

/**
 * Draw wire preview while drawing (orthogonal)
 */
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

/**
 * Draw a green highlight indicator on a pin during wire drawing
 */
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
  ctx.strokeStyle = '#4caf50';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Draw inner green dot
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, Math.PI * 2);
  ctx.fillStyle = '#4caf50';
  ctx.fill();

  ctx.restore();
}

/**
 * Hit test for wire connection
 */
export function hitTestWire(
  connection: HarnessConnection,
  fromPos: { x: number; y: number },
  toPos: { x: number; y: number },
  testX: number,
  testY: number,
  gridSize: number = 20,
  threshold: number = 8
): boolean {
  const points = connection.waypoints?.length
    ? [fromPos, ...connection.waypoints, toPos]
    : calculateOrthogonalPath(fromPos, toPos, gridSize);

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

/**
 * Get wire control points (intermediate points where wire changes direction)
 */
export function getWireControlPoints(
  connection: HarnessConnection,
  fromPos: { x: number; y: number },
  toPos: { x: number; y: number },
  gridSize: number = 20
): { x: number; y: number; index: number }[] {
  const points = connection.waypoints?.length
    ? [fromPos, ...connection.waypoints, toPos]
    : calculateOrthogonalPath(fromPos, toPos, gridSize);

  const controlPoints: { x: number; y: number; index: number }[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    controlPoints.push({ ...points[i], index: i });
  }
  return controlPoints;
}

/**
 * Hit test for wire control point (returns point index if hit, -1 otherwise)
 */
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

/**
 * Calculate distance from point to line segment
 */
function pointToLineDistance(
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) {
    return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
  }

  let t = ((px - x1) * dx + (py - y1) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));

  const projX = x1 + t * dx;
  const projY = y1 + t * dy;

  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
}

/**
 * Get a point at a specific position (0-1) along a path
 */
export function getPointAlongPath(
  points: { x: number; y: number }[],
  position: number
): { x: number; y: number; angle: number } {
  if (points.length < 2) {
    return { x: points[0]?.x || 0, y: points[0]?.y || 0, angle: 0 };
  }

  // Calculate total path length
  const segments: { p1: typeof points[0]; p2: typeof points[0]; length: number }[] = [];
  let totalLength = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const length = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
    segments.push({ p1, p2, length });
    totalLength += length;
  }

  // Clamp position to 0-1
  position = Math.max(0, Math.min(1, position));
  const targetLength = totalLength * position;

  // Find the point at the target length
  let accumulatedLength = 0;
  for (const seg of segments) {
    if (accumulatedLength + seg.length >= targetLength || seg === segments[segments.length - 1]) {
      const remainingDist = targetLength - accumulatedLength;
      const t = seg.length > 0 ? remainingDist / seg.length : 0;
      return {
        x: seg.p1.x + t * (seg.p2.x - seg.p1.x),
        y: seg.p1.y + t * (seg.p2.y - seg.p1.y),
        angle: Math.atan2(seg.p2.y - seg.p1.y, seg.p2.x - seg.p1.x)
      };
    }
    accumulatedLength += seg.length;
  }

  // Fallback to last point
  const lastSeg = segments[segments.length - 1];
  return {
    x: lastSeg.p2.x,
    y: lastSeg.p2.y,
    angle: Math.atan2(lastSeg.p2.y - lastSeg.p1.y, lastSeg.p2.x - lastSeg.p1.x)
  };
}

/**
 * Hit test for wire label drag handle (tests the label box area)
 */
export function hitTestWireLabelHandle(
  connection: HarnessConnection,
  fromPos: { x: number; y: number },
  toPos: { x: number; y: number },
  testX: number,
  testY: number,
  gridSize: number = 20
): boolean {
  if (!connection.label) return false;

  const points = connection.waypoints?.length
    ? [fromPos, ...connection.waypoints, toPos]
    : calculateOrthogonalPath(fromPos, toPos, gridSize);

  const labelPos = getPointAlongPath(points, connection.labelPosition ?? 0.5);

  // Normalize angle
  let angle = labelPos.angle;
  if (angle > Math.PI / 2) angle -= Math.PI;
  if (angle < -Math.PI / 2) angle += Math.PI;

  // Transform test point to label's local coordinate system
  const dx = testX - labelPos.x;
  const dy = testY - labelPos.y;

  // Rotate point back by -angle to get local coordinates
  const localX = dx * Math.cos(-angle) - dy * Math.sin(-angle);
  const localY = dx * Math.sin(-angle) + dy * Math.cos(-angle);

  // Approximate label box dimensions (slightly larger for easier hit)
  const boxHalfWidth = 30; // Generous width to account for varying label text
  const boxHalfHeight = 10;

  // Check if point is within the label box area
  return Math.abs(localX) <= boxHalfWidth && Math.abs(localY) <= boxHalfHeight;
}

/**
 * Calculate position (0-1) along wire path from a point
 */
export function getPositionFromPoint(
  connection: HarnessConnection,
  fromPos: { x: number; y: number },
  toPos: { x: number; y: number },
  pointX: number,
  pointY: number,
  gridSize: number = 20
): number {
  const points = connection.waypoints?.length
    ? [fromPos, ...connection.waypoints, toPos]
    : calculateOrthogonalPath(fromPos, toPos, gridSize);

  // Calculate total path length and find closest point on path
  let totalLength = 0;
  const segments: { p1: typeof points[0]; p2: typeof points[0]; length: number; startLength: number }[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const length = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
    segments.push({ p1, p2, length, startLength: totalLength });
    totalLength += length;
  }

  if (totalLength === 0) return 0.5;

  // Find closest segment and position on it
  let minDist = Infinity;
  let bestPosition = 0.5;

  for (const seg of segments) {
    const dx = seg.p2.x - seg.p1.x;
    const dy = seg.p2.y - seg.p1.y;
    const lengthSq = dx * dx + dy * dy;

    let t = 0;
    if (lengthSq > 0) {
      t = ((pointX - seg.p1.x) * dx + (pointY - seg.p1.y) * dy) / lengthSq;
      t = Math.max(0, Math.min(1, t));
    }

    const projX = seg.p1.x + t * dx;
    const projY = seg.p1.y + t * dy;
    const dist = Math.sqrt((pointX - projX) ** 2 + (pointY - projY) ** 2);

    if (dist < minDist) {
      minDist = dist;
      const lengthAlongPath = seg.startLength + t * seg.length;
      bestPosition = lengthAlongPath / totalLength;
    }
  }

  return Math.max(0.05, Math.min(0.95, bestPosition)); // Keep some margin from ends
}
