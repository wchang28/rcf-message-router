/// <reference types="node" />
/// <reference types="express" />
import * as rcf from 'rcf';
import * as events from 'events';
import * as express from 'express';
export interface IConnectionCreatedHandler {
    (err: any, conn_id: string): void;
}
export declare class ConnectionsManager extends events.EventEmitter {
    private connCount;
    private __connections;
    constructor();
    getConnectionsCount(): number;
    createConnection(req: express.Request, connectionFactory: rcf.MsgConnFactory, remoteAddress: string, messageCB: rcf.MessageCallback, done: IConnectionCreatedHandler): void;
    removeConnection(conn_id: string): void;
    addSubscription(req: express.Request, conn_id: string, sub_id: string, destination: string, headers: {
        [field: string]: any;
    }, done?: rcf.DoneHandler): void;
    removeSubscription(req: express.Request, conn_id: string, sub_id: string, done?: rcf.DoneHandler): void;
    private forwardMessageImpl(req, srcConn, destination, headers, message, done?);
    forwardMessage(req: express.Request, conn_id: string, destination: string, headers: {
        [field: string]: any;
    }, message: any, done?: rcf.DoneHandler): void;
    injectMessage(destination: string, headers: {
        [field: string]: any;
    }, message: any, done?: rcf.DoneHandler): void;
    toJSON(): Object;
}
export interface ISSETopicRouter extends express.Router {
    connectionsManager: ConnectionsManager;
    eventEmitter: events.EventEmitter;
}
export interface EventParams {
    req: express.Request;
    remoteAddress: string;
}
export interface ConnectedEventParams extends EventParams {
    conn_id: string;
}
export interface CommandEventParams extends ConnectedEventParams {
    cmd: string;
    data: any;
}
export declare function getRouter(eventPath: string, connectionFactory: rcf.MsgConnFactory): ISSETopicRouter;
