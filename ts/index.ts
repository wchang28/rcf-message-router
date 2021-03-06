import * as rcf from 'rcf';
import {generate} from 'shortid';
import * as events from 'events';
import * as express from 'express';
import * as bodyParser from 'body-parser';
import * as _ from 'lodash';
import {Socket} from 'net';
import {ITopicConnection, TopicConnection, Subscription, ITopicConnectionJSON} from './topicConnection';
export {ITopicConnection, Subscription, ITopicConnectionJSON};

export interface CookieMaker {
    (req: express.Request): any;
}

export interface Options {
    connKeepAliveIntervalMS?: number;                   // keep alive message interval im ms for the connection
    connCookieMaker?: CookieMaker;                      // custom cookie maker for the connection
    dispatchMsgOnClientSend?: boolean;                  // dispatch messages when client send messages
    destinationAuthorizeRouter?: express.Router;        // message subscription/send authorization router (based on message destination path)
}

let defaultOptions: Options = {
    connKeepAliveIntervalMS: 30000
    ,connCookieMaker: null
    ,dispatchMsgOnClientSend: true
    ,destinationAuthorizeRouter: null
};

export enum DestAuthMode {
    Subscribe = 0
    ,SendMsg = 1
}

let authModeDescriptions: {[mode:number]:string} = {};
authModeDescriptions[DestAuthMode.Subscribe] = "subscribe";
authModeDescriptions[DestAuthMode.SendMsg] = "send message";

export interface DestAuthRequest {
    method: string;
    authMode: DestAuthMode;
    destination: string;
    connection: ITopicConnection;
    headers:{[field: string]: any};
    originalUrl: string;
    url: string;
    baseUrl: string;
    body: any;
    params: any;
    query: any;
    route: any
};

export interface DestAuthResponse {
    reject: (err?: any) => void;
    accept: () => void;
};

export interface DestAuthRequestHandler {
    (req: DestAuthRequest, res: DestAuthResponse, next: express.NextFunction): void;
}

export function destAuth(handler: DestAuthRequestHandler) : express.RequestHandler {
    return (req: express.Request, res: express.Response, next: express.NextFunction) => {
        let destAuthReq:any = req;
        let destAuthRes:any = res;
        handler(destAuthReq, destAuthRes, next);
    }
}

export interface IConnectionsManager {
    readonly ConnectionsCount: number;
    getConnection: (conn_id: string) => ITopicConnection;
    findConnections: (criteria?: (conn: ITopicConnection) => boolean) => ITopicConnection[];
    dispatchMessage: (destination: string, headers: {[field: string]:any}, message:any) => void;
    toJSON: () => ITopicConnectionJSON[];
    on(event: "change", listener: () => void) : this;
    on(event: "client_connect", listener: (req: express.Request, conn: ITopicConnection, lastEventId?: string) => void) : this;
    on(event: "client_disconnect", listener: (req: express.Request, conn: ITopicConnection) => void) : this;
    on(event: "client_cmd", listener: (req: express.Request, cmdType: ClientCommandType, conn_id: string, data: any) => void) : this;
    on(event: "on_client_send_msg", listener: (req: express.Request, conn: ITopicConnection, sendParams: SendMsgParams) => void) : this;
    on(event: "sse_send", listener: (req: express.Request, s: string) => void) : this;
}

