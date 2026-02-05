const path = require("path");
const dotenv = require("dotenv");
const passport = require("passport");
const { Strategy: GoogleStrategy } = require("passport-google-oauth20");
const jwt = require("jsonwebtoken");
const db = require("../models");

// Load environment-specific .env file
const envFile = process.env.NODE_ENV === 'production'
  ? '.env.production'
  : '.env.development';
dotenv.config({ path: path.join(__dirname, `../../${envFile}`) });

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
      scope: ["profile", "email"],
    },
    async (accessToken, refreshToken, profile, done) => {
      console.log("Passport Callback Function fired")
      try {
        // Find or create user in database
        let user = await db.User.findOne({ where: { email: profile.emails[0].value } });

        if (!user) {
          user = await db.User.create({
            email: profile.emails[0].value,
            displayName: profile.displayName,
            googleId: profile.id,
            photoUrl: profile.photos[0].value
          });
        }

        // Generate JWT token
        const token = jwt.sign(
          {
            id: user.id,
            email: user.email,
            displayName: user.displayName
          },
          process.env.JWT_SECRET,
          { expiresIn: '24h' }
        );

        // Attach token to user object
        user.token = token;

        return done(null, user);
      } catch (error) {
        console.error("Google OAuth Error:", error);
        return done(error, null);
      }
    }
  )
);

// JWT verification middleware
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await db.User.findByPk(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

module.exports = {
  passport,
  verifyToken
};
