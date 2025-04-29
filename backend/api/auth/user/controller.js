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


exports.checkToken = async (req, res, next) => {
  try {
    if (!req.headers.authorization) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = req.headers.authorization.replace('Bearer ', '');
    
    // Verify the token using jwt directly
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Find the user in the database
    const user = await db.User.findOne({
      where: {
        id: decoded.id,
        activeFlag: true
      },
      attributes: ['id', 'displayName', 'email']
    });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    res.json({
      valid: true,
      user: {
        id: user.id,
        displayName: user.displayName,
        email: user.email
      }
    });
  } catch (error) {
    console.log("Token verification error:", error);
    res.status(401).json({
      valid: false,
      error: 'Invalid token'
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
exports.updateUser = async (req, res, next) => {
  try {
    // Get the token from the authorization header
    const token = req.headers.authorization.replace('Bearer ', '');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Only update displayName
    const [updated] = await db.User.update(
      { displayName: req.body.displayName },
      {
        where: {
          id: decoded.id,
          activeFlag: true
        },
        returning: true
      }
    );

    if (!updated) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Fetch the updated user
    const user = await db.User.findOne({
      where: {
        id: decoded.id,
        activeFlag: true
      },
      attributes: ['id', 'displayName', 'email']
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      valid: true,
      user: {
        id: user.id,
        displayName: user.displayName,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Error updating user' });
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
