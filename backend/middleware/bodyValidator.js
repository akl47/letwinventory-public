const db = require('../models');
var validator = require('validator');
ignore_all = ['id','activeFlag','createdAt','updatedAt']

exports.location = (req,res,next) => {
    const model = db.Location.tableAttributes
    let ignore = [...ignore_all]
    ignore.push('barcodeID')
    return_body = {}
    let error_message = ''
    console.log(req.body)
    Object.keys(model).forEach(attribute=>{
        if(!ignore.includes(attribute)) {
            if(!model[attribute].allowNull) {
                if(typeof req.body[attribute] =='undefined' || req.body[attribute] === null) {
                    error_message += ' ' + attribute + ' is required.'
                } else {
                    checkType(model[attribute].type.constructor.name,attribute)

                }
            } else {
                if(typeof req.body[attribute] =='undefined' || req.body[attribute] === null) {
                    return_body[attribute] = null
                } else {
                    checkType(model[attribute].type.constructor.name,attribute)
                }
            }
        }

    })

    // Add parentBarcodeID if provided (needed for creating barcodes)
    if(typeof req.body.parentBarcodeID !== 'undefined') {
        if(req.body.parentBarcodeID === null || req.body.parentBarcodeID === 0) {
            return_body.parentBarcodeID = 0;
        } else if(validator.isInt(req.body.parentBarcodeID.toString())) {
            return_body.parentBarcodeID = parseInt(req.body.parentBarcodeID);
        } else {
            error_message += ' parentBarcodeID must be a number.';
        }
    }

    if(error_message.length > 0) {
        next(new RestError(error_message,400));
        // TODO fix error handling
    }
    req.body = return_body
    next()


    function checkType(type,attribute) {
        if(type=="INTEGER") {
            try {
                if(validator.isInt(req.body[attribute].toString())) {
                    return_body[attribute] = parseInt(req.body[attribute])
                } else {
                    error_message += ' ' + attribute + ' is a '+typeof req.body[attribute]+'. should be a number.'
                }
            } catch (error) {
                error_message += ' ' + attribute + ' is a '+typeof req.body[attribute]+'. should be a number.'
            }

        } else if (type=="STRING") {
            try {
                if(validator.isLength(req.body[attribute],{min:1})) {
                    return_body[attribute] = req.body[attribute]
                } else {
                    error_message += ' ' + attribute + ' is a '+typeof req.body[attribute]+'. should be a string.'
                }
            } catch (error) {
                error_message += ' ' + attribute + ' is a '+typeof req.body[attribute]+'. should be a string.'
            }
        } else if (type=="BOOLEAN") {
            try {
                if(validator.isBoolean(req.body[attribute].toString())) {
                    return_body[attribute] = req.body[attribute]
                } else {
                    error_message += ' ' + attribute + ' is a '+typeof req.body[attribute]+'. should be a boolean.'
                }
            } catch(error) {
                error_message += ' ' + attribute + ' is a '+typeof req.body[attribute]+'. should be a boolean.'
            }
        } else {
            console.log("UNCAUGHT TYPE",type)
        }
    }
}

