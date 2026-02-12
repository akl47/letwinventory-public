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
 * Obstacle bounding box for wire routing
 */
export interface WireObstacle {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Calculate orthogonal (right-angle) path between two points
 * Simple routing: lead out horizontally, then route to destination
 */
export function calculateOrthogonalPath(
  fromPos: { x: number; y: number },
  toPos: { x: number; y: number },
  gridSize: number = 20,
  _obstacles: WireObstacle[] = []
): { x: number; y: number }[] {
  // Very short distance - direct connection
  if (Math.abs(fromPos.x - toPos.x) < gridSize && Math.abs(fromPos.y - toPos.y) < gridSize) {
    return [{ x: fromPos.x, y: fromPos.y }, { x: toPos.x, y: toPos.y }];
  }

  // Determine lead-out direction: go away from destination horizontally
  const leadOutDir = fromPos.x <= toPos.x ? -1 : 1;
  const leadOutX = fromPos.x + leadOutDir * gridSize;

  // Determine lead-in direction: go away from source horizontally
  const leadInDir = toPos.x <= fromPos.x ? -1 : 1;
  const leadInX = toPos.x + leadInDir * gridSize;

  const path: { x: number; y: number }[] = [];

  // Start point
  path.push({ x: fromPos.x, y: fromPos.y });

  // Lead out point
  path.push({ x: leadOutX, y: fromPos.y });

  // If we need to change Y, add intermediate points
  if (Math.abs(fromPos.y - toPos.y) > 1) {
    // Go vertical to match destination Y
    path.push({ x: leadOutX, y: toPos.y });
  }

  // If lead-in X differs from where we are, add point
  if (Math.abs(leadOutX - leadInX) > 1) {
    path.push({ x: leadInX, y: toPos.y });
  }

  // End point
  path.push({ x: toPos.x, y: toPos.y });

  // Clean up redundant points (same position)
  const cleaned: { x: number; y: number }[] = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const prev = cleaned[cleaned.length - 1];
    if (Math.abs(path[i].x - prev.x) > 1 || Math.abs(path[i].y - prev.y) > 1) {
      cleaned.push(path[i]);
    }
  }

  return cleaned;
}

/**
 * Calculate lead-out direction based on element bounds and center
 * The wire should lead AWAY from the element body
 * Uses bounds to determine which face the pin protrudes from
 */
export function calculateLeadOutDirection(
  pinPosition: { x: number; y: number },
  elementCenter: { x: number; y: number } | null,
  elementBounds?: WireObstacle | null
): 'left' | 'right' | 'up' | 'down' {
  if (!elementCenter) {
    return 'right';
  }

  // If bounds are available, determine which face the pin extends beyond
  // This handles elongated elements correctly (e.g. tall component at 0° rotation)
  if (elementBounds) {
    const outsideRight = pinPosition.x - elementBounds.maxX;
    const outsideLeft = elementBounds.minX - pinPosition.x;
    const outsideBottom = pinPosition.y - elementBounds.maxY;
    const outsideTop = elementBounds.minY - pinPosition.y;
    const maxOutside = Math.max(outsideRight, outsideLeft, outsideBottom, outsideTop);

    if (maxOutside > -2) {
      if (outsideRight >= outsideLeft && outsideRight >= outsideBottom && outsideRight >= outsideTop) return 'right';
      if (outsideLeft >= outsideRight && outsideLeft >= outsideBottom && outsideLeft >= outsideTop) return 'left';
      if (outsideBottom >= outsideRight && outsideBottom >= outsideLeft && outsideBottom >= outsideTop) return 'down';
      return 'up';
    }
  }

  // Fallback: use center offset
  const dx = pinPosition.x - elementCenter.x;
  const dy = pinPosition.y - elementCenter.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'right' : 'left';
  }
  return dy >= 0 ? 'down' : 'up';
}

/**
 * Context for improved wire routing with element awareness
 */
export interface WireRoutingContext {
  fromPosition: { x: number; y: number };
  toPosition: { x: number; y: number };
  fromElementCenter: { x: number; y: number } | null;
  toElementCenter: { x: number; y: number } | null;
  fromElementBounds?: WireObstacle | null;
  toElementBounds?: WireObstacle | null;
  obstacles: WireObstacle[];
  gridSize: number;
}

