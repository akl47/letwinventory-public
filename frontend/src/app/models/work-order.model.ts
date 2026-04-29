import { EngineeringMaster } from './engineering-master.model';

export interface WorkOrder {
  id: number;
  engineeringMasterID: number;
  status: 'not_started' | 'in_progress' | 'complete';
  quantity: number;
  locationBarcodeID: number | null;
  locationBarcode?: { id: number; barcode: string } | null;
  master: EngineeringMaster;
  stepCompletions: WorkOrderStepCompletion[];
  outputTraces: WorkOrderTrace[];
  completedSteps?: number;
  totalSteps?: number;
  createdByUserID: number;
  completedAt: string | null;
  activeFlag: boolean;
  deletionReason?: string | null;
  deletedByUserID?: number | null;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkOrderStepCompletion {
  id: number;
  workOrderID: number;
  stepID: number;
  completedByUserID: number;
  completedBy?: { id: number; displayName: string };
  completedAt: string;
}

export interface WorkOrderTrace {
  id: number;
  partID: number;
  Part?: { id: number; name: string; revision: string; description?: string };
  quantity: number;
  barcodeID: number;
  Barcode?: { id: number; barcode: string; parentBarcodeID: number };
  workOrderID: number;
  activeFlag: boolean;
}

export interface WorkOrderKitStatus {
  workOrderID: number;
  outputTraces: { barcodeID: number; barcode: string; partID: number; partName: string; quantity: number }[];
  bomStatus: WorkOrderBomLine[];
  overallStatus: 'complete' | 'partial';
}

export interface WorkOrderBomLine {
  partID: number;
  partName: string;
  partRevision: string;
  isTool: boolean;
  required: number;
  kitted: number;
  status: 'complete' | 'partial';
  kittedTraces: KittedTrace[];
}

export interface KittedTrace {
  barcodeID: number;
  barcode: string;
  qty: number;
  traceActiveFlag: boolean;
  barcodeActiveFlag: boolean;
}
