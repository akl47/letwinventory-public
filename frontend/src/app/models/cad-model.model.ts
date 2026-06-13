import type { FeatureTree, SketchDocument } from '../cad/lib/types';
import type { EquationDoc } from '../cad/lib/equations';

export type CadReleaseState = 'draft' | 'review' | 'released';

/** A saved camera orientation (spherical orbit) for the viewer's Default-view
 * control and commit thumbnails. */
export interface CadDefaultView {
  theta: number;
  phi: number;
  distance: number;
  target: [number, number, number];
}

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
  /** Saved camera orientation for the Default-view control + commit thumbnails. */
  defaultView?: CadDefaultView | null;
  /** True when on main and at least one numeric revision is released. */
  released?: boolean;
  /** True after a development release: the design is locked read-only. */
  releaseLocked?: boolean;
  /** Display revision: on main = highest released numeric; on a draft branch =
   * the derived next number (highest released + 1), shared by all drafts. */
  displayRevision?: string | null;
  /** The derived draft revision (null on main). */
  draftRevision?: string | null;
  /** True when a draft branch is behind main (main advanced) — rebase to release. */
  behindMain?: boolean;
  // Part identity, included by getById / getActiveByPart.
  part?: { id: number; name: string; sku?: string | null; manufacturerPN?: string | null; revision: string } | null;
  /** True when this model is an assembly (assemblyDoc carries the content). */
  isAssembly?: boolean;
  /** Assembly document (typed as AssemblyDoc in cad/lib/assembly.types — kept
   * `unknown` here to avoid an import cycle). */
  assemblyDoc?: unknown;
}

/** A commit's trimmed geometry for the lightweight 3D preview. `vertices` and
 * `edges` feed measurement snapping; `persistentName` feeds the face-level diff. */
export interface CadCommitGeometry {
  faces: { persistentName?: string; positions: number[]; normals: number[]; indices: number[] }[];
  vertices?: [number, number, number][];
  edges?: { polyline: [number, number, number][] }[];
  bodyCount: number;
  /** Per-feature regen errors (e.g. a merge preview where a feature can't apply
   * against the chosen result body). Surfaced so the merge tool can flag which
   * features failed instead of silently dropping them. */
  errors?: string[];
  /** Per-body final geometry — lets the editor's read-only commit view populate
   * the Bodies panel and support per-body show/hide (the flat `faces` above is
   * the same data merged, kept for the lightweight preview). */
  bodies?: {
    id: string;
    name: string | null;
    faces: { persistentName?: string; positions: number[]; normals: number[]; indices: number[] }[];
    vertices?: [number, number, number][];
    edges?: { polyline: [number, number, number][] }[];
  }[];
}

/** A node in the part's CAD version graph (a commit, with lane + tags). */
export interface CadVersionNode {
  hash: string;
  shortHash: string;
  parents: string[];
  message: string;
  timestamp: string;
  branch: string;
  lane: 'main' | 'exp';
  tags: string[];
  isHead: boolean;
  author: { id: number; name: string; initials: string } | null;
  state: 'draft' | 'review' | 'released';
}
export interface CadVersionGraph {
  head: string | null;
  branches: { name: string; head: string }[];
  nodes: CadVersionNode[];
}

/** The review-workflow state of a CAD model + the actions available now. */
export interface CadWorkflow {
  state: string;
  actions: { action: string; to: string }[];
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
  /** Feature-tree-style display name (feature/sketch's own name, or type label). */
  displayName?: string;
  kind: string;
  status: 'added' | 'removed' | 'modified' | 'unchanged';
  aHash: string | null;
  bHash: string | null;
  paramDiff?: { changed: { key: string; a: unknown; b: unknown }[]; added: string[]; removed: string[] };
  /** For modified sketches: the specific entity/constraint changes. */
  sketchDiff?: {
    entities: { id: string; kind: string; status: 'added' | 'removed' | 'modified' }[];
    constraints: { id: string; type: string; status: 'added' | 'removed' | 'modified'; a?: number; b?: number }[];
    meta: { key: string; a: unknown; b: unknown }[];
  };
}
export interface CadCommitDiff { commitA: string; commitB: string; entries: CadDiffEntry[]; }
export interface CadBodyDiff { commitA: string; commitB: string; bodies: { id: string; status: string }[]; }

/** Per-face status used to paint the Compare previews. */
export type FaceStatus = 'added' | 'removed' | 'unchanged';
/** Face-level diff between two commits, by persistent face name. */
export interface CadFaceDiff { commitA: string; commitB: string; namesA: string[]; namesB: string[]; }

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
  part: { id: number; name: string; revision: string; description: string | null; imageFileID?: number | null } | null;
  /** VCS-derived revision the editor shows (highest released on main, highest+1
   * on a draft branch). Use this for the part-number label so it matches the
   * editor badge instead of the raw Parts.revision. */
  displayRevision?: string | null;
  revisionCount: number;
  latestRevisionID: number | null;
  latestRevision: string | null;
  latestReleaseState: CadReleaseState | null;
  latestUpdatedAt: string | null;
  hasReleased: boolean;
  releasedRevisionID: number | null;
  releasedRevision: string | null;
  isAssembly?: boolean;
  instanceCount?: number;
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
