const jwt = require('jsonwebtoken');


module.exports = (req, res, next) => {
  if (_.isString(req.headers.authorization)) {
    let token = req.headers.authorization.replace('Bearer ', '');
    jwt.verify(token, process.env.JWT_SECRET, (err, jwtUser) => {
      if (_.isNull(err)) {
        // console.log(jwtUser)
        db.User.findOne({
          attributes: ['id', 'displayName', 'email'],
          where: {
            id: jwtUser.id,
            activeFlag: true
          }
        }).then(dbUser => {
          if (_.isNull(dbUser)) {

            next(new RestError('Error finding user in database', 500))
          } else {
            req.user = dbUser.dataValues;
            next();
          }
        }).catch(error => {
          console.log(error)
          next(new RestError('Error finding user in database', 500));
        })
      } else {
        next(new RestError('Invalid Token', 403));
      }
    })
  } else {
    next(new RestError('Request is missing in header.authorization', 400));
  }
}