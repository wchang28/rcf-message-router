"use strict";
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var rcf = require('rcf');
var events = require('events');
var alasql = require('alasql');
var TopicConnection = (function (_super) {
    __extends(TopicConnection, _super);
    function TopicConnection(conn_id, remoteAddress, cookie, messageCB, pingIntervalMS) {
        var _this = this;
        if (pingIntervalMS === void 0) { pingIntervalMS = 10000; }
        _super.call(this);
        this.pingIntervalMS = pingIntervalMS;
        this.conn_id = conn_id;
        this.remoteAddress = remoteAddress;
        this.cookie = cookie;
        this.eventEmitter = new events.EventEmitter();
        this.eventEmitter.on('message', messageCB);
        this.subscriptions = {};
        if (this.pingIntervalMS > 0) {
            this.pintInterval = setInterval(function () {
                var msg = {
                    headers: {
                        event: rcf.MessageEventType.PING
                    }
                };
                _this.eventEmitter.emit('message', msg);
            }, this.pingIntervalMS);
        }
        // emit a 'connected' message
        /////////////////////////////////////////////////////////
        var msg = {
            headers: {
                event: rcf.MessageEventType.CONNECT,
                conn_id: conn_id
            }
        };
        this.eventEmitter.emit('message', msg);
        /////////////////////////////////////////////////////////
    }
    TopicConnection.prototype.onChange = function (handler) {
        this.on('change', handler);
    };
    TopicConnection.prototype.forwardMessage = function (destination, headers, message, done) {
        for (var sub_id in this.subscriptions) {
            var subscription = this.subscriptions[sub_id];
            var pattern = new RegExp(subscription.destination, 'gi');
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
                if (subscription.headers && subscription.headers['selector'] && typeof subscription.headers['selector'] === 'string' && subscription.headers['selector'].length > 0) {
                    var selector = subscription.headers['selector'];
                    var msgHeaders = msg.headers;
                    var sql = "select * from ? where " + selector;
                    try {
                        var res = alasql(sql, [[msgHeaders]]);
                        if (res.length > 0)
                            this.eventEmitter.emit('message', msg);
                    }
                    catch (e) {
                        this.eventEmitter.emit('message', msg);
                    }
                }
                else
                    this.eventEmitter.emit('message', msg);
            }
        }
        if (typeof done === 'function')
            done(null);
    };
    TopicConnection.prototype.addSubscription = function (sub_id, destination, headers, done) {
        var subscription = {
            destination: destination,
            headers: headers
        };
        this.subscriptions[sub_id] = subscription;
        this.emit('change');
        if (typeof done === 'function')
            done(null);
    };
    TopicConnection.prototype.removeSubscription = function (sub_id, done) {
        delete this.subscriptions[sub_id];
        this.emit('change');
        if (typeof done === 'function')
            done(null);
    };
    TopicConnection.prototype.end = function () {
        if (this.pintInterval) {
            clearInterval(this.pintInterval);
            this.pintInterval = null;
            this.subscriptions = {};
            this.emit('change');
        }
    };
    TopicConnection.prototype.toJSON = function () {
        var o = {
            conn_id: this.conn_id,
            remoteAddress: this.remoteAddress,
            cookie: this.cookie,
            subscriptions: this.subscriptions
        };
        return o;
    };
    return TopicConnection;
}(events.EventEmitter));
exports.TopicConnection = TopicConnection;
