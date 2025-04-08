const path = require("path");
const dotenv = require("dotenv");
const passport = require("passport");
const { Strategy: GoogleStrategy } = require("passport-google-oauth20");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");

dotenv.config({ path: path.join(__dirname, "../../.env") });

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
      scope: ["openid", "profile", "email"],
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const user = {
          id: profile.id,
          displayName: profile.displayName,
          email: profile.emails[0].value,
          photo_url: profile.photos[0].value,
        };

        // Generate our own JWT token
        user.token = jwt.sign(user, process.env.JWT_SECRET, {
          expiresIn: '1h',
          algorithm: 'HS256'
        });
        return done(null, user);
      } catch (error) {
        console.error("OpenID Connect Error:", error);
        return done(error, null);
      }
    }
  )
);

// Middleware to verify JWT token
const verifyToken = async (token) => {
  try {
    // First try to verify as a Google ID token
    try {
      const ticket = await client.verifyIdToken({
        idToken: token,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      
      return {
        id: payload.sub,
        displayName: payload.name,
        email: payload.email,
        photo_url: payload.picture,
        iss: payload.iss,
        aud: payload.aud,
        exp: payload.exp,
        iat: payload.iat,
      };
    } catch (googleError) {
      // If not a Google token, try to verify as our own JWT
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      return decoded;
    }
  } catch (error) {
    throw new Error('Invalid token: ' + error.message);
  }
};

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

// Export passport as the main export
module.exports = passport;

// Export verifyToken as a property of passport
passport.verifyToken = verifyToken;
