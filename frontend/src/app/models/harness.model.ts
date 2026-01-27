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

export interface HarnessComponentPin {
  id: string;
  number: string;
  label?: string;
}

export interface HarnessComponentPinGroup {
  id: string;
  name: string;
  pinTypeID: number | null;
  pinTypeName?: string;
  pins: HarnessComponentPin[];
}

export interface HarnessComponent {
  id: string;
  label: string;
  pinCount: number;
  pinGroups: HarnessComponentPinGroup[];
  position: { x: number; y: number };
  rotation?: 0 | 90 | 180 | 270;  // Rotation in degrees
  flipped?: boolean;              // Vertical flip
  zIndex?: number;                // Layer order (higher = in front)
  dbId?: number;                  // Database record ID
  partId?: number;                // Link to inventory Part
  partName?: string;              // Part name for display
  pinoutDiagramImage?: string;    // Base64 encoded pinout diagram
  componentImage?: string;        // Base64 encoded component image
  showPinoutDiagram?: boolean;    // Toggle for pinout diagram visibility
  showComponentImage?: boolean;   // Toggle for component image visibility
}

export interface HarnessWaypoint {
  x: number;
  y: number;
}

export interface HarnessConnection {
  id: string;
  // From endpoint - can be connector pin, cable wire, or component pin
  fromConnector?: string;
  fromPin?: string;
  fromCable?: string;
  fromWire?: string;
  fromSide?: 'left' | 'right';  // Which side of cable
  fromComponent?: string;       // Component ID
  fromComponentPin?: string;    // Pin ID within the component
  // To endpoint - can be connector pin, cable wire, or component pin
  toConnector?: string;
  toPin?: string;
  toCable?: string;
  toWire?: string;
  toSide?: 'left' | 'right';  // Which side of cable
  toComponent?: string;       // Component ID
  toComponentPin?: string;    // Pin ID within the component
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
  components: HarnessComponent[];
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

// Electrical Pin Type (for connector pin styles)
export interface ElectricalPinType {
  id: number;
  name: string;
  description?: string;
}

// Database entity types (from backend API)
export interface DbElectricalConnector {
  id: number;
  label: string;
  type: 'male' | 'female' | 'terminal' | 'splice';
  pinCount: number;
  color: string | null;
  pins: HarnessPin[];
  pinoutDiagramImage: string | null;
  connectorImage: string | null;
  partID: number | null;
  electricalPinTypeID: number | null;
  activeFlag: boolean;
  createdAt: string;
  updatedAt: string;
  part?: { id: number; name: string };
  pinType?: { id: number; name: string };
}

export interface DbWire {
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

export interface DbCable {
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

export interface ComponentPin {
  id: string;
  number: string;
  label: string;
}

export interface ComponentPinGroup {
  id: string;
  name: string;
  pinTypeID: number | null;
  pinTypeName?: string;  // For display purposes
  pins: ComponentPin[];
}

export interface DbElectricalComponent {
  id: number;
  label: string;
  pinCount: number;
  pins: ComponentPinGroup[];  // Array of pin groups
  pinoutDiagramImage: string | null;
  componentImage: string | null;
  partID: number | null;
  activeFlag: boolean;
  createdAt: string;
  updatedAt: string;
  part?: { id: number; name: string };
}

// Type aliases for backward compatibility
export type DbHarnessConnector = DbElectricalConnector;
export type DbHarnessWire = DbWire;
export type DbHarnessCable = DbCable;

// Default empty harness data factory
export function createEmptyHarnessData(name: string = 'New Harness'): HarnessData {
  return {
    name,
    partNumber: '',
    revision: 'A',
    description: '',
    connectors: [],
    cables: [],
    components: [],
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
