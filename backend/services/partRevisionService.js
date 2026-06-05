'use strict';

// Part revision logic, extracted from the Part controller so the CAD release
// workflow can create dev (numeric) and production (letter) revisions inside its
// own transaction. The Part controller's createNewRevision/releaseToProduction
// handlers delegate here so there is one source of truth for revision numbering.

const db = require('../models');

// Production revision letters: A-Y excluding I, O, Q, S, X, Z.
// Sequence: A B C D E F G H J K L M N P R T U V W Y, then AA AB … AY, BA …
const REV_LETTERS = 'ABCDEFGHJKLMNPRTUVWY'.split('');

function letterRevToIndex(rev) {
  const chars = rev.toUpperCase().split('');
  let index = 0;
  for (const ch of chars) {
    const pos = REV_LETTERS.indexOf(ch);
    if (pos === -1) return -1;
    index = index * REV_LETTERS.length + pos;
  }
  for (let len = 1; len < chars.length; len++) index += Math.pow(REV_LETTERS.length, len);
  return index;
}

function indexToLetterRev(index) {
  let len = 1;
  let capacity = REV_LETTERS.length;
  while (index >= capacity) { index -= capacity; len++; capacity = Math.pow(REV_LETTERS.length, len); }
  let result = '';
  for (let i = len - 1; i >= 0; i--) {
    const divisor = Math.pow(REV_LETTERS.length, i);
    result += REV_LETTERS[Math.floor(index / divisor)];
    index %= divisor;
  }
  return result;
}

function getNextLetterRevision(current) {
  if (!current) return REV_LETTERS[0];
  const idx = letterRevToIndex(current);
  if (idx === -1) return REV_LETTERS[0];
  return indexToLetterRev(idx + 1);
}

async function nextNumericRevision(name, { transaction } = {}) {
  const rows = await db.Part.findAll({ where: { name }, attributes: ['revision'], transaction });
  const existing = new Set(rows.map((p) => p.revision));
  const numeric = [...existing].filter((r) => /^\d+$/.test(r));
  let n = numeric.length ? Math.max(...numeric.map((r) => parseInt(r, 10))) + 1 : 1;
  let rev = String(n).padStart(2, '0');
  while (existing.has(rev)) { n++; rev = String(n).padStart(2, '0'); }
  return rev;
}

async function nextLetterRevision(name, { transaction } = {}) {
  const rows = await db.Part.findAll({ where: { name }, attributes: ['revision'], transaction });
  const existing = new Set(rows.map((p) => p.revision));
  const letters = [...existing].filter((r) => /^[A-Z]+$/.test(r));
  let rev = REV_LETTERS[0];
  if (letters.length) {
    const sorted = letters.sort((a, b) => letterRevToIndex(a) - letterRevToIndex(b));
    rev = getNextLetterRevision(sorted[sorted.length - 1]);
  }
  while (existing.has(rev)) rev = getNextLetterRevision(rev);
  return rev;
}

// The carried-over Part fields when cloning a part into a new revision.
function partFieldsFrom(pd) {
  return {
    name: pd.name, description: pd.description, internalPart: pd.internalPart, vendor: pd.vendor,
    sku: pd.sku, link: pd.link, minimumOrderQuantity: pd.minimumOrderQuantity,
    partCategoryID: pd.partCategoryID, serialNumberRequired: pd.serialNumberRequired,
    lotNumberRequired: pd.lotNumberRequired, defaultUnitOfMeasureID: pd.defaultUnitOfMeasureID,
    manufacturer: pd.manufacturer, manufacturerPN: pd.manufacturerPN,
    minimumStockQuantity: pd.minimumStockQuantity, imageFileID: pd.imageFileID,
  };
}

async function copyBom(sourcePartID, newPartID, { transaction } = {}) {
  const bom = await db.BillOfMaterialItem.findAll({ where: { partID: sourcePartID, activeFlag: true }, transaction });
  if (bom.length) {
    await db.BillOfMaterialItem.bulkCreate(
      bom.map((i) => ({ partID: newPartID, componentPartID: i.componentPartID, quantity: i.quantity, activeFlag: true })),
      { transaction },
    );
  }
}

/** Create the next NUMERIC (development) revision of a part: a new Parts row
 * (previousRevisionID = part.id, copies BOM) + a `new_revision` history entry. */
async function createNewRevision(part, userId, { transaction } = {}) {
  const rev = await nextNumericRevision(part.name, { transaction });
  const newPart = await db.Part.create(
    { ...partFieldsFrom(part.toJSON()), activeFlag: true, revision: rev, revisionLocked: false, previousRevisionID: part.id },
    { transaction },
  );
  await copyBom(part.id, newPart.id, { transaction });
  await db.PartRevisionHistory.create({
    partID: newPart.id, changedByUserID: userId || null, changeType: 'new_revision',
    changes: { previousRevision: { old: null, new: part.revision }, previousPartID: { old: null, new: part.id } },
    createdAt: new Date(),
  }, { transaction });
  return newPart;
}

/** Create the next LETTER (production) revision of a part: a new Parts row, copies
 * BOM, LOCKS the source, + `production_release` and `locked` history entries. */
async function releaseToProduction(part, userId, { transaction } = {}) {
  const rev = await nextLetterRevision(part.name, { transaction });
  const newPart = await db.Part.create(
    { ...partFieldsFrom(part.toJSON()), activeFlag: true, revision: rev, revisionLocked: false, previousRevisionID: part.id },
    { transaction },
  );
  await copyBom(part.id, newPart.id, { transaction });
  await part.update({ revisionLocked: true }, { transaction });
  await db.PartRevisionHistory.create({
    partID: newPart.id, changedByUserID: userId || null, changeType: 'production_release',
    changes: { previousRevision: { old: null, new: part.revision }, previousPartID: { old: null, new: part.id } },
    createdAt: new Date(),
  }, { transaction });
  await db.PartRevisionHistory.create({
    partID: part.id, changedByUserID: userId || null, changeType: 'locked', changes: null, createdAt: new Date(),
  }, { transaction });
  return newPart;
}

module.exports = {
  REV_LETTERS, letterRevToIndex, indexToLetterRev, getNextLetterRevision,
  nextNumericRevision, nextLetterRevision, createNewRevision, releaseToProduction,
};
