// Canvas Renderer - Facade module for backward compatibility
// This file re-exports all functions from the modular harness utils

// Re-export from constants
export {
  ROW_HEIGHT,
  HEADER_HEIGHT,
  PIN_COL_WIDTH,
  LABEL_COL_WIDTH,
  WIRE_STROKE_WIDTH,
  PIN_CIRCLE_RADIUS,
  EXPAND_BUTTON_SIZE,
  CONNECTOR_IMAGE_WIDTH,
  CONNECTOR_IMAGE_MAX_HEIGHT,
  PINOUT_IMAGE_WIDTH,
  PINOUT_IMAGE_HEIGHT,
  CABLE_DEFAULT_LENGTH,
  CABLE_WIRE_SPACING,
  CABLE_ENDPOINT_RADIUS,
  CABLE_DIAGRAM_WIDTH,
  CABLE_DIAGRAM_HEIGHT,
  COMPONENT_PIN_RADIUS,
  COMPONENT_PIN_SPACING,
  COMPONENT_IMAGE_WIDTH,
  COMPONENT_IMAGE_MAX_HEIGHT
} from './constants';

// Re-export from types
export type {
  PinPosition,
  CableWirePosition,
  ComponentPinPosition,
  CanvasObject,
  ConnectorDimensions,
  CableDimensions,
  ComponentDimensions,
  CentroidOffset
} from './types';

// Re-export from elements/connector
export {
  getConnectorDimensions,
  drawConnector,
  getConnectorPinPositions,
  getConnectorCentroidOffset,
  hitTestConnector,
  hitTestConnectorPin,
  hitTestConnectorPinWithSide,
  hitTestConnectorButton
} from './elements/connector';

// Backward compatibility alias
export { hitTestConnectorPin as hitTestPin } from './elements/connector';

// Re-export from elements/cable
export {
  getCableDimensions,
  drawCable,
  getCableWirePositions,
  getCableCentroidOffset,
  hitTestCable,
  hitTestCableButton,
  hitTestCableWire
} from './elements/cable';

// Re-export from elements/component
export {
  getComponentDimensions,
  drawComponent,
  getComponentPinPositions,
  getComponentCentroidOffset,
  hitTestComponent,
  hitTestComponentPin,
  hitTestComponentButton
} from './elements/component';

// Re-export from wire
export {
  calculateOrthogonalPath,
  calculateOrthogonalPathV2,
  calculateLeadOutDirection,
  adjustWaypointForObstacles,
  drawWire,
  drawWirePreview,
  drawMatingWirePreview,
  drawMatingConnection,
  drawPinHighlight,
  hitTestWire,
  getWireControlPoints,
  hitTestWireControlPoint,
  getPointAlongPath,
  hitTestWireLabelHandle,
  getPositionFromPoint,
  findWaypointInsertIndex,
  getNearestPointOnWire
} from './wire';
export type { WireObstacle, WireRoutingContext } from './wire';

// Re-export from wire-endpoint
export type {
  Point,
  WireEndpoint,
  ConnectorEndpoint,
  ConnectorMatingEndpoint,
  CableEndpoint,
  ComponentEndpoint,
  SubHarnessEndpoint,
  WireDrawingState
} from './wire-endpoint';
export {
  isMatingEndpoint,
  createEmptyWireDrawingState
} from './wire-endpoint';

// Re-export from endpoint-resolver
export type { SubHarnessDataCache } from './endpoint-resolver';
export {
  resolveConnectorEndpoint,
  resolveConnectorMatingEndpoint,
  resolveCableEndpoint,
  resolveComponentEndpoint,
  resolveSubHarnessEndpoint,
  resolveFromEndpoint,
  resolveToEndpoint,
  getEndpointWireColor
} from './endpoint-resolver';

// Re-export from wire-drawing-manager
export { WireDrawingManager } from './wire-drawing-manager';

// Re-export from elements/block-renderer
export {
  drawBlock,
  getBlockDimensions,
  getBlockPinPositions,
  getBlockCentroidOffset,
  hitTestBlock,
  hitTestBlockPin,
  hitTestBlockButton
} from './elements/block-renderer';

// Re-export from grid
export { drawGrid } from './grid';

// Re-export rotation utility
export { rotateAroundCentroid } from './transform-utils';
