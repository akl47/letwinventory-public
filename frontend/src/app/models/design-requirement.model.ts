export interface RequirementCategory {
    id: number;
    name: string;
    description?: string;
    activeFlag: boolean;
}

export interface RequirementHistoryEntry {
    id: number;
    requirementID: number;
    changedByUserID: number;
    changeType: 'created' | 'updated' | 'approved' | 'unapproved' | 'deleted';
    changes: Record<string, { from: any; to: any; fromName?: string; toName?: string }>;
    changeNotes?: string;
    createdAt: string;
    changedBy?: { id: number; displayName: string; email: string; photoURL?: string };
}

export interface DesignRequirement {
    id: number;
    description: string;
    rationale?: string;
    parameter?: string;
    parentRequirementID?: number;
    projectID: number;
    categoryID?: number;
    verification?: string;
    validation?: string;
    ownerUserID: number;
    approved: boolean;
    approvedByUserID?: number;
    approvedAt?: Date;
    activeFlag: boolean;
    createdAt: Date;
    updatedAt: Date;
    owner?: { id: number; displayName: string; email: string; photoURL?: string };
    approvedBy?: { id: number; displayName: string; email: string; photoURL?: string };
    project?: { id: number; name: string; shortName: string; tagColorHex: string };
    category?: RequirementCategory;
    parentRequirement?: { id: number; description: string };
    childRequirements?: DesignRequirement[];
}
