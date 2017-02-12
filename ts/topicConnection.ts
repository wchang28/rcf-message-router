import * as rcf from 'rcf';
import * as events from 'events';
import * as _ from 'lodash';
let alasql = require('alasql');
import {Socket} from 'net';

export interface Subscription {
	dest: string;
	hdrs?: {[field: string]: any};
}

export interface ITopicConnection {
	readonly id: string;
	cookie: any;
	readonly remoteAddress: string
	readonly remotePort: number;
	readonly remoteFamily: string;
	readonly localAddress: string;
	readonly bytesRead: number;
	readonly bytesWritten: number;
	readonly destroyed: boolean;
	destroy: () => void;
	toJSON: () => Object;
}

// this class emits the following events
// 1. change
// 2. message
export class TopicConnection extends events.EventEmitter implements ITopicConnection {
	private i: string;	// connection id
	private s: Socket;	// socket connection
	private k: any;	// cookie
	private u: {[sub_id:string] : Subscription;}	// topic subscriptions
	private a: NodeJS.Timer;	// keep alive timer
	constructor(conn_id: string, socket: Socket, cookie: any, messageCB: rcf.MessageCallback, keepAliveIntervalMS: number = 30000) {
		super();
		this.i = conn_id;
		this.s = socket;
		this.k = cookie;
		this.on('message', messageCB);
		this.u = {};
		if (typeof keepAliveIntervalMS === 'number' && keepAliveIntervalMS > 0) {
			this.a = setInterval(() => {
				// emit a keep-alive ping message on the connection
				/////////////////////////////////////////////////////
				let msg:rcf.IMessage = {
					headers: {
						event: rcf.MessageEventType.PING
					}
				};
				this.emitMessage(msg);
				/////////////////////////////////////////////////////
			}, keepAliveIntervalMS);
		} else {
			this.a = null;
		}
		// emit a 'connected' message on the connection
		/////////////////////////////////////////////////////////
		let msg : rcf.IMessage = {
			headers: {
				event: rcf.MessageEventType.CONNECT,
				conn_id: conn_id
			}
		};
		this.emitMessage(msg);
		/////////////////////////////////////////////////////////
	}
	triggerChangeEvent() : void {this.emit('change');}
	private emitMessage(msg: rcf.IMessage) : void {this.emit('message', msg);}
	forwardMessage(destination: string, headers: {[field: string]: any}, message: any) : void {
		for (let sub_id in this.u) {	// for each subscription this connection has
			let subscription = this.u[sub_id];
			let pattern = new RegExp(subscription.dest, 'gi');
			if (destination.match(pattern)) {	// matching destination
				let msg: rcf.IMessage = {
					headers: {
						event: rcf.MessageEventType.MESSAGE,
						sub_id: sub_id,
						destination: destination
					},
					body: message
				};
				if (headers) {
					for (let field in headers) {
						if (!msg.headers[field])
							msg.headers[field] = headers[field];
					}
				}
				if (subscription.hdrs && subscription.hdrs['selector'] && typeof subscription.hdrs['selector'] === 'string' && subscription.hdrs['selector'].length > 0) {
					let selector: string = subscription.hdrs['selector'];
					let msgHeaders: any = msg.headers;
					let sql = "select * from ? where " + selector;
					try {
						let res = alasql(sql, [[msgHeaders]]);
						if (res.length > 0) this.emitMessage(msg);
					} catch (e) {
						this.emitMessage(msg);
					}
				} else
					this.emitMessage(msg);
			}
		}
	}
	get subscriptions() : {[sub_id:string] : Subscription;} {return _.cloneDeep(this.u);}
	addSubscription(sub_id: string, destination: string, headers: {[field: string]: any}) : void {
		let subscription: Subscription = {
			dest: destination
			,hdrs: headers
		};
		this.u[sub_id] = subscription;
		this.triggerChangeEvent();
	}
	removeSubscription(sub_id: string) : void {	// might throws exception
		if (this.u[sub_id]) {
			delete this.u[sub_id];
			this.triggerChangeEvent();
		} else {
			throw "bad subscription id";
		}
	}
	end () : void {
		if (this.a) {
			clearInterval(this.a);
			this.a = null;
			this.u = {};
			this.triggerChangeEvent();
		}
	}
	get id() : string {return this.i;}
	get cookie() : any {return this.k;}
	set cookie(value: any) {
		if (value !== this.k) {
			this.k = value;
			this.triggerChangeEvent();
		}
	}

	get remoteAddress() : string {return this.s.remoteAddress;};
	get remotePort() : number {return this.s.remotePort;};
	get remoteFamily() : string {return this.s.remoteFamily;}
	get localAddress() : string {return this.s.localAddress;}
	get localPort(): number {return this.s.localPort;}
	get bytesRead() : number {return this.s.bytesRead;}
	get bytesWritten() : number {return this.s.bytesWritten;}
	get destroyed() : boolean {return this.s.destroyed;}
	destroy() : void {this.s.destroy;}
	
	toJSON() : Object {
		let o = {
			id: this.id
			,remoteAddress: this.remoteAddress
			,remotePort: this.remotePort
			,cookie: this.cookie
			,subscriptions: this.subscriptions
		}
		return o;
	}
}