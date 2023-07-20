const jwt = require('jsonwebtoken');


module.exports = (req,res,next) => {
    if(_.isString(req.headers.authorization)) {
        jwt.verify(req.headers.authorization,process.env.JWT_SECRET,(err,jwtUser)=>{
          if(_.isNull(err)) {
            db.User.findOne({
              attributes: ['id', 'username','displayName','email'],
              where:{
                id:jwtUser.id,
                activeFlag:true
              }
            }).then(dbUser=>{
              if(_.isNull(dbUser)){
                
                next(new RestError('Error finding user in database',500))
              } else {
                req.user = dbUser.dataValues;
                next();
              }
            }).catch(error=>{
              console.log(error)
              next(new RestError('Error finding user in database',500));
            })
          } else {
            next(new RestError('Invalid Token',403));
          }
        })
      } else {
        next(new RestError('Request is missing in header.authorization',400));
      }
}