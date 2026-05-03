export interface ToolCategory {
  id: number;
  name: string;
  description?: string;
  activeFlag: boolean;
  subcategories?: ToolSubcategory[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ToolSubcategory {
  id: number;
  name: string;
  description?: string;
  activeFlag: boolean;
  categories?: ToolCategory[];
  createdAt?: string;
  updatedAt?: string;
}

export interface Tool {
  id: number;
  partID: number;
  part?: {
    id: number;
    name: string;
    description?: string | null;
    revision?: string;
    imageFileID?: number | null;
  };
  toolSubcategoryID: number;
  toolSubcategory?: ToolSubcategory;
  diameter?: number | string | null;
  overallLength?: number | string | null;
  fluteLength?: number | string | null;
  shankDiameter?: number | string | null;
  cornerRadius?: number | string | null;
  reducedShankDiameter?: number | string | null;
  squareDriveSize?: number | string | null;
  numberOfSteps?: number | null;
  stepDelta?: number | string | null;
  numberOfFlutes?: number | null;
  tipAngle?: number | string | null;
  toolMaterial?: string | null;
  coating?: string | null;
  notes?: string | null;
  activeFlag: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ToolWritePayload {
  partID?: number;
  toolSubcategoryID?: number;
  diameter?: number | null;
  overallLength?: number | null;
  fluteLength?: number | null;
  shankDiameter?: number | null;
  cornerRadius?: number | null;
  reducedShankDiameter?: number | null;
  squareDriveSize?: number | null;
  numberOfSteps?: number | null;
  stepDelta?: number | null;
  numberOfFlutes?: number | null;
  tipAngle?: number | null;
  toolMaterial?: string | null;
  coating?: string | null;
  notes?: string | null;
  activeFlag?: boolean;
}

export interface ToolSubcategoryWritePayload {
  name: string;
  description?: string;
  categoryIDs: number[];
}
