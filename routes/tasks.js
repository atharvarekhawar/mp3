var User = require('../models/user');
var Task = require('../models/task');
var h = require('./helpers');
var HttpError = h.HttpError;

// Validate a task body and its assignment; throws HttpError, writes nothing.
async function validateTask(body) {
    body = body || {};
    if (!h.isNonEmptyString(body.name)) {
        throw new HttpError(400, 'Bad Request', 'Task name is required');
    }
    var deadline = h.parseDate(body.deadline);
    if (!deadline) {
        throw new HttpError(400, 'Bad Request', 'Task deadline is required and must be a valid date');
    }

    var description = body.description;
    if (description === undefined || description === null) description = '';
    if (typeof description !== 'string') {
        throw new HttpError(400, 'Bad Request', 'Task description must be a string');
    }

    var completed = body.completed;
    if (completed === undefined || completed === null || completed === '') {
        completed = false;
    } else {
        completed = h.parseBool(completed);
        if (completed === null) {
            throw new HttpError(400, 'Bad Request', 'completed must be true or false');
        }
    }

    var assignedUser = body.assignedUser;
    if (assignedUser === undefined || assignedUser === null) assignedUser = '';
    if (typeof assignedUser !== 'string' || (assignedUser !== '' && !h.isValidId(assignedUser))) {
        throw new HttpError(400, 'Bad Request', 'assignedUser is not a valid user id');
    }

    var assignedUserName = body.assignedUserName;
    if (assignedUserName !== undefined && assignedUserName !== null && typeof assignedUserName !== 'string') {
        throw new HttpError(400, 'Bad Request', 'assignedUserName must be a string');
    }
    if (assignedUserName === '') assignedUserName = undefined;

    if (assignedUser === '') {
        if (assignedUserName != null && assignedUserName !== 'unassigned') {
            throw new HttpError(400, 'Bad Request', 'assignedUserName must be "unassigned" when no user is assigned');
        }
        assignedUserName = 'unassigned';
    } else {
        var user = await User.findById(assignedUser);
        if (!user) {
            throw new HttpError(404, 'Not Found', 'Assigned user does not exist');
        }
        if (assignedUserName != null && assignedUserName !== user.name) {
            throw new HttpError(400, 'Bad Request', 'assignedUserName does not match the assigned user');
        }
        assignedUserName = user.name;
    }

    return {
        name: body.name.trim(),
        description: description,
        deadline: deadline,
        completed: completed,
        assignedUser: assignedUser,
        assignedUserName: assignedUserName
    };
}

// Keep the assigned user's pendingTasks in line with a saved task.
async function syncUsers(task, previousUser) {
    var id = String(task._id);
    if (previousUser && previousUser !== task.assignedUser) {
        await User.updateOne({ _id: previousUser }, { $pull: { pendingTasks: id } });
    }
    if (task.assignedUser) {
        var update = task.completed ? { $pull: { pendingTasks: id } } : { $addToSet: { pendingTasks: id } };
        await User.updateOne({ _id: task.assignedUser }, update);
    }
}

async function findTaskOr404(id, select) {
    var task = h.isValidId(id) ? await Task.findById(id).select(select || {}) : null;
    if (!task) throw new HttpError(404, 'Not Found', 'Task not found');
    return task;
}

module.exports = function (router) {

    var tasksRoute = router.route('/tasks');

    tasksRoute.get(async function (req, res) {
        var data = await h.listCollection(Task, req.query, 100);
        h.send(res, 200, 'OK', data);
    });

    tasksRoute.post(async function (req, res) {
        var fields = await validateTask(req.body);
        var task = await Task.create(fields);
        await syncUsers(task, '');
        h.send(res, 201, 'Task created', task);
    });

    var taskRoute = router.route('/tasks/:id');

    taskRoute.get(async function (req, res) {
        var select = h.parseSelect(req.query);
        var task = await findTaskOr404(req.params.id, select);
        h.send(res, 200, 'OK', task);
    });

    taskRoute.put(async function (req, res) {
        var task = await findTaskOr404(req.params.id);
        var fields = await validateTask(req.body);
        var previousUser = task.assignedUser;

        task.set(fields);
        await task.save();
        await syncUsers(task, previousUser);
        h.send(res, 200, 'Task updated', task);
    });

    taskRoute.delete(async function (req, res) {
        var task = await findTaskOr404(req.params.id);
        await task.deleteOne();
        if (task.assignedUser) {
            await User.updateOne(
                { _id: task.assignedUser },
                { $pull: { pendingTasks: String(task._id) } }
            );
        }
        res.status(204).end();
    });

    return router;
}