// this class emits the following events
// 1. change ()
// 2. client_connect (req: express.Request, conn: ITopicConnection, lastEventId?: string)
// 3. client_disconnect (req: express.Request, conn: ITopicConnection)
// 4. client_cmd (req: express.Request, cmdType: ClientCommandType, conn_id: string, data: any)
// 5. on_client_send_msg (req: express.Request, conn: ITopicConnection, SendMsgParams)
// 6. sse_send (req: express.Request, s: string)
class ConnectionsManager extends events.EventEmitter implements IConnectionsManager {
    private __connCount: number;
    private __connections : {[conn_id: string]: TopicConnection;}
    private static MSG_BAD_CONN = "bad connection";
    private static MSG_BAD_DESTINATION = "bad destination";
    constructor(private destAuthRouter: express.Router = null) {
        super();
        this.__connCount = 0;
        this.__connections = {};
    }
    get ConnectionsCount() : number { return this.__connCount;}
    createConnection(socket: Socket, cookie: any, messageCB: rcf.MessageCallback, connKeepAliveIntervallMS: number) : TopicConnection {
        let conn_id = generate();    // generate a connection id;
        let conn = new TopicConnection(conn_id, socket, cookie, messageCB, connKeepAliveIntervallMS);
        this.__connections[conn_id] = conn;
        conn.on('change', () => {
            this.emit('change');
        });
        this.__connCount++;
        this.emit('change');
        return conn;
    }
    removeConnection(conn_id: string) : void {
        let conn = this.__connections[conn_id];
        if (conn) {
            conn.end();
            delete this.__connections[conn_id];
            this.__connCount--;
            this.emit('change');
        }     
    }
    protected getConn(conn_id: string) : TopicConnection {   // might throws exception
        if (this.__connections[conn_id])
            return this.__connections[conn_id];
        else
            throw ConnectionsManager.MSG_BAD_CONN;
    }
    getConnection(conn_id: string) : ITopicConnection /* might throws exception */ { return this.getConn(conn_id);}
    findConnections(criteria?: (conn: ITopicConnection) => boolean) : ITopicConnection[] {
        let ret: ITopicConnection[] = [];
        for (let conn_id in this.__connections) {    // for each connection
            let conn = this.__connections[conn_id];
            if (!criteria || criteria(conn))
                ret.push(conn);
        }
        return ret;
    }
    addConnSubscription(conn_id: string, sub_id: string, destination: string, headers: {[field: string]: any}) : Promise<TopicConnection> {
        return new Promise<TopicConnection>((resolve: (value: TopicConnection) => void, reject: (err: any) => void) => {
            if (!destination || destination.length == 0)
                reject(ConnectionsManager.MSG_BAD_DESTINATION);
            else {
                // remove trailing '/'
                ///////////////////////////////////////////////////////////////////////////////////////////////////////
                let c = destination.charAt(destination.length-1);
                if (c == '/' && destination.length > 1) destination = destination.substr(0, destination.length - 1);
                ///////////////////////////////////////////////////////////////////////////////////////////////////////
                this.authorizeDestination(conn_id, DestAuthMode.Subscribe, destination, headers)
                .then((conn: TopicConnection) => {
                    conn.addSubscription(sub_id, destination, headers);
                    resolve(conn);
                }).catch((err: any) => {
                    reject(err);
                });
            };
        });
    }
    removeConnSubscription(conn_id: string, sub_id:string) : void {   // might throws exception
        this.getConn(conn_id).removeSubscription(sub_id);
    }
    dispatchMessage(destination: string, headers: {[field: string]:any}, message:any) : void {
        for (let conn_id in this.__connections) {    // for each connection
            let conn = this.__connections[conn_id];
            conn.forwardMessage(destination, headers, message);
        }
    }
    authorizeDestination(conn_id: string, authMode: DestAuthMode, destination: string, headers: {[field: string]: any}, body: any = null) : Promise<TopicConnection> {
        return new Promise<any>((resolve: (value:any) => void, reject: (err:any) => void) => {
            let conn = null;
            try {
                conn = this.getConn(conn_id)
            } catch(e) {
                reject(e);
            }
            if (!this.destAuthRouter)
                resolve(conn);
            else {
                let defaultRejectMsg = 'not authorized to ' + authModeDescriptions[authMode] + ' on ' + destination;
                // construct artificial req and res objects for the express router to route
                ////////////////////////////////////////////////////////////////////////////////////////////
                let req:any = {
                    "method": (authMode === DestAuthMode.Subscribe ? "GET" : "POST")
                    ,"authMode": authMode
                    ,"destination": destination
                    ,"headers": headers
                    ,"url": destination
                    ,"connection": conn
                    ,"body": (body ? body : null)
                };
                let res:any = {
                    '___err___': null
                    ,'___result_set___': false
                    ,'reject': function (err?) {
                        //console.log("\n << reject() >> \n");
                        this.___err___ = err || defaultRejectMsg;
                        this.___result_set___ = true;
                        finalHandler();
                    }
                    ,'accept': function () {
                        //console.log("\n << accept() >> \n");
                        this.___err___ = null;
                        this.___result_set___ = true;
                        finalHandler();
                    }
                    ,'get_err': function() {return this.___err___;}
                    ,'result_set': function() {return this.___result_set___;}
                };
                ////////////////////////////////////////////////////////////////////////////////////////////
                let finalHandler = () => {
                    //console.log("\n << finalHandler() >> \n");
                    if (res.result_set()) {
                        if (res.get_err())
                            reject(res.get_err());
                        else
                            resolve(conn);
                    } else
                        reject(defaultRejectMsg);
                }
                this.destAuthRouter(req, res, finalHandler);    // route it               
            }
        });
    }
    toJSON() : ITopicConnectionJSON[] {
        let ret: ITopicConnectionJSON[] = [];
        for (let conn_id in this.__connections) {    // for each connection
            let conn = this.__connections[conn_id];
            ret.push(conn.toJSON());
        }
        return ret;
    }
}

