const passport = require("passport");
const router = require("express").Router();
const controller = require("./controller");
const checkToken = require("../../../middleware/checkToken.js");

router.post("/login", controller.logIn);

router.post("/google", controller.loginWithGoogle);

router.get("/checkToken", controller.checkToken);

router.get("/", checkToken, controller.getUser);

router.put("/:id", checkToken, controller.updateUser);

module.exports = router;
