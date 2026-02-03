// Endpoint Resolution Utilities
// Functions to resolve wire endpoints from HarnessData and HarnessConnection

import {
  HarnessData,
  HarnessConnection,
  HarnessConnector,
  HarnessCable,
  HarnessComponent,
  SubHarnessRef,
  WireHarness
} from '../../models/harness.model';
import {
  WireEndpoint,
  ConnectorEndpoint,
  ConnectorMatingEndpoint,
  CableEndpoint,
  ComponentEndpoint,
  SubHarnessEndpoint,
  Point
} from './wire-endpoint';
import { WireObstacle } from './wire';
import {
  getConnectorDimensions,
  getConnectorPinPositions
} from './elements/connector';
import {
  getCableDimensions,
  getCableWirePositions
} from './elements/cable';
import {
  getComponentDimensions,
  getComponentPinPositions
} from './elements/component';
import { getSubHarnessDimensions, getSubHarnessPinPositions } from './elements/sub-harness';
import {
  ROW_HEIGHT,
  HEADER_HEIGHT,
  CABLE_WIRE_SPACING,
  PIN_CIRCLE_RADIUS,
  CABLE_ENDPOINT_RADIUS,
  COMPONENT_PIN_RADIUS
} from './constants';

/**
 * Cache for sub-harness data to avoid repeated lookups
 */
export type SubHarnessDataCache = Map<number, WireHarness>;

/**
 * Helper to transform a point around origin with rotation and flip
 */
function transformPoint(
  localX: number,
  localY: number,
  originX: number,
  originY: number,
  rotation: number
): Point {
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: originX + localX * cos - localY * sin,
    y: originY + localX * sin + localY * cos
  };
}

/**
 * Get axis-aligned bounding box from rotated corners
 */
function getRotatedBounds(
  localMinX: number,
  localMinY: number,
  localMaxX: number,
  localMaxY: number,
  originX: number,
  originY: number,
  rotation: number
): WireObstacle {
  const corners = [
    transformPoint(localMinX, localMinY, originX, originY, rotation),
    transformPoint(localMaxX, localMinY, originX, originY, rotation),
    transformPoint(localMaxX, localMaxY, originX, originY, rotation),
    transformPoint(localMinX, localMaxY, originX, originY, rotation)
  ];
  return {
    minX: Math.min(...corners.map(c => c.x)),
    minY: Math.min(...corners.map(c => c.y)),
    maxX: Math.max(...corners.map(c => c.x)),
    maxY: Math.max(...corners.map(c => c.y))
  };
}

/**
 * Calculate connector center and bounds
 */
function getConnectorCenterAndBounds(connector: HarnessConnector): { center: Point; bounds: WireObstacle } {
  const dims = getConnectorDimensions(connector);
  const x = connector.position?.x || 0;
  const y = connector.position?.y || 0;
  const rotation = connector.rotation || 0;

  const pinCount = connector.pins?.length || connector.pinCount || 1;
  const headerAndExtras = dims.height - (pinCount * ROW_HEIGHT);

  // Origin is at (x, y - ROW_HEIGHT/2)
  const originX = x;
  const originY = y - ROW_HEIGHT / 2;
  const localMinX = 0;
  const localMinY = -headerAndExtras;
  const localMaxX = dims.width;
  const localMaxY = pinCount * ROW_HEIGHT;

  const bounds = getRotatedBounds(localMinX, localMinY, localMaxX, localMaxY, originX, originY, rotation);

  // Center is the center of the bounding box
  const center: Point = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2
  };

  return { center, bounds };
}

/**
 * Calculate cable center and bounds
 */
function getCableCenterAndBounds(cable: HarnessCable): { center: Point; bounds: WireObstacle } {
  const dims = getCableDimensions(cable);
  const x = cable.position?.x || 0;
  const y = cable.position?.y || 0;
  const rotation = cable.rotation || 0;

  const wireCount = cable.wires?.length || cable.wireCount || 1;
  const headerAndExtras = dims.height - (wireCount * CABLE_WIRE_SPACING);

  // Origin is at (x, y)
  const originX = x;
  const originY = y;
  const localMinX = 0;
  const localMinY = -headerAndExtras - CABLE_WIRE_SPACING / 2;
  const localMaxX = dims.width;
  const localMaxY = (wireCount - 0.5) * CABLE_WIRE_SPACING;

  const bounds = getRotatedBounds(localMinX, localMinY, localMaxX, localMaxY, originX, originY, rotation);

  const center: Point = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2
  };

  return { center, bounds };
}

