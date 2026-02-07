import { PartCategory } from './part-category.model';

import { UnitOfMeasure } from './trace.model';

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
    imageFileID?: number | null;
    imageFile?: { id: number; filename: string; mimeType: string; data: string } | null;
    createdAt: string;
    updatedAt: string;
    PartCategory?: PartCategory;
    UnitOfMeasure?: UnitOfMeasure;
}
