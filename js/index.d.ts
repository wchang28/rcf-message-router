/// <reference types="express" />
/// <reference types="node" />
import * as rcf from 'rcf';
import * as events from 'events';
import * as express from 'express';
export declare enum DestAuthMode {
    Subscribe = 0,
    SendMsg = 1,
}
export interface DestAuthRequest {
    conn_id: string;
    authMode: DestAuthMode;
    headers: {
        [field: string]: any;
    };
    destination: string;
    body: any;
    originalReq: express.Request;
    params?: {
        [fld: string]: string;
    };
}
export interface DestAuthResponse {
    reject: (err: any) => void;
    accept: () => void;
}
export interface DestAuthRouteHandler {
    (req: DestAuthRequest, res: DestAuthResponse): void;
}
export declare class DestinationAuthRouter {
    private mr;
    constructor();
    use(destPathPattern: string, handler: DestAuthRouteHandler): void;
    route(conn_id: string, destination: string, authMode: DestAuthMode, headers: {
        [field: string]: any;
    }, body: any, originalReq: express.Request, done: (err: any) => void): void;
}
export interface CookieSetter {
    (req: express.Request): any;
}
export interface Options {
    pingIntervalMS?: number;
    cookieSetter?: CookieSetter;
    dispatchMsgOnClientSend?: boolean;
    destinationAuthorizeRouter?: DestinationAuthRouter;
}
export declare class ConnectionsManager extends events.EventEmitter {
    private connCount;
    private __connections;
    static MSG_BAD_CONN: string;
    constructor();
    readonly ConnectionsCount: number;
    createConnection(remoteAddress: string, cookie: any, messageCB: rcf.MessageCallback, pingIntervalMS: number): string;
    validConnection(conn_id: string): boolean;
    removeConnection(conn_id: string): void;
    addSubscription(conn_id: string, sub_id: string, destination: string, headers: {
        [field: string]: any;
    }, done?: rcf.DoneHandler): void;
    removeSubscription(conn_id: string, sub_id: string, done?: rcf.DoneHandler): void;
    dispatchMessage(destination: string, headers: {
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
    cmd: "subscribe" | "unsubscribe" | "send";
    data: any;
}
export interface ClientSendMsgEventParams {
    req: express.Request;
    conn_id: string;
    data: {
        destination: string;
        headers: {
            [field: string]: any;
        };
        body: any;
    };
}
export declare function getRouter(eventPath: string, options?: Options): ISSETopicRouter;