/**
 * Calculate component center and bounds
 */
function getComponentCenterAndBounds(component: HarnessComponent): { center: Point; bounds: WireObstacle } {
  const dims = getComponentDimensions(component);
  const x = component.position?.x || 0;
  const y = component.position?.y || 0;
  const rotation = component.rotation || 0;

  let totalPins = 0;
  for (const group of component.pinGroups || []) {
    totalPins += group.pins?.length || 0;
  }
  totalPins = Math.max(totalPins, 1);

  const headerAndExtras = dims.height - (totalPins * ROW_HEIGHT);

  // Origin is at (x, y - ROW_HEIGHT/2)
  const originX = x;
  const originY = y - ROW_HEIGHT / 2;
  const localMinX = 0;
  const localMinY = -headerAndExtras;
  const localMaxX = dims.width;
  const localMaxY = totalPins * ROW_HEIGHT;

  const bounds = getRotatedBounds(localMinX, localMinY, localMaxX, localMaxY, originX, originY, rotation);

  const center: Point = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2
  };

  return { center, bounds };
}

/**
 * Calculate sub-harness center and bounds
 */
function getSubHarnessCenterAndBounds(
  subHarness: SubHarnessRef,
  childHarness: WireHarness | undefined
): { center: Point; bounds: WireObstacle } {
  const dims = getSubHarnessDimensions(subHarness, childHarness);
  const x = subHarness.position?.x || 0;
  const y = subHarness.position?.y || 0;
  const rotation = subHarness.rotation || 0;

  // Sub-harness bounds are relative to position
  const localMinX = dims.bounds.minX;
  const localMinY = dims.bounds.minY;
  const localMaxX = dims.bounds.maxX;
  const localMaxY = dims.bounds.maxY;

  const bounds = getRotatedBounds(
    localMinX - x, localMinY - y,
    localMaxX - x, localMaxY - y,
    x, y, rotation
  );

  const center: Point = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2
  };

  return { center, bounds };
}

/**
 * Resolve a connector endpoint (wire side)
 */
export function resolveConnectorEndpoint(
  data: HarnessData,
  connectorId: string,
  pinId: string,
  _side: 'wire' | 'mating' = 'wire'
): ConnectorEndpoint | null {
  const connector = data.connectors.find(c => c.id === connectorId);
  if (!connector) return null;

  const pins = getConnectorPinPositions(connector, 'wire');
  const pin = pins.find(p => p.pinId === pinId);
  if (!pin) return null;

  const { center, bounds } = getConnectorCenterAndBounds(connector);

  return {
    type: 'connector',
    connectorId,
    pinId,
    position: { x: pin.x, y: pin.y },
    elementCenter: center,
    elementBounds: bounds
  };
}

/**
 * Resolve a connector mating endpoint (mating side)
 */
export function resolveConnectorMatingEndpoint(
  data: HarnessData,
  connectorId: string,
  pinId: string
): ConnectorMatingEndpoint | null {
  const connector = data.connectors.find(c => c.id === connectorId);
  if (!connector) return null;

  const pins = getConnectorPinPositions(connector, 'mating');
  const pin = pins.find(p => p.pinId === pinId);
  if (!pin) return null;

  const { center, bounds } = getConnectorCenterAndBounds(connector);

  return {
    type: 'connectorMating',
    connectorId,
    pinId,
    position: { x: pin.x, y: pin.y },
    elementCenter: center,
    elementBounds: bounds
  };
}

/**
 * Resolve a cable endpoint
 */
export function resolveCableEndpoint(
  data: HarnessData,
  cableId: string,
  wireId: string,
  side: 'left' | 'right'
): CableEndpoint | null {
  const cable = data.cables.find(c => c.id === cableId);
  if (!cable || !cable.position) return null;

  const wires = getCableWirePositions(cable);
  const wire = wires.find(w => w.wireId === wireId && w.side === side);
  if (!wire) return null;

  const { center, bounds } = getCableCenterAndBounds(cable);

  return {
    type: 'cable',
    cableId,
    wireId,
    side,
    position: { x: wire.x, y: wire.y },
    elementCenter: center,
    elementBounds: bounds
  };
}

/**
 * Resolve a component endpoint
 */
