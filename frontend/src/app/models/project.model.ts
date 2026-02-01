export interface Project {
    id: number;
    ownerUserID: number;
    parentProjectID?: number;
    tagColorHex: string;
    name: string;
    shortName: string;
    description?: string;
    keyboardShortcut?: string;
    activeFlag: boolean;
    createdAt: Date;
    updatedAt: Date;
}
