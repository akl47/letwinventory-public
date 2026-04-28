export interface EngineeringMaster {
  id: number;
  name: string;
  description: string | null;
  revision: string;
  releaseState: 'draft' | 'review' | 'released';
  previousRevisionID: number | null;
  createdByUserID: number;
  releasedByUserID: number | null;
  releasedAt: string | null;
  activeFlag: boolean;
  outputParts: EngineeringMasterOutputPart[];
  bomItems: EngineeringMasterBomItem[];
  steps: EngineeringMasterStep[];
  stepCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface EngineeringMasterOutputPart {
  id: number;
  engineeringMasterID: number;
  partID: number;
  quantity: number;
  part: {
    id: number;
    name: string;
    revision: string;
    description?: string;
    defaultUnitOfMeasureID?: number;
    UnitOfMeasure?: { id: number; name: string; allowDecimal: boolean } | null;
  };
}

export interface EngineeringMasterBomItem {
  id: number;
  engineeringMasterID: number;
  partID: number;
  quantity: number;
  isTool: boolean;
  part: {
    id: number;
    name: string;
    revision: string;
    description?: string;
    imageFileID?: number;
    imageFile?: { id: number } | null;
    defaultUnitOfMeasureID?: number;
    UnitOfMeasure?: { id: number; name: string; allowDecimal: boolean } | null;
  };
}

export interface EngineeringMasterStep {
  id: number;
  engineeringMasterID: number;
  stepNumber: number;
  title: string;
  instructions: string | null;
  imageFileID: number | null;
  imageFile: { id: number; filename: string; mimeType: string; data: string } | null;
  parts: EngineeringMasterStepItem[];
  tooling: EngineeringMasterStepItem[];
  markers: EngineeringMasterStepMarker[];
}

export interface EngineeringMasterStepItem {
  id: number;
  stepID: number;
  partID: number;
  quantity: number;
  isTool: boolean;
  part: { id: number; name: string; revision: string; description?: string };
}

export interface EngineeringMasterStepMarker {
  id: number;
  stepID: number;
  label: string;
  x: number;
  y: number;
}

export interface EngineeringMasterHistory {
  id: number;
  engineeringMasterID: number;
  changeType: 'created' | 'updated' | 'submitted' | 'rejected' | 'released' | 'new_revision' | 'deleted';
  changes: any;
  snapshotData: any;
  changedByUserID: number;
  changedBy?: { id: number; displayName: string };
  createdAt: string;
}