export function resolveComponentEndpoint(
  data: HarnessData,
  componentId: string,
  pinId: string
): ComponentEndpoint | null {
  const component = (data.components || []).find(c => c.id === componentId);
  if (!component) return null;

  const pins = getComponentPinPositions(component);
  const pin = pins.find(p => p.pinId === pinId);
  if (!pin) return null;

  const { center, bounds } = getComponentCenterAndBounds(component);

  return {
    type: 'component',
    componentId,
    pinId,
    groupId: pin.groupId,
    position: { x: pin.x, y: pin.y },
    elementCenter: center,
    elementBounds: bounds
  };
}

/**
 * Resolve a sub-harness endpoint
 */
export function resolveSubHarnessEndpoint(
  data: HarnessData,
  subHarnessId: string,
  connectorId: string,
  pinId: string,
  isMating: boolean,
  cache: SubHarnessDataCache
): SubHarnessEndpoint | null {
  const subHarness = (data.subHarnesses || []).find(s => s.id === subHarnessId);
  if (!subHarness) return null;

  const childHarness = cache.get(subHarness.harnessId);
  const pinSide = isMating ? 'mating' : 'wire';
  const pins = getSubHarnessPinPositions(subHarness, childHarness, pinSide);
  const pin = pins.find(p => p.connectorId === connectorId && p.connectorPinId === pinId);
  if (!pin) return null;

  const { center, bounds } = getSubHarnessCenterAndBounds(subHarness, childHarness);

  return {
    type: 'subHarness',
    subHarnessId,
    connectorId,
    pinId,
    isMating,
    position: { x: pin.x, y: pin.y },
    elementCenter: center,
    elementBounds: bounds
  };
}

/**
 * Resolve the 'from' endpoint of a connection
 */
export function resolveFromEndpoint(
  data: HarnessData,
  connection: HarnessConnection,
  cache: SubHarnessDataCache
): WireEndpoint | null {
  const isMating = connection.connectionType === 'mating';

  // Connector pin
  if (connection.fromConnector && connection.fromPin) {
    if (isMating) {
      return resolveConnectorMatingEndpoint(data, connection.fromConnector, connection.fromPin);
    }
    return resolveConnectorEndpoint(data, connection.fromConnector, connection.fromPin);
  }

  // Cable wire
  if (connection.fromCable && connection.fromWire && connection.fromSide) {
    return resolveCableEndpoint(data, connection.fromCable, connection.fromWire, connection.fromSide);
  }

  // Component pin
  if (connection.fromComponent && connection.fromComponentPin) {
    return resolveComponentEndpoint(data, connection.fromComponent, connection.fromComponentPin);
  }

  // Sub-harness pin
  if (connection.fromSubHarness && connection.fromSubConnector && connection.fromPin) {
    return resolveSubHarnessEndpoint(
      data,
      connection.fromSubHarness,
      connection.fromSubConnector,
      connection.fromPin,
      isMating,
      cache
    );
  }

  return null;
}

/**
 * Resolve the 'to' endpoint of a connection
 */
export function resolveToEndpoint(
  data: HarnessData,
  connection: HarnessConnection,
  cache: SubHarnessDataCache
): WireEndpoint | null {
  const isMating = connection.connectionType === 'mating';

  // Connector pin
  if (connection.toConnector && connection.toPin) {
    if (isMating) {
      return resolveConnectorMatingEndpoint(data, connection.toConnector, connection.toPin);
    }
    return resolveConnectorEndpoint(data, connection.toConnector, connection.toPin);
  }

  // Cable wire
  if (connection.toCable && connection.toWire && connection.toSide) {
    return resolveCableEndpoint(data, connection.toCable, connection.toWire, connection.toSide);
  }

  // Component pin
  if (connection.toComponent && connection.toComponentPin) {
    return resolveComponentEndpoint(data, connection.toComponent, connection.toComponentPin);
  }

  // Sub-harness pin
  if (connection.toSubHarness && connection.toSubConnector && connection.toPin) {
    return resolveSubHarnessEndpoint(
      data,
      connection.toSubHarness,
      connection.toSubConnector,
      connection.toPin,
      isMating,
      cache
    );
  }

  return null;
}

/**
 * Get the wire color for an endpoint (from cable wires)
 */
export function getEndpointWireColor(
  data: HarnessData,
  endpoint: WireEndpoint
): string {
  if (endpoint.type === 'cable') {
    const cable = data.cables.find(c => c.id === endpoint.cableId);
    if (cable) {
      const wire = cable.wires.find(w => w.id === endpoint.wireId);
      if (wire) {
        return wire.colorCode || wire.color || 'BK';
      }
    }
  }
  return 'BK';
}
