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
var _ = require('lodash');
var topicConnection_1 = require('./topicConnection');
var defaultOptions = {
    pingIntervalMS: 10000,
    dispatchMsgOnClientSend: true
};
// this class emits the following events
// 1. change
var ConnectionsManager = (function (_super) {
    __extends(ConnectionsManager, _super);
    function ConnectionsManager() {
        _super.call(this);
        this.connCount = 0;
        this.__connections = {};
    }
    Object.defineProperty(ConnectionsManager.prototype, "ConnectionsCount", {
        get: function () { return this.connCount; },
        enumerable: true,
        configurable: true
    });
    ConnectionsManager.prototype.createConnection = function (remoteAddress, cookie, messageCB, pingIntervalMS) {
        var _this = this;
        var conn_id = uuid.v4();
        var conn = new topicConnection_1.TopicConnection(conn_id, remoteAddress, cookie, messageCB, pingIntervalMS);
        this.__connections[conn_id] = conn;
        conn.onChange(function () {
            _this.emit('change');
        });
        this.connCount++;
        this.emit('change');
        return conn_id;
    };
    ConnectionsManager.prototype.validConnection = function (conn_id) {
        var conn = this.__connections[conn_id];
        return (conn ? true : false);
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
    ConnectionsManager.prototype.addSubscription = function (conn_id, sub_id, destination, headers, done) {
        var conn = this.__connections[conn_id];
        if (conn) {
            conn.addSubscription(sub_id, destination, headers, done);
        }
        else {
            if (typeof done === 'function')
                done(ConnectionsManager.MSG_BAD_CONN);
        }
    };
    ConnectionsManager.prototype.removeSubscription = function (conn_id, sub_id, done) {
        var conn = this.__connections[conn_id];
        if (conn) {
            conn.removeSubscription(sub_id, done);
        }
        else {
            if (typeof done === 'function')
                done(ConnectionsManager.MSG_BAD_CONN);
        }
    };
    ConnectionsManager.prototype.dispatchMessage = function (destination, headers, message, done) {
        var left = this.connCount;
        var errs = [];
        for (var id in this.__connections) {
            var conn = this.__connections[id];
            conn.forwardMessage(destination, headers, message, function (err) {
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
    ConnectionsManager.prototype.toJSON = function () {
        var ret = [];
        for (var conn_id in this.__connections) {
            var conn = this.__connections[conn_id];
            ret.push(conn.toJSON());
        }
        return ret;
    };
    ConnectionsManager.MSG_BAD_CONN = "bad connection";
    return ConnectionsManager;
}(events.EventEmitter));
exports.ConnectionsManager = ConnectionsManager;
function getRemoteAddress(req) {
    return req.connection.remoteAddress + ':' + req.connection.remotePort.toString();
}
(function (DestAuthMode) {
    DestAuthMode[DestAuthMode["Subscribe"] = 0] = "Subscribe";
    DestAuthMode[DestAuthMode["SendMsg"] = 1] = "SendMsg";
})(exports.DestAuthMode || (exports.DestAuthMode = {}));
var DestAuthMode = exports.DestAuthMode;
;
;
;
function getDestinationAuthReqRes(req, res) {
    var authReq = req;
    var authRes = res;
    return { authReq: authReq, authRes: authRes };
}
exports.getDestinationAuthReqRes = getDestinationAuthReqRes;
function authorizeDestination(authApp, authMode, conn_id, destination, headers, body, originalReq, done) {
    if (authApp) {
        // construct artifical req and res objects for the destination auth. express app to route
        //////////////////////////////////////////////////////////////////////////////////////////
        var req = {
            "method": (authMode == DestAuthMode.Subscribe ? "GET" : "POST"),
            "conn_id": conn_id,
            "authMode": authMode,
            "headers": headers,
            "url": destination,
            "originalReq": (originalReq ? originalReq : null),
            "body": (body ? body : null),
            "toJSON": function () {
                return {
                    "method": this.method,
                    "conn_id": this.conn_id,
                    "authMode": this.authMode,
                    "headers": this.headers,
                    "originalUrl": this.originalUrl,
                    "url": this.destination,
                    "path": this.path,
                    "body": this.body,
                    "params": this.params,
                    "query": this.query
                };
            }
        };
        var res = {
            'setHeader': function (fld, value) { },
            'reject': done,
            'accept': function () { done(null); }
        };
        //////////////////////////////////////////////////////////////////////////////////////////
        var finalHandler = function () {
            done("destination not authorized");
        };
        authApp(req, res, finalHandler); // route it
    }
    else {
        done(null);
    }
}
// router.eventEmitter emit the following events
// 1. sse_connect (EventParams)
// 2. sse_disconnect (EventParams)
// 3. client_connect (ConnectedEventParams)
// 4. client_disconnect (ConnectedEventParams)
// 5. client_cmd (CommandEventParams)
// 6. on_client_send_msg (ClientSendMsgEventParams)
function getRouter(eventPath, options) {
    options = options || defaultOptions;
    options = _.assignIn({}, defaultOptions, options);
    var router = express.Router();
    router.use(bodyParser.json({ 'limit': '100mb' }));
    var connectionsManager = new ConnectionsManager();
    router.connectionsManager = connectionsManager;
    router.eventEmitter = new events.EventEmitter();
    // server side events streaming
    router.get(eventPath, function (req, res) {
        var cookie = (options.cookieSetter ? options.cookieSetter(req) : null);
        var remoteAddress = getRemoteAddress(req);
        var ep = { req: req, remoteAddress: remoteAddress };
        router.eventEmitter.emit('sse_connect', ep); // fire the "sse_connect" event
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
        // create a connection
        ///////////////////////////////////////////////////////////////////////
        var conn_id = connectionsManager.createConnection(remoteAddress, cookie, function (msg) {
            res.sseSend(msg);
        }, options.pingIntervalMS);
        ///////////////////////////////////////////////////////////////////////
        var cep = { req: req, remoteAddress: remoteAddress, conn_id: conn_id };
        router.eventEmitter.emit('client_connect', cep); // fire the "client_connect" event
        // The 'close' event is fired when a user closes their browser window.
        req.on("close", function () {
            router.eventEmitter.emit('sse_disconnect', ep); // fire the "sse_disconnect" event
            if (conn_id.length > 0) {
                connectionsManager.removeConnection(conn_id);
                router.eventEmitter.emit('client_disconnect', cep); // fire the "client_disconnect" event
            }
        });
    });
    router.post(eventPath + '/subscribe', function (req, res) {
        var remoteAddress = getRemoteAddress(req);
        var data = req.body;
        var cep = { req: req, remoteAddress: remoteAddress, conn_id: data.conn_id, cmd: 'subscribe', data: data };
        router.eventEmitter.emit('client_cmd', cep);
        authorizeDestination(options.destinationAuthorizeApp, DestAuthMode.Subscribe, data.conn_id, data.destination, data.headers, null, req, function (err) {
            if (err)
                res.status(403).json({ exception: JSON.parse(JSON.stringify(err)) });
            else {
                connectionsManager.addSubscription(data.conn_id, data.sub_id, data.destination, data.headers, function (err) {
                    if (err)
                        res.status(400).json({ exception: JSON.parse(JSON.stringify(err)) });
                    else
                        res.jsonp({});
                });
            }
        });
    });
    router.get(eventPath + '/unsubscribe', function (req, res) {
        var remoteAddress = getRemoteAddress(req);
        var data = req.query;
        var cep = { req: req, remoteAddress: remoteAddress, conn_id: data.conn_id, cmd: 'unsubscribe', data: data };
        router.eventEmitter.emit('client_cmd', cep);
        connectionsManager.removeSubscription(data.conn_id, data.sub_id, function (err) {
            if (err)
                res.status(400).json({ exception: JSON.parse(JSON.stringify(err)) });
            else
                res.jsonp({});
        });
    });
    router.post(eventPath + '/send', function (req, res) {
        var remoteAddress = getRemoteAddress(req);
        var data = req.body;
        var cep = { req: req, remoteAddress: remoteAddress, conn_id: data.conn_id, cmd: 'send', data: data };
        router.eventEmitter.emit('client_cmd', cep);
        if (connectionsManager.validConnection(data.conn_id)) {
            authorizeDestination(options.destinationAuthorizeApp, DestAuthMode.SendMsg, data.conn_id, data.destination, data.headers, data.body, req, function (err) {
                if (err)
                    res.status(403).json({ exception: JSON.parse(JSON.stringify(err)) });
                else {
                    var ev = { req: req, conn_id: data.conn_id, destination: data.destination, headers: data.headers, body: data.body };
                    router.eventEmitter.emit('on_client_send_msg', ev);
                    if (options.dispatchMsgOnClientSend) {
                        connectionsManager.dispatchMessage(data.destination, data.headers, data.body, function (err) {
                            if (err)
                                res.status(400).json({ exception: JSON.parse(JSON.stringify(err)) });
                            else
                                res.jsonp({});
                        });
                    }
                    else
                        res.jsonp({});
                }
            });
        }
        else {
            res.status(400).json({ exception: ConnectionsManager.MSG_BAD_CONN });
        }
    });
    return router;
}
exports.getRouter = getRouter;
