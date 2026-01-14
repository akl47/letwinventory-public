const db = require('../../../models');
const createError = require('http-errors');

exports.getAllUnitsOfMeasure = (req, res, next) => {
  db.UnitOfMeasure.findAll({
    attributes: ['id', 'name', 'description'],
    order: [['id', 'ASC']]
  }).then(unitsOfMeasure => {
    res.json(unitsOfMeasure);
  }).catch(error => {
    next(createError(500, 'Error Getting Units of Measure: ' + error));
  });
};
