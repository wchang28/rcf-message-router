import * as rcf from 'rcf';
import * as uuid from 'node-uuid';
import * as events from 'events';
import * as express from 'express';
import * as bodyParser from 'body-parser';
import * as _ from 'lodash';
import {TopicConnection} from './topicConnection';

export interface CookieSetter {
    (req: express.Request): any;
}

export interface Options {
    pingIntervalMS?: number
    cookieSetter?: CookieSetter;
    dispatchMsgOnClientSend?: boolean;
    destinationAuthorizeApp?: express.Express;
}

let defaultOptions: Options = {
	pingIntervalMS: 10000
    ,dispatchMsgOnClientSend: true
}

// this class emits the following events
// 1. change
export class ConnectionsManager extends events.EventEmitter {
    private connCount: number;
    private __connections : {[conn_id: string]: TopicConnection;}
    public static MSG_BAD_CONN = "bad connection";
    constructor() {
        super();
        this.connCount = 0;
        this.__connections = {};
    }
    get ConnectionsCount() : number { return this.connCount;}
    createConnection(remoteAddress: string, cookie: any, messageCB: rcf.MessageCallback, pingIntervalMS: number) : string {
        let conn_id = uuid.v4();
        let conn = new TopicConnection(conn_id, remoteAddress, cookie, messageCB, pingIntervalMS);
        this.__connections[conn_id] = conn;
        conn.onChange(() => {
            this.emit('change');
        });
        this.connCount++;
        this.emit('change');
        return conn_id;
    }
    validConnection(conn_id: string) : boolean {
        let conn = this.__connections[conn_id];
        return (conn ? true : false);
    }
    removeConnection(conn_id: string) : void {
        let conn = this.__connections[conn_id];
        if (conn) {
            conn.end();
            delete this.__connections[conn_id];
            this.connCount--;
            this.emit('change');
        }     
    }
    addSubscription(conn_id: string, sub_id:string, destination: string, headers:{[field: string]: any}, done?: rcf.DoneHandler)  {
        let conn = this.__connections[conn_id];
        if (conn) {
            conn.addSubscription(sub_id, destination, headers, done);
        } else {
            if (typeof done === 'function') done(ConnectionsManager.MSG_BAD_CONN);
        }
    }
    removeSubscription(conn_id: string, sub_id:string, done?: rcf.DoneHandler) {
        let conn = this.__connections[conn_id];
        if (conn) {
            conn.removeSubscription(sub_id, done);
        } else {
            if (typeof done === 'function') done(ConnectionsManager.MSG_BAD_CONN);
        }        
    }
    dispatchMessage(destination: string, headers: {[field: string]:any}, message:any, done?: rcf.DoneHandler) {
        let left = this.connCount;
        let errs = [];
        for (let id in this.__connections) {    // for each connection
            let conn = this.__connections[id];
            conn.forwardMessage(destination, headers, message, (err: any) => {
                left--;
                if (err) errs.push(err);
                if (left === 0) {
                    if (typeof done === 'function') done(errs.length > 0 ? errs : null);
                }
            });
        }
    }
    toJSON() : Object {
        let ret = [];
        for (let conn_id in this.__connections) {
            let conn = this.__connections[conn_id];
            ret.push(conn.toJSON());
        }
        return ret;
    }
}

interface SSEResponse extends express.Response {
    sseSend: (msg:any) => void;
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
    destination: string;
    headers: {[field: string]: any};
    body: any;
}

function getRemoteAddress(req: express.Request) : string {
    return req.connection.remoteAddress+':'+req.connection.remotePort.toString();
}

export enum DestAuthMode {
    Subscribe = 0
    ,SendMsg = 1
}

export interface IDestAuthRequest {
    method: string;
    conn_id: string;
    authMode: DestAuthMode;
    headers:{[field: string]: any};
    originalUrl: string;
    url: string;
    path: string;
    body: any;
    params: any;
    query: any;
    originalReq: express.Request;
};

export interface IDestAuthResponse {
    reject: (err: any) => void;
    accept: () => void;
};

export interface IDestAuthReqRes {
    authReq: IDestAuthRequest;
    authRes: IDestAuthResponse;
};

export function getDestinationAuthReqRes(req: express.Request, res: express.Response) : IDestAuthReqRes {
    let authReq: any = req;
    let authRes:any = res;
    return {authReq, authRes};
}

function authorizeDestination(authApp:any, authMode: DestAuthMode, conn_id: string, destination: string, headers:{[field: string]: any}, body:any, originalReq: express.Request, done: (err:any) => void) {
	if (authApp) {
        // construct artifical req and res objects for the destination auth. express app to route
        //////////////////////////////////////////////////////////////////////////////////////////
		let req = {
			"method": (authMode == DestAuthMode.Subscribe ? "GET" : "POST")
            ,"conn_id": conn_id
            ,"authMode": authMode
            ,"headers": headers
			,"url": destination
			,"originalReq": (originalReq ? originalReq : null)
            ,"body": (body ? body : null)
            ,"toJSON": function() {
                return {
                    "method": this.method
                    ,"conn_id": this.conn_id
                    ,"authMode": this.authMode
                    ,"headers": this.headers
                    ,"originalUrl": this.originalUrl
                    ,"url": this.destination
                    ,"path": this.path
                    ,"body": this.body
                    ,"params": this.params
                    ,"query": this.query
                };
            }
		};
		let res = {
			'setHeader': (fld, value) => {}
			,'reject': done
			,'accept': () => {done(null);}
		};
        //////////////////////////////////////////////////////////////////////////////////////////
        let finalHandler = () => {
            done("destination not authorized");
        }
		authApp(req, res, finalHandler);    // route it
	} else {
		done(null);
	}
}

