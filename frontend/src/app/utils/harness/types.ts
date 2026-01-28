// Shared types for harness canvas rendering

import { HarnessConnector, HarnessConnection, HarnessCable, HarnessComponent } from '../../models/harness.model';

// Base position interface for pins and wire endpoints
export interface PinPosition {
  pinId: string;
  x: number;
  y: number;
}

// Extended position for cable wires (includes side info)
export interface CableWirePosition extends PinPosition {
  wireId: string;
  side: 'left' | 'right';
}

// Extended position for component pins (includes group info)
export interface ComponentPinPosition extends PinPosition {
  groupId: string;
}

// Dimensions returned by getDimensions functions
export interface ElementDimensions {
  width: number;
  height: number;
}

export interface ConnectorDimensions extends ElementDimensions {
  hasPartName: boolean;
  hasConnectorImage: boolean;
  connectorImageHeight: number;
}

export interface CableDimensions extends ElementDimensions {
  hasPartName: boolean;
  hasInfoRow: boolean;
}

export interface ComponentDimensions extends ElementDimensions {
  hasPartName: boolean;
  hasComponentImage: boolean;
  componentImageHeight: number;
  groupHeights: number[];
}

// Centroid offset for rotation calculations
export interface CentroidOffset {
  cx: number;
  cy: number;
}

// Canvas object for legacy support
export interface CanvasObject {
  type: 'connector' | 'wire';
  id: string;
  bounds: { x: number; y: number; width: number; height: number };
  data: HarnessConnector | HarnessConnection;
}

// Common element properties shared by connectors, cables, and components
export interface HarnessElement {
  id: string;
  position?: { x: number; y: number };
  rotation?: 0 | 90 | 180 | 270;
  flipped?: boolean;
  zIndex?: number;
}

// Transform parameters for coordinate conversion
export interface TransformParams {
  ox: number;  // Origin x
  oy: number;  // Origin y
  rotation: number;
  flipped: boolean;
  width: number;
  originOffsetY?: number;  // Additional Y offset for drawing origin
}
