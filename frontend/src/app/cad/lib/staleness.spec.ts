import { describe, it, expect } from 'vitest';
import { STALE_DIRTY_THRESHOLD_MS, staleDirtyAgeMs, formatStaleAge } from './staleness';

// REQ 877 — stale uncommitted-changes warning: a working copy that is dirty
// and hasn't seen a content save for 4 hours warns the lock holder.

const NOW = Date.parse('2026-07-03T12:00:00Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const HOUR = 60 * 60 * 1000;

describe('staleDirtyAgeMs', () => {
  it('is null when the working copy is clean', () => {
    expect(staleDirtyAgeMs({ dirty: false, lastContentSavedAt: iso(9 * HOUR) }, NOW)).toBeNull();
    expect(staleDirtyAgeMs({ lastContentSavedAt: iso(9 * HOUR) }, NOW)).toBeNull();
  });

  it('is null when there is no content-save timestamp (legacy rows)', () => {
    expect(staleDirtyAgeMs({ dirty: true }, NOW)).toBeNull();
    expect(staleDirtyAgeMs({ dirty: true, lastContentSavedAt: null }, NOW)).toBeNull();
  });

  it('is null while under the 4-hour threshold', () => {
    expect(staleDirtyAgeMs({ dirty: true, lastContentSavedAt: iso(1 * HOUR) }, NOW)).toBeNull();
    expect(staleDirtyAgeMs({ dirty: true, lastContentSavedAt: iso(STALE_DIRTY_THRESHOLD_MS - 1) }, NOW)).toBeNull();
  });

  it('returns the age once past the threshold', () => {
    expect(staleDirtyAgeMs({ dirty: true, lastContentSavedAt: iso(5 * HOUR) }, NOW)).toBe(5 * HOUR);
    expect(staleDirtyAgeMs({ dirty: true, lastContentSavedAt: iso(STALE_DIRTY_THRESHOLD_MS) }, NOW)).toBe(STALE_DIRTY_THRESHOLD_MS);
  });

  it('is null for an unparseable timestamp', () => {
    expect(staleDirtyAgeMs({ dirty: true, lastContentSavedAt: 'not-a-date' }, NOW)).toBeNull();
  });
});

describe('formatStaleAge', () => {
  it('renders hours under a day', () => {
    expect(formatStaleAge(4 * HOUR)).toBe('4 h');
    expect(formatStaleAge(6.7 * HOUR)).toBe('6 h');
    expect(formatStaleAge(23 * HOUR)).toBe('23 h');
  });

  it('renders days from 24 h up', () => {
    expect(formatStaleAge(24 * HOUR)).toBe('1 d');
    expect(formatStaleAge(3 * 24 * HOUR + 5 * HOUR)).toBe('3 d');
  });
});
