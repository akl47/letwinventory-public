import { describe, it, expect } from 'vitest';
import { sameSavedContent } from './savedContent';

// REQ 991 — lost-response recovery decides "did my save land?" by content.
describe('sameSavedContent', () => {
  const sent = { featureTree: [{ id: 'f1', type: 'origin' }], sketchDoc: { sketches: [{ id: 's1', a: 1, b: [2, 3] }] }, equations: [] };

  it('ignores object key order (Postgres JSONB reorders keys)', () => {
    const server = { equations: [], sketchDoc: { sketches: [{ b: [2, 3], a: 1, id: 's1' }] }, featureTree: [{ type: 'origin', id: 'f1' }] };
    expect(sameSavedContent(server, sent)).toBe(true);
  });

  it('detects a changed value or array order', () => {
    expect(sameSavedContent({ ...sent, sketchDoc: { sketches: [{ id: 's1', a: 2, b: [2, 3] }] } }, sent)).toBe(false);
    expect(sameSavedContent({ ...sent, sketchDoc: { sketches: [{ id: 's1', a: 1, b: [3, 2] }] } }, sent)).toBe(false);
  });

  it('treats undefined object fields as absent (JSON drops them)', () => {
    const withUndef = { ...sent, sketchDoc: { sketches: [{ id: 's1', a: 1, b: [2, 3], c: undefined }] } };
    expect(sameSavedContent(sent, withUndef)).toBe(true);
  });
});
