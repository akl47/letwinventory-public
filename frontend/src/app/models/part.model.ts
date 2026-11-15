import { PartCategory } from './part-category.model';

import { UnitOfMeasure } from './trace.model';

export interface PartProjectRef {
    id: number;
    name: string;
    shortName: string;
    tagColorHex: string;
}

export interface Part {
    id: number;
    name: string;
    description: string | null;
    internalPart: boolean;
    vendor: string;
    sku: string | null;
    link: string | null;
    minimumOrderQuantity: number;
    partCategoryID: number;
    activeFlag: boolean;
    serialNumberRequired: boolean;
    lotNumberRequired: boolean;
    defaultUnitOfMeasureID: number | null;
    manufacturer: string | null;
    manufacturerPN: string | null;
    minimumStockQuantity: number | null;
    revision: string;
    revisionLocked: boolean;
    previousRevisionID?: number | null;
    /** The design this part has, if any — returned by the part list (REQ 1072). */
    design?: { kind: 'cad' | 'assembly' | 'harness'; id: number } | null;
    /** A common part may be used in every project (REQ 1069). */
    commonPart?: boolean;
    /** Projects this part belongs to (REQ 1069). */
    projects?: PartProjectRef[];
    imageFileID?: number | null;
    imageFile?: { id: number; filename: string; mimeType: string; data: string } | null;
    createdAt: string;
    updatedAt: string;
    PartCategory?: PartCategory;
    UnitOfMeasure?: UnitOfMeasure;
}
