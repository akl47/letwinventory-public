import type { FeatureTree, SketchDocument } from '../cad/lib/types';
import type { EquationDoc } from '../cad/lib/equations';

export type CadReleaseState = 'draft' | 'review' | 'released';

export interface CadModel {
  id: number;
  name: string | null;
  partID: number;
  revision: string;
  previousRevisionID: number | null;
  featureTree: FeatureTree;
  sketchDoc: SketchDocument;
  equations?: EquationDoc;
  releaseState: CadReleaseState;
  submittedAt: string | null;
  releasedAt: string | null;
  releasedByUserID: number | null;
  createdByUserID: number;
  activeFlag: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PartWithCadSummary {
  partID: number;
  part: { id: number; name: string; revision: string; description: string | null } | null;
  revisionCount: number;
  latestRevisionID: number | null;
  latestRevision: string | null;
  latestReleaseState: CadReleaseState | null;
  latestUpdatedAt: string | null;
  hasReleased: boolean;
  releasedRevisionID: number | null;
  releasedRevision: string | null;
}

export interface CadModelHistoryEntry {
  id: number;
  cadModelID: number;
  changeType: 'created' | 'updated' | 'submitted' | 'released' | 'new_revision' | 'deleted';
  changedByUserID: number;
  previousState: Record<string, unknown> | null;
  newState: Record<string, unknown> | null;
  createdAt: string;
}
