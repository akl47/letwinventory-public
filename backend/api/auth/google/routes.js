const router = require("express").Router();
const controller = require("./controller");
const { verifyToken } = require("../../../auth/passport");

// Google OAuth routes
router.get("/", controller.initiateLogin);
router.get("/callback", controller.handleCallback);

// Protected routes
router.post("/logout", verifyToken, controller.logout);
router.get("/me", verifyToken, controller.getCurrentUser);

module.exports = router;
