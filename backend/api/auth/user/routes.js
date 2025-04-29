const passport = require("passport");
const router = require("express").Router();
const controller = require("./controller");
const checkToken = require("../../../middleware/checkToken.js");

router.get("/checkToken", controller.checkToken);

router.get("/", checkToken, controller.getUser);

router.put("/", checkToken, controller.updateUser);

module.exports = router;
