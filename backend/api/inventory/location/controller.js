const db = require('../../../models');

exports.getLocationHigherarchy = async (req, res, next) => {
  /**
   * Get all Locations
   * Get all Boxes
   * Get all parts
   * starting at barcode 0, find children
   */
  // TODO refactor this to be better and promise based
  let barcodes = await db.sequelize.query(
    `select b.*, bc."prefix", l.name, l.description from "Barcodes" as b
      join "Locations" as l
      on l."barcodeID" = b.id
      
      join "BarcodeCategories" as bc
	    on b."barcodeCategoryID" = bc.id

    where b."activeFlag"=true
    
    union all
        
    select b.*, bc."prefix", l.name, l.description from "Barcodes" as b
      join "Boxes" as l
      on l."barcodeID" = b.id

      join "BarcodeCategories" as bc
	    on b."barcodeCategoryID" = bc.id

    where b."activeFlag"=true
      
    union all
      
    select b.*, bc."prefix", p.name, p.description from "Barcodes" as b
      join "Traces" as t
      on t."barcodeID" = b.id
    
      join "Parts" as p
      on t."partID" = p.id

      join "BarcodeCategories" as bc
	    on b."barcodeCategoryID" = bc.id
    
    where b."activeFlag" = true
    	
    order by "name"
    `
  )
  barcodes = barcodes[0]



  let location_tree = {}
  for(let i=0;i<barcodes.length;i++) {
    if(barcodes[i].parentBarcodeID==0) {
      // Found Top Element
      location_tree = findChildrenBarcodes(barcodes,barcodes[i])
    }
  }
  res.json(location_tree)
}

function findChildrenBarcodes(list, item) {
  item.children = []
  list.forEach(e=>{
    if(e.parentBarcodeID==item.id) {
      findChildrenBarcodes(list,e)
      item.children.push(e)
    }
  })
  return item;
}


exports.createNewLocation = (req, res, next) => {
  db.BarcodeCategory.findOne({
    where:{
      activeFlag:true,
      prefix:"LOC"
    }
  }).then(barcodeCategory=>{
    db.Barcode.create({
      barcodeCategoryID:barcodeCategory.dataValues.id,
      parentBarcodeID: req.body.parentBarcodeID,
    }).then(barcode=>{
      db.Location.create({
        name:req.body.name,
        description: req.body.description,
        barcodeID: barcode.dataValues.id,
        
      }).then(location=>{
        res.json(location)
      }).catch(error=>{
        next(new RestError('Error Creating Location:'+error, 500))
      });
    }).catch(error=>{
      next(new RestError('Error Creating Barcode:'+error, 500))
    })
  }).catch(error=>{
    next(new RestError('Error Getting Barcode Category:'+error, 500))
  })
}

exports.getLocationByID = (req,res,next) => {
  db.Location.findOne({
    where: {
      id: req.params.id,
      activeFlag:true
    }
  }).then(location=>{
    res.json(location)
  }).catch(error=>{
    next(new RestError('Error Getting Location:'+error, 500))
  })
}

exports.updateLocationByID = (req,res,next) => {
  db.Location.update(req.body,{
    where: {id:req.params.id},
    returning: true
  }).then(updated=>{
    res.json(updated[1])
  }).catch(error=>{
    next(new RestError('Error Updating Location:'+error, 500))
  })
}

