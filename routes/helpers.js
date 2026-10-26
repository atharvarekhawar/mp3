/*
 * Shared helpers for the users and tasks endpoints.
 */
var mongoose = require('mongoose');

class HttpError extends Error {
    constructor(status, message, data) {
        super(message);
        this.status = status;
        this.data = data === undefined ? message : data;
    }
}

function send(res, status, message, data) {
    res.status(status).json({ message: message, data: data });
}

function isValidId(id) {
    return typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id);
}

// Parse a JSON-encoded query string parameter; undefined when absent.
function parseJsonParam(query, key) {
    var raw = query[key];
    if (raw === undefined) return undefined;
    var value;
    try {
        value = JSON.parse(raw);
    } catch (e) {
        throw new HttpError(400, 'Bad Request', 'Invalid JSON in "' + key + '" parameter');
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new HttpError(400, 'Bad Request', '"' + key + '" parameter must be a JSON object');
    }
    return value;
}

function parseIntParam(query, key) {
    var raw = query[key];
    if (raw === undefined) return undefined;
    var value;
    try {
        value = JSON.parse(raw);
    } catch (e) {
        value = NaN;
    }
    if (!Number.isInteger(value) || value < 0) {
        throw new HttpError(400, 'Bad Request', '"' + key + '" parameter must be a non-negative integer');
    }
    return value;
}

function parseBoolParam(query, key) {
    var raw = query[key];
    if (raw === undefined) return false;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    throw new HttpError(400, 'Bad Request', '"' + key + '" parameter must be true or false');
}

// Run a collection GET using Mongoose query methods.
async function listCollection(Model, query, defaultLimit) {
    var where = parseJsonParam(query, 'where') || {};
    var sort = parseJsonParam(query, 'sort');
    var select = parseJsonParam(query, 'select');
    var skip = parseIntParam(query, 'skip');
    var limit = parseIntParam(query, 'limit');
    var count = parseBoolParam(query, 'count');
    // The default limit caps returned documents, not counts.
    if (limit === undefined && !count) limit = defaultLimit;

    var q = count ? Model.countDocuments(where) : Model.find(where);
    if (!count && sort) q = q.sort(sort);
    if (!count && select) q = q.select(select);
    if (skip !== undefined) q = q.skip(skip);
    if (limit !== undefined && limit !== 0) q = q.limit(limit);

    try {
        return await q.exec();
    } catch (err) {
        if (isConnectionError(err)) throw err;
        // Anything else here was caused by the client's query parameters.
        throw new HttpError(400, 'Bad Request', 'Invalid query parameters');
    }
}

function parseSelect(query) {
    return parseJsonParam(query, 'select');
}

function isConnectionError(err) {
    return mongoose.connection.readyState !== 1 ||
        /Network|ServerSelection|Timeout|NotConnected/i.test(err && err.name || '');
}

// Field checkers for request bodies.
function isNonEmptyString(v) {
    return typeof v === 'string' && v.trim().length > 0;
}

function parseDate(v) {
    var d;
    if (typeof v === 'number') {
        d = new Date(v);
    } else if (typeof v === 'string' && v.trim() !== '') {
        d = /^-?\d+$/.test(v.trim()) ? new Date(Number(v)) : new Date(v);
    } else {
        return null;
    }
    return isNaN(d.getTime()) ? null : d;
}

function parseBool(v) {
    if (typeof v === 'boolean') return v;
    if (v === 'true') return true;
    if (v === 'false') return false;
    return null;
}

// Express error handler: never leak Mongoose/MongoDB internals.
function errorHandler(err, req, res, next) {
    if (err instanceof HttpError) {
        return send(res, err.status, err.message, err.data);
    }
    if (err && err.type === 'entity.parse.failed') {
        return send(res, 400, 'Bad Request', 'Request body is not valid JSON');
    }
    if (err && err.code === 11000) {
        return send(res, 400, 'Bad Request', 'A user with that email already exists');
    }
    if (err && (err.name === 'ValidationError' || err.name === 'CastError')) {
        return send(res, 400, 'Bad Request', 'Invalid field values');
    }
    console.error(err);
    send(res, 500, 'Internal Server Error', 'Something went wrong on the server');
}

module.exports = {
    HttpError: HttpError,
    send: send,
    isValidId: isValidId,
    listCollection: listCollection,
    parseSelect: parseSelect,
    isNonEmptyString: isNonEmptyString,
    parseDate: parseDate,
    parseBool: parseBool,
    errorHandler: errorHandler
};
