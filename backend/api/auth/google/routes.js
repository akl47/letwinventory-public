const express = require('express');
const router = express.Router();
const passport = require('../../../auth/passport');

// Initiate Google OAuth flow
router.get('/',
  passport.authenticate('google', {
    scope: ['openid', 'profile', 'email']
  })
);

// Handle Google OAuth callback
router.get('/callback',
  passport.authenticate('google', {
    failureRedirect: '/login',
    session: false
  }),
  (req, res) => {
    // Successful authentication, redirect to frontend with token
    res.redirect(`${process.env.FRONTEND_URL}/auth/callback?token=${req.user.token}`);
  }
);

module.exports = router; 