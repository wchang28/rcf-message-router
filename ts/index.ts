import * as rcf from 'rcf';
import * as uuid from 'node-uuid';
import * as events from 'events';
import * as express from 'express';
import * as bodyParser from 'body-parser';

export interface IConnectionCreatedHandler {
    (err: any, conn_id: string) : void;
}

// this class emits the following events
// 1. change
export class ConnectionsManager extends events.EventEmitter
{
    private connCount: number;
    private __connections : {[conn_id: string]: rcf.IMsgConnection;}
    constructor() {
        super();
        this.connCount = 0;
        this.__connections = {};
    }
    getConnectionsCount() : number { return this.connCount;}
    createConnection(req: express.Request, connectionFactory: rcf.MsgConnFactory, remoteAddress: string, messageCB: rcf.MessageCallback, done: IConnectionCreatedHandler) : void {
        let conn_id = uuid.v4();
        connectionFactory(req, conn_id, remoteAddress, messageCB, (err: any, conn: rcf.IMsgConnection) => {
            if (err) {
                done(err, null);
            } else {
                this.__connections[conn_id] = conn;
                conn.onChange(() => {
                    this.emit('change');
                });
                this.connCount++;
                this.emit('change');
                done(null, conn_id);
            }
        });
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
    addSubscription(req: express.Request, conn_id: string, sub_id:string, destination: string, headers:{[field: string]: any}, done?: rcf.DoneHandler)  {
        let conn = this.__connections[conn_id];
        if (conn) {
            conn.addSubscription(req, sub_id, destination, headers, done);
        } else {
            if (typeof done === 'function') done('bad connection');
        }
    }
    removeSubscription(req: express.Request, conn_id: string, sub_id:string, done?: rcf.DoneHandler) {
        let conn = this.__connections[conn_id];
        if (conn) {
            conn.removeSubscription(req, sub_id, done);
        } else {
            if (typeof done === 'function') done('bad connection');
        }        
    }
    private forwardMessageImpl(req:express.Request, srcConn:rcf.IMsgConnection, destination: string, headers: {[field: string]:any}, message:any, done?: rcf.DoneHandler) {
        let left = this.connCount;
        let errs = [];
        for (let id in this.__connections) {    // for each connection
            let conn = this.__connections[id];
            conn.forwardMessage(req, srcConn, destination, headers, message, (err: any) => {
                left--;
                if (err) errs.push(err);
                if (left === 0) {
                    if (typeof done === 'function') done(errs.length > 0 ? errs : null);
                }
            });
        }
    }
    forwardMessage(req: express.Request, conn_id: string, destination: string, headers: {[field: string]:any}, message:any, done?: rcf.DoneHandler) {
        let srcConn = this.__connections[conn_id];
        if (srcConn) {
            this.forwardMessageImpl(req, srcConn, destination, headers, message, done);
        } else {
            if (typeof done === 'function') done('bad connection');
        }      
    }
    injectMessage(destination: string, headers: {[field: string]:any}, message:any, done?: rcf.DoneHandler) {
        this.forwardMessageImpl(null, null, destination, headers, message, done);
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
    cmd: string;
    data: any;
}

export function getRouter(eventPath: string, connectionFactory: rcf.MsgConnFactory) : ISSETopicRouter {
    let router: ISSETopicRouter  = <ISSETopicRouter>express.Router();
    router.use(bodyParser.json({'limit': '100mb'}));
    let connectionsManager = new ConnectionsManager();
    router.connectionsManager = connectionsManager;
    router.eventEmitter = new events.EventEmitter();
    
    // server side events streaming
    router.get(eventPath, (req: express.Request, res: SSEResponse) => {
        let remoteAddress = req.connection.remoteAddress+':'+req.connection.remotePort.toString();
        let ep: EventParams = {req, remoteAddress};
        router.eventEmitter.emit('sse_connect', ep);
        
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
		
        let conn_id: string = '';
        // initialize event streaming
        ///////////////////////////////////////////////////////////////////////
        connectionsManager.createConnection(
        req
        ,connectionFactory
        ,remoteAddress
        ,(msg: rcf.IMessage) => {res.sseSend(msg);}
        ,(err: any, connnection_id: string) => {
            if (err)    // connection cannot be created due to some error
                req.socket.end();   // close the socket, this will trigger req.on("close")
            else {
                conn_id = connnection_id;
                let cep: ConnectedEventParams = {req, remoteAddress, conn_id};
                router.eventEmitter.emit('client_connect', cep);
            }
        });
        ///////////////////////////////////////////////////////////////////////
		
        // The 'close' event is fired when a user closes their browser window.
        req.on("close", () => {
            router.eventEmitter.emit('sse_disconnect', ep);
            if (conn_id.length > 0) {
                let cep: ConnectedEventParams = {req, remoteAddress, conn_id};
                router.eventEmitter.emit('client_disconnect', cep);
                connectionsManager.removeConnection(conn_id);
            }
        });
    });
    
    router.post(eventPath + '/subscribe', (req: express.Request, res: express.Response) => {
        let remoteAddress = req.connection.remoteAddress+':'+req.connection.remotePort.toString();
        let data = req.body;
        let cep: CommandEventParams = {req, remoteAddress, conn_id: data.conn_id, cmd: 'subscribe', data};
        router.eventEmitter.emit('client_cmd', cep);
        connectionsManager.addSubscription(req, data.conn_id, data.sub_id, data.destination, data.headers, (err: any) => {
            if (err) {
                res.jsonp({exception: JSON.parse(JSON.stringify(err))});
            } else {
                res.jsonp({});
            }
        });
    });

    router.get(eventPath + '/unsubscribe', (req: express.Request, res: express.Response) => {
        let remoteAddress = req.connection.remoteAddress+':'+req.connection.remotePort.toString();
        let data = req.query;
        let cep: CommandEventParams = {req, remoteAddress, conn_id: data.conn_id, cmd: 'unsubscribe', data};
        router.eventEmitter.emit('client_cmd', cep);
        connectionsManager.removeSubscription(req, data.conn_id, data.sub_id, (err: any) => {
            if (err) {
                res.jsonp({exception: JSON.parse(JSON.stringify(err))});
            } else {
                res.jsonp({});
            }       
        });
    });

    router.post(eventPath + '/send', (req: express.Request, res: express.Response) => {
        let remoteAddress = req.connection.remoteAddress+':'+req.connection.remotePort.toString();
        let data = req.body;
        let cep: CommandEventParams = {req, remoteAddress, conn_id: data.conn_id, cmd: 'send', data};
        router.eventEmitter.emit('client_cmd', cep);
        connectionsManager.forwardMessage(req, data.conn_id, data.destination, data.headers, data.body, (err: any) => {
            if (err) {
                res.jsonp({exception: JSON.parse(JSON.stringify(err))});
            } else {
                res.jsonp({});
            }          
        });
    });
    
    return router;
}