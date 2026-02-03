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
export type { WireObstacle } from './wire';

// Re-export from grid
export { drawGrid } from './grid';

// Re-export rotation utility
export { rotateAroundCentroid } from './transform-utils';
