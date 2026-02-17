const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Op } = require('sequelize');
const db = require('../../../models');
const dotenv = require('dotenv');
const path = require('path');

// Load environment-specific .env file
const envFile = process.env.NODE_ENV === 'production'
  ? '.env.production'
  : '.env.development';
dotenv.config({ path: path.join(__dirname, `../../../../${envFile}`) });

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL
    },
    (accessToken, refreshToken, profile, done) => {
      return done(null, profile);
    }
  )
);

exports.initiateLogin = (req, res, next) => {
  passport.authenticate('google', {
    scope: [
      'profile',
      'email'
    ]
  })(req, res, next);
};

exports.handleCallback = (req, res, next) => {
  passport.authenticate('google', { session: false }, async (err, profile, info) => {
    if (err) {
      console.error('Authentication error:', err);
      return next(err);
    }
    if (!profile) {
      console.error('No profile returned from authentication');
      return res.status(401).json({ error: 'Authentication failed' });
    }

    try {
      // Find or create user in database
      let [user, created] = await db.User.findOrCreate({
        where: { googleID: profile.id },
        defaults: {
          displayName: profile.displayName,
          email: profile.emails[0].value,
          googleID: profile.id,
          photoURL: profile.photos[0].value
        }
      });

      // If a new record was created, check if an admin pre-created a user with same email
      if (created) {
        const existingByEmail = await db.User.findOne({
          where: { email: profile.emails[0].value, id: { [Op.ne]: user.id } }
        });
        if (existingByEmail) {
          // Admin pre-created this user — link Google account
          await user.destroy({ force: true });
          await existingByEmail.update({
            googleID: profile.id,
            displayName: profile.displayName,
            photoURL: profile.photos[0].value,
            activeFlag: true,
          });
          user = existingByEmail;
          created = false;
        }
      }

      // If truly new user, add to Default group
      if (created) {
        const defaultGroup = await db.UserGroup.findOne({ where: { name: 'Default', activeFlag: true } });
        if (defaultGroup) {
          await db.UserGroupMember.findOrCreate({ where: { userID: user.id, groupID: defaultGroup.id } });
        }
      }

      if (user.activeFlag) {
        // Generate short-lived access token (15 minutes)
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

        // Generate refresh token (random string, stored hashed in DB)
        const refreshTokenRaw = crypto.randomBytes(32).toString('hex');
        const refreshTokenHash = crypto.createHash('sha256').update(refreshTokenRaw).digest('hex');
        const refreshTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

        // Deactivate any existing refresh tokens for this user
        await db.RefreshToken.update(
          { activeFlag: false },
          { where: { userId: user.id, activeFlag: true } }
        );

        // Store hashed refresh token in database
        await db.RefreshToken.create({
          token: refreshTokenHash,
          userId: user.id,
          expiresAt: refreshTokenExpiry
        });

        // Set tokens in cookies and redirect to frontend
        const redirectUrl = process.env.FRONTEND_URL || '/';
        res.cookie('auth_token', accessToken, {
          httpOnly: false, // Frontend needs to read this
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 15 * 60 * 1000 // 15 minutes
        }).cookie('refresh_token', refreshTokenRaw, {
          httpOnly: true, // Not accessible via JavaScript
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        }).cookie('name', encodeURI(user.displayName), {
          httpOnly: false, // Allow frontend to read the name
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        }).redirect(redirectUrl);
      } else {
        throw new Error('User is not authorized');
      }
    } catch (error) {
      console.error('Error in callback:', error);
      return next(error);
    }
  })(req, res, next);
};

exports.logout = async (req, res) => {
  try {
    // Get refresh token from cookie and deactivate in database
    const refreshTokenRaw = req.cookies?.refresh_token;
    if (refreshTokenRaw) {
      const refreshTokenHash = crypto.createHash('sha256').update(refreshTokenRaw).digest('hex');
      await db.RefreshToken.update(
        { activeFlag: false },
        { where: { token: refreshTokenHash } }
      );
    }

    // Clear all auth cookies
    res
      .clearCookie('auth_token')
      .clearCookie('refresh_token')
      .clearCookie('name')
      .json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Error during logout:', error);
    // Still clear cookies even if DB operation fails
    res
      .clearCookie('auth_token')
      .clearCookie('refresh_token')
      .clearCookie('name')
      .json({ message: 'Logged out successfully' });
  }
};

// Dev-only: login without Google OAuth
exports.testLogin = async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }

  try {
    const { email, displayName } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'email is required' });
    }

    const [user, created] = await db.User.findOrCreate({
      where: { email },
      defaults: {
        displayName: displayName || email.split('@')[0],
        email,
        googleID: `test-${Date.now()}`,
        photoURL: '',
        activeFlag: true,
      },
    });

    // Ensure existing user is active
    if (!created && !user.activeFlag) {
      await user.update({ activeFlag: true });
    }

    // If truly new user, add to Default group
    if (created) {
      const defaultGroup = await db.UserGroup.findOne({ where: { name: 'Default', activeFlag: true } });
      if (defaultGroup) {
        await db.UserGroupMember.findOrCreate({ where: { userID: user.id, groupID: defaultGroup.id } });
      }
    }

    const accessToken = jwt.sign(
      { id: user.id, email: user.email, displayName: user.displayName, photoURL: user.photoURL },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.json({ accessToken, user: { id: user.id, email: user.email, displayName: user.displayName } });
  } catch (error) {
    console.error('Test login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getCurrentUser = async (req, res) => {
  try {
    const user = await db.User.findByPk(req.user.id, {
      attributes: ['id', 'email', 'displayName', 'photoUrl']
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
