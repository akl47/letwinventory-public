class RestError extends Error {
    constructor(message,status) {
        super(message);
        this.statusCode = status;
    }
}

module.exports = RestError