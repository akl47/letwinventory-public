const db = require('../../../models');


exports.createNewBox = (req, res, next) => {
  db.BarcodeCategory.findOne({
    where:{
      activeFlag:true,
      prefix:"BOX"
    }
  }).then(barcodeCategory=>{
    db.Barcode.create({
      barcodeCategoryID:barcodeCategory.dataValues.id,
      parentBarcodeID: req.body.parentBarcodeID,
    }).then(barcode=>{
      db.Box.create({
        name:req.body.name,
        description: req.body.description,
        barcodeID: barcode.dataValues.id,
        
      }).then(box=>{
        res.json(box)
      }).catch(error=>{
        next(new RestError('Error Creating Box:'+error, 500))
      });
    }).catch(error=>{
      next(new RestError('Error Creating Barcode:'+error, 500))
    });
  }).catch(error=>{
    next(new RestError('Error Getting Barcode Category:'+error, 500))
  });
}

exports.getBoxByID = (req,res,next) => {
  db.Box.findOne({
    where: {
      id: req.params.id,
      activeFlag:true
    }
  }).then(box=>{
    res.json(box)
  }).catch(error=>{
    next(new RestError('Error Getting Box:'+error, 500))
  });
}

exports.updateBox = (req,res,next) => {
  db.Box.update(req.body,{
    where: {id:req.params.id},
    returning: true
  }).then(updated=>{
    res.json(updated[1])
  }).catch(error=>{
    next(new RestError('Error Updating Box:'+error, 500))
  });
}