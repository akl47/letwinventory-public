#!/usr/bin/env node
/**
 * Walk every active DesignRequirement and ensure a TtsAudio row exists for
 * each populated field whose audio is already on disk. Doesn't generate
 * anything new — just records existing files in the reverse-lookup table.
 *
 * Run from inside the backend container:
 *   docker compose exec letwinventory-backend node backend/scripts/backfill-tts-audio.js
 */

const db = require('../models');
const ttsCache = require('../services/ttsCache');

async function main() {
  const reqs = await db.DesignRequirement.findAll({
    where: { activeFlag: true },
    attributes: ['id', ...ttsCache.REQUIREMENT_TTS_FIELDS],
  });
  let inserted = 0;
  let skipped = 0;
  for (const r of reqs) {
    for (const field of ttsCache.REQUIREMENT_TTS_FIELDS) {
      const text = (r[field] || '').toString().trim();
      if (!text) continue;
      if (!ttsCache.isCached(text)) { skipped++; continue; }
      await ttsCache.recordOwnerLink({ ownerType: 'design_requirement', ownerID: r.id, field, text });
      inserted++;
    }
    const combined = ttsCache.buildCombinedRequirementText(r);
    if (combined && ttsCache.isCached(combined)) {
      await ttsCache.recordOwnerLink({ ownerType: 'design_requirement', ownerID: r.id, field: 'all', text: combined });
      inserted++;
    } else {
      skipped++;
    }
  }
  console.log(`Backfill complete. Inserted/refreshed ${inserted} rows. Skipped ${skipped} (no audio cached on disk).`);
  await db.sequelize.close();
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
