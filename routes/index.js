/*
 * Connect all of your endpoints together here.
 */
module.exports = function (app, router) {
    require('./users.js')(router);
    require('./tasks.js')(router);
    app.use('/api', require('./home.js')(router));
};
