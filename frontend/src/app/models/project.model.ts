export interface Project {
    id: number;
    ownerUserID: number;
    parentProjectID?: number;
    tagColorHex: string;
    name: string;
    shortName: string;
    description?: string;
    activeFlag: boolean;
    createdAt: Date;
    updatedAt: Date;
}