interface SSEResponse extends express.Response {
    sseSend: (msg:any, event?: string, id?: string) => void;
}

export type ClientCommandType = "subscribe" | "unsubscribe" | "send";

export interface SendMsgParams {
    destination: string;
    headers: {[field: string]: any};
    body: any;
}

export interface IMsgRouterReturn {
    router: express.Router;
    connectionsManager: IConnectionsManager;
}

function appendPath(path_1: string, path_2: string) : string {
    if (!path_1 || path_1 === "/")
        return path_2;
    else
        return path_1 + path_2;
}

export function get(eventPath?: string, options?: Options) : IMsgRouterReturn {
    if (!eventPath) eventPath = "/";
    options = options || defaultOptions;
    options = _.assignIn({}, defaultOptions, options);
    
    let connectionsManager = new ConnectionsManager(options.destinationAuthorizeRouter);
    let router = express.Router();
    router.use(bodyParser.json({'limit': '100mb'}));

    // server side events streaming
    router.get(eventPath, (req: express.Request, res: SSEResponse) => {
        // init SSE
        ///////////////////////////////////////////////////////////////////////
        //send headers for event-stream connection
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });
        // add a sseSend() method to the result object
        res.sseSend = (data: any, event?: string, id?: string) => {
            let s = "";
            if (event) s += "event: " + event.toString() + "\n";
            if (id) s += "id: " + id.toString() + "\n";
            s+= "data: " + JSON.stringify(data) + "\n\n";
            res.write(s);
            connectionsManager.emit('sse_send', req, s);
        }
        res.write('\n');
        ///////////////////////////////////////////////////////////////////////
		
        // create a connection
        ///////////////////////////////////////////////////////////////////////
        let cookie = (options.connCookieMaker ? options.connCookieMaker(req) : null);
        let conn = connectionsManager.createConnection(req.connection, cookie, (msg: rcf.IMessage) => {
            res.sseSend(msg);
        }, options.connKeepAliveIntervalMS);
        ///////////////////////////////////////////////////////////////////////

        // The 'close' event is fired when a user closes their browser window.
        /*
        req.on("close", () => {
            connectionsManager.removeConnection(conn.id);
            connectionsManager.emit('client_disconnect', req, conn); // fire the "client_disconnect" event
        });
        */
        res.on("close", () => {
            connectionsManager.removeConnection(conn.id);
            connectionsManager.emit('client_disconnect', req, conn); // fire the "client_disconnect" event
        });

        connectionsManager.emit('client_connect', req, conn, req.headers["last-event-id"]);    // fire the "client_connect" event
    });
    
    router.post(appendPath(eventPath, '/subscribe'), (req: express.Request, res: express.Response) => {
        let data = req.body;
        connectionsManager.emit('client_cmd', req, 'subscribe', data.conn_id, data);
        connectionsManager.addConnSubscription(data.conn_id, data.sub_id, data.destination, data.headers)
        .then(() => {
            res.jsonp({});
        }).catch((err:any) => {
            res.status(403).json({exception: JSON.parse(JSON.stringify(err))});
        });
    });

    router.get(appendPath(eventPath, '/unsubscribe'), (req: express.Request, res: express.Response) => {
        let data = req.query;
        connectionsManager.emit('client_cmd', req, 'unsubscribe', data.conn_id, data);
        try {
            connectionsManager.removeConnSubscription(data.conn_id, data.sub_id);
            res.jsonp({});
        } catch (e) {
            res.status(400).json({exception: JSON.parse(JSON.stringify(e))});
        }
    });

    router.post(appendPath(eventPath, '/send'), (req: express.Request, res: express.Response) => {
        let data = req.body;
        connectionsManager.emit('client_cmd', req, 'send', data.conn_id, data);
        connectionsManager.authorizeDestination(data.conn_id, DestAuthMode.SendMsg, data.destination, data.headers, data.body)
        .then((connection: TopicConnection) => {
            connectionsManager.emit('on_client_send_msg', req, connection, {destination: data.destination, headers: data.headers, body: data.body});
            if (options.dispatchMsgOnClientSend) connectionsManager.dispatchMessage(data.destination, data.headers, data.body);
            res.jsonp({});
        }).catch((err:any) => {
            res.status(403).json({exception: JSON.parse(JSON.stringify(err))});
        });
    });

    return {router, connectionsManager};
}