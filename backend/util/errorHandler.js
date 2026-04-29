const humanizeError = require('./humanizeError');

const SEQUELIZE_ERROR_NAMES = new Set([
    'SequelizeUniqueConstraintError',
    'SequelizeValidationError',
    'SequelizeForeignKeyConstraintError',
    'SequelizeDatabaseError',
]);

module.exports = (err, req, res, next) => {
    let finalErr = err;
    if (err && SEQUELIZE_ERROR_NAMES.has(err.name)) {
        finalErr = humanizeError(err, 'Request failed');
    }
    if (!_.isNumber(finalErr.statusCode)) {
        finalErr.statusCode = 500;
    }
    console.error(`[${finalErr.statusCode}] ${req.method} ${req.originalUrl} — ${finalErr.message}`);
    if (finalErr.statusCode >= 500 && err.stack) {
        console.error(err.stack);
    }
    res.status(finalErr.statusCode).json({
        errorMessage: finalErr.message
    });
}