exports.box = (req,res,next) => {
    const model = db.Box.tableAttributes
    let ignore = [...ignore_all]
    ignore.push('barcodeID')
    return_body = {}
    let error_message = ''
    console.log(req.body)
    Object.keys(model).forEach(attribute=>{
        if(!ignore.includes(attribute)) {
            if(!model[attribute].allowNull) {
                if(typeof req.body[attribute] =='undefined' || req.body[attribute] === null) {
                    error_message += ' ' + attribute + ' is required.'
                } else {
                    checkType(model[attribute].type.constructor.name,attribute)

                }
            } else {
                if(typeof req.body[attribute] =='undefined' || req.body[attribute] === null) {
                    return_body[attribute] = null
                } else {
                    checkType(model[attribute].type.constructor.name,attribute)
                }
            }
        }

    })

    // Add parentBarcodeID if provided (needed for creating barcodes)
    if(typeof req.body.parentBarcodeID !== 'undefined') {
        if(req.body.parentBarcodeID === null || req.body.parentBarcodeID === 0) {
            return_body.parentBarcodeID = 0;
        } else if(validator.isInt(req.body.parentBarcodeID.toString())) {
            return_body.parentBarcodeID = parseInt(req.body.parentBarcodeID);
        } else {
            error_message += ' parentBarcodeID must be a number.';
        }
    }

    if(error_message.length > 0) {
        next(new RestError(error_message,400));
        // TODO fix error handling
    }
    req.body = return_body
    next()


    function checkType(type,attribute) {
        if(type=="INTEGER") {
            try {
                if(validator.isInt(req.body[attribute].toString())) {
                    return_body[attribute] = parseInt(req.body[attribute])
                } else {
                    error_message += ' ' + attribute + ' is a '+typeof req.body[attribute]+'. should be a number.'
                }
            } catch (error) {
                error_message += ' ' + attribute + ' is a '+typeof req.body[attribute]+'. should be a number.'
            }

        } else if (type=="STRING") {
            try {
                if(validator.isLength(req.body[attribute],{min:0})) {
                    return_body[attribute] = req.body[attribute]
                } else {
                    error_message += ' ' + attribute + ' is a '+typeof req.body[attribute]+'. should be a string.'
                }
            } catch (error) {
                error_message += ' ' + attribute + ' is a '+typeof req.body[attribute]+'. should be a string.'
            }
        } else if (type=="BOOLEAN") {
            try {
                if(validator.isBoolean(req.body[attribute].toString())) {
                    return_body[attribute] = req.body[attribute]
                } else {
                    error_message += ' ' + attribute + ' is a '+typeof req.body[attribute]+'. should be a boolean.'
                }
            } catch(error) {
                error_message += ' ' + attribute + ' is a '+typeof req.body[attribute]+'. should be a boolean.'
            }
        } else {
            console.log("UNCAUGHT TYPE",type)
        }
    }
}

exports.trace = (req,res,next) => {
    const model = db.Trace.tableAttributes
    let ignore = [...ignore_all]
    ignore.push('barcodeID')
    ignore.push('parentBarcodeID')
    return_body = {}
    let error_message
    console.log(req.body)
    Object.keys(model).forEach(attribute=>{
        if(!ignore.includes(attribute)) {
            if(!model[attribute].allowNull) {
                if(typeof req.body[attribute] =='undefined') {
                    error_message += ' ' + attribute + ' is required.'
                } else {
                    checkType(model[attribute].type.constructor.name,attribute)
                    
                }
            } else {
                if(typeof req.body[attribute] =='undefined') {
                    return_body[attribute] = null
                } else {
                    checkType(model[attribute].type.constructor.name,attribute)
                }
            }
        }

    })
    if(!!error_message) {
        next(new RestError(error_message,400));
        // TODO fix error handling
    }
    req.body = return_body
    next()
    

    function checkType(type,attribute) {
        if(type=="INTEGER") {
            try {
                if(validator.isInt(req.body[attribute].toString())) {
                    return_body[attribute] = parseInt(req.body[attribute])
                } else {
                    error_message += ' ' + attribute + ' is a '+typeof req.body[attribute]+'. should be a number.'
                }
            } catch (error) {
                error_message += ' ' + attribute + ' is a '+typeof req.body[attribute]+'. should be a number.'
            }
            
        } else if (type=="STRING") {
            try {
                if(validator.isLength(req.body[attribute],{min:0})) {
                    return_body[attribute] = req.body[attribute]
                } else {
                    error_message += ' ' + attribute + ' is a '+typeof req.body[attribute]+'. should be a string.'
                }
            } catch (error) {
                error_message += ' ' + attribute + ' is a '+typeof req.body[attribute]+'. should be a string.'
            }
        } else if (type=="BOOLEAN") {
            try {
                if(validator.isBoolean(req.body[attribute].toString())) {
                    return_body[attribute] = req.body[attribute]
                } else {
                    error_message += ' ' + attribute + ' is a '+typeof req.body[attribute]+'. should be a boolean.'
                }
            } catch(error) {
                error_message += ' ' + attribute + ' is a '+typeof req.body[attribute]+'. should be a boolean.'
            }
        } else {
            console.log("UNCAUGHT TYPE",type)
        }
    }
}