/**
 * Check if a point is strictly inside an obstacle bounding box
 */
function isPointInObstacle(
  x: number,
  y: number,
  obstacles: WireObstacle[]
): boolean {
  for (const obs of obstacles) {
    if (x > obs.minX && x < obs.maxX &&
        y > obs.minY && y < obs.maxY) {
      return true;
    }
  }
  return false;
}

/**
 * Adjust a waypoint to avoid obstacles
 * Shifts the point horizontally or vertically to the nearest grid position outside the obstacle
 */
export function adjustWaypointForObstacles(
  point: { x: number; y: number },
  obstacles: WireObstacle[],
  gridSize: number,
  preferVertical: boolean = false
): { x: number; y: number } {
  let adjusted = { ...point };

  for (const obs of obstacles) {
    // Check if point is strictly inside the obstacle bounding box
    if (adjusted.x > obs.minX && adjusted.x < obs.maxX &&
        adjusted.y > obs.minY && adjusted.y < obs.maxY) {
      // Point is inside obstacle, move to nearest edge (snapped to grid)
      if (preferVertical) {
        // Try to adjust Y first
        const distToTop = adjusted.y - obs.minY;
        const distToBottom = obs.maxY - adjusted.y;
        if (distToTop < distToBottom) {
          // Move to grid position at or above the top edge
          adjusted.y = Math.floor(obs.minY / gridSize) * gridSize;
        } else {
          // Move to grid position at or below the bottom edge
          adjusted.y = Math.ceil(obs.maxY / gridSize) * gridSize;
        }
      } else {
        // Try to adjust X first
        const distToLeft = adjusted.x - obs.minX;
        const distToRight = obs.maxX - adjusted.x;
        if (distToLeft < distToRight) {
          // Move to grid position at or left of the left edge
          adjusted.x = Math.floor(obs.minX / gridSize) * gridSize;
        } else {
          // Move to grid position at or right of the right edge
          adjusted.x = Math.ceil(obs.maxX / gridSize) * gridSize;
        }
      }
    }
  }

  return adjusted;
}

/**
 * Get the lead-out offset point for a given direction
 */
function getLeadPoint(
  position: { x: number; y: number },
  direction: 'left' | 'right' | 'up' | 'down',
  gridSize: number
): { x: number; y: number } {
  switch (direction) {
    case 'right': return { x: position.x + gridSize, y: position.y };
    case 'left':  return { x: position.x - gridSize, y: position.y };
    case 'down':  return { x: position.x, y: position.y + gridSize };
    case 'up':    return { x: position.x, y: position.y - gridSize };
  }
}

/**
 * Whether a lead direction is horizontal
 */
function isHorizontalDir(dir: 'left' | 'right' | 'up' | 'down'): boolean {
  return dir === 'left' || dir === 'right';
}

/**
 * Calculate orthogonal path with improved lead-out direction
 * Uses element centers to determine lead-out direction (away from element body)
 * Supports horizontal and vertical lead-out/lead-in
 */
