const express = require('express');
const router = express.Router();
const barcodeHistoryController = require('./controller');
const checkToken = require("../../../middleware/checkToken.js");
const checkPermission = require('../../../middleware/checkPermission');

router.get('/', checkToken, checkPermission('inventory', 'read'), barcodeHistoryController.getAllHistory);
router.get('/actiontypes', checkToken, checkPermission('inventory', 'read'), barcodeHistoryController.getActionTypes);
router.get('/barcode/:barcodeId', checkToken, checkPermission('inventory', 'read'), barcodeHistoryController.getBarcodeHistory);

module.exports = router;
