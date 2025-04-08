const jwt = require("jsonwebtoken");
const db = require("../../../models");
const { OAuth2Client } = require("google-auth-library");
const passport = require("../../../auth/passport");
// /**
//  * @param {string} req.body.username
//  * @param {string} req.body.password
//  * @returns {json} resutns display name and json web token
//  */

// exports.logIn = (req, res, next) => {
//   if (_.isString(req.body.username) && _.isString(req.body.password)) {
//     db.User.findOne({
//       where: {
//         username: req.body.username,
//         activeFlag: true,
//       },
//     })
//       .then((user) => {
//         if (_.isObject(user)) {
//           if (user.authenticate(req.body.password)) {
//             req.user = {
//               id: user.dataValues.id,
//               username: user.dataValues.username,
//               displayName: user.dataValues.displayName,
//             };
//             req.user.token = jwt.sign(req.user, process.env.JWT_SECRET);
//             console.log(user);
//             res.json(req.user);
//           } else {
//             next(new RestError("Username or password is incorrect", 403));
//           }
//         } else {
//           next(new RestError("Username or password is incorrect", 403));
//         }
//       })
//       .catch((err) => {
//         console.log(err);
//       });
//   } else {
//     next(new RestError("Request is missing username or password", 400));
//   }
// };


exports.googleCallback = (req, res, next) => {
  console.log("-----GOOGLE CALLBACK-----");
  console.log(req.body);
  res.send("Hello World");
}

/**
 * @param {string} req.headers.authorization
 * @returns {boolean} true if the token is valid
 */
exports.checkToken = async (req, res, next) => {
  try {
    if (!req.headers.authorization) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = req.headers.authorization.replace('Bearer ', '');
    const decoded = await passport.verifyToken(token);
    
    res.json({
      valid: true,
      user: {
        id: decoded.id,
        displayName: decoded.displayName,
        email: decoded.email
      }
    });
  } catch (error) {
    res.status(401).json({ 
      valid: false,
      error: error.message 
    });
  }
};

/**
 * @returns {json} returns logged in user object
 */
exports.getUser = (req, res, next) => {
  res.json(req.user);
};

/**
 * @param {number} req.params.id id to update, must match token id
 * @returns {json} returns updated user object
 */
exports.updateUser = (req, res, next) => {
  if (req.user.id == req.params.id) {
    db.User.update(req.body, {
      where: {
        id: req.user.id,
        activeFlag: true,
      },
      individualHooks: true,
    })
      .then((updated) => {
        db.User.findOne({
          attributes: ["id", "username", "displayName"],
          where: {
            id: req.user.id,
            activeFlag: true,
          },
        })
          .then((user) => {
            if (_.isNull(user)) {
              next(new RestError("Error finding user in database", 500));
            } else {
              req.user = {
                id: user.dataValues.id,
                username: user.dataValues.username,
                displayName: user.dataValues.displayName,
              };
              req.user.token = jwt.sign(req.user, process.env.JWT_SECRET);
              res.json(req.user);
            }
          })
          .catch((error) => {
            next(
              new RestError("Error finding user in database. " + error, 500)
            );
          });
      })
      .catch((error) => {
        next(new RestError("Error Updating User. " + error, 400));
      });
  } else {
    next(new RestError("Request user.id does not match token user.id", 400));
  }
};

const doGoogleLogin = async (credentials) => {
  console.log("-----DO GOOGLE LOGIN-----");
  console.log("Credentials: ", credentials);

  const { idToken } = credentials;
  if (!idToken) {
    throw new RestError('Missing ID token', 400);
  }

  try {
    const decoded = await passport.verifyToken(idToken);
    return {
      id: decoded.id,
      displayName: decoded.displayName,
      email: decoded.email,
      photo_url: decoded.photo_url,
      token: idToken
    };
  } catch (error) {
    throw new RestError('Google authentication failed: ' + error.message, 401);
  }
};

exports.loginWithGoogle = async (req, res, next) => {
  try {
    console.log("-----LOGIN WITH GOOGLE-----");
    // console.log("Request Body: ", req.body);
    const user = await doGoogleLogin(req.body);
    res.json({ user });
  } catch (error) {
    next(error);
  }
};
