const db = require('../../../models');
const createError = require('http-errors')

exports.getAllParts = (req, res, next) => {
  db.Part.findAll({
    where: {
      activeFlag: true
    }, 
    order:[
      ['name','asc']
    ],
    include: {
      model: db.Trace,
      where:{
        activeFlag:true
      },
      required: false
    }
  }).then(parts => {
    res.json(parts)
  }).catch(error=>{
    next(new RestError('Error Getting Parts:'+error, 500))
  })
}


exports.createNewPart= (req, res, next) => {
  db.Part.create(req.body).then(part => {
    res.json(part)
  }).catch(error=>{
    next(new RestError('Error Creating New Part:'+error, 500))
  })
}

exports.updatePartByID = (req, res, next) => {
  db.Part.update(req.body, {
    where: {
      id: req.params.id
    },
    returning: true
  }).then(updated => {
    res.json(updated[1])
  }).catch(error=>{
    next(new RestError('Error Updating Part:'+error, 500))
  })
}

exports.deletePartByID = (req, res, next) => {
  db.Part.findOne({
    where:{
      id:req.params.id,
      activeFlag:true
    }
  }).then(part=>{
    part = part.toJSON();
    part.activeFlag = false;
    db.Part.update(part,{
      where:{
        id:req.params.id,
        activeFlag:true
      }
    }).then(deletedPart=>{
      res.json(deletedPart)
    }).catch(error=>{
      next(new RestError('Error Updating Part:'+error, 500))
    })
  }).catch(error=>{
    next(new RestError('Error Getting Part:'+error, 500))
  })
}

// exports.testError = (req, res, next) => {
//   next(new RestError('TEST ERROR PLEASE IGNORE', 500))
// }