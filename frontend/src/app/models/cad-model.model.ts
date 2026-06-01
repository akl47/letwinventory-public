import type { FeatureTree, SketchDocument } from '../cad/lib/types';
import type { EquationDoc } from '../cad/lib/equations';

export type CadReleaseState = 'draft' | 'review' | 'released';

export interface CadModel {
  id: number;
  name: string | null;
  partID: number;
  featureTree: FeatureTree;
  sketchDoc: SketchDocument;
  equations?: EquationDoc;
  createdByUserID: number;
  activeFlag: boolean;
  createdAt: string;
  updatedAt: string;
  // VCS working-copy state (Phase 1). Revision identity = the Part's revision;
  // released states are VCS tags, not model columns.
  branchName?: string;
  baseCommitHash?: string | null;
  dirty?: boolean;
  lockedByUserID?: number | null;
  lockedAt?: string | null;
  lockExpiresAt?: string | null;
  // Part identity, included by getById / getActiveByPart.
  part?: { id: number; name: string; sku?: string | null; manufacturerPN?: string | null; revision: string } | null;
}

/** A VCS branch in a CAD model's repository. */
export interface CadBranch {
  name: string;
  kind: 'branch';
  targetHash: string;
}

/** One entry in a structural diff between two commits. */
export interface CadDiffEntry {
  name: string;
  kind: string;
  status: 'added' | 'removed' | 'modified' | 'unchanged';
  aHash: string | null;
  bHash: string | null;
  paramDiff?: { changed: { key: string; a: unknown; b: unknown }[]; added: string[]; removed: string[] };
}
export interface CadCommitDiff { commitA: string; commitB: string; entries: CadDiffEntry[]; }
export interface CadBodyDiff { commitA: string; commitB: string; bodies: { id: string; status: string }[]; }

/** A VCS commit on a CAD model's branch (newest-first in the log). */
export interface CadCommit {
  hash: string;
  treeHash: string;
  parents: string[];
  authorUserID: number | null;
  message: string;
  timestamp: string;
  meta: { kernelVersion?: string; namingVersion?: number; frozen?: unknown };
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
