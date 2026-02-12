export interface PushSubscriptionRecord {
    id: number;
    userID: number;
    endpoint: string;
    userAgent?: string;
    createdAt: Date;
}
