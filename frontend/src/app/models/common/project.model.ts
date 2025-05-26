export interface Project {
    id: number;
    name: string;
    shortName: string;
    description?: string;
    tagColorHex: string;
    activeFlag: boolean;
    ownerUserID: number;
    parentProjectID?: number;
    createdAt: Date;
    updatedAt: Date;
} 