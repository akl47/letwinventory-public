const db = require('../models');
var validator = require('validator');
ignore_all = ['id','activeFlag','createdAt','updatedAt']

exports.location = (req,res,next) => {
    const model = db.Location.tableAttributes
    let ignore = [...ignore_all]
    ignore.push('barcodeID')
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

