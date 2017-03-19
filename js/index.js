"use strict";
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var shortid_1 = require("shortid");
var events = require("events");
var express = require("express");
var bodyParser = require("body-parser");
var _ = require("lodash");
var topicConnection_1 = require("./topicConnection");
var defaultOptions = {
    connKeepAliveIntervalMS: 30000,
    connCookieMaker: null,
    dispatchMsgOnClientSend: true,
    destinationAuthorizeRouter: null
};
var DestAuthMode;
(function (DestAuthMode) {
    DestAuthMode[DestAuthMode["Subscribe"] = 0] = "Subscribe";
    DestAuthMode[DestAuthMode["SendMsg"] = 1] = "SendMsg";
})(DestAuthMode = exports.DestAuthMode || (exports.DestAuthMode = {}));
var authModeDescriptions = {};
authModeDescriptions[DestAuthMode.Subscribe] = "subscribe";
authModeDescriptions[DestAuthMode.SendMsg] = "send message";
;
;
function destAuth(handler) {
    return function (req, res, next) {
        var destAuthReq = req;
        var destAuthRes = res;
        handler(destAuthReq, destAuthRes, next);
    };
}
exports.destAuth = destAuth;
// this class emits the following events
// 1. change
// 2. client_connect (req, ITopicConnection)
// 3. client_disconnect (req, ITopicConnection)
// 4. client_cmd (req, ClientCommandType, conn_id, data)
// 5. on_client_send_msg (req, ITopicConnection, SendMsgParams)
// 6. sse_send (req, string)
var ConnectionsManager = (function (_super) {
    __extends(ConnectionsManager, _super);
    function ConnectionsManager(destAuthRouter) {
        if (destAuthRouter === void 0) { destAuthRouter = null; }
        var _this = _super.call(this) || this;
        _this.destAuthRouter = destAuthRouter;
        _this.__connCount = 0;
        _this.__connections = {};
        return _this;
    }
    Object.defineProperty(ConnectionsManager.prototype, "ConnectionsCount", {
        get: function () { return this.__connCount; },
        enumerable: true,
        configurable: true
    });
    ConnectionsManager.prototype.createConnection = function (socket, cookie, messageCB, connKeepAliveIntervallMS) {
        var _this = this;
        var conn_id = shortid_1.generate(); // generate a connection id;
        var conn = new topicConnection_1.TopicConnection(conn_id, socket, cookie, messageCB, connKeepAliveIntervallMS);
        this.__connections[conn_id] = conn;
        conn.on('change', function () {
            _this.emit('change');
        });
        this.__connCount++;
        this.emit('change');
        return conn;
    };
    ConnectionsManager.prototype.removeConnection = function (conn_id) {
        var conn = this.__connections[conn_id];
        if (conn) {
            conn.end();
            delete this.__connections[conn_id];
            this.__connCount--;
            this.emit('change');
        }
    };
    ConnectionsManager.prototype.getConn = function (conn_id) {
        if (this.__connections[conn_id])
            return this.__connections[conn_id];
        else
            throw ConnectionsManager.MSG_BAD_CONN;
    };
    ConnectionsManager.prototype.getConnection = function (conn_id) { return this.getConn(conn_id); };
    ConnectionsManager.prototype.findConnections = function (criteria) {
        var ret = [];
        for (var conn_id in this.__connections) {
            var conn = this.__connections[conn_id];
            if (criteria(conn))
                ret.push(conn);
        }
        return ret;
    };
    ConnectionsManager.prototype.addConnSubscription = function (conn_id, sub_id, destination, headers) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            if (!destination || destination.length == 0)
                reject(ConnectionsManager.MSG_BAD_DESTINATION);
            else {
                // remove trailing '/'
                ///////////////////////////////////////////////////////////////////////////////////////////////////////
                var c = destination.charAt(destination.length - 1);
                if (c == '/' && destination.length > 1)
                    destination = destination.substr(0, destination.length - 1);
                ///////////////////////////////////////////////////////////////////////////////////////////////////////
                _this.authorizeDestination(conn_id, DestAuthMode.Subscribe, destination, headers)
                    .then(function (conn) {
                    conn.addSubscription(sub_id, destination, headers);
                    resolve(conn);
                }).catch(function (err) {
                    reject(err);
                });
            }
            ;
        });
    };
    ConnectionsManager.prototype.removeConnSubscription = function (conn_id, sub_id) {
        this.getConn(conn_id).removeSubscription(sub_id);
    };
    ConnectionsManager.prototype.dispatchMessage = function (destination, headers, message) {
        for (var conn_id in this.__connections) {
            var conn = this.__connections[conn_id];
            conn.forwardMessage(destination, headers, message);
        }
    };
    ConnectionsManager.prototype.authorizeDestination = function (conn_id, authMode, destination, headers, body) {
        var _this = this;
        if (body === void 0) { body = null; }
        return new Promise(function (resolve, reject) {
            var conn = null;
            try {
                conn = _this.getConn(conn_id);
            }
            catch (e) {
                reject(e);
            }
            if (!_this.destAuthRouter)
                resolve(conn);
            else {
                var defaultRejectMsg_1 = 'not authorized to ' + authModeDescriptions[authMode] + ' on ' + destination;
                // construct artifical req and res objects for the express router to route
                ////////////////////////////////////////////////////////////////////////////////////////////
                var req = {
                    "method": (authMode === DestAuthMode.Subscribe ? "GET" : "POST"),
                    "authMode": authMode,
                    "destination": destination,
                    "headers": headers,
                    "url": destination,
                    "connection": conn,
                    "body": (body ? body : null)
                };
                var res_1 = {
                    '___err___': null,
                    '___result_set___': false,
                    'reject': function (err) {
                        //console.log("\n << reject() >> \n");
                        this.___err___ = err || defaultRejectMsg_1;
                        this.___result_set___ = true;
                        finalHandler_1();
                    },
                    'accept': function () {
                        //console.log("\n << accept() >> \n");
                        this.___err___ = null;
                        this.___result_set___ = true;
                        finalHandler_1();
                    },
                    'get_err': function () { return this.___err___; },
                    'result_set': function () { return this.___result_set___; }
                };
                ////////////////////////////////////////////////////////////////////////////////////////////
                var finalHandler_1 = function () {
                    //console.log("\n << finalHandler() >> \n");
                    if (res_1.result_set()) {
                        if (res_1.get_err())
                            reject(res_1.get_err());
                        else
                            resolve(conn);
                    }
                    else
                        reject(defaultRejectMsg_1);
                };
                _this.destAuthRouter(req, res_1, finalHandler_1); // route it               
            }
        });
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
ConnectionsManager.MSG_BAD_CONN = "bad connection";
ConnectionsManager.MSG_BAD_DESTINATION = "bad destination";
function get(eventPath, options) {
    options = options || defaultOptions;
    options = _.assignIn({}, defaultOptions, options);
    var connectionsManager = new ConnectionsManager(options.destinationAuthorizeRouter);
    var router = express.Router();
    router.use(bodyParser.json({ 'limit': '100mb' }));
    // server side events streaming
    router.get(eventPath, function (req, res) {
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
            connectionsManager.emit('sse_send', req, s);
        };
        res.write('\n');
        ///////////////////////////////////////////////////////////////////////
        // create a connection
        ///////////////////////////////////////////////////////////////////////
        var cookie = (options.connCookieMaker ? options.connCookieMaker(req) : null);
        var conn = connectionsManager.createConnection(req.connection, cookie, function (msg) {
            res.sseSend(msg);
        }, options.connKeepAliveIntervalMS);
        ///////////////////////////////////////////////////////////////////////
        // The 'close' event is fired when a user closes their browser window.
        req.on("close", function () {
            connectionsManager.removeConnection(conn.id);
            connectionsManager.emit('client_disconnect', req, conn); // fire the "client_disconnect" event
        });
        connectionsManager.emit('client_connect', req, conn); // fire the "client_connect" event
    });
    router.post(eventPath + '/subscribe', function (req, res) {
        var data = req.body;
        connectionsManager.emit('client_cmd', req, 'subscribe', data.conn_id, data);
        connectionsManager.addConnSubscription(data.conn_id, data.sub_id, data.destination, data.headers)
            .then(function () {
            res.jsonp({});
        }).catch(function (err) {
            res.status(403).json({ exception: JSON.parse(JSON.stringify(err)) });
        });
    });
    router.get(eventPath + '/unsubscribe', function (req, res) {
        var data = req.query;
        connectionsManager.emit('client_cmd', req, 'unsubscribe', data.conn_id, data);
        try {
            connectionsManager.removeConnSubscription(data.conn_id, data.sub_id);
            res.jsonp({});
        }
        catch (e) {
            res.status(400).json({ exception: JSON.parse(JSON.stringify(e)) });
        }
    });
    router.post(eventPath + '/send', function (req, res) {
        var data = req.body;
        connectionsManager.emit('client_cmd', req, 'send', data.conn_id, data);
        connectionsManager.authorizeDestination(data.conn_id, DestAuthMode.SendMsg, data.destination, data.headers, data.body)
            .then(function (connection) {
            connectionsManager.emit('on_client_send_msg', req, connection, { destination: data.destination, headers: data.headers, body: data.body });
            if (options.dispatchMsgOnClientSend)
                connectionsManager.dispatchMessage(data.destination, data.headers, data.body);
            res.jsonp({});
        }).catch(function (err) {
            res.status(403).json({ exception: JSON.parse(JSON.stringify(err)) });
        });
    });
    return { router: router, connectionsManager: connectionsManager };
}
exports.get = get;
