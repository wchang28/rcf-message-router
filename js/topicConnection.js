"use strict";
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var rcf = require("rcf");
var events = require("events");
var _ = require("lodash");
var alasql = require('alasql');
// this class emits the following events
// 1. change
// 2. message
var TopicConnection = (function (_super) {
    __extends(TopicConnection, _super);
    function TopicConnection(conn_id, socket, cookie, messageCB, keepAliveIntervalMS) {
        if (keepAliveIntervalMS === void 0) { keepAliveIntervalMS = 30000; }
        var _this = _super.call(this) || this;
        _this.i = conn_id;
        _this.s = socket;
        _this.k = cookie;
        _this.on('message', messageCB);
        _this.u = {};
        if (typeof keepAliveIntervalMS === 'number' && keepAliveIntervalMS > 0) {
            _this.a = setInterval(function () {
                // emit a keep-alive ping message on the connection
                /////////////////////////////////////////////////////
                var msg = {
                    headers: {
                        event: rcf.MessageEventType.PING
                    }
                };
                _this.emitMessage(msg);
                /////////////////////////////////////////////////////
            }, keepAliveIntervalMS);
        }
        else {
            _this.a = null;
        }
        // emit a 'connected' message on the connection
        /////////////////////////////////////////////////////////
        var msg = {
            headers: {
                event: rcf.MessageEventType.CONNECT,
                conn_id: conn_id
            }
        };
        _this.emitMessage(msg);
        return _this;
        /////////////////////////////////////////////////////////
    }
    TopicConnection.prototype.triggerChangeEvent = function () { this.emit('change'); };
    TopicConnection.prototype.emitMessage = function (msg) { this.emit('message', msg); };
    TopicConnection.prototype.forwardMessage = function (destination, headers, message) {
        for (var sub_id in this.u) {
            var subscription = this.u[sub_id];
            var pattern = new RegExp(subscription.dest, 'gi');
            if (destination.match(pattern)) {
                var msg = {
                    headers: {
                        event: rcf.MessageEventType.MESSAGE,
                        sub_id: sub_id,
                        destination: destination
                    },
                    body: message
                };
                if (headers) {
                    for (var field in headers) {
                        if (!msg.headers[field])
                            msg.headers[field] = headers[field];
                    }
                }
                if (subscription.hdrs && subscription.hdrs['selector'] && typeof subscription.hdrs['selector'] === 'string' && subscription.hdrs['selector'].length > 0) {
                    var selector = subscription.hdrs['selector'];
                    var msgHeaders = msg.headers;
                    var sql = "select * from ? where " + selector;
                    try {
                        var res = alasql(sql, [[msgHeaders]]);
                        if (res.length > 0)
                            this.emitMessage(msg);
                    }
                    catch (e) {
                        this.emitMessage(msg);
                    }
                }
                else
                    this.emitMessage(msg);
            }
        }
    };
    Object.defineProperty(TopicConnection.prototype, "subscriptions", {
        get: function () { return _.cloneDeep(this.u); },
        enumerable: true,
        configurable: true
    });
    TopicConnection.prototype.addSubscription = function (sub_id, destination, headers) {
        var subscription = {
            dest: destination,
            hdrs: headers
        };
        this.u[sub_id] = subscription;
        this.triggerChangeEvent();
    };
    TopicConnection.prototype.removeSubscription = function (sub_id) {
        if (this.u[sub_id]) {
            delete this.u[sub_id];
            this.triggerChangeEvent();
        }
        else {
            throw "bad subscription id";
        }
    };
    TopicConnection.prototype.end = function () {
        if (this.a) {
            clearInterval(this.a);
            this.a = null;
            this.u = {};
            this.triggerChangeEvent();
        }
    };
    Object.defineProperty(TopicConnection.prototype, "id", {
        get: function () { return this.i; },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(TopicConnection.prototype, "cookie", {
        get: function () { return this.k; },
        set: function (value) {
            if (value !== this.k) {
                this.k = value;
                this.triggerChangeEvent();
            }
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(TopicConnection.prototype, "remoteAddress", {
        get: function () { return this.s.remoteAddress; },
        enumerable: true,
        configurable: true
    });
    ;
    Object.defineProperty(TopicConnection.prototype, "remotePort", {
        get: function () { return this.s.remotePort; },
        enumerable: true,
        configurable: true
    });
    ;
    Object.defineProperty(TopicConnection.prototype, "remoteFamily", {
        get: function () { return this.s.remoteFamily; },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(TopicConnection.prototype, "localAddress", {
        get: function () { return this.s.localAddress; },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(TopicConnection.prototype, "localPort", {
        get: function () { return this.s.localPort; },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(TopicConnection.prototype, "bytesRead", {
        get: function () { return this.s.bytesRead; },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(TopicConnection.prototype, "bytesWritten", {
        get: function () { return this.s.bytesWritten; },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(TopicConnection.prototype, "destroyed", {
        get: function () { return this.s.destroyed; },
        enumerable: true,
        configurable: true
    });
    TopicConnection.prototype.destroy = function () { this.s.destroy; };
    TopicConnection.prototype.toJSON = function () {
        var o = {
            id: this.id,
            remoteAddress: this.remoteAddress,
            remotePort: this.remotePort,
            cookie: this.cookie,
            subscriptions: this.subscriptions
        };
        return o;
    };
    return TopicConnection;
}(events.EventEmitter));
exports.TopicConnection = TopicConnection;
