import { PartCategory } from './part-category.model';

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
    createdAt: string;
    updatedAt: string;
    PartCategory?: PartCategory;
}
