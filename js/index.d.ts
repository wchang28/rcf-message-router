/// <reference types="node" />
/// <reference types="express" />
import * as rcf from 'rcf';
import * as events from 'events';
import * as express from 'express';
export interface CookieSetter {
    (req: any): any;
}
export interface Options {
    pingIntervalMS?: number;
    cookieSetter?: CookieSetter;
}
export declare class ConnectionsManager extends events.EventEmitter {
    private connCount;
    private __connections;
    constructor();
    readonly ConnectionsCount: number;
    createConnection(remoteAddress: string, cookie: any, messageCB: rcf.MessageCallback, pingIntervalMS: number): string;
    removeConnection(conn_id: string): void;
    addSubscription(conn_id: string, sub_id: string, destination: string, headers: {
        [field: string]: any;
    }, done?: rcf.DoneHandler): void;
    removeSubscription(conn_id: string, sub_id: string, done?: rcf.DoneHandler): void;
    injectMessage(destination: string, headers: {
        [field: string]: any;
    }, message: any, done?: rcf.DoneHandler): void;
    forwardMessage(conn_id: string, destination: string, headers: {
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
export declare function getRouter(eventPath: string, options?: Options): ISSETopicRouter;
