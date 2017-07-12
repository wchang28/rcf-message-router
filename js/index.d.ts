/// <reference types="express" />
import * as express from 'express';
import { ITopicConnection, Subscription, ITopicConnectionJSON } from './topicConnection';
export { ITopicConnection, Subscription, ITopicConnectionJSON };
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
    connection: ITopicConnection;
    headers: {
        [field: string]: any;
    };
    originalUrl: string;
    url: string;
    baseUrl: string;
    body: any;
    params: any;
    query: any;
    route: any;
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
    findConnections: (criteria?: (conn: ITopicConnection) => boolean) => ITopicConnection[];
    dispatchMessage: (destination: string, headers: {
        [field: string]: any;
    }, message: any) => void;
    toJSON: () => ITopicConnectionJSON[];
    on(event: "change", listener: () => void): this;
    on(event: "client_connect", listener: (req: express.Request, conn: ITopicConnection) => void): this;
    on(event: "client_disconnect", listener: (req: express.Request, conn: ITopicConnection) => void): this;
    on(event: "client_cmd", listener: (req: express.Request, cmdType: ClientCommandType, conn_id: string, data: any) => void): this;
    on(event: "on_client_send_msg", listener: (req: express.Request, conn: ITopicConnection, sendParams: SendMsgParams) => void): this;
    on(event: "sse_send", listener: (req: express.Request, s: string) => void): this;
}
export declare type ClientCommandType = "subscribe" | "unsubscribe" | "send";
export interface SendMsgParams {
    destination: string;
    headers: {
        [field: string]: any;
    };
    body: any;
}
export interface IMsgRouterReturn {
    router: express.Router;
    connectionsManager: IConnectionsManager;
}
export declare function get(eventPath?: string, options?: Options): IMsgRouterReturn;
