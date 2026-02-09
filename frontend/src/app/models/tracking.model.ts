export type CarrierType = 'usps' | 'ups' | 'fedex' | 'dhl' | 'unknown';

export interface TrackingEvent {
    timestamp: string;
    status: string;
    description: string;
    location?: string;
}

export interface ShipmentTracking {
    id: number;
    orderID: number | null;
    ownerUserID: number;
    trackingNumber: string;
    carrier: CarrierType;
    status: string | null;
    statusDetail: string | null;
    estimatedDelivery: string | null;
    deliveredAt: string | null;
    lastCheckedAt: string | null;
    trackingData: TrackingEvent[] | null;
    activeFlag: boolean;
    createdAt: string;
    updatedAt: string;
    Order?: { id: number; vendor: string; description: string };
}
