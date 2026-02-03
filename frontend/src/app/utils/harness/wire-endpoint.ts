// Wire Endpoint Types and Wire Drawing State Management Types

import { WireObstacle } from './wire';

/**
 * Point with x, y coordinates
 */
export interface Point {
  x: number;
  y: number;
}

/**
 * Connector wire endpoint (wire side of a connector pin)
 */
export interface ConnectorEndpoint {
  type: 'connector';
  connectorId: string;
  pinId: string;
  position: Point;
  elementCenter: Point;
  elementBounds: WireObstacle;
}

/**
 * Connector mating endpoint (mating side of a connector pin)
 */
export interface ConnectorMatingEndpoint {
  type: 'connectorMating';
  connectorId: string;
  pinId: string;
  position: Point;
  elementCenter: Point;
  elementBounds: WireObstacle;
}

/**
 * Cable wire endpoint
 */
export interface CableEndpoint {
  type: 'cable';
  cableId: string;
  wireId: string;
  side: 'left' | 'right';
  position: Point;
  elementCenter: Point;
  elementBounds: WireObstacle;
}

/**
 * Component pin endpoint
 */
export interface ComponentEndpoint {
  type: 'component';
  componentId: string;
  pinId: string;
  groupId: string;
  position: Point;
  elementCenter: Point;
  elementBounds: WireObstacle;
}

/**
 * Sub-harness pin endpoint (mating pin from a connector within a sub-harness)
 */
export interface SubHarnessEndpoint {
  type: 'subHarness';
  subHarnessId: string;
  connectorId: string;
  pinId: string;
  isMating: boolean;
  position: Point;
  elementCenter: Point;
  elementBounds: WireObstacle;
}

/**
 * Discriminated union for all wire endpoint types
 */
export type WireEndpoint =
  | ConnectorEndpoint
  | ConnectorMatingEndpoint
  | CableEndpoint
  | ComponentEndpoint
  | SubHarnessEndpoint;

/**
 * Check if an endpoint is a mating connection type
 */
export function isMatingEndpoint(endpoint: WireEndpoint): boolean {
  return endpoint.type === 'connectorMating' ||
    (endpoint.type === 'subHarness' && endpoint.isMating);
}

/**
 * Consolidated wire drawing state
 */
export interface WireDrawingState {
  /** Whether a wire is currently being drawn */
  isActive: boolean;
  /** Whether this is a mating connection (connector-to-connector) */
  isMating: boolean;
  /** The starting endpoint of the wire */
  startEndpoint: WireEndpoint | null;
  /** The currently hovered endpoint (potential end point) */
  hoveredEndpoint: WireEndpoint | null;
  /** Current mouse position in canvas coordinates */
  currentMousePosition: Point;
}

/**
 * Create an empty wire drawing state
 */
export function createEmptyWireDrawingState(): WireDrawingState {
  return {
    isActive: false,
    isMating: false,
    startEndpoint: null,
    hoveredEndpoint: null,
    currentMousePosition: { x: 0, y: 0 }
  };
}

/**
 * Wire routing context for improved path calculation
 * Contains all information needed to calculate a wire path with proper lead-out directions
 */
export interface WireRoutingContext {
  /** Starting position of the wire */
  fromPosition: Point;
  /** Ending position of the wire */
  toPosition: Point;
  /** Center of the source element (for lead-out direction calculation) */
  fromElementCenter: Point | null;
  /** Center of the destination element (for lead-in direction calculation) */
  toElementCenter: Point | null;
  /** Bounding boxes of elements to avoid */
  obstacles: WireObstacle[];
  /** Grid size for snapping */
  gridSize: number;
}
