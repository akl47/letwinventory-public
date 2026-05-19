import { describe, it, expect } from 'vitest';
import { friendlyError } from './errorMessages';

describe('friendlyError', () => {
  it('translates open-chain errors', () => {
    expect(friendlyError('open chain detected at point p42-abc-xyz')).toMatch(/loose endpoint/i);
    expect(friendlyError('open chain at point p1')).toMatch(/loose endpoint/i);
  });
  it('translates branching-point errors', () => {
    expect(friendlyError('point p123 touches 3 edges (must be exactly 2)')).toMatch(/shared by more than two/i);
  });
  it('translates kernel-down errors', () => {
    expect(friendlyError('CAD kernel unavailable: socket closed')).toMatch(/kernel is not running/i);
    expect(friendlyError('connect ECONNREFUSED 127.0.0.1:9876')).toMatch(/kernel is not running/i);
  });
  it('preserves unknown messages verbatim', () => {
    expect(friendlyError('something nobody planned for')).toBe('something nobody planned for');
  });
  it('handles empty input', () => {
    expect(friendlyError(null)).toMatch(/wrong/i);
    expect(friendlyError(undefined)).toMatch(/wrong/i);
    expect(friendlyError('')).toMatch(/wrong/i);
  });
});
