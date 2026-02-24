const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const db = require("../../../models");
const { OAuth2Client } = require("google-auth-library");
const passport = require("../../../auth/passport");
const { loadEffectivePermissions } = require('../../../middleware/checkPermission');
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

    let permissions = [];
    try {
      permissions = [...await loadEffectivePermissions(user.id)];
    } catch (permErr) {
      console.error('[AUTH] Failed to load permissions:', permErr.message);
    }

    res.json({
      valid: true,
      user: {
        id: user.id,
        displayName: user.displayName,
        email: user.email
      },
      permissions,
      impersonatedBy: decoded.impersonatedBy || null
    });
  } catch (error) {
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

exports.getMyPermissions = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's group memberships with group names and their permissions
    const memberships = await db.UserGroupMember.findAll({
      where: { userID: userId },
      include: [{
        model: db.UserGroup, as: 'group',
        where: { activeFlag: true },
        attributes: ['id', 'name'],
        required: true,
        include: [{
          model: db.Permission,
          as: 'permissions',
          attributes: ['id', 'resource', 'action'],
          through: { attributes: [] }
        }]
      }]
    });

    // Get direct user permissions
    const directPerms = await db.UserPermission.findAll({
      where: { userID: userId },
      include: [{ model: db.Permission, as: 'permission', attributes: ['id', 'resource', 'action'] }]
    });

    // Build map: "resource.action" -> source names[]
    const sourceMap = {};
    for (const m of memberships) {
      for (const p of m.group.permissions) {
        const key = `${p.resource}.${p.action}`;
        if (!sourceMap[key]) sourceMap[key] = [];
        sourceMap[key].push(m.group.name);
      }
    }
    for (const dp of directPerms) {
      const key = `${dp.permission.resource}.${dp.permission.action}`;
      if (!sourceMap[key]) sourceMap[key] = [];
      sourceMap[key].push('Direct');
    }

    res.json(sourceMap);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.loginWithGoogle = async (req, res, next) => {
  try {
    const user = await doGoogleLogin(req.body);
    res.json({ user });
  } catch (error) {
    next(error);
  }
};

/**
 * List active sessions for the current user
 */
exports.getSessions = async (req, res) => {
  try {
    const sessions = await db.RefreshToken.findAll({
      where: { userId: req.user.id, activeFlag: true },
      attributes: ['id', 'userAgent', 'createdAt', 'expiresAt'],
      order: [['createdAt', 'DESC']]
    });
    res.json(sessions);
  } catch (error) {
    console.error('[AUTH] Error fetching sessions:', error);
    res.status(500).json({ error: 'Error fetching sessions' });
  }
};

/**
 * Revoke a specific session for the current user
 */
exports.revokeSession = async (req, res) => {
  try {
    const session = await db.RefreshToken.findOne({
      where: { id: req.params.id, userId: req.user.id, activeFlag: true }
    });
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    await session.update({ activeFlag: false });
    res.json({ message: 'Session revoked' });
  } catch (error) {
    console.error('[AUTH] Error revoking session:', error);
    res.status(500).json({ error: 'Error revoking session' });
  }
};

/**
 * Refresh access token using refresh token from httpOnly cookie
 */
exports.refreshToken = async (req, res) => {
  try {
    const refreshTokenRaw = req.cookies?.refresh_token;
    console.log('[REFRESH] Attempt | cookie present:', !!refreshTokenRaw, '| cookies:', Object.keys(req.cookies || {}));

    if (!refreshTokenRaw) {
      console.log('[REFRESH] FAIL: No refresh_token cookie');
      return res.status(401).json({ error: 'No refresh token provided' });
    }

    // Hash the token to compare with database
    const refreshTokenHash = crypto.createHash('sha256').update(refreshTokenRaw).digest('hex');

    // Find the refresh token in database (must be active)
    const storedToken = await db.RefreshToken.findOne({
      where: { token: refreshTokenHash, activeFlag: true },
      include: [{
        model: db.User,
        as: 'user',
        attributes: ['id', 'email', 'displayName', 'photoURL', 'activeFlag']
      }]
    });

    if (!storedToken) {
      console.log('[REFRESH] FAIL: Token hash not found in DB (invalid or already rotated)');
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    // Check if token is expired
    if (new Date() > storedToken.expiresAt) {
      console.log('[REFRESH] FAIL: Token expired at', storedToken.expiresAt, '| now:', new Date());
      await storedToken.update({ activeFlag: false });
      return res.status(401).json({ error: 'Refresh token expired' });
    }

    // Check if user is still active
    if (!storedToken.user || !storedToken.user.activeFlag) {
      console.log('[REFRESH] FAIL: User not active | user:', storedToken.user?.id);
      await storedToken.update({ activeFlag: false });
      return res.status(401).json({ error: 'User is not active' });
    }

    const user = storedToken.user;

    // Generate new access token
    const accessToken = jwt.sign(
      {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL
      },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    let permissions = [];
    try {
      permissions = [...await loadEffectivePermissions(user.id)];
    } catch (permErr) {
      console.error('[AUTH] Failed to load permissions on refresh:', permErr.message);
    }

    // Reuse existing refresh token (no rotation) — avoids stale-cookie issues
    // when Set-Cookie doesn't land (Cloudflare edge, race conditions, etc.)
    res.cookie('auth_token', accessToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 15 * 60 * 1000 // 15 minutes
    }).json({
      accessToken,
      sessionId: storedToken.id,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName
      },
      permissions
    });
    console.log('[REFRESH] OK: New tokens issued for user', user.id, user.email);
  } catch (error) {
    console.error('[REFRESH] ERROR:', error);
    res.status(500).json({ error: 'Error refreshing token' });
  }
};
