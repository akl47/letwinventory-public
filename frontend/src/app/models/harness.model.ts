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
  groupId?: string;               // Group membership
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
  groupId?: string;               // Group membership
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
  groupId?: string;               // Group membership
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
  // Connection type: wire (default) or mating (direct connector-to-connector)
  connectionType?: 'wire' | 'mating';
  // From endpoint - can be connector pin, cable wire, or component pin
  fromConnector?: string;
  fromPin?: string;
  fromCable?: string;
  fromWire?: string;
  fromSide?: 'left' | 'right';  // Which side of cable
  fromComponent?: string;       // Component ID
  fromComponentPin?: string;    // Pin ID within the component
  // For sub-harness connections
  fromSubHarness?: string;      // Sub-harness instance ID
  fromSubConnector?: string;    // Connector ID within the sub-harness
  // To endpoint - can be connector pin, cable wire, or component pin
  toConnector?: string;
  toPin?: string;
  toCable?: string;
  toWire?: string;
  toSide?: 'left' | 'right';  // Which side of cable
  toComponent?: string;       // Component ID
  toComponentPin?: string;    // Pin ID within the component
  // For sub-harness connections
  toSubHarness?: string;        // Sub-harness instance ID
  toSubConnector?: string;      // Connector ID within the sub-harness
  // Legacy fields for backward compatibility
  cable?: string;
  wire?: string;
  // Wire properties
  color?: string;  // Direct wire color code (e.g., 'BK', 'RD', 'BU')
  label?: string;  // Wire label/identifier
  gauge?: string;  // Wire gauge (e.g., '18 AWG', '20 AWG')
  lengthMm?: number;  // Physical length in millimeters
  labelPosition?: number;  // Position of label along wire (0-1, default 0.5 = center)
  waypoints?: HarnessWaypoint[];
  // Termination types for each end
  fromTermination?: string;  // e.g., 'f-pin', 'm-pin', 'ring', 'ferrule', etc.
  toTermination?: string;
  // Group membership
  groupId?: string;
}

export interface HarnessCanvasSettings {
  zoom: number;
  gridEnabled: boolean;
  snapToGrid: boolean;
  gridSize?: number;
  panX?: number;
  panY?: number;
}

// Sub-harness reference (for nested harnesses)
// Sub-harnesses are always displayed fully expanded showing all their connectors/components
export interface SubHarnessRef {
  id: string;                    // Instance ID (unique within parent, e.g., 'sub-1')
  harnessId: number;             // DB ID of the referenced harness
  position: { x: number; y: number };
  rotation?: 0 | 90 | 180 | 270;
  flipped?: boolean;
  zIndex?: number;
  groupId?: string;              // Group membership
}

// Element group for keeping elements positioned together
export interface ElementGroup {
  id: string;
  name?: string;
  // Relative positions of elements within group (offset from group anchor)
  memberOffsets: {
    elementType: 'connector' | 'cable' | 'component' | 'subHarness';
    elementId: string;
    offsetX: number;
    offsetY: number;
  }[];
}

/**
 * Release state for revision control workflow
 */
export type ReleaseState = 'draft' | 'review' | 'released';

/**
 * Main harness data structure containing all design elements
 */
export interface HarnessData {
  name: string;
  partNumber?: string;
  revision?: string;
  description?: string;
  /** Current release state: draft, review, or released */
  releaseState?: ReleaseState;
  connectors: HarnessConnector[];
  cables: HarnessCable[];
  components: HarnessComponent[];
  connections: HarnessConnection[];
  subHarnesses?: SubHarnessRef[];
  groups?: ElementGroup[];
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
  // Revision control fields
  releaseState?: ReleaseState;
  releasedAt?: string | null;
  releasedBy?: string | null;
  previousRevisionID?: number | null;
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
  // Revision control fields
  releaseState?: ReleaseState;
  releasedAt?: string | null;
  releasedBy?: string | null;
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

// Revision history entry
export interface HarnessHistoryEntry {
  id: number;
  harnessID: number;
  revision: string;
  releaseState: string;
  changedBy: string | null;
  changeType: 'created' | 'updated' | 'submitted_review' | 'rejected' | 'released' | 'new_revision';
  changeNotes: string | null;
  snapshotData: HarnessData | null;
  createdAt: string;
}

// Electrical Pin Type (for connector pin styles)
export interface ElectricalPinType {
  id: number;
  name: string;
  description?: string;
}

// Wire End / Termination Type
export interface WireEnd {
  id: number;
  code: string;
  name: string;
  description?: string;
  activeFlag: boolean;
}

// Database entity types (from backend API)
export interface DbElectricalConnector {
  id: number;
  label: string;
  type: 'male' | 'female' | 'terminal' | 'splice';
  pinCount: number;
  color: string | null;
  pins: HarnessPin[];
  pinoutDiagramFileID: number | null;
  connectorImageFileID: number | null;
  pinoutDiagramFile?: UploadedFileRef | null;
  connectorImageFile?: UploadedFileRef | null;
  // Computed properties for backward compatibility
  pinoutDiagramImage?: string | null;
  connectorImage?: string | null;
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
  cableDiagramFileID: number | null;
  cableDiagramFile?: UploadedFileRef | null;
  // Computed property for backward compatibility
  cableDiagramImage?: string | null;
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
  pinoutDiagramFileID: number | null;
  componentImageFileID: number | null;
  pinoutDiagramFile?: UploadedFileRef | null;
  componentImageFile?: UploadedFileRef | null;
  // Computed properties for backward compatibility
  pinoutDiagramImage?: string | null;
  componentImage?: string | null;
  partID: number | null;
  activeFlag: boolean;
  createdAt: string;
  updatedAt: string;
  part?: { id: number; name: string };
}

// Uploaded file reference from backend
export interface UploadedFileRef {
  id: number;
  filename: string;
  mimeType: string;
  data: string;  // Base64 encoded with data URI prefix
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
    revision: '01',
    description: '',
    connectors: [],
    cables: [],
    components: [],
    connections: [],
    subHarnesses: [],
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
