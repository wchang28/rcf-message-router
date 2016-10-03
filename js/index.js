"use strict";
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var uuid = require('node-uuid');
var events = require('events');
var express = require('express');
var bodyParser = require('body-parser');
// this class emits the following events
// 1. change
var ConnectionsManager = (function (_super) {
    __extends(ConnectionsManager, _super);
    function ConnectionsManager() {
        _super.call(this);
        this.connCount = 0;
        this.__connections = {};
    }
    ConnectionsManager.prototype.getConnectionsCount = function () { return this.connCount; };
    ConnectionsManager.prototype.createConnection = function (req, connectionFactory, remoteAddress, messageCB, done) {
        var _this = this;
        var conn_id = uuid.v4();
        connectionFactory(req, conn_id, remoteAddress, messageCB, function (err, conn) {
            if (err) {
                done(err, null);
            }
            else {
                _this.__connections[conn_id] = conn;
                conn.onChange(function () {
                    _this.emit('change');
                });
                _this.connCount++;
                _this.emit('change');
                done(null, conn_id);
            }
        });
    };
    ConnectionsManager.prototype.removeConnection = function (conn_id) {
        var conn = this.__connections[conn_id];
        if (conn) {
            conn.end();
            delete this.__connections[conn_id];
            this.connCount--;
            this.emit('change');
        }
    };
    ConnectionsManager.prototype.addSubscription = function (req, conn_id, sub_id, destination, headers, done) {
        var conn = this.__connections[conn_id];
        if (conn) {
            conn.addSubscription(req, sub_id, destination, headers, done);
        }
        else {
            if (typeof done === 'function')
                done('bad connection');
        }
    };
    ConnectionsManager.prototype.removeSubscription = function (req, conn_id, sub_id, done) {
        var conn = this.__connections[conn_id];
        if (conn) {
            conn.removeSubscription(req, sub_id, done);
        }
        else {
            if (typeof done === 'function')
                done('bad connection');
        }
    };
    ConnectionsManager.prototype.forwardMessageImpl = function (req, srcConn, destination, headers, message, done) {
        var left = this.connCount;
        var errs = [];
        for (var id in this.__connections) {
            var conn = this.__connections[id];
            conn.forwardMessage(req, srcConn, destination, headers, message, function (err) {
                left--;
                if (err)
                    errs.push(err);
                if (left === 0) {
                    if (typeof done === 'function')
                        done(errs.length > 0 ? errs : null);
                }
            });
        }
    };
    ConnectionsManager.prototype.forwardMessage = function (req, conn_id, destination, headers, message, done) {
        var srcConn = this.__connections[conn_id];
        if (srcConn) {
            this.forwardMessageImpl(req, srcConn, destination, headers, message, done);
        }
        else {
            if (typeof done === 'function')
                done('bad connection');
        }
    };
    ConnectionsManager.prototype.injectMessage = function (destination, headers, message, done) {
        this.forwardMessageImpl(null, null, destination, headers, message, done);
    };
    ConnectionsManager.prototype.toJSON = function () {
        var ret = [];
        for (var conn_id in this.__connections) {
            var conn = this.__connections[conn_id];
            ret.push(conn.toJSON());
        }
        return ret;
    };
    return ConnectionsManager;
}(events.EventEmitter));
exports.ConnectionsManager = ConnectionsManager;
function getRouter(eventPath, connectionFactory) {
    var router = express.Router();
    router.use(bodyParser.json({ 'limit': '100mb' }));
    var connectionsManager = new ConnectionsManager();
    router.connectionsManager = connectionsManager;
    router.eventEmitter = new events.EventEmitter();
    // server side events streaming
    router.get(eventPath, function (req, res) {
        var remoteAddress = req.connection.remoteAddress + ':' + req.connection.remotePort.toString();
        var ep = { req: req, remoteAddress: remoteAddress };
        router.eventEmitter.emit('sse_connect', ep);
        // init SSE
        ///////////////////////////////////////////////////////////////////////
        //send headers for event-stream connection
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });
        // add a sseSend() method to the result object
        res.sseSend = function (data, event) {
            var s = "";
            if (event)
                s += "event: " + event.toString() + "\n";
            s += "data: " + JSON.stringify(data) + "\n\n";
            res.write(s);
            router.eventEmitter.emit('sse_send', s);
        };
        res.write('\n');
        ///////////////////////////////////////////////////////////////////////
        var conn_id = '';
        // initialize event streaming
        ///////////////////////////////////////////////////////////////////////
        connectionsManager.createConnection(req, connectionFactory, remoteAddress, function (msg) { res.sseSend(msg); }, function (err, connnection_id) {
            if (err)
                req.socket.end(); // close the socket, this will trigger req.on("close")
            else {
                conn_id = connnection_id;
                var cep = { req: req, remoteAddress: remoteAddress, conn_id: conn_id };
                router.eventEmitter.emit('client_connect', cep);
            }
        });
        ///////////////////////////////////////////////////////////////////////
        // The 'close' event is fired when a user closes their browser window.
        req.on("close", function () {
            router.eventEmitter.emit('sse_disconnect', ep);
            if (conn_id.length > 0) {
                var cep = { req: req, remoteAddress: remoteAddress, conn_id: conn_id };
                router.eventEmitter.emit('client_disconnect', cep);
                connectionsManager.removeConnection(conn_id);
            }
        });
    });
    router.post(eventPath + '/subscribe', function (req, res) {
        var remoteAddress = req.connection.remoteAddress + ':' + req.connection.remotePort.toString();
        var data = req.body;
        var cep = { req: req, remoteAddress: remoteAddress, conn_id: data.conn_id, cmd: 'subscribe', data: data };
        router.eventEmitter.emit('client_cmd', cep);
        connectionsManager.addSubscription(req, data.conn_id, data.sub_id, data.destination, data.headers, function (err) {
            if (err) {
                res.jsonp({ exception: JSON.parse(JSON.stringify(err)) });
            }
            else {
                res.jsonp({});
            }
        });
    });
    router.get(eventPath + '/unsubscribe', function (req, res) {
        var remoteAddress = req.connection.remoteAddress + ':' + req.connection.remotePort.toString();
        var data = req.query;
        var cep = { req: req, remoteAddress: remoteAddress, conn_id: data.conn_id, cmd: 'unsubscribe', data: data };
        router.eventEmitter.emit('client_cmd', cep);
        connectionsManager.removeSubscription(req, data.conn_id, data.sub_id, function (err) {
            if (err) {
                res.jsonp({ exception: JSON.parse(JSON.stringify(err)) });
            }
            else {
                res.jsonp({});
            }
        });
    });
    router.post(eventPath + '/send', function (req, res) {
        var remoteAddress = req.connection.remoteAddress + ':' + req.connection.remotePort.toString();
        var data = req.body;
        var cep = { req: req, remoteAddress: remoteAddress, conn_id: data.conn_id, cmd: 'send', data: data };
        router.eventEmitter.emit('client_cmd', cep);
        connectionsManager.forwardMessage(req, data.conn_id, data.destination, data.headers, data.body, function (err) {
            if (err) {
                res.jsonp({ exception: JSON.parse(JSON.stringify(err)) });
            }
            else {
                res.jsonp({});
            }
        });
    });
    return router;
}
exports.getRouter = getRouter;