export function calculateOrthogonalPathV2(context: WireRoutingContext): { x: number; y: number }[] {
  const { fromPosition, toPosition, fromElementCenter, toElementCenter, fromElementBounds, toElementBounds, obstacles, gridSize } = context;

  // Very short distance - direct connection
  if (Math.abs(fromPosition.x - toPosition.x) < gridSize &&
      Math.abs(fromPosition.y - toPosition.y) < gridSize) {
    return [{ x: fromPosition.x, y: fromPosition.y }, { x: toPosition.x, y: toPosition.y }];
  }

  const fromLeadDir = calculateLeadOutDirection(fromPosition, fromElementCenter, fromElementBounds);
  const toLeadDir = calculateLeadOutDirection(toPosition, toElementCenter, toElementBounds);
  const fromHoriz = isHorizontalDir(fromLeadDir);
  const toHoriz = isHorizontalDir(toLeadDir);

  let leadOutPoint = getLeadPoint(fromPosition, fromLeadDir, gridSize);
  leadOutPoint = adjustWaypointForObstacles(leadOutPoint, obstacles, gridSize);

  let leadInPoint = getLeadPoint(toPosition, toLeadDir, gridSize);
  leadInPoint = adjustWaypointForObstacles(leadInPoint, obstacles, gridSize);

  const path: { x: number; y: number }[] = [];
  path.push({ x: fromPosition.x, y: fromPosition.y });
  path.push(leadOutPoint);

  // Route from leadOutPoint to leadInPoint with orthogonal segments
  const dx = Math.abs(leadInPoint.x - leadOutPoint.x);
  const dy = Math.abs(leadInPoint.y - leadOutPoint.y);

  if (dx > 1 || dy > 1) {
    if (fromHoriz && toHoriz) {
      // Both horizontal: route via vertical segment in between
      if (dy > 1) {
        let midX = leadOutPoint.x;
        const testY = (leadOutPoint.y + leadInPoint.y) / 2;
        if (isPointInObstacle(midX, testY, obstacles)) {
          const altX = leadInPoint.x;
          if (!isPointInObstacle(altX, testY, obstacles)) {
            midX = altX;
          }
        }
        if (Math.abs(midX - leadOutPoint.x) > 1) {
          path.push({ x: midX, y: leadOutPoint.y });
        }
        path.push({ x: midX, y: leadInPoint.y });
      }
    } else if (!fromHoriz && !toHoriz) {
      // Both vertical: route via horizontal segment in between
      if (dx > 1) {
        let midY = leadOutPoint.y;
        const testX = (leadOutPoint.x + leadInPoint.x) / 2;
        if (isPointInObstacle(testX, midY, obstacles)) {
          const altY = leadInPoint.y;
          if (!isPointInObstacle(testX, altY, obstacles)) {
            midY = altY;
          }
        }
        if (Math.abs(midY - leadOutPoint.y) > 1) {
          path.push({ x: leadOutPoint.x, y: midY });
        }
        path.push({ x: leadInPoint.x, y: midY });
      }
    } else if (fromHoriz && !toHoriz) {
      // From horizontal, to vertical: one corner connects them
      path.push({ x: leadInPoint.x, y: leadOutPoint.y });
    } else {
      // From vertical, to horizontal: one corner connects them
      path.push({ x: leadOutPoint.x, y: leadInPoint.y });
    }
  }

  // Add lead-in point if not redundant
  const lastPoint = path[path.length - 1];
  if (Math.abs(leadInPoint.x - lastPoint.x) > 1 || Math.abs(leadInPoint.y - lastPoint.y) > 1) {
    path.push(leadInPoint);
  }

  path.push({ x: toPosition.x, y: toPosition.y });

  return cleanPath(path);
}

/**
 * Clean up a path by removing collinear and redundant points
 */
function cleanPath(path: { x: number; y: number }[]): { x: number; y: number }[] {
  if (path.length <= 2) return path;

  const cleaned: { x: number; y: number }[] = [path[0]];

  for (let i = 1; i < path.length - 1; i++) {
    const prev = cleaned[cleaned.length - 1];
    const curr = path[i];
    const next = path[i + 1];

    // Skip if same position as previous
    if (Math.abs(curr.x - prev.x) < 1 && Math.abs(curr.y - prev.y) < 1) {
      continue;
    }

    // Skip if collinear with prev and next
    // Three points are collinear if (y2-y1)(x3-x2) = (y3-y2)(x2-x1)
    const cross = (curr.y - prev.y) * (next.x - curr.x) - (next.y - curr.y) * (curr.x - prev.x);
    if (Math.abs(cross) < 1) {
      continue;
    }

    cleaned.push(curr);
  }

  // Always add the last point
  const lastPoint = path[path.length - 1];
  const prevCleaned = cleaned[cleaned.length - 1];
  if (Math.abs(lastPoint.x - prevCleaned.x) > 1 || Math.abs(lastPoint.y - prevCleaned.y) > 1) {
    cleaned.push(lastPoint);
  }

  return cleaned;
}

/**
 * Draw a termination type box at a wire endpoint
 */
function drawTerminationBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  direction: 'left' | 'right' | 'up' | 'down'
): void {
  ctx.save();
  ctx.font = 'bold 9px monospace';
  const textWidth = ctx.measureText(label).width;
  const boxWidth = textWidth + 6;
  const boxHeight = 14;
  const gap = 8;

  // Translate to endpoint, rotate for vertical directions, then draw horizontally
  ctx.translate(x, y);
  if (direction === 'up') {
    ctx.rotate(-Math.PI / 2);
  } else if (direction === 'down') {
    ctx.rotate(Math.PI / 2);
  }

  // After rotation, draw in the positive-X direction (away from element)
  // 'left' is the only case where we draw in the negative-X direction
  const drawSide = direction === 'left' ? 'left' : 'right';
  const offsetX = drawSide === 'left' ? -boxWidth - gap : gap;

  ctx.fillStyle = '#1a1a1a';
  ctx.strokeStyle = '#666';
  ctx.lineWidth = 1;
  ctx.fillRect(offsetX, -boxHeight / 2, boxWidth, boxHeight);
  ctx.strokeRect(offsetX, -boxHeight / 2, boxWidth, boxHeight);

  ctx.fillStyle = '#e0e0e0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, offsetX + boxWidth / 2, 0);

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
  cableLabel?: string,
  obstacles: WireObstacle[] = [],
  showControlPoints: boolean = false,
  fromElementCenter?: { x: number; y: number } | null,
  toElementCenter?: { x: number; y: number } | null,
  fromElementBounds?: WireObstacle | null,
  toElementBounds?: WireObstacle | null
): void {
  const hexColor = getWireColorHex(wireColor);

  ctx.save();

  // Build orthogonal path
  let points: { x: number; y: number }[];
  if (connection.waypoints?.length) {
    points = [fromPos, ...connection.waypoints, toPos];
  } else if (fromElementCenter || toElementCenter) {
    // Use improved routing with element centers
    points = calculateOrthogonalPathV2({
      fromPosition: fromPos,
      toPosition: toPos,
      fromElementCenter: fromElementCenter || null,
      toElementCenter: toElementCenter || null,
      fromElementBounds: fromElementBounds || null,
      toElementBounds: toElementBounds || null,
      obstacles,
      gridSize
    });
  } else {
    points = calculateOrthogonalPath(fromPos, toPos, gridSize, obstacles);
  }

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

  // Draw termination boxes at ends — along the wire's lead-out direction
  if (connection.fromTermination && TERMINATION_LABELS[connection.fromTermination]) {
    const fromDir = calculateLeadOutDirection(fromPos, fromElementCenter || null, fromElementBounds);
    drawTerminationBox(ctx, fromPos.x, fromPos.y, TERMINATION_LABELS[connection.fromTermination], fromDir);
  }
  if (connection.toTermination && TERMINATION_LABELS[connection.toTermination]) {
    const toDir = calculateLeadOutDirection(toPos, toElementCenter || null, toElementBounds);
    drawTerminationBox(ctx, toPos.x, toPos.y, TERMINATION_LABELS[connection.toTermination], toDir);
  }

  // Draw wire label at the specified position along the wire
  const wireLabel = connection.label || cableLabel;
  if (wireLabel && points.length >= 2) {
    const labelPos = getPointAlongPath(points, connection.labelPosition ?? 0.5);

    // Normalize angle so text is never upside down (keep between -90 and 90 degrees)
    let angle = labelPos.angle;
    if (angle > Math.PI / 2) angle -= Math.PI;
    if (angle < -Math.PI / 2) angle += Math.PI;
    // For vertical segments, always use +90° so text consistently reads top-to-bottom
    if (Math.abs(angle + Math.PI / 2) < 0.01) angle = Math.PI / 2;

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

  // Draw control point handles at direction changes
  // Show in nodeEdit mode (showControlPoints=true) for all intermediate points
  if (showControlPoints && points.length > 2) {
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
  gridSize: number = 20,
  obstacles: WireObstacle[] = [],
  fromElementCenter?: { x: number; y: number } | null,
  toElementCenter?: { x: number; y: number } | null,
  fromElementBounds?: WireObstacle | null,
  toElementBounds?: WireObstacle | null
): void {
  ctx.save();
  ctx.beginPath();
  ctx.strokeStyle = '#64b5f6';
  ctx.lineWidth = WIRE_STROKE_WIDTH;
  ctx.setLineDash([8, 4]);
  ctx.lineCap = 'square';
  ctx.lineJoin = 'miter';

  let points: { x: number; y: number }[];
  if (fromElementCenter || toElementCenter) {
    points = calculateOrthogonalPathV2({
      fromPosition: { x: fromX, y: fromY },
      toPosition: { x: toX, y: toY },
      fromElementCenter: fromElementCenter || null,
      toElementCenter: toElementCenter || null,
      fromElementBounds: fromElementBounds || null,
      toElementBounds: toElementBounds || null,
      obstacles,
      gridSize
    });
  } else {
    points = calculateOrthogonalPath(
      { x: fromX, y: fromY },
      { x: toX, y: toY },
      gridSize,
      obstacles
    );
  }

  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw mating wire preview (gray dashed orthogonal line)
 * Used for mating pin to mating pin connections
 */
export function drawMatingWirePreview(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  gridSize: number = 20,
  obstacles: WireObstacle[] = [],
  fromElementCenter?: { x: number; y: number } | null,
  toElementCenter?: { x: number; y: number } | null,
  fromElementBounds?: WireObstacle | null,
  toElementBounds?: WireObstacle | null
): void {
  ctx.save();

  // Calculate orthogonal path
  let points: { x: number; y: number }[];
  if (fromElementCenter || toElementCenter) {
    points = calculateOrthogonalPathV2({
      fromPosition: { x: fromX, y: fromY },
      toPosition: { x: toX, y: toY },
      fromElementCenter: fromElementCenter || null,
      toElementCenter: toElementCenter || null,
      fromElementBounds: fromElementBounds || null,
      toElementBounds: toElementBounds || null,
      obstacles,
      gridSize
    });
  } else {
    points = calculateOrthogonalPath(
      { x: fromX, y: fromY },
      { x: toX, y: toY },
      gridSize,
      obstacles
    );
  }

  ctx.beginPath();
  ctx.strokeStyle = '#888888';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.lineCap = 'square';
  ctx.lineJoin = 'miter';

  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw a mating connection (gray dashed orthogonal line)
 * Used for connector-to-connector mating connections
 */
export function drawMatingConnection(
  ctx: CanvasRenderingContext2D,
  connection: HarnessConnection,
  fromPos: { x: number; y: number },
  toPos: { x: number; y: number },
  isSelected: boolean = false,
  gridSize: number = 20,
  obstacles: WireObstacle[] = [],
  showControlPoints: boolean = false,
  fromElementCenter?: { x: number; y: number } | null,
  toElementCenter?: { x: number; y: number } | null,
  fromElementBounds?: WireObstacle | null,
  toElementBounds?: WireObstacle | null
): void {
  ctx.save();

  // Build path using waypoints if available, otherwise calculate
  let points: { x: number; y: number }[];
  if (connection.waypoints?.length) {
    points = [fromPos, ...connection.waypoints, toPos];
  } else if (fromElementCenter || toElementCenter) {
    points = calculateOrthogonalPathV2({
      fromPosition: fromPos,
      toPosition: toPos,
      fromElementCenter: fromElementCenter || null,
      toElementCenter: toElementCenter || null,
      fromElementBounds: fromElementBounds || null,
      toElementBounds: toElementBounds || null,
      obstacles,
      gridSize
    });
  } else {
    points = calculateOrthogonalPath(fromPos, toPos, gridSize, obstacles);
  }

  ctx.beginPath();
  ctx.strokeStyle = isSelected ? '#64b5f6' : '#888888';
  ctx.lineWidth = isSelected ? 3 : 2;
  ctx.setLineDash([6, 4]);
  ctx.lineCap = 'square';
  ctx.lineJoin = 'miter';

  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw control point handles in nodeEdit mode (showControlPoints=true)
  if (showControlPoints && points.length > 2) {
    for (let i = 1; i < points.length - 1; i++) {
      const pt = points[i];
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#888888';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

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
  threshold: number = 8,
  fromElementCenter?: { x: number; y: number } | null,
  toElementCenter?: { x: number; y: number } | null,
  obstacles: WireObstacle[] = [],
  fromElementBounds?: WireObstacle | null,
  toElementBounds?: WireObstacle | null
): boolean {
  let points: { x: number; y: number }[];
  if (connection.waypoints?.length) {
    points = [fromPos, ...connection.waypoints, toPos];
  } else if (fromElementCenter || toElementCenter) {
    points = calculateOrthogonalPathV2({
      fromPosition: fromPos,
      toPosition: toPos,
      fromElementCenter: fromElementCenter || null,
      toElementCenter: toElementCenter || null,
      fromElementBounds: fromElementBounds || null,
      toElementBounds: toElementBounds || null,
      obstacles,
      gridSize
    });
  } else {
    points = calculateOrthogonalPath(fromPos, toPos, gridSize);
  }

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
  gridSize: number = 20,
  fromElementCenter?: { x: number; y: number } | null,
  toElementCenter?: { x: number; y: number } | null,
  obstacles: WireObstacle[] = [],
  fromElementBounds?: WireObstacle | null,
  toElementBounds?: WireObstacle | null
): { x: number; y: number; index: number }[] {
  let points: { x: number; y: number }[];
  if (connection.waypoints?.length) {
    points = [fromPos, ...connection.waypoints, toPos];
  } else if (fromElementCenter || toElementCenter) {
    points = calculateOrthogonalPathV2({
      fromPosition: fromPos,
      toPosition: toPos,
      fromElementCenter: fromElementCenter || null,
      toElementCenter: toElementCenter || null,
      fromElementBounds: fromElementBounds || null,
      toElementBounds: toElementBounds || null,
      obstacles,
      gridSize
    });
  } else {
    points = calculateOrthogonalPath(fromPos, toPos, gridSize);
  }

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
  gridSize: number = 20,
  fromElementCenter?: { x: number; y: number } | null,
  toElementCenter?: { x: number; y: number } | null,
  obstacles: WireObstacle[] = []
): number {
  const controlPoints = getWireControlPoints(connection, fromPos, toPos, gridSize, fromElementCenter, toElementCenter, obstacles);
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
  // For vertical segments, always use +90° so text consistently reads top-to-bottom
  if (Math.abs(angle + Math.PI / 2) < 0.01) angle = Math.PI / 2;

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

/**
 * Find the segment index where a new waypoint should be inserted
 * Returns the index in the waypoints array where the new point should be inserted
 */
export function findWaypointInsertIndex(
  connection: HarnessConnection,
  fromPos: { x: number; y: number },
  toPos: { x: number; y: number },
  clickX: number,
  clickY: number,
  gridSize: number = 20
): { index: number; point: { x: number; y: number } } {
  // Get the current path points
  const waypoints = connection.waypoints || [];
  const points = [fromPos, ...waypoints, toPos];

  // Find which segment the click is closest to
  let minDist = Infinity;
  let bestSegmentIndex = 0;
  let bestPoint = { x: clickX, y: clickY };

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const lengthSq = dx * dx + dy * dy;

    let t = 0;
    if (lengthSq > 0) {
      t = ((clickX - p1.x) * dx + (clickY - p1.y) * dy) / lengthSq;
      t = Math.max(0, Math.min(1, t));
    }

    const projX = p1.x + t * dx;
    const projY = p1.y + t * dy;
    const dist = Math.sqrt((clickX - projX) ** 2 + (clickY - projY) ** 2);

    if (dist < minDist) {
      minDist = dist;
      bestSegmentIndex = i;
      bestPoint = { x: projX, y: projY };
    }
  }

  // The insert index in waypoints array:
  // If segment 0 (from -> first waypoint or from -> to), insert at 0
  // If segment 1 (first waypoint -> second or first -> to), insert at 1
  // etc.
  return { index: bestSegmentIndex, point: bestPoint };
}

/**
 * Get the nearest point on a wire segment for inserting a waypoint
 */
export function getNearestPointOnWire(
  connection: HarnessConnection,
  fromPos: { x: number; y: number },
  toPos: { x: number; y: number },
  clickX: number,
  clickY: number,
  gridSize: number = 20,
  snapToGrid: boolean = true
): { x: number; y: number } {
  const result = findWaypointInsertIndex(connection, fromPos, toPos, clickX, clickY, gridSize);

  if (snapToGrid) {
    return {
      x: Math.round(result.point.x / gridSize) * gridSize,
      y: Math.round(result.point.y / gridSize) * gridSize
    };
  }

  return result.point;
}
