// Wire Harness TypeScript Interfaces

export interface HarnessPin {
  id: string;
  number: string;
  label?: string;
}

export interface HarnessConnector {
  id: string;
  label: string;
  type: 'male' | 'female' | 'terminal' | 'splice';
  pinCount: number;
  pins: HarnessPin[];
  position: { x: number; y: number };
  color?: string;
  rotation?: 0 | 90 | 180 | 270;  // Rotation in degrees
  flipped?: boolean;              // Vertical flip
  zIndex?: number;                // Layer order (higher = in front)
  dbId?: number;                  // Database record ID
  partId?: number;                // Link to inventory Part
  partName?: string;              // Part name for display
  pinoutDiagramImage?: string;    // Base64 encoded pinout diagram
  connectorImage?: string;        // Base64 encoded connector image
  showPinoutDiagram?: boolean;    // Toggle for pinout diagram visibility
  showConnectorImage?: boolean;   // Toggle for connector image visibility
}

export interface HarnessWire {
  id: string;
  color: string;
  colorCode?: string;
  label?: string;
  gaugeAWG?: string;
  lengthMm?: number;              // Physical length in millimeters
  dbId?: number;                  // Database record ID
  partId?: number;                // Link to inventory Part
}

export interface HarnessCable {
  id: string;
  label: string;
  wireCount: number;
  gaugeAWG?: string;
  wires: HarnessWire[];
  // Position on canvas (for visual cable element)
  position?: { x: number; y: number };
  rotation?: 0 | 90 | 180 | 270;  // Rotation in degrees
  flipped?: boolean;              // Vertical flip
  zIndex?: number;                // Layer order (higher = in front)
  lengthMm?: number;              // Physical length in millimeters
  dbId?: number;                  // Database record ID
  partId?: number;                // Link to inventory Part
  partName?: string;              // Part name for display
  cableDiagramImage?: string;     // Base64 encoded cable diagram
  showCableDiagram?: boolean;     // Toggle for cable diagram visibility
}

export interface HarnessWaypoint {
  x: number;
  y: number;
}

export interface HarnessConnection {
  id: string;
  // From endpoint - can be connector pin or cable wire
  fromConnector?: string;
  fromPin?: string;
  fromCable?: string;
  fromWire?: string;
  fromSide?: 'left' | 'right';  // Which side of cable
  // To endpoint - can be connector pin or cable wire
  toConnector?: string;
  toPin?: string;
  toCable?: string;
  toWire?: string;
  toSide?: 'left' | 'right';  // Which side of cable
  // Legacy fields for backward compatibility
  cable?: string;
  wire?: string;
  // Wire properties
  color?: string;  // Direct wire color code (e.g., 'BK', 'RD', 'BU')
  label?: string;  // Wire label/identifier
  lengthMm?: number;  // Physical length in millimeters
  waypoints?: HarnessWaypoint[];
}

export interface HarnessCanvasSettings {
  zoom: number;
  gridEnabled: boolean;
  snapToGrid: boolean;
  gridSize?: number;
  panX?: number;
  panY?: number;
}

export interface HarnessData {
  name: string;
  partNumber?: string;
  revision?: string;
  description?: string;
  connectors: HarnessConnector[];
  cables: HarnessCable[];
  connections: HarnessConnection[];
  canvasSettings?: HarnessCanvasSettings;
}

export interface WireHarness {
  id: number;
  name: string;
  partNumber: string | null;
  partID: number | null;
  revision: string;
  description: string | null;
  harnessData: HarnessData;
  thumbnailBase64: string | null;
  activeFlag: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WireHarnessSummary {
  id: number;
  name: string;
  partNumber: string | null;
  revision: string;
  description: string | null;
  thumbnailBase64: string | null;
  activeFlag: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HarnessPagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface HarnessListResponse {
  harnesses: WireHarnessSummary[];
  pagination: HarnessPagination;
}

export interface HarnessValidationResult {
  valid: boolean;
  errors: string[];
}

// Database entity types (from backend API)
export interface DbHarnessConnector {
  id: number;
  label: string;
  type: 'male' | 'female' | 'terminal' | 'splice';
  pinCount: number;
  color: string | null;
  pins: HarnessPin[];
  pinoutDiagramImage: string | null;
  connectorImage: string | null;
  partID: number | null;
  activeFlag: boolean;
  createdAt: string;
  updatedAt: string;
  part?: { id: number; name: string };
}

export interface DbHarnessWire {
  id: number;
  label: string;
  color: string;
  colorCode: string | null;
  gaugeAWG: string | null;
  partID: number | null;
  activeFlag: boolean;
  createdAt: string;
  updatedAt: string;
  part?: { id: number; name: string };
}

export interface DbHarnessCable {
  id: number;
  label: string;
  wireCount: number;
  gaugeAWG: string | null;
  wires: { id: string; color: string; colorCode?: string }[];
  cableDiagramImage: string | null;
  partID: number | null;
  activeFlag: boolean;
  createdAt: string;
  updatedAt: string;
  part?: { id: number; name: string };
}

// Default empty harness data factory
export function createEmptyHarnessData(name: string = 'New Harness'): HarnessData {
  return {
    name,
    partNumber: '',
    revision: 'A',
    description: '',
    connectors: [],
    cables: [],
    connections: [],
    canvasSettings: {
      zoom: 1,
      gridEnabled: true,
      snapToGrid: true,
      gridSize: 20,
      panX: 0,
      panY: 0
    }
  };
}
