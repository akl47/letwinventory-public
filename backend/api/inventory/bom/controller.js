const db = require('../../../models');
const createError = require('http-errors');
const humanizeError = require('../../../util/humanizeError');

const KIT_ASSEMBLY_NAMES = ['Kit', 'Assembly'];

/**
 * Check if a part is a Kit or Assembly by its category
 */
async function isKitOrAssembly(partID) {
  const part = await db.Part.findByPk(partID, {
    include: [{ model: db.PartCategory, attributes: ['name'] }]
  });
  if (!part) return false;
  return KIT_ASSEMBLY_NAMES.includes(part.PartCategory?.name);
}

/**
 * Detect cycles in BOM graph using DFS.
 * Returns the cycle path string if a cycle is found, null otherwise.
 */
async function detectCycle(partID, proposedComponents) {
  // Build adjacency: for each kit/assembly, get its BOM component part IDs
  async function getChildren(pid) {
    // If pid is the part being edited, use proposed components
    if (pid === partID) {
      return proposedComponents.map(c => c.partID);
    }
    const items = await db.BillOfMaterialItem.findAll({
      where: { partID: pid, activeFlag: true },
      attributes: ['componentPartID']
    });
    return items.map(i => i.componentPartID);
  }

  // DFS cycle detection
  const visited = new Set();
  const path = [];

  async function dfs(node) {
    if (path.includes(node)) {
      // Build cycle description
      const cycleStart = path.indexOf(node);
      const cyclePath = path.slice(cycleStart).concat(node);
      const parts = await db.Part.findAll({
        where: { id: cyclePath },
        attributes: ['id', 'name']
      });
      const nameMap = {};
      parts.forEach(p => { nameMap[p.id] = p.name; });
      return cyclePath.map(id => nameMap[id] || `Part ${id}`).join(' → ');
    }
    if (visited.has(node)) return null;

    visited.add(node);
    path.push(node);

    const children = await getChildren(node);
    for (const child of children) {
      const cycle = await dfs(child);
      if (cycle) return cycle;
    }

    path.pop();
    return null;
  }

  return dfs(partID);
}

/**
 * GET /api/inventory/bom/:partId
 */
exports.getBom = async (req, res, next) => {
  try {
    const partID = parseInt(req.params.partId);

    const part = await db.Part.findByPk(partID);
    if (!part) {
      return next(createError(404, 'Part not found'));
    }

    const bomItems = await db.BillOfMaterialItem.findAll({
      where: { partID, activeFlag: true },
      include: [{
        model: db.Part,
        as: 'componentPart',
        attributes: ['id', 'name', 'description', 'sku', 'vendor', 'defaultUnitOfMeasureID', 'revision', 'imageFileID'],
        include: [
          { model: db.PartCategory, attributes: ['id', 'name', 'tagColorHex'] },
          { model: db.UploadedFile, as: 'imageFile', attributes: ['id'] }
        ]
      }],
      order: [['id', 'ASC']]
    });

    res.json({ bomItems });
  } catch (error) {
    next(humanizeError(error, 'Error getting BOM'));
  }
};

/**
 * PUT /api/inventory/bom/:partId
 */
exports.updateBom = async (req, res, next) => {
  try {
    const partID = parseInt(req.params.partId);
    const { bomItems } = req.body;

    if (!Array.isArray(bomItems)) {
      return next(createError(400, 'bomItems must be an array'));
    }

    // Verify part is a Kit or Assembly
    const isValid = await isKitOrAssembly(partID);
    if (!isValid) {
      return next(createError(400, 'Part is not a Kit or Assembly'));
    }

    // Validate no self-references
    for (const item of bomItems) {
      if (item.partID === partID) {
        return next(createError(400, 'A part cannot reference itself in its BOM'));
      }
    }

    // Validate quantities against component part UoMs
    for (const item of bomItems) {
      const componentPart = await db.Part.findByPk(item.partID, {
        attributes: ['id', 'name', 'defaultUnitOfMeasureID']
      });
      if (componentPart && componentPart.defaultUnitOfMeasureID) {
        const uom = await db.UnitOfMeasure.findByPk(componentPart.defaultUnitOfMeasureID);
        if (uom && !uom.allowDecimal && !Number.isInteger(item.quantity)) {
          return next(createError(400, `Quantity must be a whole number for "${componentPart.name}" (unit: ${uom.name})`));
        }
      }
    }

    // Check for cycles
    const cycle = await detectCycle(partID, bomItems.map(i => ({ partID: i.partID })));
    if (cycle) {
      return next(createError(400, `Circular BOM reference detected: ${cycle}`));
    }

    // Deactivate existing BOM items
    await db.BillOfMaterialItem.update(
      { activeFlag: false },
      { where: { partID, activeFlag: true } }
    );

    // Create new BOM items
    if (bomItems.length > 0) {
      await db.BillOfMaterialItem.bulkCreate(
        bomItems.map(item => ({
          partID,
          componentPartID: item.partID,
          quantity: item.quantity,
          activeFlag: true,
        }))
      );
    }

    // Return updated BOM
    const updatedBom = await db.BillOfMaterialItem.findAll({
      where: { partID, activeFlag: true },
      include: [{
        model: db.Part,
        as: 'componentPart',
        attributes: ['id', 'name', 'description', 'sku', 'vendor', 'defaultUnitOfMeasureID'],
        include: [{
          model: db.PartCategory,
          attributes: ['id', 'name', 'tagColorHex']
        }]
      }],
      order: [['id', 'ASC']]
    });

    res.json({ bomItems: updatedBom });
  } catch (error) {
    next(humanizeError(error, 'Error updating BOM'));
  }
};
