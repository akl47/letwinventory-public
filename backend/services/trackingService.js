const { Op } = require('sequelize');

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

// Cached OAuth tokens
let uspsToken = null;
let uspsTokenExpiry = 0;
let upsToken = null;
let upsTokenExpiry = 0;
let fedexToken = null;
let fedexTokenExpiry = 0;

/**
 * Detect carrier from tracking number using regex patterns
 */
function detectCarrier(trackingNumber) {
    if (!trackingNumber) return 'unknown';
    const tn = trackingNumber.trim().toUpperCase();

    // UPS: starts with 1Z, 18-20 alphanumeric chars
    if (/^1Z[A-Z0-9]{16,18}$/i.test(tn)) return 'ups';

    // USPS: 20-22 digits, or starts with 92/94/93/94/95
    if (/^(92|94|93|95)\d{18,22}$/.test(tn)) return 'usps';
    if (/^\d{20,22}$/.test(tn)) return 'usps';
    // USPS also uses 13-char format like XX123456789US
    if (/^[A-Z]{2}\d{9}US$/i.test(tn)) return 'usps';

    // FedEx: 12, 15, or 20 digits
    if (/^\d{12}$/.test(tn) || /^\d{15}$/.test(tn) || /^\d{20}$/.test(tn)) return 'fedex';

    // DHL: 10 digits or starts with JD/JJD
    if (/^\d{10}$/.test(tn)) return 'dhl';
    if (/^(JD|JJD)\d{18,}$/i.test(tn)) return 'dhl';

    return 'unknown';
}

/**
 * Get USPS OAuth2 token
 */
async function getUSPSToken() {
    if (uspsToken && Date.now() < uspsTokenExpiry) return uspsToken;

    const clientId = process.env.USPS_CLIENT_ID;
    const clientSecret = process.env.USPS_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;

    try {
        const res = await fetch('https://api.usps.com/oauth2/v3/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: clientId,
                client_secret: clientSecret
            })
        });
        const data = await res.json();
        if (data.access_token) {
            uspsToken = data.access_token;
            uspsTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
            return uspsToken;
        }
    } catch (err) {
        console.error('[Tracking] USPS token error:', err.message);
    }
    return null;
}

/**
 * Get UPS OAuth2 token
 */
async function getUPSToken() {
    if (upsToken && Date.now() < upsTokenExpiry) return upsToken;

    const clientId = process.env.UPS_CLIENT_ID;
    const clientSecret = process.env.UPS_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;

    try {
        const res = await fetch('https://onlinetools.ups.com/security/v1/oauth/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
            },
            body: new URLSearchParams({ grant_type: 'client_credentials' })
        });
        const data = await res.json();
        if (data.access_token) {
            upsToken = data.access_token;
            upsTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
            return upsToken;
        }
    } catch (err) {
        console.error('[Tracking] UPS token error:', err.message);
    }
    return null;
}

/**
 * Get FedEx OAuth2 token
 */
async function getFedExToken() {
    if (fedexToken && Date.now() < fedexTokenExpiry) return fedexToken;

    const clientId = process.env.FEDEX_CLIENT_ID;
    const clientSecret = process.env.FEDEX_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;

    try {
        const res = await fetch('https://apis.fedex.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: clientId,
                client_secret: clientSecret
            })
        });
        const data = await res.json();
        if (data.access_token) {
            fedexToken = data.access_token;
            fedexTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
            return fedexToken;
        }
    } catch (err) {
        console.error('[Tracking] FedEx token error:', err.message);
    }
    return null;
}

/**
 * Normalize a status string to a standard status
 */
function normalizeStatus(rawStatus) {
    if (!rawStatus) return 'Unknown';
    const s = rawStatus.toLowerCase();
    if (s.includes('deliver')) return 'Delivered';
    if (s.includes('out for delivery')) return 'Out for Delivery';
    if (s.includes('in transit') || s.includes('transit')) return 'In Transit';
    if (s.includes('accepted') || s.includes('picked up') || s.includes('shipment information')) return 'Accepted';
    if (s.includes('exception') || s.includes('alert')) return 'Exception';
    if (s.includes('pre-shipment') || s.includes('pre_shipment') || s.includes('label created')) return 'Pre-Shipment';
    return rawStatus;
}

/**
 * Fetch tracking from USPS API v3
 */