exports.part = (req,res,next) => {
    const model = db.Part.tableAttributes
    let ignore = [...ignore_all]
    return_body = {}
    let error_message = ''
    console.log(req.body)
    Object.keys(model).forEach(attribute=>{
        if(!ignore.includes(attribute)) {
            if(!model[attribute].allowNull) {
                if(typeof req.body[attribute] =='undefined'||req.body[attribute]==null) {
                    error_message += ' ' + attribute + ' is required.'
                } else {
                    checkType(model[attribute].type.constructor.name,attribute)
                    
                }
            } else {
                if(typeof req.body[attribute] =='undefined'||req.body[attribute]==null) {
                    return_body[attribute] = null
                } else {
                    checkType(model[attribute].type.constructor.name,attribute)
                }
            }
        }

    })
    if(!!error_message) {
        next(new RestError(error_message,400));
        // TODO fix error handling
    }
    req.body = return_body
    next()
    

    function checkType(type,attribute) {
        if(type=="INTEGER") {
            try {
                if(validator.isInt(req.body[attribute].toString())) {
                    return_body[attribute] = parseInt(req.body[attribute])
                } else {
                    error_message += ' ' + attribute + ' is a '+typeof req.body[attribute]+'. Should be a number.'
                }
            } catch (error) {
                error_message += ' ' + attribute + ' is a '+typeof req.body[attribute]+'. Should be a number.'
            }
            
        } else if (type=="STRING") {
            try {
                if(validator.isLength(req.body[attribute],{min:0})) {
                    return_body[attribute] = req.body[attribute]
                } else {
                    error_message += ' ' + attribute + ' is a '+typeof req.body[attribute]+'. Should be a string.'
                }
            } catch (error) {
                error_message += ' ' + attribute + ' is a '+typeof req.body[attribute]+'. Should be a string.'
            }
        } else if (type=="BOOLEAN") {
            try {
                if(validator.isBoolean(req.body[attribute].toString())) {
                    return_body[attribute] = req.body[attribute]
                } else {
                    error_message += ' ' + attribute + ' is a '+typeof req.body[attribute]+'. Should be a boolean.'
                }
            } catch(error) {
                error_message += ' ' + attribute + ' is a '+typeof req.body[attribute]+'. Should be a boolean.'
            }
        } else {
            console.log("UNCAUGHT TYPE",type)
        }
    }
}

exports.order = (req,res,next) => {
    const model = db.Order.tableAttributes
    let ignore = [...ignore_all]
    ignore.push('orderID', 'uuid', 'status', 'procurifyUserID', 'itemCount', 'totalPrice', 'date')
    return_body = {}
    let error_message = ''
    console.log(req.body)
    Object.keys(model).forEach(attribute=>{
        if(!ignore.includes(attribute)) {
            if(!model[attribute].allowNull) {
                if(typeof req.body[attribute] =='undefined'||req.body[attribute]==null) {
                    error_message += ' ' + attribute + ' is required.'
                } else {
                    checkType(model[attribute].type.constructor.name,attribute)
                }
            } else {
                if(typeof req.body[attribute] =='undefined'||req.body[attribute]==null) {
                    return_body[attribute] = null
                } else {
                    checkType(model[attribute].type.constructor.name,attribute)
                }
            }
        }
    })
    if(!!error_message) {
        next(new RestError(error_message,400));
    }
    req.body = return_body
    next()

    function checkType(type,attribute) {
        if(type=="INTEGER") {
            try {
                if(validator.isInt(req.body[attribute].toString())) {
                    return_body[attribute] = parseInt(req.body[attribute])
                } else {
                    error_message += ' ' + attribute + ' is a '+typeof req.body[attribute]+'. Should be a number.'
                }
            } catch (error) {
                error_message += ' ' + attribute + ' is a '+typeof req.body[attribute]+'. Should be a number.'
            }
        } else if (type=="STRING" || type=="TEXT") {
            try {
                if(validator.isLength(req.body[attribute],{min:0})) {
                    return_body[attribute] = req.body[attribute]
                } else {
                    error_message += ' ' + attribute + ' is a '+typeof req.body[attribute]+'. Should be a string.'
                }
            } catch (error) {
                error_message += ' ' + attribute + ' is a '+typeof req.body[attribute]+'. Should be a string.'
            }
        } else if (type=="BOOLEAN") {
            try {
                if(validator.isBoolean(req.body[attribute].toString())) {
                    return_body[attribute] = req.body[attribute]
                } else {
                    error_message += ' ' + attribute + ' is a '+typeof req.body[attribute]+'. Should be a boolean.'
                }
            } catch(error) {
                error_message += ' ' + attribute + ' is a '+typeof req.body[attribute]+'. Should be a boolean.'
            }
        } else if (type=="DATE") {
            return_body[attribute] = req.body[attribute]
        } else {
            console.log("UNCAUGHT TYPE",type)
        }
    }
}

