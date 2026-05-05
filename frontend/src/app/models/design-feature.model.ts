export type ReviewState = 'draft' | 'in_review' | 'approved' | 'released';

export interface CommitRef {
    sha: string;
    url: string;
    subject?: string;
}

export interface DesignFeatureHistoryEntry {
    id: number;
    designFeatureID: number;
    changedByUserID: number;
    changeType:
        | 'created' | 'updated' | 'submitted' | 'approved' | 'rejected' | 'released'
        | 'requirements_linked' | 'requirements_unlinked' | 'deleted';
    changes?: Record<string, { from: any; to: any }>;
    snapshotData?: any;
    changeNotes?: string;
    createdAt: string;
    changedByUser?: { id: number; displayName: string; email: string; photoURL?: string };
}

export interface DesignFeatureRequirementSummary {
    id: number;
    description: string;
    approvalStatus: string;
    implementationStatus: string;
    projectID: number;
}

export interface DesignFeature {
    id: number;
    name: string;
    slug: string;
    description?: string;
    markdownBody?: string;
    projectID: number;
    ownerUserID: number;
    reviewerUserID?: number | null;
    approvedByUserID?: number | null;
    releasedByUserID?: number | null;
    reviewState: ReviewState;
    submittedAt?: string | null;
    approvedAt?: string | null;
    releasedAt?: string | null;
    branchName?: string | null;
    prURL?: string | null;
    githubRepo?: string | null;
    commitRefs?: CommitRef[];
    prState?: 'open' | 'closed' | 'merged' | null;
    prTitle?: string | null;
    prMergedAt?: string | null;
    prHeadSha?: string | null;
    lastSyncedAt?: string | null;
    activeFlag: boolean;
    createdAt: Date | string;
    updatedAt: Date | string;
    owner?: { id: number; displayName: string; email: string; photoURL?: string };
    reviewer?: { id: number; displayName: string; email: string; photoURL?: string };
    approvedBy?: { id: number; displayName: string; email: string; photoURL?: string };
    releasedBy?: { id: number; displayName: string; email: string; photoURL?: string };
    project?: { id: number; name: string; shortName: string; tagColorHex: string };
    requirements?: DesignFeatureRequirementSummary[];
    requirementCount?: number;
    recentHistory?: DesignFeatureHistoryEntry[];
}

export interface DesignFeatureFilters {
    projectID?: number;
    reviewState?: ReviewState;
    ownerUserID?: number;
}
