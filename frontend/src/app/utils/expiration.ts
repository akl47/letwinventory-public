export type ExpirationMode = 'never' | '7d' | '30d' | '60d' | '90d' | 'date';

const DAYS: Record<Exclude<ExpirationMode, 'never' | 'date'>, number> = {
    '7d': 7,
    '30d': 30,
    '60d': 60,
    '90d': 90,
};

/**
 * Resolve an expiration-picker mode plus an optional custom date to the
 * concrete Date (or null for "never"). The quick-day options compute relative
 * to "now" so the timestamp is fresh whenever the helper is called.
 */
export function computeExpiresAt(mode: ExpirationMode, customDate: Date | null): Date | null {
    if (mode === 'never') return null;
    if (mode === 'date') return customDate;
    const d = new Date();
    d.setDate(d.getDate() + DAYS[mode]);
    return d;
}
