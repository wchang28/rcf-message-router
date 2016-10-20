/// <reference types="express" />
/// <reference types="node" />
import * as rcf from 'rcf';
import * as events from 'events';
import * as express from 'express';
export interface CookieSetter {
    (req: express.Request): any;
}
export interface Options {
    pingIntervalMS?: number;
    cookieSetter?: CookieSetter;
    dispatchMsgOnClientSend?: boolean;
    destinationAuthorizeApp?: express.Express;
}
export declare class ConnectionsManager extends events.EventEmitter {
    private connCount;
    private __connections;
    private static MSG_BAD_CONN;
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
    cmd: "subscribe" | "unsubscribe" | "send";
    data: any;
}
export interface ClientSendMsgEventParams {
    destination: string;
    headers: {
        [field: string]: any;
    };
    body: any;
}
export declare enum DestAuthMode {
    Subscribe = 0,
    SendMsg = 1,
}
export interface IDestAuthRequest {
    authMode: DestAuthMode;
    headers: {
        [field: string]: any;
    };
    url: string;
    path: string;
    originalReq: express.Request;
}
export interface IDestAuthResponse {
    reject: (err: any) => void;
    accept: () => void;
}
export interface IDestAuthReqRes {
    authReq: IDestAuthRequest;
    authRes: IDestAuthResponse;
}
export declare function getDestinationAuthReqRes(req: express.Request, res: express.Response): IDestAuthReqRes;
export declare function getRouter(eventPath: string, options?: Options): ISSETopicRouter;