exports.orderItem = (req,res,next) => {
    const model = db.OrderItem.tableAttributes
    let ignore = [...ignore_all]
    ignore.push('orderItemID', 'unit', 'unitPrice', 'status', 'sku', 'vendor')
    return_body = {}
    let error_message = ''
    console.log(req.body)

    // For updates (PUT requests), only validate fields that are actually being updated
    const isUpdate = req.method === 'PUT' || req.method === 'PATCH';

    Object.keys(model).forEach(attribute=>{
        if(!ignore.includes(attribute)) {
            if(!model[attribute].allowNull) {
                if(typeof req.body[attribute] =='undefined'||req.body[attribute]==null) {
                    // Only require field if it's a POST (create) operation
                    if(!isUpdate) {
                        error_message += ' ' + attribute + ' is required.'
                    }
                } else {
                    checkType(model[attribute].type.constructor.name,attribute)
                }
            } else {
                if(typeof req.body[attribute] =='undefined'||req.body[attribute]==null) {
                    return_body[attribute] = null
                } else {
                    checkType(model[attribute].type.constructor.name,attribute)
                }
            }
        }
    })
    if(!!error_message) {
        next(new RestError(error_message,400));
    }
    req.body = return_body
    next()

    function checkType(type,attribute) {
        if(type=="INTEGER") {
            try {
                if(validator.isInt(req.body[attribute].toString())) {
                    return_body[attribute] = parseInt(req.body[attribute])
                } else {
                    error_message += ' ' + attribute + ' is a '+typeof req.body[attribute]+'. Should be a number.'
                }
            } catch (error) {
                error_message += ' ' + attribute + ' is a '+typeof req.body[attribute]+'. Should be a number.'
            }
        } else if (type=="STRING") {
            try {
                if(validator.isLength(req.body[attribute],{min:0})) {
                    return_body[attribute] = req.body[attribute]
                } else {
                    error_message += ' ' + attribute + ' is a '+typeof req.body[attribute]+'. Should be a string.'
                }
            } catch (error) {
                error_message += ' ' + attribute + ' is a '+typeof req.body[attribute]+'. Should be a string.'
            }
        } else if (type=="BOOLEAN") {
            try {
                if(validator.isBoolean(req.body[attribute].toString())) {
                    return_body[attribute] = req.body[attribute]
                } else {
                    error_message += ' ' + attribute + ' is a '+typeof req.body[attribute]+'. Should be a boolean.'
                }
            } catch(error) {
                error_message += ' ' + attribute + ' is a '+typeof req.body[attribute]+'. Should be a boolean.'
            }
        } else if (type=="DECIMAL") {
            try {
                return_body[attribute] = parseFloat(req.body[attribute])
            } catch (error) {
                error_message += ' ' + attribute + ' is a '+typeof req.body[attribute]+'. Should be a number.'
            }
        } else {
            console.log("UNCAUGHT TYPE",type)
        }
    }
}
