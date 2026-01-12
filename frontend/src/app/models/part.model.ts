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
    createdAt: string;
    updatedAt: string;
    PartCategory?: PartCategory;
    UnitOfMeasure?: UnitOfMeasure;
}
