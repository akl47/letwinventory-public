const passport = require("passport");
const router = require("express").Router();
const controller = require("./controller");
const checkToken = require("../../../middleware/checkToken.js");

router.get("/checkToken", controller.checkToken);

router.post("/refresh", controller.refreshToken);

router.get("/", checkToken, controller.getUser);
router.get("/my-permissions", checkToken, controller.getMyPermissions);
router.get("/sessions", checkToken, controller.getSessions);
router.delete("/sessions/:id", checkToken, controller.revokeSession);

router.put("/", checkToken, controller.updateUser);

router.get("/github-pat", checkToken, controller.getGithubPATStatus);
router.put("/github-pat", checkToken, controller.setGithubPAT);
router.delete("/github-pat", checkToken, controller.clearGithubPAT);

module.exports = router;
