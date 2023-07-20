var router = require('express').Router();
var fs = require('fs');

fs.readdirSync(__dirname)
    .filter(group=>{
        return(group.indexOf('.')===-1);
    })
    .forEach(group=>{
        fs.readdirSync(__dirname+'/'+group)
        .filter(folder=>{
            return(folder.indexOf('.')===-1);
        })
        .forEach(folder=>{
            router.use('/'+group+'/'+folder,require('./'+group+'/'+folder+'/routes'))  
        })  
    })

module.exports = router;