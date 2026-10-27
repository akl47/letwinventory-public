import { describe, it, expect } from 'vitest';
import { buildWsUrl } from './cad-stream.service';

describe('buildWsUrl', () => {
  it('converts an absolute https apiUrl to wss with the /ws/cad path', () => {
    expect(buildWsUrl('https://dev.letwin.co/api')).toBe('wss://dev.letwin.co/ws/cad');
  });

  it('converts an absolute http apiUrl to ws with the /ws/cad path', () => {
    expect(buildWsUrl('http://localhost:3000/api')).toBe('ws://localhost:3000/ws/cad');
  });

  it('tolerates a missing /api suffix', () => {
    expect(buildWsUrl('https://dev.letwin.co')).toBe('wss://dev.letwin.co/ws/cad');
  });

  it('handles a relative apiUrl by deriving from window.location', () => {
    // jsdom defaults location to http://localhost; verify the protocol pivot.
    const url = buildWsUrl('/api');
    expect(url).toMatch(/^ws:\/\/.+\/ws\/cad$/);
  });
});