// router.eventEmitter emit the following events
// 1. sse_connect (EventParams)
// 2. sse_disconnect (EventParams)
// 3. client_connect (ConnectedEventParams)
// 4. client_disconnect (ConnectedEventParams)
// 5. client_cmd (CommandEventParams)
// 6. on_client_send_msg (ClientSendMsgEventParams)
export function getRouter(eventPath: string, options?: Options) : ISSETopicRouter {
    options = options || defaultOptions;
    options = _.assignIn({}, defaultOptions, options);
    
    let router: ISSETopicRouter  = <ISSETopicRouter>express.Router();
    router.use(bodyParser.json({'limit': '100mb'}));
    let connectionsManager = new ConnectionsManager();
    router.connectionsManager = connectionsManager;
    router.eventEmitter = new events.EventEmitter();
    
    // server side events streaming
    router.get(eventPath, (req: express.Request, res: SSEResponse) => {
        let cookie = (options.cookieSetter ? options.cookieSetter(req) : null);
        let remoteAddress = getRemoteAddress(req);
        let ep: EventParams = {req, remoteAddress};

        router.eventEmitter.emit('sse_connect', ep);    // fire the "sse_connect" event
        
        // init SSE
        ///////////////////////////////////////////////////////////////////////
        //send headers for event-stream connection
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });
        // add a sseSend() method to the result object
        res.sseSend = (data: any, event? : any) => {
            let s = "";
            if (event) s += "event: " + event.toString() + "\n";
            s+= "data: " + JSON.stringify(data) + "\n\n";
            res.write(s);
            router.eventEmitter.emit('sse_send', s);
        }
        res.write('\n');
        ///////////////////////////////////////////////////////////////////////
		
        // create a connection
        ///////////////////////////////////////////////////////////////////////
        let conn_id = connectionsManager.createConnection(remoteAddress, cookie, (msg: rcf.IMessage) => {
            res.sseSend(msg);
        }, options.pingIntervalMS);
        ///////////////////////////////////////////////////////////////////////

        let cep: ConnectedEventParams = {req, remoteAddress, conn_id};

        router.eventEmitter.emit('client_connect', cep);    // fire the "client_connect" event
        		
        // The 'close' event is fired when a user closes their browser window.
        req.on("close", () => {
            router.eventEmitter.emit('sse_disconnect', ep); // fire the "sse_disconnect" event
            if (conn_id.length > 0) {
                connectionsManager.removeConnection(conn_id);
                router.eventEmitter.emit('client_disconnect', cep); // fire the "client_disconnect" event
            }
        });
    });
    
    router.post(eventPath + '/subscribe', (req: express.Request, res: express.Response) => {
        let remoteAddress = getRemoteAddress(req);
        let data = req.body;
        let cep: CommandEventParams = {req, remoteAddress, conn_id: data.conn_id, cmd: 'subscribe', data};
        router.eventEmitter.emit('client_cmd', cep);
        authorizeDestination(options.destinationAuthorizeApp, DestAuthMode.Subscribe, data.conn_id, data.destination, data.headers, null, req, (err:any) => {
            if (err)
                res.status(403).json({exception: JSON.parse(JSON.stringify(err))});
            else {
                connectionsManager.addSubscription(data.conn_id, data.sub_id, data.destination, data.headers, (err: any) => {
                    if (err)
                        res.status(400).json({exception: JSON.parse(JSON.stringify(err))});
                    else
                        res.jsonp({});
                });
            }
        });
    });

    router.get(eventPath + '/unsubscribe', (req: express.Request, res: express.Response) => {
        let remoteAddress = getRemoteAddress(req);
        let data = req.query;
        let cep: CommandEventParams = {req, remoteAddress, conn_id: data.conn_id, cmd: 'unsubscribe', data};
        router.eventEmitter.emit('client_cmd', cep);
        connectionsManager.removeSubscription(data.conn_id, data.sub_id, (err: any) => {
            if (err)
                res.status(400).json({exception: JSON.parse(JSON.stringify(err))});
            else
                res.jsonp({});
        });
    });

    router.post(eventPath + '/send', (req: express.Request, res: express.Response) => {
        let remoteAddress = getRemoteAddress(req);
        let data = req.body;
        let cep: CommandEventParams = {req, remoteAddress, conn_id: data.conn_id, cmd: 'send', data};
        router.eventEmitter.emit('client_cmd', cep);
        if (connectionsManager.validConnection(data.conn_id)) { // make sure the connection is valid
            authorizeDestination(options.destinationAuthorizeApp, DestAuthMode.SendMsg, data.conn_id, data.destination, data.headers, data.body, req, (err:any) => {  // make sure this send is authorized for the destination
                if (err)
                    res.status(403).json({exception: JSON.parse(JSON.stringify(err))});
                else {
                    let ev: ClientSendMsgEventParams = {req, conn_id: data.conn_id, destination: data.destination, headers: data.headers, body: data.body};
                    router.eventEmitter.emit('on_client_send_msg', ev);
                    if (options.dispatchMsgOnClientSend) {
                        connectionsManager.dispatchMessage(data.destination, data.headers, data.body, (err: any) => {
                            if (err)
                                res.status(400).json({exception: JSON.parse(JSON.stringify(err))});
                            else
                                res.jsonp({});
                        });
                    } else
                        res.jsonp({});
                }
            });
        } else {
            res.status(400).json({exception: ConnectionsManager.MSG_BAD_CONN});
        }
    });
    
    return router;
}