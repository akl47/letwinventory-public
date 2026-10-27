'use strict';

// Backfill missing CAD commit thumbnails: render each commit's geometry to a
// static SVG and store it. Commit thumbnails are normally captured client-side
// at check-in, so pre-thumbnail commits have none and their history previews are
// blank. Run INSIDE the backend container (it has DB + kernel access):
//   docker exec letwinventory-backend node scripts/backfill-cad-thumbnails.js [repoId]
// With no repoId, backfills every cad repo. Idempotent — skips commits that
// already have a thumbnail.

const db = require('../models');
global.db = db; // the VCS services default to global.db when no db arg is passed
const cadVcs = require('../services/vcs/cadVcsService');
const cadDiff = require('../services/vcs/cadDiffService');
const { renderGeometrySvg } = require('../services/vcs/cadThumbnailSvg');

async function modelForRepo(repoId) {
  const models = await db.DesignCADModel.findAll({ where: { activeFlag: true } });
  for (const m of models) {
    const repo = await cadVcs.repoForModel(m);
    if (repo.repoId === String(repoId)) return { model: m, repo };
  }
  return null;
}

async function backfillRepo(model, repo) {
  const commits = await db.VcsObject.findAll({
    where: { repoType: repo.repoType, repoId: String(repo.repoId), kind: 'commit' },
  });
  let made = 0, skipped = 0, empty = 0, failed = 0;
  for (const c of commits) {
    if (await cadVcs.loadThumbnail(model, c.hash)) { skipped++; continue; }
    try {
      const geo = await cadDiff.regenCommitGeometry(repo, model, c.hash, {});
      const svg = renderGeometrySvg(geo, 240, 180);
      if (!svg) { empty++; continue; }
      const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
      await cadVcs.storeThumbnail(model, c.hash, dataUrl);
      made++;
      console.log(`  ok ${c.hash.slice(0, 8)} ${(c.content && c.content.message) || ''}`);
    } catch (e) {
      failed++;
      console.log(`  FAIL ${c.hash.slice(0, 8)} — ${e.message}`);
    }
  }
  console.log(`repo ${repo.repoId}: ${made} made, ${skipped} existing, ${empty} empty-geometry, ${failed} failed`);
}

async function main() {
  const repoId = process.argv[2];
  if (repoId) {
    const found = await modelForRepo(repoId);
    if (!found) { console.error(`No active CAD model found for repo ${repoId}`); process.exit(1); }
    console.log(`Backfilling thumbnails for repo ${repoId} (via model ${found.model.id})…`);
    await backfillRepo(found.model, found.repo);
  } else {
    const models = await db.DesignCADModel.findAll({ where: { activeFlag: true } });
    const seen = new Set();
    for (const m of models) {
      const repo = await cadVcs.repoForModel(m);
      if (seen.has(repo.repoId)) continue;
      seen.add(repo.repoId);
      console.log(`Backfilling repo ${repo.repoId} (via model ${m.id})…`);
      await backfillRepo(m, repo);
    }
  }
  await db.sequelize.close();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
