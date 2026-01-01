const db = require('../../../models');
const createError = require('http-errors');


exports.createNewTrace = (req, res, next) => {
  console.log("Create New Trace")
  console.log(req.body)
  db.BarcodeCategory.findOne({
    where: {
      activeFlag: true,
      prefix: "AKL"
    }
  }).then(barcodeCategory => {
    db.Barcode.create({
      barcodeCategoryID: barcodeCategory.dataValues.id,
      parentBarcodeID: req.body.parentBarcodeID,
    }).then(barcode => {
      barcode = barcode.toJSON()
      req.body.barcodeID = barcode.id
      db.Trace.create(req.body).then(trace => {
        res.json(trace)
      })
    }).catch(error => {
      next(createError(500, 'Error Creating Barcode:' + error))
    })
  }).catch(error => {
    next(createError(500, 'Error Finding Barcode Category:' + error))
  })
}

exports.getTraceByID = (req, res, next) => {
  db.Trace.findOne({
    where: {
      id: req.params.id,
      activeFlag: true
    }
  }).then(trace => {
    res.json(trace)
  }).catch(error => {
    next(createError(500, 'Error Finding Trace:' + error))
  })
}

exports.getTracesByPartID = (req, res, next) => {
  db.Trace.findAll({
    where: {
      partID: req.query.partID,
      activeFlag: true
    },
    include: { all: true },
  }).then(trace => {
    console.log("Get Trace by part id")
    console.log(trace)
    res.json(trace)
  }).catch(error => {
    next(createError(500, 'Error Finding Trace:' + error))
  })
}

exports.updateTrace = (req, res, next) => {
  db.Trace.update(req.body, {
    where: { id: req.params.id },
    returning: true
  }).then(updated => {
    res.json(updated[1])
  }).catch(error => {
    next(createError(500, 'Error Updating Trace:' + error))
  })
}