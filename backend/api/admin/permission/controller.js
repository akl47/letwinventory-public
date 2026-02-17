const db = require('../../../models');

exports.getAll = async (req, res) => {
  try {
    const permissions = await db.Permission.findAll({
      order: [['resource', 'ASC'], ['action', 'ASC']]
    });
    res.json(permissions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
