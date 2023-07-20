module.exports = (err,req,res,next) => {
    if(!_.isNumber(err.statusCode)) {
        err.statusCode = 500;
    }
    res.status(err.statusCode).json({
        errorMessage:err.message
    });
}