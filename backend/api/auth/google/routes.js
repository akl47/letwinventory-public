const router = require("express").Router();
const controller = require("./controller");
const { verifyToken } = require("../../../auth/passport");

// Google OAuth routes
router.get("/", controller.initiateLogin);
router.get("/callback", controller.handleCallback);

// Protected routes
router.post("/logout", verifyToken, controller.logout);
router.get("/me", verifyToken, controller.getCurrentUser);

// Dev-only test login (no Google OAuth required)
if (process.env.NODE_ENV !== 'production') {
  router.post("/test-login", controller.testLogin);
}

module.exports = router;
