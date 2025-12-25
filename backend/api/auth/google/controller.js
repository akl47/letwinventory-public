const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const jwt = require('jsonwebtoken');
const db = require('../../../models');

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "http://localhost:3000/api/auth/google/callback"
    },
    (accessToken, refreshToken, profile, done) => {
      return done(null, profile);
    }
  )
);

exports.initiateLogin = (req, res, next) => {
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    prompt: 'select_account'
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
      const [user, created] = await db.User.findOrCreate({
        where: { googleID: profile.id },
        defaults: {
          displayName: profile.displayName,
          email: profile.emails[0].value,
          googleID: profile.id,
          photoURL: profile.photos[0].value
        }
      });
      if (user.activeFlag) {
        // Generate JWT token
        const token = jwt.sign(
          {
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL
          },
          process.env.JWT_SECRET,
          { expiresIn: '24h' }
        );

        // Set token in cookie and redirect to frontend
        res.cookie('auth_token', token, {
          httpOnly: false,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 86400000 // 24 hours
        }).cookie('name', encodeURI(user.displayName), {
          httpOnly: false, // Allow frontend to read the name
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 86400000 // 24 hours
        }).redirect("http://localhost:4200");
      } else {
        throw new Error('User is not authorized');
      }
    } catch (error) {
      console.error('Error in callback:', error);
      return next(error);
    }
  })(req, res, next);
};

exports.logout = (req, res) => {
  res.clearCookie('auth_token').json({ message: 'Logged out successfully' });
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
