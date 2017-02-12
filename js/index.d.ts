/// <reference types="express" />
import * as express from 'express';
import { ITopicConnection, Subscription } from './topicConnection';
export { ITopicConnection, Subscription };
export interface CookieMaker {
    (req: express.Request): any;
}
export interface Options {
    connKeepAliveIntervalMS?: number;
    connCookieMaker?: CookieMaker;
    dispatchMsgOnClientSend?: boolean;
    destinationAuthorizeRouter?: express.Router;
}
export declare enum DestAuthMode {
    Subscribe = 0,
    SendMsg = 1,
}
export interface DestAuthRequest {
    method: string;
    authMode: DestAuthMode;
    destination: string;
    headers: {
        [field: string]: any;
    };
    originalUrl: string;
    url: string;
    body: any;
    params: any;
    query: any;
    connection: ITopicConnection;
}
export interface DestAuthResponse {
    reject: (err?: any) => void;
    accept: () => void;
}
export interface DestAuthRequestHandler {
    (req: DestAuthRequest, res: DestAuthResponse, next: express.NextFunction): void;
}
export declare function destAuth(handler: DestAuthRequestHandler): express.RequestHandler;
export interface IConnectionsManager {
    readonly ConnectionsCount: number;
    getConnection: (conn_id: string) => ITopicConnection;
    findConnections: (criteria: (conn: ITopicConnection) => boolean) => ITopicConnection[];
    dispatchMessage: (destination: string, headers: {
        [field: string]: any;
    }, message: any) => void;
    on: (event: string, listener: Function) => this;
    toJSON: () => Object;
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
export interface IMsgRouterReturn {
    router: express.Router;
    connectionsManager: IConnectionsManager;
}
export declare function get(eventPath: string, options?: Options): IMsgRouterReturn;