async function fetchUSPS(trackingNumber) {
    const token = await getUSPSToken();
    if (!token) return null;

    try {
        const res = await fetch(`https://api.usps.com/tracking/v3/tracking/${encodeURIComponent(trackingNumber)}?expand=DETAIL`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return null;
        const data = await res.json();

        const trackingInfo = data.trackingNumber ? data : data.tracking;
        if (!trackingInfo) return null;

        const events = [];
        if (trackingInfo.trackingEvents) {
            for (const evt of trackingInfo.trackingEvents) {
                events.push({
                    timestamp: evt.eventTimestamp || evt.eventDate,
                    status: normalizeStatus(evt.eventType),
                    description: evt.eventDescription || evt.eventType,
                    location: [evt.eventCity, evt.eventState, evt.eventZIPCode].filter(Boolean).join(', ')
                });
            }
        }

        return {
            status: normalizeStatus(trackingInfo.statusCategory || trackingInfo.status),
            statusDetail: trackingInfo.statusSummary || trackingInfo.statusDescription || '',
            estimatedDelivery: trackingInfo.expectedDeliveryDate || null,
            deliveredAt: trackingInfo.actualDeliveryDate || null,
            trackingData: events
        };
    } catch (err) {
        console.error('[Tracking] USPS fetch error:', err.message);
        return null;
    }
}

/**
 * Fetch tracking from UPS API
 */
async function fetchUPS(trackingNumber) {
    const token = await getUPSToken();
    if (!token) return null;

    try {
        const res = await fetch(`https://onlinetools.ups.com/api/track/v1/details/${encodeURIComponent(trackingNumber)}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'transId': `letwinventory-${Date.now()}`,
                'transactionSrc': 'letwinventory'
            }
        });
        if (!res.ok) return null;
        const data = await res.json();

        const shipment = data.trackResponse?.shipment?.[0];
        const pkg = shipment?.package?.[0];
        if (!pkg) return null;

        const events = [];
        if (pkg.activity) {
            for (const act of pkg.activity) {
                const loc = act.location?.address;
                events.push({
                    timestamp: act.date && act.time ? `${act.date.slice(0,4)}-${act.date.slice(4,6)}-${act.date.slice(6,8)}T${act.time.slice(0,2)}:${act.time.slice(2,4)}:${act.time.slice(4,6)}` : act.date,
                    status: normalizeStatus(act.status?.type),
                    description: act.status?.description || '',
                    location: loc ? [loc.city, loc.stateProvince, loc.countryCode].filter(Boolean).join(', ') : ''
                });
            }
        }

        const currentStatus = pkg.currentStatus?.type || pkg.activity?.[0]?.status?.type;
        const deliveryDate = pkg.deliveryDate?.[0]?.date;
        const estimatedDelivery = pkg.deliveryTime?.type === 'EDL' ? pkg.deliveryTime?.startTime : deliveryDate;

        return {
            status: normalizeStatus(currentStatus),
            statusDetail: pkg.currentStatus?.description || pkg.activity?.[0]?.status?.description || '',
            estimatedDelivery: estimatedDelivery || null,
            deliveredAt: currentStatus?.toLowerCase().includes('deliver') ? (deliveryDate || new Date().toISOString()) : null,
            trackingData: events
        };
    } catch (err) {
        console.error('[Tracking] UPS fetch error:', err.message);
        return null;
    }
}

/**
 * Fetch tracking from FedEx API
 */
async function fetchFedEx(trackingNumber) {
    const token = await getFedExToken();
    if (!token) return null;

    try {
        const res = await fetch('https://apis.fedex.com/track/v1/trackingnumbers', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                includeDetailedScans: true,
                trackingInfo: [{
                    trackingNumberInfo: { trackingNumber }
                }]
            })
        });
        if (!res.ok) return null;
        const data = await res.json();

        const result = data.output?.completeTrackResults?.[0]?.trackResults?.[0];
        if (!result) return null;

        const events = [];
        if (result.scanEvents) {
            for (const evt of result.scanEvents) {
                const loc = evt.scanLocation;
                events.push({
                    timestamp: evt.date,
                    status: normalizeStatus(evt.derivedStatus || evt.eventType),
                    description: evt.eventDescription || evt.derivedStatus || '',
                    location: loc ? [loc.city, loc.stateOrProvinceCode, loc.countryCode].filter(Boolean).join(', ') : ''
                });
            }
        }

        const latestStatus = result.latestStatusDetail;
        const deliveryDate = result.dateAndTimes?.find(d => d.type === 'ACTUAL_DELIVERY')?.dateTime;
        const estimatedDelivery = result.dateAndTimes?.find(d => d.type === 'ESTIMATED_DELIVERY')?.dateTime;

        return {
            status: normalizeStatus(latestStatus?.statusByLocale || latestStatus?.derivedCode),
            statusDetail: latestStatus?.description || '',
            estimatedDelivery: estimatedDelivery || null,
            deliveredAt: deliveryDate || null,
            trackingData: events
        };
    } catch (err) {
        console.error('[Tracking] FedEx fetch error:', err.message);
        return null;
    }
}

/**
 * Fetch tracking from DHL Unified Tracking API
 */
async function fetchDHL(trackingNumber) {
    const apiKey = process.env.DHL_API_KEY;
    if (!apiKey) return null;

    try {
        const res = await fetch(`https://api-eu.dhl.com/track/shipments?trackingNumber=${encodeURIComponent(trackingNumber)}`, {
            headers: { 'DHL-API-Key': apiKey }
        });
        if (!res.ok) return null;
        const data = await res.json();

        const shipment = data.shipments?.[0];
        if (!shipment) return null;

        const events = [];
        if (shipment.events) {
            for (const evt of shipment.events) {
                events.push({
                    timestamp: evt.timestamp,
                    status: normalizeStatus(evt.statusCode || evt.status),
                    description: evt.description || evt.status || '',
                    location: evt.location?.address?.addressLocality || ''
                });
            }
        }

        return {
            status: normalizeStatus(shipment.status?.statusCode || shipment.status?.status),
            statusDetail: shipment.status?.description || '',
            estimatedDelivery: shipment.estimatedTimeOfDelivery || null,
            deliveredAt: shipment.status?.statusCode === 'delivered' ? (shipment.events?.[0]?.timestamp || null) : null,
            trackingData: events
        };
    } catch (err) {
        console.error('[Tracking] DHL fetch error:', err.message);
        return null;
    }
}

