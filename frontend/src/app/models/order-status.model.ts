export interface OrderStatus {
    id: number;
    name: string;
    tagColor: string | null;
    nextStatusID: number | null;
    activeFlag: boolean;
    createdAt: string;
    updatedAt: string;
    NextStatus?: OrderStatus;
}
