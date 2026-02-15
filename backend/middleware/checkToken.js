const jwt = require('jsonwebtoken');


module.exports = (req, res, next) => {
  if (_.isString(req.headers.authorization)) {
    let token = req.headers.authorization.replace('Bearer ', '');
    jwt.verify(token, process.env.JWT_SECRET, (err, jwtUser) => {
      if (_.isNull(err)) {
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
          next(new RestError('Error finding user in database', 500));
        })
      } else {
        console.log('[AUTH] Token verify failed:', err.name, err.message, '| URL:', req.method, req.originalUrl);
        next(new RestError('Invalid or expired token', 401));
      }
    })
  } else {
    console.log('[AUTH] No Authorization header | URL:', req.method, req.originalUrl);
    next(new RestError('Authentication required', 401));
  }
}