/**
 * Fetch tracking status for a given tracking number and carrier
 */
async function fetchTrackingStatus(trackingNumber, carrier) {
    switch (carrier) {
        case 'usps': return fetchUSPS(trackingNumber);
        case 'ups': return fetchUPS(trackingNumber);
        case 'fedex': return fetchFedEx(trackingNumber);
        case 'dhl': return fetchDHL(trackingNumber);
        default: return null;
    }
}

/**
 * Poll all active, non-delivered trackings and update their status
 */
async function pollTrackings() {
    const { ShipmentTracking } = require('../models');

    try {
        const trackings = await ShipmentTracking.findAll({
            where: {
                activeFlag: true,
                status: { [Op.or]: [{ [Op.is]: null }, { [Op.notIn]: ['Delivered'] }] }
            }
        });

        console.log(`[Tracking] Polling ${trackings.length} active trackings`);

        for (const tracking of trackings) {
            if (tracking.carrier === 'unknown') continue;

            try {
                const result = await fetchTrackingStatus(tracking.trackingNumber, tracking.carrier);
                if (result) {
                    await tracking.update({
                        status: result.status,
                        statusDetail: result.statusDetail,
                        estimatedDelivery: result.estimatedDelivery,
                        deliveredAt: result.deliveredAt,
                        lastCheckedAt: new Date(),
                        trackingData: result.trackingData
                    });
                    console.log(`[Tracking] Updated ${tracking.trackingNumber}: ${result.status}`);
                } else {
                    await tracking.update({ lastCheckedAt: new Date() });
                }
            } catch (err) {
                console.error(`[Tracking] Error polling ${tracking.trackingNumber}:`, err.message);
            }
        }
    } catch (err) {
        console.error('[Tracking] Error querying trackings:', err.message);
    }
}

/**
 * Fetch status for a single tracking and update it
 */
async function refreshTracking(tracking) {
    if (tracking.carrier === 'unknown') return tracking;

    const result = await fetchTrackingStatus(tracking.trackingNumber, tracking.carrier);
    if (result) {
        await tracking.update({
            status: result.status,
            statusDetail: result.statusDetail,
            estimatedDelivery: result.estimatedDelivery,
            deliveredAt: result.deliveredAt,
            lastCheckedAt: new Date(),
            trackingData: result.trackingData
        });
    } else {
        await tracking.update({ lastCheckedAt: new Date() });
    }
    return tracking;
}

function initialize() {
    console.log('[Tracking] Initializing tracking service (polls every 2 hours)');
    pollTrackings();
    setInterval(pollTrackings, TWO_HOURS_MS);
}

module.exports = { initialize, pollTrackings, detectCarrier, fetchTrackingStatus, refreshTracking };
