const db = require('../../../models');
const createError = require('http-errors');
const humanizeError = require('../../../util/humanizeError');

exports.getAllPrinters = (req, res, next) => {
  db.Printer.findAll({
    where: { activeFlag: true },
    attributes: ['id', 'name', 'ipAddress', 'description', 'isDefault'],
    order: [['isDefault', 'DESC'], ['id', 'ASC']]
  }).then(printers => {
    res.json(printers);
  }).catch(error => {
    next(humanizeError(error, 'Error Getting Printers'));
  });
};
