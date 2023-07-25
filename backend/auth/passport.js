const path = require("path");
const dotenv = require("dotenv");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20");

dotenv.config(dotenv.config({ path: path.join(__dirname, "../../.env") }));

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "/oauth2/redirect/google",
      scope: ["profile"],
    },
    async (accessToken, refreshToken, profile, done) => {
      console.log("first");
      try {
        return done(null, profile);
      } catch (error) {
        return done(error, null);
      }
    }
  )
);

module.exports = passport;
