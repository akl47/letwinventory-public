const db = require('../../../models');
const createError = require('http-errors');
const humanizeError = require('../../../util/humanizeError');

exports.getAllUnitsOfMeasure = (req, res, next) => {
  db.UnitOfMeasure.findAll({
    attributes: ['id', 'name', 'description', 'allowDecimal'],
    order: [['id', 'ASC']]
  }).then(unitsOfMeasure => {
    res.json(unitsOfMeasure);
  }).catch(error => {
    next(humanizeError(error, 'Error Getting Units of Measure'));
  });
};
