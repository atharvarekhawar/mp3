var User = require('../models/user');
var Task = require('../models/task');
var h = require('./helpers');
var HttpError = h.HttpError;

async function validateUser(req, userId) {
    var body = req.body || {};
    if (!h.isNonEmptyString(body.name)) {
        throw new HttpError(400, 'Bad Request', 'User name is required');
    }
    if (!h.isNonEmptyString(body.email)) {
        throw new HttpError(400, 'Bad Request', 'User email is required');
    }

    var pending = body.pendingTasks;
    if (pending === undefined || pending === null || pending === '') {
        pending = [];
    } else if (typeof pending === 'string' && req.is('application/x-www-form-urlencoded')) {
        pending = [pending];
    }
    if (!Array.isArray(pending)) {
        throw new HttpError(400, 'Bad Request', 'pendingTasks must be a list of task ids');
    }
    if (!pending.every(h.isValidId)) {
        throw new HttpError(400, 'Bad Request', 'pendingTasks contains an invalid task id');
    }
    pending = Array.from(new Set(pending));

    var email = body.email.trim();
    var clash = await User.findOne({ email: email, _id: { $ne: userId } });
    if (clash) {
        throw new HttpError(400, 'Bad Request', 'A user with that email already exists');
    }

    var tasks = await Task.find({ _id: { $in: pending } });
    if (tasks.length !== pending.length) {
        throw new HttpError(404, 'Not Found', 'One or more tasks in pendingTasks do not exist');
    }
    if (tasks.some(function (t) { return t.completed; })) {
        throw new HttpError(400, 'Bad Request', 'Completed tasks cannot be in pendingTasks');
    }

    return { name: body.name.trim(), email: email, pendingTasks: pending };
}

async function syncTasks(user, oldPending, oldName) {
    var id = String(user._id);
    var pending = user.pendingTasks;
    var removed = oldPending.filter(function (t) { return pending.indexOf(t) === -1; });

    if (removed.length) {
        await Task.updateMany(
            { _id: { $in: removed }, assignedUser: id },
            { assignedUser: '', assignedUserName: 'unassigned' }
        );
    }
    if (pending.length) {
        await User.updateMany(
            { _id: { $ne: user._id }, pendingTasks: { $in: pending } },
            { $pull: { pendingTasks: { $in: pending } } }
        );
        await Task.updateMany(
            { _id: { $in: pending } },
            { assignedUser: id, assignedUserName: user.name }
        );
    }
    if (oldName !== undefined && oldName !== user.name) {
        await Task.updateMany({ assignedUser: id }, { assignedUserName: user.name });
    }
}

async function findUserOr404(id, select) {
    var user = h.isValidId(id) ? await User.findById(id).select(select || {}) : null;
    if (!user) throw new HttpError(404, 'Not Found', 'User not found');
    return user;
}

module.exports = function (router) {

    var usersRoute = router.route('/users');

    usersRoute.get(async function (req, res) {
        var data = await h.listCollection(User, req.query, undefined);
        h.send(res, 200, 'OK', data);
    });

    usersRoute.post(async function (req, res) {
        var fields = await validateUser(req, null);
        var user = await User.create(fields);
        await syncTasks(user, []);
        h.send(res, 201, 'User created', user);
    });

    var userRoute = router.route('/users/:id');

    userRoute.get(async function (req, res) {
        var select = h.parseSelect(req.query);
        var user = await findUserOr404(req.params.id, select);
        h.send(res, 200, 'OK', user);
    });

    userRoute.put(async function (req, res) {
        var user = await findUserOr404(req.params.id);
        var fields = await validateUser(req, user._id);
        var oldPending = user.pendingTasks.slice();
        var oldName = user.name;

        user.name = fields.name;
        user.email = fields.email;
        user.pendingTasks = fields.pendingTasks;
        await user.save();
        await syncTasks(user, oldPending, oldName);
        h.send(res, 200, 'User updated', user);
    });

    userRoute.delete(async function (req, res) {
        var user = await findUserOr404(req.params.id);
        await user.deleteOne();
        await Task.updateMany(
            { assignedUser: String(user._id) },
            { assignedUser: '', assignedUserName: 'unassigned' }
        );
        res.status(204).end();
    });

    return router;
}
