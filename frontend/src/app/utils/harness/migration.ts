// Data migration for harness schema versions
// v1 (absent schemaVersion): position is an abstract origin point near body top-left
// v2: position represents pin 0's body edge (where the pin meets the body)

import { HarnessData } from '../../models/harness.model';
import {
  ROW_HEIGHT,
  ELEMENT_DEFAULT_WIDTH
} from './constants';

const CURRENT_SCHEMA_VERSION = 2;

/**
 * Migrate harness data to current schema version.
 * Returns the data unchanged if already current.
 */
export function migrateHarnessData(data: HarnessData): HarnessData {
  if (data.schemaVersion === CURRENT_SCHEMA_VERSION) return data;

  // v1 → v2: redefine position from abstract origin to pin 0 body edge
  const migrated = { ...data };

  // Migrate connectors: old origin was (x, y - ROW_HEIGHT/2)
  // New origin is body left edge at pin 0's row = old origin + (0, ROW_HEIGHT/2)
  migrated.connectors = data.connectors.map(c => {
    if (!c.position) return c;
    const rotation = c.rotation || 0;
    const flipped = c.flipped || false;

    // Pin 0 body edge in old local coords = (0, ROW_HEIGHT/2)
    let localX = 0;
    let localY = ROW_HEIGHT / 2;

    if (flipped) {
      const width = ELEMENT_DEFAULT_WIDTH;
      localX = 2 * (width / 2) - localX;
    }

    const rad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rotatedX = localX * cos - localY * sin;
    const rotatedY = localX * sin + localY * cos;

    const oldOriginX = c.position.x;
    const oldOriginY = c.position.y - ROW_HEIGHT / 2;

    return {
      ...c,
      position: {
        x: oldOriginX + rotatedX,
        y: oldOriginY + rotatedY
      }
    };
  });

  // Migrate cables: old origin was (x, y), body left edge was at local (0, 0)
  // New origin = body left edge = same as old origin. No position change needed.
  // (cables don't need migration)

  // Migrate components: old origin was (x, y - ROW_HEIGHT/2)
  // New origin is body right edge at pin 0's row = old origin + (width, ROW_HEIGHT/2)
  migrated.components = (data.components || []).map(c => {
    if (!c.position) return c;
    const rotation = c.rotation || 0;
    const flipped = c.flipped || false;
    const width = ELEMENT_DEFAULT_WIDTH;

    // Pin 0 body edge in old local coords = (width, ROW_HEIGHT/2)
    let localX = width;
    let localY = ROW_HEIGHT / 2;

    if (flipped) {
      localX = 2 * (width / 2) - localX;
    }

    const rad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rotatedX = localX * cos - localY * sin;
    const rotatedY = localX * sin + localY * cos;

    const oldOriginX = c.position.x;
    const oldOriginY = c.position.y - ROW_HEIGHT / 2;

    return {
      ...c,
      position: {
        x: oldOriginX + rotatedX,
        y: oldOriginY + rotatedY
      }
    };
  });

  migrated.schemaVersion = CURRENT_SCHEMA_VERSION;
  return migrated;
}
