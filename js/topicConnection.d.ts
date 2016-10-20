/// <reference types="node" />
import * as rcf from 'rcf';
import * as events from 'events';
export declare class TopicConnection extends events.EventEmitter {
    pingIntervalMS: number;
    conn_id: string;
    remoteAddress: string;
    cookie: any;
    private eventEmitter;
    private subscriptions;
    private pintInterval;
    constructor(conn_id: string, remoteAddress: string, cookie: any, messageCB: rcf.MessageCallback, pingIntervalMS?: number);
    onChange(handler: () => void): void;
    forwardMessage(destination: string, headers: {
        [field: string]: any;
    }, message: any, done: rcf.DoneHandler): void;
    addSubscription(sub_id: string, destination: string, headers: {
        [field: string]: any;
    }, done: rcf.DoneHandler): void;
    removeSubscription(sub_id: string, done: rcf.DoneHandler): void;
    end(): void;
    toJSON(): Object;
}
