const express = require('express');
const router = express.Router();
const barcodeHistoryController = require('./controller');
const checkToken = require("../../../middleware/checkToken.js");

router.get('/', checkToken, barcodeHistoryController.getAllHistory);
router.get('/actiontypes', checkToken, barcodeHistoryController.getActionTypes);
router.get('/barcode/:barcodeId', checkToken, barcodeHistoryController.getBarcodeHistory);

module.exports = router;
